-- Tabela de totais pré-agregados para o dashboard de Simulações (freight).
-- Atende: daily, by-state e freight-scatter com queries simples (SUM + GROUP BY).
--
-- Grão: (company_id, date, channel, state, freight_range, deadline_bucket)
-- - daily:  SUM(...) GROUP BY date (filtro channel, state)
-- - by-state: SUM(...) GROUP BY state (filtro channel)
-- - scatter: SUM(...) GROUP BY freight_range, deadline_bucket (filtro channel, state)
--
-- Pré-requisito: freight_quotes, freight_quote_options, freight_orders, companies.

BEGIN;

CREATE TABLE IF NOT EXISTS dashboard_freight_daily (
  company_id            integer NOT NULL,
  date                  date NOT NULL,
  channel               varchar(255) NOT NULL DEFAULT '',
  state                 varchar(32) NOT NULL DEFAULT '',
  freight_range         varchar(128) NOT NULL,
  deadline_bucket       varchar(16) NOT NULL,
  total_simulations     integer NOT NULL DEFAULT 0,
  total_orders          integer NOT NULL DEFAULT 0,
  total_value_simulations numeric(18,2) NULL,
  total_value_orders    numeric(18,2) NULL,
  PRIMARY KEY (company_id, date, channel, state, freight_range, deadline_bucket)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_freight_daily_company_date
  ON dashboard_freight_daily (company_id, date);
CREATE INDEX IF NOT EXISTS idx_dashboard_freight_daily_company_date_channel
  ON dashboard_freight_daily (company_id, date, channel);
CREATE INDEX IF NOT EXISTS idx_dashboard_freight_daily_company_date_state
  ON dashboard_freight_daily (company_id, date, state);

COMMENT ON TABLE dashboard_freight_daily IS 'Totais por dia/canal/estado/bucket de frete e prazo para dashboard de Simulações';

COMMIT;
