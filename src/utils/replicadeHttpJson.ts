/**
 * Helpers para respostas da API Replicade/Precode:
 * - prefixo com linhas tipo float(…), total__int(…) antes do JSON real;
 * - literais Python dentro do JSON (float(), None, …).
 */

export function stripLeadingNonJsonGarbage(text: string): { jsonText: string; strippedChars: number } {
  let s = text.trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const brace = s.indexOf("{");
  const bracket = s.indexOf("[");
  let start = -1;
  if (brace === -1 && bracket === -1) {
    return { jsonText: s, strippedChars: 0 };
  }
  if (brace === -1) start = bracket;
  else if (bracket === -1) start = brace;
  else start = Math.min(brace, bracket);
  return { jsonText: s.slice(start), strippedChars: start };
}

export function sanitizePythonishJsonText(text: string): string {
  let s = text.trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    // ex.: total__int(1) (debug fora ou dentro do pseudo-JSON)
    .replace(/[a-zA-Z0-9_]*__int\s*\(\s*([^)]*)\s*\)/g, (_m, inner: string) => String(inner).trim())
    .replace(/\b(?:float|int|Decimal)\s*\(\s*([^)]*)\s*\)/g, (_m, inner: string) => String(inner).trim());
}

function previewForLog(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

/**
 * Faz parse do body HTTP da Replicade; em falha, loga contexto e relança com mensagem detalhada.
 */
export function parseReplicadeJsonBody(rawText: string, url: string, logTag: string): unknown {
  const { jsonText, strippedChars } = stripLeadingNonJsonGarbage(rawText);
  const sanitized = sanitizePythonishJsonText(jsonText);
  try {
    return JSON.parse(sanitized) as unknown;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const detail =
      `${logTag} resposta não é JSON válida\n` +
      `url=${url}\n` +
      `erro_parse=${msg}\n` +
      `raw_bytes=${rawText.length} prefix_stripped_chars=${strippedChars}\n` +
      `--- raw (início) ---\n${previewForLog(rawText, 900)}\n` +
      `--- candidato pós strip+sanitize (início) ---\n${previewForLog(sanitized, 900)}`;
    console.error(`[${logTag}]`, detail);
    throw new Error(`${logTag}: JSON inválido em ${url} — ${msg} (ver log acima com corpo da resposta)`);
  }
}
