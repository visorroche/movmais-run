/**
 * UFs (estados brasileiros) para uso como "enum" em entidades (ex.: Customer.state, Representative.state).
 * Manter em sincronia com api/src/utils/brazilian-states.ts.
 */
export const BR_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type BrazilianState = (typeof BR_UFS)[number];

export function isBrazilianState(value: unknown): value is BrazilianState {
  return typeof value === "string" && (BR_UFS as readonly string[]).includes(value.toUpperCase()) && value.length === 2;
}

/** Normaliza string para BrazilianState se possível (trim + uppercase). */
export function toBrazilianState(value: unknown): BrazilianState | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value.trim().toUpperCase() : String(value).trim().toUpperCase();
  return (BR_UFS as readonly string[]).includes(s) ? (s as BrazilianState) : null;
}
