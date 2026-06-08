import "dotenv/config";
import "reflect-metadata";

import { In } from "typeorm";
import { AppDataSource } from "../../utils/data-source.js";
import { Company } from "../../entities/Company.js";
import { Customer } from "../../entities/Customer.js";
import { Representative } from "../../entities/Representative.js";
import { Product } from "../../entities/Product.js";
import { Order } from "../../entities/Order.js";
import { OrderItem } from "../../entities/OrderItem.js";
import { Plataform } from "../../entities/Plataform.js";
import { IntegrationLog } from "../../entities/IntegrationLog.js";
import {
  loadIclinicCompanyPlatform,
  refreshIclinicTokenForCompany,
  sessionFromConfig,
} from "../../utils/iclinic/config.js";
import { fetchAgendaFormatted, isIclinicSessionExpiredError } from "../../utils/iclinic/client.js";
import type { IclinicSession } from "../../utils/iclinic/types.js";
import {
  yesterdayYmdBrazil,
  parseOrderDateTime,
  parseYmd,
  dateRangeInclusive,
} from "../../utils/iclinic/dates.js";
import type { IclinicFormattedEvent, IclinicAgendaPatient } from "../../utils/iclinic/types.js";
import { resolvePatientRepresentative } from "../../utils/iclinic/customer-representative.js";

type BookingArgs = {
  companyId: number;
  dates: string[];
};

function parseBookingArgs(argv: string[]): BookingArgs {
  const raw = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const parts = a.slice(2).split("=");
    const k = parts[0];
    if (!k) continue;
    raw.set(k, parts.slice(1).join("="));
  }

  const companyRaw = raw.get("company")?.trim();
  const companyId = Number(companyRaw);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error("Parâmetro obrigatório: --company=ID");
  }

  const startStr = raw.get("start-date")?.trim();
  const endStr = raw.get("end-date")?.trim();
  if (startStr || endStr) {
    if (!startStr || !endStr) {
      throw new Error("Para intervalo use ambos --start-date=YYYY-MM-DD e --end-date=YYYY-MM-DD.");
    }
    const dates = dateRangeInclusive(parseYmd(startStr, "start-date"), parseYmd(endStr, "end-date"));
    return { companyId, dates };
  }

  const dateArg = raw.get("date")?.trim();
  if (dateArg) {
    return { companyId, dates: [parseYmd(dateArg, "date")] };
  }

  return { companyId, dates: [yesterdayYmdBrazil()] };
}

function periodLabel(dates: string[]): string {
  if (dates.length === 1) return dates[0]!;
  return `${dates[0]}..${dates[dates.length - 1]} (${dates.length} dias)`;
}

function agendaDisplayName(rep: Representative): string {
  return String(rep.name ?? rep.externalId ?? "?").trim();
}

/** Agendas iClinic = representantes com external_id = agenda_id (ex. doctors.json). */
async function loadIclinicAgendas(companyId: number): Promise<Representative[]> {
  return AppDataSource.getRepository(Representative)
    .createQueryBuilder("r")
    .where("r.company_id = :companyId", { companyId })
    .andWhere("r.external_id IS NOT NULL")
    .andWhere("TRIM(r.external_id) <> ''")
    .andWhere("r.active = TRUE")
    .orderBy("r.name", "ASC")
    .getMany();
}

function toNumericString(v: number | null | undefined, scale = 2): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v.toFixed(scale);
}

function patientTaxId(patient: IclinicAgendaPatient): string {
  if (patient.code != null && String(patient.code).trim()) return String(patient.code).trim();
  return `ICLINIC-P-${patient.id}`;
}

function normalizeGender(g: string | null | undefined): string | null {
  const s = String(g ?? "").trim().toLowerCase();
  if (s === "f") return "F";
  if (s === "m") return "M";
  return s || null;
}

function customerNeedsUpdate(existing: Customer, next: Partial<Customer>): boolean {
  const fields: Array<keyof Customer> = [
    "tradeName",
    "email",
    "birthDate",
    "gender",
    "taxId",
    "phones",
    "segmentation",
    "raw",
    "representative",
  ];
  for (const f of fields) {
    const a = (existing as any)[f];
    const b = (next as any)[f];
    if (f === "representative") {
      if ((a?.id ?? null) !== (b?.id ?? null)) return true;
      continue;
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) return true;
  }
  return false;
}

