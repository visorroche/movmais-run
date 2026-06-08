import type { Customer } from "../../entities/Customer.js";
import type { Representative } from "../../entities/Representative.js";

/** agenda_id (external_id) dos representantes principais — vínculo fixo após primeira consulta. */
export const ICLINIC_PRINCIPAL_AGENDA_EXTERNAL_IDS = new Set([
  "261948", // Ornela Minelli
  "267595", // Maria Candida Baracat
]);

export function representativeAgendaExternalId(rep: Representative | null | undefined): string {
  return String(rep?.externalId ?? "").trim();
}

export function isPrincipalAgendaRepresentative(rep: Representative | null | undefined): boolean {
  const id = representativeAgendaExternalId(rep);
  return id !== "" && ICLINIC_PRINCIPAL_AGENDA_EXTERNAL_IDS.has(id);
}

/**
 * Define o representative_id do paciente:
 * - Se já está com um representante principal → não altera.
 * - Se a consulta atual é com principal → atribui esse (e passa a ficar fixo).
 * - Caso contrário → sempre o último que atendeu (agenda da consulta atual).
 */
export function resolvePatientRepresentative(
  existing: Customer | null | undefined,
  attendingRepresentative: Representative,
): Representative {
  const current = existing?.representative ?? null;
  if (isPrincipalAgendaRepresentative(current)) {
    return current!;
  }
  return attendingRepresentative;
}

export function representativeIdChanged(
  customer: Customer,
  next: Representative,
): boolean {
  return (customer.representative?.id ?? null) !== next.id;
}
