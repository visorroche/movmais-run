import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Customer } from "../../entities/Customer.js";
import { Representative } from "../../entities/Representative.js";
import { Product } from "../../entities/Product.js";
import { Plataform } from "../../entities/Plataform.js";
import { parseOrdersRangeArgs, quoteIdent } from "../../utils/cli.js";
import {
  loadDatabaseB2bCompanyPlatform,
  buildExternalClient,
  queryExternalBatched,
  applyFieldMapping,
  parseYmd,
  parseTimestamp,
  schemaFieldName,
  isObj,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  describeDatabaseB2bConfig,
} from "../../utils/databaseB2b.js";

function toIntLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function main() {
  const args = parseOrdersRangeArgs(process.argv.slice(2));
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();

  const meta = await loadDatabaseB2bCompanyPlatform(args.company);
  const cfg = meta?.config ?? null;
  if (!cfg) throw new Error("Config databaseB2b inválida: company_platforms.config ausente/ilegível.");
  if (!cfg?.orders_schema?.table) {
    console.error(
      `[databaseB2b:orders] diagnóstico config: company=${args.company} platform=${meta?.platformSlug ?? "?"} company_platform_id=${meta?.companyPlatformId ?? "?"}`,
    );
    console.error("[databaseB2b:orders] resumo:", describeDatabaseB2bConfig(cfg));
    throw new Error("Config databaseB2b inválida: orders_schema.table ausente (configure o schema de pedidos).");
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const customerRepo = AppDataSource.getRepository(Customer);
  const repRepo = AppDataSource.getRepository(Representative);
  const productRepo = AppDataSource.getRepository(Product);
  const platformRepo = AppDataSource.getRepository(Plataform);

  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);
  const platform =
    (await platformRepo.findOne({ where: { slug: "b2b_database" } })) ??
    (await platformRepo.findOne({ where: { slug: "database_b2b" } })) ??
    (await platformRepo.findOne({ where: { slug: "databaseb2b" } })) ??
    (await platformRepo.findOne({ where: { slug: "databaseB2b" } })) ??
    null;

  const schema = cfg.orders_schema;
  const orderFields = schema.orderFields ?? {};
  const itemFields = schema.orderItemFields ?? {};

  const table = schema.table;
  const singleTable = Boolean(schema.singleTable);
  const lastProcessedAt = getDatabaseB2bLastProcessedAt(cfg, "orders_schema");
  const syncedAtCol = schemaFieldName((orderFields as any).synced_at) || schemaFieldName((itemFields as any).synced_at) || "";
  const syncedAtMapping: any = (orderFields as any).synced_at ?? (itemFields as any).synced_at;
  const orderExternalIdCol = schemaFieldName((orderFields as any).external_id);
  const requiredOrderExternalId = schemaFieldName((orderFields as any).external_id).trim();
  const requiredItemExternalId = schemaFieldName((itemFields as any).external_id).trim();
  if (!requiredOrderExternalId) throw new Error('Config databaseB2b inválida: orders_schema.orderFields.external_id ausente (mapeie "external_id").');
  if (!requiredItemExternalId) throw new Error('Config databaseB2b inválida: orders_schema.orderItemFields.external_id ausente (mapeie "external_id" nos itens).');

  const sourceCols = new Set<string>();
  const collectFrom = (mapping: Record<string, any>) => {
    for (const [target, v] of Object.entries(mapping)) {
      if (typeof v === "string") {
        const col = v.trim();
        if (!col) continue;
        sourceCols.add(col);
        continue;
      }
      if (!v || typeof v !== "object") continue;
      const opt = (v as any).options;
      const tratamento = String((v as any).tratamento ?? "").trim();
      const field = String((v as any).field ?? "").trim();

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
  };

  collectFrom(orderFields);
  collectFrom(itemFields);

  // Para filtrar por data, precisamos saber o nome da coluna do order_date
  const orderDateCol = schemaFieldName(orderFields.order_date);
  const whereParts: string[] = [];
  const params: any[] = [];
  if (orderDateCol && args.startDate) {
    params.push(args.startDate);
    whereParts.push(`${quoteIdent(orderDateCol)} >= $${params.length}`);
  }
  if (orderDateCol && args.endDate) {
    params.push(args.endDate);
    whereParts.push(`${quoteIdent(orderDateCol)} <= $${params.length}`);
  }
  const dateWhereSql = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";

  const colsSql = sourceCols.size ? Array.from(sourceCols).map(quoteIdent).join(", ") : "*";

  const ext = buildExternalClient(cfg);
  await ext.connect();
  try {
    let rows: Record<string, any>[] = [];

    // Incremental com segurança: primeiro seleciona order_codes alterados e depois busca TODAS as linhas desses pedidos,
    // senão perderíamos itens não-alterados (pois o script substitui itens por pedido).
    if (syncedAtCol && lastProcessedAt && orderExternalIdCol) {
      const paramsChanged = params.slice();
      paramsChanged.push(lastProcessedAt.toISOString());
      const changedWhereParts = whereParts.slice();
      changedWhereParts.push(`${quoteIdent(syncedAtCol)} > $${paramsChanged.length}`);
      const changedWhereSql = changedWhereParts.length ? ` WHERE ${changedWhereParts.join(" AND ")}` : "";

      const sqlChanged = `SELECT DISTINCT ${quoteIdent(orderExternalIdCol)} AS external_id FROM ${quoteIdent(table)}${changedWhereSql}`;
      const changedRows = await queryExternalBatched<{ external_id: any }>(ext, sqlChanged, paramsChanged, 5000);
      const changedExternalIds = Array.from(
        new Set(changedRows.map((r) => String((r as any).external_id ?? "").trim()).filter((s) => s.length > 0)),
      );

      if (changedExternalIds.length === 0) {
        const range = args.startDate || args.endDate ? ` range=${args.startDate ?? ""}..${args.endDate ?? ""}` : "";
        console.log(`[databaseB2b:orders] company=${args.company}${range} orders_processed=0 items_processed=0 skipped_existing=0`);
        return;
      }

      const CHUNK = 500;
      for (let i = 0; i < changedExternalIds.length; i += CHUNK) {
        const chunk = changedExternalIds.slice(i, i + CHUNK);
        const p: any[] = [chunk];
        const parts: string[] = [`${quoteIdent(orderExternalIdCol)} = ANY($1::text[])`];
        if (orderDateCol && args.startDate) {
          p.push(args.startDate);
          parts.push(`${quoteIdent(orderDateCol)} >= $${p.length}`);
        }
        if (orderDateCol && args.endDate) {
          p.push(args.endDate);
          parts.push(`${quoteIdent(orderDateCol)} <= $${p.length}`);
        }
        // eslint-disable-next-line no-await-in-loop
        const res = await ext.query(`SELECT ${colsSql} FROM ${quoteIdent(table)} WHERE ${parts.join(" AND ")}`, p);
        rows.push(...(res.rows ?? []));
      }
    } else {
      const sql = `SELECT ${colsSql} FROM ${quoteIdent(table)}${dateWhereSql}`;
      rows = await queryExternalBatched<Record<string, any>>(ext, sql, params, 5000);
    }

    const repCache = new Map<string, Representative | null>();
    const customerCache = new Map<string, Customer | null>();
    const productCache = new Map<string, Product | null>();

    const getRepByExternal = async (externalId: string) => {
      const key = externalId.trim();
      if (!key) return null;
      if (repCache.has(key)) return repCache.get(key)!;
      const rep = await repRepo.findOne({ where: { company: { id: company.id }, externalId: key } as any });
      repCache.set(key, rep ?? null);
      return rep ?? null;
    };
    const getCustomerByExternal = async (externalId: string) => {
      const key = externalId.trim();
      if (!key) return null;
      if (customerCache.has(key)) return customerCache.get(key)!;
      const customer = await customerRepo.findOne({ where: { company: { id: company.id }, externalId: key } as any });
      customerCache.set(key, customer ?? null);
      return customer ?? null;
    };
    const getProductBySku = async (sku: number) => {
      const key = String(sku);
      if (productCache.has(key)) return productCache.get(key)!;
      const product = await productRepo.findOne({ where: { company: { id: company.id }, sku: key } as any });
      productCache.set(key, product ?? null);
      return product ?? null;
    };

    const groups = new Map<string, Record<string, any>[]>();
    for (const row of rows) {
      const externalId = String(applyFieldMapping((orderFields as any).external_id, row) ?? "").trim();
      if (!externalId) continue;
      const list = groups.get(externalId) ?? [];
      list.push(row);
      groups.set(externalId, list);
    }

    let processedOrders = 0;
    let processedItems = 0;
    let skippedExisting = 0;
    let maxSyncedAt: Date | null = null;

    for (const [orderExternalId, orderRows] of groups.entries()) {
      const first = orderRows[0]!;

      const orderCode = toIntLoose(applyFieldMapping(orderFields.order_code, first));
      if (!orderCode) continue;

      let order = await orderRepo.findOne({ where: { company: { id: company.id }, externalId: orderExternalId } as any });
      if (args.onlyInsert && order) {
        skippedExisting += 1;
        continue;
      }
      if (!order) {
        // compat: tenta achar por orderCode (se existirem registros antigos antes do external_id)
        const legacy = await orderRepo.findOne({ where: { company: { id: company.id }, orderCode } as any });
        order = legacy ?? orderRepo.create({ company, orderCode });
      }

      order.company = company;
      if (platform) order.platform = platform;
      order.externalId = orderExternalId;
      order.orderCode = orderCode;
      order.orderDate = parseTimestamp(applyFieldMapping(orderFields.order_date, first)) ?? order.orderDate ?? null;
      order.paymentDate = parseYmd(applyFieldMapping(orderFields.payment_date, first)) ?? (order.paymentDate as any) ?? null;
      order.deliveryDate = parseYmd(applyFieldMapping(orderFields.delivery_date, first)) ?? (order.deliveryDate as any) ?? null;
      order.deliveryDays = toIntLoose(applyFieldMapping(orderFields.delivery_days, first)) ?? order.deliveryDays ?? null;
      order.discountCoupon = (applyFieldMapping(orderFields.discount_coupon, first) as any) ?? order.discountCoupon ?? null;
      order.totalDiscount = (applyFieldMapping(orderFields.total_discount, first) as any) ?? order.totalDiscount ?? null;
      order.shippingAmount = (applyFieldMapping(orderFields.shipping_amount, first) as any) ?? order.shippingAmount ?? null;
      order.totalAmount = (applyFieldMapping(orderFields.total_amount, first) as any) ?? order.totalAmount ?? null;
      order.currentStatus = (applyFieldMapping(orderFields.current_status, first) as any) ?? order.currentStatus ?? null;
      order.currentStatusCode = (applyFieldMapping(orderFields.current_status_code, first) as any) ?? order.currentStatusCode ?? null;

      order.deliveryState = (applyFieldMapping(orderFields.delivery_state, first) as any) ?? order.deliveryState ?? null;
      order.deliveryCity = (applyFieldMapping(orderFields.delivery_city, first) as any) ?? order.deliveryCity ?? null;
      order.deliveryNeighborhood = (applyFieldMapping(orderFields.delivery_neighborhood, first) as any) ?? order.deliveryNeighborhood ?? null;
      order.deliveryZip = (applyFieldMapping(orderFields.delivery_zip, first) as any) ?? order.deliveryZip ?? null;
      order.deliveryNumber = (applyFieldMapping(orderFields.delivery_number, first) as any) ?? order.deliveryNumber ?? null;
      order.deliveryAddress = (applyFieldMapping(orderFields.delivery_address, first) as any) ?? order.deliveryAddress ?? null;
      order.deliveryComplement = (applyFieldMapping(orderFields.delivery_complement, first) as any) ?? order.deliveryComplement ?? null;

      // metadata só quando NÃO for tabela única (no modo singleTable, metadata fica apenas nos itens)
      if (!singleTable) order.metadata = (applyFieldMapping(orderFields.metadata, first) as any) ?? order.metadata ?? null;

      const customerExternal = String(applyFieldMapping(orderFields.customer_id, first) ?? "").trim();
      if (customerExternal) {
        const customer = await getCustomerByExternal(customerExternal);
        if (customer) order.customer = customer;
      }

      const repExternal = String(applyFieldMapping(orderFields.representative_id, first) ?? "").trim();
      if (repExternal) {
        order.representative = (await getRepByExternal(repExternal)) ?? null;
      }
      const assistantExternal = String(applyFieldMapping(orderFields.assistant_id, first) ?? "").trim();
      if (assistantExternal) {
        (order as any).assistant = (await getRepByExternal(assistantExternal)) ?? null;
      }
      const supervisorExternal = String(applyFieldMapping(orderFields.supervisor_id, first) ?? "").trim();
      if (supervisorExternal) {
        (order as any).supervisor = (await getRepByExternal(supervisorExternal)) ?? null;
      }

      order = await orderRepo.save(order);

      // itens: upsert por external_id (e remove os que sumiram)
      const incomingItemExternalIds: string[] = [];

      for (const row of orderRows) {
        const itemExternalId = String(applyFieldMapping((itemFields as any).external_id, row) ?? "").trim();
        if (!itemExternalId) continue;
        incomingItemExternalIds.push(itemExternalId);

        const sku = toIntLoose(applyFieldMapping(itemFields.sku, row));
        if (!sku) continue;
        const product = await getProductBySku(sku);

        let item = await itemRepo.findOne({ where: { company: { id: company.id }, externalId: itemExternalId } as any });
        if (!item) item = itemRepo.create({ company, order, externalId: itemExternalId });

        item.company = company;
        item.order = order;
        item.externalId = itemExternalId;
        item.sku = sku;
        item.product = product ?? null;
        item.unitPrice = (applyFieldMapping(itemFields.unit_price, row) as any) ?? null;
        item.netUnitPrice = (applyFieldMapping(itemFields.net_unit_price, row) as any) ?? null;
        item.quantity = toIntLoose(applyFieldMapping(itemFields.quantity, row)) ?? null;
        item.itemType = (applyFieldMapping(itemFields.item_type, row) as any) ?? null;
        item.serviceRefSku = (applyFieldMapping(itemFields.service_ref_sku, row) as any) ?? null;
        item.comission = (applyFieldMapping(itemFields.comission, row) as any) ?? item.comission;
        item.assistantComission = (applyFieldMapping(itemFields.assistant_comission, row) as any) ?? null;
        item.supervisorComission = (applyFieldMapping(itemFields.supervisor_comission, row) as any) ?? null;
        item.metadata = (applyFieldMapping(itemFields.metadata, row) as any) ?? null;

        await itemRepo.save(item);
        processedItems += 1;

        if (syncedAtMapping) {
          const d = parseTimestamp(applyFieldMapping(syncedAtMapping, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      const uniqueIncoming = Array.from(new Set(incomingItemExternalIds)).filter(Boolean);
      if (uniqueIncoming.length) {
        await itemRepo
          .createQueryBuilder()
          .delete()
          .where("order_id = :orderId", { orderId: order.id })
          .andWhere("external_id IS NOT NULL")
          .andWhere("external_id NOT IN (:...ids)", { ids: uniqueIncoming })
          .execute();
      } else {
        await itemRepo
          .createQueryBuilder()
          .delete()
          .where("order_id = :orderId", { orderId: order.id })
          .execute();
      }

      processedOrders += 1;
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "orders_schema", maxSyncedAt.toISOString());
    }
    const range = args.startDate || args.endDate ? ` range=${args.startDate ?? ""}..${args.endDate ?? ""}` : "";
    const onlyInsertLog = args.onlyInsert ? " onlyInsert=true" : "";
    console.log(
      `[databaseB2b:orders] company=${args.company}${range} orders_processed=${processedOrders} items_processed=${processedItems} skipped_existing=${skippedExisting}${onlyInsertLog}`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[databaseB2b:orders] erro:", err);
  process.exit(1);
});

