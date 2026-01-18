import "dotenv/config";
import "reflect-metadata";

import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppDataSource } from "./utils/data-source.js";
import { CompanyPlataform } from "./entities/CompanyPlataform.js";

type JobName =
  | "allpost:freight-quotes"
  | "allpost:freight-orders"
  | "precode:products"
  | "tray:products"
  | "precode:orders"
  | "tray:orders";

const JOB_LOCKS = new Map<JobName, boolean>();
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readVersionFromScriptBi(): { version: string | null; file: string | null } {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const candidates = [
    // 1) quando roda dentro de ./script-bi
    path.resolve(process.cwd(), "version.txt"),
    // 2) quando roda na raiz do repo
    path.resolve(process.cwd(), "script-bi", "version.txt"),
    // 3) quando roda a partir de ./script-bi/dist
    path.resolve(__dirname, "..", "version.txt"),
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      const version = String(raw).trim();
      return { version: version || null, file: p };
    } catch {
      // tenta próximo candidato
    }
  }
  return { version: null, file: null };
}

function startHttpServer() {
  const portRaw = process.env.PORT || "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    console.warn(`[scheduler] PORT inválido (${portRaw}); servidor HTTP não será iniciado.`);
    return null;
  }

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url === "/version") {
      const { version, file } = readVersionFromScriptBi();
      if (!version) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ version: null, project: "run", error: "script-bi/version.txt não encontrado ou vazio", file }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ version, project: "run" }));
      return;
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: "Not found" }));
  });

  server.listen(port, () => {
    console.log(`[scheduler] HTTP server listening on :${port} (/health, /version)`);
  });

  return server;
}

