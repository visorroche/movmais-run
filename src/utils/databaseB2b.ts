import { Client } from "pg";
import { AppDataSource } from "./data-source.js";
import { CompanyPlataform } from "../entities/CompanyPlataform.js";

export type SchemaFieldTreatmentKey =
  | "mapear_valores"
  | "limpeza_regex"
  | "concatenar_campos"
  | "usar_um_ou_outro"
  | "diferenca_entre_datas"
  | "formula_matematica"
  | "mapear_json";

export type SchemaFieldMappingValue =
  | string
  | {
      field: string;
      tratamento?: SchemaFieldTreatmentKey;
      options?: Record<string, any>;
    };

export type DatabaseB2bOrdersSchema = {
  singleTable: boolean;
  table: string;
  orderTable?: string;
  orderItemTable?: string;
  orderFields: Record<string, SchemaFieldMappingValue>;
  orderItemFields: Record<string, SchemaFieldMappingValue>;
  /** ISO string (timestamptz) do último processamento bem-sucedido. */
  last_processed_at?: string;
};

export type DatabaseB2bSimpleSchema = {
  table: string;
  fields: Record<string, SchemaFieldMappingValue>;
  /** ISO string (timestamptz) do último processamento bem-sucedido. */
  last_processed_at?: string;
};

export type DatabaseB2bConfig = {
  host: string;
  port?: string | number;
  user: string;
  password: string;
  database?: string;
  ssl?: boolean;

  orders_schema?: DatabaseB2bOrdersSchema;
  products_schema?: DatabaseB2bSimpleSchema;
  customers_schema?: DatabaseB2bSimpleSchema;
  customers_group_schema?: DatabaseB2bSimpleSchema;
  representative_schema?: DatabaseB2bSimpleSchema;
};

export function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

export type DatabaseB2bCompanyPlatform = {
  companyPlatformId: number;
  platformSlug: string;
  config: DatabaseB2bConfig;
};

export function schemaFieldName(v: SchemaFieldMappingValue | undefined): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "field" in v) return String((v as any).field ?? "");
  return "";
}

export function schemaFieldTreatment(v: SchemaFieldMappingValue | undefined): SchemaFieldTreatmentKey | null {
  if (!v || typeof v !== "object") return null;
  return ((v as any).tratamento as SchemaFieldTreatmentKey | undefined) ?? null;
}

export function schemaFieldOptions(v: SchemaFieldMappingValue | undefined): Record<string, any> | null {
  if (!v || typeof v !== "object") return null;
  const opt = (v as any).options;
  return isObj(opt) ? (opt as any) : null;
}

export async function loadDatabaseB2bConfig(companyId: number): Promise<DatabaseB2bConfig | null> {
  const meta = await loadDatabaseB2bCompanyPlatform(companyId);
  return meta?.config ?? null;
}

export async function loadDatabaseB2bCompanyPlatform(companyId: number): Promise<DatabaseB2bCompanyPlatform | null> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(CompanyPlataform);
  const cp = await repo
    .createQueryBuilder("cp")
    .innerJoinAndSelect("cp.platform", "platform")
    .innerJoinAndSelect("cp.company", "company")
    .where("company.id = :companyId", { companyId })
    .andWhere("platform.slug IN (:...slugs)", { slugs: ["b2b_database", "database_b2b", "databaseb2b", "databaseB2b"] })
    .getOne();

  if (!cp) return null;

  const raw = (cp?.config ?? null) as any;
  let cfg: any = raw;
  if (typeof cfg === "string") {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      cfg = null;
    }
  }
  if (!cfg || typeof cfg !== "object") return null;

  const slug = String((cp as any)?.platform?.slug ?? "").trim() || "database_b2b";
  return { companyPlatformId: Number(cp!.id), platformSlug: slug, config: cfg as DatabaseB2bConfig };
}

const DBB2B_PLATFORM_SLUGS = ["b2b_database", "database_b2b", "databaseb2b", "databaseB2b"] as const;
export type DatabaseB2bSchemaKey =
  | "products_schema"
  | "customers_schema"
  | "customers_group_schema"
  | "representative_schema"
  | "orders_schema";

