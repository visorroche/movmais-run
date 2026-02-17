-- =============================================================================
-- EXPLAIN das queries do dashboard de Simulações
-- =============================================================================
-- TIMEOUT: as queries com 15 dias podem demorar 1 min+. Para não dar timeout:
--   - Use EXPLAIN (sem ANALYZE) = plano em segundos, mas sem "actual time" nem "Execution Time".
--   - Ou use período curto (2–3 dias) no EXPLAIN ANALYZE (troque as datas abaixo).
--
-- ANTES DE RODAR:
-- 1. Troque company_id (ex: 5) e as datas pelos seus valores.
-- 2. Para EXPLAIN ANALYZE com período longo, aumente o timeout do cliente (ex: DBeaver 300s).
--
-- O QUE OBSERVAR:
-- - "Index Scan using idx_..." = bom. "Seq Scan" em tabela grande = ruim.
-- - Com ANALYZE: "actual time", "Execution Time" e "Buffers: read" = I/O real.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) simulations/daily
--    EXPLAIN sem ANALYZE = rápido (só mostra o plano, não executa até o fim).
--    Para tempo real: troque para EXPLAIN (ANALYZE, BUFFERS) e use 2–3 dias (ex: '2026-02-01' até '2026-02-03').
-- -----------------------------------------------------------------------------
SET enable_seqscan = off;

EXPLAIN (BUFFERS, FORMAT TEXT)
WITH days AS (
  SELECT generate_series('2026-02-01'::date, '2026-02-16'::date, '1 day'::interval)::date AS day
),
quotes AS (
  SELECT fq.quoted_at::date AS day, COUNT(DISTINCT fq.quote_id)::int AS total
  FROM freight_quotes fq
  JOIN companies c ON c.id = fq.company_id
  WHERE fq.company_id = 5
    AND fq.quoted_at IS NOT NULL
    AND (fq.quoted_at AT TIME ZONE 'UTC')::date BETWEEN '2026-02-01'::date AND '2026-02-16'::date
  GROUP BY (fq.quoted_at AT TIME ZONE 'UTC')::date
),
orders AS (
  SELECT fo.order_date::date AS day, COUNT(DISTINCT fo.quote_id)::int AS total
  FROM freight_orders fo
  JOIN companies c2 ON c2.id = fo.company_id
  WHERE fo.company_id = 5
    AND fo.order_date IS NOT NULL
    AND fo.order_date::date BETWEEN '2026-02-01'::date AND '2026-02-16'::date
    AND EXISTS (
      SELECT 1
      FROM freight_quotes fq
      JOIN companies c ON c.id = fq.company_id
      WHERE fq.quote_id = fo.quote_id
        AND fq.company_id = 5
        AND fq.quoted_at IS NOT NULL
        AND (fq.quoted_at AT TIME ZONE 'UTC')::date BETWEEN '2026-02-01'::date AND '2026-02-16'::date
    )
  GROUP BY fo.order_date::date
)
SELECT
  to_char(d.day, 'DD/MM/YYYY') AS date,
  COALESCE(q.total, 0)::int AS sims,
  COALESCE(o.total, 0)::int AS orders
FROM days d
LEFT JOIN quotes q ON q.day = d.day
LEFT JOIN orders o ON o.day = d.day
ORDER BY d.day ASC;

SET enable_seqscan = on;

-- -----------------------------------------------------------------------------
-- 2) simulations/freight-scatter
--    EXPLAIN sem ANALYZE = rápido. Para tempo real use ANALYZE e período curto (ex: 2 dias).
-- -----------------------------------------------------------------------------
SET enable_seqscan = off;

