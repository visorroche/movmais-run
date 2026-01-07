# Como rodar os comandos (jobs)

1. Instale as dependências:

```bash
npm install
```

2. Configure o arquivo `.env` com as variáveis do banco de dados PostgreSQL.
 - Você pode usar o arquivo `env.example` como base.

3. Execute os comandos (jobs) ou o scheduler.

### Scripts úteis

```bash
npm run build   # compila para ./dist
npm run start   # roda o scheduler (worker)
npm run dev:scheduler   # compila e roda o scheduler (dev)
```

### Rodando via Docker Compose

Na raiz do repositório:

```bash
docker compose up -d --build
```

Isso sobe:

- `postgres` (Postgres 16)
- `script-bi-scheduler` (worker que roda os jobs recorrentes)

Para logs:

```bash
docker compose logs -f script-bi-scheduler
```

### Scheduler (produção)

Para garantir execução recorrente em produção (5min/30min/3h) para **todas as companies cadastradas**, rode o scheduler como um **processo dedicado**:

- Ele consulta o banco para listar as companies que têm cada plataforma instalada (`company_platforms` + `platforms.slug`)
- E executa os scripts já compilados em `dist/commands/...` para cada company
- Possui trava por job para evitar sobreposição (se uma execução ainda estiver rodando, o tick é ignorado)

Execução:

```bash
npm run build
npm run start:scheduler
```

Recomendação em produção: rode o scheduler como **processo dedicado**. Exemplos comuns:

- PM2:

```bash
pm2 start dist/scheduler.js --name script-bi-scheduler
pm2 save
```

- systemd / Docker / Kubernetes: um serviço/worker separado rodando `node dist/scheduler.js`.

### Script Precode (pedidos)

Pré-requisito: a plataforma `precode` precisa estar cadastrada/instalada na company e o `config` da instalação deve conter `token`.

Execução (por padrão usa **ontem** como `start-date` e `end-date`; se enviar só `start-date`, ele usa a mesma data como `end-date`):

```bash
npm run script:precode:orders -- --company=1 --start-date=2025-01-01 --end-date=2025-12-30
```

### Script Precode (products)

Sincroniza o catálogo de produtos via:

- `GET /api/v1/produtoLoja/ListaProduto` (lista)
- `GET /api/v1/produtoLoja/ProdutoSku/{sku}` (detalhe por SKU, para completar cadastro)

Pré-requisito: a plataforma `precode` precisa estar cadastrada/instalada na company e o `config` da instalação deve conter `token` (Authorization Basic).

Execução:

```bash
npm run script:precode:products -- --company=1
```

### Script Tray (orders)

Pré-requisito: a plataforma `tray` precisa estar cadastrada/instalada na company e o `config` da instalação deve conter:

- `url` (base com `/web_api`)
- `code`
- `consumer_key`
- `consumer_secret`
- `access_token` é opcional (o script gera e persiste automaticamente em `company_platforms.config.access_token`)

Execução (por padrão usa **ontem** como `start-date` e `end-date`; se enviar só `start-date`, ele usa a mesma data como `end-date`):

```bash
npm run script:tray:orders -- --company=1 --start-date=2025-12-01 --end-date=2025-12-30
```

### Script Tray (products)

Sincroniza o catálogo de produtos via `GET /web_api/products` (paginado) e faz upsert em `products`.

Pré-requisito: a plataforma `tray` precisa estar cadastrada/instalada na company com o mesmo `config` do script de orders:

- `url` (base com `/web_api`)
- `code`
- `consumer_key`
- `consumer_secret`
- `access_token` é opcional (o script gera e persiste automaticamente)

Execução:

```bash
npm run script:tray:products -- --company=1
```

### Script AllPost (freight quotes)

Carrega cotações de frete via `GET https://www.allpost.com.br/api/v1/logCotacaoFila` (paginado com `limite=200`) e salva em:

- `freight_quotes`
- `freight_quotes_items`

Pré-requisito: a plataforma `allpost` precisa estar cadastrada/instalada na company e o `config` da instalação deve conter:

- `token_api` (Bearer) — principal
- `token_cotacao` (Bearer) — fallback

Execução:

```bash
npm run script:allpost:freight-quotes -- --company=1
```


