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
  | "allpost:quotes"
  | "allpost:orders"
  | "precode:products"
  | "tray:products"
  | "anymarket:products"
  | "anymarket:orders"
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

  const RUN_LOCKS = new Map<string, boolean>();
  const requireRunToken = String(process.env.SCHEDULER_RUN_TOKEN ?? "").trim();

  const json = (res: http.ServerResponse, statusCode: number, body: unknown) => {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };

  const readJsonBody = async (req: http.IncomingMessage, maxBytes = 64_000): Promise<any> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += buf.length;
      if (total > maxBytes) throw new Error("Body muito grande.");
      chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.trim()) return {};
    return JSON.parse(text);
  };

  const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const SCRIPT_MAP: Record<
    string,
    Record<
      string,
      { scriptRel: string; buildArgs: (p: { companyId: number; startDate?: string; endDate?: string; onlyInsert?: boolean }) => string[] }
    >
  > = {
    tray: {
      orders: {
        scriptRel: "commands/tray/trayOrders.js",
        buildArgs: ({ companyId, startDate, endDate, onlyInsert }) => {
          const argv = [`--company=${companyId}`];
          if (startDate) argv.push(`--start-date=${startDate}`);
          if (endDate) argv.push(`--end-date=${endDate}`);
          if (onlyInsert) argv.push(`--onlyInsert`);
          return argv;
        },
      },
      products: {
        scriptRel: "commands/tray/trayProducts.js",
        buildArgs: ({ companyId }) => [`--company=${companyId}`],
      },
    },
    anymarket: {
      products: {
        scriptRel: "commands/anymarket/anymarketProducts.js",
        buildArgs: ({ companyId }) => [`--company=${companyId}`],
      },
      orders: {
        scriptRel: "commands/anymarket/anymarketOrders.js",
        buildArgs: ({ companyId, startDate, endDate, onlyInsert }) => {
          const argv = [`--company=${companyId}`];
          if (startDate) argv.push(`--start-date=${startDate}`);
          if (endDate) argv.push(`--end-date=${endDate}`);
          if (onlyInsert) argv.push(`--onlyInsert`);
          return argv;
        },
      },
    },
    precode: {
      orders: {
        scriptRel: "commands/precode/precodeOrders.js",
        buildArgs: ({ companyId, startDate, endDate, onlyInsert }) => {
          const argv = [`--company=${companyId}`];
          if (startDate) argv.push(`--start-date=${startDate}`);
          if (endDate) argv.push(`--end-date=${endDate}`);
          if (onlyInsert) argv.push(`--onlyInsert`);
          return argv;
        },
      },
      products: {
        scriptRel: "commands/precode/precodeProducts.js",
        buildArgs: ({ companyId }) => [`--company=${companyId}`],
      },
    },
    allpost: {
      quotes: {
        scriptRel: "commands/allpost/allpostFreightQuotes.js",
        buildArgs: ({ companyId }) => [`--company=${companyId}`],
      },
      orders: {
        scriptRel: "commands/allpost/allpostFreightOrders.js",
        buildArgs: ({ companyId, startDate, endDate }) => {
          // este script usa start/end em formato ISO-like (UTC). Se vierem YYYY-MM-DD, convertemos para o formato do script.
          // Aqui aceitamos passar como veio, assumindo que quem chama já manda no formato esperado.
          const argv = [`--company=${companyId}`];
          if (startDate) argv.push(`--start-date=${startDate}`);
          if (endDate) argv.push(`--end-date=${endDate}`);
          return argv;
        },
      },
    },
  };

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url || "/", "http://localhost");
    const pathname = (parsed.pathname || "/").replace(/\/+$/, "") || "/";
    if (pathname === "/health") return json(res, 200, { ok: true });

    if (pathname === "/version") {
      const { version, file } = readVersionFromScriptBi();
      if (!version) {
        return json(res, 404, { version: null, project: "run", error: "script-bi/version.txt não encontrado ou vazio", file });
      }
      return json(res, 200, { version, project: "run" });
    }

    if (pathname === "/run-script" && req.method === "POST") {
      (async () => {
        if (requireRunToken) {
          const got = String(req.headers["x-run-token"] ?? "").trim();
          if (got !== requireRunToken) return json(res, 401, { message: "Não autorizado." });
        }

        const body = await readJsonBody(req);
        const platform = String(body?.platform ?? "").trim();
        const script = String(body?.script ?? "").trim();
        const companyId = Number(body?.company_id ?? body?.companyId);
        const startDate = body?.start_date ? String(body.start_date).trim() : undefined;
        const endDate = body?.end_date ? String(body.end_date).trim() : undefined;
        const onlyInsert = Boolean(body?.only_insert ?? body?.onlyInsert);

        if (!platform || !SCRIPT_MAP[platform]) return json(res, 400, { message: "platform inválido." });
        if (!script || !SCRIPT_MAP[platform]?.[script]) return json(res, 400, { message: "script inválido." });
        if (!Number.isInteger(companyId) || companyId <= 0) return json(res, 400, { message: "company_id inválido." });
        if (startDate !== undefined && !isYmd(startDate)) return json(res, 400, { message: "start_date inválido (YYYY-MM-DD)." });
        if (endDate !== undefined && !isYmd(endDate)) return json(res, 400, { message: "end_date inválido (YYYY-MM-DD)." });

        const lockKey = `${platform}:${script}:${companyId}`;
        if (RUN_LOCKS.get(lockKey)) return json(res, 409, { message: "Já existe uma execução em andamento para esses parâmetros." });

        const { scriptRel, buildArgs } = SCRIPT_MAP[platform][script];
        const scriptPath = resolveDistScript(scriptRel);
        const params: { companyId: number; startDate?: string; endDate?: string; onlyInsert?: boolean } = {
          companyId,
          onlyInsert,
        };
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        const argv = buildArgs(params);
        const label = `forced platform=${platform} company=${companyId} script=${scriptRel}`;

        RUN_LOCKS.set(lockKey, true);
        const child = spawn(process.execPath, [scriptPath, ...argv], { stdio: "inherit", env: process.env });
        const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        console.log(`[scheduler] forçado iniciado run_id=${runId} ${label} argv=${argv.join(" ")}`);

        child.on("exit", (code) => {
          RUN_LOCKS.set(lockKey, false);
          console.log(`[scheduler] forçado finalizado run_id=${runId} exit_code=${code ?? "null"} ${label}`);
        });
        child.on("error", (err) => {
          RUN_LOCKS.set(lockKey, false);
          console.error(`[scheduler] forçado erro run_id=${runId} ${label}:`, err);
        });

        return json(res, 202, { ok: true, message: "script iniciado", run_id: runId, pid: child.pid ?? null });
      })().catch((err) => {
        console.error("[scheduler] /run-script erro:", err);
        return json(res, 500, { message: "Erro ao iniciar script.", error: String((err as any)?.message ?? err) });
      });
      return;
    }

    return json(res, 404, { message: "Not found" });
  });

  server.listen(port, () => {
    console.log(`[scheduler] HTTP server listening on :${port} (/health, /version, /run-script)`);
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

  const DEFAULT_CONCURRENCY = 5;
  const concurrencyRaw = process.env.SCHEDULER_COMPANY_CONCURRENCY;
  const concurrencyParsed = concurrencyRaw ? Number(concurrencyRaw) : DEFAULT_CONCURRENCY;
  const concurrency = Number.isInteger(concurrencyParsed) && concurrencyParsed > 0 ? concurrencyParsed : DEFAULT_CONCURRENCY;

  const scriptPath = resolveDistScript(scriptRel);

  const queue = ids.slice(); // já vem ordenado em listCompanyIdsForPlatformSlug
  const worker = async (workerIdx: number) => {
    while (!shuttingDown) {
      const companyId = queue.shift();
      if (!companyId) return;
      const label = `${platformSlug} company=${companyId} script=${scriptRel}`;
      console.log(`[scheduler] executando ${label} (worker=${workerIdx}/${concurrency})`);
      // Importante: se UMA company falhar, não deve interromper as demais.
      try {
        // eslint-disable-next-line no-await-in-loop
        await runNodeScript(scriptPath, makeArgs(companyId), label);
      } catch (err) {
        console.error(`[scheduler] erro ao executar ${label}:`, err);
      }
      // Espaça um pouco para evitar rajadas (especialmente em produção)
      // eslint-disable-next-line no-await-in-loop
      await sleep(250);
    }
  };

  const workerCount = Math.min(concurrency, ids.length);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
}

async function main() {
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

  // job: allpost freight quotes (a cada 30 min)
  const tickAllpost = () =>
    runJob("allpost:quotes", async () => {
      await runForCompanies("allpost", "commands/allpost/allpostFreightQuotes.js", (companyId) => [`--company=${companyId}`]);
    });

  // job: allpost freight orders (a cada 1h) — roda um range sobreposto (últimos 2 dias UTC) para capturar atualizações
  const tickAllpostFreightOrders = () =>
    runJob("allpost:orders", async () => {
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
  const tickAnymarketProducts = () =>
    runJob("anymarket:products", async () => {
      await runForCompanies("anymarket", "commands/anymarket/anymarketProducts.js", (companyId) => [`--company=${companyId}`]);
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
  const tickAnymarketOrders = () =>
    runJob("anymarket:orders", async () => {
      const end = formatYmdUtc(utcMidnight(new Date()));
      const start = formatYmdUtc(addDaysUtc(utcMidnight(new Date()), -1));
      await runForCompanies("anymarket", "commands/anymarket/anymarketOrders.js", (companyId) => [
        `--company=${companyId}`,
        `--start-date=${start}`,
        `--end-date=${end}`,
      ]);
    });

  console.log("[scheduler] iniciado.");
  console.log(
    "[scheduler] agendas: allpost-quotes=30min, allpost-freight-orders=1h, orders=30min, products=3h (precode/tray/anymarket)",
  );

  // roda na partida (com pequeno delay para evitar corrida com deploy)
  setTimeout(() => void tickAllpost(), 2_000);
  setTimeout(() => void tickAllpostFreightOrders(), 3_000);
  setTimeout(() => void tickPrecodeOrders(), 4_000);
  setTimeout(() => void tickTrayOrders(), 6_000);
  setTimeout(() => void tickPrecodeProducts(), 8_000);
  setTimeout(() => void tickTrayProducts(), 10_000);
  setTimeout(() => void tickAnymarketProducts(), 12_000);
  setTimeout(() => void tickAnymarketOrders(), 14_000);

  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => void tickAllpost(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickAllpostFreightOrders(), EVERY_1_HOUR));
  timers.push(setInterval(() => void tickPrecodeOrders(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickTrayOrders(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickAnymarketOrders(), EVERY_30_MIN));
  timers.push(setInterval(() => void tickPrecodeProducts(), EVERY_3_HOURS));
  timers.push(setInterval(() => void tickTrayProducts(), EVERY_3_HOURS));
  timers.push(setInterval(() => void tickAnymarketProducts(), EVERY_3_HOURS));

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


