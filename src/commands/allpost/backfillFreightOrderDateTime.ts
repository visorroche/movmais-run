import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { FreightOrder } from "../../entities/FreightOrder.js";
import { toBrazilDateAndTime } from "../../utils/brazil-date-time.js";

type Args = {
  company?: number;
  batch: number;
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

  const batch = Number(raw.get("batch") ?? 500);
  if (!Number.isInteger(batch) || batch <= 0 || batch > 5000) {
    throw new Error("Parâmetro inválido: --batch=N (1..5000).");
  }

  return { ...(company !== undefined ? { company } : {}), batch };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const repo = AppDataSource.getRepository(FreightOrder);

    let lastId = 0;
    let totalUpdated = 0;

    while (true) {
      const qb = repo
        .createQueryBuilder("fo")
        .select(["fo.id", "fo.orderDate"])
        .where("fo.id > :lastId", { lastId })
        .andWhere("fo.order_date IS NOT NULL")
        .andWhere("(fo.date IS NULL OR fo.time IS NULL)")
        .orderBy("fo.id", "ASC")
        .take(args.batch);

      if (args.company) {
        qb.andWhere("fo.company_id = :companyId", { companyId: args.company });
      }

      const list = await qb.getMany();
      if (list.length === 0) break;

      for (const row of list) {
        lastId = row.id;
        const { date, time } = toBrazilDateAndTime(row.orderDate ?? null);
        await repo.update(row.id, { date: date ?? null, time: time ?? null });
        totalUpdated += 1;
      }

      console.log(
        `[backfill-freight-order-date-time] last_id=${lastId} total_updated=${totalUpdated}`,
      );
    }

    console.log(
      `[backfill-freight-order-date-time] done company=${args.company ?? "ALL"} total_updated=${totalUpdated}`,
    );
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[backfill-freight-order-date-time] erro:", err);
  process.exit(1);
});
