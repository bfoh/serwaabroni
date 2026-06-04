-- migration_008: per-payment history on debts
-- Stores each part payment as an entry in a JSONB array: [{ "amount": 50, "date": "2026-06-04T..." }].
-- amount_paid (migration_007) remains the running total; payments is the itemized ledger.

ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS payments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: debts already partly/fully paid get a single synthetic entry for the
-- amount paid so far, dated at paid_at (or now for partials with no timestamp).
UPDATE debts
  SET payments = jsonb_build_array(
        jsonb_build_object('amount', amount_paid, 'date', COALESCE(paid_at, now()))
      )
  WHERE amount_paid > 0 AND payments = '[]'::jsonb;
