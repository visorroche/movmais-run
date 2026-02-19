import "dotenv/config";
import "reflect-metadata";

import { In } from "typeorm";
import { AppDataSource } from "../../utils/data-source.js";
import { FreightQuote } from "../../entities/FreightQuote.js";
import { FreightQuoteOption } from "../../entities/FreightQuoteOption.js";

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

  const batch = Number(raw.get("batch") ?? 2000);
  if (!Number.isInteger(batch) || batch <= 0 || batch > 10000) {
    throw new Error("Parâmetro inválido: --batch=N (1..10000).");
  }

  return { ...(company !== undefined ? { company } : {}), batch };
}

type BestOptionRow = { deadline: number; price: number; shippingValueStr: string };

function selectBestOption(
  rows: BestOptionRow[],
): { bestDeadline: number | null; bestFreightCost: string | null } {
  const valid = rows.filter(
    (r) =>
      r.deadline != null &&
      Number.isFinite(r.deadline) &&
      r.deadline > 0 &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price >= 0,
  );
  if (valid.length === 0) return { bestDeadline: null, bestFreightCost: null };

  const minDeadline = Math.min(...valid.map((r) => r.deadline));
  const minPrice = Math.min(...valid.map((r) => r.price));

  const dominant = valid.find((r) => r.deadline === minDeadline && r.price === minPrice);
  if (dominant) {
    return { bestDeadline: dominant.deadline, bestFreightCost: dominant.shippingValueStr };
  }

  const safeMinPrice = minPrice > 0 ? minPrice : 1;
  const first = valid[0];
  if (!first) return { bestDeadline: null, bestFreightCost: null };
  let best: BestOptionRow = first;
  let bestScore = best.deadline / minDeadline + best.price / safeMinPrice;
  for (let i = 1; i < valid.length; i += 1) {
    const r = valid[i];
    if (!r) continue;
    const score = r.deadline / minDeadline + r.price / safeMinPrice;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return { bestDeadline: best.deadline, bestFreightCost: best.shippingValueStr };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const quoteRepo = AppDataSource.getRepository(FreightQuote);
    const optionRepo = AppDataSource.getRepository(FreightQuoteOption);

    // Ordem decrescente: mais recentes primeiro (fev, jan, ...) — id maior = mais recente
    let lastId: number | null = null;
    let totalUpdated = 0;

    while (true) {
      const qb = quoteRepo
        .createQueryBuilder("fq")
        .select(["fq.id"])
        .andWhere("(fq.bestDeadline IS NULL OR fq.bestFreightCost IS NULL)")
        .orderBy("fq.id", "DESC")
        .take(args.batch);

      if (lastId != null) {
        qb.andWhere("fq.id < :lastId", { lastId });
      }
      if (args.company) {
        qb.andWhere("fq.company_id = :companyId", { companyId: args.company });
      }

      const quotes = await qb.getMany();
      if (quotes.length === 0) break;

      const quoteIds = quotes.map((q) => q.id);
      const lastQuote = quotes[quotes.length - 1];
      if (lastQuote) lastId = lastQuote.id;

      const options = await optionRepo.find({
        select: { carrierDeadline: true, shippingValue: true },
        where: { freightQuote: { id: In(quoteIds) } },
        relations: { freightQuote: true },
      });

      const optionsByQuoteId = new Map<number, { carrierDeadline: number | null; shippingValue: string | null }[]>();
      for (const opt of options) {
        const qid = opt.freightQuote?.id;
        if (qid == null) continue;
        if (!optionsByQuoteId.has(qid)) optionsByQuoteId.set(qid, []);
        optionsByQuoteId.get(qid)!.push({
          carrierDeadline: opt.carrierDeadline ?? null,
          shippingValue: opt.shippingValue ?? null,
        });
      }

      const idList: number[] = [];
      const deadlineList: (number | null)[] = [];
      const costList: (string | null)[] = [];
      for (const quote of quotes) {
        const opts = optionsByQuoteId.get(quote.id) ?? [];
        const rows: BestOptionRow[] = [];
        for (const o of opts) {
          const deadline = o.carrierDeadline;
          const shippingValueStr = o.shippingValue;
          const price = shippingValueStr != null ? Number(shippingValueStr) : NaN;
          if (deadline != null && deadline > 0 && Number.isFinite(price) && price >= 0 && shippingValueStr != null) {
            rows.push({ deadline, price, shippingValueStr });
          }
        }
        const { bestDeadline, bestFreightCost } = selectBestOption(rows);
        idList.push(quote.id);
        deadlineList.push(bestDeadline ?? null);
        costList.push(bestFreightCost ?? null);
      }

      if (idList.length > 0) {
        await AppDataSource.query(
          `
          UPDATE freight_quotes AS fq
          SET best_deadline = v.best_deadline, best_freight_cost = v.best_freight_cost::numeric
          FROM (
            SELECT * FROM unnest($1::bigint[], $2::int[], $3::text[]) AS t(id, best_deadline, best_freight_cost)
          ) AS v
          WHERE fq.id = v.id
          `,
          [idList, deadlineList, costList],
        );
        totalUpdated += idList.length;
      }

      console.log(
        `[backfill-freight-quote-best-option] last_id=${lastId} total_updated=${totalUpdated}`,
      );
    }

    console.log(
      `[backfill-freight-quote-best-option] done company=${args.company ?? "ALL"} total_updated=${totalUpdated}`,
    );
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[backfill-freight-quote-best-option] erro:", err);
  process.exit(1);
});
