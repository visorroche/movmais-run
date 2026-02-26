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
  applyFieldMapping,
  parseYmd,
  parseTimestamp,
  schemaFieldName,
  getDatabaseB2bLastProcessedAt,
  updateDatabaseB2bLastProcessedAt,
  describeDatabaseB2bConfig,
  collectSourceColumnsFromMapping,
} from "../../utils/databaseB2b.js";

function toIntLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNumberLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (!raw) return null;

  // remove símbolos e mantém dígitos/separadores
  let s = raw.replace(/[^\d.,-]+/g, "");
  if (!s) return null;

  // normaliza separador decimal
  if (s.includes(",") && s.includes(".")) {
    // assume "." milhar e "," decimal
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(/,/g, ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNumericStringFixed(v: unknown, scale: number): string | null {
  const n = toNumberLoose(v);
  if (n == null) return null;
  const p = 10 ** Math.max(0, Math.min(8, Math.trunc(scale)));
  const rounded = Math.round(n * p) / p;
  return rounded.toFixed(scale);
}

function parseDateOnlyLoose(value: unknown): string | null {
  const ymd = parseYmd(value);
  if (ymd) return ymd;
  const ts = parseTimestamp(value);
  return ts ? ts.toISOString().slice(0, 10) : null;
}

type CustomerLookupField = "external_id" | "internal_cod" | "tax_id" | "email";
type RepresentativeLookupField = "external_id" | "internal_code" | "document" | "name" | "category";
type ProductLookupField = "external_id" | "sku" | "ean";

function normalizeCustomerLookupField(v: unknown): CustomerLookupField {
  const s = String(v ?? "").trim();
  if (s === "internal_cod" || s === "tax_id" || s === "email") return s;
  return "external_id";
}

function normalizeRepresentativeLookupField(v: unknown): RepresentativeLookupField {
  const s = String(v ?? "").trim();
  // compat (configs antigas)
  if (s === "tax_id") return "document";
  if (s === "internal_code" || s === "document" || s === "name" || s === "category") return s;
  return "external_id";
}

function normalizeProductLookupField(v: unknown): ProductLookupField {
  const s = String(v ?? "").trim();
  if (s === "sku" || s === "ean") return s;
  return "external_id";
}

function getMappingLookupField(mapping: any, fallback: string): string {
  if (!mapping || typeof mapping !== "object") return fallback;
  const opt = (mapping as any).options;
  if (!opt || typeof opt !== "object") return fallback;
  const lf = (opt as any).lookupField;
  const s = String(lf ?? "").trim();
  return s || fallback;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function unionStrings(...sets: Array<Set<string>>): string[] {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return Array.from(out);
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

function isConnectionTerminatedError(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  const drv = String((err as any)?.driverError?.message ?? "");
  return msg.includes("Connection terminated unexpectedly") || drv.includes("Connection terminated unexpectedly");
}

function isQueryReadTimeoutError(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  const drv = String((err as any)?.driverError?.message ?? "");
  return msg.includes("Query read timeout") || drv.includes("Query read timeout");
}

function isDuplicateOrderCodeError(err: unknown) {
  const code = String((err as any)?.driverError?.code ?? (err as any)?.code ?? "");
  const constraint = String((err as any)?.driverError?.constraint ?? "");
  const detail = String((err as any)?.driverError?.detail ?? "");
  return code === "23505" && (constraint === "UQ_orders_company_id_order_code" || detail.includes("UQ_orders_company_id_order_code"));
}

async function main() {
  __stage = "parse_args";
  const argv = process.argv.slice(2);
  const parsed = parseOrdersRangeArgs(argv);
  const force =
    argv.includes("--force") ||
    argv.some((a) => {
      if (!a.startsWith("--force=")) return false;
      const v = a.slice("--force=".length).trim();
      return v !== "" && v !== "false";
    });
  const args = { ...parsed, force };
  const startedAt = Date.now();
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();

  __stage = "load_config";
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
  const customerRepo = AppDataSource.getRepository(Customer);
  const repRepo = AppDataSource.getRepository(Representative);
  const productRepo = AppDataSource.getRepository(Product);
  const platformRepo = AppDataSource.getRepository(Plataform);

  __stage = "load_company";
  const company = await companyRepo.findOne({ where: { id: args.company } });
  if (!company) throw new Error(`Company ${args.company} não encontrada.`);
  const platform =
    (await platformRepo.findOne({ where: { slug: "b2b_database" } })) ??
    (await platformRepo.findOne({ where: { slug: "database_b2b" } })) ??
    (await platformRepo.findOne({ where: { slug: "databaseb2b" } })) ??
    (await platformRepo.findOne({ where: { slug: "databaseB2b" } })) ??
    null;

  __stage = "prepare_schema";
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

  const sourceCols = collectSourceColumnsFromMapping(orderFields as any);
  collectSourceColumnsFromMapping(itemFields as any, sourceCols);
  sourceCols.add(requiredOrderExternalId);
  sourceCols.add(requiredItemExternalId);
  if (syncedAtCol) sourceCols.add(syncedAtCol);

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

  const range = args.startDate || args.endDate ? ` range=${args.startDate ?? ""}..${args.endDate ?? ""}` : "";
  const onlyInsertLog = args.onlyInsert ? " onlyInsert=true" : "";
  console.log(
    `[databaseB2b:orders] iniciado company=${args.company}${range}${onlyInsertLog} platform=${meta?.platformSlug ?? "?"} table=${table} singleTable=${
      singleTable ? "true" : "false"
    } incremental=${!args.force && syncedAtCol && lastProcessedAt ? "on" : "off"} force=${args.force ? "on" : "off"}`,
  );

  let ext = buildExternalClient(cfg);
  const attachExternalErrorHandler = () => {
    // Importante: sem listener de 'error', o Node derruba o processo (Unhandled 'error' event)
    ext.on("error", (err: any) => {
      console.warn("[databaseB2b:orders] conexão externa caiu:", String(err?.message ?? err));
    });
  };
  const reconnectExternal = async (reason: string) => {
    console.warn(`[databaseB2b:orders] reconectando ao banco do cliente (${reason})...`);
    try {
      await ext.end().catch(() => {});
    } catch {
      // ignore
    }
    ext = buildExternalClient(cfg);
    attachExternalErrorHandler();
    __stage = "connect_external_db";
    await ext.connect();
  };
  const externalQuery = async (sql: string, params: any[]) => {
    try {
      return await ext.query(sql, params);
    } catch (err) {
      if (isConnectionTerminatedError(err)) {
        await reconnectExternal("query_failed");
        return await ext.query(sql, params);
      }
      throw err;
    }
  };

  attachExternalErrorHandler();
  __stage = "connect_external_db";
  await ext.connect();
  try {
    let rows: Record<string, any>[] = [];

    // Sempre buscar por intervalo de datas (order_date). synced_at NÃO filtra o fetch:
    // - Insert: se não temos o pedido, sempre inserir.
    // - Update: só atualizar se synced_at do cliente for maior que lastProcessedAt (evita sobrescrever com dado antigo).
    __stage = "fetch_external";
    let expectedRowCount: number | null = null;
    try {
      const resCount = await externalQuery(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}${dateWhereSql}`, params);
      const cRaw = (resCount.rows ?? [])?.[0]?.c;
      const n = Number(cRaw);
      if (Number.isFinite(n) && n >= 0) expectedRowCount = n;
    } catch {
      expectedRowCount = null;
    }

    const BATCH_SIZE = 5000;
    let fetched = 0;
    let lastFetchLogAt = 0;
    const logFetch = () => {
      const now = Date.now();
      if (now - lastFetchLogAt < 1500) return;
      lastFetchLogAt = now;
      const pct = expectedRowCount && expectedRowCount > 0 ? Math.min(100, Math.round((fetched / expectedRowCount) * 100)) : null;
      const pctTxt = pct == null ? "" : ` (${pct}%)`;
      const elapsed = Math.round((now - startedAt) / 1000);
      console.log(
        `[databaseB2b:orders] fetch rows=${fetched}${expectedRowCount != null ? `/${expectedRowCount}` : ""}${pctTxt} elapsed=${elapsed}s`,
      );
    };

    const sqlBase = `SELECT ${colsSql} FROM ${quoteIdent(table)}${dateWhereSql}`;
    for (let offset = 0; ; offset += BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      const res = await externalQuery(`${sqlBase} LIMIT ${BATCH_SIZE} OFFSET ${offset}`, params);
      const batch = (res.rows ?? []) as Record<string, any>[];
      rows.push(...batch);
      fetched += batch.length;
      logFetch();
      if (batch.length < BATCH_SIZE) break;
    }

    __stage = "group_rows";
    const groups = new Map<string, Record<string, any>[]>();
    for (const row of rows) {
      const externalId = String(applyFieldMapping((orderFields as any).external_id, row) ?? "").trim();
      if (!externalId) continue;
      const list = groups.get(externalId) ?? [];
      list.push(row);
      groups.set(externalId, list);
    }

    const totalOrders = groups.size;
    const totalRows = rows.length;
    console.log(`[databaseB2b:orders] carregado do cliente rows=${totalRows} orders=${totalOrders}`);

    // Vinculações (customer / representatives) via lookupField configurável no front
    const customerLookupField = normalizeCustomerLookupField(getMappingLookupField((orderFields as any).customer_id, "external_id"));
    const repLookupField = normalizeRepresentativeLookupField(getMappingLookupField((orderFields as any).representative_id, "external_id"));
    const assistantLookupField = normalizeRepresentativeLookupField(getMappingLookupField((orderFields as any).assistant_id, "external_id"));
    const supervisorLookupField = normalizeRepresentativeLookupField(getMappingLookupField((orderFields as any).supervisor_id, "external_id"));
    const productLookupField = normalizeProductLookupField(getMappingLookupField((itemFields as any).product_id, "external_id"));

    const customerLookupVals = new Set<string>();
    const repLookupVals = new Set<string>();
    const assistantLookupVals = new Set<string>();
    const supervisorLookupVals = new Set<string>();
    const productLookupVals = new Set<string>();
    const skuVals = new Set<string>();
    const orderCodes = new Map<string, number>();

    for (const [, orderRows] of groups.entries()) {
      const first = orderRows[0];
      if (!first) continue;
      const orderCode = toIntLoose(applyFieldMapping(orderFields.order_code, first));
      if (orderCode) orderCodes.set(String(applyFieldMapping((orderFields as any).external_id, first) ?? "").trim(), orderCode);
      const customerKey = String(applyFieldMapping(orderFields.customer_id, first) ?? "").trim();
      if (customerKey) customerLookupVals.add(customerKey);

      const repKey = String(applyFieldMapping(orderFields.representative_id, first) ?? "").trim();
      if (repKey) repLookupVals.add(repKey);

      const assistantKey = String(applyFieldMapping(orderFields.assistant_id, first) ?? "").trim();
      if (assistantKey) assistantLookupVals.add(assistantKey);

      const supervisorKey = String(applyFieldMapping(orderFields.supervisor_id, first) ?? "").trim();
      if (supervisorKey) supervisorLookupVals.add(supervisorKey);
    }

    for (const [, orderRows] of groups.entries()) {
      for (const row of orderRows) {
        const productKey = String(applyFieldMapping((itemFields as any).product_id, row) ?? "").trim();
        if (productKey) productLookupVals.add(productKey);
        const sku = toIntLoose(applyFieldMapping(itemFields.sku, row));
        if (sku) skuVals.add(String(sku));
      }
    }

    const customerColSql: Record<CustomerLookupField, string> = {
      external_id: "external_id",
      internal_cod: "internal_cod",
      tax_id: "tax_id",
      email: "email",
    };
    const repColSql: Record<RepresentativeLookupField, string> = {
      external_id: "external_id",
      internal_code: "internal_code",
      document: "document",
      name: "name",
      category: "category",
    };

    const productColSql: Record<ProductLookupField, string> = {
      external_id: "external_id",
      sku: "sku",
      ean: "ean",
    };

    __stage = "load_lookup_tables";
    const fetchCustomersByLookup = async (vals: string[]) => {
      const out = new Map<string, Customer>();
      const col = customerColSql[customerLookupField];
      for (const ids of chunk(vals, 200)) {
        let list: Customer[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(Customer)
            .createQueryBuilder("c")
            .where("c.company_id = :companyId", { companyId: company.id })
            .andWhere(`c.${col} IN (:...ids)`, { ids })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (customers lookup)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(Customer)
              .createQueryBuilder("c")
              .where("c.company_id = :companyId", { companyId: company.id })
              .andWhere(`c.${col} IN (:...ids)`, { ids })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const c of list) {
          const key =
            customerLookupField === "external_id"
              ? String((c as any).externalId ?? "").trim()
              : customerLookupField === "internal_cod"
                ? String((c as any).internalCod ?? "").trim()
                : customerLookupField === "tax_id"
                  ? String((c as any).taxId ?? "").trim()
                  : String((c as any).email ?? "").trim();
          if (key) out.set(key, c);
        }
      }
      return out;
    };

    const fetchRepsByLookup = async (lookupField: RepresentativeLookupField, vals: string[]) => {
      const out = new Map<string, Representative>();
      const col = repColSql[lookupField];
      for (const ids of chunk(vals, 200)) {
        let list: Representative[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          {
            const qb = AppDataSource.getRepository(Representative).createQueryBuilder("r").where("r.company_id = :companyId", { companyId: company.id });
            if (lookupField === "internal_code") {
              // compat: cliente manda "1" e nosso internal_code está "0001"
              qb.andWhere("(r.internal_code IN (:...ids) OR ltrim(r.internal_code, '0') IN (:...ids))", { ids });
            } else {
              qb.andWhere(`r.${col} IN (:...ids)`, { ids });
            }
            list = await qb.getMany();
          }
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (reps lookup)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            {
              const qb = AppDataSource.getRepository(Representative).createQueryBuilder("r").where("r.company_id = :companyId", { companyId: company.id });
              if (lookupField === "internal_code") {
                qb.andWhere("(r.internal_code IN (:...ids) OR ltrim(r.internal_code, '0') IN (:...ids))", { ids });
              } else {
                qb.andWhere(`r.${col} IN (:...ids)`, { ids });
              }
              list = await qb.getMany();
            }
          } else {
            throw err;
          }
        }
        for (const r of list) {
          const key =
            lookupField === "external_id"
              ? String((r as any).externalId ?? "").trim()
              : lookupField === "internal_code"
                ? String((r as any).internalCode ?? "").trim()
                : lookupField === "document"
                  ? String((r as any).document ?? "").trim()
                  : lookupField === "name"
                    ? String((r as any).name ?? "").trim()
                    : String((r as any).category ?? "").trim();
          if (key) {
            out.set(key, r);
            if (lookupField === "internal_code") {
              const noZeros = key.replace(/^0+/, "");
              if (noZeros) out.set(noZeros, r);
            }
          }
        }
      }
      return out;
    };

    const fetchProductsByLookup = async (vals: string[]) => {
      const out = new Map<string, Product>();
      const col = productColSql[productLookupField];
      for (const ids of chunk(vals, 500)) {
        let list: Product[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(Product)
            .createQueryBuilder("p")
            .where("p.company_id = :companyId", { companyId: company.id })
            .andWhere(`p.${col} IN (:...ids)`, { ids })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (products lookup)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(Product)
              .createQueryBuilder("p")
              .where("p.company_id = :companyId", { companyId: company.id })
              .andWhere(`p.${col} IN (:...ids)`, { ids })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const p of list) {
          const key =
            productLookupField === "external_id"
              ? String((p as any).externalId ?? "").trim()
              : productLookupField === "sku"
                ? String((p as any).sku ?? "").trim()
                : String((p as any).ean ?? "").trim();
          if (key) out.set(key, p);
        }
      }
      return out;
    };

    const fetchProductsBySku = async (vals: string[]) => {
      const out = new Map<string, Product>();
      for (const ids of chunk(vals, 500)) {
        let list: Product[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(Product)
            .createQueryBuilder("p")
            .where("p.company_id = :companyId", { companyId: company.id })
            .andWhere("p.sku IN (:...ids)", { ids })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (productsBySku)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(Product)
              .createQueryBuilder("p")
              .where("p.company_id = :companyId", { companyId: company.id })
              .andWhere("p.sku IN (:...ids)", { ids })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const p of list) {
          const key = String((p as any).sku ?? "").trim();
          if (key) out.set(key, p);
        }
      }
      return out;
    };

    const customersByLookup = await fetchCustomersByLookup(Array.from(customerLookupVals));

    // Importante: mesmo lookupField pode ter conjuntos de chaves diferentes (rep vs assistant vs supervisor).
    // Então buscamos por FIELD + união das chaves que usam esse FIELD.
    const repMapByField = new Map<RepresentativeLookupField, Map<string, Representative>>();
    const getRepsMap = async (field: RepresentativeLookupField) => {
      const cached = repMapByField.get(field);
      if (cached) return cached;
      const keys =
        field === repLookupField && field === assistantLookupField && field === supervisorLookupField
          ? unionStrings(repLookupVals, assistantLookupVals, supervisorLookupVals)
          : field === repLookupField && field === assistantLookupField
            ? unionStrings(repLookupVals, assistantLookupVals)
            : field === repLookupField && field === supervisorLookupField
              ? unionStrings(repLookupVals, supervisorLookupVals)
              : field === assistantLookupField && field === supervisorLookupField
                ? unionStrings(assistantLookupVals, supervisorLookupVals)
                : field === repLookupField
                  ? Array.from(repLookupVals)
                  : field === assistantLookupField
                    ? Array.from(assistantLookupVals)
                    : Array.from(supervisorLookupVals);
      const map = await fetchRepsByLookup(field, keys);
      repMapByField.set(field, map);
      return map;
    };

    const repsByLookup = await getRepsMap(repLookupField);
    const assistantsByLookup = await getRepsMap(assistantLookupField);
    const supervisorsByLookup = await getRepsMap(supervisorLookupField);
    const productsByLookup = await fetchProductsByLookup(Array.from(productLookupVals));
    const productsBySku = await fetchProductsBySku(Array.from(skuVals));

    // A partir daqui, use repositórios "fresh" (podemos ter dado reset na conexão acima)
    let orderRepoNow = AppDataSource.getRepository(Order);
    let itemRepoNow = AppDataSource.getRepository(OrderItem);
    const resetInternalDbConnectionAndRepos = async () => {
      await resetInternalDbConnection();
      orderRepoNow = AppDataSource.getRepository(Order);
      itemRepoNow = AppDataSource.getRepository(OrderItem);
    };

    const orderExternalIds = Array.from(groups.keys());
    const existingOrdersByExternalId = new Map<string, Order>();
    if (orderExternalIds.length) {
      __stage = "load_existing_orders_by_external_id";
      for (const ids of chunk(orderExternalIds, 200)) {
        let list: Order[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(Order)
            .createQueryBuilder("o")
            .where("o.company_id = :companyId", { companyId: company.id })
            .andWhere("o.external_id IN (:...ids)", { ids })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (orders by external_id)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(Order)
              .createQueryBuilder("o")
              .where("o.company_id = :companyId", { companyId: company.id })
              .andWhere("o.external_id IN (:...ids)", { ids })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const o of list) {
          const key = String((o as any).externalId ?? "").trim();
          if (key) existingOrdersByExternalId.set(key, o);
        }
      }
    }

    const legacyOrdersByOrderCode = new Map<number, Order>();
    const orderCodesList = Array.from(new Set(Array.from(orderCodes.values())));
    if (orderCodesList.length) {
      __stage = "load_legacy_orders_by_order_code";
      for (const codes of chunk(orderCodesList, 500)) {
        let list: Order[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(Order)
            .createQueryBuilder("o")
            .where("o.company_id = :companyId", { companyId: company.id })
            .andWhere("o.order_code IN (:...codes)", { codes })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (orders by order_code)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(Order)
              .createQueryBuilder("o")
              .where("o.company_id = :companyId", { companyId: company.id })
              .andWhere("o.order_code IN (:...codes)", { codes })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const o of list) {
          const code = Number((o as any).orderCode ?? (o as any).order_code ?? NaN);
          if (Number.isFinite(code)) legacyOrdersByOrderCode.set(code, o);
        }
      }
    }

    const incomingItemExternalIds = Array.from(
      new Set(
        rows
          .map((r) => String(applyFieldMapping((itemFields as any).external_id, r) ?? "").trim())
          .filter((s) => s.length > 0),
      ),
    );
    const existingItemsByExternalId = new Map<string, OrderItem>();
    if (incomingItemExternalIds.length) {
      __stage = "load_existing_items_by_external_id";
      for (const ids of chunk(incomingItemExternalIds, 500)) {
        let list: OrderItem[] = [];
        try {
          // eslint-disable-next-line no-await-in-loop
          list = await AppDataSource.getRepository(OrderItem)
            .createQueryBuilder("i")
            .where("i.company_id = :companyId", { companyId: company.id })
            .andWhere("i.external_id IN (:...ids)", { ids })
            .getMany();
        } catch (err) {
          if (isConnectionTerminatedError(err)) {
            console.warn("[databaseB2b:orders] conexão interna caiu; reiniciando e tentando novamente (items by external_id)...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnection();
            // eslint-disable-next-line no-await-in-loop
            list = await AppDataSource.getRepository(OrderItem)
              .createQueryBuilder("i")
              .where("i.company_id = :companyId", { companyId: company.id })
              .andWhere("i.external_id IN (:...ids)", { ids })
              .getMany();
          } else {
            throw err;
          }
        }
        for (const it of list) {
          const key = String((it as any).externalId ?? "").trim();
          if (key) existingItemsByExternalId.set(key, it);
        }
      }
    }

    let processedOrders = 0;
    let processedItems = 0;
    let skippedExisting = 0;
    let maxSyncedAt: Date | null = null;
    let lastCompletedSyncedAt: Date | null = null;
    let lastLogAt = 0;
    let lastCheckpointAt = 0;
    const logProgress = () => {
      const now = Date.now();
      if (now - lastLogAt < 1500) return;
      lastLogAt = now;
      const pct = totalOrders ? Math.min(100, Math.round((processedOrders / totalOrders) * 100)) : 100;
      const elapsed = Math.round((now - startedAt) / 1000);
      console.log(
        `[databaseB2b:orders] process orders=${processedOrders}/${totalOrders} (${pct}%) items=${processedItems} skipped_existing=${skippedExisting} elapsed=${elapsed}s`,
      );
    };

    const maybeCheckpoint = async () => {
      if (!syncedAtCol) return;
      if (!lastCompletedSyncedAt) return;
      const now = Date.now();
      if (now - lastCheckpointAt < 30_000 && processedOrders % 200 !== 0) return;
      lastCheckpointAt = now;
      try {
        await updateDatabaseB2bLastProcessedAt(args.company, "orders_schema", lastCompletedSyncedAt.toISOString());
        console.log(`[databaseB2b:orders] checkpoint last_processed_at=${lastCompletedSyncedAt.toISOString()}`);
      } catch (err) {
        console.warn("[databaseB2b:orders] falha ao salvar checkpoint last_processed_at:", String((err as any)?.message ?? err));
      }
    };

    __stage = "process_groups";
    const entries = Array.from(groups.entries()).map(([orderExternalId, orderRows]) => {
      let groupSyncedAt: Date | null = null;
      if (syncedAtMapping) {
        for (const row of orderRows) {
          const d = parseTimestamp(applyFieldMapping(syncedAtMapping, row));
          if (d && (!groupSyncedAt || d.getTime() > groupSyncedAt.getTime())) groupSyncedAt = d;
        }
      }
      return { orderExternalId, orderRows, groupSyncedAt };
    });
    entries.sort((a, b) => (a.groupSyncedAt?.getTime() ?? 0) - (b.groupSyncedAt?.getTime() ?? 0));

    const loadOrderByOrderCode = async (orderCode: number): Promise<Order | null> => {
      try {
        return await orderRepoNow.findOne({ where: { company: { id: company.id }, orderCode } as any });
      } catch (err) {
        if (isConnectionTerminatedError(err) || isQueryReadTimeoutError(err)) {
          await resetInternalDbConnectionAndRepos();
          return await orderRepoNow.findOne({ where: { company: { id: company.id }, orderCode } as any });
        }
        throw err;
      }
    };

    for (const { orderExternalId, orderRows, groupSyncedAt } of entries) {
      const first = orderRows[0]!;

      const orderCode = toIntLoose(applyFieldMapping(orderFields.order_code, first));
      if (!orderCode) continue;

      const existing = existingOrdersByExternalId.get(orderExternalId) ?? null;
      let legacy = legacyOrdersByOrderCode.get(orderCode) ?? null;
      if (!legacy) {
        // fallback (garante upsert mesmo se o preload por order_code falhar)
        // eslint-disable-next-line no-await-in-loop
        legacy = await loadOrderByOrderCode(orderCode);
        if (legacy) legacyOrdersByOrderCode.set(orderCode, legacy);
      }
      if (args.onlyInsert && (existing || legacy)) {
        skippedExisting += 1;
        continue;
      }
      // Update só quando synced_at do cliente for mais recente; insert sempre.
      if ((existing || legacy) && lastProcessedAt && groupSyncedAt && groupSyncedAt.getTime() <= lastProcessedAt.getTime()) {
        skippedExisting += 1;
        continue;
      }
      let order = existing ?? legacy ?? orderRepoNow.create({ company, orderCode });

      order.company = company;
      if (platform) order.platform = platform;
      order.channel = "offline";
      order.externalId = orderExternalId;
      order.orderCode = orderCode;
      order.orderDate = parseTimestamp(applyFieldMapping(orderFields.order_date, first)) ?? order.orderDate ?? null;
      order.paymentDate = parseDateOnlyLoose(applyFieldMapping(orderFields.payment_date, first)) ?? (order.paymentDate as any) ?? null;
      order.deliveryDate = parseDateOnlyLoose(applyFieldMapping(orderFields.delivery_date, first)) ?? (order.deliveryDate as any) ?? null;
      order.deliveryDays = toIntLoose(applyFieldMapping(orderFields.delivery_days, first)) ?? order.deliveryDays ?? null;
      order.discountCoupon = (applyFieldMapping(orderFields.discount_coupon, first) as any) ?? order.discountCoupon ?? null;
      order.totalDiscount = (applyFieldMapping(orderFields.total_discount, first) as any) ?? order.totalDiscount ?? null;
      order.shippingAmount = (applyFieldMapping(orderFields.shipping_amount, first) as any) ?? order.shippingAmount ?? null;

      const hasTotalAmountMapping = Boolean(schemaFieldName((orderFields as any).total_amount).trim());
      if (hasTotalAmountMapping) {
        order.totalAmount = (applyFieldMapping(orderFields.total_amount, first) as any) ?? order.totalAmount ?? null;
      } else {
        let sum = 0;
        let used = 0;
        for (const r of orderRows) {
          const q = toIntLoose(applyFieldMapping(itemFields.quantity, r));
          const pRaw = applyFieldMapping(itemFields.unit_price, r);
          const p = toNumberLoose(pRaw);
          if (q == null || p == null) continue;
          // arredonda unit_price como salvamos no item (2 casas) para evitar divergência
          const p2 = Math.round(p * 100) / 100;
          sum += q * p2;
          used += 1;
        }
        if (used > 0) order.totalAmount = sum.toFixed(2);
      }
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

      const customerKey = String(applyFieldMapping(orderFields.customer_id, first) ?? "").trim();
      if (customerKey) {
        const customer = customersByLookup.get(customerKey) ?? null;
        if (customer) order.customer = customer;
      }

      const repKey = String(applyFieldMapping(orderFields.representative_id, first) ?? "").trim();
      if (repKey) order.representative = repsByLookup.get(repKey) ?? null;

      const assistantKey = String(applyFieldMapping(orderFields.assistant_id, first) ?? "").trim();
      if (assistantKey) (order as any).assistant = assistantsByLookup.get(assistantKey) ?? null;

      const supervisorKey = String(applyFieldMapping(orderFields.supervisor_id, first) ?? "").trim();
      if (supervisorKey) (order as any).supervisor = supervisorsByLookup.get(supervisorKey) ?? null;

      try {
        // eslint-disable-next-line no-await-in-loop
        order = await orderRepoNow.save(order);
      } catch (err) {
        if (isDuplicateOrderCodeError(err)) {
          console.warn(
            `[databaseB2b:orders] conflito UQ_orders_company_id_order_code (order_code=${orderCode}). Tentando recuperar registro existente e atualizar...`,
          );
          // eslint-disable-next-line no-await-in-loop
          const recovered = await loadOrderByOrderCode(orderCode);
          if (recovered) {
            // garante update e não insert
            (order as any).id = (recovered as any).id;
            // eslint-disable-next-line no-await-in-loop
            order = await orderRepoNow.save(order);
          } else {
            throw err;
          }
        } else
        if (isConnectionTerminatedError(err) || isQueryReadTimeoutError(err)) {
          console.warn("[databaseB2b:orders] erro ao salvar order; reiniciando conexão interna e tentando novamente...");
          // eslint-disable-next-line no-await-in-loop
          await resetInternalDbConnectionAndRepos();
          // eslint-disable-next-line no-await-in-loop
          order = await orderRepoNow.save(order);
        } else {
          throw err;
        }
      }
      existingOrdersByExternalId.set(orderExternalId, order);
      if (groupSyncedAt) {
        lastCompletedSyncedAt = groupSyncedAt;
        if (!maxSyncedAt || groupSyncedAt.getTime() > maxSyncedAt.getTime()) maxSyncedAt = groupSyncedAt;
      }

      // itens: upsert por external_id (e remove os que sumiram)
      const incomingItemExternalIdsPerOrder: string[] = [];
      const itemsToSaveByExternalId = new Map<string, OrderItem>();
      const hasItemTypeMapping = Boolean(schemaFieldName(itemFields.item_type).trim());

      for (const row of orderRows) {
        const itemExternalId = String(applyFieldMapping((itemFields as any).external_id, row) ?? "").trim();
        if (!itemExternalId) continue;
        incomingItemExternalIdsPerOrder.push(itemExternalId);

        const productKey = String(applyFieldMapping((itemFields as any).product_id, row) ?? "").trim();
        const productByKey = productKey ? productsByLookup.get(productKey) ?? null : null;

        const sku = toIntLoose(applyFieldMapping(itemFields.sku, row));
        const product = productByKey ?? (sku ? productsBySku.get(String(sku)) ?? null : null);

        const existingItem = existingItemsByExternalId.get(itemExternalId) ?? null;
        const item = existingItem ?? itemRepoNow.create({ company, order, externalId: itemExternalId });
        existingItemsByExternalId.set(itemExternalId, item);

        item.company = company;
        item.order = order;
        item.externalId = itemExternalId;
        item.sku = sku ?? null;
        item.product = product ?? null;
        item.unitPrice = toNumericStringFixed(applyFieldMapping(itemFields.unit_price, row), 2);
        item.netUnitPrice = toNumericStringFixed(applyFieldMapping(itemFields.net_unit_price, row), 2);
        item.quantity = toIntLoose(applyFieldMapping(itemFields.quantity, row)) ?? null;
        item.itemType = hasItemTypeMapping ? ((applyFieldMapping(itemFields.item_type, row) as any) ?? null) : "produto";
        item.serviceRefSku = (applyFieldMapping(itemFields.service_ref_sku, row) as any) ?? null;
        item.comission = (applyFieldMapping(itemFields.comission, row) as any) ?? "0";
        item.assistantComission = (applyFieldMapping(itemFields.assistant_comission, row) as any) ?? "0";
        item.supervisorComission = (applyFieldMapping(itemFields.supervisor_comission, row) as any) ?? "0";
        item.metadata = (applyFieldMapping(itemFields.metadata, row) as any) ?? null;
        itemsToSaveByExternalId.set(itemExternalId, item);

        if (syncedAtMapping) {
          const d = parseTimestamp(applyFieldMapping(syncedAtMapping, row));
          if (d && (!maxSyncedAt || d.getTime() > maxSyncedAt.getTime())) maxSyncedAt = d;
        }
      }

      const itemsToSave = Array.from(itemsToSaveByExternalId.values());
      if (itemsToSave.length) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await itemRepoNow.save(itemsToSave, { chunk: 250 });
        } catch (err) {
          if (isConnectionTerminatedError(err) || isQueryReadTimeoutError(err)) {
            console.warn("[databaseB2b:orders] erro ao salvar itens; reiniciando conexão interna e tentando novamente...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnectionAndRepos();
            // eslint-disable-next-line no-await-in-loop
            await itemRepoNow.save(itemsToSave, { chunk: 250 });
          } else {
            throw err;
          }
        }
        processedItems += itemsToSave.length;
      }

      const uniqueIncoming = Array.from(new Set(incomingItemExternalIdsPerOrder)).filter(Boolean);
      if (uniqueIncoming.length) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await itemRepoNow
            .createQueryBuilder()
            .delete()
            .where("order_id = :orderId", { orderId: order.id })
            .andWhere("external_id IS NOT NULL")
            .andWhere("external_id NOT IN (:...ids)", { ids: uniqueIncoming })
            .execute();
        } catch (err) {
          if (isConnectionTerminatedError(err) || isQueryReadTimeoutError(err)) {
            console.warn("[databaseB2b:orders] erro ao limpar itens antigos; reiniciando conexão interna e tentando novamente...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnectionAndRepos();
            // eslint-disable-next-line no-await-in-loop
            await itemRepoNow
              .createQueryBuilder()
              .delete()
              .where("order_id = :orderId", { orderId: order.id })
              .andWhere("external_id IS NOT NULL")
              .andWhere("external_id NOT IN (:...ids)", { ids: uniqueIncoming })
              .execute();
          } else {
            throw err;
          }
        }
      } else {
        try {
          // eslint-disable-next-line no-await-in-loop
          await itemRepoNow
            .createQueryBuilder()
            .delete()
            .where("order_id = :orderId", { orderId: order.id })
            .execute();
        } catch (err) {
          if (isConnectionTerminatedError(err) || isQueryReadTimeoutError(err)) {
            console.warn("[databaseB2b:orders] erro ao limpar itens; reiniciando conexão interna e tentando novamente...");
            // eslint-disable-next-line no-await-in-loop
            await resetInternalDbConnectionAndRepos();
            // eslint-disable-next-line no-await-in-loop
            await itemRepoNow
              .createQueryBuilder()
              .delete()
              .where("order_id = :orderId", { orderId: order.id })
              .execute();
          } else {
            throw err;
          }
        }
      }

      processedOrders += 1;
      logProgress();
      // eslint-disable-next-line no-await-in-loop
      await maybeCheckpoint();
    }

    if (maxSyncedAt) {
      await updateDatabaseB2bLastProcessedAt(args.company, "orders_schema", maxSyncedAt.toISOString());
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `[databaseB2b:orders] concluído company=${args.company}${range} orders_processed=${processedOrders} items_processed=${processedItems} skipped_existing=${skippedExisting}${onlyInsertLog} elapsed=${elapsed}s`,
    );
  } finally {
    await ext.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[databaseB2b:orders] erro:", err, "stage=", __stage);
  process.exit(1);
});

