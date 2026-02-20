import "dotenv/config";
import "reflect-metadata";

import { In } from "typeorm";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Customer } from "../../entities/Customer.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Product } from "../../entities/Product.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";
import { mapAnymarketStatus, isOrderStatus } from "../../utils/status/index.js";
import { toPersonType } from "../../utils/person-type.js";

const IS_TTY = Boolean(process.stdout.isTTY);

function renderProgress(line: string) {
  if (IS_TTY) {
    const padded = line.length < 140 ? line.padEnd(140, " ") : line;
    process.stdout.write(`\r${padded}`);
  } else {
    console.log(line);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function ensureArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumericString(v: number | string | null): string | null {
  if (v === null) return null;
  const s = typeof v === "number" ? String(v) : String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function formatYmdUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDateYmd(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Data inválida: ${date}. Use YYYY-MM-DD.`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function clampEndByMaxDaysInclusive(start: Date, end: Date, maxDaysInclusive: number): Date {
  // Ex.: maxDaysInclusive=7 -> start..start+6
  const maxEnd = addDaysUtc(start, Math.max(0, maxDaysInclusive - 1));
  return end.getTime() <= maxEnd.getTime() ? end : maxEnd;
}

function splitRangeIntoChunksYmd(startYmd: string, endYmd: string, maxDaysInclusive: number): Array<{ startYmd: string; endYmd: string }> {
  let s = parseIsoDateYmd(startYmd);
  let e = parseIsoDateYmd(endYmd);
  if (e.getTime() < s.getTime()) {
    const tmp = s;
    s = e;
    e = tmp;
  }

  const out: Array<{ startYmd: string; endYmd: string }> = [];
  let cur = s;
  while (cur.getTime() <= e.getTime()) {
    const chunkEnd = clampEndByMaxDaysInclusive(cur, e, maxDaysInclusive);
    out.push({ startYmd: formatYmdUtc(cur), endYmd: formatYmdUtc(chunkEnd) });
    cur = addDaysUtc(chunkEnd, 1);
  }
  return out;
}

function yesterdayUtc(): string {
  const now = new Date();
  const y = addDaysUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -1);
  return formatYmdUtc(y);
}

function todayUtc(): string {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return formatYmdUtc(t);
}

function ymdToAnyMarketStartSp(ymd: string): string {
  // AnyMarket aceita offset -03:00 no query param
  return `${ymd}T00:00:00-03:00`;
}
function ymdToAnyMarketEndSp(ymd: string): string {
  return `${ymd}T23:59:59-03:00`;
}

function normalizeCpfCnpj(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;
  return digits.length ? digits : null;
}

function datePartFromIso(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function parseAnyMarketDate(v: string | null): Date | null {
  if (!v) return null;
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffDaysUtc(fromYmd: string | null, toYmd: string | null): number | null {
  if (!fromYmd || !toYmd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return null;
  const from = new Date(`${fromYmd}T00:00:00.000Z`).getTime();
  const to = new Date(`${toYmd}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const diff = Math.round((to - from) / (24 * 60 * 60 * 1000));
  return Number.isFinite(diff) ? diff : null;
}

function isTransientFetchError(err: unknown): boolean {
  const e = err as any;
  const code = e?.code ?? e?.cause?.code;
  const msg = String(e?.message ?? "");
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    /fetch failed/i.test(msg) ||
    /timeout/i.test(msg)
  );
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const s = retryAfter.trim();
  if (!s) return null;

  // Retry-After pode ser segundos ou uma data HTTP.
  const asSeconds = Number(s);
  if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.round(asSeconds * 1000);

  const asDate = Date.parse(s);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

async function anymarketGetJson(url: string, token: string): Promise<{ status: number; json: unknown; text: string }> {
  const MAX_RETRIES = 5;
  const MAX_RATE_LIMIT_RETRIES = 10;
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json", gumgaToken: token } as any });
      // eslint-disable-next-line no-await-in-loop
      const text = await resp.text().catch(() => "");
      if (resp.status === 429) {
        rateLimitRetries += 1;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
          return { status: resp.status, json: null, text };
        }
        const retryAfterHeader = resp.headers.get("retry-after");
        const waitMs = parseRetryAfterMs(retryAfterHeader) ?? 60_000;
        console.warn(
          `[anymarket:orders] HTTP 429 (rate limit). Aguardando ${Math.ceil(waitMs / 1000)}s e continuando. url=${url}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitMs);
        // repete a mesma tentativa (não conta como erro transitório)
        attempt -= 1;
        continue;
      }
      const json = (() => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })();
      return { status: resp.status, json, text };
    } catch (err) {
      if (!isTransientFetchError(err) || attempt === MAX_RETRIES) throw err;
      const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.warn(`[anymarket:orders] fetch transitório; retry ${attempt}/${MAX_RETRIES} em ${delay}ms. url=${url}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  return { status: 0, json: null, text: "" };
}

function shouldRetryDb(err: any): boolean {
  const code = err?.driverError?.code ?? err?.code;
  const msg = String(err?.driverError?.message ?? err?.message ?? "");
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    /Connection terminated unexpectedly/i.test(msg) ||
    /Query read timeout/i.test(msg)
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (!shouldRetryDb(err) || attempt === maxRetries) break;
      const delay = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
      console.warn(`[anymarket:orders] db erro transitório em ${label}; retry ${attempt}/${maxRetries} em ${delay}ms`, err?.message ?? err);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  throw lastErr;
}

function parseArgs(argv: string[]): { company?: number; startDate?: string; endDate?: string; onlyInsert?: boolean } {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (a === "--onlyInsert" || a === "--only-insert") {
      raw.set("onlyInsert", "true");
      continue;
    }
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const companyStr = raw.get("company");
  const startDate = raw.get("start-date");
  const endDate = raw.get("end-date");
  const onlyInsert = raw.get("onlyInsert") === "true";

  const result: { company?: number; startDate?: string; endDate?: string; onlyInsert?: boolean } = {};
  if (companyStr) result.company = Number(companyStr);
  if (startDate) result.startDate = startDate;
  if (endDate) result.endDate = endDate;
  if (onlyInsert) result.onlyInsert = true;
  return result;
}

function mapAnyMarketStatus(statusRaw: string | null): { currentStatus: string | null; currentStatusCode: string | null } {
  const code = statusRaw ? String(statusRaw).trim() : null;
  if (!code) return { currentStatus: null, currentStatusCode: null };
  try {
    return { currentStatus: mapAnymarketStatus(code), currentStatusCode: code };
  } catch (e) {
    console.error("[anymarket:orders] status sem mapeamento:", code);
    return { currentStatus: null, currentStatusCode: code };
  }
}

type AnyMarketOrder = Record<string, unknown>;

async function processOrdersPass(opts: {
  passName: "created" | "updated";
  baseUrl: string;
  token: string;
  company: Company;
  platform: Plataform;
  startYmd: string;
  endYmd: string;
  onlyInsert: boolean;
  repos: {
    customerRepo: ReturnType<typeof AppDataSource.getRepository<Customer>>;
    orderRepo: ReturnType<typeof AppDataSource.getRepository<Order>>;
    itemRepo: ReturnType<typeof AppDataSource.getRepository<OrderItem>>;
    productRepo: ReturnType<typeof AppDataSource.getRepository<Product>>;
  };
  counters: {
    fetched: number;
    processed: number;
    inserted: number;
    upserted: number;
    updated: number;
    customersCreated: number;
    productsCreated: number;
    failed: number;
  };
  progress: (info: { pass: string; offset: number; total: number | null; processed: number }) => void;
}): Promise<void> {
  const { passName, baseUrl, token, company, platform, startYmd, endYmd, onlyInsert, repos, counters, progress } = opts;
  const { customerRepo, orderRepo, itemRepo, productRepo } = repos;

  const limit = 100;
  let offset = 0;
  let total: number | null = null;

  const after = passName === "created" ? ymdToAnyMarketStartSp(startYmd) : ymdToAnyMarketStartSp(startYmd);
  const before = passName === "created" ? ymdToAnyMarketEndSp(endYmd) : ymdToAnyMarketEndSp(endYmd);

  while (true) {
    progress({ pass: passName, offset, total, processed: counters.processed });

    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (passName === "created") {
      params.set("createdAfter", after);
      params.set("createdBefore", before);
    } else {
      params.set("updatedAfter", after);
      params.set("updatedBefore", before);
    }

    const url = `${baseUrl}/orders?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const { status, json, text } = await anymarketGetJson(url, token);
    if (status < 200 || status >= 300) throw new Error(`Falha AnyMarket HTTP ${status} em ${url}. Body: ${text.slice(0, 500)}`);

    const root = asRecord(json) ?? {};
    const content = ensureArray(root.content);
    const pageObj = asRecord(root.page ?? null) ?? {};
    const totalElements = pickNumber(pageObj, "totalElements");
    if (total === null && totalElements !== null) total = totalElements;

    if (content.length === 0) break;

    const ordersJson = content.map((c) => asRecord(c)).filter(Boolean) as AnyMarketOrder[];

    // prefetch orders existentes
    const orderCodes = ordersJson
      .map((o) => pickNumber(o, "id"))
      .filter((n): n is number => n !== null && Number.isInteger(n) && n > 0);
    const existingOrdersArr = orderCodes.length
      ? // eslint-disable-next-line no-await-in-loop
        await withRetry("db find existing orders (page)", () =>
          orderRepo.find({ where: { company: { id: company.id }, orderCode: In(orderCodes) } as any }),
        )
      : [];
    const existingOrdersByCode = new Map<number, Order>();
    for (const o of existingOrdersArr) existingOrdersByCode.set(o.orderCode, o);

    // prefetch customers por taxId (externalId = taxId)
    const taxIds = new Set<string>();
    for (const o of ordersJson) {
      const buyer = asRecord(o.buyer ?? null) ?? {};
      const doc = normalizeCpfCnpj(pickString(buyer, "documentNumberNormalized") ?? pickString(buyer, "document"));
      if (doc) taxIds.add(doc);
    }
    const taxIdArr = Array.from(taxIds);
    const existingCustomersArr = taxIdArr.length
      ? // eslint-disable-next-line no-await-in-loop
        await withRetry("db find existing customers (page)", () =>
          customerRepo.find({ where: { company: { id: company.id }, externalId: In(taxIdArr) } as any }),
        )
      : [];
    const customersByExternalId = new Map<string, Customer>();
    for (const c of existingCustomersArr) {
      if (!c.externalId) continue;
      customersByExternalId.set(c.externalId, c);
    }

    // prefetch products por sku string (partnerId/externalId)
    const skuSet = new Set<string>();
    for (const o of ordersJson) {
      for (const it of ensureArray(o.items)) {
        const item = asRecord(it);
        if (!item) continue;
        const skuObj = asRecord(item.sku ?? null) ?? {};
        const prodObj = asRecord(item.product ?? null) ?? {};
        const skuStr =
          pickString(skuObj, "partnerId") ?? pickString(skuObj, "externalId") ?? pickString(prodObj, "externalIdProduct") ?? null;
        if (skuStr) skuSet.add(String(skuStr));
      }
    }
    const skuArr = Array.from(skuSet);
    const existingProductsArr = skuArr.length
      ? // eslint-disable-next-line no-await-in-loop
        await withRetry("db find existing products (page)", () =>
          productRepo.find({ where: { company: { id: company.id }, sku: In(skuArr) } as any }),
        )
      : [];
    const productsBySku = new Map<string, Product>();
    for (const p of existingProductsArr) productsBySku.set(p.sku, p);

    const customersToSave: Customer[] = [];
    const productsToSave: Product[] = [];
    const ordersToInsert: Order[] = [];
    const ordersToUpdate: Order[] = [];
    const itemsToInsert: OrderItem[] = [];

    for (const o of ordersJson) {
      const orderCode = pickNumber(o, "id");
      if (!orderCode) continue;

      const buyer = asRecord(o.buyer ?? null) ?? {};
      const taxId = normalizeCpfCnpj(pickString(buyer, "documentNumberNormalized") ?? pickString(buyer, "document")) ?? `anymarket_buyer:${orderCode}`;
      const customerExternalId = taxId; // regra: externalId = taxId para AnyMarket

      let customer = customersByExternalId.get(customerExternalId) ?? null;
      if (!customer) {
        customer = customerRepo.create({ company, externalId: customerExternalId, taxId });
        customer.legalName = pickString(buyer, "name");
        customer.email = pickString(buyer, "email");
        customer.birthDate = datePartFromIso(pickString(buyer, "dateOfBirth"));
        customer.personType = toPersonType(pickString(buyer, "documentType")) ?? null;
        customer.phones = { cellphone: pickString(buyer, "cellPhone"), phone: null };
        customer.raw = buyer;
        customersToSave.push(customer);
        customersByExternalId.set(customerExternalId, customer);
      }

      const { currentStatus, currentStatusCode } = mapAnyMarketStatus(pickString(o, "status"));

      const createdAt = parseAnyMarketDate(pickString(o, "createdAt"));
      const paymentDateIso = pickString(o, "paymentDate");
      const paymentDate = datePartFromIso(paymentDateIso);

      const shipping = asRecord(o.shipping ?? null) ?? {};
      const promised = pickString(shipping, "promisedShippingTime");
      const promisedYmd = datePartFromIso(promised);

      const order = existingOrdersByCode.get(orderCode) ?? orderRepo.create({ orderCode });
      const exists = Boolean(existingOrdersByCode.get(orderCode));

      if (onlyInsert && exists) {
        counters.processed += 1;
        continue;
      }

      // Campos base
      order.company = company;
      order.platform = platform;
      order.orderCode = orderCode;
      order.partnerOrderId = pickString(o, "marketPlaceId") ?? pickString(o, "marketPlaceNumber") ?? pickString(o, "marketPlaceId");
      order.currentStatus = isOrderStatus(currentStatus) ? currentStatus : null;
      order.currentStatusCode = currentStatusCode;
      order.marketplaceName = pickString(o, "accountName") ?? pickString(o, "marketPlace");
      order.channel = "marketplace";
      order.orderDate = createdAt ?? order.orderDate ?? null;
      order.paymentDate = paymentDate ?? order.paymentDate ?? null;
      order.shippingAmount = toNumericString(pickNumber(o, "freight") ?? pickString(o, "freight"));
      order.totalAmount = toNumericString(pickNumber(o, "total") ?? pickString(o, "total"));
      order.totalDiscount = toNumericString(pickNumber(o, "discount") ?? pickString(o, "discount"));
      order.deliveryState = pickString(shipping, "state");
      order.deliveryZip = pickString(shipping, "zipCode");
      order.deliveryNeighborhood = pickString(shipping, "neighborhood");
      order.deliveryCity = pickString(shipping, "city");
      order.deliveryNumber = pickString(shipping, "number");
      order.deliveryAddress = pickString(shipping, "address") ?? pickString(shipping, "street");
      order.deliveryComplement = [pickString(shipping, "comment"), pickString(shipping, "reference")].filter(Boolean).join(" · ") || null;
      order.deliveryDate = promisedYmd ?? order.deliveryDate ?? null;
      order.deliveryDays = diffDaysUtc(order.orderDate ? formatYmdUtc(order.orderDate) : null, promisedYmd);
      order.payments = o.payments ?? null;
      order.tracking = shipping;
      order.metadata = o.metadata ?? null;
      order.raw = o;
      if (customer) order.customer = customer;

      if (!exists) ordersToInsert.push(order);
      else ordersToUpdate.push(order);

      // produtos + itens: somente para inserts do pass "created"
      if (passName === "created" && !exists) {
        for (const it of ensureArray(o.items)) {
          const item = asRecord(it);
          if (!item) continue;
          const skuObj = asRecord(item.sku ?? null) ?? {};
          const prodObj = asRecord(item.product ?? null) ?? {};
          const skuStr =
            pickString(skuObj, "partnerId") ?? pickString(skuObj, "externalId") ?? pickString(prodObj, "externalIdProduct") ?? null;
          if (!skuStr) continue;

          let product = productsBySku.get(skuStr) ?? null;
          const isNewProduct = !product;
          if (!product) product = productRepo.create({ company, sku: skuStr });
          product.company = company;
          product.sku = skuStr;
          product.ecommerceId = pickNumber(prodObj, "id") ?? product.ecommerceId ?? null;
          // Não sobrescreve brand/model/category se manual_attributes_locked, mas podemos preencher name/ean/photo quando vazio
          const nameFromItem = pickString(skuObj, "title") ?? pickString(prodObj, "title");
          if (!product.name) product.name = nameFromItem;
          if (!product.ean) product.ean = pickString(skuObj, "ean");
          product.photo = product.photo ?? null;
          product.raw = { product: prodObj, sku: skuObj };
          productsBySku.set(skuStr, product);
          if (isNewProduct) {
            productsToSave.push(product);
            counters.productsCreated += 1;
          }

          const qty = pickNumber(item, "amount");
          const unit = pickNumber(item, "unit");
          const totalItem = pickNumber(item, "total");

          const oi = itemRepo.create({
            company,
            order,
            product,
            sku: null, // SKU no AnyMarket é string (partnerId), não cabe no campo integer
            unitPrice: toNumericString(unit),
            netUnitPrice: null,
            quantity: qty,
            itemType: "produto",
            serviceRefSku: null,
          });
          // Se o total vier e o unit não vier (ou vice-versa), a gente mantém o que der.
          if (!oi.unitPrice && totalItem !== null && qty) oi.unitPrice = toNumericString(totalItem / qty);
          itemsToInsert.push(oi);
        }
      }

      counters.processed += 1;
    }

    // salva customers/produtos primeiro
    if (customersToSave.length > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withRetry(`save customers batch (n=${customersToSave.length})`, () => customerRepo.save(customersToSave, { chunk: 50 }));
        counters.customersCreated += customersToSave.length;
      } catch (e) {
        console.error("[anymarket:orders] falha ao salvar customers batch; seguindo:", e);
      }
    }
    if (productsToSave.length > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withRetry(`save products batch (n=${productsToSave.length})`, () => productRepo.save(productsToSave, { chunk: 50 }));
      } catch (e) {
        console.error("[anymarket:orders] falha ao salvar products batch; seguindo:", e);
      }
    }

    // updates (status e campos básicos) — usamos save mesmo por simplicidade (já é batch)
    if (ordersToUpdate.length > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withRetry(`save orders batch(update) (n=${ordersToUpdate.length})`, () => orderRepo.save(ordersToUpdate, { chunk: 20 }));
        counters.updated += ordersToUpdate.length;
      } catch (e) {
        console.error("[anymarket:orders] falha ao salvar lote de updates; seguindo:", e);
        counters.failed += ordersToUpdate.length;
      }
    }

    // inserts
    if (ordersToInsert.length > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withRetry(`save orders batch(insert) (n=${ordersToInsert.length})`, () => orderRepo.save(ordersToInsert, { chunk: 20 }));
        counters.inserted += ordersToInsert.length;
      } catch (e: any) {
        console.error("[anymarket:orders] falha ao salvar lote de inserts; fallback por pedido:", e);
        for (const o of ordersToInsert) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await withRetry(`save order(insert) order_code=${o.orderCode}`, () => orderRepo.save(o));
            counters.inserted += 1;
          } catch (err2: any) {
            const code = err2?.driverError?.code ?? err2?.code;
            const constraint = err2?.driverError?.constraint ?? err2?.constraint;
            if (code === "23505" && constraint === "UQ_orders_company_id_order_code") {
              // já existe → merge e salva
              const existing = await withRetry(`db findOne order after unique order_code=${o.orderCode}`, () =>
                orderRepo.findOne({ where: { company: { id: company.id }, orderCode: o.orderCode } as any }),
              );
              if (existing) {
                orderRepo.merge(existing, o);
                try {
                  // eslint-disable-next-line no-await-in-loop
                  await orderRepo.save(existing, { reload: false });
                  counters.upserted += 1;
                } catch (err3) {
                  console.error(`[anymarket:orders] falha ao atualizar após unique; pulando. order_code=${o.orderCode}`, err3);
                  counters.failed += 1;
                }
              } else {
                counters.failed += 1;
              }
              continue;
            }
            console.error(`[anymarket:orders] erro ao inserir pedido; pulando. order_code=${o.orderCode}`, err2);
            counters.failed += 1;
          }
        }
      }
    }

    // itens (somente para inserts deste pass)
    if (itemsToInsert.length > 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await withRetry(`save order_items batch (n=${itemsToInsert.length})`, () => itemRepo.save(itemsToInsert, { chunk: 50 }));
      } catch (e) {
        console.error("[anymarket:orders] falha ao salvar order_items batch; seguindo:", e);
      }
    }

    counters.fetched += content.length;

    offset += limit;
    if (total !== null && offset >= total) break;
  }
}

async function main() {
  const partial = parseArgs(process.argv.slice(2));
  const companyId = partial.company;
  if (companyId === undefined || !Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  }

  const y = yesterdayUtc();
  const t = todayUtc();
  const startDate = partial.startDate ?? y;
  const endDate = partial.endDate ?? (partial.startDate ? partial.startDate : t);
  const onlyInsert = Boolean(partial.onlyInsert);

  let start = parseIsoDateYmd(startDate);
  let end = parseIsoDateYmd(endDate);
  if (end.getTime() < start.getTime()) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  await AppDataSource.initialize();

  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let integrationLogId: number | null = null;

  const counters = {
    fetched: 0,
    processed: 0,
    inserted: 0,
    upserted: 0,
    updated: 0,
    customersCreated: 0,
    productsCreated: 0,
    failed: 0,
  };

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const customerRepo = AppDataSource.getRepository(Customer);
    const orderRepo = AppDataSource.getRepository(Order);
    const itemRepo = AppDataSource.getRepository(OrderItem);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new Error(`Company ${companyId} não encontrada.`);
    companyRefForLog = company;

    const platform = await platformRepo.findOne({ where: { slug: "anymarket" } });
    if (!platform) throw new Error('Platform slug="anymarket" não encontrada. Cadastre e instale antes.');
    platformRefForLog = platform;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: company.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Platform "anymarket" não está instalada nessa company.');

    // log inicial (PROCESSANDO)
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const started = await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: null,
          company,
          platform,
          command: "Pedidos",
          status: "PROCESSANDO",
          log: {
            company: companyId,
            platform: { id: platform.id, slug: "anymarket" },
            command: "Pedidos",
            startDate: formatYmdUtc(start),
            endDate: formatYmdUtc(end),
            onlyInsert,
            status: "PROCESSANDO",
            inserted: 0,
            upserted: 0,
            updated: 0,
            fetched: 0,
            processed: 0,
            customers_created: 0,
            products_created: 0,
            failed: 0,
          },
          errors: null,
        }),
      );
      integrationLogId = started.id;
    } catch (e) {
      console.warn("[anymarket:orders] falha ao gravar log inicial (PROCESSANDO):", e);
    }

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const token = typeof cfg.token === "string" ? cfg.token.trim() : null;
    if (!token) throw new Error('Config da AnyMarket precisa conter: { "token": "..." }');

    const baseUrl = "https://api.anymarket.com.br/v2";

    const startYmd = formatYmdUtc(start);
    const endYmd = formatYmdUtc(end);
    const chunks = splitRangeIntoChunksYmd(startYmd, endYmd, 7);

    let currentChunkIndex = 0;
    const progress = (info: { pass: string; offset: number; total: number | null; processed: number }) => {
      const totalPart = info.total !== null ? `${info.offset}/${info.total}` : `${info.offset}`;
      renderProgress(
        `[anymarket:orders] company=${companyId} range=${startYmd}..${endYmd} chunk=${currentChunkIndex}/${chunks.length} pass=${info.pass} offset=${totalPart} processed=${counters.processed} inserted=${counters.inserted} updated=${counters.updated} upsert=${counters.upserted}`,
      );
    };

    console.log(`[anymarket:orders] company=${companyId} range=${startYmd}..${endYmd} iniciando...`);

    // AnyMarket: não aceita períodos > 7 dias. Processamos em chunks (inclusive) de até 7 dias.
    for (let i = 0; i < chunks.length; i += 1) {
      const ch = chunks[i]!;
      currentChunkIndex = i + 1;
      console.log(`[anymarket:orders] chunk ${currentChunkIndex}/${chunks.length} created range=${ch.startYmd}..${ch.endYmd}`);
      // Passo 1: createdAt (para inserir)
      await processOrdersPass({
        passName: "created",
        baseUrl,
        token,
        company,
        platform,
        startYmd: ch.startYmd,
        endYmd: ch.endYmd,
        onlyInsert,
        repos: { customerRepo, orderRepo, itemRepo, productRepo },
        counters,
        progress,
      });
      console.log(`[anymarket:orders] chunk ${currentChunkIndex}/${chunks.length} updated range=${ch.startYmd}..${ch.endYmd}`);
      // Passo 2: updatedAt (para atualizar e inserir os que faltarem)
      await processOrdersPass({
        passName: "updated",
        baseUrl,
        token,
        company,
        platform,
        startYmd: ch.startYmd,
        endYmd: ch.endYmd,
        onlyInsert,
        repos: { customerRepo, orderRepo, itemRepo, productRepo },
        counters,
        progress,
      });
    }

    if (IS_TTY) process.stdout.write("\n");
    console.log(
      `[anymarket:orders] company=${companyId} range=${startYmd}..${endYmd} fetched=${counters.fetched} processed=${counters.processed} inserted=${counters.inserted} upserted=${counters.upserted} updated=${counters.updated} customers_created=${counters.customersCreated} products_created=${counters.productsCreated} failed=${counters.failed}`,
    );

    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "FINALIZADO",
            log: {
              company: companyId,
              platform: { id: platform.id, slug: "anymarket" },
              command: "Pedidos",
              startDate: startYmd,
              endDate: endYmd,
              chunks: chunks.length,
              onlyInsert,
              status: "FINALIZADO",
              fetched: counters.fetched,
              processed: counters.processed,
              inserted: counters.inserted,
              upserted: counters.upserted,
              updated: counters.updated,
              customers_created: counters.customersCreated,
              products_created: counters.productsCreated,
              failed: counters.failed,
            },
            errors: null as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company,
            platform,
            command: "Pedidos",
            status: "FINALIZADO",
            log: {
              company: companyId,
              platform: { id: platform.id, slug: "anymarket" },
              command: "Pedidos",
              startDate: startYmd,
              endDate: endYmd,
              chunks: chunks.length,
              onlyInsert,
              status: "FINALIZADO",
              fetched: counters.fetched,
              processed: counters.processed,
              inserted: counters.inserted,
              upserted: counters.upserted,
              updated: counters.updated,
              customers_created: counters.customersCreated,
              products_created: counters.productsCreated,
              failed: counters.failed,
            },
            errors: null,
          }),
        );
      }
    } catch (e) {
      console.warn("[anymarket:orders] falha ao finalizar log de integração:", e);
    }
  } catch (err) {
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const errorPayload =
        err instanceof Error ? { name: err.name, message: err.message, stack: err.stack ?? null } : { message: String(err) };
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "ERRO",
            log: {
              company: companyId,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "anymarket" } : null,
              command: "Pedidos",
              status: "ERRO",
              inserted: counters.inserted,
              upserted: counters.upserted,
              updated: counters.updated,
              fetched: counters.fetched,
              processed: counters.processed,
              customers_created: counters.customersCreated,
              products_created: counters.productsCreated,
              failed: counters.failed,
            },
            errors: errorPayload as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company: companyRefForLog ?? ({ id: companyId } as any),
            platform: platformRefForLog ?? null,
            command: "Pedidos",
            status: "ERRO",
            log: {
              company: companyId,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "anymarket" } : null,
              command: "Pedidos",
              status: "ERRO",
              inserted: counters.inserted,
              upserted: counters.upserted,
              updated: counters.updated,
              fetched: counters.fetched,
              processed: counters.processed,
              customers_created: counters.customersCreated,
              products_created: counters.productsCreated,
              failed: counters.failed,
            },
            errors: errorPayload,
          }),
        );
      }
    } catch (e) {
      console.warn("[anymarket:orders] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[anymarket:orders] erro:", err);
  process.exit(1);
});

