import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Plataform } from "../../entities/Plataform.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import { Customer } from "../../entities/Customer.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Product } from "../../entities/Product.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";
import { mapPanoramaStatus, isOrderStatus } from "../../utils/status/index.js";
import { toBrazilianState } from "../../utils/brazilian-states.js";
import { toPersonType } from "../../utils/person-type.js";

type Args = {
  company: number;
  startDate: string;
  endDate: string;
  onlyInsert?: boolean;
};

function yesterdayUtc(): string {
  const now = new Date();
  const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  y.setUTCDate(y.getUTCDate() - 1);
  return `${y.getUTCFullYear()}-${String(y.getUTCMonth() + 1).padStart(2, "0")}-${String(y.getUTCDate()).padStart(2, "0")}`;
}

function todayUtc(): string {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function parseArgs(argv: string[]): Args {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (a === "--onlyInsert" || a === "--only-insert") {
      raw.set("onlyInsert", "true");
      continue;
    }
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const company = Number(raw.get("company"));
  const startDateRaw = raw.get("start-date");
  const endDateRaw = raw.get("end-date");

  if (!Number.isInteger(company) || company <= 0) {
    throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  }

  const startDate = startDateRaw ?? yesterdayUtc();
  const endDate = endDateRaw ?? (startDateRaw ? startDate : todayUtc());
  const onlyInsert = raw.get("onlyInsert") === "true";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Parâmetro inválido: --start-date=YYYY-MM-DD.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Parâmetro inválido: --end-date=YYYY-MM-DD.');

  return { company, startDate, endDate, ...(onlyInsert ? { onlyInsert: true } : {}) };
}

function normalizeCpfCnpj(value: string | null): string | null {
  if (!value || typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 11 ? digits : null;
}

function isConnectionError(e: unknown): boolean {
  const msg = String((e as Error).message ?? e);
  const driverMsg = String((e as { driverError?: { message?: string } })?.driverError?.message ?? "");
  return (
    /connection terminated|ECONNRESET|Connection lost|connect ECONNREFUSED|Connection refused/i.test(msg) ||
    /connection terminated|ECONNRESET/i.test(driverMsg)
  );
}

async function ensureDbConnection(orderRepo: ReturnType<typeof AppDataSource.getRepository<Order>>): Promise<void> {
  try {
    await orderRepo.query("SELECT 1");
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    console.warn("[panorama:orders] Conexão com o banco caiu; reconectando...");
    await AppDataSource.destroy().catch(() => undefined);
    await AppDataSource.initialize();
  }
}

async function withConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isConnectionError(e)) throw e;
    console.warn("[panorama:orders] Conexão caiu durante operação; reconectando e tentando novamente...");
    await AppDataSource.destroy().catch(() => undefined);
    await AppDataSource.initialize();
    return await fn();
  }
}

