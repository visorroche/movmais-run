/**
 * Dispara o processamento de mensagens recorrentes na API (Insights / Z-API).
 * Variáveis: MOVMAIS_API_URL (ex.: https://api.exemplo.com), RECURRENT_MESSAGES_CRON_TOKEN (mesmo valor na API).
 * Carrega `script-bi/.env` como os demais comandos (dotenv).
 */
import "dotenv/config";

async function main(): Promise<void> {
  const base = String(process.env.MOVMAIS_API_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(process.env.RECURRENT_MESSAGES_CRON_TOKEN ?? "").trim();
  if (!base || !token) {
    console.error(
      "[recurrent-messages:tick] Defina MOVMAIS_API_URL e RECURRENT_MESSAGES_CRON_TOKEN.",
    );
    process.exit(1);
  }

  const url = `${base}/internal/recurrent-messages/tick`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // mantém texto bruto
  }

  console.log(
    `[recurrent-messages:tick] status=${res.status}`,
    typeof body === "object" && body !== null ? JSON.stringify(body) : text.slice(0, 4000),
  );

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[recurrent-messages:tick] erro:", err);
  process.exit(1);
});
