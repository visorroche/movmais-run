-- Cria as tabelas do AllPost (freight quotes) sem depender do TypeORM synchronize.
-- Compatível com o schema usado pelo script-bi (SnakeNamingStrategy + @Entity name).
--
-- Tabelas:
-- - freight_quotes
-- - freight_quotes_items
--
-- Pré-requisitos (já existentes no seu banco):
-- - companies(id)
-- - platforms(id)
-- - products(id)

BEGIN;

CREATE TABLE IF NOT EXISTS freight_quotes (
  id              SERIAL PRIMARY KEY,
  quote_id         varchar NOT NULL,
  partner_platform varchar NULL,
  external_quote_id varchar NULL,
  quoted_at        timestamptz NULL,

  destination_zip           varchar NULL,
  destination_state         varchar NULL,
  destination_state_name    varchar NULL,
  destination_state_region  varchar NULL,
  destination_country_region varchar NULL,

  channel     varchar NULL,
  store_name  varchar NULL,

  invoice_value numeric(14,2) NULL,
  total_weight  numeric(14,3) NULL,
  total_volume  numeric(14,6) NULL,
  total_packages integer NULL,

  store_limit   integer NULL,
  channel_limit integer NULL,

  timings               jsonb NULL,
  channel_config        jsonb NULL,
  input                 jsonb NULL,
  category_restrictions jsonb NULL,
  delivery_options      jsonb NULL,
  raw                   jsonb NULL,

  company_id  integer NOT NULL,
  platform_id integer NULL
);

CREATE TABLE IF NOT EXISTS freight_quotes_items (
  id SERIAL PRIMARY KEY,

  company_id integer NOT NULL,
  quote_id   integer NOT NULL,
  product_id integer NULL,

  line_index integer NOT NULL,

  partner_sku     varchar NULL,
  partner_sku_id  varchar NULL,

  quantity integer NULL,
  price    numeric(14,2) NULL,

  volumes       integer NULL,
  stock         integer NULL,
  stock_product integer NULL,

  category            varchar NULL,
  aggregator          varchar NULL,
  partner_original_sku varchar NULL,

  channel_price_from  numeric(14,2) NULL,
  registration_price  numeric(14,2) NULL,
  channel_price_to    numeric(14,2) NULL,

  raw jsonb NULL
);

-- Constraints/Indexes (idempotentes via DO)
DO $$
BEGIN
  ALTER TABLE freight_quotes
    ADD CONSTRAINT "UQ_freight_quotes_company_id_platform_id_quote_id"
    UNIQUE (company_id, platform_id, quote_id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_quotes_items
    ADD CONSTRAINT "UQ_freight_quotes_items_quote_id_line_index"
    UNIQUE (quote_id, line_index);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- FKs
DO $$
BEGIN
  ALTER TABLE freight_quotes
    ADD CONSTRAINT "FK_freight_quotes_company_id"
    FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_quotes
    ADD CONSTRAINT "FK_freight_quotes_platform_id"
    FOREIGN KEY (platform_id) REFERENCES platforms(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_quotes_items
    ADD CONSTRAINT "FK_freight_quotes_items_company_id"
    FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_quotes_items
    ADD CONSTRAINT "FK_freight_quotes_items_quote_id"
    FOREIGN KEY (quote_id) REFERENCES freight_quotes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_quotes_items
    ADD CONSTRAINT "FK_freight_quotes_items_product_id"
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

COMMIT;

