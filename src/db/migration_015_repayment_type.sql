-- migration_015: per-injection repayment type.
-- 'equal'         = existing behavior: equal monthly installments of total_repayable.
-- 'interest_only' = pay interest each month; final month also pays full principal.
ALTER TABLE capital_injections
  ADD COLUMN IF NOT EXISTS repayment_type TEXT NOT NULL DEFAULT 'equal'
  CHECK (repayment_type IN ('equal','interest_only'));
