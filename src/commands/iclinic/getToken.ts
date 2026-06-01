import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { loadIclinicCompanyPlatform, saveIclinicConfig } from "../../utils/iclinic/config.js";
import { extractIclinicTokenWithPlaywright, mergeTokenIntoConfig } from "../../utils/iclinic/get-token-playwright.js";

function parseCompanyArg(argv: string[]): number {
  for (const a of argv) {
    if (!a.startsWith("--company=")) continue;
    const n = Number(a.slice("--company=".length));
    if (Number.isInteger(n) && n > 0) return n;
  }
  throw new Error("Parâmetro obrigatório: --company=ID");
}

async function main(): Promise<void> {
  const companyId = parseCompanyArg(process.argv.slice(2));
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();

  const loaded = await loadIclinicCompanyPlatform(companyId);
  if (!loaded) {
    throw new Error(`Plataforma iclinic não configurada para company=${companyId}.`);
  }

  const email = String(loaded.config.email ?? "").trim();
  const password = String(loaded.config.password ?? "").trim();
  if (!email || !password) {
    throw new Error("Config iclinic precisa de email e password (company_platforms.config).");
  }

  console.log(`[iclinic:getToken] company=${companyId} iniciando login Playwright...`);

  const extracted = await extractIclinicTokenWithPlaywright(email, password);
  const nextConfig = mergeTokenIntoConfig(loaded.config, extracted);
  await saveIclinicConfig(loaded.companyPlatform, nextConfig);

  console.log(
    `[iclinic:getToken] company=${companyId} token salvo source=${extracted.tokenSource} clinic_id=${nextConfig.clinic_id ?? "(cookie)"} cookies=${extracted.cookies.length}`,
  );
}

main().catch((err: unknown) => {
  console.error("[iclinic:getToken] erro:", err);
  process.exit(1);
});
