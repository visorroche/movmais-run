import { AppDataSource } from "../utils/data-source.js";
import { AvancoLogisticsOperator } from "../entities/Avanco/AvancoLogisticsOperator.js";

function normalize(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Retorna o operador logístico cujo carrier do pedido bate com algum sinônimo (ou slug).
 * Carrega a relação company para usar operator.company.name como carrier normalizado no pedido.
 */
export async function findAvancoOperatorByCarrier(carrier: string | null | undefined): Promise<AvancoLogisticsOperator | null> {
  const raw = String(carrier ?? "").trim();
  if (!raw) return null;

  const carrierNorm = normalize(raw);
  const repo = AppDataSource.getRepository(AvancoLogisticsOperator);
  const operators = await repo.find({ relations: ["company"] });

  for (const op of operators) {
    const terms: string[] = Array.isArray(op.synonyms) && op.synonyms.length > 0
      ? op.synonyms
      : op.slug
        ? [op.slug]
        : [];
    const match = terms.some((t) => normalize(t) === carrierNorm);
    if (match) return op;
  }
  return null;
}
