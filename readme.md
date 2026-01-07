# Como rodar o serviço

1. Instale as dependências:

```bash
npm install
```

2. Configure o arquivo `.env` com as variáveis do banco de dados PostgreSQL.
 - Você pode usar o arquivo `env.example` como base.

3. Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

O serviço ficará disponível na porta definida pela variável `PORT` no `.env` (padrão: 3000).

### Scripts úteis

```bash
npm run build   # compila para ./dist
npm run start   # roda ./dist com Node
```

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


