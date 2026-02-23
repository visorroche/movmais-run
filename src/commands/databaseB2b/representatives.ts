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

  const sourceCols = collectSourceColumnsFromMapping(fields as any);
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
    `[databaseB2b:representatives] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
      syncedAtCol && lastProcessedAt ? "on" : "off"
    }`,
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
        rep.phone = (applyFieldMapping(fields.phone, row) as any) ?? null;
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

        const supervisorExternalIds = Array.from(new Set(Array.from(supervisorByRepExternal.values()).filter(Boolean)));
        if (supervisorExternalIds.length) {
          __stage = "resolve_supervisors_batch";
          const supervisors = await repRepo
            .createQueryBuilder("r")
            .where("r.company_id = :companyId", { companyId: company.id })
            .andWhere("r.external_id IN (:...ids)", { ids: supervisorExternalIds })
            .getMany();

          const supByExternal = new Map<string, Representative>();
          for (const s of supervisors) {
            const key = String(s.externalId ?? "").trim();
            if (key) supByExternal.set(key, s);
          }

          const updates: Representative[] = [];
          for (const rep of saved) {
            const repExternal = String(rep.externalId ?? "").trim();
            const supExternal = supervisorByRepExternal.get(repExternal);
            if (!supExternal) {
              if (rep.supervisorRef) {
                rep.supervisorRef = null;
                updates.push(rep);
              }
              continue;
            }
            const nextSup = supByExternal.get(supExternal) ?? null;
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
