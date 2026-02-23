export type CliKv = Map<string, string>;

export function parseCliKv(argv: string[]) {
  const raw: CliKv = new Map();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (a === "--onlyInsert") {
      raw.set("onlyInsert", "true");
      continue;
    }
    const [k, ...rest] = a.slice(2).split("=");
    if (!k) continue;
    raw.set(k, rest.join("="));
  }
  return raw;
}

export function parseCompanyArg(raw: CliKv): number {
  const company = Number(raw.get("company"));
  if (!Number.isInteger(company) || company <= 0) throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  return company;
}

export function parseYmdArg(rawValue: string | undefined, label: string): string | null {
  const v = String(rawValue ?? "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} inválido (YYYY-MM-DD).`);
  return v;
}

export function parseOrdersRangeArgs(argv: string[]): { company: number; startDate?: string; endDate?: string; onlyInsert?: boolean } {
  const raw = parseCliKv(argv);
  const company = parseCompanyArg(raw);
  const startDate = parseYmdArg(raw.get("start-date"), "start-date");
  const endDate = parseYmdArg(raw.get("end-date"), "end-date");
  const onlyInsert = raw.get("onlyInsert") === "true";

  const out: { company: number; startDate?: string; endDate?: string; onlyInsert?: boolean } = { company };
  if (startDate) out.startDate = startDate;
  if (endDate) out.endDate = endDate;
  if (onlyInsert) out.onlyInsert = true;
  return out;
}

export function quoteIdent(input: string): string {
  return input
    .split(".")
    .map((p) => `"${p.replace(/"/g, '""')}"`)
    .join(".");
}

