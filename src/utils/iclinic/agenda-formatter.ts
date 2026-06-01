import type { IclinicAgendaProcedure, IclinicFormattedEvent } from "./types.js";

export type RawAgendaEvent = {
  id: number;
  patient?: {
    id: number;
    code?: number;
    name?: string;
    home_phone?: string | null;
    birth_date?: string | null;
    age?: number;
    gender?: string | null;
    mobile_phone?: string | null;
    email?: string | null;
    picture?: string | null;
    last_appointment_date?: string | null;
    age_full_described?: string | null;
  };
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  description?: string | null;
  added_by?: string | null;
  date_added?: string | null;
  patient_email?: string | null;
  insurance?: { name?: string } | string | null;
  procedures?: unknown[];
};

function parseMoney(value: unknown): number {
  return Math.round((Number.parseFloat(String(value ?? 0)) || 0) * 100) / 100;
}

function hasTransactionDetails(data: Record<string, unknown> | null): boolean {
  return Boolean(data && typeof data === "object" && Object.keys(data).length > 0);
}

function proceduresFromTransaction(transaction: Record<string, unknown>): IclinicAgendaProcedure[] {
  const list = Array.isArray(transaction.procedures) ? transaction.procedures : [];
  return list
    .filter((item) => item && typeof item === "object" && !(item as { deleted?: boolean }).deleted)
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: Number(row.procedure_id ?? row.id ?? 0),
        name: String(row.name ?? ""),
        value: parseMoney(row.value),
        quantity: Number(row.quantity ?? 1) || 1,
      };
    })
    .filter((p) => p.id > 0 && p.name);
}

function proceduresFromEvent(event: RawAgendaEvent): IclinicAgendaProcedure[] {
  const list = Array.isArray(event.procedures) ? event.procedures : [];
  return list
    .map((item) => {
      const row = item as Record<string, unknown>;
      const procedure = row.procedure as Record<string, unknown> | undefined;
      if (!procedure) return null;
      return {
        id: Number(procedure.id ?? 0),
        name: String(procedure.name ?? ""),
        value: parseMoney(procedure.event_procedure_value),
        quantity: Number(procedure.event_procedure_quantity ?? 1) || 1,
      };
    })
    .filter((p): p is IclinicAgendaProcedure => Boolean(p && p.id > 0 && p.name));
}

function getDiscountOrder(procedures: IclinicAgendaProcedure[]): number[] {
  return [...procedures.keys()].sort((indexA, indexB) => {
    const procA = procedures[indexA]!;
    const procB = procedures[indexB]!;
    const isConsultaA = procA.name === "Consulta";
    const isConsultaB = procB.name === "Consulta";
    if (isConsultaA && !isConsultaB) return -1;
    if (!isConsultaA && isConsultaB) return 1;
    return procB.value - procA.value;
  });
}

function applyDiscount(procedures: IclinicAgendaProcedure[], discount: unknown): IclinicAgendaProcedure[] {
  const discountAmount = parseMoney(discount);
  if (discountAmount <= 0) return procedures.map((item) => ({ ...item }));

  const items = procedures.map((item) => ({ ...item, value: parseMoney(item.value) }));
  let remaining = discountAmount;

  for (const index of getDiscountOrder(items)) {
    if (remaining <= 0) break;
    const deduction = Math.min(remaining, items[index]!.value);
    items[index]!.value = parseMoney(items[index]!.value - deduction);
    remaining = parseMoney(remaining - deduction);
  }

  return items;
}

export function formatAgendaEvent(
  event: RawAgendaEvent,
  transaction: Record<string, unknown> | null,
): IclinicFormattedEvent {
  const insurance =
    event.insurance && typeof event.insurance === "object"
      ? (event.insurance as { name?: string }).name ?? null
      : typeof event.insurance === "string"
        ? event.insurance
        : null;

  const useTransaction = hasTransactionDetails(transaction);
  let procedures = useTransaction && transaction
    ? proceduresFromTransaction(transaction)
    : proceduresFromEvent(event);

  if (useTransaction && transaction) {
    procedures = applyDiscount(procedures, transaction.discount);
  }

  const formatted: IclinicFormattedEvent = {
    id: event.id,
    patient: event.patient!,
    date: event.date,
    start_time: event.start_time,
    end_time: event.end_time,
    status: event.status,
    description: event.description ?? null,
    added_by: event.added_by ?? null,
    date_added: event.date_added ?? null,
    patient_email: event.patient_email ?? null,
    insurance,
    procedures,
  };

  if (useTransaction && transaction) {
    formatted.pay_date = transaction.pay_date != null ? String(transaction.pay_date) : null;
    formatted.value = parseMoney(transaction.value);
  }

  return formatted;
}
