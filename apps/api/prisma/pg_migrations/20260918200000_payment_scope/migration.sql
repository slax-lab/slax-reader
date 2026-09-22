ALTER TABLE sr_payment_grant ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE sr_payment_grant ADD COLUMN covered_end TIMESTAMP(3);
