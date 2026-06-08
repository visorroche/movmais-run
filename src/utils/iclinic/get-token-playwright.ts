/**
 * Login no app iClinic via Playwright e extração de authToken + cookies.
 * Baseado em prima-vitta/api/iclinic-get-token.js
 */
import type { IclinicCookie, IclinicCompanyConfig } from "./types.js";

export type IclinicTokenExtractResult = {
  token: string;
  tokenSource: string;
  cookies: IclinicCookie[];
  sessionid: string | null;
  nextAuthSessionTokenV2: string | null;
  clinicId: string | null;
};

function logDebug(enabled: boolean, ...args: unknown[]) {
  if (enabled) console.error("[iclinic:getToken:debug]", ...args);
}

function isDestroyedContextError(error: unknown): boolean {
  return /Execution context was destroyed|navigation|Target closed/i.test(String((error as Error)?.message ?? error));
}

async function safePageEvaluate<T>(
  page: { evaluate: (fn: () => T) => Promise<unknown> },
  fn: () => T,
): Promise<T | null> {
  try {
    return (await page.evaluate(fn)) as T;
  } catch (error) {
    if (isDestroyedContextError(error)) return null;
    throw error;
  }
}

async function waitForPageSettled(
  page: { waitForLoadState: (state?: "domcontentloaded" | "load", o?: { timeout?: number }) => Promise<void>; waitForTimeout: (ms: number) => Promise<void> },
  timeoutMs = 30000,
) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

type TokenScanResult = {
  authToken: string | null;
  tokenLikeEntries: Array<{ storage: string; key: string; value: string }>;
  href: string;
};

async function triggerChatBootstrap(context: { request: { get: (url: string, o?: { headers?: Record<string, string> }) => Promise<unknown> } }) {
  try {
    await context.request.get(`https://app.iclinic.com.br/chat/usuarios/?_=${Date.now()}`, {
      headers: { "x-requested-with": "XMLHttpRequest" },
    });
  } catch {
    // ignora
  }
}

async function waitForAnyToken(
  page: { evaluate: (fn: () => unknown) => Promise<unknown>; waitForTimeout: (ms: number) => Promise<void> },
  debug: boolean,
  timeoutMs = 45000,
): Promise<{ source: string; token: string } | null> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const result = await safePageEvaluate(page, (): TokenScanResult => {
      const local: Record<string, string> = {};
      const session: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) local[key] = localStorage.getItem(key) ?? "";
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) session[key] = sessionStorage.getItem(key) ?? "";
      }
      const authToken = localStorage.getItem("authToken");
      const tokenLikeEntries: Array<{ storage: string; key: string; value: string }> = [];
      for (const [storageName, storageObj] of [
        ["localStorage", local],
        ["sessionStorage", session],
      ] as const) {
        for (const [key, value] of Object.entries(storageObj)) {
          if (/token|auth|session/i.test(key) || /\.eJ|eyJ[a-zA-Z0-9_-]*\./.test(String(value || ""))) {
            tokenLikeEntries.push({ storage: storageName, key, value });
          }
        }
      }
      return { authToken, tokenLikeEntries, href: location.href };
    });

    if (!result) {
      await page.waitForTimeout(1000);
      continue;
    }

    if (result.authToken) return { source: "localStorage.authToken", token: result.authToken };

    const candidate =
      result.tokenLikeEntries.find((e) => e.key === "authToken") ||
      result.tokenLikeEntries.find((e) => /^auth/i.test(e.key)) ||
      result.tokenLikeEntries.find((e) => /token/i.test(e.key));

    if (candidate?.value) {
      return { source: `${candidate.storage}.${candidate.key}`, token: candidate.value };
    }

    logDebug(debug, "Ainda sem token. URL:", result.href);
    await page.waitForTimeout(1000);
  }

  return null;
}

function parseClinicIdFromCookies(cookies: IclinicCookie[]): string | null {
  const cookie = cookies.find((c) => c.name === "userSessionObject");
  if (!cookie?.value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(cookie.value)) as { active_clinic?: number };
    if (parsed.active_clinic) return String(parsed.active_clinic);
  } catch {
    // ignore
  }
  return null;
}

export async function extractIclinicTokenWithPlaywright(
  email: string,
  password: string,
  options: { headless?: boolean; debug?: boolean } = {},
): Promise<IclinicTokenExtractResult> {
  const headless = options.headless ?? String(process.env.ICLINIC_HEADLESS ?? "true").toLowerCase() !== "false";
  const debug = options.debug ?? String(process.env.DEBUG_ICLINIC ?? "false").toLowerCase() === "true";

  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-http2",
      "--disable-quic",
      "--ignore-certificate-errors",
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      locale: "pt-BR",
      extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9,pt;q=0.8" },
    });

    const page = await context.newPage();

    await page.goto("https://app.iclinic.com.br/usuarios/login/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.locator("input#email, input[type='email']").first().waitFor({ timeout: 90000 });
    await page.locator("input#password, input[type='password']").first().waitFor({ timeout: 90000 });

    await page.locator("input#email, input[type='email']").first().fill(email, { timeout: 60000 });
    await page.locator("input#password, input[type='password']").first().fill(password, { timeout: 60000 });

    const loginButton = page.getByRole("button", { name: /^Entrar$/i }).first();
    await Promise.allSettled([
      page.waitForURL(/agenda|login-redirect|\/v2\//, { timeout: 90000 }),
      loginButton.click({ timeout: 60000 }),
    ]);

    await waitForPageSettled(page, 60000);

    if (!/\/agenda\//.test(page.url())) {
      await page.goto("https://app.iclinic.com.br/agenda/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => undefined);
      await waitForPageSettled(page, 60000);
    }

    await triggerChatBootstrap(context);

    const found = await waitForAnyToken(page, debug, 45000);
    if (!found) {
      throw new Error("Não foi possível extrair authToken após login no iClinic.");
    }

    const rawCookies = await context.cookies("https://app.iclinic.com.br");
    const cookies: IclinicCookie[] = rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
    }));

    const sessionCookie = rawCookies.find((c) => c.name === "sessionid");
    const nextAuthCookie = rawCookies.find((c) => c.name === "__Secure-next-auth.session-token-v2");
    const clinicId = parseClinicIdFromCookies(cookies);

    return {
      token: found.token,
      tokenSource: found.source,
      cookies,
      sessionid: sessionCookie?.value ?? null,
      nextAuthSessionTokenV2: nextAuthCookie?.value ?? null,
      clinicId,
    };
  } finally {
    await browser.close();
  }
}

export function mergeTokenIntoConfig(
  current: IclinicCompanyConfig,
  extracted: IclinicTokenExtractResult,
): IclinicCompanyConfig {
  return {
    ...current,
    token: extracted.token,
    token_source: extracted.tokenSource,
    cookies: extracted.cookies,
    sessionid: extracted.sessionid,
    next_auth_session_token_v2: extracted.nextAuthSessionTokenV2,
    ...(extracted.clinicId ? { clinic_id: extracted.clinicId } : {}),
    token_updated_at: new Date().toISOString(),
  };
}
