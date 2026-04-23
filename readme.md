# script-bi — Scheduler

Este projeto roda jobs em **intervalos fixos** (não é agendado por horário do dia tipo “11h”). Abaixo está a agenda atual conforme `script-bi/src/scheduler.ts`.

| Tipo | Plataforma | Job (interno) | Frequência | Observações |
|---|---|---|---|---|
| Mensagens recorrentes (IA / WhatsApp) | API Movmais | `recurrent-messages:tick` | **a cada 10 min** | Chama `POST {MOVMAIS_API_URL}/internal/recurrent-messages/tick` com Bearer. Ver envs abaixo. |
| Freight Quotes | Allpost | `allpost:quotes` | **a cada 1 hora** | Roda na inicialização após ~2s. Mesmo intervalo que freight orders. |
| Freight Orders | Allpost | `allpost:orders` | **a cada 1 hora** | Roda na inicialização após ~3s. Range sobreposto (**últimos 2 dias UTC**) para capturar atualizações. |
| Orders | Precode | `precode:orders` | **a cada 30 min** | Roda na inicialização após ~4s. Range curto (**ontem..hoje UTC**) |
| Orders | Tray | `tray:orders` | **a cada 30 min** | Roda na inicialização após ~6s. Range curto (**ontem..hoje UTC**) |
| Orders | AnyMarket | `anymarket:orders` | **a cada 30 min** | Roda na inicialização (após ~14s). Range curto (**ontem..hoje UTC**) + 2 passes (created/updated). |
| Products | Precode | `precode:products` | **a cada 3 horas** | Roda na inicialização (após ~8s). |
| Products | Tray | `tray:products` | **a cada 3 horas** | Roda na inicialização (após ~10s). |
| Products | AnyMarket | `anymarket:products` | **a cada 3 horas** | Roda na inicialização (após ~12s). Config: `{"token":"..."}` |
| Database B2B | Database | `databaseB2b:*` | **a cada 1 hora** | Roda na inicialização. Usa config em `company_platforms.config`. |

### Variáveis de ambiente (mensagens recorrentes)

Na **API**: `RECURRENT_MESSAGES_CRON_TOKEN` (segredo compartilhado), `RECURRENT_MESSAGES_CRON_TZ`, `RECURRENT_MESSAGES_GREETING_TZ`. Opcional: **`RECURRENT_MESSAGES_MAX_CATCHUP_HOURS`** (padrão **24**) — após esse atraso em relação ao horário agendado pelo cron, o disparo não “recupera” mais a ocorrência perdida até a próxima janela. **`RECURRENT_MESSAGES_WINDOW_MINUTES`** ficou legado e não define mais o disparo (o scheduler do script-bi segue chamando o tick ~a cada 10 min).

No **script-bi** (scheduler ou comando manual): `MOVMAIS_API_URL` (URL base da API, sem barra final), `RECURRENT_MESSAGES_CRON_TOKEN` (igual ao da API).

Execução manual:

```bash
npm run script:recurrent-messages:tick
```

## Comandos para rodar manualmente

Obs.: para passar parâmetros (`--company`, `--start-date`, etc) via `npm run`, use `--` antes.

### Mensagens recorrentes (tick na API)

Mesmas variáveis da tabela acima: `MOVMAIS_API_URL`, `RECURRENT_MESSAGES_CRON_TOKEN` (igual ao `.env` da API).

O comando carrega automaticamente **`script-bi/.env`** (via `dotenv`). Rode sempre a partir da pasta `script-bi` para o `.env` local ser encontrado.

```bash
cd script-bi
npm run script:recurrent-messages:tick
```

Equivalente HTTP (substitua URL e token):

```bash
curl -sS -X POST "${MOVMAIS_API_URL}/internal/recurrent-messages/tick" \
  -H "Authorization: Bearer ${RECURRENT_MESSAGES_CRON_TOKEN}" \
  -H "Content-Type: application/json"
```

A API responde JSON com `ok`, `rulesChecked`, `messagesSent`, `errors`, etc.

## Atualizando o banco de dados

Verifica alterações:

```bash
npm run schema:log
```

Aplica alterações:

```bash
npm run script:sync-schema
```

### Resumo do schema (para a IA)

Gera um arquivo Markdown com a estrutura das tabelas e colunas a partir das entidades em `src/entities/`. O arquivo é salvo em `api/src/prompt/schema-resume.md` e é usado pela API nos prompts da IA que montam queries de dashboards customizados, para que a IA use apenas tabelas e campos existentes.

Entidades que não devem entrar no resumo (ex.: tabelas de sistema) ficam em `SKIP_ENTITIES` em `src/commands/schemaResumeMd.ts`. Rode após alterar entidades para atualizar o schema enviado à IA.

```bash
npm run schema:resume-md
```

### Dados de teste (fake)

