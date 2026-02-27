# script-bi — Scheduler

Este projeto roda jobs em **intervalos fixos** (não é agendado por horário do dia tipo “11h”). Abaixo está a agenda atual conforme `script-bi/src/scheduler.ts`.

| Tipo | Plataforma | Job (interno) | Frequência | Observações |
|---|---|---|---|---|
| Freight Quotes | Allpost | `allpost:quotes` | **a cada 30 min** | Roda na inicialização após ~2s. |
| Freight Orders | Allpost | `allpost:orders` | **a cada 1 hora** | Roda na inicialização após ~3s. Range sobreposto (**últimos 2 dias UTC**) para capturar atualizações. |
| Orders | Precode | `precode:orders` | **a cada 30 min** | Roda na inicialização após ~4s. Range curto (**ontem..hoje UTC**) |
| Orders | Tray | `tray:orders` | **a cada 30 min** | Roda na inicialização após ~6s. Range curto (**ontem..hoje UTC**) |
| Orders | AnyMarket | `anymarket:orders` | **a cada 30 min** | Roda na inicialização (após ~14s). Range curto (**ontem..hoje UTC**) + 2 passes (created/updated). |
| Products | Precode | `precode:products` | **a cada 3 horas** | Roda na inicialização (após ~8s). |
| Products | Tray | `tray:products` | **a cada 3 horas** | Roda na inicialização (após ~10s). |
| Products | AnyMarket | `anymarket:products` | **a cada 3 horas** | Roda na inicialização (após ~12s). Config: `{"token":"..."}` |
| Database B2B | Database | `databaseB2b:*` | **a cada 1 hora** | Roda na inicialização. Usa config em `company_platforms.config`. |

## Comandos para rodar manualmente

Obs.: para passar parâmetros (`--company`, `--start-date`, etc) via `npm run`, use `--` antes.

## Atualizando o banco de dados

Verifica alterações:

```bash
npm run schema:log
```

Aplica alterações:

```bash
npm run script:sync-schema
```

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

