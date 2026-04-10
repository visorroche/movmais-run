import { AppDataSource } from "./data-source.js";
import { AvancoLogisticsOperator } from "../entities/Avanco/AvancoLogisticsOperator.js";
import { AvancoStock } from "../entities/Avanco/AvancoStock.js";

function normalize(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** Igualdade exata, substring (nomes longos) ou distância pequena (ex.: Fatelog vs FATLOG). */
function carrierMatchesTerm(carrierNorm: string, termNorm: string): boolean {
  if (!termNorm || !carrierNorm) return false;
  if (carrierNorm === termNorm) return true;
  const minLen = Math.min(carrierNorm.length, termNorm.length);
  const maxLen = Math.max(carrierNorm.length, termNorm.length);
  if (minLen >= 8) {
    if (carrierNorm.includes(termNorm) || termNorm.includes(carrierNorm)) return true;
  }
  if (maxLen < 4) return false;
  const d = levenshtein(carrierNorm, termNorm);
  if (maxLen <= 7) return d <= 1;
  return d <= 2;
}

function collectTerms(op: AvancoLogisticsOperator): string[] {
  const out: string[] = [];
  if (Array.isArray(op.synonyms)) {
    for (const t of op.synonyms) {
      if (typeof t === "string" && t.trim()) out.push(t.trim());
    }
  }
  if (op.slug?.trim()) out.push(op.slug.trim());
  const cname = op.company?.name?.trim();
  if (cname) out.push(cname);
  return [...new Set(out)];
}

async function logisticCompanyIdsForOrigin(companyOriginId: number): Promise<number[] | null> {
  const rows = await AppDataSource.getRepository(AvancoStock)
    .createQueryBuilder("s")
    .select("DISTINCT s.company_logistic_id", "lid")
    .where("s.company_origin_id = :oid", { oid: companyOriginId })
    .getRawMany();
  const ids = rows
    .map((r) => Number((r as { lid?: unknown }).lid))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

export type FindAvancoOperatorOptions = {
  /** Quando informado, só considera operadores cujo company_id já aparece em avanco_stock dessa origem (evita match com outra empresa). Se não houver nenhuma linha de estoque para a origem, não filtra. */
  companyOriginId?: number;
};

/**
 * Operador cujo carrier bate com sinônimo, slug ou nome da company (normalizado).
 * Inclui match aproximado para variações comuns (ex.: Fatelog vs FATLOG).
 */
export async function findAvancoOperatorByCarrier(
  carrier: string | null | undefined,
  opts?: FindAvancoOperatorOptions,
): Promise<AvancoLogisticsOperator | null> {
  const raw = String(carrier ?? "").trim();
  if (!raw) return null;

  const carrierNorm = normalize(raw);
  const repo = AppDataSource.getRepository(AvancoLogisticsOperator);
  let operators = await repo.find({ relations: ["company"] });

  if (opts?.companyOriginId != null) {
    const logisticIds = await logisticCompanyIdsForOrigin(opts.companyOriginId);
    if (logisticIds && logisticIds.length > 0) {
      operators = operators.filter((o) => logisticIds.includes(o.companyId));
    }
  }

  for (const op of operators) {
    const terms = collectTerms(op);
    if (terms.length === 0) continue;
    for (const term of terms) {
      const termNorm = normalize(term);
      if (carrierMatchesTerm(carrierNorm, termNorm)) return op;
    }
  }
  return null;
}
