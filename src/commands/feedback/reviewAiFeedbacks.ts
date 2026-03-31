import "dotenv/config";
import "reflect-metadata";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { AppDataSource } from "../../utils/data-source.js";
import { AiAgentFeedback } from "../../entities/AiAgentFeedback.js";
import { ThreadMessages } from "../../entities/ThreadMessages.js";
import { Threads } from "../../entities/Threads.js";

type Args = {
  feedbackId?: number;
  limit: number;
  dryRun: boolean;
  codexCommand: string;
  timeoutMs: number;
};

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type ContextBundle = {
  feedback: AiAgentFeedback;
  thread: Threads;
  targetMessage: ThreadMessages;
  history: ThreadMessages[];
  prompt: string;
};

const DEFAULT_CODEX_COMMAND = process.env.FEEDBACK_CODEX_COMMAND?.trim() || "codex exec";
const DEFAULT_TIMEOUT_MS = Number(process.env.FEEDBACK_CODEX_TIMEOUT_MS ?? 20 * 60 * 1000);

function parseArgs(argv: string[]): Args {
  const kv = new Map<string, string>();
  let dryRun = false;
  for (const raw of argv) {
    if (raw === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!raw.startsWith("--")) continue;
    const [k, ...rest] = raw.slice(2).split("=");
    if (!k) continue;
    kv.set(k, rest.join("="));
  }

  const feedbackIdRaw = kv.get("feedback-id");
  const feedbackId = feedbackIdRaw ? Number(feedbackIdRaw) : undefined;
  if (feedbackIdRaw && (!Number.isInteger(feedbackId) || (feedbackId ?? 0) <= 0)) {
    throw new Error("Parâmetro inválido: --feedback-id deve ser inteiro positivo.");
  }

  const limitRaw = Number(kv.get("limit") ?? 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : 10;

  const codexCommand = (kv.get("codex-command") ?? DEFAULT_CODEX_COMMAND).trim();
  if (!codexCommand) throw new Error("codex-command inválido.");

  const timeoutRaw = Number(kv.get("timeout-ms") ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.trunc(timeoutRaw) : DEFAULT_TIMEOUT_MS;

  return {
    ...(feedbackId != null ? { feedbackId } : {}),
    limit,
    dryRun,
    codexCommand,
    timeoutMs,
  };
}

function getRoots() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const scriptBiRoot = path.resolve(__dirname, "../../../");
  const workspaceRoot = path.resolve(scriptBiRoot, "..");
  const apiRoot = path.resolve(workspaceRoot, "api");
  const frontRoot = path.resolve(workspaceRoot, "front");
  return { scriptBiRoot, workspaceRoot, apiRoot, frontRoot };
}

async function execShell(command: string, cwd: string, timeoutMs: number, stdinText?: string): Promise<ExecResult> {
  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn("sh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Timeout ao executar comando (${timeoutMs}ms): ${command}`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (stdinText != null) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

function sanitizeBranch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .slice(0, 80);
}

async function ensureRepoClean(repoPath: string): Promise<void> {
  const r = await execShell("git status --porcelain", repoPath, 20_000);
  if (r.code !== 0) {
    throw new Error(`Falha ao verificar status git em ${repoPath}: ${r.stderr || r.stdout}`);
  }
  if (r.stdout.trim()) {
    throw new Error(`Repositório sujo em ${repoPath}. Commit/stash antes de rodar o comando.`);
  }
}

async function hasChanges(repoPath: string): Promise<boolean> {
  const r = await execShell("git status --porcelain", repoPath, 20_000);
  if (r.code !== 0) throw new Error(`Falha git status em ${repoPath}: ${r.stderr || r.stdout}`);
  return r.stdout.trim().length > 0;
}

async function hasStagedChanges(repoPath: string): Promise<boolean> {
  const r = await execShell("git diff --cached --name-only", repoPath, 20_000);
  if (r.code !== 0) throw new Error(`Falha git diff --cached em ${repoPath}: ${r.stderr || r.stdout}`);
  return r.stdout.trim().length > 0;
}

async function existingPrUrl(repoPath: string, branch: string): Promise<string | null> {
  const cmd = `gh pr list --head "${branch}" --json url --limit 1`;
  const r = await execShell(cmd, repoPath, 30_000);
  if (r.code !== 0) return null;
  try {
    const rows = JSON.parse(r.stdout) as Array<{ url?: string }>;
    const url = rows[0]?.url;
    return typeof url === "string" && url.trim() ? url : null;
  } catch {
    return null;
  }
}

function snippet(s: string, max = 1200): string {
  const v = String(s ?? "");
  if (v.length <= max) return v;
  return `${v.slice(0, max)}\n... (truncado)`;
}

function feedbackPrompt(bundle: ContextBundle): string {
  const feedbackText = bundle.feedback.feedback;
  const context = bundle.feedback.context;
  const history = bundle.history
    .map((m) => {
      if (m.message_input != null) {
        return `[USER][msg_id=${m.id}]\n${m.message_input}`;
      }
      return `[ASSISTANT][msg_id=${m.id}]\n${m.message_output ?? ""}`;
    })
    .join("\n\n---\n\n");

  const targetLayout = bundle.targetMessage.json_object ?? null;
  const targetLayoutJson = JSON.stringify(targetLayout, null, 2);

  if (context === "insights") {
    return `
Você está revisando um feedback real de cliente sobre o assistente de Insights (chat com dados, sem layout de dashboard).

OBJETIVO:
- Melhorar o comportamento do agente para reduzir recorrência desse tipo de erro.
- Priorizar alterações em prompts:
  1) api/src/prompt/insights/insightsPlanner.md
  2) api/src/prompt/insights/insightsQuerySql.md
  3) api/src/prompt/insights/insightsFinal.md
  4) api/src/prompt/insights/insightsTitle.md
- Só em último caso, alterar código:
  - api/src/dashboard/insights-chat.service.ts
  - api/src/dashboard/insights-executor.ts

RESTRIÇÕES:
- Não editar arquivos fora de api/ e front/.
- Não alterar script-bi/.
- Faça mudanças mínimas e direcionadas ao feedback.

DADOS DO FEEDBACK:
- feedback_id: ${bundle.feedback.id}
- context: ${context}
- thread_id: ${bundle.feedback.thread_id}
- thread_message_id: ${bundle.feedback.thread_message_id}
- user_id: ${bundle.feedback.user_id}
- feedback:
${feedbackText}

HISTÓRICO DA THREAD (ATÉ A MENSAGEM ALVO):
${history}

JSON ANEXADO À MENSAGEM ALVO (geralmente null em Insights):
${targetLayoutJson}

TAREFAS:
1) Identifique causa provável da resposta inadequada.
2) Aplique as correções em prompts/código do fluxo Insights.
3) No final, descreva brevemente o que alterou e por quê.
`.trim();
  }

  return `
Você está revisando um feedback real de cliente sobre o agente de IA que constrói dashboards customizados.

OBJETIVO:
- Melhorar o comportamento do agente para reduzir recorrência desse tipo de erro.
- Priorizar alterações em prompts:
  1) api/src/prompt/customDashboard/customDashboard.md
  2) api/src/prompt/customDashboard/customDashboardPlanner.md
  3) api/src/prompt/customDashboard/customDashboardFixQueries.md
  4) api/src/prompt/customDashboard/customDashboardFixLayout.md
- Só em último caso, alterar código:
  - api/src/dashboard/dashboard.service.ts
  - api/src/dashboard/layout-schema.ts
  - front/src/pages/dashboard/CustomDashboardView.tsx

RESTRIÇÕES:
- Não editar arquivos fora de api/ e front/.
- Não alterar script-bi/.
- Faça mudanças mínimas e direcionadas ao feedback.

DADOS DO FEEDBACK:
- feedback_id: ${bundle.feedback.id}
- context: ${context}
- thread_id: ${bundle.feedback.thread_id}
- thread_message_id: ${bundle.feedback.thread_message_id}
- user_id: ${bundle.feedback.user_id}
- feedback:
${feedbackText}

HISTÓRICO DA THREAD (ATÉ A MENSAGEM ALVO):
${history}

JSON DE OUTPUT DA MENSAGEM ALVO:
${targetLayoutJson}

TAREFAS:
1) Identifique causa provável da resposta inadequada.
2) Aplique as correções em prompts/código.
3) Garanta consistência com o schema/layout esperado.
4) No final, descreva brevemente o que alterou e por quê.
`.trim();
}

async function buildContext(feedback: AiAgentFeedback): Promise<ContextBundle> {
  const threadRepo = AppDataSource.getRepository(Threads);
  const msgRepo = AppDataSource.getRepository(ThreadMessages);

  const thread = await threadRepo.findOne({ where: { id: feedback.thread_id } as any });
  if (!thread) throw new Error(`Thread ${feedback.thread_id} não encontrada para feedback ${feedback.id}`);

  const targetMessage = await msgRepo.findOne({ where: { id: feedback.thread_message_id, thread_id: feedback.thread_id } as any });
  if (!targetMessage) {
    throw new Error(`Mensagem ${feedback.thread_message_id} não encontrada na thread ${feedback.thread_id}`);
  }
  const history = await msgRepo
    .createQueryBuilder("m")
    .where("m.thread_id = :threadId", { threadId: feedback.thread_id })
    .andWhere("m.id <= :targetMessageId", { targetMessageId: feedback.thread_message_id })
    .orderBy("m.id", "ASC")
    .getMany();

  const bundle: ContextBundle = {
    feedback,
    thread,
    targetMessage,
    history,
    prompt: "",
  };
  bundle.prompt = feedbackPrompt(bundle);
  return bundle;
}

async function runCodex(
  prompt: string,
  workspaceRoot: string,
  codexCommand: string,
  timeoutMs: number,
): Promise<ExecResult> {
  return await execShell(codexCommand, workspaceRoot, timeoutMs, `${prompt}\n`);
}

async function ensureBranch(repoPath: string, branchName: string): Promise<void> {
  const check = await execShell(`git rev-parse --verify "${branchName}"`, repoPath, 20_000);
  if (check.code === 0) {
    const checkout = await execShell(`git checkout "${branchName}"`, repoPath, 20_000);
    if (checkout.code !== 0) throw new Error(`Falha ao trocar para branch ${branchName}: ${checkout.stderr || checkout.stdout}`);
    return;
  }
  const create = await execShell(`git checkout -b "${branchName}"`, repoPath, 20_000);
  if (create.code !== 0) throw new Error(`Falha ao criar branch ${branchName}: ${create.stderr || create.stdout}`);
}

async function validateRepoBuild(repoPath: string): Promise<void> {
  const r = await execShell("npm run build", repoPath, 15 * 60 * 1000);
  if (r.code !== 0) {
    throw new Error(`Build falhou em ${repoPath}\n${snippet(r.stdout)}\n${snippet(r.stderr)}`);
  }
}

async function commitAndPr(
  repoPath: string,
  feedbackId: number,
  branchName: string,
  dryRun: boolean,
): Promise<string | null> {
  const existing = await existingPrUrl(repoPath, branchName);
  if (existing) return existing;

  await ensureBranch(repoPath, branchName);
  await validateRepoBuild(repoPath);

  const add = await execShell("git add .", repoPath, 20_000);
  if (add.code !== 0) throw new Error(`Falha no git add em ${repoPath}: ${add.stderr || add.stdout}`);
  if (!(await hasStagedChanges(repoPath))) return null;

  const commitMsg = `FEEDBACK ID: ${feedbackId}\n\nImprove custom dashboard AI behavior based on user feedback.`;
  const commitCmd = `git commit -m "$(cat <<'EOF'\n${commitMsg}\nEOF\n)"`;
  if (dryRun) {
    console.log(`[feedback-review] DRY RUN: commit/PR pulados em ${repoPath}`);
    return null;
  }

  const commit = await execShell(commitCmd, repoPath, 60_000);
  if (commit.code !== 0) {
    throw new Error(`Falha no commit em ${repoPath}: ${commit.stderr || commit.stdout}`);
  }

  const push = await execShell(`git push -u origin "${branchName}"`, repoPath, 120_000);
  if (push.code !== 0) throw new Error(`Falha no push em ${repoPath}: ${push.stderr || push.stdout}`);

  const prBody = [
    "## Summary",
    `- Automação gerada a partir do feedback ${feedbackId}.`,
    "- Ajustes para melhorar a qualidade das respostas de dashboard customizado.",
    "",
    "## Validation",
    "- `npm run build`",
  ].join("\n");
  const create = await execShell(
    `gh pr create --title "FEEDBACK ID: ${feedbackId}" --body "${prBody.replace(/"/g, '\\"')}" --head "${branchName}"`,
    repoPath,
    120_000,
  );
  if (create.code !== 0) {
    const url = await existingPrUrl(repoPath, branchName);
    if (url) return url;
    throw new Error(`Falha ao abrir PR em ${repoPath}: ${create.stderr || create.stdout}`);
  }
  const url = create.stdout
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith("http"));
  return url ?? (await existingPrUrl(repoPath, branchName));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { scriptBiRoot, workspaceRoot, apiRoot, frontRoot } = getRoots();

  await AppDataSource.initialize();
  try {
    const feedbackRepo = AppDataSource.getRepository(AiAgentFeedback);

    const qb = feedbackRepo.createQueryBuilder("f").where("f.analyzed = false").orderBy("f.id", "ASC").limit(args.limit);
    if (args.feedbackId != null) qb.andWhere("f.id = :feedbackId", { feedbackId: args.feedbackId });
    const feedbacks = await qb.getMany();

    if (feedbacks.length === 0) {
      console.log("[feedback-review] Nenhum feedback pendente encontrado.");
      return;
    }

    await ensureRepoClean(apiRoot);
    await ensureRepoClean(frontRoot);

    const artifactsDir = path.resolve(scriptBiRoot, "tmp", "feedback-review");
    await fs.mkdir(artifactsDir, { recursive: true });

    for (const feedback of feedbacks) {
      console.log(`[feedback-review] Processando feedback ${feedback.id}...`);

      const ctx = await buildContext(feedback);
      const promptPath = path.resolve(artifactsDir, `feedback-${feedback.id}-prompt.md`);
      await fs.writeFile(promptPath, ctx.prompt, "utf8");

      const codex = await runCodex(ctx.prompt, workspaceRoot, args.codexCommand, args.timeoutMs);
      const codexLogPath = path.resolve(artifactsDir, `feedback-${feedback.id}-codex.log`);
      await fs.writeFile(
        codexLogPath,
        [`exit_code=${codex.code}`, "STDOUT:", codex.stdout, "", "STDERR:", codex.stderr].join("\n"),
        "utf8",
      );
      if (codex.code !== 0) {
        throw new Error(
          `[feedback-review] Codex falhou no feedback ${feedback.id}\n${snippet(codex.stdout)}\n${snippet(codex.stderr)}`,
        );
      }

      const apiChanged = await hasChanges(apiRoot);
      const frontChanged = await hasChanges(frontRoot);
      if (!apiChanged && !frontChanged) {
        console.log(`[feedback-review] Feedback ${feedback.id} não gerou mudanças em api/front; mantendo analyzed=false.`);
        continue;
      }

      const branch = sanitizeBranch(`feedback/${feedback.id}-ai-dashboard`);
      const prUrls: string[] = [];
      if (apiChanged) {
        const prApi = await commitAndPr(apiRoot, feedback.id, branch, args.dryRun);
        if (prApi) prUrls.push(prApi);
      }
      if (frontChanged) {
        const prFront = await commitAndPr(frontRoot, feedback.id, branch, args.dryRun);
        if (prFront) prUrls.push(prFront);
      }

      if (!args.dryRun && prUrls.length > 0) {
        feedback.analyzed = true;
        await feedbackRepo.save(feedback);
        console.log(`[feedback-review] Feedback ${feedback.id} marcado como analyzed=true. PR(s): ${prUrls.join(" | ")}`);
      } else {
        console.log(
          `[feedback-review] Feedback ${feedback.id} processado sem marcação analyzed (dry-run ou PR ausente).`,
        );
      }
    }
  } finally {
    await AppDataSource.destroy().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[feedback-review] erro:", err);
  process.exit(1);
});
