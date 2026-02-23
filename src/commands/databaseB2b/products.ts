import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Product } from "../../entities/Product.js";
import { parseCliKv, parseCompanyArg, quoteIdent } from "../../utils/cli.js";
import {
  loadDatabaseB2bCompanyPlatform,
  buildExternalClient,
  applyFieldMapping,
  toBoolLoose,
  isObj,
  schemaFieldTreatment,
  schemaFieldOptions,
  applyLimpezaRegex,
  parseTimestamp,
  schemaFieldName,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  describeDatabaseB2bConfig,
} from "../../utils/databaseB2b.js";

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
  if (!cfg?.products_schema?.table) {
    console.error(
      `[databaseB2b:products] diagnóstico config: company=${args.company} platform=${meta?.platformSlug ?? "?"} company_platform_id=${meta?.companyPlatformId ?? "?"}`,
    );
    console.error("[databaseB2b:products] resumo:", describeDatabaseB2bConfig(cfg));
    throw new Error("Config databaseB2b inválida: products_schema.table ausente (configure o schema de produtos).");
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const productRepo = AppDataSource.getRepository(Product);
  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);

  const schema = cfg.products_schema;
  const fields = schema.fields ?? {};
  const table = schema.table;
  const requiredExternalId = schemaFieldName((fields as any).external_id).trim();
  if (!requiredExternalId) throw new Error('Config databaseB2b inválida: products_schema.fields.external_id ausente (mapeie "external_id").');
  const lastProcessedAt = getDatabaseB2bLastProcessedAt(cfg, "products_schema");
  const syncedAtCol = schemaFieldName((fields as any).synced_at);

  console.log(
    `[databaseB2b:products] iniciado company=${args.company} platform=${meta?.platformSlug ?? "?"} table=${table} incremental=${
      syncedAtCol && lastProcessedAt ? "on" : "off"
    }`,
  );

  const sourceCols = new Set<string>();
  for (const v of Object.values(fields)) {
    if (typeof v === "string") {
      const col = v.trim();
      if (col) sourceCols.add(col);
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const tratamento = String((v as any).tratamento ?? "").trim();
    const field = String((v as any).field ?? "").trim();
    const opt = (v as any).options;

    const looksLikeColumn = (s: string) => Boolean(s) && !s.startsWith("/") && !s.includes("{") && !s.includes(",") && !s.includes("??");

    if (!tratamento) {
      if (looksLikeColumn(field)) sourceCols.add(field);
      continue;
    }

    if (tratamento === "mapear_valores") {
      if (looksLikeColumn(field)) sourceCols.add(field);
      continue;
    }

    if (tratamento === "limpeza_regex") {
      // configs antigas salvavam field como "/regex/g" (preview). Preferimos options.sourceField.
      if (isObj(opt)) {
        const src = String((opt as any).sourceField ?? (opt as any).source_field ?? (opt as any).source ?? "").trim();
        if (looksLikeColumn(src)) sourceCols.add(src);
      }
      if (looksLikeColumn(field)) sourceCols.add(field);
      continue;
    }

    if (tratamento === "mapear_json") {
      if (isObj(opt)) {
        const map = (opt as any).map;
        if (isObj(map)) Object.values(map).forEach((x) => (String(x ?? "").trim() ? sourceCols.add(String(x ?? "").trim()) : null));
      }
      continue;
    }

    if (tratamento === "concatenar_campos" && isObj(opt)) {
      const tpl = String((opt as any).concatenate ?? "");
      tpl.replace(/\{([^}]+)\}/g, (_, f) => {
        const key = String(f ?? "").trim();
        if (key) sourceCols.add(key);
        return "";
      });
      continue;
    }

    if (tratamento === "usar_um_ou_outro" && isObj(opt)) {
      const main = String((opt as any).main ?? "").trim();
      const fallback = String((opt as any).fallback ?? "").trim();
      if (looksLikeColumn(main)) sourceCols.add(main);
      if (looksLikeColumn(fallback)) sourceCols.add(fallback);
      continue;
    }

    if (tratamento === "diferenca_entre_datas" && isObj(opt)) {
      const start = String((opt as any).start ?? "").trim();
      const end = String((opt as any).end ?? "").trim();
      if (looksLikeColumn(start)) sourceCols.add(start);
      if (looksLikeColumn(end)) sourceCols.add(end);
      continue;
    }
  }

  // garante que colunas essenciais estejam no SELECT
  if (requiredExternalId) sourceCols.add(requiredExternalId);
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
  const ext = buildExternalClient(cfg);
  __stage = "connect_external_db";
  await ext.connect();
  try {
    let upserts = 0;
    let skippedMissingExternalId = 0;
    let skippedMissingSku = 0;
    let skippedExternalIdConflicts = 0;
    let duplicatedExternalIdInBatch = 0;
    let duplicatedSkuInBatch = 0;
    let duplicatedSkuExamplesShown = 0;
    let maxSyncedAt: Date | null = null;

    __stage = "count_external";
    let totalRows: number | null = null;
    try {
      console.log("[databaseB2b:products] contando linhas no banco do cliente...");
      const resCount = await ext.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}${whereSql}`, params);
      const cRaw = resCount.rows?.[0]?.c;
      const n = Number(cRaw);
      if (Number.isFinite(n) && n >= 0) totalRows = n;
    } catch {
      // se COUNT for caro ou falhar, seguimos sem percentual
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
      const pct = denom && denom > 0 ? Math.min(100, Math.round(((kind === "fetch" ? fetched : processed) / denom) * 100)) : null;
      const pctTxt = pct == null ? "" : ` (${pct}%)`;
      const elapsed = Math.round((now - startedAt) / 1000);
      console.log(
        `[databaseB2b:products] ${kind} fetched=${fetched}${denom != null ? `/${denom}` : ""} processed=${processed}${denom != null ? `/${denom}` : ""}${pctTxt} elapsed=${elapsed}s`,
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

      // Pré-carrega existentes (1 query por batch em vez de 1 por linha)
      const batchExternalIds = Array.from(
        new Set(
          batch
            .map((r) => String(applyFieldMapping((fields as any).external_id, r) ?? "").trim())
            .filter((s) => s.length > 0),
        ),
      );
      const batchSkus = Array.from(
        new Set(batch.map((r) => String(applyFieldMapping(fields.sku, r) ?? "").trim()).filter((s) => s.length > 0)),
      );

      __stage = "load_existing_products_batch";
      const existingByExternalId = new Map<string, Product>();
      if (batchExternalIds.length) {
        const existing = await productRepo
          .createQueryBuilder("p")
          .where("p.company_id = :companyId", { companyId: company.id })
          .andWhere("p.external_id IN (:...ids)", { ids: batchExternalIds })
          .getMany();
        existing.forEach((p) => {
          const k = String(p.externalId ?? "").trim();
          if (k) existingByExternalId.set(k, p);
        });
      }

      const existingBySku = new Map<string, Product>();
      if (batchSkus.length) {
        const existingSku = await productRepo
          .createQueryBuilder("p")
          .where("p.company_id = :companyId", { companyId: company.id })
          .andWhere("p.sku IN (:...skus)", { skus: batchSkus })
          .getMany();
        existingSku.forEach((p) => {
          const k = String(p.sku ?? "").trim();
          if (k) existingBySku.set(k, p);
        });
      }

      __stage = "transform_batch";
      // IMPORTANT: nosso banco tem unique (company_id, sku). Então garantimos 1 registro por SKU por batch.
      const toSaveBySku = new Map<string, Product>();
      const seenSkuToExternalId = new Map<string, string>();
      const duplicatedSkuExamples: Array<{ sku: string; externalId: string }> = [];
      const seenExternalIdsInBatch = new Set<string>();

      for (const row of batch) {
        const externalId = String(applyFieldMapping((fields as any).external_id, row) ?? "").trim();
        if (!externalId) {
          skippedMissingExternalId += 1;
          continue;
        }

        const sku = String(applyFieldMapping(fields.sku, row) ?? "").trim();
        if (!sku) {
          skippedMissingSku += 1;
          continue;
        }

        if (seenExternalIdsInBatch.has(externalId)) {
          duplicatedExternalIdInBatch += 1;
        }
        seenExternalIdsInBatch.add(externalId);

        const prevExternalForSku = seenSkuToExternalId.get(sku);
        if (prevExternalForSku && prevExternalForSku !== externalId) {
          duplicatedSkuInBatch += 1;
          if (duplicatedSkuExamples.length < 5) duplicatedSkuExamples.push({ sku, externalId });
          continue;
        }
        if (!prevExternalForSku) seenSkuToExternalId.set(sku, externalId);

        // 1) tenta achar por external_id (chave principal)
        let product = existingByExternalId.get(externalId) ?? null;
        // 2) se não achou, tenta achar por SKU (porque SKU é único no nosso banco)
        if (!product) product = existingBySku.get(sku) ?? null;
        // 3) se ainda não, cria novo
        if (!product) product = productRepo.create({ company, sku, active: true, manualAttributesLocked: false });

        product.company = company;
        // Não sobrescreve externalId se já existir um diferente para o mesmo SKU (mantém vínculo legado).
        const currentExternal = String(product.externalId ?? "").trim();
        if (!currentExternal) product.externalId = externalId;
        else if (currentExternal !== externalId) skippedExternalIdConflicts += 1;
        product.sku = sku;
        const ecommerceIdRaw = applyFieldMapping(fields.ecommerce_id, row);
        product.ecommerceId = ecommerceIdRaw == null || String(ecommerceIdRaw).trim() === "" ? null : Number(ecommerceIdRaw);
        if (product.ecommerceId != null && !Number.isFinite(product.ecommerceId)) product.ecommerceId = null;

        product.ean = (applyFieldMapping(fields.ean, row) as any) ?? product.ean ?? null;
        product.slug = (applyFieldMapping(fields.slug, row) as any) ?? product.slug ?? null;
        const nameMapped = applyFieldMapping(fields.name, row);
        if (nameMapped != null) {
          product.name = nameMapped as any;
        } else {
          // Compat: configs antigas do front salvavam `field` como preview ("/regex/g"), perdendo a coluna de origem.
          // Quando isso acontecer, tentamos aplicar a limpeza em cima do `model` (se existir).
          const tratamento = schemaFieldTreatment(fields.name as any);
          const opt = schemaFieldOptions(fields.name as any);
          if (tratamento === "limpeza_regex" && opt) {
            const base = applyFieldMapping(fields.model, row);
            const cleaned = applyLimpezaRegex(base, opt);
            if (cleaned != null) product.name = cleaned;
          }
          product.name = product.name ?? null;
        }
        product.storeReference = (applyFieldMapping(fields.store_reference, row) as any) ?? product.storeReference ?? null;
        product.externalReference = (applyFieldMapping(fields.external_reference, row) as any) ?? product.externalReference ?? null;
        const brandIdRaw = applyFieldMapping(fields.brand_id, row);
        product.brandId = brandIdRaw == null || String(brandIdRaw).trim() === "" ? null : Number(brandIdRaw);
        if (product.brandId != null && !Number.isFinite(product.brandId)) product.brandId = null;
        product.brand = (applyFieldMapping(fields.brand, row) as any) ?? product.brand ?? null;
        product.model = (applyFieldMapping(fields.model, row) as any) ?? product.model ?? null;
        product.category = (applyFieldMapping(fields.category, row) as any) ?? product.category ?? null;
        const categoryIdRaw = applyFieldMapping(fields.category_id, row);
        product.categoryId = categoryIdRaw == null || String(categoryIdRaw).trim() === "" ? null : Number(categoryIdRaw);
        if (product.categoryId != null && !Number.isFinite(product.categoryId)) product.categoryId = null;
        product.subcategory = (applyFieldMapping(fields.subcategory, row) as any) ?? product.subcategory ?? null;
        product.finalCategory = (applyFieldMapping(fields.final_category, row) as any) ?? product.finalCategory ?? null;
        product.weight = (applyFieldMapping(fields.weight, row) as any) ?? product.weight ?? null;
        product.width = (applyFieldMapping(fields.width, row) as any) ?? product.width ?? null;
        product.height = (applyFieldMapping(fields.height, row) as any) ?? product.height ?? null;
        product.lengthCm = (applyFieldMapping((fields as any).lenght, row) as any) ?? product.lengthCm ?? null;
        product.ncm = (applyFieldMapping(fields.ncm, row) as any) ?? product.ncm ?? null;
        product.photo = (applyFieldMapping(fields.photo, row) as any) ?? product.photo ?? null;
        product.url = (applyFieldMapping(fields.url, row) as any) ?? product.url ?? null;

        const active = toBoolLoose(applyFieldMapping(fields.active, row));
        if (active != null) product.active = active;

        toSaveBySku.set(sku, product);

        if (syncedAtCol) {
          const d = parseTimestamp(applyFieldMapping((fields as any).synced_at, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      __stage = "save_batch";
      if (duplicatedSkuInBatch && duplicatedSkuExamples.length) {
        duplicatedSkuExamplesShown += duplicatedSkuExamples.length;
        console.warn(
          `[databaseB2b:products] aviso: SKUs duplicados no banco do cliente dentro do mesmo batch (isso conflita com unique company+sku). Exemplos: ${duplicatedSkuExamples
            .map((e) => `${e.sku}(external_id=${e.externalId})`)
            .join(", ")}`,
        );
      }

      const toSave = Array.from(toSaveBySku.values());
      if (toSave.length) {
        await productRepo.save(toSave, { chunk: 250 });
        upserts += toSave.length;
        processed += toSave.length;
        logProgress("process");
      }

      if (batch.length < BATCH_SIZE) break;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "products_schema", maxSyncedAt.toISOString());
    }
    console.log(
      `[databaseB2b:products] company=${args.company} products_upserted=${upserts} skipped_missing_external_id=${skippedMissingExternalId} skipped_missing_sku=${skippedMissingSku} duplicated_external_id_in_batch=${duplicatedExternalIdInBatch} duplicated_sku_in_batch=${duplicatedSkuInBatch} skipped_external_id_conflicts=${skippedExternalIdConflicts}`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[databaseB2b:products] erro (stage=${__stage}):`, err);
  process.exit(1);
});