export async function listCompanyPlatformsForCompany(companyId: number): Promise<Array<{ id: number; slug: string }>> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(CompanyPlataform);
  const rows = await repo
    .createQueryBuilder("cp")
    .innerJoin("cp.platform", "platform")
    .where("cp.company_id = :companyId", { companyId })
    .select(["cp.id AS id", "platform.slug AS slug"])
    .getRawMany<{ id: number; slug: string }>();

  return rows
    .map((r) => ({ id: Number(r.id), slug: String((r as any).slug ?? "") }))
    .filter((r) => Number.isInteger(r.id) && r.id > 0 && r.slug.trim().length > 0);
}

export function describeCurrentInternalDbConnectionForLog() {
  const opt: any = (AppDataSource as any).options ?? {};
  // não logar password
  return {
    host: opt.host ?? null,
    port: opt.port ?? null,
    database: opt.database ?? null,
    username: opt.username ?? null,
  };
}

export function sanitizeDatabaseB2bConfigForLog(cfg: DatabaseB2bConfig) {
  const out: any = { ...(cfg as any) };
  if ("password" in out) out.password = "***";
  return out;
}

export function describeDatabaseB2bConfig(cfg: DatabaseB2bConfig) {
  const safe = sanitizeDatabaseB2bConfigForLog(cfg) as any;
  const topKeys = Object.keys(safe).sort();
  const schemaInfo = (k: DatabaseB2bSchemaKey) => {
    const s = (safe as any)[k];
    if (!s || typeof s !== "object") return { exists: false };
    const table = String(s.table ?? s.orderTable ?? "").trim() || null;
    const fieldsCount =
      k === "orders_schema"
        ? {
            orderFields: Object.keys((s.orderFields ?? {}) as any).length,
            orderItemFields: Object.keys((s.orderItemFields ?? {}) as any).length,
          }
        : { fields: Object.keys((s.fields ?? {}) as any).length };
    return { exists: true, table, last_processed_at: s.last_processed_at ?? null, ...fieldsCount };
  };
  return {
    topKeys,
    orders_schema: schemaInfo("orders_schema"),
    products_schema: schemaInfo("products_schema"),
    customers_schema: schemaInfo("customers_schema"),
    customers_group_schema: schemaInfo("customers_group_schema"),
    representative_schema: schemaInfo("representative_schema"),
  };
}

export function getDatabaseB2bLastProcessedAt(cfg: DatabaseB2bConfig, schemaKey: DatabaseB2bSchemaKey): Date | null {
  const raw = (cfg as any)?.[schemaKey]?.last_processed_at;
  return parseTimestamp(raw);
}

export async function updateDatabaseB2bLastProcessedAt(
  companyId: number,
  schemaKey: DatabaseB2bSchemaKey,
  isoString: string,
): Promise<void> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(CompanyPlataform);
  const cp = await repo
    .createQueryBuilder("cp")
    .innerJoin("cp.platform", "platform")
    .innerJoin("cp.company", "company")
    .where("company.id = :companyId", { companyId })
    .andWhere("platform.slug IN (:...slugs)", { slugs: Array.from(DBB2B_PLATFORM_SLUGS) })
    .select(["cp.id"])
    .getOne();
  if (!cp?.id) return;

  // Atualiza apenas o path desejado no jsonb para evitar sobrescrever outras execuções concorrentes.
  await repo
    .createQueryBuilder()
    .update(CompanyPlataform)
    .set({
      config: () =>
        `jsonb_set(coalesce(config, '{}'::jsonb), '{${schemaKey},last_processed_at}', to_jsonb(:iso::text), true)`,
    })
    .where("id = :id", { id: cp.id })
    .setParameters({ iso: isoString })
    .execute();
}

export function buildExternalClient(cfg: DatabaseB2bConfig): Client {
  const port = Number(cfg.port ?? 5432);
  const wantsSsl = cfg.ssl === true || (cfg.ssl !== false && !/^(localhost|127\.0\.0\.1)$/i.test(String(cfg.host ?? "")));
  return new Client({
    host: cfg.host,
    port: Number.isInteger(port) ? port : 5432,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database || "postgres",
    // supabase/postgres managed normalmente requer SSL
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 300_000,
    query_timeout: 300_000,
    keepAlive: true,
  } as any);
}

