/**
 * Data e horário no fuso do Brasil (America/Sao_Paulo).
 * - date: YYYY-MM-DD (ex.: 2026-01-01)
 * - time: HH:mm:ss (ex.: 12:59:59)
 */

const BRAZIL_TZ = "America/Sao_Paulo";

export function toBrazilDateString(d: Date | null | undefined): string | null {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toLocaleDateString("en-CA", { timeZone: BRAZIL_TZ });
}

export function toBrazilTimeString(d: Date | null | undefined): string | null {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toLocaleTimeString("en-GB", { timeZone: BRAZIL_TZ, hour12: false });
}

export function toBrazilDateAndTime(
  d: Date | null | undefined,
): { date: string | null; time: string | null } {
  return {
    date: toBrazilDateString(d),
    time: toBrazilTimeString(d),
  };
}
