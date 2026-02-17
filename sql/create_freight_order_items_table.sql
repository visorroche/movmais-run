-- Cria a tabela freight_order_items (itens por pedido AllPost).
-- Rodar em bancos que já têm freight_orders mas ainda não têm freight_order_items.

BEGIN;

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

DO $$
BEGIN
  ALTER TABLE freight_order_items
    ADD CONSTRAINT "UQ_freight_order_items_order_id_line_index"
    UNIQUE (order_id, line_index);
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

COMMIT;