EXPLAIN (BUFFERS, FORMAT TEXT)
WITH filtered_quotes AS MATERIALIZED (
  SELECT f.id, f.quote_id
  FROM freight_quotes f
  JOIN companies c ON c.id = f.company_id
  WHERE f.company_id = 5
    AND f.quoted_at IS NOT NULL
    AND f.quoted_at >= '2026-02-01'::date::timestamptz AND f.quoted_at < ('2026-02-03'::date + interval '1 day')::timestamptz
),
converted_quote_ids AS (
  SELECT DISTINCT fo.quote_id
  FROM freight_orders fo
  WHERE fo.quote_id IS NOT NULL AND fo.company_id = 5
),
opt_ranked AS (
  SELECT
    f.quote_id,
    o.shipping_value,
    o.deadline,
    ROW_NUMBER() OVER (
      PARTITION BY f.quote_id
      ORDER BY o.shipping_value ASC NULLS LAST, o.deadline ASC NULLS LAST
    ) AS rn
  FROM filtered_quotes f
  JOIN freight_quote_options o ON o.freight_quote_id = f.id
  WHERE o.shipping_value IS NOT NULL AND o.deadline IS NOT NULL
),
one_option_per_quote AS (
  SELECT
    r.quote_id,
    r.shipping_value,
    r.deadline,
    CASE WHEN cq.quote_id IS NOT NULL THEN 1 ELSE 0 END AS is_converted
  FROM opt_ranked r
  LEFT JOIN converted_quote_ids cq ON cq.quote_id = r.quote_id
  WHERE r.rn = 1
),
bucketed AS (
  SELECT
    CASE
      WHEN shipping_value = 0 THEN 'R$0,00 (FREE)'::text
      WHEN shipping_value BETWEEN 0.01 AND 100.00 THEN 'entre R$ 0,01 e R$ 100,00'
      WHEN shipping_value BETWEEN 100.01 AND 200.00 THEN 'entre R$ 100,01 e R$ 200,00'
      WHEN shipping_value BETWEEN 200.01 AND 300.00 THEN 'entre R$ 200,01 e R$ 300,00'
      WHEN shipping_value BETWEEN 300.01 AND 500.00 THEN 'entre R$ 300,01 e R$ 500,00'
      WHEN shipping_value BETWEEN 500.01 AND 1000.00 THEN 'entre R$ 500,01 e R$ 1.000,00'
      WHEN shipping_value BETWEEN 1000.01 AND 10000.00 THEN 'entre R$ 1.000,01 e R$ 10.000,00'
      ELSE 'acima de R$ 10.000,00'
    END AS range_value,
    CASE
      WHEN deadline <= 0 THEN '>0'
      WHEN deadline <= 5 THEN '>0'
      WHEN deadline <= 10 THEN '>5'
      WHEN deadline <= 15 THEN '>10'
      WHEN deadline <= 20 THEN '>15'
      WHEN deadline <= 25 THEN '>20'
      WHEN deadline <= 30 THEN '>25'
      WHEN deadline <= 35 THEN '>30'
      WHEN deadline <= 40 THEN '>35'
      WHEN deadline <= 45 THEN '>40'
      WHEN deadline <= 60 THEN '>45'
      ELSE '>60'
    END AS range_deadline,
    is_converted
  FROM one_option_per_quote
),
agg AS (
  SELECT
    range_value,
    range_deadline,
    COUNT(*)::int AS total,
    SUM(is_converted)::int AS orders,
    (SUM(is_converted)::numeric / NULLIF(COUNT(*)::numeric, 0)) AS conv
  FROM bucketed
  GROUP BY 1, 2
)
SELECT range_value, range_deadline, total, orders, conv
FROM agg
ORDER BY total DESC
LIMIT 800;

SET enable_seqscan = on;

-- -----------------------------------------------------------------------------
-- 3) simulations/by-state
--    EXPLAIN sem ANALYZE. Para tempo real use (ANALYZE, BUFFERS) e período curto.
-- -----------------------------------------------------------------------------
EXPLAIN (BUFFERS, FORMAT TEXT)
SELECT
  UPPER(TRIM(f.destination_state)) AS state,
  COUNT(DISTINCT f.quote_id)::int AS sims,
  COUNT(DISTINCT CASE
    WHEN EXISTS (
      SELECT 1
      FROM freight_orders fo
      WHERE fo.quote_id = f.quote_id
        AND fo.company_id = 5
      LIMIT 1
    )
    THEN f.quote_id
    ELSE NULL
  END)::int AS orders
FROM freight_quotes f
JOIN companies c ON c.id = f.company_id
WHERE f.company_id = 5
  AND f.quoted_at IS NOT NULL
  AND f.quoted_at >= '2026-02-01'::date::timestamptz AND f.quoted_at < ('2026-02-03'::date + interval '1 day')::timestamptz
  AND f.destination_state IS NOT NULL
  AND TRIM(f.destination_state) <> ''
GROUP BY 1
ORDER BY sims DESC, state ASC;
