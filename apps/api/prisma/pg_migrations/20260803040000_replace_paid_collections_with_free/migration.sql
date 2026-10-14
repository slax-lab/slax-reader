BEGIN;

-- Business data migration: Collections are no longer sold as paid products.
-- Convert every existing paid/stale-paid Collection to the free shape used by
-- the app while keeping status, subscribers, and historical payment records.
UPDATE "sr_user_collection"
SET "type" = 1,
    "amount" = 0,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type" = 2
   OR "amount" > 0;

COMMIT;
