-- Diagnóstico: por que o script resume:freight não insere linhas para certas datas?
-- O script usa data em America/Sao_Paulo (dia no Brasil). A INSERT só considera freight_quotes que:
--   1. (quoted_at AT TIME ZONE 'America/Sao_Paulo')::date no intervalo
--   2. Com pelo menos uma freight_quote_option com shipping_value IS NOT NULL e deadline IS NOT NULL
--
-- Ajuste as datas abaixo (start_date / end_date) e execute.

WITH params AS (
  SELECT
    '2025-02-01'::date AS start_date,
    '2025-02-15'::date AS end_date
),
by_day AS (
  SELECT
    (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date AS d,
    COUNT(DISTINCT fq.id) AS quotes_total,
    COUNT(DISTINCT CASE
      WHEN EXISTS (
        SELECT 1 FROM freight_quote_options o
        WHERE o.freight_quote_id = fq.id
          AND o.shipping_value IS NOT NULL
          AND o.deadline IS NOT NULL
      ) THEN fq.id
    END) AS quotes_com_options
  FROM freight_quotes fq
  CROSS JOIN params p
  WHERE fq.quoted_at IS NOT NULL
    AND (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p.start_date AND p.end_date
  GROUP BY (fq.quoted_at AT TIME ZONE 'America/Sao_Paulo')::date
)
SELECT
  d,
  quotes_total,
  quotes_com_options,
  quotes_total - quotes_com_options AS quotes_sem_options_uteis
FROM by_day
ORDER BY d;
