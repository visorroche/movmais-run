/**
 * Tipo de pessoa (customers.person_type). PF = Pessoa Física, PJ = Pessoa Jurídica.
 * Manter em sincronia com api/src/utils/person-type.ts.
 */
export const PERSON_TYPES = ["PF", "PJ"] as const;

export type PersonType = (typeof PERSON_TYPES)[number];

export function isPersonType(value: unknown): value is PersonType {
  return value === "PF" || value === "PJ";
}

const NORMALIZE_MAP: Record<string, PersonType> = {
  PF: "PF",
  PJ: "PJ",
  F: "PF",
  J: "PJ",
  pf: "PF",
  pj: "PJ",
  f: "PF",
  j: "PJ",
};

/** Normaliza string para PersonType (aceita PF, PJ, F, J e variações). */
export function toPersonType(value: unknown): PersonType | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value.trim().toUpperCase() : String(value).trim().toUpperCase();
  if (s === "PF" || s === "PJ") return s;
  if (s === "F") return "PF";
  if (s === "J") return "PJ";
  return NORMALIZE_MAP[String(value).trim()] ?? null;
}
