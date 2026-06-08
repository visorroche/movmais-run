import "dotenv/config";
import "reflect-metadata";

import { AppDataSource } from "../../utils/data-source.js";
import { loadIclinicCompanyPlatform, refreshIclinicTokenForCompany } from "../../utils/iclinic/config.js";

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

  console.log(`[iclinic:getToken] company=${companyId} iniciando login Playwright...`);

  const { config: nextConfig } = await refreshIclinicTokenForCompany(companyId);

  console.log(
    `[iclinic:getToken] company=${companyId} token salvo source=${nextConfig.token_source ?? "?"} clinic_id=${nextConfig.clinic_id ?? "(cookie)"} cookies=${nextConfig.cookies?.length ?? 0}`,
  );
}

main().catch((err: unknown) => {
  console.error("[iclinic:getToken] erro:", err);
  process.exit(1);
});
