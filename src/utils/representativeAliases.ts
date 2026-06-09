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

/** Normaliza chave vinda do banco do cliente (cod_rep, televendas, etc.). */
export function normalizeRepresentativeLookupKey(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (Number.isInteger(raw)) return String(raw);
    if (Math.floor(raw) === raw) return String(Math.trunc(raw));
    return String(raw);
  }
  let s = String(raw).trim();
  if (!s) return "";
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}

/** Variantes para comparar internal_code com/sem zeros à esquerda. */
export function internalCodeLookupVariants(key: string): string[] {
  const s = String(key ?? "").trim();
  if (!s) return [];
  const out = new Set<string>();
  out.add(s);
  const noZeros = s.replace(/^0+/, "") || "0";
  out.add(noZeros);
  return Array.from(out);
}

export function expandInternalCodeLookupIds(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    for (const v of internalCodeLookupVariants(normalizeRepresentativeLookupKey(id))) {
      out.add(v);
    }
  }
  return Array.from(out);
}

function preferRepresentativeForInternalCode(
  current: Representative | undefined,
  candidate: Representative,
): Representative {
  if (!current) return candidate;
  const currentExt = String((current as any).externalId ?? "").trim();
  const candidateExt = String((candidate as any).externalId ?? "").trim();
  if (!currentExt && candidateExt) return candidate;
  if (currentExt && !candidateExt) return current;
  const currentId = Number((current as any).id);
  const candidateId = Number((candidate as any).id);
  if (Number.isFinite(currentId) && Number.isFinite(candidateId) && candidateId < currentId) return candidate;
  return current;
}

export function registerRepresentativeInternalCodeInMap(
  map: Map<string, Representative>,
  rep: Representative,
): void {
  const key = String((rep as any).internalCode ?? "").trim();
  if (!key) return;
  for (const v of internalCodeLookupVariants(key)) {
    map.set(v, preferRepresentativeForInternalCode(map.get(v), rep));
  }
}

export function resolveRepresentativeFromLookupMap(
  map: Map<string, Representative>,
  rawKey: unknown,
  lookupField: string,
): Representative | null {
  const key = normalizeRepresentativeLookupKey(rawKey);
  if (!key) return null;
  if (lookupField === "internal_code") {
    for (const v of internalCodeLookupVariants(key)) {
      const hit = map.get(v);
      if (hit) return hit;
    }
    return null;
  }
  return map.get(key) ?? null;
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
