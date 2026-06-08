import { AppDataSource } from "../data-source.js";
import { CompanyPlataform } from "../../entities/CompanyPlataform.js";
import type { IclinicCompanyConfig, IclinicSession } from "./types.js";
import { extractIclinicTokenWithPlaywright, mergeTokenIntoConfig } from "./get-token-playwright.js";

const ICLINIC_SLUGS = ["iclinic"] as const;

export async function loadIclinicCompanyPlatform(companyId: number): Promise<{
  companyPlatformId: number;
  config: IclinicCompanyConfig;
  companyPlatform: CompanyPlataform;
} | null> {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(CompanyPlataform);
  const cp = await repo
    .createQueryBuilder("cp")
    .innerJoinAndSelect("cp.platform", "platform")
    .innerJoinAndSelect("cp.company", "company")
    .where("company.id = :companyId", { companyId })
    .andWhere("platform.slug = :slug", { slug: "iclinic" })
    .getOne();

  if (!cp) return null;

  let raw = (cp.config ?? {}) as IclinicCompanyConfig | string;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as IclinicCompanyConfig;
    } catch {
      raw = {};
    }
  }

  return {
    companyPlatformId: Number(cp.id),
    config: raw && typeof raw === "object" ? raw : {},
    companyPlatform: cp,
  };
}

export function sessionFromConfig(cfg: IclinicCompanyConfig): IclinicSession {
  const token = String(cfg.token ?? "").trim();
  if (!token) {
    throw new Error("Token iClinic ausente na config. Execute iclinic:getToken antes.");
  }
  const cookies = Array.isArray(cfg.cookies) ? cfg.cookies : [];
  const clinicId = String(cfg.clinic_id ?? process.env.ICLINIC_CLINIC_ID ?? "243423").trim();
  return {
    token,
    ...(cfg.token_source ? { tokenSource: cfg.token_source } : {}),
    clinicId,
    cookies,
  };
}

export async function saveIclinicConfig(
  companyPlatform: CompanyPlataform,
  patch: Partial<IclinicCompanyConfig>,
): Promise<IclinicCompanyConfig> {
  const repo = AppDataSource.getRepository(CompanyPlataform);
  let current = (companyPlatform.config ?? {}) as IclinicCompanyConfig;
  if (typeof current === "string") {
    try {
      current = JSON.parse(current) as IclinicCompanyConfig;
    } catch {
      current = {};
    }
  }
  const next: IclinicCompanyConfig = {
    ...current,
    ...patch,
    token_updated_at: patch.token_updated_at ?? new Date().toISOString(),
  };
  companyPlatform.config = next;
  await repo.save(companyPlatform);
  return next;
}

/** Login Playwright + persistência em `company_platforms.config`. Usado por getToken e getBookings. */
export async function refreshIclinicTokenForCompany(companyId: number): Promise<{
  config: IclinicCompanyConfig;
  session: IclinicSession;
}> {
  const loaded = await loadIclinicCompanyPlatform(companyId);
  if (!loaded) {
    throw new Error(`Plataforma iclinic não configurada para company=${companyId}.`);
  }

  const email = String(loaded.config.email ?? "").trim();
  const password = String(loaded.config.password ?? "").trim();
  if (!email || !password) {
    throw new Error("Config iclinic precisa de email e password para renovar o token.");
  }

  const extracted = await extractIclinicTokenWithPlaywright(email, password);
  const nextConfig = mergeTokenIntoConfig(loaded.config, extracted);
  await saveIclinicConfig(loaded.companyPlatform, nextConfig);

  return { config: nextConfig, session: sessionFromConfig(nextConfig) };
}

export { ICLINIC_SLUGS };