export function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildRegexPattern(keys: string[]): string {
  const cleaned = keys.map((k) => String(k ?? "")).filter(Boolean);
  if (!cleaned.length) return "";
  const sorted = Array.from(new Set(cleaned)).sort((a, b) => b.length - a.length);
  const parts = sorted.map((k) => escapeRegex(k));
  return `(?:${parts.join("|")})`;
}

export function toBoolLoose(v: unknown): boolean | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  const s = String(v).trim().toUpperCase();
  if (s === "TRUE" || s === "1" || s === "ACTIVE" || s === "ATIVO" || s === "SIM" || s === "S") return true;
  if (s === "FALSE" || s === "0" || s === "INACTIVE" || s === "INATIVO" || s === "NAO" || s === "NÃO" || s === "N") return false;
  return null;
}

export function parseYmd(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

export function parseTimestamp(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateDiffDays(start: unknown, end: unknown): number | null {
  const a = parseTimestamp(start) ?? (parseYmd(start) ? new Date(`${parseYmd(start)}T00:00:00.000Z`) : null);
  const b = parseTimestamp(end) ?? (parseYmd(end) ? new Date(`${parseYmd(end)}T00:00:00.000Z`) : null);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

function toNumberLoose(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  if (!raw) return null;

  let s = raw.replace(/[^\d.,-]+/g, "");
  if (!s) return null;

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(/,/g, ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function evalMathFormula(formula: string, row: Record<string, any>): number | null {
  const src = String(formula ?? "").trim();
  if (!src) return null;

  type Tok = { kind: "num"; v: number } | { kind: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" } | { kind: "uop"; v: "u-" };
  const tokens: Tok[] = [];

  const s = src;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "{") {
      const close = s.indexOf("}", i + 1);
      if (close === -1) return null;
      const key = s.slice(i + 1, close).trim();
      if (!key) return null;
      const n = toNumberLoose(row[key]);
      if (n == null) return null;
      tokens.push({ kind: "num", v: n });
      i = close + 1;
      continue;
    }
    if (/[0-9.,-]/.test(ch)) {
      // número literal (não permite sinais aqui; sinal é tratado como operador/unário)
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j]!)) j += 1;
      const rawNum = s.slice(i, j);
      const n = toNumberLoose(rawNum);
      if (n == null) return null;
      tokens.push({ kind: "num", v: n });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "(" || ch === ")") {
      tokens.push({ kind: "op", v: ch });
      i += 1;
      continue;
    }
    return null;
  }

  // Shunting-yard
  const output: Array<Tok> = [];
  const stack: Array<Tok> = [];
  let prev: Tok | null = null;

  const prec = (t: Tok) => (t.kind === "uop" ? 3 : t.kind === "op" && (t.v === "*" || t.v === "/") ? 2 : 1);
  const isLeftAssoc = (t: Tok) => t.kind !== "uop";

  for (const t of tokens) {
    if (t.kind === "num") {
      output.push(t);
      prev = t;
      continue;
    }
    if (t.kind === "op" && t.v === "(") {
      stack.push(t);
      prev = t;
      continue;
    }
    if (t.kind === "op" && t.v === ")") {
      while (stack.length) {
        const top = stack.pop()!;
        if (top.kind === "op" && top.v === "(") break;
        output.push(top);
      }
      prev = t;
      continue;
    }

    // operador (+-*/)
    if (t.kind === "op") {
      const unary: boolean = t.v === "-" && (!prev || (prev.kind !== "num" && !(prev.kind === "op" && prev.v === ")")));
      const opTok: Tok = unary ? { kind: "uop", v: "u-" } : t;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.kind === "op" && top.v === "(") break;
        const pTop = prec(top);
        const pCur = prec(opTok);
        if (pTop > pCur || (pTop === pCur && isLeftAssoc(opTok))) output.push(stack.pop()!);
        else break;
      }
      stack.push(opTok);
      prev = opTok;
      continue;
    }
  }
  while (stack.length) output.push(stack.pop()!);

  // Eval RPN
  const st: number[] = [];
  for (const t of output) {
    if (t.kind === "num") {
      st.push(t.v);
      continue;
    }
    if (t.kind === "uop") {
      if (st.length < 1) return null;
      const a = st.pop()!;
      st.push(-a);
      continue;
    }
    if (t.kind === "op") {
      if (st.length < 2) return null;
      const b = st.pop()!;
      const a = st.pop()!;
      if (t.v === "+") st.push(a + b);
      else if (t.v === "-") st.push(a - b);
      else if (t.v === "*") st.push(a * b);
      else {
        if (b === 0) return null;
        st.push(a / b);
      }
      continue;
    }
  }
  if (st.length !== 1) return null;
  const out = st[0]!;
  return Number.isFinite(out) ? out : null;
}

