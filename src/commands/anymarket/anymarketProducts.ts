import "dotenv/config";
import "reflect-metadata";

import { In } from "typeorm";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Product } from "../../entities/Product.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";

const IS_TTY = Boolean(process.stdout.isTTY);

function renderProgress(line: string) {
  if (IS_TTY) {
    const padded = line.length < 140 ? line.padEnd(140, " ") : line;
    process.stdout.write(`\r${padded}`);
  } else {
    console.log(line);
  }
}

function parseArgs(argv: string[]): { company: number } {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }
  const company = Number(raw.get("company"));
  if (!Number.isInteger(company) || company <= 0) {
    throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  }
  return { company };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function ensureArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumericString(v: number | string | null): string | null {
  if (v === null) return null;
  const s = typeof v === "number" ? String(v) : String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function splitStoreReference(value: string | null): { storeReference: string | null; externalReference: string | null } {
  if (!value) return { storeReference: null, externalReference: null };
  const s = value.trim();
  if (!s) return { storeReference: null, externalReference: null };
  // Ex.: "45145[160151]" => storeReference="45145", externalReference="160151"
  const match = /^([^\[\]]+)\[([^\[\]]+)\]$/.exec(s);
  if (!match) return { storeReference: s, externalReference: null };
  const storeReference = match[1]?.trim() ?? null;
  const externalReference = match[2]?.trim() ?? null;
  return {
    storeReference: storeReference && storeReference.length > 0 ? storeReference : null,
    externalReference: externalReference && externalReference.length > 0 ? externalReference : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(err: unknown): boolean {
  const e = err as any;
  const code = e?.code ?? e?.cause?.code;
  const msg = String(e?.message ?? "");
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    /fetch failed/i.test(msg) ||
    /timeout/i.test(msg)
  );
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const s = retryAfter.trim();
  if (!s) return null;

  const asSeconds = Number(s);
  if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.round(asSeconds * 1000);

  const asDate = Date.parse(s);
  if (Number.isFinite(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

async function anymarketGetJson(url: string, token: string): Promise<{ status: number; json: unknown; text: string }> {
  const MAX_RETRIES = 5;
  const MAX_RATE_LIMIT_RETRIES = 10;
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json", gumgaToken: token } as any });
      // eslint-disable-next-line no-await-in-loop
      const text = await resp.text().catch(() => "");
      if (resp.status === 429) {
        rateLimitRetries += 1;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
          return { status: resp.status, json: null, text };
        }
        const retryAfterHeader = resp.headers.get("retry-after");
        const waitMs = parseRetryAfterMs(retryAfterHeader) ?? 60_000;
        console.warn(
          `[anymarket:products] HTTP 429 (rate limit). Aguardando ${Math.ceil(waitMs / 1000)}s e continuando. url=${url}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitMs);
        attempt -= 1;
        continue;
      }
      const json = (() => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })();
      return { status: resp.status, json, text };
    } catch (err) {
      if (!isTransientFetchError(err) || attempt === MAX_RETRIES) throw err;
      const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.warn(`[anymarket:products] fetch transitório; retry ${attempt}/${MAX_RETRIES} em ${delay}ms. url=${url}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  return { status: 0, json: null, text: "" };
}

type AnyMarketListResponse = {
  links?: Array<{ rel?: string; href?: string }>;
  content?: unknown[];
  page?: { size?: number; totalElements?: number; totalPages?: number; number?: number };
};

function getNextHref(payload: AnyMarketListResponse): string | null {
  const links = Array.isArray(payload?.links) ? payload.links : [];
  for (const l of links) {
    const rel = String(l?.rel ?? "").trim();
    const href = String(l?.href ?? "").trim();
    if (rel === "next" && href) return href;
  }
  return null;
}

function pickBestImageUrl(images: unknown): string | null {
  const arr = ensureArray(images);
  const parsed = arr.map((x) => asRecord(x)).filter(Boolean) as Record<string, unknown>[];
  const main =
    parsed.find((i) => i.main === true || i.main === "true" || i.main === 1) ??
    parsed.find((i) => pickNumber(i, "index") === 1) ??
    parsed[0] ??
    null;
  if (!main) return null;
  return (
    pickString(main, "url") ??
    pickString(main, "standardUrl") ??
    pickString(main, "thumbnailUrl") ??
    pickString(main, "lowResolutionUrl") ??
    pickString(main, "originalImage")
  );
}

async function main() {
  const { company: companyId } = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let upsertedForLog = 0;
  let integrationLogId: number | null = null;

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new Error(`Company ${companyId} não encontrada.`);
    const companyRef: Company = company;
    companyRefForLog = companyRef;

    const platform = await platformRepo.findOne({ where: { slug: "anymarket" } });
    if (!platform) throw new Error('Platform slug="anymarket" não encontrada. Cadastre e instale antes.');
    platformRefForLog = platform;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: companyRef.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Platform "anymarket" não está instalada nessa company.');

    // log inicial (PROCESSANDO)
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const started = await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: null,
          company: companyRef,
          platform,
          command: "Produtos",
          status: "PROCESSANDO",
          log: {
            company: companyId,
            platform: { id: platform.id, slug: "anymarket" },
            command: "Produtos",
            status: "PROCESSANDO",
          },
          errors: null,
        }),
      );
      integrationLogId = started.id;
    } catch (e) {
      console.warn("[anymarket:products] falha ao gravar log inicial (PROCESSANDO):", e);
    }

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const token = typeof cfg.token === "string" ? cfg.token.trim() : null;
    if (!token) throw new Error('Config da AnyMarket precisa conter: { "token": "..." }');

    const baseUrl = "https://api.anymarket.com.br/v2";
    // por padrão o AnyMarket pode devolver páginas pequenas; forçamos limit=100
    let url = `${baseUrl}/products?limit=100&offset=0`; // a paginação virá por links.next.href

    let processed = 0;
    let upserted = 0;
    let total: number | null = null;
    let pageNum = 1;

    while (true) {
      renderProgress(`[anymarket:products] page=${pageNum} processed=${processed} upserted=${upserted}`);

      // eslint-disable-next-line no-await-in-loop
      const { status, json, text } = await anymarketGetJson(url, token);
      if (status < 200 || status >= 300) {
        throw new Error(`Falha AnyMarket HTTP ${status} em ${url}. Body: ${text.slice(0, 500)}`);
      }

      const root = (asRecord(json) ?? {}) as AnyMarketListResponse;
      const content = ensureArray(root.content);
      if (total === null) {
        const pageObj = asRecord((root as any).page ?? null) ?? {};
        total = pickNumber(pageObj, "totalElements");
      }
      if (content.length === 0) break;

      // por página: monta lista de SKUs, faz prefetch no banco, salva em lote
      const toSave: Product[] = [];
      const skuList: string[] = [];
      const rows: Array<{
        product: Record<string, unknown>;
        sku: Record<string, unknown>;
        skuStr: string;
      }> = [];

      for (const item of content) {
        const p = asRecord(item);
        if (!p) continue;
        const productId = pickNumber(p, "id");
        if (!productId) continue;
        const skusArr = ensureArray(p.skus);
        for (const skuRaw of skusArr) {
          const s = asRecord(skuRaw);
          if (!s) continue;
          const skuStr =
            String(pickString(s, "partnerId") ?? pickString(s, "externalId") ?? pickNumber(s, "id") ?? "").trim() || null;
          if (!skuStr) continue;
          skuList.push(skuStr);
          rows.push({ product: p, sku: s, skuStr });
        }
      }

      const existingArr =
        skuList.length > 0
          ? // eslint-disable-next-line no-await-in-loop
            await productRepo.find({ where: { company: { id: companyRef.id }, sku: In(skuList) } as any })
          : [];
      const existingBySku = new Map<string, Product>();
      for (const e of existingArr) existingBySku.set(e.sku, e);

      for (const { product: p, sku: s, skuStr } of rows) {
        const productId = pickNumber(p, "id");
        if (!productId) continue;

        const brandObj = asRecord(p.brand ?? null) ?? {};
        const categoryObj = asRecord(p.category ?? null) ?? {};
        const nbmObj = asRecord((p as any).nbm ?? null) ?? {};

        const refs = splitStoreReference(pickString(s, "partnerId") ?? pickString(s, "externalId") ?? pickString(p, "externalIdProduct"));

        const name = pickString(s, "title") ?? pickString(p, "title");
        const ean = pickString(s, "ean");
        const photo = pickBestImageUrl((p as any).images);

        let entity = existingBySku.get(skuStr) ?? productRepo.create({ company: companyRef, sku: skuStr });
        entity.company = companyRef;
        entity.sku = skuStr;
        entity.ecommerceId = productId;
        entity.ean = ean;
        entity.slug = null;
        entity.name = name;
        entity.storeReference = refs.storeReference;
        entity.externalReference = refs.externalReference;
        if (!entity.manualAttributesLocked) entity.brand = pickString(brandObj, "name");
        entity.brandId = pickNumber(brandObj, "id");
        if (!entity.manualAttributesLocked) entity.model = pickString(p, "model");
        entity.ncm = pickString(nbmObj, "id");
        if (!entity.manualAttributesLocked) entity.category = pickString(categoryObj, "path") ?? pickString(categoryObj, "name");
        entity.categoryId = pickNumber(categoryObj, "id");
        entity.weight = toNumericString(pickNumber(p, "weight") ?? pickString(p, "weight"));
        entity.lengthCm = toNumericString(pickNumber(p, "length") ?? pickString(p, "length"));
        entity.width = toNumericString(pickNumber(p, "width") ?? pickString(p, "width"));
        entity.height = toNumericString(pickNumber(p, "height") ?? pickString(p, "height"));
        // evita apagar foto existente quando a API não trouxer images em alguma página
        entity.photo = photo ?? entity.photo ?? null;
        entity.url = null;
        entity.raw = { product: p, sku: s };

        toSave.push(entity);
      }

      if (toSave.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await productRepo.save(toSave, { chunk: 50 });
        upserted += toSave.length;
        processed += toSave.length;
      }

      const nextHref = getNextHref(root);
      if (!nextHref) break;
      url = nextHref.startsWith("http://") || nextHref.startsWith("https://") ? nextHref : `${baseUrl}${nextHref.startsWith("/") ? "" : "/"}${nextHref}`;
      pageNum += 1;
    }

    if (IS_TTY) process.stdout.write("\n");
    console.log(`[anymarket:products] company=${companyId} upserted=${upserted}`);

    upsertedForLog = upserted;

    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "FINALIZADO",
            log: {
              company: companyId,
              platform: { id: platform.id, slug: "anymarket" },
              command: "Produtos",
              status: "FINALIZADO",
              upserted: upsertedForLog,
            },
            errors: null as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company: companyRef,
            platform,
            command: "Produtos",
            status: "FINALIZADO",
            log: {
              company: companyId,
              platform: { id: platform.id, slug: "anymarket" },
              command: "Produtos",
              status: "FINALIZADO",
              upserted: upsertedForLog,
            },
            errors: null,
          }),
        );
      }
    } catch (e) {
      console.warn("[anymarket:products] falha ao finalizar log de integração:", e);
    }
  } catch (err) {
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const errorPayload =
        err instanceof Error ? { name: err.name, message: err.message, stack: err.stack ?? null } : { message: String(err) };
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "ERRO",
            log: {
              company: companyId,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "anymarket" } : null,
              command: "Produtos",
              status: "ERRO",
              upserted: upsertedForLog,
            },
            errors: errorPayload as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company: companyRefForLog ?? ({ id: companyId } as any),
            platform: platformRefForLog ?? null,
            command: "Produtos",
            status: "ERRO",
            log: {
              company: companyId,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "anymarket" } : null,
              command: "Produtos",
              status: "ERRO",
              upserted: upsertedForLog,
            },
            errors: errorPayload,
          }),
        );
      }
    } catch (e) {
      console.warn("[anymarket:products] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[anymarket:products] erro:", err);
  process.exit(1);
});

