import type { IclinicFormattedEvent, IclinicSession } from "./types.js";
import { formatAgendaEvent, type RawAgendaEvent } from "./agenda-formatter.js";

const APP_ORIGIN = "https://app.iclinic.com.br";

const DEFAULT_APP_HEADERS: Record<string, string> = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,pt;q=0.8",
  referer: `${APP_ORIGIN}/agenda/`,
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
};

function buildCookieHeader(cookies: IclinicSession["cookies"]): string {
  const essential = new Set([
    "sessionid",
    "csrftoken",
    "__Secure-next-auth.session-token-v2",
    "userSessionObject",
  ]);
  const list = cookies.filter((c) => essential.has(c.name) || cookies.length <= 8);
  const use = list.length ? list : cookies;
  return use
    .filter((c) => c?.name && c.value != null)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function getClinicIdFromCookies(cookies: IclinicSession["cookies"], fallback: string): string {
  const cookie = cookies.find((c) => c.name === "userSessionObject");
  if (cookie?.value) {
    try {
      const parsed = JSON.parse(decodeURIComponent(cookie.value)) as { active_clinic?: number };
      if (parsed.active_clinic) return String(parsed.active_clinic);
    } catch {
      // ignore
    }
  }
  return fallback;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export const ICLINIC_SESSION_EXPIRED_CODE = "ICLINIC_SESSION_EXPIRED";

export function iclinicSessionExpiredError(message = "Sessão iClinic expirada."): Error {
  const err = new Error(message);
  (err as { code?: string }).code = ICLINIC_SESSION_EXPIRED_CODE;
  return err;
}

export function isIclinicSessionExpiredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: string }).code === ICLINIC_SESSION_EXPIRED_CODE) return true;
  const msg = String((err as Error).message ?? err);
  return /sess[aã]o iclinic expirada|iclinic_session_expired/i.test(msg);
}

function assertAppSession(data: unknown): void {
  const d = data as { redirect?: string } | null;
  if (d?.redirect && /login/i.test(String(d.redirect))) {
    throw iclinicSessionExpiredError("Sessão iClinic expirada. Execute iclinic:getToken.");
  }
}

async function appRequest(session: IclinicSession, pathOrUrl: string, options: { referer?: string } = {}): Promise<unknown> {
  const cookieHeader = buildCookieHeader(session.cookies);
  if (!cookieHeader) {
    throw new Error("Cookies iClinic ausentes na config. Execute iclinic:getToken.");
  }

  const url = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${APP_ORIGIN}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...DEFAULT_APP_HEADERS,
      cookie: cookieHeader,
      ...(options.referer ? { referer: options.referer } : {}),
    },
  });

  const data = await parseJsonResponse(response);
  assertAppSession(data);
  return data;
}

export async function fetchAgendaRaw(
  session: IclinicSession,
  agendaId: string,
  dateYmd: string,
  slide = 1,
): Promise<{ events: RawAgendaEvent[] }> {
  const clinicId = getClinicIdFromCookies(session.cookies, session.clinicId);
  const url = new URL(`${APP_ORIGIN}/agenda/${agendaId}/${dateYmd}/`);
  url.searchParams.set("clinic", clinicId);
  url.searchParams.set("slide", String(slide));
  url.searchParams.set("_", String(Date.now()));

  const referer = `${APP_ORIGIN}/agenda/${agendaId}/${dateYmd}/`;
  const data = (await appRequest(session, url.toString(), { referer })) as { events?: RawAgendaEvent[] };
  return { events: Array.isArray(data?.events) ? data.events : [] };
}

export async function fetchEventTransaction(
  session: IclinicSession,
  eventId: number,
  referer: string,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`${APP_ORIGIN}/agenda/transacao-evento/${eventId}/`);
  url.searchParams.set("_", String(Date.now()));
  try {
    const data = await appRequest(session, url.toString(), { referer });
    if (data && typeof data === "object" && Object.keys(data as object).length > 0) {
      return data as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function hasPatient(event: RawAgendaEvent): boolean {
  return Boolean(event?.patient?.id);
}

function shouldFetchTransaction(event: RawAgendaEvent): boolean {
  return event.status !== "na";
}

export async function fetchAgendaFormatted(
  session: IclinicSession,
  agendaId: string,
  dateYmd: string,
): Promise<IclinicFormattedEvent[]> {
  const referer = `${APP_ORIGIN}/agenda/${agendaId}/${dateYmd}/`;
  const { events } = await fetchAgendaRaw(session, agendaId, dateYmd);
  const withPatient = events.filter(hasPatient);

  const out: IclinicFormattedEvent[] = [];
  for (const event of withPatient) {
    const transaction = shouldFetchTransaction(event)
      ? await fetchEventTransaction(session, event.id, referer)
      : null;
    out.push(formatAgendaEvent(event, transaction));
  }
  return out;
}
