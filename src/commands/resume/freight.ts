import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";

const TABLE = "freight_resume";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Args = {
  dates: string[];
  companyId?: number;
};

type QuoteRow = {
  id: number;
  company_id: number;
  channel: string;
  state: string;
  quote_id: string;
  invoice_value: string | null;
};

type OptionRow = {
  freight_quote_id: number;
  shipping_value: string | null;
  deadline: number | null;
  carrier: string | null;
};

type ItemRow = {
  freight_quote_id: number;
  product_id: number | null;
};

type OrderRow = {
  quote_id: string;
  freight_amount: string | null;
};

type ResumeAgg = {
  companyId: number;
  date: string;
  channel: string;
  state: string;
  freightRange: string | null;
  deadlineBucket: string | null;
  courier: string;
  productId: number | null;
  totalSimulations: number;
  totalOrders: number;
  totalValueSimulations: number;
  totalValueOrders: number;
};

function parseDate(s: string): string {
  const t = s?.trim();
  if (typeof t !== "string" || t === "" || !DATE_RE.test(t)) {
    throw new Error(`Data inválida (use YYYY-MM-DD): ${s}`);
  }
  return t;
}

function dateRange(start: string, end: string): string[] {
  const a = new Date(start + "T00:00:00Z").getTime();
  const b = new Date(end + "T00:00:00Z").getTime();
  if (a > b) throw new Error("start-date deve ser <= end-date.");
  const out: string[] = [];
  for (let t = a; t <= b; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function parseArgs(argv: string[]): Args {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  let companyId: number | undefined;
  const companyRaw = raw.get("company")?.trim();
  if (companyRaw) {
    const n = Number(companyRaw);
    if (!Number.isInteger(n) || n <= 0) throw new Error("Parâmetro inválido: --company=ID (inteiro positivo).");
    companyId = n;
  }

  const startStr = raw.get("start-date")?.trim();
  const endStr = raw.get("end-date")?.trim();
  if (startStr || endStr) {
    if (!startStr || !endStr) {
      throw new Error("Para intervalo use ambos --start-date=YYYY-MM-DD e --end-date=YYYY-MM-DD.");
    }
    return companyId != null
      ? { dates: dateRange(parseDate(startStr), parseDate(endStr)), companyId }
      : { dates: dateRange(parseDate(startStr), parseDate(endStr)) };
  }

  const dateArg = raw.get("date")?.trim();
  if (dateArg && DATE_RE.test(dateArg)) {
    return companyId != null ? { dates: [parseDate(dateArg)], companyId } : { dates: [parseDate(dateArg)] };
  }
  if (dateArg) throw new Error("Parâmetro --date deve estar no formato YYYY-MM-DD.");

  const now = new Date();
  const brazilOffsetMs = -3 * 60 * 60 * 1000;
  const brazilYesterday = new Date(now.getTime() + brazilOffsetMs);
  brazilYesterday.setUTCDate(brazilYesterday.getUTCDate() - 1);
  const ymd = `${brazilYesterday.getUTCFullYear()}-${String(brazilYesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(brazilYesterday.getUTCDate()).padStart(2, "0")}`;
  return companyId != null ? { dates: [ymd], companyId } : { dates: [ymd] };
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function freightRangeFromShippingValue(shippingValue: string | number | null | undefined): string | null {
  const v = toNum(shippingValue);
  if (shippingValue == null || shippingValue === "") return null;
  if (v === 0) return "R$0,00 (FREE)";
  if (v <= 100) return "entre R$ 0,01 e R$ 100,00";
  if (v <= 200) return "entre R$ 100,01 e R$ 200,00";
  if (v <= 300) return "entre R$ 200,01 e R$ 300,00";
  if (v <= 500) return "entre R$ 300,01 e R$ 500,00";
  if (v <= 1000) return "entre R$ 500,01 e R$ 1.000,00";
  if (v <= 10000) return "entre R$ 1.000,01 e R$ 10.000,00";
  return "acima de R$ 10.000,00";
}

function deadlineBucketFromDeadline(deadline: number | null | undefined): string | null {
  if (deadline == null) return null;
  const d = deadline;
  if (d <= 0) return ">0";
  if (d <= 5) return ">0";
  if (d <= 10) return ">5";
  if (d <= 15) return ">10";
  if (d <= 20) return ">15";
  if (d <= 25) return ">20";
  if (d <= 30) return ">25";
  if (d <= 35) return ">30";
  if (d <= 40) return ">35";
  if (d <= 45) return ">40";
  if (d <= 60) return ">45";
  return ">60";
}

function aggKey(
  channel: string,
  state: string,
  freightRange: string | null,
  deadlineBucket: string | null,
  courier: string,
  productId: number | null,
): string {
  return [channel, state, freightRange ?? "", deadlineBucket ?? "", courier, productId ?? "null"].join("\u0001");
}

function getOrCreateAgg(
  map: Map<string, ResumeAgg>,
  row: Omit<ResumeAgg, "totalSimulations" | "totalOrders" | "totalValueSimulations" | "totalValueOrders">,
): ResumeAgg {
  const key = aggKey(row.channel, row.state, row.freightRange, row.deadlineBucket, row.courier, row.productId);
  let agg = map.get(key);
  if (!agg) {
    agg = { ...row, totalSimulations: 0, totalOrders: 0, totalValueSimulations: 0, totalValueOrders: 0 };
    map.set(key, agg);
  }
  return agg;
}

const QUOTES_PAGE_SQL = `
SELECT
  fq.id,
  fq.company_id,
  COALESCE(TRIM(fq.channel), '') AS channel,
  COALESCE(UPPER(TRIM(NULLIF(fq.destination_state, ''))), '') AS state,
  fq.quote_id,
  fq.invoice_value::text AS invoice_value
FROM freight_quotes fq
WHERE fq.company_id = $1::int
  AND (
    fq.date = $2::text
    OR (
      fq.date IS NULL
      AND fq.quoted_at IS NOT NULL
      AND (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date
    )
  )
ORDER BY fq.id ASC
LIMIT $3::int OFFSET $4::int
`;

const OPTIONS_FOR_QUOTES_SQL = `
SELECT
  o.freight_quote_id,
  o.shipping_value::text AS shipping_value,
  o.deadline,
  o.carrier
FROM freight_quote_options o
WHERE o.freight_quote_id = ANY($1::int[])
  AND o.shipping_value IS NOT NULL
  AND o.deadline IS NOT NULL
ORDER BY o.freight_quote_id ASC, o.shipping_value::numeric ASC NULLS LAST, o.deadline ASC NULLS LAST
`;

const ITEMS_FOR_QUOTES_SQL = `
SELECT
  fqi.quote_id AS freight_quote_id,
  fqi.product_id
FROM freight_quotes_items fqi
WHERE fqi.company_id = $1::int
  AND fqi.quote_id = ANY($2::int[])
`;

const ORDERS_FOR_QUOTES_SQL = `
SELECT fo.quote_id, fo.freight_amount::text AS freight_amount
FROM freight_orders fo
WHERE fo.company_id = $1::int
  AND fo.quote_id = ANY($2::text[])
`;

async function queryLocal<T>(sql: string, params: unknown[], statementTimeoutMs: number): Promise<T> {
  return AppDataSource.manager.transaction(async (manager) => {
    await manager.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}'`);
    return (await manager.query(sql, params)) as T;
  });
}

async function loadCompanyIds(onlyCompanyId?: number): Promise<number[]> {
  if (onlyCompanyId != null) return [onlyCompanyId];
  const rows = (await AppDataSource.query(`SELECT id FROM companies ORDER BY id ASC`)) as Array<{ id: number }>;
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
}

async function fetchQuotesPage(
  companyId: number,
  targetDate: string,
  offset: number,
  limit: number,
  statementTimeoutMs: number,
): Promise<QuoteRow[]> {
  return queryLocal<QuoteRow[]>(QUOTES_PAGE_SQL, [companyId, targetDate, limit, offset], statementTimeoutMs);
}

function bestOptionByQuoteId(options: OptionRow[]): Map<number, OptionRow> {
  const map = new Map<number, OptionRow>();
  for (const o of options) {
    if (!map.has(o.freight_quote_id)) map.set(o.freight_quote_id, o);
  }
  return map;
}

function itemsByQuoteId(items: ItemRow[]): Map<number, Array<number | null>> {
  const map = new Map<number, Set<number | null>>();
  for (const it of items) {
    let set = map.get(it.freight_quote_id);
    if (!set) {
      set = new Set();
      map.set(it.freight_quote_id, set);
    }
    set.add(it.product_id);
  }
  const out = new Map<number, Array<number | null>>();
  for (const [qid, set] of map) {
    out.set(qid, [...set]);
  }
  return out;
}

function productLinesForQuote(quoteId: number, itemsMap: Map<number, Array<number | null>>): Array<number | null> {
  const raw = itemsMap.get(quoteId);
  if (!raw || raw.length === 0) return [null];
  return raw;
}

function accumulateQuote(
  map: Map<string, ResumeAgg>,
  quote: QuoteRow,
  targetDate: string,
  best: OptionRow | undefined,
  productLines: Array<number | null>,
  order: OrderRow | undefined,
): void {
  const lineCount = Math.max(productLines.length, 1);
  const invoiceTotal = toNum(quote.invoice_value);
  const invoiceShare = invoiceTotal / lineCount;
  const hasOrder = Boolean(order);
  const orderTotal = toNum(order?.freight_amount);
  const orderShare = hasOrder ? orderTotal / lineCount : 0;

  const freightRange = best ? freightRangeFromShippingValue(best.shipping_value) : null;
  const deadlineBucket = best ? deadlineBucketFromDeadline(best.deadline) : null;
  const courier = String(best?.carrier ?? "").trim();

  for (const productId of productLines) {
    const agg = getOrCreateAgg(map, {
      companyId: quote.company_id,
      date: targetDate,
      channel: quote.channel,
      state: quote.state,
      freightRange,
      deadlineBucket,
      courier,
      productId: productId ?? null,
    });
    agg.totalSimulations += 1;
    agg.totalValueSimulations += invoiceShare;
    if (hasOrder) {
      agg.totalOrders += 1;
      agg.totalValueOrders += orderShare;
    }
  }
}

async function processQuotesPage(
  map: Map<string, ResumeAgg>,
  quotes: QuoteRow[],
  targetDate: string,
  companyId: number,
  statementTimeoutMs: number,
): Promise<void> {
  if (!quotes.length) return;

  const quoteIds = quotes.map((q) => q.id);
  const quoteIdStrs = quotes.map((q) => q.quote_id);

  const [options, items, orders] = await Promise.all([
    queryLocal<OptionRow[]>(OPTIONS_FOR_QUOTES_SQL, [quoteIds], statementTimeoutMs),
    queryLocal<ItemRow[]>(ITEMS_FOR_QUOTES_SQL, [companyId, quoteIds], statementTimeoutMs),
    queryLocal<OrderRow[]>(ORDERS_FOR_QUOTES_SQL, [companyId, quoteIdStrs], statementTimeoutMs),
  ]);

  const bestByQuote = bestOptionByQuoteId(options);
  const itemsMap = itemsByQuoteId(items);
  const ordersByQuoteId = new Map(orders.map((o) => [o.quote_id, o]));

  for (const quote of quotes) {
    accumulateQuote(
      map,
      quote,
      targetDate,
      bestByQuote.get(quote.id),
      productLinesForQuote(quote.id, itemsMap),
      ordersByQuoteId.get(quote.quote_id),
    );
  }
}

async function persistAggregates(
  aggregates: Map<string, ResumeAgg>,
  statementTimeoutMs: number,
): Promise<number> {
  const rows = [...aggregates.values()];
  if (!rows.length) return 0;

  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const valueParts: string[] = [];
    let p = 1;

    for (const r of batch) {
      valueParts.push(
        `($${p++}::int, $${p++}::date, $${p++}::varchar, $${p++}::varchar, $${p++}::varchar, $${p++}::varchar, $${p++}::varchar, $${p++}::int, $${p++}::int, $${p++}::int, $${p++}::numeric, $${p++}::numeric)`,
      );
      params.push(
        r.companyId,
        r.date,
        r.channel,
        r.state,
        r.freightRange,
        r.deadlineBucket,
        r.courier,
        r.productId,
        r.totalSimulations,
        r.totalOrders,
        r.totalValueSimulations,
        r.totalValueOrders,
      );
    }

    const sql = `
      INSERT INTO ${TABLE} (
        company_id, date, channel, state, freight_range, deadline_bucket, courier, product_id,
        total_simulations, total_orders, total_value_simulations, total_value_orders
      ) VALUES ${valueParts.join(", ")}
    `;

    await queryLocal(sql, params, statementTimeoutMs);
    inserted += batch.length;
  }

  return inserted;
}

async function consolidateCompanyDay(
  targetDate: string,
  companyId: number,
  pageSize: number,
  statementTimeoutMs: number,
): Promise<{ resumeRows: number; quotesProcessed: number }> {
  const agg = new Map<string, ResumeAgg>();
  let offset = 0;
  let quotesProcessed = 0;
  let pageNum = 0;

  await queryLocal(
    `DELETE FROM ${TABLE} WHERE date = $1::date AND company_id = $2::int`,
    [targetDate, companyId],
    statementTimeoutMs,
  );

  for (;;) {
    pageNum += 1;
    const page = await fetchQuotesPage(companyId, targetDate, offset, pageSize, statementTimeoutMs);
    if (!page.length) break;

    await processQuotesPage(agg, page, targetDate, companyId, statementTimeoutMs);
    quotesProcessed += page.length;
    offset += page.length;

    if (page.length < pageSize) break;
  }

  const resumeRows = await persistAggregates(agg, statementTimeoutMs);
  return { resumeRows, quotesProcessed };
}

async function runCompaniesInParallel(
  companyIds: number[],
  concurrency: number,
  fn: (companyId: number, workerIdx: number) => Promise<void>,
): Promise<void> {
  const queue = companyIds.slice();
  const worker = async (workerIdx: number) => {
    while (queue.length > 0) {
      const companyId = queue.shift();
      if (companyId == null) return;
      await fn(companyId, workerIdx);
    }
  };
  const workerCount = Math.min(concurrency, companyIds.length);
  if (workerCount === 0) return;
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
}

async function main(): Promise<void> {
  const { dates, companyId: onlyCompanyId } = parseArgs(process.argv.slice(2));
  const concurrency = Math.max(
    1,
    Number(process.env.FREIGHT_RESUME_COMPANY_CONCURRENCY ?? process.env.SCHEDULER_COMPANY_CONCURRENCY ?? 4) || 4,
  );
  const pageSize = Math.max(100, Number(process.env.FREIGHT_RESUME_PAGE_SIZE ?? 2000) || 2000);
  const statementTimeoutMs = Number(process.env.FREIGHT_RESUME_STATEMENT_TIMEOUT_MS ?? 120_000);

  console.log(
    `[resume:freight] consolidando ${dates.length} dia(s) em ${TABLE}: ${dates[0]}${dates.length > 1 ? ` a ${dates[dates.length - 1]}` : ""}` +
      `${onlyCompanyId ? ` company=${onlyCompanyId}` : ""} paralelo=${concurrency} page_size=${pageSize} (agregação em código)`,
  );

  await AppDataSource.initialize();

  let companyIds: number[] = [];
  try {
    companyIds = await loadCompanyIds(onlyCompanyId);
  } catch (err: unknown) {
    console.error(`[resume:freight] falha ao listar companies: ${String((err as Error)?.message ?? err)}`);
    await AppDataSource.destroy().catch(() => undefined);
    process.exit(1);
  }

  if (!companyIds.length) {
    console.warn("[resume:freight] nenhuma company para processar.");
    await AppDataSource.destroy().catch(() => undefined);
    return;
  }

  let totalCompanies = 0;
  let totalErrors = 0;
  let totalResumeRows = 0;
  let totalQuotes = 0;

  try {
    for (const targetDate of dates) {
      console.log(
        `[resume:freight] --- ${targetDate} companies=${companyIds.length} (paralelo=${concurrency}) ---`,
      );

      let dayOk = 0;
      let dayRows = 0;
      let dayQuotes = 0;
      const dayErrors: string[] = [];

      await runCompaniesInParallel(companyIds, concurrency, async (companyId, workerIdx) => {
        const t0 = Date.now();
        try {
          const { resumeRows, quotesProcessed } = await consolidateCompanyDay(
            targetDate,
            companyId,
            pageSize,
            statementTimeoutMs,
          );
          const elapsed = Math.round((Date.now() - t0) / 1000);
          if (quotesProcessed === 0) return;

          console.log(
            `[resume:freight] ok date=${targetDate} company=${companyId} quotes=${quotesProcessed} resume_rows=${resumeRows} worker=${workerIdx} elapsed=${elapsed}s`,
          );
          dayOk += 1;
          dayRows += resumeRows;
          dayQuotes += quotesProcessed;
          totalCompanies += 1;
          totalResumeRows += resumeRows;
          totalQuotes += quotesProcessed;
        } catch (err: unknown) {
          totalErrors += 1;
          const msg = String((err as Error)?.message ?? err);
          dayErrors.push(`company ${companyId}: ${msg}`);
          console.error(`[resume:freight] erro date=${targetDate} company=${companyId}: ${msg}`);
        }
      });

      console.log(
        `[resume:freight] dia ${targetDate} finalizado companies_com_dados=${dayOk} quotes=${dayQuotes} resume_rows=${dayRows} erros=${dayErrors.length}`,
      );
    }

    console.log(
      `[resume:freight] concluído companies=${totalCompanies} quotes=${totalQuotes} resume_rows=${totalResumeRows} erros=${totalErrors}`,
    );
    if (totalErrors > 0) process.exitCode = 2;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error("[resume:freight] erro fatal:", err);
  process.exit(1);
});
