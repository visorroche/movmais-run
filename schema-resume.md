# Schema do banco (resumo para IA)

Tabelas e colunas disponíveis para consultas. Gerado a partir das entidades em `script-bi/src/entities/`.

---

## avanco_logistic_order_items

*Entidade: `AvancoLogisticOrderItem`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| logistic_order_id | int |
| logistic_order_id | fk |
| product_id | int |
| product_id | fk |
| quantity | numeric |
| created_at | timestamptz |

## avanco_logistic_orders

*Entidade: `AvancoLogisticOrder`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| order_code | text |
| company_id | int |
| company_id | fk |
| logistic_operator_id | int |
| logistic_operator_id | fk |
| status | text |
| reject_reason | text |
| delivery_days | integer |
| created_at | timestamptz |

## avanco_logistics_addresses

*Entidade: `AvancoLogisticsAddress`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| company_id | int |
| company_id | fk |
| logistic_operator_id | int |
| logistic_operator_id | fk |
| zip_start | text |
| zip_end | text |
| uf | text |
| city | text |
| transfer_type | text |
| delivery_days | integer |
| insurance | numeric |
| gris | numeric |
| table_price_id | bigint |
| table_price_id | fk |

## avanco_logistics_operators

*Entidade: `AvancoLogisticsOperator`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | int |
| company_id | fk |
| mov_comission_order | numeric |
| slug | varchar |

## avanco_logistics_table_price

*Entidade: `AvancoLogisticsTablePrice`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| company_id | int |
| company_id | fk |
| name | text |
| cd_name | text |
| uf_origin | text |
| city_origin | text |
| uf_delivery | text |
| city_delivery | text |
| weight_min | numeric |
| weight_max | numeric |
| price | numeric |
| created_at | timestamptz |

## avanco_stock

*Entidade: `AvancoStock`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| company_origin_id | int |
| company_origin_id | fk |
| company_logistic_id | int |
| company_logistic_id | fk |
| product_id | int |
| product_id | fk |
| quantity | integer |

## avanco_stock_mov

*Entidade: `AvancoStockMov`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| avanco_stock_id | bigint |
| avanco_stock_id | fk |
| quantity | integer |
| type | varchar |
| type_id | varchar |
| created_at | timestamptz |

## categories

*Entidade: `Category`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| name | varchar |
| synonymous | jsonb |
| level | integer |
| parent_id | integer |
| parent_id | fk |

## cities

*Entidade: `City`*

| Coluna | Tipo |
|--------|------|
| id | bigint |
| cd_ibge | text |
| uf | text |
| city | text |

## companies

*Entidade: `Company`*

| Coluna | Tipo |
|--------|------|
| id | int |
| name | varchar |
| site | varchar |
| group_id | fk |
| has_representatives | boolean |
| sells_on_marketplaces | boolean |
| televendas | boolean |
| avanco | boolean |
| operador_logistico | boolean |
| launch_orders | boolean |

## company_platforms

*Entidade: `CompanyPlataform`*

| Coluna | Tipo |
|--------|------|
| id | int |
| config | jsonb |
| company_id | fk |
| platform_id | fk |

## company_users

*Entidade: `CompanyUser`*

| Coluna | Tipo |
|--------|------|
| id | int |
| owner | boolean |
| polices | jsonb |
| company_id | int |
| user_id | int |
| company_id | fk |
| user_id | fk |

## customers

*Entidade: `Customer`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| external_id | varchar |
| tax_id | varchar |
| internal_cod | varchar |
| created_at | date |
| segmentation | varchar |
| address | varchar |
| zip | varchar |
| city | varchar |
| neighborhood | varchar |
| number | varchar |
| complement | varchar |
| state | varchar |
| person_type | varchar |
| legal_name | varchar |
| trade_name | varchar |
| gender | varchar |
| birth_date | date |
| email | varchar |
| status | boolean |
| delivery_address | jsonb |
| phones | jsonb |
| obs | text |
| raw | jsonb |
| representative_id | fk |
| customer_group_id | fk |

## customers_group

*Entidade: `CustomersGroup`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| external_id | varchar |
| name | varchar |

## freight_order_items

*Entidade: `FreightOrderItem`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| order_id | fk |
| product_id | fk |
| line_index | integer |
| envio_index | integer |
| partner_sku | varchar |
| partner_sku_id | varchar |
| title | varchar |
| quantity | integer |
| price | numeric |
| volumes | integer |
| weight | numeric |
| category | varchar |
| variation | varchar |
| raw | jsonb |

## freight_orders

*Entidade: `FreightOrder`*

| Coluna | Tipo |
|--------|------|
| id | int |
| external_id | varchar |
| order_date | timestamptz |
| date | varchar |
| time | varchar |
| order_code | varchar |
| store_name | varchar |
| quote_id | varchar |
| channel | varchar |
| freight_amount | numeric |
| freight_cost | numeric |
| delta_quote | numeric |
| invoice_value | numeric |
| address | varchar |
| address_zip | varchar |
| address_state | varchar |
| address_city | varchar |
| address_neighborhood | varchar |
| address_number | varchar |
| address_complement | varchar |
| estimated_delivery_date | timestamptz |
| num_delivery_days | integer |
| delivery_date | timestamptz |
| delta_quote_delivery_date | numeric |
| raw | jsonb |
| company_id | fk |
| platform_id | fk |

## freight_quote_options

*Entidade: `FreightQuoteOption`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| freight_quote_id | fk |
| line_index | integer |
| shipping_value | numeric |
| shipping_cost | numeric |
| carrier | varchar |
| warehouse_uf | varchar |
| warehouse_city | varchar |
| warehouse_name | varchar |
| shipping_name | varchar |
| carrier_deadline | integer |
| holiday_deadline | integer |
| warehouse_deadline | integer |
| deadline | integer |
| has_stock | boolean |
| raw | jsonb |

