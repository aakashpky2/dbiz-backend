INSERT INTO permissions_master (module, actions)
VALUES 
  ('Accounts', ARRAY['VIEW']::varchar[]),
  ('Billing', ARRAY['VIEW', 'CREATE', 'EDIT', 'APPROVE', 'CANCEL', 'PAYMENTS']::varchar[])
ON CONFLICT (module) 
DO UPDATE SET actions = (
  SELECT array_agg(DISTINCT e) 
  FROM unnest(permissions_master.actions || EXCLUDED.actions) e
);
