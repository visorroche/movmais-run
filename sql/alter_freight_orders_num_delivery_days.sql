-- Adiciona coluna num_delivery_days em freight_orders (dias entre date e estimated_delivery_date, fuso Brasil).

ALTER TABLE freight_orders
  ADD COLUMN IF NOT EXISTS num_delivery_days integer NULL;
