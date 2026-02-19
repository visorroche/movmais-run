import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";

const BRAZIL_TZ = "America/Sao_Paulo";

type Args = {
  company?: number;
};

function parseArgs(argv: string[]): Args {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const companyRaw = raw.get("company");
  const company = companyRaw ? Number(companyRaw) : undefined;
  if (companyRaw !== undefined && (!Number.isInteger(company) || (company ?? 0) <= 0)) {
    throw new Error("Parâmetro inválido: --company=ID (inteiro positivo).");
  }

  return { ...(company !== undefined ? { company } : {}) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();

    try {
      // Garante sessão read-write (evita erro "cannot execute UPDATE in a read-only transaction")
      await runner.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE");
      // Timeout por query: 1h (UPDATE de um dia inteiro pode levar vários minutos)
      await runner.query("SET statement_timeout = '1h'");

      // 1) Listar dias distintos que precisam de backfill (quoted_at em Brasil, com date/time nulos)
      let datesQuery = `
        SELECT DISTINCT (quoted_at AT TIME ZONE $1)::date AS d
        FROM freight_quotes
        WHERE quoted_at IS NOT NULL
          AND (date IS NULL OR time IS NULL)
      `;
      const datesParams: unknown[] = [BRAZIL_TZ];
      if (args.company) {
        datesParams.push(args.company);
        datesQuery += ` AND company_id = $${datesParams.length}`;
      }
      datesQuery += ` ORDER BY d`;

      const datesResult = await runner.query(datesQuery, datesParams);
      const rows = Array.isArray(datesResult) ? datesResult : (datesResult as { rows?: { d: string }[] }).rows ?? [];
      const dates = rows.map((r: { d: string }) => r.d);
      if (dates.length === 0) {
        console.log("[backfill-freight-quote-date-time] Nenhum registro pendente.");
        return;
      }

      console.log(
        `[backfill-freight-quote-date-time] ${dates.length} dia(s) com registros pendentes (company=${args.company ?? "ALL"})`,
      );

      const updateQuery = args.company
        ? `
          UPDATE freight_quotes
          SET
            date = to_char(quoted_at AT TIME ZONE $1, 'YYYY-MM-DD'),
            time = to_char(quoted_at AT TIME ZONE $1, 'HH24:MI:SS')
          WHERE quoted_at IS NOT NULL
            AND (date IS NULL OR time IS NULL)
            AND (quoted_at AT TIME ZONE $1)::date = $2::date
            AND company_id = $3
        `
        : `
          UPDATE freight_quotes
          SET
            date = to_char(quoted_at AT TIME ZONE $1, 'YYYY-MM-DD'),
            time = to_char(quoted_at AT TIME ZONE $1, 'HH24:MI:SS')
          WHERE quoted_at IS NOT NULL
            AND (date IS NULL OR time IS NULL)
            AND (quoted_at AT TIME ZONE $1)::date = $2::date
        `;

      let totalUpdated = 0;
      for (const day of dates) {
        const updateParams: unknown[] = args.company ? [BRAZIL_TZ, day, args.company] : [BRAZIL_TZ, day];
        const res = await runner.query(updateQuery, updateParams);
        const n = Array.isArray(res) && typeof res[1] === "number" ? res[1] : (res as { rowCount?: number }).rowCount ?? 0;
        totalUpdated += n;
        console.log(`[backfill-freight-quote-date-time] day=${day} updated=${n} total=${totalUpdated}`);
      }

      console.log(
        `[backfill-freight-quote-date-time] done company=${args.company ?? "ALL"} total_updated=${totalUpdated}`,
      );
    } finally {
      await runner.release();
    }
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[backfill-freight-quote-date-time] erro:", err);
  process.exit(1);
});
