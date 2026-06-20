-- migration_019: cash ledger — single source of truth for Cash in Hand + Bank.
-- Every money event is a signed row; balances are sums. See spec
-- docs/superpowers/specs/2026-06-20-cash-ledger-design.md.

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('cash','bank')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'sale','debtor_payment','expense','loan_repayment','debt_repayment',
    'stock_purchase','bank_deposit','bank_withdrawal','adjustment')),
  ref_table TEXT,
  ref_id TEXT,
  transfer_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own cash_movements"   ON cash_movements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cash_movements" ON cash_movements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cash_movements" ON cash_movements FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cash_movements" ON cash_movements FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_user ON cash_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_ref  ON cash_movements(ref_table, ref_id);
ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;

-- ── Backfill (idempotent) — only events already reflected in today's cash ──────
-- Sales: one IN row per sale group, account by payment method. Credit sales post
-- the collected amount (amount_paid on the linked tab) to cash.
INSERT INTO cash_movements (user_id, account, direction, amount, category, ref_table, ref_id, created_at)
SELECT g.user_id,
       CASE WHEN g.payment_method IN ('momo','bank') THEN 'bank' ELSE 'cash' END,
       'in', g.cash_amount, 'sale', 'sales', g.group_key, g.created_at
FROM (
  SELECT s.user_id,
         COALESCE(s.sale_group_id::text, s.id::text) AS group_key,
         MIN(s.payment_method) AS payment_method,
         MIN(s.created_at) AS created_at,
         CASE
           WHEN MIN(s.payment_method) = 'credit'
             THEN COALESCE(MAX(d.amount_paid), 0)
           ELSE SUM(s.total)
         END AS cash_amount
  FROM sales s
  LEFT JOIN debts d ON d.sale_group_id = s.sale_group_id AND d.user_id = s.user_id
  GROUP BY s.user_id, COALESCE(s.sale_group_id::text, s.id::text)
) g
WHERE g.cash_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM cash_movements m
    WHERE m.ref_table = 'sales' AND m.ref_id = g.group_key AND m.user_id = g.user_id
  );

-- Expenses: one OUT row per expense, from cash.
INSERT INTO cash_movements (user_id, account, direction, amount, category, ref_table, ref_id, created_at)
SELECT e.user_id, 'cash', 'out', e.amount, 'expense', 'expenses', e.id::text, e.created_at
FROM expenses e
WHERE NOT EXISTS (
  SELECT 1 FROM cash_movements m
  WHERE m.ref_table = 'expenses' AND m.ref_id = e.id::text AND m.user_id = e.user_id
);
