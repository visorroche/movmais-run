-- Índices para otimizar as rotas do dashboard de Simulações (freight quotes/orders).
-- Rotas afetadas:
--   1) GET /companies/me/dashboard/filters?channelsFrom=freight_quotes
--   2) GET /companies/me/dashboard/simulations/daily?start=&end=
--   3) GET /companies/me/dashboard/simulations/freight-scatter?start=&end=&limit=800
--   4) GET /companies/me/dashboard/simulations/by-state?start=&end=
--
-- Execute após create_freight_quotes_tables.sql. Idempotente (IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- freight_quotes
-- ---------------------------------------------------------------------------
-- Filtro principal: company_id (ou via JOIN companies.group_id) + quoted_at (BETWEEN).
-- Usado em: filters (channels), daily (base_quotes), freight-scatter, by-state.
CREATE INDEX IF NOT EXISTS idx_freight_quotes_company_quoted_at
  ON freight_quotes (company_id, quoted_at)
  WHERE quoted_at IS NOT NULL;

-- Daily dashboard: index-only scan + ordem por dia → agregação sem heap fetch e sem sort.
-- (quoted_at AT TIME ZONE 'UTC')::date é IMMUTABLE; quoted_at::date não é (depende do timezone da sessão).
CREATE INDEX IF NOT EXISTS idx_freight_quotes_daily_agg
  ON freight_quotes (company_id, ((quoted_at AT TIME ZONE 'UTC')::date)) INCLUDE (quote_id)
  WHERE quoted_at IS NOT NULL;

-- Filtro por canal (channel) nas 4 rotas quando o usuário aplica filtro de canal.
CREATE INDEX IF NOT EXISTS idx_freight_quotes_company_quoted_at_channel
  ON freight_quotes (company_id, quoted_at, channel)
  WHERE quoted_at IS NOT NULL AND channel IS NOT NULL;

-- Agregação por estado (by-state): GROUP BY UPPER(TRIM(destination_state)).
-- Índice por destino ajuda quando há filtro por state; expressão para evitar full scan.
CREATE INDEX IF NOT EXISTS idx_freight_quotes_destination_state_upper
  ON freight_quotes (company_id, (UPPER(TRIM(destination_state))), quoted_at)
  WHERE destination_state IS NOT NULL AND TRIM(destination_state) <> '';

-- Lookup por quote_id (string) ao fazer JOIN com freight_orders (fo.quote_id = fq.quote_id).
CREATE INDEX IF NOT EXISTS idx_freight_quotes_quote_id
  ON freight_quotes (quote_id);

-- ---------------------------------------------------------------------------
-- freight_quotes_items
-- ---------------------------------------------------------------------------
-- EXISTS (fqi.quote_id = f.id AND p.sku = ANY(...)) em daily, freight-scatter, by-state.
-- quote_id é FK para freight_quotes.id; o planner usa para semijoin.
CREATE INDEX IF NOT EXISTS idx_freight_quotes_items_quote_id
  ON freight_quotes_items (quote_id);

-- Filtro por SKU: join com products(p.id) WHERE p.sku = ANY(...).
-- Índice composto permite resolver quote + product em um único passo.
CREATE INDEX IF NOT EXISTS idx_freight_quotes_items_quote_id_product_id
  ON freight_quotes_items (quote_id, product_id)
  WHERE product_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- freight_quote_options
-- ---------------------------------------------------------------------------
-- JOIN freight_quote_options o ON o.freight_quote_id = f.id em freight-scatter.
CREATE INDEX IF NOT EXISTS idx_freight_quote_options_freight_quote_id
  ON freight_quote_options (freight_quote_id);

-- ---------------------------------------------------------------------------
-- freight_orders
-- ---------------------------------------------------------------------------
-- JOIN base_quotes bq ON bq.quote_id = fo.quote_id (quote_id é string, igual freight_quotes.quote_id).
-- Lookup por quote_id é o caminho quente em daily, freight-scatter e by-state.
CREATE INDEX IF NOT EXISTS idx_freight_orders_quote_id
  ON freight_orders (quote_id)
  WHERE quote_id IS NOT NULL;

-- Filtro por company + order_date (daily: WHERE condFo AND order_date BETWEEN).
CREATE INDEX IF NOT EXISTS idx_freight_orders_company_order_date
  ON freight_orders (company_id, order_date)
  WHERE order_date IS NOT NULL;

-- Combinação quote_id + company_id para o EXISTS em freight-scatter e by-state
-- (fo.quote_id = r.quote_id AND (c2.group_id = $1 OR fo.company_id = $1)).
CREATE INDEX IF NOT EXISTS idx_freight_orders_quote_id_company_id
  ON freight_orders (quote_id, company_id)
  WHERE quote_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- companies (quando dashboard usa group_id)
-- ---------------------------------------------------------------------------
-- GET filters e demais rotas: JOIN companies c ON c.id = fq.company_id WHERE c.group_id = $1.
-- Índice em group_id acelera quando há muitas companies no mesmo grupo.
CREATE INDEX IF NOT EXISTS idx_companies_group_id
  ON companies (group_id)
  WHERE group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- products (filtro por SKU no dashboard)
-- ---------------------------------------------------------------------------
-- EXISTS ... JOIN products p ON p.id = fqi.product_id WHERE p.sku = ANY($n).
-- Lookup por sku nas subqueries de daily, freight-scatter e by-state.
CREATE INDEX IF NOT EXISTS idx_products_sku
  ON products (sku)
  WHERE sku IS NOT NULL AND TRIM(sku) <> '';
