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
import { mapTrayStatus, parseTrayCustomStatusMap } from "../../utils/status/index.js";
import { toBrazilianState } from "../../utils/brazilian-states.js";
import { toPersonType } from "../../utils/person-type.js";
import { toGender } from "../../utils/gender.js";

const IS_TTY = Boolean(process.stdout.isTTY);

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPgTransientNetworkError(err: unknown): boolean {
  const e = err as any;
  const code = e?.code ?? e?.driverError?.code;
  // node-postgres expõe erros de rede como códigos tipo ETIMEDOUT/ECONNRESET
  const msg = String(e?.message ?? e?.driverError?.message ?? "");
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    // alguns encerramentos vêm só como message (sem code)
    /Connection terminated unexpectedly/i.test(msg) ||
    /terminating connection/i.test(msg) ||
    /server closed the connection unexpectedly/i.test(msg) ||
    // postgres restart / crash / admin shutdown
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPgTransientNetworkError(err) || attempt === maxRetries) throw err;
      const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1)); // 2s, 4s, 8s... cap 60s
      console.warn(`[tray:orders] ${label}: erro transitório (${(err as any)?.code ?? (err as any)?.driverError?.code}); retry ${attempt}/${maxRetries} em ${delay}ms`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  throw lastErr;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function renderProgress(line: string) {
  if (IS_TTY) {
    const padded = line.length < 120 ? line.padEnd(120, " ") : line;
    process.stdout.write(`\r${padded}`);
  } else {
    console.log(line);
  }
}

function parseArgs(argv: string[]): {
  company?: number;
  startDate?: string;
  endDate?: string;
  onlyInsert?: boolean;
  debugExisting?: boolean;
} {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (a === "--onlyInsert" || a === "--only-insert") {
      raw.set("onlyInsert", "true");
      continue;
    }
    if (a === "--debug-existing" || a === "--debugExisting") {
      raw.set("debugExisting", "true");
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
  const debugExisting = raw.get("debugExisting") === "true";

  const result: {
    company?: number;
    startDate?: string;
    endDate?: string;
    onlyInsert?: boolean;
    debugExisting?: boolean;
  } = {};
  if (companyStr) result.company = Number(companyStr);
  if (startDate) result.startDate = startDate;
  if (endDate) result.endDate = endDate;
  if (onlyInsert) result.onlyInsert = true;
  if (debugExisting) result.debugExisting = true;
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

function ymdToDate(value: string): Date | null {
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
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

function todayUtc(): string {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return formatDate(t);
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

function isTransientFetchError(err: unknown): boolean {
  const e = err as any;
  const code = e?.code ?? e?.cause?.code;
  const msg = String(e?.message ?? "");
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    /fetch failed/i.test(msg)
  );
}

async function httpGetJson(url: string): Promise<{ status: number; json: unknown; text: string }> {
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      // eslint-disable-next-line no-await-in-loop
      const text = await resp.text().catch(() => "");
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
      console.warn(`[tray:orders] fetch transitório em GET; retry ${attempt}/${MAX_RETRIES} em ${delay}ms. url=${url}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  // nunca chega aqui
  return { status: 0, json: null, text: "" };
}

function isTrayTokenError(payload: unknown): boolean {
  const obj = asRecord(payload);
  if (!obj) return false;
  // A Tray pode retornar diferentes error_code para token inválido/expirado
  // Ex.: 1000 (token expired) e 1099 ("Token inválido ou expirado")
  const causes = Array.isArray(obj.causes) ? obj.causes.map((c) => String(c)) : [];
  return (
    obj.code === 401 &&
    (obj.error_code === 1000 ||
      obj.error_code === 1099 ||
      causes.some((c) => /token\s+inv/i.test(c) || /expir/i.test(c) || /unauthorized/i.test(c)))
  );
}

function isTrayTokenErrorText(text: string): boolean {
  // Às vezes o JSON não é parseado e sobra só o texto. Também pode vir com escapes (\u00e1 etc).
  return /token\s+inv/i.test(text) || /expir/i.test(text) || /unauthorized\s+access/i.test(text);
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
  const buildUrl = () =>
    `${ctx.baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(ctx.accessToken)}`;

  const MAX_RETRIES_504 = 5;
  const RETRY_DELAY_MS_504 = 60_000; // 1 minute

  let { status, json, text } = { status: 0, json: null as unknown, text: "" };

  for (let attempt = 1; attempt <= MAX_RETRIES_504; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await httpGetJson(buildUrl());
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

    // Token expired: reauth once, then retry immediately
    if (status === 401 && (isTrayTokenError(json) || isTrayTokenErrorText(text))) {
      // eslint-disable-next-line no-await-in-loop
      await reauth();
      // eslint-disable-next-line no-await-in-loop
      const retry = await httpGetJson(buildUrl());
      status = retry.status;
      json = retry.json;
      text = retry.text;
      // se após reauth cair em 504, respeita o loop de retry
      if (status === 504 && attempt < MAX_RETRIES_504) {
        console.warn(`[tray:orders] HTTP 504 on ${pathWithQuery} after reauth (retry ${attempt}/${MAX_RETRIES_504} in 60s)`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(RETRY_DELAY_MS_504);
        continue;
      }
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

function normalizeTimeHms(value: string | null): string | null {
  const t = (value ?? "").trim();
  return /^\d{2}:\d{2}:\d{2}$/.test(t) ? t : null;
}

function parseDateTimeFromYmdHms(dateYmd: string | null, timeHms: string | null): Date | null {
  if (!dateYmd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const [y, m, d] = dateYmd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;

  const t = normalizeTimeHms(timeHms);
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length !== 3) return null;
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
    return null;
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
  const t = todayUtc();
  const startDate = partial.startDate ?? y;
  // Regra de default:
  // - sem datas: ontem..hoje
  // - com apenas --start-date: endDate = startDate
  const endDate = partial.endDate ?? (partial.startDate ? partial.startDate : t);
  const onlyInsert = Boolean(partial.onlyInsert);
  const debugExisting = Boolean(partial.debugExisting);
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
  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let processedOrdersForLog = 0;
  let createdCustomersForLog = 0;
  let insertedOrdersForLog = 0;
  let upsertedOrdersForLog = 0;
  let updatedOrdersForLog = 0;
  let orderDatesBackfilledForLog = 0;
  let failedOrdersForLog = 0;
  let skippedOnlyInsertForLog = 0;
  let integrationLogId: number | null = null;

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
    companyRefForLog = companyRef;

    const platform = await plataformRepo.findOne({ where: { slug: "tray" } });
    if (!platform) throw new Error('Platform slug="tray" não encontrada. Cadastre e instale antes.');
    platformRefForLog = platform;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: companyEntity.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Platform "tray" não está instalada nessa company.');

    // cria log "Processando..." imediatamente (para aparecer na tela)
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const started = await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: ymdToDate(formatDate(start)),
          company: companyRef,
          platform,
          command: "Pedidos",
          status: "PROCESSANDO",
          log: {
            company: companyIdNum,
            platform: { id: platform.id, slug: "tray" },
            command: "Pedidos",
            startDate: formatDate(start),
            endDate: formatDate(end),
            onlyInsert,
            status: "PROCESSANDO",
            inserted: 0,
            upserted: 0,
            updated: 0,
            failed: 0,
            skipped_only_insert: 0,
          },
          errors: null,
        }),
      );
      integrationLogId = started.id;
    } catch (e) {
      console.warn("[tray:orders] falha ao gravar log inicial (PROCESSANDO):", e);
    }

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
    let insertedOrdersCount = 0;
    let upsertedOrdersCount = 0;
    let updatedOrdersCount = 0;
    let orderDatesBackfilledCount = 0;
    let failedOrdersCount = 0;
    let skippedOnlyInsertCount = 0;
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
    const orderDetailCache = new Map<
      number,
      { date: string | null; hour: string | null; marketplaceCreated: string | null; modified: string | null }
    >();

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

    // Busca direta por período (BETWEEN) na Tray: mais eficiente que dia-a-dia.
    const startYmd = formatDate(start);
    const endYmd = formatDate(end);
    const dateRangeParam = `${startYmd},${endYmd}`;
    currentDateStr = `${startYmd}..${endYmd}`;

    let page = 1;
    const limit = 50;
    let rangeTotal: number | null = null;

    // paginação
    while (true) {
      progressTick += 1;
      progressPage = page;
      currentAction = "buscando orders";
      updateProgress(progressTick % 3 === 0);

      const { json } = await trayGetJson(
        ctx,
        `/orders?date=${encodeURIComponent(dateRangeParam)}&page=${page}&limit=${limit}`,
        reauth,
      );
        const root = asRecord(json) ?? {};
        const paging = asRecord(root.paging) ?? {};
        const total = pickNumber(paging, "total") ?? null;
        if (rangeTotal === null && total !== null) {
          rangeTotal = total;
          totalOrdersExpected = total;
          updateProgress(true);
        }
        const ordersArr = ensureArray(root.Orders);
        if (ordersArr.length === 0) break;

        const pageOrders: Array<{ id: number; orderObj: Record<string, unknown>; trayCustomerId: string | null }> = [];
        const orderCodes: number[] = [];
        const customerExternalIds = new Set<string>();

        for (const wrapper of ordersArr) {
          const w = asRecord(wrapper);
          const orderObj = w ? asRecord(w.Order) : null;
          if (!orderObj) continue;
          const id = pickNumber(orderObj, "id");
          if (!id) continue;
          const trayCustomerId = pickString(orderObj, "customer_id");
          pageOrders.push({ id, orderObj, trayCustomerId });
          orderCodes.push(id);
          if (trayCustomerId) customerExternalIds.add(trayCustomerId);
        }

        // Prefetch do banco (por página): elimina N+1 (findOne por order/customer)
        const existingOrdersArr = orderCodes.length
          ? await withRetry(
              "db find existing orders (page)",
              () =>
                orderRepo.find({
                  where: { company: { id: companyEntity.id }, orderCode: In(orderCodes) },
                }),
              3,
            )
          : [];
        const existingOrdersByCode = new Map<number, Order>();
        for (const o of existingOrdersArr) existingOrdersByCode.set(o.orderCode, o);

        const customerExternalIdArr = Array.from(customerExternalIds);
        const existingCustomersArr = customerExternalIdArr.length
          ? await withRetry(
              "db find existing customers (page)",
              () =>
                customerRepo.find({
                  where: { company: { id: companyEntity.id }, externalId: In(customerExternalIdArr) },
                }),
              3,
            )
          : [];
        const existingCustomersByExternalId = new Map<string, Customer>();
        for (const c of existingCustomersArr) {
          if (!c.externalId) continue;
          existingCustomersByExternalId.set(c.externalId, c);
          customerCache.set(c.externalId, c);
        }

        const ordersToUpdate: Order[] = [];
        const backfillOrderDates: Array<{ orderCode: number; orderDate: Date }> = [];
        const orderCodesNeedingDetailBackfill = new Set<number>();
        const ordersToInsert: Order[] = [];
        const orderObjByCode = new Map<number, Record<string, unknown>>();

        const addBackfillOrderDate = (orderCode: number, candidate: Date | null) => {
          if (!candidate) return;
          backfillOrderDates.push({ orderCode, orderDate: candidate });
        };

        const isMidnightUtc = (d: Date) =>
          d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

        const shouldUpdateOrderDate = (existing: Date | null | undefined, candidate: Date) => {
          if (!existing) return true;
          // Se a data (YYYY-MM-DD) for diferente, é quase certamente erro de preenchimento anterior.
          if (dateToYmd(existing) !== dateToYmd(candidate)) return true;
          // Se estava em 00:00:00 e agora temos uma hora real, atualiza.
          if (isMidnightUtc(existing) && !isMidnightUtc(candidate)) return true;
          return false;
        };

        const getCandidateFromList = (orderObj: Record<string, unknown>): Date | null => {
          const ymd = normalizeDateString(pickString(orderObj, "date"));
          const hourFromList = normalizeTimeHms(pickString(orderObj, "hour"));
          let createdSql: string | null = null;
          const moArr = ensureArray(orderObj.MarketplaceOrder);
          const mo0 = moArr.length ? asRecord(moArr[0]) : null;
          if (mo0) createdSql = pickString(mo0, "created");
          return parseDateTimeFromSql(createdSql) ?? (hourFromList ? parseDateTimeFromYmdHms(ymd, hourFromList) : null);
        };

        for (const { id, orderObj, trayCustomerId } of pageOrders) {
          let order = existingOrdersByCode.get(id) ?? null;
          const orderExists = Boolean(order);
          if (!order) order = orderRepo.create({ orderCode: id });
          if (!orderExists) orderObjByCode.set(id, orderObj);

          // --onlyInsert: ignora totalmente updates; só insere pedidos inexistentes no banco.
          if (onlyInsert && orderExists) {
            skippedOnlyInsertCount += 1;
            processedOrders += 1;
            currentAction = rangeTotal ? `processando (${processedOrders}/${rangeTotal})` : "processando";
            updateProgress(processedOrders % 10 === 0);
            continue;
          }

          // Customer: a lista só traz customer_id, sem CPF/CNPJ.
          // Vamos criar/usar um "taxId" sintético para manter relacionamento, e sinalizar que campos reais não foram preenchidos.
          let customer: Customer | null = null;
          let customerObjForOrder: Record<string, unknown> | null = null;
          // Otimização: se o pedido já existe, não fazemos requests individuais de customer.
          // O objetivo aqui é atualizar rápido o básico (principalmente status) com o que já vem na listagem.
          if (!orderExists && trayCustomerId) {
            const cached = customerCache.get(trayCustomerId);
            if (cached) {
              customer = cached;
              // delivery por pedido ficará como estava/NULL se não houver payload do customer
            } else {
              currentAction = `buscando customer ${trayCustomerId}`;
              updateProgress(true);
              let customerJson: unknown = null;
              try {
                ({ json: customerJson } = await trayGetJson(ctx, `/customers/${encodeURIComponent(trayCustomerId)}`, reauth));
              } catch (err) {
                // Não derruba o job por falha pontual de customer (401 persistente, customer não encontrado, etc.)
                console.error(
                  `[tray:orders] falha ao buscar customer ${trayCustomerId}; seguindo sem customer. order_id=${id}`,
                  err,
                );
                customerObjForOrder = null;
                customer = null;
                continue;
              }
              const customerRoot = asRecord(customerJson) ?? {};
              const customerObj = asRecord(customerRoot.Customer);
              if (customerObj) {
                customerObjForOrder = customerObj;
                const cpf = pickString(customerObj, "cpf");
                const cnpj = pickString(customerObj, "cnpj");
                const taxIdRaw = cpf && normalizeCpfCnpj(cpf) ? cpf : cnpj;
                const taxId =
                  taxIdRaw && normalizeCpfCnpj(taxIdRaw) ? normalizeCpfCnpj(taxIdRaw) : `tray_customer:${trayCustomerId}`;

                customer = existingCustomersByExternalId.get(trayCustomerId) ?? customerCache.get(trayCustomerId) ?? null;
                if (!customer) {
                  customer = customerRepo.create({
                    company: companyEntity,
                    externalId: trayCustomerId,
                    taxId,
                  });
                }
                customer.company = companyEntity;
                customer.externalId = trayCustomerId;
                customer.taxId = taxId;

                customer.legalName = pickString(customerObj, "name");
                customer.email = pickString(customerObj, "email");
                customer.birthDate = normalizeDateString(pickString(customerObj, "birth_date"));
                customer.gender = toGender(pickString(customerObj, "gender")) ?? null;
                customer.personType = toPersonType(pickString(customerObj, "type")) ?? null;
                customer.state = toBrazilianState(pickString(customerObj, "state")) ?? null;
                customer.tradeName = pickString(customerObj, "company_name");

                customer.phones = {
                  phone: pickString(customerObj, "phone"),
                  cellphone: pickString(customerObj, "cellphone"),
                };

                customer.raw = customerJson ?? null;
                try {
                  customer = await customerRepo.save(customer);
                } catch (err: any) {
                  // Mesma corrida do orders: pode existir concorrência e o INSERT bater no UNIQUE.
                  const code = err?.driverError?.code ?? err?.code;
                  const constraint = err?.driverError?.constraint ?? err?.constraint;
                  if (code === "23505" && constraint === "UQ_customers_company_id_external_id") {
                    console.warn(
                      `[tray:orders] customer duplicado (unique); tentando atualizar existente. company_id=${companyEntity.id} external_id=${trayCustomerId}`,
                    );
                    const existing = await withRetry(
                      `db findOne customer after unique external_id=${trayCustomerId}`,
                      () =>
                        customerRepo.findOne({
                          where: { company: { id: companyEntity.id }, externalId: trayCustomerId },
                        }),
                      3,
                    );
                    if (!existing) {
                      console.warn(
                        `[tray:orders] violação de unique em customer, mas não encontrei o registro existente; seguindo sem customer. company_id=${companyEntity.id} external_id=${trayCustomerId}`,
                      );
                      customer = null;
                      customerObjForOrder = null;
                    } else {
                      customerRepo.merge(existing, customer);
                      try {
                        customer = await customerRepo.save(existing);
                      } catch (err2) {
                        console.error(
                          `[tray:orders] falha ao re-salvar customer após unique; seguindo sem customer. company_id=${companyEntity.id} external_id=${trayCustomerId}`,
                          err2,
                        );
                        customer = null;
                        customerObjForOrder = null;
                      }
                    }
                  } else {
                    console.error(
                      `[tray:orders] erro ao salvar customer; seguindo sem customer. company_id=${companyEntity.id} external_id=${trayCustomerId}`,
                      err,
                    );
                    customer = null;
                    customerObjForOrder = null;
                  }
                }
                if (customer) {
                  customerCache.set(trayCustomerId, customer);
                  if (customer.externalId) existingCustomersByExternalId.set(customer.externalId, customer);
                }
                customerRawCache.set(trayCustomerId, customerJson ?? null);
                if (!cached) createdCustomers += 1;
              }
            }
          }

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

          // Fast path: pedido já existe → atualiza somente o básico (status vindo da listagem),
          // sem requests individuais e sem regravar jsonb/raw.
          if (orderExists) {
            if (debugExisting) {
              const moArrDbg = ensureArray(orderObj.MarketplaceOrder);
              const mo0Dbg = moArrDbg.length ? asRecord(moArrDbg[0]) : null;
              const createdDbg = mo0Dbg ? pickString(mo0Dbg, "created") : null;
              const hourDbg = pickString(orderObj, "hour");
              const dateDbg = pickString(orderObj, "date");

              let dbRow: any = null;
              try {
                dbRow = await withRetry(
                  `db debug select order company_id=${companyEntity.id} order_code=${order.orderCode}`,
                  () =>
                    AppDataSource.query(`SELECT * FROM orders WHERE company_id = $1 AND order_code = $2 LIMIT 1`, [
                      companyEntity.id,
                      order.orderCode,
                    ]),
                  3,
                );
              } catch (e) {
                dbRow = { error: String((e as any)?.message ?? e) };
              }

              console.error("\n[tray:orders][DEBUG] pedido marcado como existente (orderExists=true). Abortando.");
              console.error("[tray:orders][DEBUG] chave:", {
                company_id: companyEntity.id,
                order_code: order.orderCode,
              });
              console.error("[tray:orders][DEBUG] DB entity (parcial):", {
                id: (order as any)?.id ?? null,
                order_code: order.orderCode,
                order_date: (order as any)?.orderDate ?? null,
                created_at: (order as any)?.createdAt ?? null,
                updated_at: (order as any)?.updatedAt ?? null,
                current_status: (order as any)?.currentStatus ?? null,
                current_status_code: (order as any)?.currentStatusCode ?? null,
              });
              console.error("[tray:orders][DEBUG] DB row (SELECT *):", Array.isArray(dbRow) ? dbRow[0] ?? null : dbRow);
              console.error("[tray:orders][DEBUG] Tray list (parcial):", {
                id,
                date: dateDbg,
                hour: hourDbg,
                marketplace_created: createdDbg,
                status: pickString(orderObj, "status"),
                external_code: pickString(orderObj, "external_code"),
              });
              throw new Error(
                `[DEBUG] orderExists=true para company_id=${companyEntity.id} order_code=${order.orderCode} (ver output acima)`,
              );
            }

            // Correção de order_date: se o pedido já existe mas o order_date está ausente OU claramente errado,
            // tenta ajustar sem calls extras; se não der, agenda busca do detalhe do pedido.
            const candidate = getCandidateFromList(orderObj);
            if (candidate) {
              if (shouldUpdateOrderDate(order.orderDate ?? null, candidate)) addBackfillOrderDate(order.orderCode, candidate);
            } else if (!order.orderDate || isMidnightUtc(order.orderDate)) {
              // se não veio hora/created na listagem e o que temos é nulo/00:00:00, tenta no detalhe
              orderCodesNeedingDetailBackfill.add(order.orderCode);
            }

            ordersToUpdate.push(order);
            processedOrders += 1;
            currentAction = rangeTotal ? `processando (${processedOrders}/${rangeTotal})` : "processando";
            updateProgress(processedOrders % 10 === 0);
            continue;
          }

          const ymd = normalizeDateString(pickString(orderObj, "date"));
          // 1) Preferência: hora de criação do pedido vindo do marketplace (MarketplaceOrder[0].created)
          let createdSql: string | null = null;
          const moArr = ensureArray(orderObj.MarketplaceOrder);
          const mo0 = moArr.length ? asRecord(moArr[0]) : null;
          if (mo0) createdSql = pickString(mo0, "created");

          let orderDate = parseDateTimeFromSql(createdSql);
          // 2) Se a listagem trouxer hour válido, usa date+hour.
          // Importante: NÃO cair para 00:00:00 quando "hour" não vier na listagem,
          // pois isso impediria o fallback que busca o detalhe do pedido (onde o hour costuma existir).
          if (!orderDate) {
            const hourFromList = normalizeTimeHms(pickString(orderObj, "hour"));
            if (hourFromList) orderDate = parseDateTimeFromYmdHms(ymd, hourFromList);
          }
          // 3) Fallback: buscar detalhe do pedido para tentar pegar "hour"
          // Otimização: se o pedido já existe, não buscamos detalhe (request individual).
          if (!orderDate && !orderExists) {
            const cached = orderDetailCache.get(id);
            let dateFromDetail: string | null = cached?.date ?? null;
            let hourFromDetail: string | null = cached?.hour ?? null;
            let createdFromDetail: string | null = cached?.marketplaceCreated ?? null;
            let modifiedFromDetail: string | null = cached?.modified ?? null;

            if (!cached) {
              currentAction = `buscando detalhe do pedido ${id}`;
              updateProgress(true);
              const { json: detailJson } = await trayGetJson(ctx, `/orders/${encodeURIComponent(String(id))}`, reauth);
              const root = asRecord(detailJson) ?? {};
              const det = asRecord(root.Order) ?? asRecord(root.order) ?? root;
              dateFromDetail = normalizeDateString(pickString(det, "date"));
              hourFromDetail = pickString(det, "hour");
              modifiedFromDetail = pickString(det, "modified");
              const detMoArr = ensureArray((det as any)?.MarketplaceOrder);
              const detMo0 = detMoArr.length ? asRecord(detMoArr[0]) : null;
              createdFromDetail = detMo0 ? pickString(detMo0, "created") : null;
              orderDetailCache.set(id, {
                date: dateFromDetail,
                hour: hourFromDetail,
                marketplaceCreated: createdFromDetail,
                modified: modifiedFromDetail,
              });
            }

            const hourFromDetailHms = normalizeTimeHms(hourFromDetail);
            orderDate =
              parseDateTimeFromSql(createdFromDetail) ??
              (hourFromDetailHms ? parseDateTimeFromYmdHms(dateFromDetail ?? ymd, hourFromDetailHms) : null) ??
              // último fallback para não salvar 00:00:00 (ex.: quando hour não vem por algum motivo)
              parseDateTimeFromSql(modifiedFromDetail) ??
              parseDateTimeFromSql(pickString(orderObj, "modified"));
          }

          // Para pedidos já existentes, preserva orderDate anterior se não conseguimos inferir pela listagem.
          if (orderDate) {
            order.orderDate = orderDate;
          } else if (!orderExists) {
            order.orderDate = null;
          }
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
          ordersToInsert.push(order);

          processedOrders += 1;
          currentAction = rangeTotal ? `processando (${processedOrders}/${rangeTotal})` : "processando";
          updateProgress(processedOrders % 10 === 0);
        }

        // Se o pedido já existe mas a listagem não trouxe hora/created, buscamos detalhe para preencher order_date corretamente.
        if (orderCodesNeedingDetailBackfill.size > 0) {
          const ids = Array.from(orderCodesNeedingDetailBackfill);
          for (const group of chunkArray(ids, 5)) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(
              group.map(async (orderCode) => {
                try {
                  const cached = orderDetailCache.get(orderCode);
                  let dateFromDetail: string | null = cached?.date ?? null;
                  let hourFromDetail: string | null = cached?.hour ?? null;
                  let createdFromDetail: string | null = cached?.marketplaceCreated ?? null;
                  let modifiedFromDetail: string | null = cached?.modified ?? null;

                  if (!cached) {
                    const { json: detailJson } = await trayGetJson(ctx, `/orders/${encodeURIComponent(String(orderCode))}`, reauth);
                    const root = asRecord(detailJson) ?? {};
                    const det = asRecord(root.Order) ?? asRecord(root.order) ?? root;
                    dateFromDetail = normalizeDateString(pickString(det, "date"));
                    hourFromDetail = pickString(det, "hour");
                    modifiedFromDetail = pickString(det, "modified");
                    const detMoArr = ensureArray((det as any)?.MarketplaceOrder);
                    const detMo0 = detMoArr.length ? asRecord(detMoArr[0]) : null;
                    createdFromDetail = detMo0 ? pickString(detMo0, "created") : null;
                    orderDetailCache.set(orderCode, {
                      date: dateFromDetail,
                      hour: hourFromDetail,
                      marketplaceCreated: createdFromDetail,
                      modified: modifiedFromDetail,
                    });
                  }

                  const hourHms = normalizeTimeHms(hourFromDetail);
                  const candidate =
                    parseDateTimeFromSql(createdFromDetail) ??
                    (hourHms ? parseDateTimeFromYmdHms(dateFromDetail, hourHms) : null) ??
                    // fallback final: se não tiver hour nem created, tenta modified para não ficar NULL
                    parseDateTimeFromSql(modifiedFromDetail);
                  if (candidate) {
                    const existing = existingOrdersByCode.get(orderCode) ?? null;
                    if (!existing || shouldUpdateOrderDate(existing.orderDate ?? null, candidate)) addBackfillOrderDate(orderCode, candidate);
                  }
                } catch (e) {
                  // não derruba job por falha de detalhe
                  failedOrdersCount += 1;
                  console.error(`[tray:orders] falha ao buscar detalhe p/ backfill order_date. order_code=${orderCode}`, e);
                }
              }),
            );
          }
        }

        // Persiste em lote (por página) para reduzir roundtrips no banco.
        if (ordersToUpdate.length > 0) {
          updatedOrdersCount += ordersToUpdate.length;
          // Evita TypeORM save() para updates simples (status), pois ele faz SELECTs internos e aumenta latência/locks.
          // Fazemos UPDATE em lote via SQL: UPDATE orders SET ... FROM (VALUES ...) v WHERE company_id=? AND order_code=v.order_code
          const updates = ordersToUpdate
            .map((o) => ({
              orderCode: o.orderCode,
              currentStatus: (o.currentStatus ?? null) as string | null,
              currentStatusCode: (o.currentStatusCode ?? null) as string | null,
            }))
            .filter((u) => Number.isInteger(u.orderCode) && u.orderCode > 0);

          for (const batch of chunkArray(updates, 10)) {
            if (batch.length === 0) continue;
            const valuesSql = batch
              .map((_, idx) => {
                const base = 2 + idx * 3;
                return `($${base}::int, $${base + 1}::text, $${base + 2}::text)`;
              })
              .join(", ");
            const sql = `
              UPDATE orders o
              SET
                current_status = v.current_status,
                current_status_code = v.current_status_code
              FROM (VALUES ${valuesSql}) AS v(order_code, current_status, current_status_code)
              WHERE o.company_id = $1 AND o.order_code = v.order_code
            `;
            const params: any[] = [companyEntity.id];
            for (const u of batch) params.push(u.orderCode, u.currentStatus, u.currentStatusCode);

            try {
              // eslint-disable-next-line no-await-in-loop
              await withRetry(
                `db batch update orders status (n=${batch.length})`,
                () => AppDataSource.query(sql, params),
                3,
              );
            } catch (err) {
              console.error("[tray:orders] falha no batch update de status; fallback por pedido:", err);
              for (const u of batch) {
                try {
                  // eslint-disable-next-line no-await-in-loop
                  await withRetry(
                    `db update order status order_code=${u.orderCode}`,
                    () =>
                      AppDataSource.query(
                        `UPDATE orders SET current_status = $1, current_status_code = $2 WHERE company_id = $3 AND order_code = $4`,
                        [u.currentStatus, u.currentStatusCode, companyEntity.id, u.orderCode],
                      ),
                    3,
                  );
                } catch (err2) {
                  console.error(
                    `[tray:orders] falha ao atualizar status; pulando. company_id=${companyEntity.id} order_code=${u.orderCode}`,
                    err2,
                  );
                }
              }
            }
          }
        }

        // Backfill de order_date (somente quando está NULL no banco)
        if (backfillOrderDates.length > 0) {
          for (const batch of chunkArray(backfillOrderDates, 10)) {
            if (batch.length === 0) continue;
            const valuesSql = batch.map((_, idx) => `($${2 + idx * 2}::int, $${3 + idx * 2}::timestamp)`).join(", ");
            const sql = `
              UPDATE orders o
              SET order_date = v.order_date
              FROM (VALUES ${valuesSql}) AS v(order_code, order_date)
              WHERE o.company_id = $1
                AND o.order_code = v.order_code
                AND (
                  o.order_date IS NULL
                  OR date(o.order_date) <> date(v.order_date)
                  OR (o.order_date::time = '00:00:00' AND v.order_date::time <> '00:00:00')
                )
              RETURNING o.order_code
            `;
            const params: any[] = [companyEntity.id];
            for (const u of batch) params.push(u.orderCode, u.orderDate);
            try {
              // eslint-disable-next-line no-await-in-loop
              const updatedRows = await withRetry(`db backfill order_date (n=${batch.length})`, () => AppDataSource.query(sql, params), 3);
              orderDatesBackfilledCount += Array.isArray(updatedRows) ? updatedRows.length : 0;
            } catch (err) {
              console.error("[tray:orders] falha ao backfill de order_date; seguindo:", err);
            }
          }
        }

        let insertedOrders: Order[] = [];
        let insertedOrdersForItems: Order[] = [];
        if (ordersToInsert.length > 0) {
          try {
            // eslint-disable-next-line no-await-in-loop
            insertedOrders = await withRetry("save orders batch(insert)", () => orderRepo.save(ordersToInsert, { chunk: 10 }), 3);
            insertedOrdersForItems = insertedOrders;
            insertedOrdersCount += insertedOrdersForItems.length;
          } catch (err) {
            console.error("[tray:orders] falha ao salvar lote de inserts; fallback por pedido:", err);
            for (const o of ordersToInsert) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const saved = await withRetry(`save order(insert) order_code=${o.orderCode}`, () => orderRepo.save(o), 3);
                insertedOrders.push(saved);
                insertedOrdersForItems.push(saved);
                insertedOrdersCount += 1;
              } catch (err2: any) {
                // concorrência: pode cair em unique no insert
                const code = err2?.driverError?.code ?? err2?.code;
                const constraint = err2?.driverError?.constraint ?? err2?.constraint;
                if (code === "23505" && constraint === "UQ_orders_company_id_order_code") {
                  console.warn(
                    `[tray:orders] duplicado (unique) ao inserir pedido; tentando atualizar existente. company_id=${companyEntity.id} order_code=${o.orderCode}`,
                  );
                  // eslint-disable-next-line no-await-in-loop
                  const existing = await withRetry(
                    `db findOne order after unique order_code=${o.orderCode}`,
                    () =>
                      orderRepo.findOne({
                        where: { company: { id: companyEntity.id }, orderCode: o.orderCode },
                      }),
                    3,
                  );
                  if (!existing) {
                    console.warn(
                      `[tray:orders] violação de unique, mas não encontrei o registro existente; pulando. company_id=${companyEntity.id} order_code=${o.orderCode}`,
                    );
                    continue;
                  }
                  orderRepo.merge(existing, o);
                  try {
                    // eslint-disable-next-line no-await-in-loop
                    await orderRepo.save(existing, { reload: false });
                    upsertedOrdersCount += 1;
                  } catch (err3) {
                    console.error(
                      `[tray:orders] falha ao atualizar após unique; pulando. company_id=${companyEntity.id} order_code=${o.orderCode}`,
                      err3,
                    );
                    failedOrdersCount += 1;
                  }
                  continue;
                }
                console.error(
                  `[tray:orders] erro ao inserir pedido; pulando. company_id=${companyEntity.id} order_code=${o.orderCode}`,
                  err2,
                );
                failedOrdersCount += 1;
              }
            }
          }
        }

        // Itens/produtos: somente para pedidos inseridos nesta página.
        for (const savedOrder of insertedOrdersForItems) {
          const orderObj = orderObjByCode.get(savedOrder.orderCode);
          if (!orderObj) continue;
          const productsSold = ensureArray(orderObj.ProductsSold);
          const itemsToSave: OrderItem[] = [];
          for (const p of productsSold) {
            const pObj = asRecord(p);
            if (!pObj) continue;
            const psIdStr = pickString(pObj, "id");
            if (!psIdStr) continue;

            let psRaw = productSoldCache.get(psIdStr);
            if (!psRaw) {
              currentAction = `buscando item ${psIdStr} (order ${savedOrder.orderCode})`;
              updateProgress(true);
              // eslint-disable-next-line no-await-in-loop
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

            // eslint-disable-next-line no-await-in-loop
            const product = await ensureProductBySku(productId, detail, psRaw);

            const item = itemRepo.create({
              company: companyEntity,
              order: savedOrder,
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

            itemsToSave.push(item);
          }
          if (itemsToSave.length > 0) {
            // batch pequeno + retry para evitar estourar conexão quando o DB oscila
            // eslint-disable-next-line no-await-in-loop
            await withRetry(
              `save order_items batch order_code=${savedOrder.orderCode} items=${itemsToSave.length}`,
              () => itemRepo.save(itemsToSave, { chunk: 10 }),
              3,
            );
          }
        }

        // próxima página
        const currentPage = pickNumber(paging, "page") ?? page;
        const currentLimit = pickNumber(paging, "limit") ?? limit;
        const offset = pickNumber(paging, "offset") ?? (currentPage - 1) * currentLimit;
        const nextOffset = offset + currentLimit;
        if (total !== null && nextOffset >= total) break;
      page += 1;
    }

    currentAction = "finalizando";
    updateProgress(true);
    if (IS_TTY) process.stdout.write("\n");
    console.log(
      `[tray:orders] company=${companyIdNum} range=${formatDate(start)}..${formatDate(
        end,
      )} orders_processed=${processedOrders} inserted=${insertedOrdersCount} upserted=${upsertedOrdersCount} updated=${updatedOrdersCount} order_dates_backfilled=${orderDatesBackfilledCount} failed=${failedOrdersCount} skipped_only_insert=${skippedOnlyInsertCount} customers_created=${createdCustomers}`,
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

    processedOrdersForLog = processedOrders;
    createdCustomersForLog = createdCustomers;
    insertedOrdersForLog = insertedOrdersCount;
    upsertedOrdersForLog = upsertedOrdersCount;
    updatedOrdersForLog = updatedOrdersCount;
    orderDatesBackfilledForLog = orderDatesBackfilledCount;
    failedOrdersForLog = failedOrdersCount;
    skippedOnlyInsertForLog = skippedOnlyInsertCount;

    // finaliza o mesmo registro
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "FINALIZADO",
            log: {
              company: companyIdNum,
              platform: { id: platform.id, slug: "tray" },
              command: "Pedidos",
              startDate: formatDate(start),
              endDate: formatDate(end),
              onlyInsert,
              status: "FINALIZADO",
              orders_processed: processedOrdersForLog,
              inserted: insertedOrdersForLog,
              upserted: upsertedOrdersForLog,
              updated: updatedOrdersForLog,
              order_dates_backfilled: orderDatesBackfilledForLog,
              failed: failedOrdersForLog,
              skipped_only_insert: skippedOnlyInsertForLog,
              customers_created: createdCustomersForLog,
            },
            errors: null as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: ymdToDate(formatDate(start)),
            company: companyRef,
            platform,
            command: "Pedidos",
            status: "FINALIZADO",
            log: {
              company: companyIdNum,
              platform: { id: platform.id, slug: "tray" },
              command: "Pedidos",
              startDate: formatDate(start),
              endDate: formatDate(end),
              onlyInsert,
              status: "FINALIZADO",
              orders_processed: processedOrdersForLog,
              inserted: insertedOrdersForLog,
              upserted: upsertedOrdersForLog,
              updated: updatedOrdersForLog,
              order_dates_backfilled: orderDatesBackfilledForLog,
              failed: failedOrdersForLog,
              skipped_only_insert: skippedOnlyInsertForLog,
              customers_created: createdCustomersForLog,
            },
            errors: null,
          }),
        );
      }
    } catch (e) {
      console.warn("[tray:orders] falha ao finalizar log de integração:", e);
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
              company: companyIdNum,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "tray" } : null,
              command: "Pedidos",
              startDate: formatDate(start),
              endDate: formatDate(end),
              onlyInsert,
              status: "ERRO",
              orders_processed: processedOrdersForLog,
              inserted: insertedOrdersForLog,
              upserted: upsertedOrdersForLog,
              updated: updatedOrdersForLog,
              order_dates_backfilled: orderDatesBackfilledForLog,
              failed: failedOrdersForLog,
              skipped_only_insert: skippedOnlyInsertForLog,
              customers_created: createdCustomersForLog,
            },
            errors: errorPayload as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: ymdToDate(formatDate(start)),
            company: companyRefForLog ?? ({ id: companyIdNum } as any),
            platform: platformRefForLog ?? null,
            command: "Pedidos",
            status: "ERRO",
            log: {
              company: companyIdNum,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "tray" } : null,
              command: "Pedidos",
              startDate: formatDate(start),
              endDate: formatDate(end),
              onlyInsert,
              status: "ERRO",
              orders_processed: processedOrdersForLog,
              inserted: insertedOrdersForLog,
              upserted: upsertedOrdersForLog,
              updated: updatedOrdersForLog,
              order_dates_backfilled: orderDatesBackfilledForLog,
              failed: failedOrdersForLog,
              skipped_only_insert: skippedOnlyInsertForLog,
              customers_created: createdCustomersForLog,
            },
            errors: errorPayload,
          }),
        );
      }
    } catch (e) {
      console.warn("[tray:orders] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[tray:orders] erro:", err);
  process.exit(1);
});


