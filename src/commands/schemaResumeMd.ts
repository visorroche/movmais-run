/**
 * Gera um arquivo .md com a estrutura das tabelas a partir das entidades TypeORM.
 * Usado para alimentar prompts da IA que montam queries (ex.: custom dashboard).
 *
 * Convenções:
 * - JSDoc acima de @Entity: descrição da tabela no .md.
 * - Linha "Plataformas: tipo1, tipo2" no JSDoc: entidade alimentada por esses tipos; a API filtra por tipos da company.
 * - Linha "Avanço: requer company.avanco=true" no JSDoc: tabela do módulo Avanço; a API inclui só se company.avanco=true.
 * - Comentário //NOMAP acima de uma coluna: não inclui a coluna no .md.
 * - @JoinColumn: não é listado (evita duplicata com a coluna escalar).
 *
 * Uso: npm run schema:resume-md
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Nomes das classes de entidade que não devem entrar no schema (ex.: tabelas de sistema). */
const SKIP_ENTITIES = [
  "IntegrationLog",
  "Log",
  "UserActivity",
  "CustomDashboards",
  "Threads",
  "ThreadMessages",
  "City",
  "AvancoLogisticsTablePrice",
  "AvancoLogisticsAddress",
  "Companies",
  "CompanyPlataform",
  "CompanyUser",
  "Group",
  "User",
  "Plataform"
];

