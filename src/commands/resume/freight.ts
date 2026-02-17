import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";

const TABLE = "freight_resume";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s: string): string {
  const t = s?.trim();
  if (typeof t !== "string" || t === "" || !DATE_RE.test(t)) {
    throw new Error(`Data inválida (use YYYY-MM-DD): ${s}`);
  }
  return t;
}

/** Retorna datas entre start e end (inclusive), em YYYY-MM-DD. */
function dateRange(start: string, end: string): string[] {
  const a = new Date(start + "T00:00:00Z").getTime();
  const b = new Date(end + "T00:00:00Z").getTime();
  if (a > b) throw new Error("start-date deve ser <= end-date.");
  const out: string[] = [];
  for (let t = a; t <= b; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

/** Argumentos: lista de datas a consolidar (uma ou várias). */
type Args = { dates: string[] };

function parseArgs(argv: string[]): Args {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const startStr = raw.get("start-date")?.trim();
  const endStr = raw.get("end-date")?.trim();
  if (startStr || endStr) {
    if (!startStr || !endStr) {
      throw new Error("Para intervalo use ambos --start-date=YYYY-MM-DD e --end-date=YYYY-MM-DD.");
    }
    const start = parseDate(startStr);
    const end = parseDate(endStr);
    const dates = dateRange(start, end);
    return { dates };
  }

  const dateArg = raw.get("date")?.trim();
  if (typeof dateArg === "string" && dateArg !== "" && DATE_RE.test(dateArg)) {
    return { dates: [dateArg] };
  }
  if (dateArg) {
    throw new Error("Parâmetro --date deve estar no formato YYYY-MM-DD.");
  }

  // Ontem no fuso America/Sao_Paulo (UTC-3), para bater com a data usada na INSERT.
  const now = new Date();
  const brazilOffsetMs = -3 * 60 * 60 * 1000;
  const brazilNow = new Date(now.getTime() + brazilOffsetMs);
  const brazilYesterday = new Date(brazilNow);
  brazilYesterday.setUTCDate(brazilYesterday.getUTCDate() - 1);
  const yyyy = brazilYesterday.getUTCFullYear();
  const mm = String(brazilYesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(brazilYesterday.getUTCDate()).padStart(2, "0");
  return { dates: [`${yyyy}-${mm}-${dd}`] };
}

const INSERT_SQL = `
INSERT INTO ${TABLE} (
  company_id, date, channel, state, freight_range, deadline_bucket,
  total_simulations, total_orders, total_value_simulations, total_value_orders
)
WITH
quotes_with_option AS (
  SELECT
    fq.company_id,
    (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date AS date,
    COALESCE(TRIM(fq.channel), '') AS channel,
    COALESCE(UPPER(TRIM(NULLIF(fq.destination_state, ''))), '') AS state,
    fq.quote_id,
    fq.invoice_value,
    o.shipping_value,
    o.deadline,
    ROW_NUMBER() OVER (
      PARTITION BY fq.id
      ORDER BY o.shipping_value ASC NULLS LAST, o.deadline ASC NULLS LAST
    ) AS rn
  FROM freight_quotes fq
  JOIN freight_quote_options o ON o.freight_quote_id = fq.id
  WHERE fq.quoted_at IS NOT NULL
    AND o.shipping_value IS NOT NULL
    AND o.deadline IS NOT NULL
    AND (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
),
one_per_quote AS (
  SELECT
    company_id,
    date,
    channel,
    state,
    quote_id,
    invoice_value,
    CASE
      WHEN shipping_value = 0 THEN 'R$0,00 (FREE)'
      WHEN shipping_value BETWEEN 0.01 AND 100.00 THEN 'entre R$ 0,01 e R$ 100,00'
      WHEN shipping_value BETWEEN 100.01 AND 200.00 THEN 'entre R$ 100,01 e R$ 200,00'
      WHEN shipping_value BETWEEN 200.01 AND 300.00 THEN 'entre R$ 200,01 e R$ 300,00'
      WHEN shipping_value BETWEEN 300.01 AND 500.00 THEN 'entre R$ 300,01 e R$ 500,00'
      WHEN shipping_value BETWEEN 500.01 AND 1000.00 THEN 'entre R$ 500,01 e R$ 1.000,00'
      WHEN shipping_value BETWEEN 1000.01 AND 10000.00 THEN 'entre R$ 1.000,01 e R$ 10.000,00'
      ELSE 'acima de R$ 10.000,00'
    END AS freight_range,
    CASE
      WHEN deadline <= 0 THEN '>0'
      WHEN deadline <= 5 THEN '>0'
      WHEN deadline <= 10 THEN '>5'
      WHEN deadline <= 15 THEN '>10'
      WHEN deadline <= 20 THEN '>15'
      WHEN deadline <= 25 THEN '>20'
      WHEN deadline <= 30 THEN '>25'
      WHEN deadline <= 35 THEN '>30'
      WHEN deadline <= 40 THEN '>35'
      WHEN deadline <= 45 THEN '>40'
      WHEN deadline <= 60 THEN '>45'
      ELSE '>60'
    END AS deadline_bucket
  FROM quotes_with_option
  WHERE rn = 1
),
with_orders AS (
  SELECT
    q.company_id,
    q.date,
    q.channel,
    q.state,
    q.quote_id,
    q.freight_range,
    q.deadline_bucket,
    q.invoice_value,
    CASE WHEN fo.quote_id IS NOT NULL THEN 1 ELSE 0 END AS is_order,
    fo.freight_amount AS order_value
  FROM one_per_quote q
  LEFT JOIN freight_orders fo ON fo.quote_id = q.quote_id AND fo.company_id = q.company_id
)
SELECT
  company_id,
  date,
  channel,
  state,
  freight_range,
  deadline_bucket,
  COUNT(*)::int AS total_simulations,
  SUM(is_order)::int AS total_orders,
  SUM((invoice_value)::numeric) AS total_value_simulations,
  SUM(CASE WHEN is_order = 1 THEN (order_value)::numeric ELSE NULL END) AS total_value_orders
FROM with_orders
GROUP BY 1, 2, 3, 4, 5, 6
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dates = args.dates;

  console.log(`[resume:freight] consolidando ${dates.length} dia(s) na tabela ${TABLE}: ${dates[0]}${dates.length > 1 ? ` a ${dates[dates.length - 1]}` : ""}`);

  await AppDataSource.initialize();

  /** Extrai quantidade de linhas do resultado (pg retorna { rowCount }, TypeORM às vezes só rows). */
  const rowCount = (r: unknown): number | null => {
    if (Array.isArray(r)) return r.length;
    if (r && typeof r === "object" && "rowCount" in r) {
      const n = (r as { rowCount?: number | null }).rowCount;
      return n != null ? n : null;
    }
    return null;
  };

  try {
    let totalInserted = 0;
    for (const targetDate of dates) {
      const deleteResult = await AppDataSource.query(
        `DELETE FROM ${TABLE} WHERE date = $1::date`,
        [targetDate],
      );
      const deleted = rowCount(deleteResult);
      console.log(`[resume:freight] removidas linhas antigas para ${targetDate} (rowCount=${deleted ?? "?"})`);

      const insertResult = await AppDataSource.query(INSERT_SQL, [targetDate]);
      const inserted = rowCount(insertResult) ?? 0;
      totalInserted += inserted;
      console.log(`[resume:freight] inseridas ${inserted} linhas para ${targetDate}`);
    }
    if (totalInserted === 0 && dates.length > 0) {
      console.log(`[resume:freight] dica: se não há dados no período, confira com sql/diagnostic_freight_resume_dates.sql (ajuste as datas no CTE params).`);
    }
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[resume:freight] erro:", err);
  process.exit(1);
});
