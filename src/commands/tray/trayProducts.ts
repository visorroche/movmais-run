import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Product } from "../../entities/Product.js";

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

async function httpPostJson(url: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text().catch(() => "");
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  return { status: resp.status, json, text };
}

async function httpGetJson(url: string): Promise<{ status: number; json: unknown; text: string }> {
  const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const text = await resp.text().catch(() => "");
  const json = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  return { status: resp.status, json, text };
}

function isTrayTokenError(payload: unknown): boolean {
  const obj = asRecord(payload);
  if (!obj) return false;
  return obj.code === 401 && obj.error_code === 1000;
}

async function authenticate(baseUrl: string, code: string, consumerKey: string, consumerSecret: string): Promise<string> {
  const { status, json, text } = await httpPostJson(`${baseUrl}/auth`, {
    code,
    consumer_key: consumerKey,
    consumer_secret: consumerSecret,
  });

  if (status < 200 || status >= 300) {
    throw new Error(`Falha ao autenticar na Tray (HTTP ${status}). Body: ${text.slice(0, 500)}`);
  }

  const obj = asRecord(json);
  const token = obj ? (obj.access_token as string | undefined) : undefined;
  if (!token) {
    throw new Error(`Resposta de auth da Tray não contém access_token. Body: ${text.slice(0, 500)}`);
  }
  return token;
}

type TrayCtx = { baseUrl: string; code: string; consumerKey: string; consumerSecret: string; accessToken: string };

async function trayGetJson(ctx: TrayCtx, pathWithQuery: string, reauth: () => Promise<void>): Promise<{ json: unknown; text: string }> {
  const url = `${ctx.baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
    ctx.accessToken,
  )}`;

  let { status, json, text } = await httpGetJson(url);
  if (status === 401 && isTrayTokenError(json)) {
    await reauth();
    const retryUrl = `${ctx.baseUrl}${pathWithQuery}${pathWithQuery.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(
      ctx.accessToken,
    )}`;
    const retry = await httpGetJson(retryUrl);
    status = retry.status;
    json = retry.json;
    text = retry.text;
  }

  if (status < 200 || status >= 300) {
    throw new Error(`Falha Tray HTTP ${status} em ${pathWithQuery}. Body: ${text.slice(0, 500)}`);
  }
  return { json, text };
}

async function main() {
  const { company: companyId } = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new Error(`Company ${companyId} não encontrada.`);
    const companyRef: Company = company;

    const platform = await platformRepo.findOne({ where: { slug: "tray" } });
    if (!platform) throw new Error('Platform slug="tray" não encontrada. Cadastre e instale antes.');

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: companyRef.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Platform "tray" não está instalada nessa company.');

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const baseUrl = typeof cfg.url === "string" ? cfg.url.replace(/\/+$/, "") : null;
    const code = typeof cfg.code === "string" ? cfg.code : null;
    const consumerKey = typeof cfg.consumer_key === "string" ? cfg.consumer_key : null;
    const consumerSecret = typeof cfg.consumer_secret === "string" ? cfg.consumer_secret : null;
    let accessToken = typeof cfg.access_token === "string" ? cfg.access_token : null;

    if (!baseUrl || !code || !consumerKey || !consumerSecret) {
      throw new Error('Config da Tray precisa conter: url, code, consumer_key, consumer_secret. access_token é opcional.');
    }

    if (!accessToken) {
      accessToken = await authenticate(baseUrl, code, consumerKey, consumerSecret);
      companyPlatform.config = { ...cfg, access_token: accessToken };
      await cpRepo.save(companyPlatform);
    }

    const ctx: TrayCtx = { baseUrl, code, consumerKey, consumerSecret, accessToken };

    const reauth = async () => {
      const newToken = await authenticate(ctx.baseUrl, ctx.code, ctx.consumerKey, ctx.consumerSecret);
      ctx.accessToken = newToken;
      companyPlatform.config = { ...(companyPlatform.config as Record<string, unknown>), access_token: newToken };
      await cpRepo.save(companyPlatform);
    };

    const limit = 50; // maxLimit informado no payload
    let page = 1;
    let processed = 0;
    let upserted = 0;
    let total: number | null = null;

    while (true) {
      renderProgress(`[tray:products] page=${page} limit=${limit} processed=${processed} upserted=${upserted}`);
      const { json } = await trayGetJson(ctx, `/products?page=${page}&limit=${limit}`, reauth);
      const root = asRecord(json) ?? {};
      const paging = asRecord(root.paging) ?? {};
      if (total === null) total = pickNumber(paging, "total");

      const productsArr = ensureArray(root.Products);
      if (productsArr.length === 0) break;

      for (const wrapper of productsArr) {
        const w = asRecord(wrapper);
        const prod = w ? asRecord(w.Product) : null;
        if (!prod) continue;

        const ecommerceId = pickNumber(prod, "id");
        if (!ecommerceId) continue;

        const sku = String(ecommerceId); // Tray product_id (pode ser grande; manter como string)
        const refs = splitStoreReference(pickString(prod, "reference"));

        const weightGrams = pickString(prod, "weight");
        const weightKg = weightGrams && /^\d+(\.\d+)?$/.test(weightGrams.trim()) ? String(Number(weightGrams) / 1000) : null;

        const urlObj = asRecord(prod.url ?? null) ?? {};
        const productImages = ensureArray(prod.ProductImage);
        const firstImage = asRecord(productImages[0] ?? null);
        const photoHttps = firstImage ? pickString(firstImage, "https") : null;

        let entity =
          (await productRepo.findOne({ where: { company: { id: companyRef.id }, sku } })) ??
          productRepo.create({ company: companyRef, sku });

        entity.company = companyRef;
        entity.sku = sku;
        entity.ecommerceId = ecommerceId;
        entity.ean = pickString(prod, "ean");
        entity.slug = pickString(prod, "slug");
        entity.name = pickString(prod, "name");
        entity.storeReference = refs.storeReference;
        entity.externalReference = refs.externalReference;
        entity.brand = pickString(prod, "brand");
        entity.brandId = pickNumber(prod, "brand_id");
        entity.model = pickString(prod, "model");
        entity.ncm = pickString(prod, "ncm");
        // Campo disponível no catálogo da Tray (mais confiável do que inferências em orders)
        entity.category = pickString(prod, "category_name");
        entity.weight = toNumericString(weightKg);
        entity.lengthCm = toNumericString(pickNumber(prod, "length") ?? pickString(prod, "length"));
        entity.width = toNumericString(pickNumber(prod, "width") ?? pickString(prod, "width"));
        entity.height = toNumericString(pickNumber(prod, "height") ?? pickString(prod, "height"));
        entity.categoryId = pickNumber(prod, "category_id");
        entity.photo = photoHttps;
        entity.url = pickString(urlObj, "https") ?? pickString(urlObj, "http");
        entity.raw = prod as unknown;

        // eslint-disable-next-line no-await-in-loop
        entity = await productRepo.save(entity);
        upserted += 1;
        processed += 1;
      }

      const currentPage = pickNumber(paging, "page") ?? page;
      const currentLimit = pickNumber(paging, "limit") ?? limit;
      const offset = pickNumber(paging, "offset") ?? (currentPage - 1) * currentLimit;
      const nextOffset = offset + currentLimit;
      if (total !== null && nextOffset >= total) break;
      page += 1;
    }

    if (IS_TTY) process.stdout.write("\n");
    console.log(`[tray:products] company=${companyId} upserted=${upserted}`);
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[tray:products] erro:", err);
  process.exit(1);
});


