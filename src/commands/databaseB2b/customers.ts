import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Customer } from "../../entities/Customer.js";
import { Representative } from "../../entities/Representative.js";
import { parseCliKv, parseCompanyArg, quoteIdent } from "../../utils/cli.js";
import {
  loadDatabaseB2bCompanyPlatform,
  buildExternalClient,
  applyFieldMapping,
  parseCsvColumns,
  parseYmd,
  toBoolLoose,
  schemaFieldName,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  parseTimestamp,
  describeDatabaseB2bConfig,
  collectSourceColumnsFromMapping,
} from "../../utils/databaseB2b.js";

function buildPhonesFromCsv(row: Record<string, any>, rawMapping: string): Record<string, string> | null {
  const cols = parseCsvColumns(rawMapping);
  if (!cols.length) return null;
  const keys = ["celular", "comercial", "residencial"];
  const out: Record<string, string> = {};
  cols.forEach((col, idx) => {
    const v = row[col];
    const key = keys[idx] ?? `extra_${idx + 1}`;
    out[key] = v == null ? "" : String(v);
  });
  return out;
}

function parseDateOnlyLoose(value: unknown): string | null {
  const ymd = parseYmd(value);
  if (ymd) return ymd;
  const ts = parseTimestamp(value);
  return ts ? ts.toISOString().slice(0, 10) : null;
}

let __stage = "init";

