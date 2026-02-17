import "dotenv/config";
import "reflect-metadata";

import { In, QueryFailedError } from "typeorm";
import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { FreightQuote } from "../../entities/FreightQuote.js";
import { FreightQuoteItem } from "../../entities/FreightQuoteItem.js";
import { FreightQuoteOption } from "../../entities/FreightQuoteOption.js";
import { Product } from "../../entities/Product.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";
import { toBrazilDateAndTime } from "../../utils/brazil-date-time.js";

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

function parseProductSkuFromPartnerSku(partnerSku: string | null): string | null {
  if (!partnerSku) return null;
  // AllPost sometimes sends sku like "253-1657". We want to match products.sku using the prefix (253).
  // Also seen: "371_1449" -> 371
  const prefix = partnerSku.split(/[-_]/, 1)[0]?.trim() ?? "";
  if (!/^\d+$/.test(prefix)) return null;
  return prefix;
}

function isNumericString(value: string | null): boolean {
  if (!value) return false;
  return /^\d+$/.test(value.trim());
}

function pickNumericString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  // aceita apenas dígitos para SKU/IDs numéricos
  return /^\d+$/.test(s) ? s : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseBooleanFromUnknown(v: unknown): boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "t" || s === "yes" || s === "y" || s === "sim") return true;
  if (s === "false" || s === "f" || s === "no" || s === "n" || s === "nao" || s === "não") return false;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 0;
  return null;
}

function normalizeBearerToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice("bearer ".length).trim() : trimmed;
}

function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const anyErr = err as unknown as { driverError?: { code?: string } };
  return anyErr.driverError?.code === "23505";
}

/** Opção com deadline (carrierDeadline) e preço (shippingValue numérico) para escolha da melhor. */
type BestOptionRow = { deadline: number; price: number; shippingValueStr: string };

/**
 * Escolhe a melhor opção: se existir uma opção dominante (menor deadline e menor preço), usa ela;
 * senão usa a opção com menor score: (deadline/min_deadline) + (price/min_price).
 * Sempre retorna deadline e preço da mesma linha.
 */
