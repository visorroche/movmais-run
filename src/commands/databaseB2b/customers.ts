import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Customer } from "../../entities/Customer.js";
import { CustomersGroup } from "../../entities/CustomersGroup.js";
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

async function resetInternalDbConnection() {
  try {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  } catch {
    // ignore
  }
  await AppDataSource.initialize();
}

function chunkArray<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isConnectionTerminatedError(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  const drv = String((err as any)?.driverError?.message ?? "");
  return msg.includes("Connection terminated unexpectedly") || drv.includes("Connection terminated unexpectedly");
}

async function main() {
  __stage = "parse_args";
  const raw = parseCliKv(process.argv.slice(2));
  const forceRaw = raw.get("force");
  const force = raw.has("force") && String(forceRaw ?? "").trim() !== "false";
  const args = { company: parseCompanyArg(raw), force };
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
  const groupRepo = AppDataSource.getRepository(CustomersGroup);
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
  if (!args.force && syncedAtCol && lastProcessedAt) {
    params.push(lastProcessedAt.toISOString());
    whereParts.push(`${quoteIdent(syncedAtCol)} > $${params.length}`);
  }
  const whereSql = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
  const sqlBase = `SELECT ${colsSql} FROM ${quoteIdent(table)}${whereSql}`;

  console.log(
    `[databaseB2b:customers] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
      !args.force && syncedAtCol && lastProcessedAt ? "on" : "off"
    } force=${args.force ? "on" : "off"}`,
  );

  const isExternalConnError = (err: unknown) => {
    const code = String((err as any)?.code ?? "");
    const msg = String((err as any)?.message ?? "");
    return (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      msg.includes("ECONNRESET") ||
      msg.includes("Connection terminated unexpectedly") ||
      msg.includes("terminating connection") ||
      msg.includes("timeout")
    );
  };

  let ext = buildExternalClient(cfg);
  let externalErrorLogged = false;
  const attachExternalErrorHandler = () => {
    ext.on("error", (err: any) => {
      // Importante: sem listener de 'error', o Node derruba o processo (Unhandled 'error' event)
      if (!externalErrorLogged) {
        externalErrorLogged = true;
        console.warn("[databaseB2b:customers] conexão externa caiu:", String(err?.message ?? err));
      }
    });
  };
  const reconnectExternal = async (reason: string) => {
    console.warn(`[databaseB2b:customers] reconectando ao banco do cliente (${reason})...`);
    try {
      await ext.end().catch(() => {});
    } catch {
      // ignore
    }
    ext = buildExternalClient(cfg);
    externalErrorLogged = false;
    attachExternalErrorHandler();
    __stage = "connect_external_db";
    await ext.connect();
  };
  const externalQuery = async (sql: string, p: any[]) => {
    try {
      return await ext.query(sql, p);
    } catch (err) {
      if (isExternalConnError(err)) {
        await reconnectExternal("query_failed");
        return await ext.query(sql, p);
      }
      throw err;
    }
  };

  attachExternalErrorHandler();
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
      const resCount = await externalQuery(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}${whereSql}`, params);
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
      const res = await externalQuery(`${sqlBase} LIMIT ${BATCH_SIZE} OFFSET ${offset}`, params);
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
      const batchGroupExternalIds = Array.from(
        new Set(batch.map((r) => String(applyFieldMapping((fields as any).group_id, r) ?? "").trim()).filter(Boolean)),
      );

      __stage = "load_existing_customers_batch";
      const existingByExternalId = new Map<string, Customer>();
      if (batchExternalIds.length) {
        for (const ids of chunkArray(batchExternalIds, 200)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const existing = await customerRepo
              .createQueryBuilder("c")
              .where("c.company_id = :companyId", { companyId: company.id })
              .andWhere("c.external_id IN (:...ids)", { ids })
              .getMany();
            for (const c of existing) {
              const key = String(c.externalId ?? "").trim();
              if (key) existingByExternalId.set(key, c);
            }
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customers] conexão interna caiu; reiniciando e tentando novamente (existingByExternalId)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const customerRepoRetry = AppDataSource.getRepository(Customer);
              // eslint-disable-next-line no-await-in-loop
              const existing = await customerRepoRetry
                .createQueryBuilder("c")
                .where("c.company_id = :companyId", { companyId: company.id })
                .andWhere("c.external_id IN (:...ids)", { ids })
                .getMany();
              for (const c of existing) {
                const key = String(c.externalId ?? "").trim();
                if (key) existingByExternalId.set(key, c);
              }
              continue;
            }
            throw err;
          }
        }
      }

      const legacyByTaxId = new Map<string, Customer>();
      if (batchTaxIds.length) {
        for (const ids of chunkArray(batchTaxIds, 200)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const legacy = await customerRepo
              .createQueryBuilder("c")
              .where("c.company_id = :companyId", { companyId: company.id })
              .andWhere("c.tax_id IN (:...ids)", { ids })
              .getMany();
            for (const c of legacy) {
              const key = String(c.taxId ?? "").trim();
              if (key) legacyByTaxId.set(key, c);
            }
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customers] conexão interna caiu; reiniciando e tentando novamente (legacyByTaxId)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const customerRepoRetry = AppDataSource.getRepository(Customer);
              // eslint-disable-next-line no-await-in-loop
              const legacy = await customerRepoRetry
                .createQueryBuilder("c")
                .where("c.company_id = :companyId", { companyId: company.id })
                .andWhere("c.tax_id IN (:...ids)", { ids })
                .getMany();
              for (const c of legacy) {
                const key = String(c.taxId ?? "").trim();
                if (key) legacyByTaxId.set(key, c);
              }
              continue;
            }
            throw err;
          }
        }
      }

      const repByLookup = new Map<string, Representative>();
      if (batchRepExternalIds.length) {
        for (const ids of chunkArray(batchRepExternalIds, 200)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const reps = await repRepo
              .createQueryBuilder("r")
              .where("r.company_id = :companyId", { companyId: company.id })
              .andWhere(`r.${repLookupColumn} IN (:...ids)`, { ids })
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
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customers] conexão interna caiu; reiniciando e tentando novamente (repByLookup)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const repRepoRetry = AppDataSource.getRepository(Representative);
              // eslint-disable-next-line no-await-in-loop
              const reps = await repRepoRetry
                .createQueryBuilder("r")
                .where("r.company_id = :companyId", { companyId: company.id })
                .andWhere(`r.${repLookupColumn} IN (:...ids)`, { ids })
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
              continue;
            }
            throw err;
          }
        }
      }

      const groupByExternalId = new Map<string, CustomersGroup>();
      if (batchGroupExternalIds.length) {
        for (const ids of chunkArray(batchGroupExternalIds, 200)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const groups = await groupRepo
              .createQueryBuilder("g")
              .where("g.company_id = :companyId", { companyId: company.id })
              .andWhere("g.external_id IN (:...ids)", { ids })
              .getMany();
            for (const g of groups) {
              const key = String(g.externalId ?? "").trim();
              if (key) groupByExternalId.set(key, g);
            }
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customers] conexão interna caiu; reiniciando e tentando novamente (groupByExternalId)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const groupRepoRetry = AppDataSource.getRepository(CustomersGroup);
              // eslint-disable-next-line no-await-in-loop
              const groups = await groupRepoRetry
                .createQueryBuilder("g")
                .where("g.company_id = :companyId", { companyId: company.id })
                .andWhere("g.external_id IN (:...ids)", { ids })
                .getMany();
              for (const g of groups) {
                const key = String(g.externalId ?? "").trim();
                if (key) groupByExternalId.set(key, g);
              }
              continue;
            }
            throw err;
          }
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

        const taxIdRaw = String(applyFieldMapping(fields.tax_id, row) ?? "").trim();
        if (!taxIdRaw) skippedMissingTaxId += 1;
        // Chave de upsert é external_id; tax_id é preenchido quando vier na fonte, senão mantém existente ou vazio
        const taxId = taxIdRaw || "";

        let customer = toSaveByExternal.get(externalId) ?? existingByExternalId.get(externalId) ?? null;
        if (!customer && taxIdRaw) {
          // compat: se já existia cliente antigo chaveado por taxId, anexamos externalId agora
          customer = legacyByTaxId.get(taxIdRaw) ?? null;
        }
        if (!customer) customer = customerRepo.create({ company, externalId, taxId: taxId || externalId });

        customer.company = company;
        // Atualiza tax_id só se veio na fonte; senão mantém o que já tinha (update por external_id)
        customer.taxId = taxId || (customer.taxId ?? "") || externalId;
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

        const groupExternal = String(applyFieldMapping((fields as any).group_id, row) ?? "").trim();
        if (groupExternal) customer.customerGroup = groupByExternalId.get(groupExternal) ?? null;

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
        const t0 = Date.now();
        try {
          await customerRepo.save(toSave, { chunk: 250 });
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:customers] conexão interna caiu; reiniciando e tentando novamente (save_batch)...");
            await resetInternalDbConnection();
            const customerRepoRetry = AppDataSource.getRepository(Customer);
            await customerRepoRetry.save(toSave, { chunk: 250 });
          } else {
            throw err;
          }
        }
        const dt = Date.now() - t0;
        if (dt > 3000) console.log(`[databaseB2b:customers] save batch size=${toSave.length} took=${dt}ms`);
        upserts += toSave.length;
        processed += toSave.length;
        logProgress("process");
      }

      if (batch.length < BATCH_SIZE) break;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "customers_schema", maxSyncedAt.toISOString());
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[databaseB2b:customers] company=${args.company} customers_upserted=${upserts} skipped_missing_external_id=${skippedMissingExternalId} skipped_missing_tax_id=${skippedMissingTaxId} duplicated_external_id_in_batch=${duplicatedExternalIdInBatch}`,
    );
    console.log(`[databaseB2b:customers] concluído em ${elapsed}s`);
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[databaseB2b:customers] erro (stage=${__stage}):`, err);
  process.exit(1);
});

