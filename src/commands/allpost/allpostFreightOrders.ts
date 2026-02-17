import "dotenv/config";
import "reflect-metadata";

import { In, QueryFailedError } from "typeorm";
import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { FreightOrder } from "../../entities/FreightOrder.js";
import { FreightOrderItem } from "../../entities/FreightOrderItem.js";
import { FreightQuote } from "../../entities/FreightQuote.js";
import { FreightQuoteItem } from "../../entities/FreightQuoteItem.js";
import { FreightQuoteOption } from "../../entities/FreightQuoteOption.js";
import { Product } from "../../entities/Product.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";
import { toBrazilDateAndTime, toBrazilDateString } from "../../utils/brazil-date-time.js";

type Args = {
  company: number;
  startDate: string;
  endDate: string;
  dataTipo: string;
  limit: number;
  force: boolean;
};

function normalizeStartEndValue(value: string): string {
  const v = value.trim();
  if (!v) return v;
  // aceita YYYY-MM-DD e converte para início do dia UTC-like (sem timezone)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00`;
  return v;
}

function extractYmd(value: string): string | null {
  const v = String(value || "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m?.[1] ?? null;
}

/** Dias de calendário entre duas datas YYYY-MM-DD (interpretadas como UTC noon para evitar bordas de fuso). */
function daysBetween(dateStrStart: string | null, dateStrEnd: string | null): number | null {
  if (!dateStrStart || !dateStrEnd) return null;
  const d1 = new Date(dateStrStart + "T12:00:00Z");
  const d2 = new Date(dateStrEnd + "T12:00:00Z");
  if (!Number.isFinite(d1.getTime()) || !Number.isFinite(d2.getTime())) return null;
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

function ymdToDate(value: string | null): Date | null {
  if (!value) return null;
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

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

  const startDateRaw = raw.get("start-date") ?? raw.get("startDate") ?? "";
  const endDateRaw = raw.get("end-date") ?? raw.get("endDate") ?? "";
  const fromRaw = raw.get("from") ?? raw.get("inicio") ?? raw.get("start") ?? "";
  const toRaw = raw.get("to") ?? raw.get("fim") ?? raw.get("end") ?? "";

  const startDate = normalizeStartEndValue(startDateRaw || fromRaw);
  const endDate = normalizeStartEndValue(endDateRaw || toRaw);

  if (!startDate || !endDate) {
    throw new Error(
      "Parâmetros obrigatórios: --start-date=YYYY-MM-DD[THH:mm:ss] e --end-date=YYYY-MM-DD[THH:mm:ss].",
    );
  }

  if (!startDateRaw && fromRaw) {
    console.warn('[allpost:freight-orders] aviso: "--from/--to" está deprecated. Use "--start-date/--end-date".');
  }

  const dataTipo = raw.get("dataTipo") ?? "dataCriacaoPedido";

  const limit = raw.get("limit") ? Number(raw.get("limit")) : 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error("Parâmetro inválido: --limit=N (1..500).");
  }

  const forceRaw = raw.get("force");
  const force =
    raw.has("force") &&
    (forceRaw === undefined || forceRaw === "" || forceRaw.toLowerCase() === "true" || forceRaw === "1");

  return { company, startDate, endDate, dataTipo, limit, force };
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

function parseProductSkuFromPartnerSku(partnerSku: string | null): string | null {
  if (!partnerSku) return null;
  // AllPost pode enviar "253-1657" ou "371_1449" -> queremos o prefixo numérico para bater com products.sku
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
  return /^\d+$/.test(s) ? s : null;
}

function normalizeBearerToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed.slice("bearer ".length).trim() : trimmed;
}

function parsePartnerDate(value: string | null): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  // AllPost envia frequentemente como "YYYY-MM-DD HH:mm:ss"
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(/\s+/, "T") : v;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normalizeOrderCode(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  // exemplos reais: "tray-58905" -> "58905"
  // regra: pega o último grupo de dígitos; se não houver, mantém o valor original
  const m = v.match(/(\d+)\s*$/);
  return m?.[1] ?? v;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function maxNumber(a: number | null, b: number | null): number | null {
  if (a === null || a === undefined) return b;
  if (b === null || b === undefined) return a;
  return a >= b ? a : b;
}

function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const anyErr = err as unknown as { driverError?: { code?: string } };
  return anyErr.driverError?.code === "23505";
}

function isMissingTable(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const anyErr = err as unknown as { driverError?: { code?: string } };
  // postgres: undefined_table
  return anyErr.driverError?.code === "42P01";
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

  // para log em caso de erro
  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let filterDateForLog: string | null = null;

  // contadores (podem ficar parciais em caso de erro)
  let pageForLog = 1;
  let fetchedForLog = 0;
  let insertedForLog = 0;
    let updatedForLog = 0;
    let skippedExistingForLog = 0;
    let skippedDuplicateForLog = 0;
  let invalidRowsForLog = 0;
  let quotesEnsuredForLog = 0;
  let quotesFailedForLog = 0;

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const orderRepo = AppDataSource.getRepository(FreightOrder);
    const orderItemRepo = AppDataSource.getRepository(FreightOrderItem);
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
    const platformRef: Plataform = platform;
    platformRefForLog = platformRef;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: company.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) throw new Error('Plataform "allpost" não está instalada nessa company (company_platforms).');

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const tokenApi = typeof cfg.token_api === "string" ? cfg.token_api : null;
    const tokenFallback = typeof cfg.token_cotacao === "string" ? cfg.token_cotacao : null;
    // Documentação:
    // - /pedidos: usa token_api
    // - /cotacao/{id}: usa token_cotacao
    const ordersTokenRaw = tokenApi ?? tokenFallback;
    const quotesTokenRaw = tokenFallback;
    const ordersToken = ordersTokenRaw ? normalizeBearerToken(ordersTokenRaw) : null;
    const quotesToken = quotesTokenRaw ? normalizeBearerToken(quotesTokenRaw) : null;
    if (!ordersToken) throw new Error('Config da AllPost precisa conter "token_api" ou "token_cotacao" (Bearer).');
    const ordersTokenRef: string = ordersToken;
    const quotesTokenRef: string | null = quotesToken;

    const baseUrl = "https://www.allpost.com.br/api/v1/pedidos/";
    const quoteUrl = "https://www.allpost.com.br/api/v1/cotacao";
    const periodo = `${args.startDate}TO${args.endDate}`;
    const filterDate = extractYmd(args.startDate);
    filterDateForLog = filterDate;

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

    const knownQuoteIds = new Set<string>(); // já confirmados no DB nesta execução
    const failedQuoteIds = new Set<string>(); // falhas definitivas nesta execução (evita spam)

    async function ensureQuoteExists(quoteId: string): Promise<void> {
      const qid = quoteId.trim();
      if (!qid) return;
      if (knownQuoteIds.has(qid)) return;
      if (failedQuoteIds.has(qid)) return;
      if (!quotesTokenRef) {
        failedQuoteIds.add(qid);
        console.warn(
          `[allpost:freight-orders] não foi possível garantir cotação quote_id=${qid}: token_cotacao não configurado para esta company.`,
        );
        return;
      }

      // 1) checa DB
      const existing = await quoteRepo.findOne({
        select: { id: true, quoteId: true },
        where: { company: { id: companyRef.id }, platform: { id: platformRef.id }, quoteId: qid },
      });
      if (existing) {
        knownQuoteIds.add(qid);
        return;
      }

      // 2) busca na API e insere
      const url = `${quoteUrl}/${encodeURIComponent(qid)}`;
      const payload = await httpGetJson(url, quotesTokenRef);
      const obj = asRecord(payload);
      if (!obj) return;

      const partnerReturn = asRecord(obj.retorno ?? null);
      if (!partnerReturn) return;

      const destination = asRecord(partnerReturn.destino ?? null) ?? {};
      const input = asRecord(obj.dadosEntrada ?? null) ?? {};
      const cart = asRecord(input.carrinho ?? null) ?? {};

      const quoteEntity = quoteRepo.create();
      Object.assign(quoteEntity, {
        company: companyRef,
        platform: platformRef,
        quoteId: pickString(partnerReturn, "idCotacao") ?? qid,
        partnerPlatform: pickString(partnerReturn, "plataforma"),
        externalQuoteId: pickString(partnerReturn, "idCotacaoExterno"),
        quotedAt: parseDate(pickString(partnerReturn, "dataCotacao")),

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
      } as any);

      let savedQuote: FreightQuote | null = null;
      try {
        savedQuote = await quoteRepo.save(quoteEntity);
      } catch (err) {
        if (isUniqueViolation(err)) {
          savedQuote = await quoteRepo.findOne({
            where: { company: { id: companyRef.id }, platform: { id: platformRef.id }, quoteId: qid },
          });
        } else {
          throw err;
        }
      }
      if (!savedQuote) return;

      // options: opcoesEntrega[]
      const options = ensureArray(obj.opcoesEntrega);
      for (let oi = 0; oi < options.length; oi += 1) {
        const optObj = asRecord(options[oi]);
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
        try {
          // eslint-disable-next-line no-await-in-loop
          await quoteOptionRepo.save(optionEntity);
        } catch (err) {
          if (isUniqueViolation(err)) continue;
          throw err;
        }
      }

      // items: dadosEntrada.carrinho.produto[]
      const products = ensureArray(cart.produto);
      for (let i = 0; i < products.length; i += 1) {
        const pObj = asRecord(products[i]);
        if (!pObj) continue;

        const partnerSku = pickString(pObj, "sku");
        const partnerSkuIdStr = pickNumericString(pObj, "idSku");

        const hasSeparator = Boolean(partnerSku && /[-_]/.test(partnerSku));
        let maybeProduct: Product | null = null;
        if (partnerSku && !hasSeparator && isNumericString(partnerSku)) {
          const n = Number(partnerSku);
          if (Number.isInteger(n) && n > 1000) {
            // quando é um ID grande, costuma ser storeReference
            // eslint-disable-next-line no-await-in-loop
            maybeProduct = await findProductByReference(partnerSku);
          }
        }
        if (!maybeProduct) {
          const skuPrefix = parseProductSkuFromPartnerSku(partnerSku);
          const productSkuToMatch = skuPrefix ?? partnerSkuIdStr;
          // eslint-disable-next-line no-await-in-loop
          maybeProduct = productSkuToMatch ? await findProductBySku(productSkuToMatch) : null;
        }

        const itemEntity = quoteItemRepo.create({
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
        try {
          // eslint-disable-next-line no-await-in-loop
          await quoteItemRepo.save(itemEntity);
        } catch (err) {
          if (isUniqueViolation(err)) continue;
          throw err;
        }
      }

      knownQuoteIds.add(qid);
    }

    let page = 1;
    let fetched = 0;
    let inserted = 0;
    let updated = 0;
    let skippedExisting = 0;
    let skippedDuplicateOnInsert = 0;
    let invalidRows = 0;

    while (true) {
      const qs = new URLSearchParams({
        dataTipo: args.dataTipo,
        periodo,
        pagina: String(page),
        limite: String(args.limit),
      });
      const url = `${baseUrl}?${qs.toString()}`;
      console.log(`[allpost:freight-orders] fetching page=${page} limit=${args.limit} url=${url}`);
      // eslint-disable-next-line no-await-in-loop
      const payload = await httpGetJson(url, ordersTokenRef);
      const pageRows = ensureArray(payload);
      fetched += pageRows.length;
      console.log(`[allpost:freight-orders] fetched page=${page} items=${pageRows.length} total_fetched=${fetched}`);
      if (pageRows.length === 0) break;

      // dedupe na própria página por _id
      const byExternalId = new Map<string, Record<string, unknown>>();
      for (const r of pageRows) {
        const obj = asRecord(r);
        if (!obj) continue;
        const externalId = pickString(obj, "_id");
        if (!externalId) continue;
        if (!byExternalId.has(externalId)) byExternalId.set(externalId, obj);
      }

      const externalIds = Array.from(byExternalId.keys());
      let existingExternalIds = new Set<string>();
      const existingOrderIdByExternalId = new Map<string, number>();
      if (externalIds.length > 0) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const existing = await orderRepo.find({
            select: { id: true, externalId: true },
            where: { company: { id: company.id }, platform: { id: platformRef.id }, externalId: In(externalIds) },
          });
          existingExternalIds = new Set(existing.map((e) => e.externalId));
          if (args.force) {
            for (const e of existing) {
              existingOrderIdByExternalId.set(e.externalId, e.id);
            }
          }
        } catch (err) {
          if (isMissingTable(err)) {
            throw new Error(
              'Tabela "freight_orders" não existe. Rode o SQL em `script-bi/sql/create_freight_quotes_tables.sql` (ou habilite TYPEORM_SYNC=true em dev) e reinicie o scheduler.',
            );
          }
          throw err;
        }
      }

      for (const [externalId, obj] of byExternalId.entries()) {
        const existingId = existingOrderIdByExternalId.get(externalId);
        const isExisting = existingExternalIds.has(externalId);

        if (isExisting && !args.force) {
          skippedExisting += 1;
          continue;
        }

        const enderecoEntrega = asRecord(obj.enderecoEntrega ?? null) ?? {};
        const quoteIdFromOrder = pickString(obj, "idCotacao");
        if (quoteIdFromOrder) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await ensureQuoteExists(quoteIdFromOrder);
          } catch (err) {
            // não bloqueia a order se cotação não conseguir ser criada.
            // Evita spam: se for "Loja não encontrada" (token/loja), marcamos como falha para não repetir.
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("Loja não encontrada")) failedQuoteIds.add(quoteIdFromOrder);
            console.warn(`[allpost:freight-orders] não foi possível garantir cotação quote_id=${quoteIdFromOrder}: ${msg}`);
          }
        }

        // envio[]: pegar sempre o maior valor; somar valorTotalProdutos das NFs
        const envios = ensureArray(obj.envio);
        let maxPrazoEntregaPedido: Date | null = null;
        let maxDataEntrega: Date | null = null;
        let maxDelta: number | null = null;
        let sumValorTotalProdutos: number | null = null;
        for (const e of envios) {
          const eObj = asRecord(e);
          if (!eObj) continue;
          maxPrazoEntregaPedido = maxDate(maxPrazoEntregaPedido, parsePartnerDate(pickString(eObj, "prazoEntregaPedido")));
          maxDataEntrega = maxDate(maxDataEntrega, parsePartnerDate(pickString(eObj, "dataEntrega")));
          maxDelta = maxNumber(maxDelta, pickNumber(eObj, "diferencaPedidoCotacao"));
          const notaFiscal = asRecord(eObj.notaFiscal ?? null);
          if (notaFiscal) {
            const v = pickNumber(notaFiscal, "valorTotalProdutos");
            if (v != null) sumValorTotalProdutos = (sumValorTotalProdutos ?? 0) + v;
          }
        }

        const orderDate = parsePartnerDate(pickString(obj, "data"));
        const { date: orderDateOnly, time: orderTimeOnly } = toBrazilDateAndTime(orderDate);
        const estimatedDateStr = toBrazilDateString(maxPrazoEntregaPedido);
        const numDeliveryDays = daysBetween(orderDateOnly, estimatedDateStr);

        const orderPayload = {
          orderDate,
          date: orderDateOnly,
          time: orderTimeOnly,
          orderCode: normalizeOrderCode(pickString(obj, "numeroPedido")),
          storeName: pickString(obj, "nomeLoja"),
          quoteId: quoteIdFromOrder,
          channel: pickString(obj, "canal"),
          freightAmount: toNumericString(pickNumber(obj, "valorFretePedido") ?? pickString(obj, "valorFretePedido")),
          freightCost: toNumericString(pickNumber(obj, "valorFreteReal") ?? pickString(obj, "valorFreteReal")),
          deltaQuote: toNumericString(
            pickNumber(obj, "valorFreteDiferencaPedidoCotacao") ?? pickString(obj, "valorFreteDiferencaPedidoCotacao"),
          ),
          invoiceValue: toNumericString(sumValorTotalProdutos),

          address: pickString(enderecoEntrega, "endereco"),
          addressZip: pickString(enderecoEntrega, "cep"),
          addressState: pickString(enderecoEntrega, "uf"),
          addressCity: pickString(enderecoEntrega, "cidade"),
          addressNeighborhood: pickString(enderecoEntrega, "bairro"),
          addressNumber: pickString(enderecoEntrega, "numero"),
          addressComplement: pickString(enderecoEntrega, "referencia"),

          estimatedDeliveryDate: maxPrazoEntregaPedido,
          numDeliveryDays,
          deliveryDate: maxDataEntrega,
          deltaQuoteDeliveryDate: toNumericString(maxDelta),

          raw: obj as unknown,
        };

        let orderId: number;

        if (isExisting && args.force && existingId != null) {
          // --force: atualizar pedido existente e reimportar itens
          await orderRepo.update(existingId, orderPayload as Record<string, unknown>);
          await orderItemRepo.delete({ order: { id: existingId } });
          orderId = existingId;
          updated += 1;
        } else {
          const entity = orderRepo.create({
            ...orderPayload,
            company: companyRef,
            platform: platformRef,
            externalId,
          });
          try {
            // eslint-disable-next-line no-await-in-loop
            await orderRepo.save(entity);
            inserted += 1;
          } catch (err) {
            if (isMissingTable(err)) {
              throw new Error(
                'Tabela "freight_orders" não existe. Rode o SQL em `script-bi/sql/create_freight_quotes_tables.sql` (ou habilite TYPEORM_SYNC=true em dev) e reinicie o scheduler.',
              );
            }
            if (isUniqueViolation(err)) {
              skippedDuplicateOnInsert += 1;
              continue;
            }
            throw err;
          }
          orderId = entity.id;
        }

        // itens do pedido: envio[].produtos[]
        let lineIndex = 0;
        for (let ei = 0; ei < envios.length; ei += 1) {
          const eObj = asRecord(envios[ei]);
          if (!eObj) continue;
          const produtos = ensureArray(eObj.produtos);
          for (let pi = 0; pi < produtos.length; pi += 1) {
            const pObj = asRecord(produtos[pi]);
            if (!pObj) continue;

            const partnerSku = pickString(pObj, "sku") ?? pickString(pObj, "skuLoja");
            const partnerSkuIdStr = pickNumericString(pObj, "idSku");

            let maybeProduct: Product | null = null;
            const skuPrefix = parseProductSkuFromPartnerSku(partnerSku);
            const productSkuToMatch = skuPrefix ?? partnerSkuIdStr;
            if (productSkuToMatch) {
              // eslint-disable-next-line no-await-in-loop
              maybeProduct = await findProductBySku(productSkuToMatch);
            }
            if (!maybeProduct && partnerSku && isNumericString(partnerSku)) {
              // eslint-disable-next-line no-await-in-loop
              maybeProduct = await findProductByReference(partnerSku);
            }

            const itemEntity = orderItemRepo.create({
              company: companyRef,
              order: { id: orderId } as FreightOrder,
              product: maybeProduct ?? null,
              lineIndex,
              envioIndex: ei,
              partnerSku,
              partnerSkuId: partnerSkuIdStr,
              title: pickString(pObj, "titulo"),
              quantity: pickNumber(pObj, "quantidade"),
              price: toNumericString(pickNumber(pObj, "preco") ?? pickString(pObj, "preco")),
              volumes: pickNumber(pObj, "quantidadeVolumes"),
              weight: toNumericString(pickNumber(pObj, "peso") ?? pickString(pObj, "peso")),
              category: pickString(pObj, "categoria") ?? pickString(pObj, "categoriaCadastro"),
              variation: pickString(pObj, "variacao"),
              raw: pObj as unknown,
            });
            try {
              // eslint-disable-next-line no-await-in-loop
              await orderItemRepo.save(itemEntity);
            } catch (itemErr) {
              if (isMissingTable(itemErr)) {
                throw new Error(
                  'Tabela "freight_order_items" não existe. Rode o SQL em `script-bi/sql/create_freight_order_items_table.sql` (ou habilite TYPEORM_SYNC=true em dev).',
                );
              }
              if (isUniqueViolation(itemErr)) continue;
              throw itemErr;
            }
            lineIndex += 1;
          }
        }
      }

      page += 1;
    }

    // snapshot para log (sucesso)
    pageForLog = page;
    fetchedForLog = fetched;
    insertedForLog = inserted;
    updatedForLog = updated;
    skippedExistingForLog = skippedExisting;
    skippedDuplicateForLog = skippedDuplicateOnInsert;
    invalidRowsForLog = invalidRows;
    quotesEnsuredForLog = knownQuoteIds.size;
    quotesFailedForLog = failedQuoteIds.size;

    const logPayload = {
      company: args.company,
      platform: { id: platformRef.id, slug: "allpost" },
      command: "Pedidos",
      dataTipo: args.dataTipo,
      startDate: args.startDate,
      endDate: args.endDate,
      periodo,
      pages_fetched: page - 1,
      fetched,
      inserted,
      updated,
      skipped_existing: skippedExisting,
      skipped_duplicate_on_insert: skippedDuplicateOnInsert,
      invalid_rows: invalidRows,
      quotes_ensured: knownQuoteIds.size,
      quotes_failed: failedQuoteIds.size,
    };

    try {
      await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: ymdToDate(filterDate),
          company: companyRef,
          platform: platformRef,
          command: "Pedidos",
          log: logPayload,
          errors: null,
        }),
      );
    } catch (e) {
      console.warn("[allpost:freight-orders] falha ao gravar log de integração:", e);
    }

    console.log(
      `[allpost:freight-orders] company=${args.company} dataTipo=${args.dataTipo} periodo=${periodo} pages_fetched=${page - 1} fetched=${fetched} inserted=${inserted} updated=${updated} skipped_existing=${skippedExisting} skipped_duplicate_on_insert=${skippedDuplicateOnInsert} invalid_rows=${invalidRows}`,
    );
  } catch (err) {
    // tenta gravar log de erro (best effort)
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const base = {
        company: args.company,
        platform: platformRefForLog ? { id: platformRefForLog.id, slug: "allpost" } : null,
        command: "Pedidos",
        dataTipo: args.dataTipo,
        startDate: args.startDate,
        endDate: args.endDate,
        periodo: `${args.startDate}TO${args.endDate}`,
        pages_fetched: Math.max(0, pageForLog - 1),
        fetched: fetchedForLog,
        inserted: insertedForLog,
        updated: updatedForLog,
        skipped_existing: skippedExistingForLog,
        skipped_duplicate_on_insert: skippedDuplicateForLog,
        invalid_rows: invalidRowsForLog,
        quotes_ensured: quotesEnsuredForLog,
        quotes_failed: quotesFailedForLog,
      };
      await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: ymdToDate(filterDateForLog),
          company: companyRefForLog ?? ({ id: args.company } as any),
          platform: platformRefForLog ?? null,
          command: "Pedidos",
          log: base,
          errors:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack ?? null }
              : { message: String(err) },
        }),
      );
    } catch (e) {
      console.warn("[allpost:freight-orders] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[allpost:freight-orders] erro:", err);
  process.exit(1);
});

