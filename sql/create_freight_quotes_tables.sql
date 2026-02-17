-- Cria as tabelas do AllPost (freight quotes) sem depender do TypeORM synchronize.
-- Compatível com o schema usado pelo script-bi (SnakeNamingStrategy + @Entity name).
--
-- Tabelas:
-- - freight_quotes
-- - freight_quotes_items
-- - freight_quote_options
-- - freight_orders
-- - logs
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

  best_deadline     integer NULL,
  best_freight_cost numeric(14,2) NULL,

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

CREATE TABLE IF NOT EXISTS freight_quote_options (
  id SERIAL PRIMARY KEY,

  company_id integer NOT NULL,
  freight_quote_id integer NOT NULL,

  line_index integer NOT NULL,

  shipping_value numeric(14,2) NULL,
  shipping_cost  numeric(14,2) NULL,

  carrier        varchar NULL,
  warehouse_uf   varchar NULL,
  warehouse_city varchar NULL,
  warehouse_name varchar NULL,
  shipping_name  varchar NULL,

  carrier_deadline   integer NULL,
  holiday_deadline   integer NULL,
  warehouse_deadline integer NULL,
  deadline           integer NULL,

  has_stock boolean NULL,
  raw jsonb NULL
);

CREATE TABLE IF NOT EXISTS freight_orders (
  id SERIAL PRIMARY KEY,

  external_id varchar NOT NULL,
  order_date timestamptz NULL,
  order_code varchar NULL,
  store_name varchar NULL,
  quote_id varchar NULL,
  channel varchar NULL,

  freight_amount numeric(14,2) NULL,
  freight_cost numeric(14,2) NULL,
  delta_quote numeric(14,2) NULL,
  invoice_value numeric(14,2) NULL,

  address varchar NULL,
  address_zip varchar NULL,
  address_state varchar NULL,
  address_city varchar NULL,
  address_neighborhood varchar NULL,
  address_number varchar NULL,
  address_complement varchar NULL,

  estimated_delivery_date timestamptz NULL,
  num_delivery_days integer NULL,
  delivery_date timestamptz NULL,
  delta_quote_delivery_date numeric(14,2) NULL,

  raw jsonb NULL,

  company_id integer NOT NULL,
  platform_id integer NULL
);

CREATE TABLE IF NOT EXISTS freight_order_items (
  id SERIAL PRIMARY KEY,

  company_id integer NOT NULL,
  order_id integer NOT NULL,
  product_id integer NULL,

  line_index integer NOT NULL,
  envio_index integer NULL,

  partner_sku     varchar NULL,
  partner_sku_id  varchar NULL,
  title          varchar NULL,

  quantity integer NULL,
  price    numeric(14,2) NULL,
  volumes  integer NULL,
  weight   numeric(14,3) NULL,

  category  varchar NULL,
  variation varchar NULL,

  raw jsonb NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  processed_at timestamptz NOT NULL,
  date date NULL,
  command varchar NOT NULL,
  log jsonb NOT NULL,
  errors jsonb NULL,
  company_id integer NOT NULL,
  platform_id integer NULL
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

DO $$
BEGIN
  ALTER TABLE freight_quote_options
    ADD CONSTRAINT "UQ_freight_quote_options_freight_quote_id_line_index"
    UNIQUE (freight_quote_id, line_index);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_orders
    ADD CONSTRAINT "UQ_freight_orders_company_id_platform_id_external_id"
    UNIQUE (company_id, platform_id, external_id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_order_items
    ADD CONSTRAINT "UQ_freight_order_items_order_id_line_index"
    UNIQUE (order_id, line_index);
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
  ALTER TABLE freight_quote_options
    ADD CONSTRAINT "FK_freight_quote_options_company_id"
    FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_orders
    ADD CONSTRAINT "FK_freight_orders_company_id"
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
  ALTER TABLE freight_quote_options
    ADD CONSTRAINT "FK_freight_quote_options_freight_quote_id"
    FOREIGN KEY (freight_quote_id) REFERENCES freight_quotes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_orders
    ADD CONSTRAINT "FK_freight_orders_platform_id"
    FOREIGN KEY (platform_id) REFERENCES platforms(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_order_items
    ADD CONSTRAINT "FK_freight_order_items_company_id"
    FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_order_items
    ADD CONSTRAINT "FK_freight_order_items_order_id"
    FOREIGN KEY (order_id) REFERENCES freight_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE freight_order_items
    ADD CONSTRAINT "FK_freight_order_items_product_id"
    FOREIGN KEY (product_id) REFERENCES products(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE logs
    ADD CONSTRAINT "FK_logs_company_id"
    FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE logs
    ADD CONSTRAINT "FK_logs_platform_id"
    FOREIGN KEY (platform_id) REFERENCES platforms(id);
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