function productNeedsUpdate(existing: Product, name: string, category: string, value: string | null): boolean {
  if ((existing.name ?? "") !== name) return true;
  if ((existing.category ?? "") !== category) return true;
  if (value != null && (existing.value ?? "") !== value) return true;
  return false;
}

async function upsertPatientCustomer(
  company: Company,
  platform: Plataform | null,
  patient: IclinicAgendaPatient,
  attendingRepresentative: Representative,
  cache: Map<string, Customer>,
): Promise<Customer> {
  const extId = String(patient.id);
  const repo = AppDataSource.getRepository(Customer);

  let row = cache.get(extId);
  if (!row) {
    row =
      (await repo.findOne({
        where: { company: { id: company.id }, externalId: extId } as any,
        relations: { representative: true },
      })) ?? undefined;
  }

  const phones =
    patient.mobile_phone || patient.home_phone
      ? { mobile: patient.mobile_phone ?? null, home: patient.home_phone ?? null }
      : null;

  const genderNorm = normalizeGender(patient.gender);
  const representative = resolvePatientRepresentative(row ?? null, attendingRepresentative);
  const patch: Partial<Customer> = {
    externalId: extId,
    taxId: patientTaxId(patient),
    tradeName: patient.name ?? null,
    email: patient.email ?? null,
    birthDate: patient.birth_date ?? null,
    phones,
    status: true,
    segmentation: "iclinic_patient",
    raw: { ...(patient as object), iclinic_role: "patient" },
    representative,
  };
  if (genderNorm === "F" || genderNorm === "M" || genderNorm === "B") {
    patch.gender = genderNorm;
  }

  if (row) {
    if (!customerNeedsUpdate(row, patch)) {
      cache.set(extId, row);
      return row;
    }
    Object.assign(row, patch);
    if (platform) row.company = company;
    row = await repo.save(row);
  } else {
    row = repo.create({ company, ...patch });
    if (platform) row.company = company;
    row = await repo.save(row);
  }
  cache.set(extId, row);
  return row;
}

async function upsertProcedureProduct(
  company: Company,
  proc: { id: number; name: string; value: number },
  cache: Map<string, Product>,
): Promise<Product> {
  const extId = String(proc.id);
  let row = cache.get(extId);
  if (row) return row;

  const repo = AppDataSource.getRepository(Product);
  const existing = await repo.findOne({
    where: { company: { id: company.id }, externalId: extId } as any,
  });

  const name = String(proc.name).trim();
  const category = name;
  const value = toNumericString(proc.value);

  if (existing) {
    if (!productNeedsUpdate(existing, name, category, value)) {
      cache.set(extId, existing);
      return existing;
    }
    existing.name = name;
    existing.category = category;
    if (value != null) existing.value = value;
    existing.sku = extId;
    existing.active = true;
    row = await repo.save(existing);
  } else {
    row = repo.create({
      company,
      externalId: extId,
      sku: extId,
      name,
      category,
      value,
      active: true,
    });
    row = await repo.save(row);
  }
  cache.set(extId, row);
  return row;
}

async function processAgendaDay(
  company: Company,
  platform: Plataform | null,
  session: IclinicSession,
  dateYmd: string,
  agendaRepresentative: Representative,
  patientCache: Map<string, Customer>,
  productCache: Map<string, Product>,
  orderRepo: ReturnType<typeof AppDataSource.getRepository<Order>>,
  itemRepo: ReturnType<typeof AppDataSource.getRepository<OrderItem>>,
  counters: {
    agendasProcessed: number;
    eventsProcessed: number;
    ordersInserted: number;
    ordersUpdated: number;
    itemsSaved: number;
    errors: string[];
  },
): Promise<void> {
  const agendaId = String(agendaRepresentative.externalId ?? "").trim();
  if (!agendaId) return;

  const events = await fetchAgendaFormatted(session, agendaId, dateYmd);
  counters.agendasProcessed += 1;

  const eventIds = events.map((e) => String(e.id));
  const existingOrders =
    eventIds.length > 0
      ? await orderRepo.find({
          where: { company: { id: company.id }, externalId: In(eventIds) } as any,
        })
      : [];
  const ordersByExt = new Map(existingOrders.map((o) => [String(o.externalId), o]));

  for (const event of events) {
    try {
      const saved = await persistEvent(
        company,
        platform,
        agendaRepresentative,
        event,
        ordersByExt,
        patientCache,
        productCache,
        orderRepo,
        itemRepo,
      );
      counters.eventsProcessed += 1;
      if (saved.created) counters.ordersInserted += 1;
      else counters.ordersUpdated += 1;
      counters.itemsSaved += saved.itemsCount;
    } catch (e: unknown) {
      counters.errors.push(`event ${event.id} (${dateYmd}): ${String((e as Error)?.message ?? e)}`);
    }
  }

  console.log(
    `[iclinic:getBookings]   agenda ${agendaId} (${agendaDisplayName(agendaRepresentative)}) data=${dateYmd} events=${events.length}`,
  );
}

