-- migration_013: capital injections + repayment installment schedule
-- An injection is money put into the business (loan/personal/family/investment).
-- It has a fixed monthly installment schedule and is "recovered" by the profit of
-- the stock_batches it funded (stock_batches.injection_id, FK wired here).

CREATE TABLE IF NOT EXISTS capital_injections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'other'
    CHECK (source IN ('microfinance','personal','family_friends','investment','other')),
  lender_name TEXT,
  principal DECIMAL(10,2) NOT NULL,
  interest_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_repayable DECIMAL(10,2) NOT NULL,
  amount_repaid DECIMAL(10,2) NOT NULL DEFAULT 0,
  injection_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  payback_months INTEGER NOT NULL DEFAULT 3,
  installment_count INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','closed')),
  risk_tier TEXT NOT NULL DEFAULT 'on_track' CHECK (risk_tier IN ('on_track','watch','at_risk')),
  risk_alerted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE capital_injections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own injections"
  ON capital_injections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own injections"
  ON capital_injections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own injections"
  ON capital_injections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own injections"
  ON capital_injections FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS repayment_installments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  injection_id UUID NOT NULL REFERENCES capital_injections(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  amount_due DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due','paid','overdue'))
);

ALTER TABLE repayment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own installments"
  ON repayment_installments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own installments"
  ON repayment_installments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own installments"
  ON repayment_installments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own installments"
  ON repayment_installments FOR DELETE USING (auth.uid() = user_id);

-- Wire the FK reserved in Plan 1 (migration_012 left injection_id un-constrained).
ALTER TABLE stock_batches
  ADD CONSTRAINT fk_batches_injection
  FOREIGN KEY (injection_id) REFERENCES capital_injections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_injections_user ON capital_injections(user_id);
CREATE INDEX IF NOT EXISTS idx_installments_injection ON repayment_installments(injection_id);

ALTER PUBLICATION supabase_realtime ADD TABLE capital_injections;
ALTER PUBLICATION supabase_realtime ADD TABLE repayment_installments;
