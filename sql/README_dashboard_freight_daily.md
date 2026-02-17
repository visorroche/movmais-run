# Tabela de totais: dashboard_freight_daily

Tabela pré-agregada para o dashboard de Simulações. As rotas **daily**, **by-state** e **freight-scatter** passam a fazer apenas `SUM` + `GROUP BY` nesta tabela, em vez de consultar `freight_quotes` / `freight_quote_options` / `freight_orders`.

## Estrutura

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| company_id | integer | Empresa |
| date | date | Data (UTC) do quote |
| channel | varchar | Canal (vazio = '') |
| state | varchar(2) | UF (vazio = '') |
| freight_range | varchar | Faixa de frete (ex: 'R$0,00 (FREE)', 'entre R$ 0,01 e R$ 100,00', …) |
| deadline_bucket | varchar | Bucket de prazo ('>0', '>5', …) |
| total_simulations | int | Qtde de cotações (quote_id) nesse bucket |
| total_orders | int | Qtde dessas cotações que viraram pedido |
| total_value_simulations | numeric | Soma de invoice_value das cotações |
| total_value_orders | numeric | Soma de freight_amount dos pedidos |

**Chave primária:** (company_id, date, channel, state, freight_range, deadline_bucket).

Incluímos **freight_range** e **deadline_bucket** no grão para que a **mesma tabela** atenda:

- **Daily:** `SUM(total_simulations), SUM(total_orders)` agrupado por `date` (filtrar por company_id, channel, state).
- **By-state:** `SUM(...)` agrupado por `state`.
- **Scatter:** `SUM(...)` agrupado por `freight_range`, `deadline_bucket`.

## Refresh

1. Criar a tabela (uma vez):  
   `psql ... -f create_dashboard_freight_daily.sql`
2. Atualizar os totais (período desejado):  
   Editar em `refresh_dashboard_freight_daily.sql` as datas no `DELETE` e no `BETWEEN` do CTE e rodar o script.  
   Ou agendar um job (cron/script-bi) que rode o refresh para “ontem” ou últimos N dias.

O refresh pode ser pesado (mesma lógica das queries atuais); rode em horário de baixo uso ou em batch noturno.

## Uso na API

- **daily:**  
  `SELECT date, SUM(total_simulations) AS sims, SUM(total_orders) AS orders FROM dashboard_freight_daily WHERE company_id = ANY($1) AND date BETWEEN $2 AND $3 AND channel = ANY($channels) AND state = ANY($states) GROUP BY date ORDER BY date`
- **by-state:**  
  `SELECT state, SUM(total_simulations), SUM(total_orders) FROM ... WHERE ... GROUP BY state`
- **freight-scatter:**  
  `SELECT freight_range AS range_value, deadline_bucket AS range_deadline, SUM(total_simulations) AS total, SUM(total_orders) AS orders, ... FROM ... WHERE ... GROUP BY freight_range, deadline_bucket ORDER BY total DESC LIMIT 800`

Quando o usuário **não** filtra por SKU, use essas queries na tabela. Quando filtrar por **SKU**, continue usando a query “ao vivo” em `freight_quotes` / `freight_quotes_items` (a tabela não tem grão por produto).

## Possíveis extensões

- **store_name:** se precisar filtrar por loja no grupo, dá para incluir `store_name` (ou `company_id` da loja) no grão e no refresh; o número de linhas por dia aumenta.
- **Grupo:** hoje filtramos por `company_id = ANY($list)`. Se o usuário está em um grupo, a API já passa a lista de company_ids; a tabela não precisa de `group_id`.
- **SKU:** para servir filtro por SKU a partir de agregados, seria necessário outra tabela (grão com product_id/sku), bem maior; normalmente o fallback para a query ao vivo é aceitável.
