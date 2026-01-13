import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Customer } from "../../entities/Customer.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Product } from "../../entities/Product.js";
import { mapTrayStatus, parseTrayCustomStatusMap } from "../../utils/status/index.js";

const IS_TTY = Boolean(process.stdout.isTTY);

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderProgress(line: string) {
  if (IS_TTY) {
    const padded = line.length < 120 ? line.padEnd(120, " ") : line;
    process.stdout.write(`\r${padded}`);
  } else {
    console.log(line);
  }
}

function parseArgs(argv: string[]): { company?: number; startDate?: string; endDate?: string } {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const companyStr = raw.get("company");
  const startDate = raw.get("start-date");
  const endDate = raw.get("end-date");

  const result: { company?: number; startDate?: string; endDate?: string } = {};
  if (companyStr) result.company = Number(companyStr);
  if (startDate) result.startDate = startDate;
  if (endDate) result.endDate = endDate;
  return result;
}

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseIsoDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Data inválida: ${date}. Use YYYY-MM-DD.`);
  }
  // UTC midnight
  return new Date(`${date}T00:00:00.000Z`);
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function yesterdayUtc(): string {
  const now = new Date();
  const y = addDaysUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -1);
  return formatDate(y);
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
  return String(v);
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

function splitStoreReference(value: string | null): { storeReference: string | null; externalReference: string | null } {
  if (!value) return { storeReference: null, externalReference: null };
  const s = value.trim();
  if (!s) return { storeReference: null, externalReference: null };
  // Ex.: "45145[160151]" => storeReference="45145", externalReference="160151"
  const match = /^([^\[\]]+)\[([^\[\]]+)\]$/.exec(s);
  if (!match) return { storeReference: s, externalReference: null };
  const storeReference = match[1]?.trim() ?? null;
  const externalReference = match[2]?.trim() ?? null;
  return {
    storeReference: storeReference && storeReference.length > 0 ? storeReference : null,
    externalReference: externalReference && externalReference.length > 0 ? externalReference : null,
  };
}

function normalizeDateString(value: string | null): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  if (s === "0000-00-00" || s === "0000-00-00 00:00:00") return null;
  const datePart = s.length >= 10 ? s.slice(0, 10) : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  const [yyyyStr, mmStr, ddStr] = datePart.split("-");
  const yyyy = Number(yyyyStr);
  const mm = Number(mmStr);
  const dd = Number(ddStr);

  // A Tray às vezes retorna "0000-01-05" e similares; Postgres não aceita ano 0000.
  // Regra: quando yyyy === 0, usamos o ano atual (UTC) mantendo mês/dia.
  if (!Number.isFinite(yyyy)) return null;
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return null;
  if (!Number.isFinite(dd) || dd < 1 || dd > 31) return null;

  if (yyyy === 0) {
    const currentYear = new Date().getUTCFullYear();
    return `${currentYear}-${mmStr}-${ddStr}`;
  }

  if (yyyy < 0) return null;
  return datePart;
}

async function httpPostJson(url: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text().catch(() => "");
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  return { status: resp.status, json, text };
}

async function httpGetJson(url: string): Promise<{ status: number; json: unknown; text: string }> {
  const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const text = await resp.text().catch(() => "");
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  return { status: resp.status, json, text };
}

function isTrayTokenError(payload: unknown): boolean {
  const obj = asRecord(payload);
  if (!obj) return false;
  // A Tray pode retornar diferentes error_code para token inválido/expirado
  // Ex.: 1000 (token expired) e 1099 ("Token inválido ou expirado")
  return obj.code === 401 && (obj.error_code === 1000 || obj.error_code === 1099);
}

type TrayAuthContext = {
  baseUrl: string;
  code: string;
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
};

async function authenticate(baseUrl: string, code: string, consumerKey: string, consumerSecret: string): Promise<string> {
  const { status, json, text } = await httpPostJson(`${baseUrl}/auth`, {
    code,
    consumer_key: consumerKey,
    consumer_secret: consumerSecret,
  });

  if (status < 200 || status >= 300) {
    throw new Error(`Falha ao autenticar na Tray (HTTP ${status}). Body: ${text.slice(0, 500)}`);
  }

  const obj = asRecord(json);
  const token = obj ? (obj.access_token as string | undefined) : undefined;
  if (!token) {
    throw new Error(`Resposta de auth da Tray não contém access_token. Body: ${text.slice(0, 500)}`);
  }
  return token;
}

type FieldStats = { missing: Set<string>; createdTrayOnly: Set<string> };
function createFieldStats(): FieldStats {
  return { missing: new Set(), createdTrayOnly: new Set() };
}

function markMissingIfNull(stats: FieldStats, field: string, value: unknown) {
  if (value === null || value === undefined || value === "") stats.missing.add(field);
}

async function trayGetJson(
  ctx: TrayAuthContext,
  pathWithQuery: string,
  reauth: () => Promise<void>,
): Promise<{ json: unknown; text: string }> {
  const url = `${ctx.baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
    ctx.accessToken,
  )}`;

  const MAX_RETRIES_504 = 5;
  const RETRY_DELAY_MS_504 = 60_000; // 1 minute

  let { status, json, text } = { status: 0, json: null as unknown, text: "" };

  for (let attempt = 1; attempt <= MAX_RETRIES_504; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await httpGetJson(url);
    status = result.status;
    json = result.json;
    text = result.text;

    // Tray sometimes returns 504; wait 1 minute and retry the same request.
    if (status === 504) {
      const suffix = attempt < MAX_RETRIES_504 ? ` (retry ${attempt}/${MAX_RETRIES_504} in 60s)` : " (no more retries)";
      console.warn(`[tray:orders] HTTP 504 on ${pathWithQuery}${suffix}`);
      if (attempt < MAX_RETRIES_504) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(RETRY_DELAY_MS_504);
        continue;
      }
    }

    // Token expired: reauth once, then retry immediately (still subject to 504 retry loop in next iteration)
    if (status === 401 && isTrayTokenError(json)) {
      // eslint-disable-next-line no-await-in-loop
      await reauth();
      // eslint-disable-next-line no-await-in-loop
      const retry = await httpGetJson(
        `${ctx.baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(ctx.accessToken)}`,
      );
      status = retry.status;
      json = retry.json;
      text = retry.text;
    }

    break;
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Falha Tray HTTP ${status} em ${pathWithQuery}. Body: ${text.slice(0, 500)}`);
  }
  return { json, text };
}