export function renderTemplate(template: string, row: Record<string, any>): string {
  return template.replace(/\{([^}]+)\}/g, (_, fieldRaw) => {
    const field = String(fieldRaw ?? "").trim();
    const v = row[field];
    return v == null ? "" : String(v);
  });
}

export function applyMapValues(raw: unknown, options: Record<string, any>): unknown {
  const s = raw == null ? "" : String(raw);
  const direct = Object.prototype.hasOwnProperty.call(options, s) ? options[s] : undefined;
  if (direct !== undefined) return direct;
  if (Object.prototype.hasOwnProperty.call(options, "else")) return options.else;
  return raw;
}

export function applyLimpezaRegex(raw: unknown, options: Record<string, any>): string | null {
  if (raw == null) return null;
  const s = String(raw);
  const regex = String(options.regex ?? "");
  const flags = String(options.flags ?? "g");
  const map = isObj(options.map) ? (options.map as Record<string, any>) : {};
  if (!regex) return s;
  let re: RegExp;
  try {
    re = new RegExp(regex, flags);
  } catch {
    return s;
  }
  return s.replace(re, (m) => (Object.prototype.hasOwnProperty.call(map, m) ? String(map[m] ?? "") : m));
}

export function applyMapearJson(row: Record<string, any>, options: Record<string, any>): any {
  const map = isObj(options.map) ? (options.map as Record<string, any>) : {};
  const out: Record<string, any> = {};
  for (const [k, src] of Object.entries(map)) {
    const col = String(src ?? "").trim();
    if (!col) continue;
    out[k] = row[col] ?? null;
  }
  return out;
}

export function applyFieldMapping(value: SchemaFieldMappingValue | undefined, row: Record<string, any>): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    const col = value.trim();
    if (!col) return null;
    return row[col] ?? null;
  }
  const col = String(value.field ?? "").trim();
  const tratamento = (value.tratamento ?? null) as SchemaFieldTreatmentKey | null;
  const opt = isObj(value.options) ? (value.options as Record<string, any>) : {};

  if (!tratamento) {
    if (!col) return null;
    return row[col] ?? null;
  }

  if (tratamento === "mapear_valores") {
    return applyMapValues(col ? row[col] : null, opt);
  }
  if (tratamento === "limpeza_regex") {
    const colFromField = col && !col.startsWith("/") && !col.startsWith("{") ? col : "";
    const colFromOpt = String((opt as any).sourceField ?? (opt as any).source_field ?? (opt as any).source ?? "").trim();
    const src = colFromField || colFromOpt;
    return applyLimpezaRegex(src ? row[src] : null, opt);
  }
  if (tratamento === "concatenar_campos") {
    const tpl = String(opt.concatenate ?? col ?? "");
    return tpl ? renderTemplate(tpl, row) : null;
  }
  if (tratamento === "usar_um_ou_outro") {
    const main = String(opt.main ?? "").trim();
    const fallback = String(opt.fallback ?? "").trim();
    const a = main ? row[main] : null;
    if (a != null && String(a).trim() !== "") return a;
    const b = fallback ? row[fallback] : null;
    return b ?? null;
  }
  if (tratamento === "diferenca_entre_datas") {
    const start = String(opt.start ?? "").trim();
    const end = String(opt.end ?? "").trim();
    const d = dateDiffDays(start ? row[start] : null, end ? row[end] : null);
    return d == null ? null : d;
  }
  if (tratamento === "formula_matematica") {
    const formula = String((opt as any).formula ?? col ?? "").trim();
    const n = formula ? evalMathFormula(formula, row) : null;
    return n == null ? null : n;
  }
  if (tratamento === "mapear_json") {
    return applyMapearJson(row, opt);
  }

  return col ? row[col] ?? null : null;
}