function selectBestOption(
  rows: BestOptionRow[],
): { bestDeadline: number | null; bestFreightCost: string | null } {
  const valid = rows.filter(
    (r) =>
      r.deadline != null &&
      Number.isFinite(r.deadline) &&
      r.deadline > 0 &&
      r.price != null &&
      Number.isFinite(r.price) &&
      r.price >= 0,
  );
  if (valid.length === 0) return { bestDeadline: null, bestFreightCost: null };

  const minDeadline = Math.min(...valid.map((r) => r.deadline));
  const minPrice = Math.min(...valid.map((r) => r.price));

  const dominant = valid.find((r) => r.deadline === minDeadline && r.price === minPrice);
  if (dominant) {
    return { bestDeadline: dominant.deadline, bestFreightCost: dominant.shippingValueStr };
  }

  const safeMinPrice = minPrice > 0 ? minPrice : 1;
  const first = valid[0];
  if (!first) return { bestDeadline: null, bestFreightCost: null };
  let best: BestOptionRow = first;
  let bestScore = best.deadline / minDeadline + best.price / safeMinPrice;
  for (let i = 1; i < valid.length; i += 1) {
    const r = valid[i];
    if (!r) continue;
    const score = r.deadline / minDeadline + r.price / safeMinPrice;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return { bestDeadline: best.deadline, bestFreightCost: best.shippingValueStr };
}

async function httpGetJson(url: string, bearerToken: string): Promise<unknown> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: "application/json",
    },
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ao chamar ${url}. Body: ${text.slice(0, 500)}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Resposta não é JSON válido ao chamar ${url}. Body: ${text.slice(0, 500)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await AppDataSource.initialize();

  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let insertedForLog = 0;
  let skippedExistingForLog = 0;
  let skippedDuplicateForLog = 0;
  let invalidRowsForLog = 0;
  let pagesFetchedForLog = 0;
  let totalApiForLog = 0;
  let uniqueQuoteIdForLog = 0;
  let integrationLogId: number | null = null;

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const quoteRepo = AppDataSource.getRepository(FreightQuote);
    const quoteItemRepo = AppDataSource.getRepository(FreightQuoteItem);
    const quoteOptionRepo = AppDataSource.getRepository(FreightQuoteOption);
    const productRepo = AppDataSource.getRepository(Product);
    const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);

    const company = await companyRepo.findOne({ where: { id: args.company } });
    if (!company) throw new Error(`Company ${args.company} não encontrada.`);
    const companyRef: Company = company;
    companyRefForLog = companyRef;

    const platform = await platformRepo.findOne({ where: { slug: "allpost" } });
    if (!platform) throw new Error('Plataform slug="allpost" não encontrada. Cadastre e instale antes.');
    platformRefForLog = platform;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: company.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Plataform "allpost" não está instalada nessa company (company_platforms).');

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    // Partner reference: Authorization: Bearer {{token_api}}
    const tokenApi = typeof cfg.token_api === "string" ? cfg.token_api : null;
    const tokenFallback = typeof cfg.token_cotacao === "string" ? cfg.token_cotacao : null;
    const tokenRaw = tokenApi ?? tokenFallback;
    const token = tokenRaw ? normalizeBearerToken(tokenRaw) : null;
    if (!token) throw new Error('Config da AllPost precisa conter "token_api" ou "token_cotacao" (Bearer).');

    // log inicial (PROCESSANDO)
    try {
      const started = await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: null,
          company: companyRef,
          platform,
          command: "Cotações",
          status: "PROCESSANDO",
          log: {
            company: args.company,
            platform: { id: platform.id, slug: "allpost" },
            command: "Cotações",
            status: "PROCESSANDO",
          },
          errors: null,
        }),
      );
      integrationLogId = started.id;
    } catch (e) {
      console.warn("[allpost:quotes] falha ao gravar log inicial (PROCESSANDO):", e);
    }

    const baseUrl = "https://www.allpost.com.br/api/v1/logCotacaoFila";
    const limit = 200;

    const rows: unknown[] = [];
    let page = 1;
    while (true) {
      const qs = new URLSearchParams({ limite: String(limit), page: String(page) });
      const url = `${baseUrl}?${qs.toString()}`;
      console.log(`[allpost:quotes] fetching page=${page} limit=${limit} url=${url}`);
      // eslint-disable-next-line no-await-in-loop
      const payload = await httpGetJson(url, token);
      const pageRows = ensureArray(payload);
      console.log(
        `[allpost:quotes] fetched page=${page} items=${pageRows.length} accumulated=${rows.length + pageRows.length}`,
      );
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      page += 1;
    }
    console.log(`[allpost:quotes] pagination finished pages_fetched=${page - 1} total_items=${rows.length}`);

    // quoteId -> row (dedupe inside response)
    const byQuoteId = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const obj = asRecord(r);
      if (!obj) continue;
      const partnerReturn = asRecord(obj.retorno ?? null);
      if (!partnerReturn) continue;
      const quoteId = pickString(partnerReturn, "idCotacao");
      if (!quoteId) continue;
      if (!byQuoteId.has(quoteId)) byQuoteId.set(quoteId, obj);
    }

    const quoteIds = Array.from(byQuoteId.keys());
    let existingQuoteIds = new Set<string>();
    if (quoteIds.length > 0) {
      console.log(`[allpost:quotes] checking existing quotes in DB unique_quote_id=${quoteIds.length}...`);
      const existing = await quoteRepo.find({
        select: { quoteId: true },
        where: { company: { id: company.id }, platform: { id: platform.id }, quoteId: In(quoteIds) },
      });
      existingQuoteIds = new Set(existing.map((e) => e.quoteId));
      console.log(`[allpost:quotes] existing in DB=${existingQuoteIds.size}`);
    }

    let inserted = 0;
    let skippedExisting = 0;
    let skippedDuplicateOnInsert = 0;
    let invalidRows = 0;

    const productCache = new Map<string, Product | null>();
    const productByReferenceCache = new Map<string, Product | null>();

    async function findProductBySku(sku: string): Promise<Product | null> {
      const cached = productCache.get(sku);
      if (cached !== undefined) return cached;
      const found = await productRepo.findOne({ where: { company: { id: companyRef.id }, sku } });
      productCache.set(sku, found ?? null);
      return found ?? null;
    }

    async function findProductByReference(reference: string): Promise<Product | null> {
      const key = reference.trim();
      const cached = productByReferenceCache.get(key);
      if (cached !== undefined) return cached;
      const found = await productRepo.findOne({ where: { company: { id: companyRef.id }, storeReference: key } });
      productByReferenceCache.set(key, found ?? null);
      return found ?? null;
    }

    for (const [quoteId, obj] of byQuoteId.entries()) {
      if (existingQuoteIds.has(quoteId)) {
        skippedExisting += 1;
        continue;
      }

      const partnerReturn = asRecord(obj.retorno ?? null);
      if (!partnerReturn) {
        invalidRows += 1;
        continue;
      }

      const destination = asRecord(partnerReturn.destino ?? null) ?? {};
      const input = asRecord(obj.dadosEntrada ?? null) ?? {};
      const cart = asRecord(input.carrinho ?? null) ?? {};

      const quotedAt = parseDate(pickString(partnerReturn, "dataCotacao"));
      const { date: quoteDate, time: quoteTime } = toBrazilDateAndTime(quotedAt);

      const optionsForBest = ensureArray(obj.opcoesEntrega);
      const bestOptionRows: BestOptionRow[] = [];
      for (const opt of optionsForBest) {
        const optObj = asRecord(opt);
        if (!optObj) continue;
        const prazoEntrega = asRecord(optObj.prazoEntrega ?? null) ?? {};
        const deadline = pickNumber(prazoEntrega, "prazoTransportadora");
        const shippingValueStr = toNumericString(pickNumber(optObj, "freteCobrar") ?? pickString(optObj, "freteCobrar"));
        const price = shippingValueStr != null ? Number(shippingValueStr) : NaN;
        if (deadline != null && deadline > 0 && Number.isFinite(price) && price >= 0 && shippingValueStr != null) {
          bestOptionRows.push({ deadline, price, shippingValueStr });
        }
      }
      const { bestDeadline, bestFreightCost } = selectBestOption(bestOptionRows);

      const entity = quoteRepo.create({
        company: companyRef,
        platform,
        quoteId,
        partnerPlatform: pickString(partnerReturn, "plataforma"),
        externalQuoteId: pickString(partnerReturn, "idCotacaoExterno"),
        quotedAt,

        date: quoteDate,
        time: quoteTime,

        bestDeadline,
        bestFreightCost,

        destinationZip: pickString(destination, "cep") ?? toNumericString(pickNumber(destination, "cep")),
        destinationState: pickString(destination, "uf"),
        destinationStateName: pickString(destination, "ufExtenso"),
        destinationStateRegion: pickString(destination, "regiaoUf"),
        destinationCountryRegion: pickString(destination, "regiaoPais"),

        channel: pickString(input, "canal"),
        storeName: pickString(input, "nomeLoja"),
        invoiceValue: toNumericString(pickNumber(cart, "valorNF") ?? pickString(cart, "valorNF")),
        totalWeight: toNumericString(pickNumber(cart, "totalPeso") ?? pickString(cart, "totalPeso")),
        totalVolume: toNumericString(pickNumber(cart, "totalCubagem") ?? pickString(cart, "totalCubagem")),
        totalPackages: pickNumber(cart, "totalVolumes"),

        storeLimit: pickNumber(obj, "limiteCotacaoLoja"),
        channelLimit: pickNumber(obj, "limiteCotacaoCanal"),

        timings: (obj.tempo ?? null) as unknown,
        channelConfig: (obj.configCanal ?? null) as unknown,
        input: (obj.dadosEntrada ?? null) as unknown,
        categoryRestrictions: (obj.restricaoCategoria ?? null) as unknown,
        deliveryOptions: (obj.opcoesEntrega ?? null) as unknown,
        raw: obj as unknown,
      });

      try {
        // eslint-disable-next-line no-await-in-loop
        const savedQuote = await quoteRepo.save(entity);
        inserted += 1;

        // options: obj.opcoesEntrega[] (delivery_options)
        const options = ensureArray(obj.opcoesEntrega);
        for (let oi = 0; oi < options.length; oi += 1) {
          const opt = options[oi];
          const optObj = asRecord(opt);
          if (!optObj) continue;

          const dadosFrete = asRecord(optObj.dadosFrete ?? null) ?? {};
          const prazoEntrega = asRecord(optObj.prazoEntrega ?? null) ?? {};

          const optionEntity = quoteOptionRepo.create({
            company: companyRef,
            freightQuote: savedQuote,
            lineIndex: oi,

            shippingValue: toNumericString(pickNumber(optObj, "freteCobrar") ?? pickString(optObj, "freteCobrar")),
            shippingCost: toNumericString(pickNumber(optObj, "freteReal") ?? pickString(optObj, "freteReal")),

            carrier: pickString(dadosFrete, "transportadoraNome"),
            warehouseUf: pickString(dadosFrete, "filialUF"),
            warehouseCity: pickString(dadosFrete, "filialCidade"),
            warehouseName: pickString(dadosFrete, "filialNome"),
            shippingName: pickString(dadosFrete, "metodoEnvioNome"),

            carrierDeadline: pickNumber(prazoEntrega, "prazoTransportadora"),
            holidayDeadline: pickNumber(prazoEntrega, "prazoEntregaFeriado"),
            warehouseDeadline: pickNumber(prazoEntrega, "prazoAdicionalFilial"),
            deadline: pickNumber(optObj, "prazoEntregaTotal"),

            hasStock: parseBooleanFromUnknown(optObj.possuiEstoque),
            raw: optObj as unknown,
          });

          // eslint-disable-next-line no-await-in-loop
          await quoteOptionRepo.save(optionEntity);
        }

        // items: input.carrinho.produto[]
        const products = ensureArray(cart.produto);
        for (let i = 0; i < products.length; i += 1) {
          const p = products[i];
          const pObj = asRecord(p);
          if (!pObj) continue;

          const partnerSku = pickString(pObj, "sku");
          const partnerSkuIdStr = pickNumericString(pObj, "idSku");

          // Product linking strategy:
          // - If partnerSku has no "-" or "_" and is numeric > 1000, try matching by products.store_reference (reference).
          // - Otherwise, prefer numeric prefix from partnerSku (e.g. "253-1657" -> 253, "371_1449" -> 371) to match products.sku.
          // - Fallback to idSku when prefix isn't usable.
          const hasSeparator = Boolean(partnerSku && /[-_]/.test(partnerSku));
          let maybeProduct: Product | null = null;
          if (partnerSku && !hasSeparator && isNumericString(partnerSku)) {
            const n = Number(partnerSku);
            if (Number.isInteger(n) && n > 1000) {
              maybeProduct = await findProductByReference(partnerSku);
            }
          }
          if (!maybeProduct) {
            const skuPrefix = parseProductSkuFromPartnerSku(partnerSku);
            const productSkuToMatch = skuPrefix ?? partnerSkuIdStr;
            maybeProduct = productSkuToMatch ? await findProductBySku(productSkuToMatch) : null;
          }

          const item = quoteItemRepo.create({
            company: companyRef,
            quote: savedQuote,
            product: maybeProduct ?? null,
            lineIndex: i,
            partnerSku,
            partnerSkuId: partnerSkuIdStr,
            quantity: pickNumber(pObj, "qt"),
            price: toNumericString(pickNumber(pObj, "preco") ?? pickString(pObj, "preco")),
            volumes: pickNumber(pObj, "volumes"),
            stock: pickNumber(pObj, "estoque"),
            stockProduct: pickNumber(pObj, "estoqueProduto"),
            category: pickString(pObj, "categoria"),
            aggregator: pickString(pObj, "agrupador"),
            partnerOriginalSku: pickString(pObj, "skuOriginal"),
            channelPriceFrom: toNumericString(pickNumber(pObj, "precoCanalDe") ?? pickString(pObj, "precoCanalDe")),
            registrationPrice: toNumericString(pickNumber(pObj, "precoCadastro") ?? pickString(pObj, "precoCadastro")),
            channelPriceTo: toNumericString(pickNumber(pObj, "precoCanalPor") ?? pickString(pObj, "precoCanalPor")),
            raw: pObj as unknown,
          });
          // eslint-disable-next-line no-await-in-loop
          await quoteItemRepo.save(item);
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          skippedDuplicateOnInsert += 1;
          continue;
        }
        throw err;
      }
    }

    console.log(
      `[allpost:quotes] company=${args.company} limit=${limit} pages_fetched=${page - 1} total_api=${rows.length} unique_quote_id=${byQuoteId.size} inserted=${inserted} skipped_existing=${skippedExisting} skipped_duplicate_on_insert=${skippedDuplicateOnInsert} invalid_rows=${invalidRows}`,
    );

    // snapshot p/ log
    insertedForLog = inserted;
    skippedExistingForLog = skippedExisting;
    skippedDuplicateForLog = skippedDuplicateOnInsert;
    invalidRowsForLog = invalidRows;
    pagesFetchedForLog = page - 1;
    totalApiForLog = rows.length;
    uniqueQuoteIdForLog = byQuoteId.size;

    try {
      const payload = {
        company: args.company,
        platform: { id: platform.id, slug: "allpost" },
        command: "Cotações",
        status: "FINALIZADO",
        limit,
        pages_fetched: pagesFetchedForLog,
        total_api: totalApiForLog,
        unique_quote_id: uniqueQuoteIdForLog,
        inserted: insertedForLog,
        skipped_existing: skippedExistingForLog,
        skipped_duplicate_on_insert: skippedDuplicateForLog,
        invalid_rows: invalidRowsForLog,
      };
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          { processedAt: new Date(), status: "FINALIZADO", log: payload, errors: null as any },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company: companyRef,
            platform,
            command: "Cotações",
            status: "FINALIZADO",
            log: payload,
            errors: null,
          }),
        );
      }
    } catch (e) {
      console.warn("[allpost:quotes] falha ao finalizar log de integração:", e);
    }
  } catch (err) {
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const errorPayload =
        err instanceof Error ? { name: err.name, message: err.message, stack: err.stack ?? null } : { message: String(err) };
      const payload = {
        company: args.company,
        platform: platformRefForLog ? { id: platformRefForLog.id, slug: "allpost" } : null,
        command: "Cotações",
        status: "ERRO",
        inserted: insertedForLog,
        skipped_existing: skippedExistingForLog,
        skipped_duplicate_on_insert: skippedDuplicateForLog,
        invalid_rows: invalidRowsForLog,
        pages_fetched: pagesFetchedForLog,
        total_api: totalApiForLog,
        unique_quote_id: uniqueQuoteIdForLog,
      };
      if (integrationLogId) {
        await integrationLogRepo.update({ id: integrationLogId }, { processedAt: new Date(), status: "ERRO", log: payload, errors: errorPayload as any });
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: null,
            company: companyRefForLog ?? ({ id: args.company } as any),
            platform: platformRefForLog ?? null,
            command: "Cotações",
            status: "ERRO",
            log: payload,
            errors: errorPayload,
          }),
        );
      }
    } catch (e) {
      console.warn("[allpost:quotes] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[allpost:quotes] erro:", err);
  process.exit(1);
});


