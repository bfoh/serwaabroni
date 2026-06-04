-- migration_007: partial payments on debts
-- Tracks cumulative amount paid against each debt. `amount` stays the original
-- total; `amount_paid` is the running total settled. remaining = amount - amount_paid.
-- is_paid flips true once amount_paid >= amount.

ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill: fully-paid debts get amount_paid = amount so remaining reads 0.
UPDATE debts SET amount_paid = amount WHERE is_paid = true AND amount_paid = 0;
