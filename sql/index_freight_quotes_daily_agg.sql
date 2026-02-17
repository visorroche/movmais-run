-- Índice para a rota simulations/daily: evita heap fetch (845k linhas) e sort em disco.
-- (quoted_at AT TIME ZONE 'UTC')::date é IMMUTABLE; quoted_at::date não é.
-- Execute e depois: VACUUM ANALYZE freight_quotes;
CREATE INDEX IF NOT EXISTS idx_freight_quotes_daily_agg
  ON freight_quotes (company_id, ((quoted_at AT TIME ZONE 'UTC')::date)) INCLUDE (quote_id)
  WHERE quoted_at IS NOT NULL;

-- Essencial para Index Only Scan: atualizar estatísticas e visibility map.
VACUUM ANALYZE freight_quotes;
