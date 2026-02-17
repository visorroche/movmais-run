-- Atualiza estatísticas das tabelas do dashboard de Simulações.
-- O planner do PostgreSQL usa essas estatísticas para decidir Index Scan vs Seq Scan.
-- Rode após criar índices ou quando as tabelas crescerem muito.
ANALYZE freight_quotes;
ANALYZE freight_quotes_items;
ANALYZE freight_quote_options;
ANALYZE freight_orders;
ANALYZE companies;
ANALYZE products;
