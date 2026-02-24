import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Representative } from "../../entities/Representative.js";
import { parseCliKv, parseCompanyArg, quoteIdent } from "../../utils/cli.js";
import {
  loadDatabaseB2bCompanyPlatform,
  buildExternalClient,
  applyFieldMapping,
  parseYmd,
  toBoolLoose,
  schemaFieldName,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  parseTimestamp,
  describeDatabaseB2bConfig,
  collectSourceColumnsFromMapping,
} from "../../utils/databaseB2b.js";

let __stage = "init";

function parseDateOnlyLoose(value: unknown): string | null {
  const ymd = parseYmd(value);
  if (ymd) return ymd;
  const ts = parseTimestamp(value);
  return ts ? ts.toISOString().slice(0, 10) : null;
}

function normalizeBrPhoneToE164Digits(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // mantém apenas dígitos
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;

  // remove prefixo internacional "00" (ex: 0055...)
  if (digits.startsWith("00")) digits = digits.slice(2);

  // separa DDI (assumimos BR=55 quando ausente)
  let ddi = "";
  let rest = digits;
  if (rest.startsWith("55")) {
    ddi = "55";
    rest = rest.slice(2);
  } else {
    ddi = "55";
  }

  // alguns formatos vêm com um "0" sobrando antes do DDD: (088) 9xxxx-xxxx
  if (rest.length === 11 && rest.startsWith("0")) rest = rest.slice(1);
  if (rest.length > 11 && rest.startsWith("0")) rest = rest.replace(/^0+/, "");

  // remove eventual código de operadora (ex: 0 + 21 + DDD + número) mantendo os últimos 10/11 dígitos (DDD + número)
  if (rest.length > 11) {
    const last11 = rest.slice(-11);
    const num9 = last11.slice(2);
    rest = num9.length === 9 && num9.startsWith("9") ? last11 : rest.slice(-10);
  }

  // agora rest deve ser DDD(2) + número(8/9)
  if (rest.length !== 10 && rest.length !== 11) return ddi + rest;
  const ddd = rest.slice(0, 2);
  const number = rest.slice(2);
  if (!ddd || !number) return ddi + rest;

  return `${ddi}${ddd}${number}`;
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
  if (!cfg?.representative_schema?.table) {
    console.error(
      `[databaseB2b:representatives] diagnóstico config: company=${args.company} platform=${meta?.platformSlug ?? "?"} company_platform_id=${meta?.companyPlatformId ?? "?"}`,
    );
    console.error("[databaseB2b:representatives] resumo:", describeDatabaseB2bConfig(cfg));
    throw new Error("Config databaseB2b inválida: representative_schema.table ausente (configure o schema de representantes).");
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const repRepo = AppDataSource.getRepository(Representative);
  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);

  const schema = cfg.representative_schema;
  const fields = schema.fields ?? {};
  const table = schema.table;
  const requiredExternalId = schemaFieldName((fields as any).external_id).trim();
  if (!requiredExternalId) {
    throw new Error('Config databaseB2b inválida: representative_schema.fields.external_id ausente (mapeie "external_id").');
  }
  const lastProcessedAt = getDatabaseB2bLastProcessedAt(cfg, "representative_schema");
  const syncedAtCol = schemaFieldName((fields as any).synced_at);
  const createdAtMapping = (fields as any).created_at ?? (fields as any).createdAt;
  const supervisorLookupFieldRaw =
    fields.supervisor_id && typeof fields.supervisor_id === "object"
      ? String(
          ((fields.supervisor_id as any).options?.lookupField ?? (fields.supervisor_id as any).options?.lookup_field ?? "") as any,
        ).trim()
      : "";

  const REP_LOOKUP_COLUMN: Record<string, "external_id" | "internal_code" | "document" | "name" | "category"> = {
    external_id: "external_id",
    internal_code: "internal_code",
    document: "document",
    name: "name",
    category: "category", // compat configs antigas
  };
  const supervisorLookupColumn = (supervisorLookupFieldRaw === "tax_id" ? "document" : REP_LOOKUP_COLUMN[supervisorLookupFieldRaw]) ?? "external_id";

  const sourceCols = collectSourceColumnsFromMapping(fields as any);
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
    `[databaseB2b:representatives] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
      !args.force && syncedAtCol && lastProcessedAt ? "on" : "off"
    } force=${args.force ? "on" : "off"}`,
  );

  const ext = buildExternalClient(cfg);
  __stage = "connect_external_db";
  await ext.connect();
  try {
    let upserts = 0;
    let skippedMissingExternalId = 0;
    let duplicatedExternalIdInBatch = 0;
    let maxSyncedAt: Date | null = null;

    __stage = "count_external";
    let totalRows: number | null = null;
    try {
      console.log("[databaseB2b:representatives] contando linhas no banco do cliente...");
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
        `[databaseB2b:representatives] ${kind} fetched=${fetched}${denom != null ? `/${denom}` : ""} processed=${processed}${
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
        new Set(
          batch
            .map((r) => String(applyFieldMapping((fields as any).external_id, r) ?? "").trim())
            .filter((s) => s.length > 0),
        ),
      );

      __stage = "load_existing_representatives_batch";
      const existingByExternalId = new Map<string, Representative>();
      if (batchExternalIds.length) {
        const existing = await repRepo
          .createQueryBuilder("r")
          .where("r.company_id = :companyId", { companyId: company.id })
          .andWhere("r.external_id IN (:...ids)", { ids: batchExternalIds })
          .getMany();
        for (const rep of existing) {
          const key = String(rep.externalId ?? "").trim();
          if (key) existingByExternalId.set(key, rep);
        }
      }

      __stage = "transform_batch";
      const toSaveByExternal = new Map<string, Representative>();
      const supervisorByRepExternal = new Map<string, string>();
      const seenExternalIds = new Set<string>();

      for (const row of batch) {
        const externalId = String(applyFieldMapping((fields as any).external_id, row) ?? "").trim();
        if (!externalId) {
          skippedMissingExternalId += 1;
          continue;
        }

        if (seenExternalIds.has(externalId)) duplicatedExternalIdInBatch += 1;
        seenExternalIds.add(externalId);

        let rep = toSaveByExternal.get(externalId) ?? existingByExternalId.get(externalId) ?? null;
        if (!rep) rep = repRepo.create({ company, externalId, name: "" });

        rep.company = company;
        rep.externalId = externalId;
        rep.name = String(applyFieldMapping(fields.name, row) ?? rep.name ?? "").trim() || rep.name || "";
        rep.supervisor = toBoolLoose(applyFieldMapping(fields.supervisor, row)) ?? rep.supervisor ?? false;
        rep.state = (applyFieldMapping(fields.state, row) as any) ?? null;
        rep.city = (applyFieldMapping(fields.city, row) as any) ?? null;
        rep.document = (applyFieldMapping(fields.document, row) as any) ?? null;
        rep.email = (applyFieldMapping(fields.email, row) as any) ?? null;
        rep.phone = normalizeBrPhoneToE164Digits(applyFieldMapping(fields.phone, row)) ?? null;
        rep.zip = (applyFieldMapping(fields.zip, row) as any) ?? null;
        rep.address = (applyFieldMapping(fields.address, row) as any) ?? null;
        rep.number = (applyFieldMapping(fields.number, row) as any) ?? null;
        rep.complement = (applyFieldMapping(fields.complement, row) as any) ?? null;
        rep.neighborhood = (applyFieldMapping(fields.neighborhood, row) as any) ?? null;
        // Unificamos para manter apenas "document".
        // Compat: configs antigas podem vir com "tax_id" mapeado; nesse caso usamos como document.
        rep.document =
          (applyFieldMapping(fields.document, row) as any) ?? (applyFieldMapping((fields as any).tax_id, row) as any) ?? rep.document ?? null;
        rep.internalCode = (applyFieldMapping((fields as any).internal_code, row) as any) ?? rep.internalCode ?? null;
        rep.category = (applyFieldMapping(fields.category, row) as any) ?? null;
        rep.obs = (applyFieldMapping(fields.obs, row) as any) ?? null;
        rep.createdAt = parseDateOnlyLoose(applyFieldMapping(createdAtMapping, row)) ?? rep.createdAt ?? null;

        const supervisorExternal = String(applyFieldMapping(fields.supervisor_id, row) ?? "").trim();
        if (supervisorExternal) supervisorByRepExternal.set(externalId, supervisorExternal);
        else supervisorByRepExternal.delete(externalId);

        toSaveByExternal.set(externalId, rep);

        if (syncedAtCol) {
          const d = parseTimestamp(applyFieldMapping((fields as any).synced_at, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      __stage = "save_batch";
      const repsToSave = Array.from(toSaveByExternal.values());
      if (repsToSave.length) {
        const saved = await repRepo.save(repsToSave, { chunk: 250 });

        const supervisorKeys = Array.from(new Set(Array.from(supervisorByRepExternal.values()).filter(Boolean)));
        if (supervisorKeys.length) {
          __stage = "resolve_supervisors_batch";
          const qb = repRepo.createQueryBuilder("r").where("r.company_id = :companyId", { companyId: company.id });
          if (supervisorLookupColumn === "internal_code") {
            // compat: quando o cliente manda "1" e nosso internal_code está "0001"
            qb.andWhere("(r.internal_code IN (:...ids) OR ltrim(r.internal_code, '0') IN (:...ids))", { ids: supervisorKeys });
          } else {
            qb.andWhere(`r.${supervisorLookupColumn} IN (:...ids)`, { ids: supervisorKeys });
          }
          const supervisors = await qb.getMany();

          const supByExternal = new Map<string, Representative>();
          for (const s of supervisors) {
            const key =
              supervisorLookupColumn === "external_id"
                ? String(s.externalId ?? "").trim()
                : supervisorLookupColumn === "internal_code"
                  ? String((s as any).internalCode ?? "").trim()
                  : supervisorLookupColumn === "document"
                    ? String((s as any).document ?? "").trim()
                    : supervisorLookupColumn === "name"
                      ? String((s as any).name ?? "").trim()
                      : String((s as any).category ?? "").trim();
            if (key) {
              supByExternal.set(key, s);
              if (supervisorLookupColumn === "internal_code") {
                const noZeros = key.replace(/^0+/, "");
                if (noZeros) supByExternal.set(noZeros, s);
              }
            }
          }

          if (supervisorKeys.length && supByExternal.size === 0) {
            console.warn(
              `[databaseB2b:representatives] aviso: nenhum supervisor encontrado para supervisor_id via lookupField=${supervisorLookupColumn}. ` +
                `Exemplos keys=${supervisorKeys
                  .slice(0, 5)
                  .map((x) => JSON.stringify(String(x)))
                  .join(", ")} (total=${supervisorKeys.length}). ` +
                `Verifique se o campo mapeado em supervisor_id realmente contém o internal_code/document/etc do supervisor e se esse valor existe na tabela representatives.`,
            );
          }

          const updates: Representative[] = [];
          for (const rep of saved) {
            const repExternal = String(rep.externalId ?? "").trim();
            const supKey = supervisorByRepExternal.get(repExternal);
            if (!supKey) {
              if (rep.supervisorRef) {
                rep.supervisorRef = null;
                updates.push(rep);
              }
              continue;
            }
            const nextSup = supByExternal.get(supKey) ?? null;
            const curId = (rep.supervisorRef as any)?.id ?? null;
            const nextId = (nextSup as any)?.id ?? null;
            if (curId !== nextId) {
              rep.supervisorRef = nextSup;
              updates.push(rep);
            }
          }

          if (updates.length) await repRepo.save(updates, { chunk: 250 });
        }

        upserts += repsToSave.length;
        processed += repsToSave.length;
        logProgress("process");
      }

      if (batch.length < BATCH_SIZE) break;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "representative_schema", maxSyncedAt.toISOString());
    }

    console.log(
      `[databaseB2b:representatives] company=${args.company} reps_upserted=${upserts} skipped_missing_external_id=${skippedMissingExternalId} duplicated_external_id_in_batch=${duplicatedExternalIdInBatch}`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[databaseB2b:representatives] erro (stage=${__stage}):`, err);
  process.exit(1);
});