function normalizeCpfCnpj(cpfOrCnpj: string): string {
  return cpfOrCnpj.replace(/\D/g, "");
}

function parseDateFromYmd(value: string | null): Date | null {
  if (!value) return null;
  // timestamp sem timezone: usa horário local (00:00:00)
  const [y, m, d] = value.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function dateToYmd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateTimeFromSql(value: string | null): Date | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  // Aceita "YYYY-MM-DD HH:MM:SS" (Tray MarketplaceOrder.created) ou ISO parcial.
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return parseDateTimeFromYmdHms(m[1] ?? null, m[2] ?? null);
}

function parseDateTimeFromYmdHms(dateYmd: string | null, timeHms: string | null): Date | null {
  if (!dateYmd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const [y, m, d] = dateYmd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;

  const t = (timeHms ?? "").trim();
  if (!/^\d{2}:\d{2}:\d{2}$/.test(t)) return parseDateFromYmd(dateYmd);
  const parts = t.split(":");
  if (parts.length !== 3) return parseDateFromYmd(dateYmd);
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = Number(parts[2]);
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59 ||
    ss < 0 ||
    ss > 59
  ) {
    return parseDateFromYmd(dateYmd);
  }
  const dt = new Date(y, m - 1, d, hh, mm, ss, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function diffDaysUtc(fromDate: string, toDate: string): number | null {
  // fromDate/toDate devem estar em YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null;
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const diff = Math.round((to - from) / (24 * 60 * 60 * 1000));
  if (!Number.isFinite(diff)) return null;
  return diff;
}

async function main() {
  const partial = parseArgs(process.argv.slice(2));

  const companyId = partial.company;
  if (companyId === undefined || !Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  }
  const companyIdNum = companyId;

  const y = yesterdayUtc();
  const startDate = partial.startDate ?? y;
  const endDate = partial.endDate ?? partial.startDate ?? y;
  // valida formato e range
  let start = parseIsoDate(startDate);
  let end = parseIsoDate(endDate);
  if (end.getTime() < start.getTime()) {
    // swap
    const tmp = start;
    start = end;
    end = tmp;
  }

  await AppDataSource.initialize();
  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const plataformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const customerRepo = AppDataSource.getRepository(Customer);
    const orderRepo = AppDataSource.getRepository(Order);
    const itemRepo = AppDataSource.getRepository(OrderItem);
    const productRepo = AppDataSource.getRepository(Product);

    const companyEntity = await companyRepo.findOne({ where: { id: companyIdNum } });
    if (!companyEntity) throw new Error(`Company ${companyIdNum} não encontrada.`);
    const companyRef: Company = companyEntity;

    const platform = await plataformRepo.findOne({ where: { slug: "tray" } });
    if (!platform) throw new Error('Platform slug="tray" não encontrada. Cadastre e instale antes.');

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: companyEntity.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Platform "tray" não está instalada nessa company.');

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const baseUrl = typeof cfg.url === "string" ? cfg.url.replace(/\/+$/, "") : null;
    const code = typeof cfg.code === "string" ? cfg.code : null;
    const consumerKey = typeof cfg.consumer_key === "string" ? cfg.consumer_key : null;
    const consumerSecret = typeof cfg.consumer_secret === "string" ? cfg.consumer_secret : null;
    let accessToken = typeof cfg.access_token === "string" ? cfg.access_token : null;

    if (!baseUrl || !code || !consumerKey || !consumerSecret) {
      throw new Error('Config da Tray precisa conter: url, code, consumer_key, consumer_secret. access_token é opcional.');
    }

    const stats = createFieldStats();
    let processedOrders = 0;
    let createdCustomers = 0;
    let totalOrdersExpected: number | null = null;
    let progressTick = 0;
    let currentAction = "iniciando";
    let currentDateStr: string | null = null;
    let progressPage = 1;
    let lastProgressAt = 0;

    const updateProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < 500) return;
      lastProgressAt = now;
      const pct = totalOrdersExpected ? formatPct((processedOrders / totalOrdersExpected) * 100) : "—";
      const range = `${formatDate(start)}..${formatDate(end)}`;
      const datePart = currentDateStr ? ` date=${currentDateStr}` : "";
      const pagePart = ` page=${progressPage}`;
      const totalPart = totalOrdersExpected ? `${processedOrders}/${totalOrdersExpected} (${pct})` : `${processedOrders}`;
      renderProgress(`[tray:orders]${datePart}${pagePart} ${totalPart} | ${currentAction}`);
    };

    // garante token
    if (!accessToken) {
      accessToken = await authenticate(baseUrl, code, consumerKey, consumerSecret);
      companyPlatform.config = { ...cfg, access_token: accessToken };
      await cpRepo.save(companyPlatform);
    }

    renderProgress(`[tray:orders] company=${companyIdNum} range=${formatDate(start)}..${formatDate(end)} iniciando...`);

    const ctx: TrayAuthContext = {
      baseUrl,
      code,
      consumerKey,
      consumerSecret,
      accessToken,
    };

    const reauth = async () => {
      const newToken = await authenticate(ctx.baseUrl, ctx.code, ctx.consumerKey, ctx.consumerSecret);
      ctx.accessToken = newToken;
      companyPlatform.config = { ...(companyPlatform.config as Record<string, unknown>), access_token: newToken };
      await cpRepo.save(companyPlatform);
    };

    const customerCache = new Map<string, Customer>();
    // payloads "crus" (respostas completas das requests), para logs/auditoria em Customer.raw
    const customerRawCache = new Map<string, unknown>();
    const productSoldCache = new Map<string, unknown>();
    const productCache = new Map<string, Product>();
    const trayCustomStatusMap = parseTrayCustomStatusMap(cfg.status);
    const orderDetailCache = new Map<number, { date: string | null; hour: string | null; marketplaceCreated: string | null }>();

    async function ensureProductBySku(productSku: number, productSoldDetail: Record<string, unknown>, productSoldRaw: unknown) {
      const productSkuStr = String(productSku);
      const cached = productCache.get(productSkuStr);
      if (cached) return cached;

      const existing = await productRepo.findOne({ where: { company: { id: companyRef.id }, sku: productSkuStr } });
      if (existing) {
        // Regra: rotinas de orders NÃO atualizam cadastro de produto existente.
        productCache.set(productSkuStr, existing);
        return existing;
      }

      let productApiRaw: unknown | null = null;
      let categoryName: string | null = null;
      try {
        const { json } = await trayGetJson(ctx, `/products/${encodeURIComponent(String(productSku))}`, reauth);
        productApiRaw = json ?? null;
        const root = asRecord(json) ?? {};
        const prodObj = asRecord(root.Product) ?? asRecord(root.product) ?? asRecord(root);
        categoryName = prodObj ? pickString(prodObj, "category_name") : null;
      } catch {
        // ignora erro de categoria
      }

      const weightRaw = pickString(productSoldDetail, "weight"); // geralmente em gramas
      const weightKg = weightRaw ? String(Number(weightRaw) / 1000) : null;

      const refs = splitStoreReference(pickString(productSoldDetail, "reference"));
      const p = productRepo.create({
        company: companyRef,
        sku: productSkuStr,
        name: pickString(productSoldDetail, "name"),
        storeReference: refs.storeReference,
        externalReference: refs.externalReference,
        brand: pickString(productSoldDetail, "brand"),
        model: pickString(productSoldDetail, "model"),
        ncm: pickString(productSoldDetail, "ncm"),
        weight: toNumericString(weightKg),
        width: toNumericString(pickNumber(productSoldDetail, "width") ?? pickString(productSoldDetail, "width")),
        height: toNumericString(pickNumber(productSoldDetail, "height") ?? pickString(productSoldDetail, "height")),
        lengthCm: toNumericString(pickNumber(productSoldDetail, "length") ?? pickString(productSoldDetail, "length")),
        // Cadastro mais confiável fica por conta do script de products.
        // Aqui apenas criamos o mínimo quando o produto ainda não existe.
        category: categoryName,
        raw: { product: productApiRaw, product_sold: productSoldRaw },
      });

      const saved = await productRepo.save(p);
      productCache.set(productSkuStr, saved);
      return saved;
    }

    for (let day = start; day.getTime() <= end.getTime(); day = addDaysUtc(day, 1)) {
      const dateStr = formatDate(day);
      currentDateStr = dateStr;
      let page = 1;
      const limit = 50;
      let dayTotal: number | null = null;
      let dayProcessed = 0;

      // paginação
      while (true) {
        progressTick += 1;
        progressPage = page;
        currentAction = "buscando orders";
        updateProgress(progressTick % 3 === 0);

        const { json } = await trayGetJson(ctx, `/orders?date=${encodeURIComponent(dateStr)}&page=${page}&limit=${limit}`, reauth);
        const root = asRecord(json) ?? {};
        const paging = asRecord(root.paging) ?? {};
        const total = pickNumber(paging, "total") ?? null;
        if (dayTotal === null && total !== null) {
          dayTotal = total;
          totalOrdersExpected = (totalOrdersExpected ?? 0) + total;
          updateProgress(true);
        }
        const ordersArr = ensureArray(root.Orders);
        if (ordersArr.length === 0) break;

        for (const wrapper of ordersArr) {
          const w = asRecord(wrapper);
          const orderObj = w ? asRecord(w.Order) : null;
          if (!orderObj) continue;

          const id = pickNumber(orderObj, "id");
          if (!id) continue;

          // Customer: a lista só traz customer_id, sem CPF/CNPJ.
          // Vamos criar/usar um "taxId" sintético para manter relacionamento, e sinalizar que campos reais não foram preenchidos.
          const trayCustomerId = pickString(orderObj, "customer_id");
          let customer: Customer | null = null;
          let customerObjForOrder: Record<string, unknown> | null = null;
          if (trayCustomerId) {
            const cached = customerCache.get(trayCustomerId);
            if (cached) {
              customer = cached;
              // delivery por pedido ficará como estava/NULL se não houver payload do customer
            } else {
              currentAction = `buscando customer ${trayCustomerId}`;
              updateProgress(true);
              const { json: customerJson } = await trayGetJson(ctx, `/customers/${encodeURIComponent(trayCustomerId)}`, reauth);
              const customerRoot = asRecord(customerJson) ?? {};
              const customerObj = asRecord(customerRoot.Customer);
              if (customerObj) {
                customerObjForOrder = customerObj;
                const cpf = pickString(customerObj, "cpf");
                const cnpj = pickString(customerObj, "cnpj");
                const taxIdRaw = cpf && normalizeCpfCnpj(cpf) ? cpf : cnpj;
                const taxId =
                  taxIdRaw && normalizeCpfCnpj(taxIdRaw) ? normalizeCpfCnpj(taxIdRaw) : `tray_customer:${trayCustomerId}`;

                customer =
                  (await customerRepo.findOne({ where: { company: { id: companyEntity.id }, externalId: trayCustomerId } })) ??
                  customerRepo.create({
                    company: companyEntity,
                    externalId: trayCustomerId,
                    taxId,
                  });
                customer.company = companyEntity;
                customer.externalId = trayCustomerId;
                customer.taxId = taxId;

                customer.legalName = pickString(customerObj, "name");
                customer.email = pickString(customerObj, "email");
                customer.birthDate = normalizeDateString(pickString(customerObj, "birth_date"));
                customer.gender = pickString(customerObj, "gender");
                customer.personType = pickString(customerObj, "type");
                customer.stateRegistration = pickString(customerObj, "state_inscription") ?? pickString(customerObj, "rg");
                customer.tradeName = pickString(customerObj, "company_name");

                customer.phones = {
                  phone: pickString(customerObj, "phone"),
                  cellphone: pickString(customerObj, "cellphone"),
                };

                customer.raw = customerJson ?? null;
                customer = await customerRepo.save(customer);
                customerCache.set(trayCustomerId, customer);
                customerRawCache.set(trayCustomerId, customerJson ?? null);
                if (!cached) createdCustomers += 1;
              }
            }
          }

          let order = await orderRepo.findOne({ where: { company: { id: companyEntity.id }, orderCode: id } });
          if (!order) order = orderRepo.create({ orderCode: id });

          // de/para principais
          const trayStatusRaw = pickString(orderObj, "status");
          if (!trayStatusRaw) {
            console.error("[tray:orders] status vazio. order_id=", id);
            throw new Error("Status Tray vazio.");
          }
          try {
            order.currentStatus = mapTrayStatus(trayStatusRaw, trayCustomStatusMap);
          } catch (e) {
            console.error("[tray:orders] status sem mapeamento:", trayStatusRaw);
            throw e;
          }
          order.currentStatusCode = pickString(asRecord(orderObj.OrderStatus) ?? {}, "id");
          const ymd = normalizeDateString(pickString(orderObj, "date"));
          // 1) Preferência: hora de criação do pedido vindo do marketplace (MarketplaceOrder[0].created)
          let createdSql: string | null = null;
          const moArr = ensureArray(orderObj.MarketplaceOrder);
          const mo0 = moArr.length ? asRecord(moArr[0]) : null;
          if (mo0) createdSql = pickString(mo0, "created");

          let orderDate = parseDateTimeFromSql(createdSql);
          // 2) Se a listagem trouxer hour, usa date+hour
          if (!orderDate) {
            orderDate = parseDateTimeFromYmdHms(ymd, pickString(orderObj, "hour"));
          }
          // 3) Fallback: buscar detalhe do pedido para tentar pegar "hour"
          if (!orderDate) {
            const cached = orderDetailCache.get(id);
            let dateFromDetail: string | null = cached?.date ?? null;
            let hourFromDetail: string | null = cached?.hour ?? null;
            let createdFromDetail: string | null = cached?.marketplaceCreated ?? null;

            if (!cached) {
              currentAction = `buscando detalhe do pedido ${id}`;
              updateProgress(true);
              const { json: detailJson } = await trayGetJson(ctx, `/orders/${encodeURIComponent(String(id))}`, reauth);
              const root = asRecord(detailJson) ?? {};
              const det = asRecord(root.Order) ?? asRecord(root.order) ?? root;
              dateFromDetail = normalizeDateString(pickString(det, "date"));
              hourFromDetail = pickString(det, "hour");
              const detMoArr = ensureArray((det as any)?.MarketplaceOrder);
              const detMo0 = detMoArr.length ? asRecord(detMoArr[0]) : null;
              createdFromDetail = detMo0 ? pickString(detMo0, "created") : null;
              orderDetailCache.set(id, { date: dateFromDetail, hour: hourFromDetail, marketplaceCreated: createdFromDetail });
            }

            orderDate =
              parseDateTimeFromSql(createdFromDetail) ??
              parseDateTimeFromYmdHms(dateFromDetail ?? ymd, hourFromDetail) ??
              parseDateFromYmd(dateFromDetail ?? ymd);
          }

          order.orderDate = orderDate;
          order.deliveryDate =
            normalizeDateString(pickString(orderObj, "estimated_delivery_date")) ??
            normalizeDateString(pickString(orderObj, "shipment_date"));
          // delivery_days: calcula pela diferença entre order_date e delivery_date
          if (order.orderDate && order.deliveryDate) {
            const computed = diffDaysUtc(dateToYmd(order.orderDate), order.deliveryDate);
            order.deliveryDays = computed !== null && computed >= 0 ? computed : null;
          } else {
            order.deliveryDays = null;
          }
          order.totalAmount = pickString(orderObj, "total");
          order.totalDiscount = pickString(orderObj, "discount");
          order.shippingAmount = pickString(orderObj, "shipment_value");
          // Channel: padroniza como "marketplace" (quando origem é Tray).
          // O nome do marketplace vem em `point_sale` (antes estava indo para channel).
          order.channel = "marketplace";
          order.marketplaceName = pickString(orderObj, "point_sale");
          order.partnerOrderId = pickString(orderObj, "external_code");
          order.paymentDate = normalizeDateString(pickString(orderObj, "payment_date"));
          order.discountCoupon = pickString(orderObj, "discount_coupon");

          // delivery (por pedido) - vem do endpoint de customer
          if (customerObjForOrder) {
            order.deliveryState = pickString(customerObjForOrder, "state");
            order.deliveryZip = pickString(customerObjForOrder, "zip_code");
            order.deliveryNeighborhood = pickString(customerObjForOrder, "neighborhood");
            order.deliveryCity = pickString(customerObjForOrder, "city");
            order.deliveryNumber = pickString(customerObjForOrder, "number");
            order.deliveryAddress = pickString(customerObjForOrder, "address");
            order.deliveryComplement = pickString(customerObjForOrder, "complement");
          }

          order.tracking = {
            shipment: pickString(orderObj, "shipment"),
            shipment_date: pickString(orderObj, "shipment_date"),
            shipment_integrator: pickString(orderObj, "shipment_integrator"),
            sending_code: pickString(orderObj, "sending_code"),
            tracking_url: pickString(orderObj, "tracking_url"),
            access_code: pickString(orderObj, "access_code"),
            is_traceable: pickString(orderObj, "is_traceable"),
          };

          order.payments = {
            payment_date: pickString(orderObj, "payment_date"),
            payment_form: pickString(orderObj, "payment_form"),
            Payment: ensureArray(orderObj.Payment),
            OrderInvoice: ensureArray(orderObj.OrderInvoice),
          };

          // raw: manter o payload do parceiro "como veio", sem transformação (somente o pedido).
          // Customer.raw guarda o payload do customer integralmente.
          order.raw = orderObj as unknown;

          // metadata (campos que não queremos como colunas)
          order.metadata = {
            source: "tray",
            source_status: trayStatusRaw,
            parent_order_code: pickString(orderObj, "id_quotation") ?? null,
            cart_code: pickString(orderObj, "session_id"),
            order_type: pickString(orderObj, "payment_form"),
            dropshipping_type: pickString(orderObj, "shipment_integrator"),
            map_code: pickString(orderObj, "sending_code"),
          };

          order.company = companyEntity;
          order.platform = platform;
          if (customer) order.customer = customer;

          // sinaliza campos que não conseguimos preencher a partir da Tray
          markMissingIfNull(stats, "orders.delivery_days", order.deliveryDays);

          order = await orderRepo.save(order);

          // items: a listagem só traz ProductsSold (ids). Vamos persistir como "sku" (quando possível).
          await itemRepo.delete({ order: { id: order.id } as Order });
          const productsSold = ensureArray(orderObj.ProductsSold);
          for (const p of productsSold) {
            const pObj = asRecord(p);
            if (!pObj) continue;
            const psIdStr = pickString(pObj, "id");
            if (!psIdStr) continue;

            let psRaw = productSoldCache.get(psIdStr);
            if (!psRaw) {
              currentAction = `buscando item ${psIdStr} (order ${id})`;
              updateProgress(true);
              const { json: psJson } = await trayGetJson(ctx, `/products_solds/${encodeURIComponent(psIdStr)}`, reauth);
              psRaw = psJson ?? null;
              productSoldCache.set(psIdStr, psRaw);
            }

            const psRoot = asRecord(psRaw) ?? {};
            const detail = asRecord(psRoot.ProductsSold) ?? pObj;

            const productId = pickNumber(detail, "product_id");
            const quantity = pickNumber(detail, "quantity");
            const price = pickString(detail, "price");
            if (!productId) continue;

            const product = await ensureProductBySku(productId, detail, psRaw);

            const item = itemRepo.create({
              company: companyEntity,
              order,
              product,
              sku: productId,
              unitPrice: price,
              netUnitPrice: null,
              quantity: quantity,
              itemType: "produto",
              serviceRefSku: null,
            });

            // sinaliza campos que ainda podem ficar vazios
            markMissingIfNull(stats, "order_items.quantity", item.quantity);
            markMissingIfNull(stats, "order_items.unit_price", item.unitPrice);

            await itemRepo.save(item);
          }

          processedOrders += 1;
          dayProcessed += 1;
          currentAction = dayTotal ? `processando (${dayProcessed}/${dayTotal})` : "processando";
          updateProgress(processedOrders % 10 === 0);
        }

        // próxima página
        const currentPage = pickNumber(paging, "page") ?? page;
        const currentLimit = pickNumber(paging, "limit") ?? limit;
        const offset = pickNumber(paging, "offset") ?? (currentPage - 1) * currentLimit;
        const nextOffset = offset + currentLimit;
        if (total !== null && nextOffset >= total) break;
        page += 1;
      }
    }

    currentAction = "finalizando";
    updateProgress(true);
    if (IS_TTY) process.stdout.write("\n");
    console.log(
      `[tray:orders] company=${companyIdNum} range=${formatDate(start)}..${formatDate(
        end,
      )} orders_processed=${processedOrders} customers_created=${createdCustomers}`,
    );

    if (stats.missing.size > 0) {
      console.log("[tray:orders] campos não preenchidos (Tray não fornece / não mapeados):");
      for (const f of Array.from(stats.missing).sort()) console.log(`- ${f}`);
    }
    if (stats.createdTrayOnly.size > 0) {
      console.log("[tray:orders] campos criados exclusivos da Tray:");
      for (const f of Array.from(stats.createdTrayOnly).sort()) console.log(`- ${f}`);
    } else {
      console.log("[tray:orders] não foi necessário criar colunas novas exclusivas da Tray (usamos jsonb/raw para o restante).");
    }
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[tray:orders] erro:", err);
  process.exit(1);
});


