import { Brackets, type ObjectLiteral, type SelectQueryBuilder } from "typeorm";
import type { Representative } from "../entities/Representative.js";

export function parseAliasesExternalId(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
      }
    } catch {
      return [s];
    }
  }
  return [];
}

export function registerRepresentativeInExternalIdMap(
  map: Map<string, Representative>,
  rep: Representative,
): void {
  const ext = String((rep as any).externalId ?? "").trim();
  if (ext) map.set(ext, rep);
  for (const alias of parseAliasesExternalId((rep as any).aliasesExternalId)) {
    map.set(alias, rep);
  }
}

export function applyRepresentativeExternalIdLookup<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  ids: string[],
): void {
  if (!ids.length) return;
  qb.andWhere(
    new Brackets((w) => {
      w.where(`${alias}.external_id IN (:...repLookupIds)`, { repLookupIds: ids }).orWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(${alias}.aliases_external_id, '[]'::jsonb)) rep_alias
          WHERE rep_alias IN (:...repLookupIds)
        )`,
        { repLookupIds: ids },
      );
    }),
  );
}
