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
| iClinic token | iClinic | `iclinic:getToken` → `npm run script:iclinic:getToken` | **todo dia 01:00** (America/Sao_Paulo) | Playwright: login; grava `token` + `cookies` na config. Ver [iClinic](#iclinic-saas). |
| iClinic agenda | iClinic | `iclinic:getBookings` → `npm run script:iclinic:getBookings` | **todo dia 01:10** (America/Sao_Paulo) | Agenda do **dia anterior** por `representatives.external_id`. Backfill: `--start-date` / `--end-date`. Ver [iClinic](#iclinic-saas). |

### Variáveis de ambiente (mensagens recorrentes)

Na **API**: `RECURRENT_MESSAGES_CRON_TOKEN` (segredo compartilhado), `RECURRENT_MESSAGES_CRON_TZ`, `RECURRENT_MESSAGES_GREETING_TZ`. Opcional: **`RECURRENT_MESSAGES_MAX_CATCHUP_HOURS`** (padrão **24**) — após esse atraso em relação ao horário agendado pelo cron, o disparo não “recupera” mais a ocorrência perdida até a próxima janela. **`RECURRENT_MESSAGES_WINDOW_MINUTES`** ficou legado e não define mais o disparo (o scheduler do script-bi segue chamando o tick ~a cada 10 min).

No **script-bi** (scheduler ou comando manual): `MOVMAIS_API_URL` (URL base da API, sem barra final), `RECURRENT_MESSAGES_CRON_TOKEN` (igual ao da API).

Execução manual:

```bash
npm run script:recurrent-messages:tick
```

## Comandos para rodar manualmente

Obs.: para passar parâmetros (`--company`, `--start-date`, etc) via `npm run`, use `--` antes.

Integrações por plataforma (inclui **iClinic** `script:iclinic:getToken` / `script:iclinic:getBookings`): seção [Integrações (execução manual)](#integrações-execução-manual).

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

### iClinic (SaaS)

Plataforma `slug=iclinic`. Primeira execução: `npm install` e `npx playwright install chromium`.

| Comando npm | Job no scheduler | Arquivo | Entidades / destino |
|---|---|---|---|
| `script:iclinic:getToken` | `iclinic:getToken` (01:00 America/Sao_Paulo) | `src/commands/iclinic/getToken.ts` | `company_platforms.config`: `token`, `cookies`, `clinic_id`, etc. |
| `script:iclinic:getBookings` | `iclinic:getBookings` (01:10; após getToken) | `src/commands/iclinic/getBookings.ts` | `customers`, `products`, `orders`, `order_items`, `logs` |

Disparo manual via scheduler HTTP (`POST /run-script`): `platform=iclinic`, `script=getToken` ou `script=getBookings`, `company_id` obrigatório; para bookings opcional `start_date` (vira `--date=` no script).

**Config** (`company_platforms.config`): `email`, `password`, `token` (preenchido pelo getToken), `cookies`, `clinic_id` (opcional).

**Pré-requisitos:** representantes em `representatives` com `external_id` = `agenda_id` do iClinic e `active=true`. Pacientes (`customers`, `segmentation=iclinic_patient`): `representative_id` fixo se já atendido por agenda principal (`261948` Ornela, `267595` Maria Baracat); senão, último médico que atendeu. Pedidos: `customer` = paciente, `representative` = médico da agenda do evento.

```bash
cd script-bi
npm run script:iclinic:getToken -- --company=28
npm run script:iclinic:getBookings -- --company=28
```

**getToken** — parâmetros:

| Parâmetro | Obrigatório | Descrição |
|---|---|---|
| `--company=ID` | sim | Company com plataforma iclinic ativa |

**getBookings** — parâmetros:

| Parâmetro | Obrigatório | Descrição |
|---|---|---|
| `--company=ID` | sim | Company com plataforma iclinic ativa e token válido |
| `--date=YYYY-MM-DD` | não | Um dia (se omitido e sem intervalo: **ontem** em America/Sao_Paulo) |
| `--start-date=YYYY-MM-DD` | não* | Início do intervalo (inclusive); exige `--end-date` |
| `--end-date=YYYY-MM-DD` | não* | Fim do intervalo (inclusive); consulta **dia a dia** por representante |

\* Intervalo: a API é chamada uma vez por dia × cada `representatives.external_id`; o comando imprime progresso nos logs até concluir.

Se a sessão expirar durante o `getBookings`, o comando tenta **renovar o token automaticamente** (mesmo fluxo Playwright do `getToken`, 1× por execução), repete a agenda atual e segue. Se a renovação falhar ou a sessão continuar inválida, **interrompe** o restante do período (não fica consultando agenda por agenda com erro repetido).

```bash
# um dia
npm run script:iclinic:getBookings -- --company=28 --date=2026-05-19
# período (backfill)
npm run script:iclinic:getBookings -- --company=28 --start-date=2026-01-01 --end-date=2026-01-31
```

Variáveis opcionais: `ICLINIC_HEADLESS=false`, `DEBUG_ICLINIC=true`, `ICLINIC_CLINIC_ID`.

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

`freight_resume` agrega por **channel, state, freight_range, deadline_bucket, courier** (melhor opção) e **product_id** (`freight_quotes_items`, sem join em `products`). Cotação com vários produtos gera uma linha por `product_id`; valores de NF e pedido são rateados entre os itens da mesma cotação.

Após alterar a entidade, aplique no Postgres (ou `npm run script:sync-schema`):

```sql
ALTER TABLE freight_resume ADD COLUMN IF NOT EXISTS courier varchar(255) NOT NULL DEFAULT '';
ALTER TABLE freight_resume ADD COLUMN IF NOT EXISTS product_id int NULL;
ALTER TABLE freight_resume DROP COLUMN IF EXISTS sku;
```

Reprocesse com `npm run script:resume:freight -- --start-date=... --end-date=...` (uma query por **company_id** e dia; várias companies do mesmo dia em **paralelo**).

```bash
npm run script:resume:freight -- --start-date=2026-01-01 --end-date=2026-02-28
npm run script:resume:freight -- --company=28 --date=2026-01-02
```

Variáveis: `FREIGHT_RESUME_COMPANY_CONCURRENCY` (padrão **4**), `FREIGHT_RESUME_PAGE_SIZE` (padrão **2000** cotações por página), `FREIGHT_RESUME_STATEMENT_TIMEOUT_MS` (padrão 2 min por query). Agregação feita **em código** (paginação por company+dia); timeout em uma company não interrompe as demais.

Em FreightQuote nós selecionamos o best_deadline e o best_freight_cost baseado na melhor FreightQuoteOption disponivel,
a lógica para escolher a melhor opção é tentar ver se algum deles já tem o melhor preço e melhor deadline e se não tiver nenhuma opção
criarmos um score que analiza o menor score baseado na formula:
 ( (opção deadline / pelo menor deadline) + (opção custo / pelo menor custo) )

### Allpost
Existem dois campos valorFreteCobrado e valorFretePedido analisando alguns pedidos entendemos que o valor cobrado do cliente é valorFretePedido, por isso não estamos usando o campo valorFreteCobrado
o custo efetivo do frete usamos o campo valorFreteReal então o campo valorFreteCobrado foi ignorado.

