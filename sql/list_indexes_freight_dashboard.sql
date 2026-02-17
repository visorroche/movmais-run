-- Listar índices atuais nas tabelas usadas pelo dashboard de Simulações.
-- Execute no psql (ou cliente SQL) para conferir antes de rodar indexes_freight_dashboard.sql
-- e evitar índices duplicados ou conflitantes.
--
-- Uso psql: psql -U <user> -d <database> -f script-bi/sql/list_indexes_freight_dashboard.sql
-- Em DBeaver/outros: rode apenas a query única abaixo (comentários no final têm o resumo).

-- Query única: todos os índices das tabelas relevantes (funciona em qualquer cliente SQL)
SELECT
  tablename AS tabela,
  indexname AS indice,
  indexdef AS definicao
FROM pg_indexes
WHERE tablename IN (
  'freight_quotes',
  'freight_quotes_items',
  'freight_quote_options',
  'freight_orders',
  'companies',
  'products'
)
ORDER BY tablename, indexname;

-- Índices que indexes_freight_dashboard.sql cria (nomes para conferir conflito):
-- freight_quotes: idx_freight_quotes_company_quoted_at, idx_freight_quotes_daily_agg,
--   idx_freight_quotes_company_quoted_at_channel, idx_freight_quotes_destination_state_upper, idx_freight_quotes_quote_id
-- freight_quotes_items: idx_freight_quotes_items_quote_id, idx_freight_quotes_items_quote_id_product_id
-- freight_quote_options: idx_freight_quote_options_freight_quote_id
-- freight_orders: idx_freight_orders_quote_id, idx_freight_orders_company_order_date, idx_freight_orders_quote_id_company_id
-- companies: idx_companies_group_id
-- products: idx_products_sku
--
-- Conflito: se já existir um índice com o MESMO nome, o CREATE INDEX IF NOT EXISTS não faz nada (sem erro).
-- Duplicata de definição: se já existir outro nome mas mesma coluna/expressão, pode ser redundante;
--   aí você pode dropar o antigo ou não criar o novo, conforme preferir.
