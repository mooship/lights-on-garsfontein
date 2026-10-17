-- Flags switched to Drizzle boolean mode. Storage is unchanged (0/1 integers), so there is
-- nothing to migrate; drizzle-kit proposed a table rebuild, which on D1 would cascade-delete
-- confirmations. This no-op keeps the schema snapshot in step.
SELECT 1;
