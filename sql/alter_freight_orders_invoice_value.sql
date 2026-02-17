-- Adiciona coluna invoice_value em freight_orders (soma de envio[].notaFiscal.valorTotalProdutos).

ALTER TABLE freight_orders
  ADD COLUMN IF NOT EXISTS invoice_value numeric(14,2) NULL;