function utcMidnight(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function formatYmdUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatIsoLikeAllpostUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  // parceiro usa sem timezone: "YYYY-MM-DDTHH:mm:ss"
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

async function ensureDb(): Promise<void> {
  if (AppDataSource.isInitialized) return;
  await AppDataSource.initialize();
}

async function listCompanyIdsForPlatformSlug(slug: string): Promise<number[]> {
  await ensureDb();
  const cpRepo = AppDataSource.getRepository(CompanyPlataform);
  const rows = await cpRepo
    .createQueryBuilder("cp")
    .innerJoin("cp.platform", "platform")
    .innerJoin("cp.company", "company")
    .where("platform.slug = :slug", { slug })
    .select("company.id", "id")
    .getRawMany<{ id: number }>();

  const ids = rows
    .map((r) => Number(r.id))
    .filter((n) => Number.isInteger(n) && n > 0);
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

function resolveDistScript(scriptRelFromDistRoot: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // src/scheduler.ts -> dist/scheduler.js, então __dirname aponta para ./dist
  return path.resolve(__dirname, scriptRelFromDistRoot);
}

async function runNodeScript(scriptPath: string, argv: string[], label: string): Promise<void> {
  if (shuttingDown) return;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argv], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[scheduler] ${label} terminou com exit_code=${code ?? "null"}`));
    });
  });
}

async function runJob(name: JobName, fn: () => Promise<void>): Promise<void> {
  if (JOB_LOCKS.get(name)) {
    console.log(`[scheduler] job ${name} ainda está rodando; pulando este tick.`);
    return;
  }
  JOB_LOCKS.set(name, true);
  const started = Date.now();
  console.log(`[scheduler] job ${name} iniciando...`);
  try {
    await fn();
    console.log(`[scheduler] job ${name} finalizado OK em ${Date.now() - started}ms`);
  } catch (err) {
    console.error(`[scheduler] job ${name} erro:`, err);
  } finally {
    JOB_LOCKS.set(name, false);
  }
}

async function runForCompanies(platformSlug: string, scriptRel: string, makeArgs: (companyId: number) => string[]) {
  const ids = await listCompanyIdsForPlatformSlug(platformSlug);
  if (ids.length === 0) {
    console.log(`[scheduler] platform=${platformSlug} sem companies instaladas; nada a fazer.`);
    return;
  }

  const scriptPath = resolveDistScript(scriptRel);
  for (const companyId of ids) {
    if (shuttingDown) break;
    const label = `${platformSlug} company=${companyId} script=${scriptRel}`;
    console.log(`[scheduler] executando ${label}`);
    // Importante: se UMA company falhar, não deve interromper as demais.
    // Espaça um pouco para evitar rajadas (especialmente em produção)
    try {
      // eslint-disable-next-line no-await-in-loop
      await runNodeScript(scriptPath, makeArgs(companyId), label);
    } catch (err) {
      console.error(`[scheduler] erro ao executar ${label}:`, err);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
}

async function main() {
  const EVERY_5_MIN = 5 * 60 * 1000;
  const EVERY_30_MIN = 30 * 60 * 1000;
  const EVERY_1_HOUR = 60 * 60 * 1000;
  const EVERY_3_HOURS = 3 * 60 * 60 * 1000;

  process.on("SIGINT", () => {
    shuttingDown = true;
    console.log("[scheduler] SIGINT recebido; finalizando...");
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
    console.log("[scheduler] SIGTERM recebido; finalizando...");
  });

  const httpServer = startHttpServer();

  await ensureDb();

  // job: allpost freight quotes (a cada 5 min)
  const tickAllpost = () =>
    runJob("allpost:freight-quotes", async () => {
      await runForCompanies("allpost", "commands/allpost/allpostFreightQuotes.js", (companyId) => [`--company=${companyId}`]);
    });

  // job: allpost freight orders (a cada 1h) — roda um range sobreposto (últimos 2 dias UTC) para capturar atualizações
  const tickAllpostFreightOrders = () =>
    runJob("allpost:freight-orders", async () => {
      const start = addDaysUtc(utcMidnight(new Date()), -2);
      const end = new Date();
      await runForCompanies("allpost", "commands/allpost/allpostFreightOrders.js", (companyId) => [
        `--company=${companyId}`,
        `--start-date=${formatIsoLikeAllpostUtc(start)}`,
        `--end-date=${formatIsoLikeAllpostUtc(end)}`,
      ]);
    });

  // job: products (a cada 3h)
  const tickPrecodeProducts = () =>
    runJob("precode:products", async () => {
      await runForCompanies("precode", "commands/precode/precodeProducts.js", (companyId) => [`--company=${companyId}`]);
    });
  const tickTrayProducts = () =>
    runJob("tray:products", async () => {
      await runForCompanies("tray", "commands/tray/trayProducts.js", (companyId) => [`--company=${companyId}`]);
    });

  // job: orders (a cada 30 min) — roda um range curto (ontem..hoje UTC) para capturar atualizações
  const tickPrecodeOrders = () =>
    runJob("precode:orders", async () => {
      const end = formatYmdUtc(utcMidnight(new Date()));
      const start = formatYmdUtc(addDaysUtc(utcMidnight(new Date()), -1));
      await runForCompanies("precode", "commands/precode/precodeOrders.js", (companyId) => [
        `--company=${companyId}`,
        `--start-date=${start}`,
        `--end-date=${end}`,
      ]);
    });
  const tickTrayOrders = () =>
    runJob("tray:orders", async () => {
      const end = formatYmdUtc(utcMidnight(new Date()));
      const start = formatYmdUtc(addDaysUtc(utcMidnight(new Date()), -1));
      await runForCompanies("tray", "commands/tray/trayOrders.js", (companyId) => [
        `--company=${companyId}`,
        `--start-date=${start}`,
        `--end-date=${end}`,
      ]);
    });

  console.log("[scheduler] iniciado.");
  console.log("[scheduler] agendas: allpost-quotes=5min, allpost-freight-orders=1h, orders=30min, products=3h");

  // roda na partida (com pequeno delay para evitar corrida com deploy)
  setTimeout(() => void tickAllpost(), 2_000);
  setTimeout(() => void tickAllpostFreightOrders(), 3_000);
  setTimeout(() => void tickPrecodeOrders(), 4_000);
  setTimeout(() => void tickTrayOrders(), 6_000);
  setTimeout(() => void tickPrecodeProducts(), 8_000);
  setTimeout(() => void tickTrayProducts(), 10_000);

  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => void tickAllpost(), EVERY_5_MIN));
  timers.push(setInterval(() => void tickAllpostFreightOrders(), EVERY_1_HOUR));
  timers.push(setInterval(() => void tickPrecodeOrders(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickTrayOrders(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickPrecodeProducts(), EVERY_3_HOURS));
  timers.push(setInterval(() => void tickTrayProducts(), EVERY_3_HOURS));

  // loop “keep alive” para permitir shutdown gracioso
  while (!shuttingDown) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(1_000);
  }

  for (const t of timers) clearInterval(t);
  console.log("[scheduler] aguardando jobs em andamento finalizarem...");
  while (Array.from(JOB_LOCKS.values()).some(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }

  await new Promise<void>((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => resolve());
  });

  await AppDataSource.destroy().catch(() => undefined);
  console.log("[scheduler] finalizado.");
}

main().catch((err) => {
  console.error("[scheduler] erro fatal:", err);
  process.exit(1);
});


