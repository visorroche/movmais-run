const TZ = "America/Sao_Paulo";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: string): boolean {
  return DATE_RE.test(String(s ?? "").trim());
}

export function parseYmd(s: string, label: string): string {
  const t = String(s ?? "").trim();
  if (!isYmd(t)) throw new Error(`${label} inválido (use YYYY-MM-DD): ${s}`);
  return t;
}

/** Datas entre start e end (inclusive), em YYYY-MM-DD. */
export function dateRangeInclusive(start: string, end: string): string[] {
  const a = new Date(`${parseYmd(start, "start")}T00:00:00Z`).getTime();
  const b = new Date(`${parseYmd(end, "end")}T00:00:00Z`).getTime();
  if (a > b) throw new Error("start-date deve ser <= end-date.");
  const out: string[] = [];
  for (let t = a; t <= b; t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

export function todayYmdBrazil(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function yesterdayYmdBrazil(): string {
  const today = todayYmdBrazil();
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! - 1));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseOrderDateTime(dateYmd: string, timeHms: string): Date | null {
  const d = String(dateYmd).trim();
  const t = String(timeHms).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const timePart = /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? t : "00:00:00";
  const iso = `${d}T${timePart.length === 5 ? `${timePart}:00` : timePart}-03:00`;
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
