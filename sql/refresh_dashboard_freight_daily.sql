-- Atualiza dashboard_freight_daily para um período.
--
-- Uso em psql (defina as variáveis e execute o bloco):
--   \set start_date '2026-02-01'
--   \set end_date '2026-02-16'
--   \i refresh_dashboard_freight_daily.sql
--
-- Ou execute apenas o INSERT abaixo substituindo manualmente
--   '2026-02-01' e '2026-02-16' pelas datas desejadas.

DELETE FROM dashboard_freight_daily
WHERE date BETWEEN '2026-02-01'::date AND '2026-02-16'::date;

INSERT INTO dashboard_freight_daily (
  company_id, date, channel, state, freight_range, deadline_bucket,
  total_simulations, total_orders, total_value_simulations, total_value_orders
)
WITH
quotes_with_option AS (
  SELECT
    fq.company_id,
    (fq.quoted_at AT TIME ZONE 'UTC')::date AS date,
    COALESCE(TRIM(fq.channel), '') AS channel,
    COALESCE(UPPER(TRIM(NULLIF(fq.destination_state, ''))), '') AS state,
    fq.quote_id,
    fq.invoice_value,
    o.shipping_value,
    o.deadline,
    ROW_NUMBER() OVER (
      PARTITION BY fq.id
      ORDER BY o.shipping_value ASC NULLS LAST, o.deadline ASC NULLS LAST
    ) AS rn
  FROM freight_quotes fq
  JOIN freight_quote_options o ON o.freight_quote_id = fq.id
  WHERE fq.quoted_at IS NOT NULL
    AND o.shipping_value IS NOT NULL
    AND o.deadline IS NOT NULL
    AND (fq.quoted_at AT TIME ZONE 'UTC')::date BETWEEN '2026-02-01'::date AND '2026-02-16'::date
),
one_per_quote AS (
  SELECT
    company_id,
    date,
    channel,
    state,
    quote_id,
    invoice_value,
    CASE
      WHEN shipping_value = 0 THEN 'R$0,00 (FREE)'
      WHEN shipping_value BETWEEN 0.01 AND 100.00 THEN 'entre R$ 0,01 e R$ 100,00'
      WHEN shipping_value BETWEEN 100.01 AND 200.00 THEN 'entre R$ 100,01 e R$ 200,00'
      WHEN shipping_value BETWEEN 200.01 AND 300.00 THEN 'entre R$ 200,01 e R$ 300,00'
      WHEN shipping_value BETWEEN 300.01 AND 500.00 THEN 'entre R$ 300,01 e R$ 500,00'
      WHEN shipping_value BETWEEN 500.01 AND 1000.00 THEN 'entre R$ 500,01 e R$ 1.000,00'
      WHEN shipping_value BETWEEN 1000.01 AND 10000.00 THEN 'entre R$ 1.000,01 e R$ 10.000,00'
      ELSE 'acima de R$ 10.000,00'
    END AS freight_range,
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
    END AS deadline_bucket
  FROM quotes_with_option
  WHERE rn = 1
),
with_orders AS (
  SELECT
    q.company_id,
    q.date,
    q.channel,
    q.state,
    q.quote_id,
    q.freight_range,
    q.deadline_bucket,
    q.invoice_value,
    CASE WHEN fo.quote_id IS NOT NULL THEN 1 ELSE 0 END AS is_order,
    fo.freight_amount AS order_value
  FROM one_per_quote q
  LEFT JOIN freight_orders fo ON fo.quote_id = q.quote_id AND fo.company_id = q.company_id
)
SELECT
  company_id,
  date,
  channel,
  state,
  freight_range,
  deadline_bucket,
  COUNT(*)::int AS total_simulations,
  SUM(is_order)::int AS total_orders,
  SUM((invoice_value)::numeric) AS total_value_simulations,
  SUM(CASE WHEN is_order = 1 THEN (order_value)::numeric ELSE NULL END) AS total_value_orders
FROM with_orders
GROUP BY 1, 2, 3, 4, 5, 6;