export function parseCsvColumns(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function pickRowValue(row: Record<string, any>, col: string): any {
  const key = col.trim();
  return key ? row[key] ?? null : null;
}

function looksLikeSourceColumnName(s: string): boolean {
  return Boolean(s) && !s.startsWith("/") && !s.includes("{") && !s.includes(",") && !s.includes("??");
}

/**
 * Coleta colunas de origem necessárias para o SELECT externo, considerando tratamentos.
 * Isso evita SELECT * e reduz tráfego/tempo no banco do cliente.
 */
export function collectSourceColumnsFromMapping(
  mapping: Record<string, SchemaFieldMappingValue> | undefined | null,
  target?: Set<string>,
): Set<string> {
  const out = target ?? new Set<string>();
  const fields = mapping ?? {};

  for (const v of Object.values(fields)) {
    if (typeof v === "string") {
      const col = v.trim();
      if (col) out.add(col);
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const tratamento = String((v as any).tratamento ?? "").trim();
    const field = String((v as any).field ?? "").trim();
    const opt = (v as any).options;

    if (!tratamento) {
      if (looksLikeSourceColumnName(field)) out.add(field);
      continue;
    }

    if (tratamento === "mapear_valores") {
      if (looksLikeSourceColumnName(field)) out.add(field);
      continue;
    }

    if (tratamento === "limpeza_regex") {
      if (isObj(opt)) {
        const src = String((opt as any).sourceField ?? (opt as any).source_field ?? (opt as any).source ?? "").trim();
        if (looksLikeSourceColumnName(src)) out.add(src);
      }
      if (looksLikeSourceColumnName(field)) out.add(field);
      continue;
    }

    if (tratamento === "mapear_json") {
      if (isObj(opt)) {
        const map = (opt as any).map;
        if (isObj(map)) {
          Object.values(map).forEach((x) => {
            const col = String(x ?? "").trim();
            if (col) out.add(col);
          });
        }
      }
      continue;
    }

    if (tratamento === "concatenar_campos" && isObj(opt)) {
      const tpl = String((opt as any).concatenate ?? "");
      tpl.replace(/\{([^}]+)\}/g, (_, f) => {
        const key = String(f ?? "").trim();
        if (key) out.add(key);
        return "";
      });
      continue;
    }

    if (tratamento === "formula_matematica" && isObj(opt)) {
      const tpl = String((opt as any).formula ?? field ?? "");
      tpl.replace(/\{([^}]+)\}/g, (_, f) => {
        const key = String(f ?? "").trim();
        if (key) out.add(key);
        return "";
      });
      continue;
    }

    if (tratamento === "usar_um_ou_outro" && isObj(opt)) {
      const main = String((opt as any).main ?? "").trim();
      const fallback = String((opt as any).fallback ?? "").trim();
      if (looksLikeSourceColumnName(main)) out.add(main);
      if (looksLikeSourceColumnName(fallback)) out.add(fallback);
      continue;
    }

    if (tratamento === "diferenca_entre_datas" && isObj(opt)) {
      const start = String((opt as any).start ?? "").trim();
      const end = String((opt as any).end ?? "").trim();
      if (looksLikeSourceColumnName(start)) out.add(start);
      if (looksLikeSourceColumnName(end)) out.add(end);
      continue;
    }
  }

  return out;
}

export async function queryExternalBatched<T extends Record<string, any>>(client: Client, sql: string, params: any[] = [], batchSize = 5000) {
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const q = `${sql} LIMIT ${batchSize} OFFSET ${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await client.query(q, params);
    const rows = (res.rows ?? []) as T[];
    out.push(...rows);
    if (rows.length < batchSize) break;
    offset += batchSize;
  }
  return out;
}

