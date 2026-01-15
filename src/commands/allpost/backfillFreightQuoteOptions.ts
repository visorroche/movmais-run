import "dotenv/config";
import "reflect-metadata";

import { QueryFailedError } from "typeorm";
import { AppDataSource } from "../../utils/data-source.js";
import { FreightQuote } from "../../entities/FreightQuote.js";
import { FreightQuoteOption } from "../../entities/FreightQuoteOption.js";

type Args = {
  company?: number;
  batch?: number;
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
    throw new Error('Parâmetro inválido: --company=ID (inteiro positivo).');
  }

  const batchRaw = raw.get("batch");
  const batch = batchRaw ? Number(batchRaw) : 500;
  if (!Number.isInteger(batch) || batch <= 0 || batch > 5000) {
    throw new Error('Parâmetro inválido: --batch=N (1..5000).');
  }

  // Evita setar propriedade opcional com undefined (exactOptionalPropertyTypes)
  return { ...(company ? { company } : {}), batch };
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

function parseBooleanFromUnknown(v: unknown): boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "t" || s === "yes" || s === "y" || s === "sim") return true;
  if (s === "false" || s === "f" || s === "no" || s === "n" || s === "nao" || s === "não") return false;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 0;
  return null;
}

function isMissingTable(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const anyErr = err as unknown as { driverError?: { code?: string } };
  // postgres: undefined_table
  return anyErr.driverError?.code === "42P01";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const quoteRepo = AppDataSource.getRepository(FreightQuote);
    const optionRepo = AppDataSource.getRepository(FreightQuoteOption);

    let lastId = 0;
    let totalQuotes = 0;
    let totalOptionsInserted = 0;

    while (true) {
      const qb = quoteRepo
        .createQueryBuilder("fq")
        .leftJoinAndSelect("fq.company", "c")
        .where("fq.id > :lastId", { lastId })
        .andWhere("fq.delivery_options IS NOT NULL")
        .andWhere("jsonb_typeof(fq.delivery_options) = 'array'")
        .andWhere("jsonb_array_length(fq.delivery_options) > 0")
        .orderBy("fq.id", "ASC")
        .take(args.batch ?? 500);

      if (args.company) qb.andWhere("fq.company_id = :companyId", { companyId: args.company });

      // eslint-disable-next-line no-await-in-loop
      const quotes = await qb.getMany();
      if (quotes.length === 0) break;

      for (const q of quotes) {
        lastId = q.id;
        totalQuotes += 1;

        const options = ensureArray(q.deliveryOptions);
        if (options.length === 0) continue;

        const values = options
          .map((opt, idx) => {
            const optObj = asRecord(opt);
            if (!optObj) return null;
            const dadosFrete = asRecord(optObj.dadosFrete ?? null) ?? {};
            const prazoEntrega = asRecord(optObj.prazoEntrega ?? null) ?? {};

            return {
              company: { id: q.company.id } as any,
              freightQuote: { id: q.id } as any,
              lineIndex: idx,

              shippingValue: toNumericString(pickNumber(optObj, "freteCobrar") ?? pickString(optObj, "freteCobrar")),
              shippingCost: toNumericString(pickNumber(optObj, "freteReal") ?? pickString(optObj, "freteReal")),

              carrier: pickString(dadosFrete, "transportadoraNome"),
              warehouseUf: pickString(dadosFrete, "filialUF"),
              warehouseCity: pickString(dadosFrete, "filialCidade"),
              warehouseName: pickString(dadosFrete, "filialNome"),
              shippingName: pickString(dadosFrete, "metodoEnvioNome"),

              carrierDeadline: pickNumber(prazoEntrega, "prazoTransportadora"),
              holidayDeadline: pickNumber(prazoEntrega, "prazoEntregaFeriado"),
              warehouseDeadline: pickNumber(prazoEntrega, "prazoAdicionalFilial"),
              deadline: pickNumber(optObj, "prazoEntregaTotal"),

              hasStock: parseBooleanFromUnknown(optObj.possuiEstoque),
              raw: optObj as any,
            };
          })
          .filter((v): v is NonNullable<typeof v> => Boolean(v));

        if (values.length === 0) continue;

        try {
          // eslint-disable-next-line no-await-in-loop
          const res = await optionRepo
            .createQueryBuilder()
            .insert()
            .into(FreightQuoteOption)
            .values(values)
            .orIgnore()
            .execute();

          totalOptionsInserted += res.identifiers.length;
        } catch (err) {
          if (isMissingTable(err)) {
            throw new Error(
              'Tabela "freight_quote_options" não existe. Rode o SQL em `sql/create_freight_quotes_tables.sql` (ou habilite TYPEORM_SYNC=true em dev).',
            );
          }
          throw err;
        }
      }

      console.log(
        `[allpost:freight-quote-options:backfill] processed_quotes=${totalQuotes} inserted_options=${totalOptionsInserted} last_id=${lastId}`,
      );
    }

    console.log(
      `[allpost:freight-quote-options:backfill] done company=${args.company ?? "ALL"} processed_quotes=${totalQuotes} inserted_options=${totalOptionsInserted}`,
    );
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[allpost:freight-quote-options:backfill] erro:", err);
  process.exit(1);
});

