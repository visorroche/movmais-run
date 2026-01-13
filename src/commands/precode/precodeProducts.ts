import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Product } from "../../entities/Product.js";

type Args = { company: number };

function parseArgs(argv: string[]): Args {
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

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
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

async function httpGetJson(url: string, token: string): Promise<unknown> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ao chamar ${url}. Body: ${text.slice(0, 500)}`);
  }
  return await resp.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const plataformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: args.company } });
    if (!company) throw new Error(`Company ${args.company} não encontrada.`);
    const companyRef: Company = company;

    const plataform = await plataformRepo.findOne({ where: { slug: "precode" } });
    if (!plataform) throw new Error('Plataform slug="precode" não encontrada. Cadastre e instale antes.');

    const companyPlataform = await cpRepo.findOne({
      where: { company: { id: companyRef.id }, platform: { id: plataform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlataform) throw new Error('Plataform "precode" não está instalada nessa company (company_platforms).');

    const cfg = (companyPlataform.config ?? {}) as Record<string, unknown>;
    const token = typeof cfg.token === "string" ? cfg.token : null;
    if (!token) throw new Error('Config da plataforma precode precisa conter "token" (Authorization Basic).');
    const tokenStr: string = token;

    const productApiCache = new Map<number, { raw: unknown; produto: Record<string, unknown> | null } | null>();

    async function fetchProductBySku(
      sku: number,
    ): Promise<{ raw: unknown; produto: Record<string, unknown> | null } | null> {
      const cached = productApiCache.get(sku);
      if (cached !== undefined) return cached;
      const url = `https://www.replicade.com.br/api/v1/produtoLoja/ProdutoSku/${sku}`;
      try {
        const json = await httpGetJson(url, tokenStr);
        const root = (json ?? {}) as Record<string, unknown>;
        const produto = (root.produto ?? null) as Record<string, unknown> | null;
        const out = { raw: json ?? null, produto };
        productApiCache.set(sku, out);
        return out;
      } catch {
        productApiCache.set(sku, null);
        return null;
      }
    }

    // ListaProduto é paginado (page=1..N). Vamos buscar até não retornar mais produtos.
    const baseListUrl = "https://www.replicade.com.br/api/v1/produtoLoja/ListaProduto";
    let page = 1;
    let pagesFetched = 0;
    const MAX_PAGES = 10_000; // safety cap para evitar loop infinito caso a API ignore paginação
    const seenSkus = new Set<string>();

    let processed = 0;
    let upserted = 0;
    let detailsFetched = 0;
    let detailsMissing = 0;

    while (true) {
      if (page > MAX_PAGES) {
        console.warn(`[precode:products] aborting pagination: max_pages_reached=${MAX_PAGES}`);
        break;
      }

      const listUrl = `${baseListUrl}?page=${page}`;
      const listJson = await httpGetJson(listUrl, tokenStr);
      const listObj = asRecord(listJson) ?? {};
      const listArr = ensureArray(listObj.produto);
      pagesFetched += 1;

      let newSkusInPage = 0;
      console.log(`[precode:products] fetching page=${page} items=${listArr.length}`);
      if (listArr.length === 0) break;

      for (const row of listArr) {
        const obj = asRecord(row);
        if (!obj) continue;
        const skuNum = pickNumber(obj, "sku");
        if (!skuNum) continue;
        const sku = String(skuNum);
        if (seenSkus.has(sku)) continue;
        seenSkus.add(sku);
        newSkusInPage += 1;

        const api = await fetchProductBySku(skuNum);
        if (api?.produto) detailsFetched += 1;
        else detailsMissing += 1;

        const produto = api?.produto ?? null;
        const listTitle = pickString(obj, "titulo");
        const listCategory = pickString(obj, "categoria");
        const listReference = pickString(obj, "IdReferencia");

        let entity =
          (await productRepo.findOne({ where: { company: { id: companyRef.id }, sku } })) ??
          productRepo.create({ company: companyRef, sku });

        entity.company = companyRef;
        entity.sku = sku;

        // Precode não fornece esses campos aqui (mantemos null)
        entity.ecommerceId = entity.ecommerceId ?? null;
        entity.ean = entity.ean ?? null;
        entity.slug = entity.slug ?? null;
        entity.brandId = entity.brandId ?? null;
        entity.categoryId = entity.categoryId ?? null;
        entity.photo = entity.photo ?? null;
        entity.url = entity.url ?? null;

        // Preferimos o detalhamento ProdutoSku; fallback para ListaProduto
        entity.name =
          (produto ? pickString(produto, "tituloCurto") ?? pickString(produto, "titulo") : null) ??
          listTitle ??
          entity.name ??
          null;
        entity.storeReference =
          (produto ? pickString(produto, "codigoReferenciaFabrica") : null) ??
          listReference ??
          entity.storeReference ??
          null;

        entity.brand = (produto ? pickString(produto, "marca") : null) ?? entity.brand ?? null;
        entity.model = (produto ? pickString(produto, "modelo") : null) ?? entity.model ?? null;

        entity.weight =
          toNumericString(produto ? (pickNumber(produto, "peso") ?? pickString(produto, "peso")) : null) ??
          entity.weight ??
          null;
        entity.width =
          toNumericString(produto ? (pickNumber(produto, "largura_cm") ?? pickString(produto, "largura_cm")) : null) ??
          entity.width ??
          null;
        entity.height =
          toNumericString(produto ? (pickNumber(produto, "altura_cm") ?? pickString(produto, "altura_cm")) : null) ??
          entity.height ??
          null;
        entity.lengthCm =
          toNumericString(
            produto ? (pickNumber(produto, "profundidade_cm") ?? pickString(produto, "profundidade_cm")) : null,
          ) ??
          entity.lengthCm ??
          null;

        entity.ncm =
          (produto ? (pickString(produto, "NCM") ?? pickString(produto, "ncm")) : null) ?? entity.ncm ?? null;
        entity.category =
          (produto ? pickString(produto, "categoria") : null) ?? listCategory ?? entity.category ?? null;
        entity.subcategory = (produto ? pickString(produto, "subcategoria") : null) ?? entity.subcategory ?? null;
        entity.finalCategory = (produto ? pickString(produto, "categoriaFinal") : null) ?? entity.finalCategory ?? null;

        // payload cru: guardamos lista + detalhes (quando houver)
        entity.raw = { list: obj, detail: api?.raw ?? null };

        // eslint-disable-next-line no-await-in-loop
        entity = await productRepo.save(entity);
        upserted += 1;
        processed += 1;

        if (processed % 100 === 0) {
          console.log(
            `[precode:products] processed=${processed} upserted=${upserted} details_fetched=${detailsFetched} details_missing=${detailsMissing}`,
          );
        }
      }
      if (newSkusInPage === 0) {
        console.warn(
          `[precode:products] stopping pagination: page=${page} returned items=${listArr.length} but new_skus_in_page=0 (API may be repeating / ignoring page param)`,
        );
        break;
      }
      page += 1;
    }

    console.log(
      `[precode:products] company=${args.company} pages_fetched=${pagesFetched} processed=${processed} upserted=${upserted} details_fetched=${detailsFetched} details_missing=${detailsMissing} unique_skus=${seenSkus.size}`,
    );
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[precode:products] erro:", err);
  process.exit(1);
});