## freight_quotes

*Entidade: `FreightQuote`*

| Coluna | Tipo |
|--------|------|
| id | int |
| quote_id | varchar |
| partner_platform | varchar |
| external_quote_id | varchar |
| quoted_at | timestamptz |
| date | varchar |
| time | varchar |
| destination_zip | varchar |
| destination_state | varchar |
| destination_state_name | varchar |
| destination_state_region | varchar |
| destination_country_region | varchar |
| channel | varchar |
| store_name | varchar |
| invoice_value | numeric |
| total_weight | numeric |
| total_volume | numeric |
| total_packages | integer |
| best_deadline | integer |
| best_freight_cost | numeric |
| store_limit | integer |
| channel_limit | integer |
| timings | jsonb |
| channel_config | jsonb |
| input | jsonb |
| category_restrictions | jsonb |
| delivery_options | jsonb |
| raw | jsonb |
| company_id | fk |
| platform_id | fk |

## freight_quotes_items

*Entidade: `FreightQuoteItem`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | fk |
| quote_id | fk |
| product_id | fk |
| line_index | integer |
| partner_sku | varchar |
| partner_sku_id | varchar |
| quantity | integer |
| price | numeric |
| volumes | integer |
| stock | integer |
| stock_product | integer |
| category | varchar |
| aggregator | varchar |
| partner_original_sku | varchar |
| channel_price_from | numeric |
| registration_price | numeric |
| channel_price_to | numeric |
| raw | jsonb |

## freight_resume

*Entidade: `FreightResume`*

| Coluna | Tipo |
|--------|------|
| id | int |
| company_id | int |
| date | date |
| channel | varchar |
| state | varchar |
| freight_range | varchar |
| deadline_bucket | varchar |
| total_simulations | int |
| total_orders | int |
| total_value_simulations | numeric |
| total_value_orders | numeric |

## groups

*Entidade: `Group`*

| Coluna | Tipo |
|--------|------|
| id | int |
| name | varchar |

## order_items

*Entidade: `OrderItem`*

| Coluna | Tipo |
|--------|------|
| id | int |
| external_id | varchar |
| company_id | fk |
| order_id | fk |
| product_id | fk |
| sku | integer |
| unit_price | numeric |
| net_unit_price | numeric |
| comission | numeric |
| quantity | integer |
| item_type | varchar |
| service_ref_sku | varchar |
| assistant_comission | numeric |
| supervisor_comission | numeric |
| metadata | jsonb |

## orders

*Entidade: `Order`*

| Coluna | Tipo |
|--------|------|
| id | int |
| external_id | varchar |
| order_code | integer |
| order_date | timestamp |
| partner_order_id | varchar |
| current_status | varchar |
| current_status_code | varchar |
| shipping_amount | numeric |
| delivery_days | integer |
| delivery_forecast | date |
| delivery_date | date |
| total_amount | numeric |
| total_discount | numeric |
| marketplace_name | varchar |
| channel | varchar |
| payment_date | date |
| discount_coupon | varchar |
| delivery_state | varchar |
| delivery_zip | varchar |
| delivery_neighborhood | varchar |
| delivery_city | varchar |
| delivery_number | varchar |
| delivery_address | varchar |
| delivery_complement | varchar |
| carrier | varchar |
| subsidiary | varchar |
| metadata | jsonb |
| store_pickup | jsonb |
| payments | jsonb |
| tracking | jsonb |
| timeline | jsonb |
| raw | jsonb |
| customer_id | fk |
| company_id | fk |
| platform_id | fk |
| representative_id | fk |
| assistant_id | fk |
| supervisor_id | fk |

## platforms

*Entidade: `Plataform`*

| Coluna | Tipo |
|--------|------|
| id | int |
| type | varchar |
| slug | varchar |
| name | varchar |
| parameters | jsonb |

## products

*Entidade: `Product`*

| Coluna | Tipo |
|--------|------|
| id | int |
| external_id | varchar |
| company_id | fk |
| sku | varchar |
| ecommerce_id | varchar |
| ean | varchar |
| slug | varchar |
| name | varchar |
| store_reference | varchar |
| external_reference | varchar |
| brand_id | integer |
| brand | varchar |
| model | varchar |
| value | numeric |
| weight | numeric |
| width | numeric |
| height | numeric |
| lenght | numeric |
| ncm | varchar |
| category | varchar |
| external_category_id | bigint |
| category_id | fk |
| subcategory | varchar |
| final_category | varchar |
| manual_attributes_locked | boolean |
| active | boolean |
| photo | varchar |
| url | varchar |
| raw | jsonb |

## representatives

*Entidade: `Representative`*

| Coluna | Tipo |
|--------|------|
| id | int |
| internal_code | varchar |
| company_id | fk |
| company_name | varchar |
| user_id | fk |
| external_id | varchar |
| name | varchar |
| avatar | varchar |
| active | boolean |
| supervisor | boolean |
| supervisor_id | fk |
| state | varchar |
| city | varchar |
| document | varchar |
| email | varchar |
| phone | varchar |
| zip | varchar |
| address | varchar |
| number | varchar |
| complement | varchar |
| neighborhood | varchar |
| created_at | date |
| category | varchar |
| obs | text |

## users

*Entidade: `User`*

| Coluna | Tipo |
|--------|------|
| id | int |
| name | varchar |
| type | enum |
| email | varchar |
| phone | varchar |
| password | varchar |
