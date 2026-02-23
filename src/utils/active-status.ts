/**
 * Status ativo/inativo (ex.: customers.status). ACTIVE | INACTIVE.
 * Manter em sincronia com api/src/utils/active-status.ts.
 */
export const ACTIVE_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export function isActiveStatus(value: unknown): value is ActiveStatus {
  return value === "ACTIVE" || value === "INACTIVE";
}

const NORMALIZE_MAP: Record<string, ActiveStatus> = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  active: "ACTIVE",
  inactive: "INACTIVE",
  ATIVO: "ACTIVE",
  INATIVO: "INACTIVE",
  ativo: "ACTIVE",
  inativo: "INACTIVE",
  A: "ACTIVE",
  I: "INACTIVE",
  "1": "ACTIVE",
  "0": "INACTIVE",
};

/** Normaliza string para ActiveStatus. */
export function toActiveStatus(value: unknown): ActiveStatus | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value.trim().toUpperCase() : String(value).trim().toUpperCase();
  if (s === "ACTIVE" || s === "INACTIVE") return s;
  return NORMALIZE_MAP[s] ?? NORMALIZE_MAP[String(value).trim()] ?? null;
}

/** Normaliza string/valor para boolean (true=ativo, false=inativo). */
export function toActiveBoolean(value: unknown): boolean | null {
  const s = toActiveStatus(value);
  if (s === "ACTIVE") return true;
  if (s === "INACTIVE") return false;
  return null;
}
