-- Adiciona colunas best_deadline e best_freight_cost em freight_quotes (melhor opção por deadline+preço).

ALTER TABLE freight_quotes
  ADD COLUMN IF NOT EXISTS best_deadline integer NULL,
  ADD COLUMN IF NOT EXISTS best_freight_cost numeric(14,2) NULL;
