import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { In, Like } from "typeorm";
import { Company } from "../../entities/Company.js";
import { Customer } from "../../entities/Customer.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Product } from "../../entities/Product.js";
import { Representative } from "../../entities/Representative.js";

function parseIsoDateYmd(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Data inválida: ${date}. Use YYYY-MM-DD.`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

function formatYmdUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function toMoney2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDeadlock(err: any): boolean {
  const code = err?.driverError?.code ?? err?.code;
  return code === "40P01";
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr;
}

function randomCpf11(): string {
  // apenas para teste; não valida dígitos
  let s = "";
  for (let i = 0; i < 11; i += 1) s += String(randInt(0, 9));
  return s;
}

function randomTimeInDayUtc(dayUtc: Date): Date {
  const h = randInt(0, 23);
  const m = randInt(0, 59);
  const s = randInt(0, 59);
  return new Date(Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), h, m, s));
}

function parseArgs(argv: string[]): {
  company: number;
  startDate: string;
  endDate: string;
  mode: "marketplace" | "representante";
} {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    if (a === "--marketplace") raw.set("mode", "marketplace");
    else if (a === "--representante") raw.set("mode", "representante");
    else {
      const parts = a.slice(2).split("=");
      const k = parts[0];
      if (!k) continue;
      raw.set(k, parts.slice(1).join("="));
    }
  }

  const company = Number(raw.get("company"));
  const startDate = raw.get("start-date");
  const endDate = raw.get("end-date");
  const mode = raw.get("mode") as any;

  if (!Number.isInteger(company) || company <= 0) throw new Error("Parâmetro obrigatório inválido: --company=ID");
  if (!startDate) throw new Error("Parâmetro obrigatório: --start-date=YYYY-MM-DD");
  if (!endDate) throw new Error("Parâmetro obrigatório: --end-date=YYYY-MM-DD");
  if (mode !== "marketplace" && mode !== "representante") {
    throw new Error("Escolha exatamente um modo: --marketplace ou --representante");
  }

  return { company, startDate, endDate, mode };
}

const CATEGORIES = ["Escritório", "Cozinha", "Dormitório", "Sala"] as const;
const MARKETPLACE_CHANNELS = ["Mercado Livre", "Shopee", "Magalu", "Mobly"] as const;
const COMMISSION_PCTS = [10, 15, 20] as const;

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Daniel",
  "Eduarda",
  "Felipe",
  "Gabriela",
  "Henrique",
  "Isabela",
  "João",
  "Larissa",
  "Marcos",
  "Natália",
  "Otávio",
  "Paula",
  "Rafael",
  "Sofia",
  "Tiago",
  "Vanessa",
  "Yasmin",
] as const;

const LAST_NAMES = [
  "Silva",
  "Santos",
  "Oliveira",
  "Souza",
  "Pereira",
  "Costa",
  "Rodrigues",
  "Almeida",
  "Nascimento",
  "Lima",
  "Araújo",
  "Fernandes",
  "Carvalho",
  "Gomes",
  "Martins",
] as const;

function makeFullName(): string {
  const a = pickOne(FIRST_NAMES);
  const b = pickOne(FIRST_NAMES);
  const s1 = pickOne(LAST_NAMES);
  const s2 = pickOne(LAST_NAMES);
  // 50% 2 nomes / 50% 1 nome
  const first = Math.random() < 0.5 ? `${a} ${b}` : a;
  const last = Math.random() < 0.5 ? `${s1} ${s2}` : s1;
  return `${first} ${last}`.replace(/\s+/g, " ").trim();
}

async function ensureRepresentatives(company: Company): Promise<{ supervisors: Representative[]; reps: Representative[] }> {
  const repRepo = AppDataSource.getRepository(Representative);

  function hash32(input: string): number {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function deterministicNameFor(code: string): string {
    const h = hash32(`rep:${company.id}:${code}`);
    const first = FIRST_NAMES[h % FIRST_NAMES.length]!;
    // usar >>> para evitar shift com sinal (índices negativos => undefined)
    const second = FIRST_NAMES[(h >>> 8) % FIRST_NAMES.length]!;
    const last1 = LAST_NAMES[(h >>> 16) % LAST_NAMES.length]!;
    const last2 = LAST_NAMES[(h >>> 24) % LAST_NAMES.length]!;
    const firstPart = (h & 1) === 0 ? `${first} ${second}` : first;
    const lastPart = (h & 2) === 0 ? `${last1} ${last2}` : last1;
    return `${firstPart} ${lastPart}`.replace(/\s+/g, " ").trim();
  }

  type DesiredRep = {
    code: "SUP1" | "SUP2" | "REP1" | "REP2" | "REP3" | "REP4" | "REP5" | "REP6";
    supervisor: boolean;
    supervisorCode: "SUP1" | "SUP2" | null;
    legacyExternalId: string;
  };

  const desired: DesiredRep[] = [
    { code: "SUP1", supervisor: true, supervisorCode: null, legacyExternalId: "fake:sup:1" },
    { code: "SUP2", supervisor: true, supervisorCode: null, legacyExternalId: "fake:sup:2" },
    { code: "REP1", supervisor: false, supervisorCode: "SUP1", legacyExternalId: "fake:rep:1" },
    { code: "REP2", supervisor: false, supervisorCode: "SUP1", legacyExternalId: "fake:rep:2" },
    { code: "REP3", supervisor: false, supervisorCode: "SUP1", legacyExternalId: "fake:rep:3" },
    { code: "REP4", supervisor: false, supervisorCode: "SUP2", legacyExternalId: "fake:rep:4" },
    { code: "REP5", supervisor: false, supervisorCode: "SUP2", legacyExternalId: "fake:rep:5" },
    { code: "REP6", supervisor: false, supervisorCode: "SUP2", legacyExternalId: "fake:rep:6" },
  ];

  const externalIdsToFind = Array.from(new Set(desired.flatMap((d) => [d.code, d.legacyExternalId])));
  const existing = await repRepo.find({
    where: { company: { id: company.id }, externalId: In(externalIdsToFind) } as any,
  });
  const byExternalId = new Map<string, Representative>();
  for (const r of existing) if (r.externalId) byExternalId.set(r.externalId, r);
  const byCode = new Map<string, Representative>();
  for (const d of desired) {
    const found = byExternalId.get(d.code) ?? byExternalId.get(d.legacyExternalId) ?? null;
    if (found) byCode.set(d.code, found);
  }

  // cria/atualiza supervisors primeiro
  for (const d of desired.filter((x) => x.supervisor)) {
    let r = byCode.get(d.code) ?? repRepo.create();
    r.company = company;
    // normalize externalId para o código interno estável
    r.externalId = d.code;
    r.supervisor = true;
    // só preenche se estiver vazio (não sobrescreve a cada execução)
    if (!r.name || /undefined/i.test(r.name) || /^Supervisor (Norte|Sul)$/i.test(r.name) || /^Rep \d+$/i.test(r.name)) {
      r.name = deterministicNameFor(d.code);
    }
    if (!r.state) r.state = "SP";
    if (!r.city) r.city = "São Paulo";
    if (!r.document) r.document = randomCpf11();
    if (!r.email) r.email = `${d.code.toLowerCase()}@fake.local`;
    if (!r.phone) r.phone = `+5511${randInt(900000000, 999999999)}`;
    if (!r.obs) r.obs = "Representante fake para testes";
    await repRepo.save(r);
    byCode.set(d.code, r);
    byExternalId.set(d.code, r);
  }

  // reps
  for (const d of desired.filter((x) => !x.supervisor)) {
    const supervisorRef = d.supervisorCode ? byCode.get(d.supervisorCode) ?? null : null;
    let r = byCode.get(d.code) ?? repRepo.create();
    r.company = company;
    r.externalId = d.code;
    r.supervisor = false;
    r.supervisorRef = supervisorRef;
    if (!r.name || /undefined/i.test(r.name) || /^Rep \d+$/i.test(r.name)) {
      r.name = deterministicNameFor(d.code);
    }
    if (!r.state) r.state = "SP";
    if (!r.city) r.city = pickOne(["São Paulo", "Santo André", "São Bernardo do Campo", "Campinas", "Sorocaba"] as const);
    if (!r.document) r.document = randomCpf11();
    if (!r.email) r.email = `${d.code.toLowerCase()}@fake.local`;
    if (!r.phone) r.phone = `+5511${randInt(900000000, 999999999)}`;
    if (!r.obs) r.obs = "Representante fake para testes";
    await repRepo.save(r);
    byCode.set(d.code, r);
    byExternalId.set(d.code, r);
  }

  const supervisors = desired
    .filter((x) => x.supervisor)
    .map((x) => byCode.get(x.code)!)
    .filter(Boolean);
  const reps = desired
    .filter((x) => !x.supervisor)
    .map((x) => byCode.get(x.code)!)
    .filter(Boolean);

  return { supervisors, reps };
}

async function ensureProducts(company: Company): Promise<Product[]> {
  const productRepo = AppDataSource.getRepository(Product);

  const namesByCategory: Record<(typeof CATEGORIES)[number], string[]> = {
    Escritório: [
      "Mesa para Escritório 120cm Carvalho",
      "Cadeira Gamer Couro Preta",
      "Estante 5 Prateleiras Branca",
      "Gaveteiro 3 Gavetas Cinza",
      "Armário Arquivo 2 Portas Preto",
    ],
    Cozinha: [
      "Armário de Cozinha 6 Portas Azul",
      "Balcão 2 Portas Branco",
      "Paneleiro Alto 4 Portas Carvalho",
      "Mesa Dobrável 4 Lugares Preto",
      "Cristaleira Vidro 2 Portas Off-white",
    ],
    Dormitório: [
      "Cama Casal Box Suede Cinza",
      "Cama Beliche Madeira Clara",
      "Guarda-Roupa 6 Portas Espelhado",
      "Cômoda 6 Gavetas Branca",
      "Cabeceira Casal Estofada Bege",
    ],
    Sala: [
      "Sofá 3 Lugares Couro Marrom",
      "Rack para TV 65\" Preto",
      "Painel para TV Ripado Nogueira",
      "Mesa de Centro Vidro Preta",
      "Poltrona Reclinável Suede Grafite",
    ],
  };

  const desired: Array<{ sku: string; name: string; category: string }> = [];
  for (const cat of CATEGORIES) {
    const list = namesByCategory[cat];
    for (let i = 0; i < list.length; i += 1) {
      const sku = `FAKE-${cat.toUpperCase()}-${String(i + 1).padStart(2, "0")}`;
      desired.push({ sku, name: list[i]!, category: cat });
    }
  }

  // prefetch existentes
  const existing = await productRepo.find({ where: { company: { id: company.id } } as any });
  const bySku = new Map<string, Product>();
  for (const p of existing) bySku.set(p.sku, p);

  const out: Product[] = [];
  for (const d of desired) {
    const e = bySku.get(d.sku) ?? productRepo.create();
    e.company = company;
    e.sku = d.sku;
    e.name = d.name;
    e.category = d.category;
    e.categoryId = null;
    e.brand = "Fake Móveis";
    e.brandId = null;
    e.model = null;
    e.ecommerceId = null;
    e.ean = null;
    e.slug = null;
    e.storeReference = d.sku;
    e.externalReference = null;
    e.ncm = null;
    e.weight = null;
    e.width = null;
    e.height = null;
    e.lengthCm = null;
    e.photo = null;
    e.url = null;
    e.raw = { fake: true, category: d.category };
    await productRepo.save(e);
    bySku.set(d.sku, e);
    out.push(e);
  }

  return out;
}

async function getNextOrderCode(companyId: number): Promise<number> {
  const orderRepo = AppDataSource.getRepository(Order);
  const row = await orderRepo
    .createQueryBuilder("o")
    .select("MAX(o.orderCode)", "max")
    .where("o.company_id = :companyId", { companyId })
    .getRawOne<{ max: string | number | null }>();

  const maxRaw = row?.max ?? null;
  const maxNum = maxRaw === null ? 0 : typeof maxRaw === "number" ? maxRaw : Number(maxRaw);
  const base = Number.isFinite(maxNum) && maxNum > 0 ? Math.floor(maxNum) : 0;
  // garante espaço dentro de int32
  const next = Math.min(base + 1, 2_000_000_000);
  if (next <= 0) throw new Error("Falha ao calcular próximo order_code.");
  return next;
}

async function getNextFakeCustomerSeq(companyId: number): Promise<number> {
  // external_id é unique por (company_id, external_id)
  // usamos apenas o padrão fake:customer:<N>
  const rows = await AppDataSource.query(
    `
    SELECT COALESCE(
      MAX( (regexp_match(external_id, '^fake:customer:(\\\\d+)$'))[1]::int ),
      0
    ) AS max
    FROM customers
    WHERE company_id = $1
      AND external_id ~ '^fake:customer:\\\\d+$'
    `,
    [companyId],
  );
  const maxRaw = rows?.[0]?.max ?? 0;
  const maxNum = typeof maxRaw === "number" ? maxRaw : Number(maxRaw);
  const base = Number.isFinite(maxNum) && maxNum > 0 ? Math.floor(maxNum) : 0;
  return base + 1;
}

async function main() {
  const { company: companyId, startDate, endDate, mode } = parseArgs(process.argv.slice(2));
  let start = parseIsoDateYmd(startDate);
  let end = parseIsoDateYmd(endDate);
  if (end.getTime() < start.getTime()) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  await AppDataSource.initialize();
  try {
    const companyRepo = AppDataSource.getRepository(Company);
    const customerRepo = AppDataSource.getRepository(Customer);
    const orderRepo = AppDataSource.getRepository(Order);
    const itemRepo = AppDataSource.getRepository(OrderItem);

    const company = await companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new Error(`Company ${companyId} não encontrada.`);

    const products = await ensureProducts(company);
    const productsShuffled = shuffle(products.slice());

    let reps: Representative[] = [];
    if (mode === "representante") {
      const repData = await ensureRepresentatives(company);
      reps = repData.reps;
      if (reps.length === 0) throw new Error("Falha ao criar representantes.");
    }

    // Pool de customers fake existentes, para reaproveitar e criar histórico.
    // Customers não têm unique por taxId/email, então reaproveitamos por seleção aleatória.
    const existingFakeCustomers = await customerRepo.find({
      where: { company: { id: companyId }, externalId: Like("fake:customer:%") } as any,
      relations: { representative: true },
      take: 500,
      order: { id: "DESC" as any },
    });
    const customerPool: Customer[] = existingFakeCustomers.slice();
    let customerSeq = await getNextFakeCustomerSeq(companyId);

    let orderCode = await getNextOrderCode(companyId);

    let createdCustomers = 0;
    let createdOrders = 0;
    let createdItems = 0;

    for (let day = new Date(start.getTime()); day.getTime() <= end.getTime(); day = addDaysUtc(day, 1)) {
      const ymd = formatYmdUtc(day);
      const ordersToday = randInt(5, 10);

      for (let i = 0; i < ordersToday; i += 1) {
        // 35%: reutiliza um cliente fake já existente (se houver)
        let customer: Customer;
        let representative: Representative | null = null;
        if (customerPool.length > 0 && Math.random() < 0.35) {
          customer = pickOne(customerPool);
          // Pedido usa o representante da carteira do cliente, se tiver; senão sorteia.
          if (mode === "representante") representative = (customer as any).representative ?? pickOne(reps);
        } else {
          if (mode === "representante") representative = pickOne(reps);
          const fullName = makeFullName();
          const cpf = randomCpf11();
          customer = customerRepo.create({
            company,
            externalId: `fake:customer:${customerSeq}`,
            taxId: cpf,
            legalName: fullName,
            tradeName: null,
            personType: "PF",
            birthDate: null,
            email: `${fullName.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "")}.${customerSeq}@fake.local`,
            status: true,
            phones: { cellphone: `+5511${randInt(900000000, 999999999)}` },
            deliveryAddress: null,
            raw: { fake: true },
          });
          if (representative) (customer as any).representative = representative;
          try {
            await customerRepo.save(customer);
            createdCustomers += 1;
            customerPool.push(customer);
            customerSeq += 1;
          } catch (e: any) {
            // Se por algum motivo colidir (ex.: execuções concorrentes), tenta carregar e reutilizar.
            const code = e?.driverError?.code ?? e?.code;
            const constraint = e?.driverError?.constraint ?? e?.constraint;
            if (code === "23505" && constraint === "UQ_customers_company_id_external_id") {
              const existing = await customerRepo.findOne({
                where: { company: { id: companyId }, externalId: `fake:customer:${customerSeq}` } as any,
              });
              if (existing) {
                customer = existing;
                customerPool.push(existing);
                customerSeq += 1;
              } else {
                throw e;
              }
            } else {
              throw e;
            }
          }
        }

        const orderDate = randomTimeInDayUtc(day);
        const itemCount = Math.random() < 0.7 ? 1 : 2;
        const pickedProducts = productsShuffled.slice((orderCode + i) % productsShuffled.length, (orderCode + i) % productsShuffled.length + itemCount);
        const items: OrderItem[] = [];

        const commissionPct = mode === "representante" ? pickOne(COMMISSION_PCTS) : 0;

        let itemsTotal = 0;
        for (let j = 0; j < pickedProducts.length; j += 1) {
          const product = pickedProducts[j] ?? pickOne(products);
          const qty = 1;
          const unit = randInt(1000, 5000);
          const total = unit * qty;
          itemsTotal += total;

          const com = commissionPct > 0 ? (total * commissionPct) / 100 : 0;
          const netUnit = qty > 0 ? unit - com / qty : unit;

          const oi = itemRepo.create({
            company,
            order: undefined as any, // setado após salvar order
            product,
            sku: null,
            quantity: qty,
            unitPrice: toMoney2(unit),
            netUnitPrice: toMoney2(netUnit),
            comission: toMoney2(com),
            itemType: "produto",
            serviceRefSku: null,
          });
          items.push(oi);
        }

        const shipping = randInt(0, 250);
        const discount = Math.random() < 0.15 ? randInt(0, 200) : 0;
        const totalAmount = Math.max(0, itemsTotal + shipping - discount);

        const order = orderRepo.create({
          company,
          orderCode,
          orderDate,
          partnerOrderId: `FAKE-${orderCode}`,
          currentStatus: "aprovado",
          currentStatusCode: "FAKE_APPROVED",
          shippingAmount: toMoney2(shipping),
          deliveryDays: randInt(1, 15),
          deliveryDate: formatYmdUtc(addDaysUtc(day, randInt(1, 15))),
          totalAmount: toMoney2(totalAmount),
          totalDiscount: toMoney2(discount),
          marketplaceName: mode === "marketplace" ? pickOne(MARKETPLACE_CHANNELS) : null,
          channel: mode === "marketplace" ? pickOne(MARKETPLACE_CHANNELS) : "offline",
          paymentDate: ymd,
          discountCoupon: discount > 0 ? "FAKE" : null,
          deliveryState: "SP",
          deliveryZip: String(randInt(10000000, 19999999)),
          deliveryNeighborhood: pickOne(["Centro", "Jardim", "Vila", "Parque"] as const),
          deliveryCity: pickOne(["São Paulo", "Santo André", "São Bernardo do Campo", "Campinas", "Sorocaba"] as const),
          deliveryNumber: String(randInt(10, 9999)),
          deliveryAddress: pickOne(["Rua das Flores", "Av. Brasil", "Rua do Comércio", "Rua das Palmeiras"] as const),
          deliveryComplement: null,
          metadata: mode === "representante" ? { commissionPercent: commissionPct, fake: true } : { fake: true },
          payments: null,
          tracking: null,
          timeline: null,
          raw: { fake: true, mode },
          customer,
        });
        if (representative) order.representative = representative;

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
          try {
            await orderRepo.save(order);
            createdOrders += 1;
            for (const it of items) it.order = order;
            await itemRepo.save(items);
            createdItems += items.length;
            break;
          } catch (e: any) {
            if (isDeadlock(e) && attempt < maxRetries) {
              console.warn(`[fake] deadlock ao salvar pedido ${orderCode}, retry ${attempt}/${maxRetries} em 400ms`);
              await sleep(400);
            } else {
              throw e;
            }
          }
        }

        orderCode += 1;
      }
      console.log(`[fake] ${ymd}: pedidos=${ordersToday}`);
    }

    console.log(
      `[fake] concluído company=${companyId} mode=${mode} customers=${createdCustomers} orders=${createdOrders} items=${createdItems} products=${products.length}`,
    );
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[fake] erro:", err);
  process.exit(1);
});