Gera dados sintéticos para uma **company** no intervalo `--start-date`..`--end-date` (UTC): produtos, clientes, pedidos e itens (com nomes/valores aleatórios). Implementação em `src/commands/fake/fakeCompanyData.ts`.

É obrigatório escolher **um** modo:

- **`--marketplace`**: pedidos com canal marketplace e metadados de comissão.
- **`--representante`**: pedidos ligados a representantes (garante estrutura de supervisores/representantes fake).

```bash
npm run script:fake:company-data -- --company=1 --start-date=2026-01-01 --end-date=2026-01-31 --marketplace
npm run script:fake:company-data -- --company=1 --start-date=2026-01-01 --end-date=2026-01-31 --representante
```

O **`--`** depois do nome do script é obrigatório para o npm repassar os parâmetros ao Node. Sem isso, `--company` não chega ao comando. Não use vírgulas nos valores (`--company=2` e não `--company=2,`).

Use apenas em ambiente de desenvolvimento / base de testes.

## Integrações (execução manual)

### Precode

```bash
npm run script:precode:products -- --company=1
npm run script:precode:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04
```

### Tray

```bash
npm run script:tray:products -- --company=1
npm run script:tray:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04
```

### AnyMarket

```bash
npm run script:anymarket:products -- --company=1
npm run script:anymarket:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04
```

No comando de pedidos, `--force` repopula os itens a partir da API para todos os pedidos do período: remove os `order_items` atuais e recria com os dados da AnyMarket (útil para corrigir itens faltando ou desatualizados).

```bash
npm run script:anymarket:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04 --force
```

### Panorama

Plataforma `slug=panorama` (e-commerce). Config em `company_platforms.config`: `url` (base até `/v1`), `user` e `token` (Basic Auth: usuário + senha/token). Sincroniza pedidos via `GET /pedido` (paginado); produtos são criados ou encontrados por SKU a partir dos itens do pedido.

```bash
npm run script:panorama:orders -- --company=1 --start-date=2026-03-01 --end-date=2026-03-30
```

Opcional: `--onlyInsert` para pular pedidos que já existem (mesmo `order_code`).

```bash
npm run script:panorama:orders -- --company=1 --start-date=2026-03-01 --end-date=2026-03-30 --onlyInsert
```

### Revisão automática de feedbacks (IA dashboard)

Processa feedbacks pendentes (`ai_agent_feedbacks.analyzed=false`), monta contexto da conversa até a mensagem alvo, chama o Codex CLI para aplicar melhorias em `api/` e `front/`, valida build, cria commit/PR (1 por feedback) e marca `analyzed=true` quando a PR é criada.

```bash
npm run script:feedback:review-ai
```

Parâmetros:

- `--feedback-id=123` processa apenas um feedback.
- `--limit=10` limita quantos feedbacks pendentes serão processados.
- `--dry-run` executa revisão sem commit/push/PR e sem marcar `analyzed`.
- `--codex-command="codex exec"` sobrescreve o comando usado para chamar o Codex CLI.
- `--timeout-ms=1200000` timeout por execução do Codex (padrão: 20 min).

Variáveis de ambiente opcionais:

- `FEEDBACK_CODEX_COMMAND` comando padrão do Codex CLI (fallback para `codex exec`).
- `FEEDBACK_CODEX_TIMEOUT_MS` timeout padrão em ms.

### Database B2B

Executa 1 comando por entidade e aplica os tratamentos configurados no mapeamento (ex.: `mapear_valores`, `limpeza_regex`, `concatenar_campos`, `usar_um_ou_outro`, `mapear_json`).

```bash
npm run script:databaseb2b:representatives -- --company=1
npm run script:databaseb2b:customers-groups -- --company=1
npm run script:databaseb2b:customers -- --company=1
npm run script:databaseb2b:products -- --company=1
npm run script:databaseb2b:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04
```

Opcional (apenas inserir, não atualizar pedidos já existentes):

```bash
npm run script:databaseb2b:orders -- --company=1 --start-date=2026-02-01 --end-date=2026-02-04 --onlyInsert
```

## Regras de Negócio Freight
O campo invoice_value em FreightOrder e FreightQuote não soma o valor do frete são só os valores dos produtos

Em FreightQuote nós selecionamos o best_deadline e o best_freight_cost baseado na melhor FreightQuoteOption disponivel,
a lógica para escolher a melhor opção é tentar ver se algum deles já tem o melhor preço e melhor deadline e se não tiver nenhuma opção
criarmos um score que analiza o menor score baseado na formula:
 ( (opção deadline / pelo menor deadline) + (opção custo / pelo menor custo) )

### Allpost
Existem dois campos valorFreteCobrado e valorFretePedido analisando alguns pedidos entendemos que o valor cobrado do cliente é valorFretePedido, por isso não estamos usando o campo valorFreteCobrado
o custo efetivo do frete usamos o campo valorFreteReal então o campo valorFreteCobrado foi ignorado.

