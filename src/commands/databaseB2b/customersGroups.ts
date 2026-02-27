import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { CustomersGroup } from "../../entities/CustomersGroup.js";
import { parseCliKv, parseCompanyArg, quoteIdent } from "../../utils/cli.js";
import {
  loadDatabaseB2bCompanyPlatform,
  buildExternalClient,
  applyFieldMapping,
  schemaFieldName,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  parseTimestamp,
  describeDatabaseB2bConfig,
  collectSourceColumnsFromMapping,
} from "../../utils/databaseB2b.js";

let __stage = "init";

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

async function resetInternalDbConnection() {
  try {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  } catch {
    // ignore
  }
  await AppDataSource.initialize();
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
  if (!(cfg as any)?.customers_group_schema?.table) {
    console.error(
      `[databaseB2b:customersGroups] diagnóstico config: company=${args.company} platform=${meta?.platformSlug ?? "?"} company_platform_id=${meta?.companyPlatformId ?? "?"}`,
    );
    console.error("[databaseB2b:customersGroups] resumo:", describeDatabaseB2bConfig(cfg));
    throw new Error("Config databaseB2b inválida: customers_group_schema.table ausente (configure o schema de grupos).");
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);

  const groupRepo = AppDataSource.getRepository(CustomersGroup);

  const schema = (cfg as any).customers_group_schema as { table: string; fields?: Record<string, any> };
  const fields = (schema?.fields ?? {}) as Record<string, any>;
  const table = String(schema.table ?? "").trim();
  const requiredExternalId = schemaFieldName((fields as any).external_id).trim();
  if (!requiredExternalId)
    throw new Error('Config databaseB2b inválida: customers_group_schema.fields.external_id ausente (mapeie "external_id").');

  const lastProcessedAt = getDatabaseB2bLastProcessedAt(cfg, "customers_group_schema");
  const syncedAtCol = schemaFieldName((fields as any).synced_at).trim();

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
    `[databaseB2b:customersGroups] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
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
      if (!externalErrorLogged) {
        externalErrorLogged = true;
        console.warn("[databaseB2b:customersGroups] conexão externa caiu:", String(err?.message ?? err));
      }
    });
  };
  const reconnectExternal = async (reason: string) => {
    console.warn(`[databaseB2b:customersGroups] reconectando ao banco do cliente (${reason})...`);
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
    let skippedMissingExternalId = 0;
    let skippedMissingName = 0;
    let duplicatedExternalIdInBatch = 0;
    let duplicatedNameInBatch = 0;
    let skippedExternalIdConflicts = 0;
    let maxSyncedAt: Date | null = null;

    __stage = "count_external";
    let totalRows: number | null = null;
    try {
      console.log("[databaseB2b:customersGroups] contando linhas no banco do cliente...");
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
        `[databaseB2b:customersGroups] ${kind} fetched=${fetched}${denom != null ? `/${denom}` : ""} processed=${processed}${
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
      const batchNamesCi = Array.from(
        new Set(
          batch
            .map((r) => String(applyFieldMapping((fields as any).name, r) ?? "").trim())
            .filter(Boolean)
            .map((s) => s.toLowerCase()),
        ),
      );

      __stage = "load_existing_groups_batch";
      const existingByExternalId = new Map<string, CustomersGroup>();
      if (batchExternalIds.length) {
        for (const ids of chunkArray(batchExternalIds, 500)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const existing = await groupRepo
              .createQueryBuilder("g")
              .where("g.company_id = :companyId", { companyId: company.id })
              .andWhere("g.external_id IN (:...ids)", { ids })
              .getMany();
            for (const g of existing) {
              const key = String(g.externalId ?? "").trim();
              if (key) existingByExternalId.set(key, g);
            }
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customersGroups] conexão interna caiu; reiniciando e tentando novamente (existingByExternalId)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const groupRepoRetry = AppDataSource.getRepository(CustomersGroup);
              // eslint-disable-next-line no-await-in-loop
              const existing = await groupRepoRetry
                .createQueryBuilder("g")
                .where("g.company_id = :companyId", { companyId: company.id })
                .andWhere("g.external_id IN (:...ids)", { ids })
                .getMany();
              for (const g of existing) {
                const key = String(g.externalId ?? "").trim();
                if (key) existingByExternalId.set(key, g);
              }
              continue;
            }
            throw err;
          }
        }
      }

      const existingByNameCi = new Map<string, CustomersGroup>();
      if (batchNamesCi.length) {
        for (const names of chunkArray(batchNamesCi, 500)) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const existing = await groupRepo
              .createQueryBuilder("g")
              .where("g.company_id = :companyId", { companyId: company.id })
              .andWhere("lower(g.name) IN (:...names)", { names })
              .getMany();
            for (const g of existing) {
              const key = String(g.name ?? "").trim().toLowerCase();
              if (key) existingByNameCi.set(key, g);
            }
          } catch (err) {
            if (isConnectionTerminatedError(err)) {
              console.warn("[databaseB2b:customersGroups] conexão interna caiu; reiniciando e tentando novamente (existingByNameCi)...");
              // eslint-disable-next-line no-await-in-loop
              await resetInternalDbConnection();
              const groupRepoRetry = AppDataSource.getRepository(CustomersGroup);
              // eslint-disable-next-line no-await-in-loop
              const existing = await groupRepoRetry
                .createQueryBuilder("g")
                .where("g.company_id = :companyId", { companyId: company.id })
                .andWhere("lower(g.name) IN (:...names)", { names })
                .getMany();
              for (const g of existing) {
                const key = String(g.name ?? "").trim().toLowerCase();
                if (key) existingByNameCi.set(key, g);
              }
              continue;
            }
            throw err;
          }
        }
      }

      __stage = "transform_batch";
      // O banco tem a constraint customers_group_name_ci_unique (lower(name)).
      // Então, se o cliente tiver nomes repetidos, não podemos inserir 2 grupos com o mesmo nome.
      // Estratégia:
      // - primeiro tenta casar por external_id
      // - se não achar, tenta casar por name (case-insensitive) e atualizar o registro existente
      // - deduplica por name dentro do batch
      const toSaveByNameCi = new Map<string, CustomersGroup>();
      const seenExternalIds = new Set<string>();
      const seenNameCi = new Set<string>();

      for (const row of batch) {
        const externalId = String(applyFieldMapping((fields as any).external_id, row) ?? "").trim();
        if (!externalId) {
          skippedMissingExternalId += 1;
          continue;
        }
        if (seenExternalIds.has(externalId)) duplicatedExternalIdInBatch += 1;
        seenExternalIds.add(externalId);

        const name = String(applyFieldMapping((fields as any).name, row) ?? "").trim();
        if (!name) {
          skippedMissingName += 1;
          continue;
        }
        const nameCi = name.toLowerCase();
        if (seenNameCi.has(nameCi)) {
          duplicatedNameInBatch += 1;
          continue;
        }
        seenNameCi.add(nameCi);

        let group = existingByExternalId.get(externalId) ?? existingByNameCi.get(nameCi) ?? null;
        if (!group) group = groupRepo.create({ company, externalId, name });

        group.company = company;
        const curExternal = String(group.externalId ?? "").trim();
        if (!curExternal) group.externalId = externalId;
        else if (curExternal !== externalId) skippedExternalIdConflicts += 1;
        group.name = name;

        toSaveByNameCi.set(nameCi, group);

        if (syncedAtCol) {
          const d = parseTimestamp(applyFieldMapping((fields as any).synced_at, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      __stage = "save_batch";
      const toSave = Array.from(toSaveByNameCi.values());
      if (toSave.length) {
        await groupRepo.save(toSave, { chunk: 500 });
        upserts += toSave.length;
        processed += toSave.length;
        logProgress("process");
      }

      if (batch.length < BATCH_SIZE) break;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "customers_group_schema", maxSyncedAt.toISOString());
    }

    console.log(
      `[databaseB2b:customersGroups] company=${args.company} groups_upserted=${upserts} skipped_missing_external_id=${skippedMissingExternalId} skipped_missing_name=${skippedMissingName} duplicated_external_id_in_batch=${duplicatedExternalIdInBatch} duplicated_name_in_batch=${duplicatedNameInBatch} skipped_external_id_conflicts=${skippedExternalIdConflicts}`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[databaseB2b:customersGroups] erro (stage=${__stage}):`, err);
  process.exit(1);
});

