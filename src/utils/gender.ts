/**
 * Gênero (customers.gender). F = Feminino, M = Masculino, B = Outro/não binário.
 * Manter em sincronia com api/src/utils/gender.ts.
 */
export const GENDERS = ["F", "M", "B"] as const;

export type Gender = (typeof GENDERS)[number];

export function isGender(value: unknown): value is Gender {
  return value === "F" || value === "M" || value === "B";
}

const NORMALIZE_MAP: Record<string, Gender> = {
  F: "F",
  M: "M",
  B: "B",
  f: "F",
  m: "M",
  b: "B",
  FEMININO: "F",
  MASCULINO: "M",
  FEMALE: "F",
  MALE: "M",
};

/** Normaliza string para Gender. 0→null, 1→M, 2→F, 3→B; aceita também F, M, B e variações. */
export function toGender(value: unknown): Gender | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? value.trim() : String(value).trim();
  if (raw === "" || raw === "0") return null;
  const s = raw.toUpperCase();
  if (s === "F" || s === "M" || s === "B") return s;
  const numeric: Record<string, Gender> = { "1": "M", "2": "F", "3": "B" };
  if (numeric[raw] != null) return numeric[raw];
  return NORMALIZE_MAP[s] ?? null;
}