type AgendaDayContext = {
  company: Company;
  platform: Plataform | null;
  dateYmd: string;
  agendaRepresentative: Representative;
  patientCache: Map<string, Customer>;
  productCache: Map<string, Product>;
  orderRepo: ReturnType<typeof AppDataSource.getRepository<Order>>;
  itemRepo: ReturnType<typeof AppDataSource.getRepository<OrderItem>>;
  counters: {
    agendasProcessed: number;
    eventsProcessed: number;
    ordersInserted: number;
    ordersUpdated: number;
    itemsSaved: number;
    errors: string[];
  };
};

/**
 * Executa uma agenda; se a sessão expirar, renova o token (1× por execução do comando) e repete.
 * Falha fatal interrompe o restante do backfill (não segue agenda/dia seguinte).
 */
async function processAgendaDayResilient(
  companyId: number,
  sessionRef: { current: IclinicSession },
  tokenRefreshedThisRun: { done: boolean },
  abortRun: { value: boolean },
  ctx: AgendaDayContext,
): Promise<void> {
  const runOnce = () =>
    processAgendaDay(
      ctx.company,
      ctx.platform,
      sessionRef.current,
      ctx.dateYmd,
      ctx.agendaRepresentative,
      ctx.patientCache,
      ctx.productCache,
      ctx.orderRepo,
      ctx.itemRepo,
      ctx.counters,
    );

  try {
    await runOnce();
    return;
  } catch (firstErr: unknown) {
    if (!isIclinicSessionExpiredError(firstErr)) throw firstErr;

    if (tokenRefreshedThisRun.done) {
      abortRun.value = true;
      throw new Error(
        `Sessão iClinic ainda inválida após renovar o token. Execução interrompida. (${String((firstErr as Error)?.message ?? firstErr)})`,
      );
    }

    console.warn("[iclinic:getBookings] sessão expirada; renovando token automaticamente (Playwright)...");
    try {
      const refreshed = await refreshIclinicTokenForCompany(companyId);
      sessionRef.current = refreshed.session;
      tokenRefreshedThisRun.done = true;
      console.log(
        `[iclinic:getBookings] token renovado (clinic_id=${refreshed.config.clinic_id ?? "?"}, cookies=${refreshed.config.cookies?.length ?? 0}); repetindo agenda...`,
      );
    } catch (refreshErr: unknown) {
      abortRun.value = true;
      throw new Error(
        `Não foi possível renovar o token iClinic: ${String((refreshErr as Error)?.message ?? refreshErr)}`,
      );
    }

    try {
      await runOnce();
    } catch (retryErr: unknown) {
      if (isIclinicSessionExpiredError(retryErr)) {
        abortRun.value = true;
        throw new Error(
          `Sessão iClinic ainda inválida após renovar o token. Execução interrompida. (${String((retryErr as Error)?.message ?? retryErr)})`,
        );
      }
      throw retryErr;
    }
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { companyId, dates } = parseBookingArgs(process.argv.slice(2));
  const period = periodLabel(dates);
  const logDateYmd = dates[dates.length - 1]!;

  if (!AppDataSource.isInitialized) await AppDataSource.initialize();

  const loaded = await loadIclinicCompanyPlatform(companyId);
  if (!loaded) throw new Error(`Plataforma iclinic não configurada para company=${companyId}.`);

  const sessionRef = { current: sessionFromConfig(loaded.config) };
  const tokenRefreshedThisRun = { done: false };
  const abortRun = { value: false };

  const company = await AppDataSource.getRepository(Company).findOne({ where: { id: companyId } });
  if (!company) throw new Error(`Company ${companyId} não encontrada.`);

  const platform = await AppDataSource.getRepository(Plataform).findOne({ where: { slug: "iclinic" } });

  const agendaRepresentatives = await loadIclinicAgendas(companyId);

  if (!agendaRepresentatives.length) {
    console.warn(
      `[iclinic:getBookings] company=${companyId} nenhum representante com external_id (agenda_id do iClinic). ` +
        `Cadastre médicos em representatives com external_id preenchido e active=true.`,
    );
    return;
  }

  let integrationLogId: number | null = null;
  try {
    const logRepo = AppDataSource.getRepository(IntegrationLog);
    const started = await logRepo.save(
      logRepo.create({
        processedAt: new Date(),
        date: logDateYmd,
        company,
        ...(platform ? { platform } : {}),
        command: "Pedidos",
        status: "PROCESSANDO",
        log: {
          company: companyId,
          command: "Pedidos",
          period,
          dates,
          status: "PROCESSANDO",
        },
      }),
    );
    integrationLogId = Array.isArray(started) ? (started[0]?.id ?? null) : started.id;
  } catch (e) {
    console.warn("[iclinic:getBookings] falha ao gravar log inicial:", e);
  }

  const patientCache = new Map<string, Customer>();
  const productCache = new Map<string, Product>();
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);

  const counters = {
    agendasProcessed: 0,
    eventsProcessed: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    itemsSaved: 0,
    errors: [] as string[],
  };

  const totalSteps = dates.length * agendaRepresentatives.length;
  let step = 0;

  console.log(
    `[iclinic:getBookings] company=${companyId} periodo=${period} representantes_agenda=${agendaRepresentatives.length} passos=${totalSteps} (sem --date/--start-date usa ontem em America/Sao_Paulo)`,
  );

  const agendaCtxBase = {
    company,
    platform,
    patientCache,
    productCache,
    orderRepo,
    itemRepo,
    counters,
  };

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    if (abortRun.value) break;

    const dateYmd = dates[dayIndex]!;
    let dayEvents = 0;
    let dayAgendasOk = 0;
    const dayErrorsBefore = counters.errors.length;

    console.log(
      `[iclinic:getBookings] --- dia ${dateYmd} (${dayIndex + 1}/${dates.length}) ---`,
    );

    for (const agendaRepresentative of agendaRepresentatives) {
      if (abortRun.value) break;

      step += 1;
      const agendaId = String(agendaRepresentative.externalId ?? "").trim();
      if (!agendaId) continue;

      const pct = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 100;
      console.log(
        `[iclinic:getBookings] progresso ${step}/${totalSteps} (${pct}%) data=${dateYmd} agenda=${agendaId} (${agendaDisplayName(agendaRepresentative)})`,
      );

      const eventsBefore = counters.eventsProcessed;

      try {
        await processAgendaDayResilient(companyId, sessionRef, tokenRefreshedThisRun, abortRun, {
          ...agendaCtxBase,
          dateYmd,
          agendaRepresentative,
        });
        dayAgendasOk += 1;
        dayEvents += counters.eventsProcessed - eventsBefore;
      } catch (e: unknown) {
        const msg = String((e as Error)?.message ?? e);
        counters.errors.push(`agenda ${agendaId} (${dateYmd}): ${msg}`);
        console.error(`[iclinic:getBookings]   erro agenda ${agendaId} data=${dateYmd}: ${msg}`);
        if (abortRun.value) {
          console.error(
            "[iclinic:getBookings] execução interrompida: sessão iClinic inválida e renovação automática não resolveu.",
          );
          break;
        }
      }
    }

    const dayErrors = counters.errors.length - dayErrorsBefore;
    console.log(
      `[iclinic:getBookings] dia ${dateYmd} finalizado agendas_ok=${dayAgendasOk}/${agendaRepresentatives.length} events=${dayEvents} erros_dia=${dayErrors} acumulado_events=${counters.eventsProcessed} acumulado_orders+${counters.ordersInserted}/~${counters.ordersUpdated}`,
    );

    if (abortRun.value) break;
  }

  const { agendasProcessed, eventsProcessed, ordersInserted, ordersUpdated, itemsSaved, errors } = counters;
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[iclinic:getBookings] concluído company=${companyId} periodo=${period} agendas=${agendasProcessed} events=${eventsProcessed} orders_inserted=${ordersInserted} orders_updated=${ordersUpdated} items=${itemsSaved} errors=${errors.length} elapsed=${elapsed}s`,
  );

  if (errors.length) console.warn("[iclinic:getBookings] erros:", errors.slice(0, 20));

  try {
    if (integrationLogId) {
      const logRepo = AppDataSource.getRepository(IntegrationLog);
      await logRepo.update(
        { id: integrationLogId },
        {
          status: errors.length ? "ERRO" : "FINALIZADO",
          log: {
            company: companyId,
            command: "Pedidos",
            period,
            dates,
            agendas_processed: agendasProcessed,
            events_processed: eventsProcessed,
            orders_inserted: ordersInserted,
            orders_updated: ordersUpdated,
            items_saved: itemsSaved,
            elapsed_s: elapsed,
          },
          ...(errors.length ? { errors: { items: errors } } : {}),
        },
      );
    }
  } catch (e) {
    console.warn("[iclinic:getBookings] falha ao finalizar log:", e);
  }

  if (errors.length || abortRun.value) process.exitCode = abortRun.value ? 1 : 2;
}

async function persistEvent(
  company: Company,
  platform: Plataform | null,
  agendaRepresentative: Representative,
  event: IclinicFormattedEvent,
  ordersByExt: Map<string, Order>,
  patientCache: Map<string, Customer>,
  productCache: Map<string, Product>,
  orderRepo: ReturnType<typeof AppDataSource.getRepository<Order>>,
  itemRepo: ReturnType<typeof AppDataSource.getRepository<OrderItem>>,
): Promise<{ created: boolean; itemsCount: number }> {
  const patient = await upsertPatientCustomer(
    company,
    platform,
    event.patient,
    agendaRepresentative,
    patientCache,
  );
  const orderExtId = String(event.id);
  const orderDate = parseOrderDateTime(event.date, event.start_time);

  const metadata = {
    iclinic: {
      agenda_representative_id: agendaRepresentative.id,
      agenda_external_id: agendaRepresentative.externalId,
      agenda_name: agendaRepresentative.name ?? null,
      date_added: event.date_added,
      added_by: event.added_by,
      description: event.description,
      insurance: event.insurance,
      end_time: event.end_time,
      patient_email: event.patient_email,
      pay_date: event.pay_date,
      raw_status: event.status,
    },
  };

  let order = ordersByExt.get(orderExtId) ?? null;
  let created = false;

  const orderPatch = {
    externalId: orderExtId,
    orderCode: orderExtId,
    orderDate,
    currentStatusCode: event.status,
    totalAmount: event.value != null ? toNumericString(event.value) : null,
    paymentDate: event.pay_date ?? null,
    channel: "iclinic",
    customer: patient,
    representative: agendaRepresentative,
    company,
    ...(platform ? { platform } : {}),
    metadata,
    active: 1,
    bonificacao: 0,
  };

  if (order) {
    Object.assign(order, orderPatch);
    order = await orderRepo.save(order);
  } else {
    order = orderRepo.create(orderPatch);
    order = await orderRepo.save(order);
    ordersByExt.set(orderExtId, order);
    created = true;
  }

  const incomingItemExtIds: string[] = [];
  let itemsCount = 0;

  for (const proc of event.procedures) {
    const product = await upsertProcedureProduct(company, proc, productCache);
    const itemExtId = `${event.id}-${proc.id}`;
    incomingItemExtIds.push(itemExtId);

    let item = await itemRepo.findOne({
      where: { company: { id: company.id }, externalId: itemExtId } as any,
    });

    const unitPrice = toNumericString(proc.value);
    const itemPatch = {
      company,
      order,
      externalId: itemExtId,
      product,
      sku: proc.id,
      unitPrice,
      netUnitPrice: unitPrice,
      quantity: proc.quantity ?? 1,
      itemType: "servico",
      metadata: { procedure_id: proc.id, procedure_name: proc.name },
    };

    if (item) {
      Object.assign(item, itemPatch);
      await itemRepo.save(item);
    } else {
      item = itemRepo.create(itemPatch);
      await itemRepo.save(item);
    }
    itemsCount += 1;
  }

  if (incomingItemExtIds.length) {
    await itemRepo
      .createQueryBuilder()
      .delete()
      .where("order_id = :orderId", { orderId: order.id })
      .andWhere("external_id IS NOT NULL")
      .andWhere("external_id NOT IN (:...ids)", { ids: incomingItemExtIds })
      .execute();
  }

  return { created, itemsCount };
}

main().catch((err: unknown) => {
  console.error("[iclinic:getBookings] erro:", err);
  process.exit(1);
});