const ENTITIES_DIR = path.resolve(__dirname, "../../src/entities");
const OUTPUT_PATH = path.resolve(__dirname, "../../../api/src/prompt/schema-resume.md");

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function extractTableName(content: string): string | null {
  const withName = /@Entity\s*\(\s*\{\s*name:\s*["']([^"']+)["']/i.exec(content);
  if (withName?.[1]) return withName[1];
  const short = /@Entity\s*\(\s*["']([^"']+)["']\s*\)/i.exec(content);
  if (short?.[1]) return short[1];
  return null;
}

function extractClassName(content: string): string | null {
  const m = /export\s+class\s+(\w+)/.exec(content);
  return m?.[1] ?? null;
}

/** Extrai o JSDoc (bloco de comentário) imediatamente acima de @Entity (usa o último bloco antes de @Entity). */
function extractDescription(content: string): string | null {
  const entityIdx = content.indexOf("@Entity");
  if (entityIdx < 0) return null;
  const before = content.slice(0, entityIdx);
  const matches = [...before.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  const last = matches[matches.length - 1];
  if (!last?.[1]) return null;
  const raw = last[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line.length > 0 && !/^Plataformas:\s*/i.test(line) && !/^Avanço:\s*requer/i.test(line))
    .join(" ");
  return raw.length > 0 ? raw : null;
}

/** Extrai os tipos de plataforma do JSDoc da entidade (linha "Plataformas: ecommerce, b2b"). Retorna null se não houver. */
function extractPlatformTypes(content: string): string[] | null {
  const entityIdx = content.indexOf("@Entity");
  if (entityIdx < 0) return null;
  const before = content.slice(0, entityIdx);
  const matches = [...before.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  const last = matches[matches.length - 1];
  if (!last?.[1]) return null;
  const block = last[1];
  const lineRe = /Plataformas:\s*([^\n*]+)/i;
  const m = lineRe.exec(block);
  if (!m?.[1]) return null;
  const types = m[1]
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  return types.length > 0 ? types : null;
}

/** Indica se a entidade é do módulo Avanço e só deve aparecer para companies com avanco=true. */
function extractAvancoRequired(content: string): boolean {
  const entityIdx = content.indexOf("@Entity");
  if (entityIdx < 0) return false;
  const before = content.slice(0, entityIdx);
  const matches = [...before.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  const last = matches[matches.length - 1];
  if (!last?.[1]) return false;
  return /Avanço:\s*requer\s+company\.avanco\s*=\s*true/i.test(last[1]);
}

interface ColumnInfo {
  name: string;
  type: string;
  /** Valores possíveis quando a coluna é tipada com um enum (string enum). */
  enumValues?: string[];
}

/** Extrai os valores (RHS) de um string enum no conteúdo do arquivo. */
function extractEnumValues(content: string, enumName: string): string[] {
  const escaped = enumName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("export\\s+enum\\s+" + escaped + "\\s*\\{([\\s\\S]*?)\\n\\s*\\}", "m");
  const m = re.exec(content);
  if (!m?.[1]) return [];
  const body = m[1];
  const values: string[] = [];
  const valueRe = /=\s*["']([^"']*)["']/g;
  let vm: RegExpExecArray | null;
  while ((vm = valueRe.exec(body)) !== null) {
    if (vm[1] !== undefined) values.push(vm[1]);
  }
  return values;
}

/** Extrai os valores de uma constante array string `as const`, ex.: export const ORDER_STATUSES = ["a", "b"] as const; */
function extractConstArrayValues(content: string, constName: string): string[] {
  const escaped = constName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("export\\s+const\\s+" + escaped + "\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const", "m");
  const m = re.exec(content);
  if (!m?.[1]) return [];
  const body = m[1];
  const values: string[] = [];
  const valueRe = /["']([^"']*)["']/g;
  let vm: RegExpExecArray | null;
  while ((vm = valueRe.exec(body)) !== null) {
    if (vm[1] !== undefined) values.push(vm[1]);
  }
  return values;
}

/** Extrai o nome da const array usada por um type alias, ex.: OrderStatus = (typeof ORDER_STATUSES)[number]. */
function extractConstArrayNameForType(content: string, typeName: string): string | null {
  const escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("export\\s+type\\s+" + escaped + "\\s*=\\s*\\(typeof\\s+(\\w+)\\)\\[number\\]", "m");
  const m = re.exec(content);
  return m?.[1] ?? null;
}

/** Extrai valores de `enum: ["a", "b"]` declarados no decorator @Column. */
function extractInlineEnumValues(columnBlock: string): string[] {
  const m = /enum:\s*\[([\s\S]*?)\]/m.exec(columnBlock);
  if (!m?.[1]) return [];
  const values: string[] = [];
  const valueRe = /["']([^"']*)["']/g;
  let vm: RegExpExecArray | null;
  while ((vm = valueRe.exec(m[1])) !== null) {
    if (vm[1] !== undefined) values.push(vm[1]);
  }
  return values;
}

/** Obtém o nome do tipo (enum) da linha da propriedade, ex.: "status?: AvancoLogisticOrderStatus | null" -> AvancoLogisticOrderStatus. */
function getPropertyTypeName(propertyLine: string): string | null {
  const t = /^\s*\w+\s*[!?]?[?:]?\s*([A-Z]\w*)(?:\s*\|\s*\w+)*\s*;?/.exec(propertyLine);
  return t?.[1] ?? null;
}

/** Procura comentário OPTIONS: acima da propriedade. Ex.: // OPTIONS: ativo, cancelado */
function extractOptionsCommentAbove(lines: string[], index: number): string[] {
  for (let k = index - 1; k >= 0; k--) {
    const prev = lines[k] ?? "";
    if (/^\s*@\w+/.test(prev) || /^\s*export\s+class/.test(prev)) break;
    const m = /OPTIONS:\s*(.+)$/i.exec(prev);
    if (m?.[1]) {
      return m[1]
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
  }
  return [];
}

function findImportSourceForSymbol(content: string, symbol: string): string | null {
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const specifiers = (m[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const specifier of specifiers) {
      const aliasMatch = /^(\w+)\s+as\s+(\w+)$/.exec(specifier);
      const imported = aliasMatch?.[1] ?? specifier;
      const local = aliasMatch?.[2] ?? specifier;
      if (local === symbol) return m[2] ?? null;
      if (imported === symbol) return m[2] ?? null;
    }
  }
  return null;
}

function resolveImportedModulePath(importerFilePath: string, source: string): string | null {
  if (!source.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(importerFilePath), source);
  const candidates = [
    resolved,
    resolved.replace(/\.js$/i, ".ts"),
    resolved.replace(/\.mjs$/i, ".ts"),
    resolved + ".ts",
    path.join(resolved, "index.ts"),
    path.join(resolved.replace(/\.js$/i, ""), "index.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveEnumValuesForType(filePath: string, content: string, typeName: string): string[] {
  const directEnumValues = extractEnumValues(content, typeName);
  if (directEnumValues.length > 0) return directEnumValues;

  const localConstName = extractConstArrayNameForType(content, typeName);
  if (localConstName) {
    const localConstValues = extractConstArrayValues(content, localConstName);
    if (localConstValues.length > 0) return localConstValues;
  }

  const importSource = findImportSourceForSymbol(content, typeName);
  if (!importSource) return [];
  const importedPath = resolveImportedModulePath(filePath, importSource);
  if (!importedPath) return [];
  const importedContent = fs.readFileSync(importedPath, "utf-8");

  const importedEnumValues = extractEnumValues(importedContent, typeName);
  if (importedEnumValues.length > 0) return importedEnumValues;

  const importedConstName = extractConstArrayNameForType(importedContent, typeName);
  if (!importedConstName) return [];
  return extractConstArrayValues(importedContent, importedConstName);
}

/** Verifica se há comentário //NOMAP em alguma linha acima do índice (até o próximo decorator ou propriedade). */
function hasNomapAbove(lines: string[], index: number): boolean {
  for (let k = index - 1; k >= 0; k--) {
    const prev = lines[k] ?? "";
    if (/^\s*@\w+/.test(prev) || /^\s*export\s+class/.test(prev)) break;
    if (/\/\/\s*NOMAP\b/i.test(prev)) return true;
  }
  return false;
}

function extractColumns(filePath: string, content: string): ColumnInfo[] {
  const columns: ColumnInfo[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // @PrimaryGeneratedColumn() ou @PrimaryGeneratedColumn("uuid", { ... })
    if (/@PrimaryGeneratedColumn\s*\(/.test(line)) {
      if (hasNomapAbove(lines, i)) continue;
      const typeOpt = /type:\s*["'](\w+)["']/.exec(line);
      columns.push({ name: "id", type: typeOpt?.[1] ?? "int" });
      continue;
    }

    // @Column({ ... }) — pode ser multilinha
    if (line.includes("@Column")) {
      if (hasNomapAbove(lines, i)) continue;
      let block: string = line;
      let j = i;
      while (block.includes("@Column") && (block.indexOf(")") < 0 || block.split("(").length - 1 !== block.split(")").length - 1)) {
        j++;
        if (j >= lines.length) break;
        block += "\n" + (lines[j] ?? "");
      }
      const nameMatch = /name:\s*["']([^"']+)["']/.exec(block);
      const typeMatch = /type:\s*["']([^"']+)["']/.exec(block);
      const propLine = lines[j + 1] ?? "";
      let colName: string;
      if (nameMatch?.[1]) {
        colName = nameMatch[1];
      } else {
        const propMatch = /^\s*(\w+)\s*[!?]?[?:]?\s*/.exec(propLine);
        colName = propMatch?.[1] ? camelToSnake(propMatch[1]) : "?";
      }
      const dbType = typeMatch?.[1] ?? "?";
      const typeName = getPropertyTypeName(propLine ?? "");
      const inlineEnumValues = extractInlineEnumValues(block);
      const commentOptions = extractOptionsCommentAbove(lines, j + 1);
      const typeEnumValues = typeName ? resolveEnumValuesForType(filePath, content, typeName) : [];
      const enumValues =
        inlineEnumValues.length > 0
          ? inlineEnumValues
          : commentOptions.length > 0
            ? commentOptions
            : typeEnumValues.length > 0
              ? typeEnumValues
              : undefined;
      columns.push({
        name: colName,
        type: dbType,
        ...(enumValues?.length ? { enumValues } : {}),
      });
      continue;
    }

    // @JoinColumn: não listamos (evita duplicata com a coluna escalar; a IA usa só o nome da coluna).
  }

  return columns;
}

function collectEntityFiles(dir: string, baseDir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...collectEntityFiles(full, baseDir));
    } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function main(): void {
  const entityFiles = collectEntityFiles(ENTITIES_DIR, ENTITIES_DIR);
  const tables: {
    tableName: string;
    className: string;
    description: string | null;
    platformTypes: string[] | null;
    avancoRequired: boolean;
    columns: ColumnInfo[];
  }[] = [];

  for (const filePath of entityFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const className = extractClassName(content);
    if (!className || SKIP_ENTITIES.includes(className)) continue;

    const tableName = extractTableName(content) ?? camelToSnake(className);
    const description = extractDescription(content);
    const platformTypes = extractPlatformTypes(content);
    const avancoRequired = extractAvancoRequired(content);
    const columns = extractColumns(filePath, content);
    if (columns.length === 0) continue;

    tables.push({ tableName, className, description, platformTypes, avancoRequired, columns });
  }

  // Ordenar por nome da tabela
  tables.sort((a, b) => a.tableName.localeCompare(b.tableName));

  const md: string[] = [
    "# Schema do banco (resumo para IA)",
    "",
    "Tabelas e colunas disponíveis para consultas. Gerado a partir das entidades em `script-bi/src/entities/`.",
    "",
    "---",
    "",
  ];

  for (const { tableName, className, description, platformTypes, avancoRequired, columns } of tables) {
    md.push("## " + tableName);
    md.push("");
    md.push("*Entidade: `" + className + "`*");
    if (platformTypes && platformTypes.length > 0) {
      md.push("");
      md.push("Plataformas: " + platformTypes.map((t) => "`" + t + "`").join(", ") + ".");
    }
    if (avancoRequired) {
      md.push("");
      md.push("Avanço: requer company.avanco=true.");
    }
    if (description) {
      md.push("");
      md.push(description);
    }
    md.push("");
    md.push("| Coluna | Tipo |");
    md.push("|--------|------|");
    for (const col of columns) {
      const typeCell = col.enumValues?.length ? col.type + " (enum)" : col.type;
      md.push("| " + col.name + " | " + typeCell + " |");
    }
    const enumCols = columns.filter((c) => c.enumValues && c.enumValues.length > 0);
    if (enumCols.length > 0) {
      md.push("");
      for (const col of enumCols) {
        md.push("Valores possíveis para **" + col.name + "**: " + (col.enumValues ?? []).map((v) => "`" + v + "`").join(", ") + ".");
      }
    }
    md.push("");
  }

  fs.writeFileSync(OUTPUT_PATH, md.join("\n"), "utf-8");
  console.log("Schema escrito em: " + OUTPUT_PATH);
  console.log("Tabelas incluídas: " + tables.length + ". Ignoradas: " + SKIP_ENTITIES.join(", ") + ".");
  process.exit(0);
}

main();
