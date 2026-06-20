-- migration_017: credit sales linked to capital injections
-- A sale can be taken on credit: goods leave (stock + batch_consumptions as
-- usual) but cash is owed. The resulting tab is a debts row linked to the sale
-- via sale_group_id. The funding loan's profit-recovery is withheld until the
-- tab is paid (computed app-side from debts.amount_paid / payments).

-- 1. Allow 'credit' as a payment method.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','momo','bank','credit'));

-- 2. Link an auto-created tab back to its originating sale group.
ALTER TABLE debts ADD COLUMN IF NOT EXISTS sale_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_debts_sale_group ON debts(sale_group_id);