async function httpGetJson(url: string, authHeader: string): Promise<unknown> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ao chamar ${url}. Body: ${text.slice(0, 500)}`);
  }
  return resp.json();
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
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
  return Number.isFinite(n) ? String(n) : null;
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Panorama: "2026-03-19 07:58:27-03" (offset curto -03) -> Date ISO válido */
function parsePanoramaDataHora(value: string | null): Date | null {
  if (!value || typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})([+-])(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const [, datePart, timePart, sign, offsetH, offsetM] = m;
    const tz = offsetM ? `${sign}${offsetH}:${offsetM}` : `${sign}${offsetH}:00`;
    const iso = `${datePart}T${timePart}${tz}`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const normalized = s.replace(" ", "T");
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** dataHora Panorama -> YYYY-MM-DD (payment_date, delivery_forecast) */
function panoramaDataHoraToYmd(value: string | null): string | null {
  const d = parsePanoramaDataHora(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await AppDataSource.initialize();
  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let processedForLog = 0;
  let integrationLogId: number | null = null;

  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const platformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const customerRepo = AppDataSource.getRepository(Customer);
    const orderRepo = AppDataSource.getRepository(Order);
    const itemRepo = AppDataSource.getRepository(OrderItem);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: args.company } });
    if (!company) throw new Error(`Company ${args.company} não encontrada.`);
    const companyRef: Company = company;
    companyRefForLog = companyRef;

    const platform = await platformRepo.findOne({ where: { slug: "panorama" } });
    if (!platform) throw new Error('Plataform slug="panorama" não encontrada. Cadastre e instale antes.');
    platformRefForLog = platform;

    const companyPlatform = await cpRepo.findOne({
      where: { company: { id: companyRef.id }, platform: { id: platform.id } },
      relations: { company: true, platform: true },
    });
    if (!companyPlatform) {
      throw new Error('Plataform "panorama" não está instalada nessa company.');
    }

    const cfg = (companyPlatform.config ?? {}) as Record<string, unknown>;
    const baseUrl = typeof cfg.url === "string" ? String(cfg.url).replace(/\/+$/, "") : null;
    const user = typeof cfg.user === "string" ? String(cfg.user).trim() : null;
    const token = typeof cfg.token === "string" ? String(cfg.token).trim() : null;
    if (!baseUrl || !user || !token) {
      throw new Error('Config panorama precisa conter: url, user e token.');
    }
    const basicAuth = `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;

    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      const started = await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: args.startDate ? new Date(`${args.startDate}T00:00:00.000Z`) : null,
          company: companyRef,
          platform,
          command: "Pedidos",
          status: "PROCESSANDO",
          log: {
            company: args.company,
            platform: { id: platform.id, slug: "panorama" },
            command: "Pedidos",
            startDate: args.startDate,
            endDate: args.endDate,
            onlyInsert: Boolean(args.onlyInsert),
            status: "PROCESSANDO",
          },
          errors: null,
        }),
      );
      integrationLogId = started.id;
    } catch (e) {
      console.warn("[panorama:orders] falha ao gravar log inicial (PROCESSANDO):", e);
    }

    const productCache = new Map<string, Product>();
    const limit = 100;
    let page = 1;
    let totalProcessed = 0;
    const dataHoraInicio = `${args.startDate}T00:00:00-03:00`;
    const dataHoraFim = `${args.endDate}T23:59:59-03:00`;

    console.log(
      `[panorama:orders] Iniciando. company=${args.company} range=${args.startDate}..${args.endDate}${args.onlyInsert ? " (apenas novos)" : ""}`,
    );
    console.log("[panorama:orders] Buscando pedidos na API (100 por página)...");

    while (true) {
      const listUrl = `${baseUrl}/pedido?limite=${limit}&pagina=${page}&ordenacao=desc&dataHoraInicio=${encodeURIComponent(dataHoraInicio)}&dataHoraFim=${encodeURIComponent(dataHoraFim)}`;
      const listJson = await httpGetJson(listUrl, basicAuth);
      await ensureDbConnection(orderRepo);
      const root = asRecord(listJson);
      const dataArr = root ? ensureArray(root.data) : [];
      if (dataArr.length === 0) {
        if (page === 1) console.log("[panorama:orders] Nenhum pedido encontrado no período.");
        break;
      }

      console.log(`[panorama:orders] Página ${page}: ${dataArr.length} pedido(s) — processando...`);
      const beforePage = totalProcessed;

      for (const row of dataArr) {
        const o = asRecord(row);
        if (!o) continue;

        const orderId = pickNumber(o, "id");
        const codigo = pickString(o, "codigo")?.trim() || null;
        if (orderId == null || !codigo) {
          if (orderId == null) console.warn("[panorama:orders] pedido sem id; ignorando.");
          else console.warn("[panorama:orders] pedido id=", orderId, "sem codigo; ignorando.");
          continue;
        }

        const existingOrder = await orderRepo.findOne({
          where: { company: { id: companyRef.id }, orderCode: codigo },
        });
        if (args.onlyInsert && existingOrder) {
          totalProcessed += 1;
          continue;
        }

        const cliente = asRecord(o.cliente);
        let customer: Customer | null = null;
        if (cliente) {
          const cpfCnpjRaw = pickString(cliente, "cpfCnpj");
          const taxId = normalizeCpfCnpj(cpfCnpjRaw) ?? cpfCnpjRaw ?? `panorama_cliente_${orderId}`;
          const externalId = taxId;
          customer = await customerRepo.findOne({
            where: { company: { id: companyRef.id }, externalId },
          });
          if (!customer) {
            customer = customerRepo.create({ company: companyRef, externalId, taxId });
          }
          customer.company = companyRef;
          customer.legalName = pickString(cliente, "nome") ?? customer.legalName ?? null;
          customer.tradeName = pickString(cliente, "nomeFantasia") ?? null;
          customer.personType = toPersonType(String(pickNumber(cliente, "tipo")) === "2" ? "PJ" : "PF") ?? null;
          const contatos = ensureArray(cliente.contatos);
          for (const c of contatos) {
            const co = asRecord(c);
            if (!co) continue;
            const tipo = pickNumber(co, "tipo");
            const contato = pickString(co, "contato");
            if (tipo === 1 && contato && contato.includes("@")) customer.email = contato;
            if (tipo === 2 && contato) {
              customer.phones = customer.phones ?? {};
              (customer.phones as Record<string, string>).cellphone = contato;
            }
          }
          customer.raw = cliente as unknown;
          customer = await customerRepo.save(customer);
        }

        const situacaoCodigo = pickNumber(o, "situacaoCodigo") ?? (pickString(o, "situacaoCodigo") ? parseInt(String(o.situacaoCodigo), 10) : null);
        const situacaoNome = pickString(o, "situacaoNome");
        if (situacaoCodigo == null) {
          console.warn("[panorama:orders] pedido id=", orderId, "sem situacaoCodigo; ignorando.");
          continue;
        }
        const statusMapped = mapPanoramaStatus(situacaoCodigo, situacaoNome ?? undefined);
        const currentStatus = isOrderStatus(statusMapped) ? statusMapped : null;

        const marketplaceRoot = asRecord(o.marketplace);
        const marketplaceInner = marketplaceRoot ? asRecord(marketplaceRoot.marketplace) : null;
        const partnerOrderFromMarketplace = marketplaceRoot ? pickString(marketplaceRoot, "codigo") : null;
        const marketplaceNameResolved = marketplaceInner ? pickString(marketplaceInner, "nome") : null;

        let order = existingOrder;
        if (!order) {
          order = orderRepo.create({ orderCode: codigo });
        }

        order.company = companyRef;
        order.platform = platform;
        if (customer) order.customer = customer;
        order.externalId = String(orderId);
        order.orderCode = codigo;
        order.partnerOrderId = partnerOrderFromMarketplace;
        order.currentStatus = currentStatus;
        order.currentStatusCode = situacaoCodigo != null ? String(situacaoCodigo) : situacaoNome;
        order.shippingAmount = toNumericString(pickNumber(o, "valorFrete") ?? pickString(o, "valorFrete"));
        order.totalAmount = toNumericString(pickNumber(o, "valorTotal") ?? pickString(o, "valorTotal"));
        order.totalDiscount = toNumericString(pickNumber(o, "valorDesconto") ?? pickString(o, "valorDesconto"));
        const dataHoraStr = pickString(o, "dataHora");
        order.orderDate = parsePanoramaDataHora(dataHoraStr);
        order.paymentDate = panoramaDataHoraToYmd(dataHoraStr);
        order.channel = "marketplace";
        order.marketplaceName = marketplaceNameResolved;
        order.paymentType = pickString(o, "formaPagamento");
        const pedidoPagamento = asRecord(o.pedidoPagamento);
        const parcelasRaw = pedidoPagamento ? pickNumber(pedidoPagamento, "numeroParcelas") : null;
        order.paymentInstallments = parcelasRaw == null ? 1 : Math.max(1, Math.floor(parcelasRaw));
        order.payments = pedidoPagamento ? (JSON.parse(JSON.stringify(pedidoPagamento)) as unknown) : null;

        const endereco = asRecord(o.endereco);
        if (endereco) {
          const cidade = asRecord(endereco.cidade);
          order.deliveryAddress = pickString(endereco, "endereco");
          order.deliveryNumber = pickString(endereco, "numero");
          order.deliveryNeighborhood = pickString(endereco, "bairro");
          order.deliveryZip = pickString(endereco, "cep") ?? (pickNumber(endereco, "cep") != null ? String(pickNumber(endereco, "cep")) : null);
          order.deliveryComplement = pickString(endereco, "complemento");
          order.deliveryCity = cidade ? pickString(cidade, "nome") : null;
          order.deliveryState = cidade ? toBrazilianState(pickString(cidade, "estado")) ?? pickString(cidade, "estado") : null;
        }

        const transporte = asRecord(o.transporte);
        if (transporte) {
          const trans = asRecord(transporte.transportadora);
          const pessoa = trans ? asRecord(trans.pessoa) : null;
          order.carrier = pessoa ? pickString(pessoa, "nome") : null;
          order.deliveryForecast = panoramaDataHoraToYmd(pickString(transporte, "dataHoraLimite"));
        } else {
          order.deliveryForecast = null;
        }

        order.raw = JSON.parse(JSON.stringify(o)) as unknown;

        await withConnectionRetry(async () => {
          const saved = await orderRepo.save(order);
          await itemRepo.delete({ order: { id: saved.id } as Order });

          const itensArr = ensureArray(o.itens);
          for (const it of itensArr) {
            const itObj = asRecord(it);
            if (!itObj) continue;
            const skuRaw = pickNumber(itObj, "sku") ?? pickString(itObj, "sku");
            if (skuRaw == null) continue;
            const skuStr = String(skuRaw);
            const unitPrice = toNumericString(pickNumber(itObj, "valorUnitario") ?? pickString(itObj, "valorUnitario"));

            let product: Product | null | undefined = productCache.get(skuStr);
            if (!product) {
              const found = await productRepo.findOne({
                where: { company: { id: companyRef.id }, sku: skuStr },
              });
              if (!found) {
                const midias = asRecord(itObj.midias);
                const photo = midias ? pickString(midias, "raw") ?? pickString(midias, "large") : null;
                product = productRepo.create({
                  company: companyRef,
                  sku: skuStr,
                  name: pickString(itObj, "descricao"),
                  storeReference: pickString(itObj, "referencia"),
                  ean: pickString(itObj, "ean"),
                  photo,
                  value: unitPrice,
                  raw: itObj as unknown,
                });
                product = await productRepo.save(product);
              } else {
                product = found;
                if (unitPrice && !(found.value != null && String(found.value).trim())) {
                  found.value = unitPrice;
                  product = await productRepo.save(found);
                }
              }
              if (product) productCache.set(skuStr, product);
            }

            if (!product) continue;
            const qty = pickNumber(itObj, "quantidade");
            const item = itemRepo.create({
              company: companyRef,
              order: saved,
              product: product as Product,
              sku: null,
              unitPrice,
              netUnitPrice: null,
              quantity: qty,
              itemType: "produto",
              serviceRefSku: null,
            });
            await itemRepo.save(item);
          }
        });

        totalProcessed += 1;
      }

      const processedThisPage = totalProcessed - beforePage;
      console.log(`[panorama:orders] Página ${page}: ${processedThisPage} processado(s) (total: ${totalProcessed})`);

      if (dataArr.length < limit) break;
      page += 1;
    }

    processedForLog = totalProcessed;
    console.log(
      `[panorama:orders] company=${args.company} range=${args.startDate}..${args.endDate} orders_processed=${totalProcessed}${args.onlyInsert ? " onlyInsert=true" : ""}`,
    );

    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      if (integrationLogId) {
        await integrationLogRepo.update(
          { id: integrationLogId },
          {
            processedAt: new Date(),
            status: "FINALIZADO",
            log: {
              company: args.company,
              platform: { id: platform.id, slug: "panorama" },
              command: "Pedidos",
              startDate: args.startDate,
              endDate: args.endDate,
              onlyInsert: Boolean(args.onlyInsert),
              status: "FINALIZADO",
              orders_processed: processedForLog,
            },
            errors: null as any,
          },
        );
      } else {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: args.startDate ? new Date(`${args.startDate}T00:00:00.000Z`) : null,
            company: companyRef,
            platform,
            command: "Pedidos",
            status: "FINALIZADO",
            log: {
              company: args.company,
              platform: { id: platform.id, slug: "panorama" },
              command: "Pedidos",
              startDate: args.startDate,
              endDate: args.endDate,
              onlyInsert: Boolean(args.onlyInsert),
              status: "FINALIZADO",
              orders_processed: processedForLog,
            },
            errors: null,
          }),
        );
      }
    } catch (e) {
      console.warn("[panorama:orders] falha ao finalizar log de integração:", e);
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
              company: args.company,
              platform: platformRefForLog ? { id: platformRefForLog.id, slug: "panorama" } : null,
              command: "Pedidos",
              startDate: args.startDate,
              endDate: args.endDate,
              onlyInsert: Boolean((args as any).onlyInsert),
              status: "ERRO",
              orders_processed: processedForLog,
            },
            errors: errorPayload as any,
          },
        );
      } else if (companyRefForLog && platformRefForLog) {
        await integrationLogRepo.save(
          integrationLogRepo.create({
            processedAt: new Date(),
            date: args.startDate ? new Date(`${args.startDate}T00:00:00.000Z`) : null,
            company: companyRefForLog,
            platform: platformRefForLog,
            command: "Pedidos",
            status: "ERRO",
            log: {
              company: args.company,
              platform: { id: platformRefForLog.id, slug: "panorama" },
              command: "Pedidos",
              startDate: args.startDate,
              endDate: args.endDate,
              status: "ERRO",
              orders_processed: processedForLog,
            },
            errors: errorPayload,
          }),
        );
      }
    } catch (e) {
      console.warn("[panorama:orders] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[panorama:orders] erro:", err);
  process.exit(1);
});
