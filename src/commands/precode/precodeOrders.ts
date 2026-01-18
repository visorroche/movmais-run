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
import { mapPrecodeStatus } from "../../utils/status/index.js";

type Args = {
  company: number;
  startDate: string;
  endDate: string;
};

function yesterdayUtc(): string {
  const now = new Date();
  const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  y.setUTCDate(y.getUTCDate() - 1);
  const yyyy = y.getUTCFullYear();
  const mm = String(y.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(y.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const startDateRaw = raw.get("start-date");
  const endDateRaw = raw.get("end-date");

  if (!Number.isInteger(company) || company <= 0) {
    throw new Error('Parâmetro obrigatório inválido: --company=ID (inteiro positivo).');
  }

  const y = yesterdayUtc();
  const startDate = startDateRaw ?? y;
  const endDate = endDateRaw ?? startDate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('Parâmetro inválido: --start-date=YYYY-MM-DD.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Parâmetro inválido: --end-date=YYYY-MM-DD.');
  }

  return { company, startDate, endDate };
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

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  return String(v);
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function normalizeDateString(value: string | null): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const datePart = s.length >= 10 ? s.slice(0, 10) : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}

function parseDateFromYmd(value: string | null): Date | null {
  if (!value) return null;
  // value esperado: YYYY-MM-DD
  const [y, m, d] = value.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0); // local time (timestamp sem TZ)
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateTimeFromYmdHms(dateYmd: string | null, timeHms: string | null): Date | null {
  if (!dateYmd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const [y, m, d] = dateYmd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;

  const t = (timeHms ?? "").trim();
  if (!/^\d{2}:\d{2}:\d{2}$/.test(t)) return parseDateFromYmd(dateYmd);
  const parts = t.split(":");
  if (parts.length !== 3) return parseDateFromYmd(dateYmd);
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  const ss = Number(parts[2]);
  if (
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59 ||
    ss < 0 ||
    ss > 59
  ) {
    return parseDateFromYmd(dateYmd);
  }

  const dt = new Date(y, m - 1, d, hh, mm, ss, 0); // local time
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toNumericString(v: number | string | null): string | null {
  if (v === null) return null;
  const s = typeof v === "number" ? String(v) : String(v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return String(n);
}

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await AppDataSource.initialize();
  let companyRefForLog: Company | null = null;
  let platformRefForLog: Plataform | null = null;
  let processedForLog = 0;
  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const plataformRepo = AppDataSource.getRepository(Plataform);
    const cpRepo = AppDataSource.getRepository(CompanyPlataform);
    const customerRepo = AppDataSource.getRepository(Customer);
    const orderRepo = AppDataSource.getRepository(Order);
    const itemRepo = AppDataSource.getRepository(OrderItem);
    const productRepo = AppDataSource.getRepository(Product);

    const company = await companyRepo.findOne({ where: { id: args.company } });
    if (!company) throw new Error(`Company ${args.company} não encontrada.`);
    const companyRef: Company = company;
    companyRefForLog = companyRef;

    const plataform = await plataformRepo.findOne({ where: { slug: "precode" } });
    if (!plataform) throw new Error('Plataform slug="precode" não encontrada. Cadastre e instale antes.');
    platformRefForLog = plataform;

    const companyPlataform = await cpRepo.findOne({
      where: {
        company: { id: companyRef.id },
        platform: { id: plataform.id },
      },
      relations: { company: true, platform: true },
    });
    if (!companyPlataform) {
      throw new Error('Plataform "precode" não está instalada nessa company (crie em company_plataforms).');
    }

    const cfg = (companyPlataform.config ?? {}) as Record<string, unknown>;
    const token = typeof cfg.token === "string" ? cfg.token : null;
    if (!token) throw new Error('Config da plataforma precode precisa conter "token" (Authorization Basic).');
    const tokenStr: string = token;

    const productApiCache = new Map<number, { raw: unknown; produto: Record<string, unknown> | null } | null>();
    const productCache = new Map<string, Product>();

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

    async function ensureProductBySku(sku: number, itObj: Record<string, unknown>): Promise<Product> {
      const skuStr = String(sku);
      const cached = productCache.get(skuStr);
      if (cached) return cached;

      const existing = await productRepo.findOne({ where: { company: { id: companyRef.id }, sku: skuStr } });
      if (existing) {
        productCache.set(skuStr, existing);
        return existing;
      }

      const api = await fetchProductBySku(sku);
      const produto = api?.produto ?? null;

      const p = productRepo.create({
        company: companyRef,
        sku: skuStr,
        name: (produto ? pickString(produto, "tituloCurto") ?? pickString(produto, "titulo") : null) ?? pickString(itObj, "descricaoProduto"),
        storeReference: (produto ? pickString(produto, "codigoReferenciaFabrica") : null) ?? pickString(itObj, "referenciaLoja"),
        brand: produto ? pickString(produto, "marca") : null,
        model: produto ? pickString(produto, "modelo") : null,
        weight: toNumericString(produto ? (pickNumber(produto, "peso") ?? pickString(produto, "peso")) : null),
        width: toNumericString(produto ? (pickNumber(produto, "largura_cm") ?? pickString(produto, "largura_cm")) : null),
        height: toNumericString(produto ? (pickNumber(produto, "altura_cm") ?? pickString(produto, "altura_cm")) : null),
        lengthCm: toNumericString(produto ? (pickNumber(produto, "profundidade_cm") ?? pickString(produto, "profundidade_cm")) : null),
        ncm: produto ? (pickString(produto, "NCM") ?? pickString(produto, "ncm")) : pickString(itObj, "ncm"),
        category: produto ? pickString(produto, "categoria") : null,
        subcategory: produto ? pickString(produto, "subcategoria") : null,
        finalCategory: produto ? pickString(produto, "categoriaFinal") : null,
        raw: api?.raw ?? null,
      });

      const saved = await productRepo.save(p);
      productCache.set(skuStr, saved);
      return saved;
    }

    const listUrl = `https://www.replicade.com.br/api/v1/pedido/pedidoStatus/${args.startDate}/${args.endDate}`;
    const listJson = await httpGetJson(listUrl, tokenStr);

    const listObj = (listJson ?? {}) as Record<string, unknown>;
    const pedidosList = ensureArray(listObj.pedido);

    let processed = 0;
    for (const row of pedidosList) {
      if (!row || typeof row !== "object") continue;
      const rowObj = row as Record<string, unknown>;
      const numeroPedido = pickNumber(rowObj, "numeroPedido");
      if (!numeroPedido) continue;

      const detailUrl = `https://www.replicade.com.br/api/v1/erp/status/${numeroPedido}`;
      const detailJson = await httpGetJson(detailUrl, tokenStr);
      const detailObj = (detailJson ?? {}) as Record<string, unknown>;
      const detailPedidos = ensureArray(detailObj.pedido);
      const detail = detailPedidos[0] as Record<string, unknown> | undefined;
      if (!detail || typeof detail !== "object") continue;

      // CUSTOMER
      const dadosCliente = (detail.dadosCliente ?? {}) as Record<string, unknown>;
      const cpfCnpj = pickString(dadosCliente, "cpfCnpj");
      let customer: Customer | null = null;
      if (cpfCnpj) {
        customer = await customerRepo.findOne({ where: { company: { id: companyRef.id }, externalId: cpfCnpj } });
        if (!customer) {
          customer = customerRepo.create({ company: companyRef, externalId: cpfCnpj, taxId: cpfCnpj });
        }
        customer.company = companyRef;
        customer.externalId = cpfCnpj;
        customer.taxId = cpfCnpj;
        customer.stateRegistration = pickString(dadosCliente, "inscEstadualRg");
        customer.personType = pickString(dadosCliente, "tipo");
        customer.legalName = pickString(dadosCliente, "nomeRazao");
        customer.tradeName = pickString(dadosCliente, "fantasia");
        customer.gender = pickString(dadosCliente, "sexo");
        customer.birthDate = pickString(dadosCliente, "dataNascimento");
        customer.email = pickString(dadosCliente, "email");
        customer.status = pickString(dadosCliente, "statusCliente");
        customer.phones = (dadosCliente.telefones ?? null) as unknown;
        // raw: manter o payload do parceiro "como veio" para o customer (logs/auditoria)
        customer.raw = dadosCliente as unknown;
        customer = await customerRepo.save(customer);
      }

      // ORDER
      const codigoPedido = pickNumber(detail, "codigoPedido");
      if (!codigoPedido) continue;

      let order = await orderRepo.findOne({
        where: { company: { id: companyRef.id }, orderCode: codigoPedido },
        relations: { items: true },
      });
      if (!order) {
        order = orderRepo.create({ orderCode: codigoPedido });
      }

      const precodeStatusRaw = pickString(detail, "statusAtual");
      if (!precodeStatusRaw) {
        console.error("[precode:orders] statusAtual vazio. codigoPedido=", codigoPedido);
        throw new Error("Status Precode vazio.");
      }

      order.partnerOrderId = pickString(detail, "pedidoParceiro");
      order.currentStatus = mapPrecodeStatus(precodeStatusRaw);
      order.currentStatusCode = pickString(detail, "codigoStatusAtual");
      order.shippingAmount = pickString(detail, "valorFrete");
      order.deliveryDays = pickNumber(detail, "prazoEntrega");
      order.deliveryDate = pickString(detail, "previsaoEntrega");
      order.totalAmount = pickString(detail, "valorTotalCompra");
      order.totalDiscount = pickString(detail, "valorTotalDesconto");
      order.marketplaceName = pickString(detail, "nomeAfiliado");
      order.channel = pickString(detail, "canal");

      // delivery (por pedido)
      const dadosEntrega = (dadosCliente.dadosEntrega ?? {}) as Record<string, unknown>;
      order.deliveryState = pickString(dadosEntrega, "uf");
      order.deliveryZip = pickString(dadosEntrega, "cep");
      order.deliveryNeighborhood = pickString(dadosEntrega, "bairro");
      order.deliveryCity = pickString(dadosEntrega, "cidade");
      order.deliveryNumber = pickString(dadosEntrega, "numero");
      order.deliveryAddress = pickString(dadosEntrega, "endereco");
      order.deliveryComplement = pickString(dadosEntrega, "complemento");
      order.storePickup = (detail.retiraLoja ?? null) as unknown;
      order.payments = (detail.pagamento ?? null) as unknown;
      order.tracking = (detail.dadosRastreio ?? null) as unknown;
      order.timeline = (detail.dadosAcompanhamento ?? null) as unknown;
      // raw: payload do pedido "como veio" (somente dados do pedido).
      // Customer.raw guarda o payload do customer integralmente.
      const detailRaw = detail as Record<string, unknown>;
      const orderRaw: Record<string, unknown> = { ...detailRaw };
      delete orderRaw.dadosCliente;
      delete orderRaw.itens;
      order.raw = orderRaw as unknown;

      // order_date: menor data encontrada no acompanhamento (criação do pedido)
      const acompanhamentoArr = ensureArray(detail.dadosAcompanhamento);
      let minDate: string | null = null;
      let firstDate: string | null = null;
      let firstTime: string | null = null;
      for (const entry of acompanhamentoArr) {
        if (!entry || typeof entry !== "object") continue;
        const obj = entry as Record<string, unknown>;
        const d = normalizeDateString(pickString(obj, "data"));
        if (!firstDate && d) {
          firstDate = d;
          firstTime = pickString(obj, "hora");
        }
        if (!d) continue;
        if (!minDate || d < minDate) minDate = d; // YYYY-MM-DD permite comparação lexicográfica
      }
      // Precode manda data + hora no acompanhamento; usamos a hora do 1º item (criação do pedido).
      // Fallback: se não vier hora, salva como 00:00:00 do dia.
      order.orderDate = parseDateTimeFromYmdHms(firstDate ?? minDate, firstTime);
      // payment_date: no Precode usamos a própria order_date
      order.paymentDate = (firstDate ?? minDate) ?? null;
      // Precode não possui cupom (fica null)
      order.discountCoupon = null;

      // metadata (campos que não queremos como colunas)
      order.metadata = {
        source: "precode",
        source_status: precodeStatusRaw,
        affiliate_id: pickNumber(detail, "idAfiliado"),
        device: pickString(detail, "dispositivo"),
        erp_seller: pickString(detail, "vendedorERP"),
        delivery_scheduling: pickString(detail, "agendamentoEntrega"),
        parent_order_code: pickString(detail, "codigoPedidoPrincipal"),
        indemnified: pickBoolean(detail, "pedidoIndenizado"), // antes: Order.indemnified
        cart_code: pickNumber(detail, "codigoCarrinhoCompras"),
        order_type: pickString(detail, "tipoPedido"),
        dropshipping_type: pickString(detail, "pedidoDropshipping"),
        map_code: pickNumber(detail, "codigoMapa"),
      };

      order.company = companyRef;
      order.platform = plataform;
      if (customer) order.customer = customer;

      order = await orderRepo.save(order);

      // ORDER ITEMS (substitui para manter sync)
      await itemRepo.delete({ order: { id: order.id } as Order });

      const itens = ensureArray(detail.itens);
      for (const it of itens) {
        if (!it || typeof it !== "object") continue;
        const itObj = it as Record<string, unknown>;

        const sku = pickNumber(itObj, "sku");
        if (!sku) continue;
        const product = await ensureProductBySku(sku, itObj);

        const item = itemRepo.create({
          company: companyRef,
          order,
          sku,
          product,
          unitPrice: pickString(itObj, "valorUnitario"),
          netUnitPrice: pickString(itObj, "valorUnitarioLiquido"),
          quantity: pickNumber(itObj, "quantidade"),
          itemType: pickString(itObj, "tipo"),
          serviceRefSku: pickString(itObj, "servicoRefSku"),
        });
        // eslint-disable-next-line no-await-in-loop
        await itemRepo.save(item);
      }

      processed += 1;
    }

    console.log(`[precode:orders] company=${args.company} range=${args.startDate}..${args.endDate} orders_processed=${processed}`);
    processedForLog = processed;

    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: args.startDate,
          company: companyRef,
          platform: plataform,
          command: "Pedidos",
          log: {
            company: args.company,
            platform: { id: plataform.id, slug: "precode" },
            command: "Pedidos",
            startDate: args.startDate,
            endDate: args.endDate,
            orders_processed: processedForLog,
          },
          errors: null,
        }),
      );
    } catch (e) {
      console.warn("[precode:orders] falha ao gravar log de integração:", e);
    }
  } catch (err) {
    try {
      const integrationLogRepo = AppDataSource.getRepository(IntegrationLog);
      await integrationLogRepo.save(
        integrationLogRepo.create({
          processedAt: new Date(),
          date: args.startDate,
          company: companyRefForLog ?? ({ id: args.company } as any),
          platform: platformRefForLog ?? null,
          command: "Pedidos",
          log: {
            company: args.company,
            platform: platformRefForLog ? { id: platformRefForLog.id, slug: "precode" } : null,
            command: "Pedidos",
            startDate: args.startDate,
            endDate: args.endDate,
            orders_processed: processedForLog,
          },
          errors:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack ?? null }
              : { message: String(err) },
        }),
      );
    } catch (e) {
      console.warn("[precode:orders] falha ao gravar log de erro:", e);
    }
    throw err;
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[precode:orders] erro:", err);
  process.exit(1);
});


