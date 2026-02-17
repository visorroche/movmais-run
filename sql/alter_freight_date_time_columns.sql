-- Adiciona colunas date (YYYY-MM-DD) e time (HH:mm:ss) no fuso Brasil
-- para freight_quotes (derivado de quoted_at) e freight_orders (derivado de order_date).
-- Rodar após create_freight_quotes_tables.sql (ou usar TYPEORM_SYNC em dev).

BEGIN;

-- freight_quotes
ALTER TABLE freight_quotes
  ADD COLUMN IF NOT EXISTS date varchar(10) NULL,
  ADD COLUMN IF NOT EXISTS "time" varchar(8) NULL;

-- freight_orders
ALTER TABLE freight_orders
  ADD COLUMN IF NOT EXISTS date varchar(10) NULL,
  ADD COLUMN IF NOT EXISTS "time" varchar(8) NULL;

COMMIT;