async function main() {
  __stage = "parse_args";
  const raw = parseCliKv(process.argv.slice(2));
  const args = { company: parseCompanyArg(raw) };
  const startedAt = Date.now();
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();

  __stage = "load_config";
  const meta = await loadDatabaseB2bCompanyPlatform(args.company);
  const cfg = meta?.config ?? null;
  if (!cfg) throw new Error("Config databaseB2b inválida: company_platforms.config ausente/ilegível.");
  if (!cfg?.customers_schema?.table) {
    console.error(
      `[databaseB2b:customers] diagnóstico config: company=${args.company} platform=${meta?.platformSlug ?? "?"} company_platform_id=${meta?.companyPlatformId ?? "?"}`,
    );
    console.error("[databaseB2b:customers] resumo:", describeDatabaseB2bConfig(cfg));
    throw new Error("Config databaseB2b inválida: customers_schema.table ausente (configure o schema de clientes).");
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const customerRepo = AppDataSource.getRepository(Customer);
  const repRepo = AppDataSource.getRepository(Representative);
  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);

  const schema = cfg.customers_schema;
  const fields = schema.fields ?? {};
  const table = schema.table;
  const requiredExternalId = schemaFieldName((fields as any).external_id).trim();
  if (!requiredExternalId) throw new Error('Config databaseB2b inválida: customers_schema.fields.external_id ausente (mapeie "external_id").');
  const lastProcessedAt = getDatabaseB2bLastProcessedAt(cfg, "customers_schema");
  const syncedAtCol = schemaFieldName((fields as any).synced_at);
  const createdAtMapping = (fields as any).created_at ?? (fields as any).createdAt;
  const repLookupFieldRaw =
    fields.representative_id && typeof fields.representative_id === "object"
      ? String(
          ((fields.representative_id as any).options?.lookupField ??
            (fields.representative_id as any).options?.lookup_field ??
            "") as any,
        ).trim()
      : "";
  const REP_LOOKUP_COLUMN: Record<string, "external_id" | "internal_code" | "document" | "name" | "category"> = {
    external_id: "external_id",
    internal_code: "internal_code",
    document: "document",
    name: "name",
    category: "category",
  };
  const repLookupColumn = (repLookupFieldRaw === "tax_id" ? "document" : REP_LOOKUP_COLUMN[repLookupFieldRaw]) ?? "external_id";

  const sourceCols = collectSourceColumnsFromMapping(fields as any);
  const phonesMapping = typeof fields.phones === "string" ? fields.phones.trim() : "";
  if (phonesMapping) parseCsvColumns(phonesMapping).forEach((c) => sourceCols.add(c));
  sourceCols.add(requiredExternalId);
  if (syncedAtCol) sourceCols.add(syncedAtCol);

  const colsSql = sourceCols.size ? Array.from(sourceCols).map(quoteIdent).join(", ") : "*";
  const whereParts: string[] = [];
  const params: any[] = [];
  if (syncedAtCol && lastProcessedAt) {
    params.push(lastProcessedAt.toISOString());
    whereParts.push(`${quoteIdent(syncedAtCol)} > $${params.length}`);
  }
  const whereSql = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
  const sqlBase = `SELECT ${colsSql} FROM ${quoteIdent(table)}${whereSql}`;

  console.log(
    `[databaseB2b:customers] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
      syncedAtCol && lastProcessedAt ? "on" : "off"
    }`,
  );

  const ext = buildExternalClient(cfg);
  __stage = "connect_external_db";
  await ext.connect();
  try {
    let upserts = 0;
    let skippedMissingTaxId = 0;
    let skippedMissingExternalId = 0;
    let duplicatedExternalIdInBatch = 0;
    let maxSyncedAt: Date | null = null;

    __stage = "count_external";
    let totalRows: number | null = null;
    try {
      console.log("[databaseB2b:customers] contando linhas no banco do cliente...");
      const resCount = await ext.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}${whereSql}`, params);
      const cRaw = resCount.rows?.[0]?.c;
      const n = Number(cRaw);
      if (Number.isFinite(n) && n >= 0) totalRows = n;
    } catch {
      totalRows = null;
    }

    const BATCH_SIZE = 1_000;
    let fetched = 0;
    let processed = 0;
    let lastLogAt = 0;
    const logProgress = (kind: "fetch" | "process") => {
      const now = Date.now();
      if (now - lastLogAt < 1500) return;
      lastLogAt = now;
      const denom = totalRows ?? null;
      const base = kind === "fetch" ? fetched : processed;
      const pct = denom && denom > 0 ? Math.min(100, Math.round((base / denom) * 100)) : null;
      const pctTxt = pct == null ? "" : ` (${pct}%)`;
      const elapsed = Math.round((now - startedAt) / 1000);
      console.log(
        `[databaseB2b:customers] ${kind} fetched=${fetched}${denom != null ? `/${denom}` : ""} processed=${processed}${
          denom != null ? `/${denom}` : ""
        }${pctTxt} elapsed=${elapsed}s`,
      );
    };

    __stage = "fetch_and_process";
    for (let offset = 0; ; offset += BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const res = await ext.query(`${sqlBase} LIMIT ${BATCH_SIZE} OFFSET ${offset}`, params);
      const batch = (res.rows ?? []) as Record<string, any>[];
      fetched += batch.length;
      logProgress("fetch");
      if (batch.length === 0) break;

      const batchExternalIds = Array.from(
        new Set(batch.map((r) => String(applyFieldMapping((fields as any).external_id, r) ?? "").trim()).filter(Boolean)),
      );
      const batchTaxIds = Array.from(new Set(batch.map((r) => String(applyFieldMapping(fields.tax_id, r) ?? "").trim()).filter(Boolean)));
      const batchRepExternalIds = Array.from(
        new Set(batch.map((r) => String(applyFieldMapping(fields.representative_id, r) ?? "").trim()).filter(Boolean)),
      );

      __stage = "load_existing_customers_batch";
      const existingByExternalId = new Map<string, Customer>();
      if (batchExternalIds.length) {
        const existing = await customerRepo
          .createQueryBuilder("c")
          .where("c.company_id = :companyId", { companyId: company.id })
          .andWhere("c.external_id IN (:...ids)", { ids: batchExternalIds })
          .getMany();
        for (const c of existing) {
          const key = String(c.externalId ?? "").trim();
          if (key) existingByExternalId.set(key, c);
        }
      }

      const legacyByTaxId = new Map<string, Customer>();
      if (batchTaxIds.length) {
        const legacy = await customerRepo
          .createQueryBuilder("c")
          .where("c.company_id = :companyId", { companyId: company.id })
          .andWhere("c.external_id IN (:...ids)", { ids: batchTaxIds })
          .getMany();
        for (const c of legacy) {
          const key = String(c.externalId ?? "").trim();
          if (key) legacyByTaxId.set(key, c);
        }
      }

      const repByLookup = new Map<string, Representative>();
      if (batchRepExternalIds.length) {
        const reps = await repRepo
          .createQueryBuilder("r")
          .where("r.company_id = :companyId", { companyId: company.id })
          .andWhere(`r.${repLookupColumn} IN (:...ids)`, { ids: batchRepExternalIds })
          .getMany();
        for (const rep of reps) {
          const key =
            repLookupColumn === "external_id"
              ? String(rep.externalId ?? "").trim()
              : repLookupColumn === "internal_code"
                ? String((rep as any).internalCode ?? "").trim()
              : repLookupColumn === "document"
                ? String((rep as any).document ?? "").trim()
                : repLookupColumn === "name"
                  ? String((rep as any).name ?? "").trim()
                  : String((rep as any).category ?? "").trim();
          if (key) repByLookup.set(key, rep);
        }
      }

      __stage = "transform_batch";
      const toSaveByExternal = new Map<string, Customer>();
      const seenExternalIds = new Set<string>();

      for (const row of batch) {
        const externalId = String(applyFieldMapping((fields as any).external_id, row) ?? "").trim();
        if (!externalId) {
          skippedMissingExternalId += 1;
          continue;
        }
        if (seenExternalIds.has(externalId)) duplicatedExternalIdInBatch += 1;
        seenExternalIds.add(externalId);

        const taxId = String(applyFieldMapping(fields.tax_id, row) ?? "").trim();
        if (!taxId) {
          skippedMissingTaxId += 1;
          continue;
        }

        let customer = toSaveByExternal.get(externalId) ?? existingByExternalId.get(externalId) ?? null;
        if (!customer) {
          // compat: se já existia cliente antigo chaveado por taxId, anexamos externalId agora
          customer = legacyByTaxId.get(taxId) ?? null;
        }
        if (!customer) customer = customerRepo.create({ company, externalId, taxId });

        customer.company = company;
        customer.taxId = taxId;
        customer.externalId = externalId;
        customer.internalCod = (applyFieldMapping(fields.internal_cod, row) as any) ?? customer.internalCod ?? null;
        customer.legalName = (applyFieldMapping(fields.legal_name, row) as any) ?? customer.legalName ?? null;
        customer.tradeName = (applyFieldMapping(fields.trade_name, row) as any) ?? customer.tradeName ?? null;
        customer.personType = (applyFieldMapping(fields.person_type, row) as any) ?? customer.personType ?? null;
        customer.gender = (applyFieldMapping(fields.gender, row) as any) ?? customer.gender ?? null;
        customer.birthDate = parseYmd(applyFieldMapping(fields.birth_date, row)) ?? customer.birthDate ?? null;
        customer.email = (applyFieldMapping(fields.email, row) as any) ?? customer.email ?? null;
        customer.obs = (applyFieldMapping(fields.obs, row) as any) ?? customer.obs ?? null;
        customer.segmentation = (applyFieldMapping(fields.segmentation, row) as any) ?? customer.segmentation ?? null;
        customer.address = (applyFieldMapping(fields.address, row) as any) ?? customer.address ?? null;
        customer.number = (applyFieldMapping(fields.number, row) as any) ?? customer.number ?? null;
        customer.complement = (applyFieldMapping(fields.complement, row) as any) ?? customer.complement ?? null;
        customer.neighborhood = (applyFieldMapping(fields.neighborhood, row) as any) ?? customer.neighborhood ?? null;
        customer.zip = (applyFieldMapping(fields.zip, row) as any) ?? customer.zip ?? null;
        customer.city = (applyFieldMapping(fields.city, row) as any) ?? customer.city ?? null;
        customer.state = (applyFieldMapping(fields.state, row) as any) ?? customer.state ?? null;
        customer.createdAt = parseDateOnlyLoose(applyFieldMapping(createdAtMapping, row)) ?? customer.createdAt ?? null;
        customer.status = toBoolLoose(applyFieldMapping(fields.status, row)) ?? customer.status ?? null;

        const repExternal = String(applyFieldMapping(fields.representative_id, row) ?? "").trim();
        if (repExternal) customer.representative = repByLookup.get(repExternal) ?? null;

        if (phonesMapping) customer.phones = buildPhonesFromCsv(row, phonesMapping) as any;

        toSaveByExternal.set(externalId, customer);

        if (syncedAtCol) {
          const d = parseTimestamp(applyFieldMapping((fields as any).synced_at, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      __stage = "save_batch";
      const toSave = Array.from(toSaveByExternal.values());
      if (toSave.length) {
        await customerRepo.save(toSave, { chunk: 250 });
        upserts += toSave.length;
        processed += toSave.length;
        logProgress("process");
      }

      if (batch.length < BATCH_SIZE) break;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "customers_schema", maxSyncedAt.toISOString());
    }
    console.log(
      `[databaseB2b:customers] company=${args.company} customers_upserted=${upserts} skipped_missing_external_id=${skippedMissingExternalId} skipped_missing_tax_id=${skippedMissingTaxId} duplicated_external_id_in_batch=${duplicatedExternalIdInBatch}`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[databaseB2b:customers] erro (stage=${__stage}):`, err);
  process.exit(1);
});

