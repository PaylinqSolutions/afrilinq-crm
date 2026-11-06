-- Fill in categories and units for catalogue items created before those fields existed. Only touches empty values.
UPDATE "products" SET "category" = v.category, "unit" = COALESCE("products"."unit", v.unit)
FROM (VALUES
  ('AFQ-BOOKS', 'Finance software', 'per company / year'), ('AFQ-PAY', 'Payments', 'per merchant / year'), ('AFQ-PEOPLE', 'HR software', 'per company / year'),
  ('AFQ-FLEET', 'Logistics software', 'per fleet / year'), ('SVC-IMPL', 'Professional services', 'per project'), ('SVC-MIG', 'Professional services', 'per project'),
  ('SVC-TRN', 'Training', 'per day')
) AS v(code, category, unit)
WHERE "products"."code" = v.code AND "products"."category" IS NULL;
