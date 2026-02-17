-- Aumenta a amostra de estatísticas para company_id e quoted_at em freight_quotes.
-- Isso ajuda o planner a estimar melhor e pode fazer ele escolher Index Scan em vez de Seq Scan.
-- Execute após ANALYZE; depois rode ANALYZE freight_quotes de novo.
ALTER TABLE freight_quotes ALTER COLUMN company_id SET STATISTICS 1000;
ALTER TABLE freight_quotes ALTER COLUMN quoted_at SET STATISTICS 1000;
ANALYZE freight_quotes;
