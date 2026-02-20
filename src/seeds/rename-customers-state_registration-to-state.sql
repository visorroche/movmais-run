-- Renomeia customers.state_registration para state (UF).
-- Execute uma vez: psql -f rename-customers-state_registration-to-state.sql (ou via migration).

ALTER TABLE public.customers
  RENAME COLUMN state_registration TO state;
