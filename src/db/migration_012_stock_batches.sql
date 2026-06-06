-- migration_012: stock batches + per-sale consumption ledger
-- A batch = one purchase line received into inventory, optionally funded by a
-- capital injection (injection_id is added nullable now; the capital_injections
-- table arrives in Plan 2). batch_consumptions records each sale->batch draw so
-- profit is batch-accurate and traceable. products.quantity stays a cache equal
-- to SUM(qty_remaining) of a product's open batches.

CREATE TABLE IF NOT EXISTS stock_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  injection_id UUID,                         -- FK added in Plan 2 migration
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_purchased INTEGER NOT NULL,
  qty_remaining INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stock_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own batches"
  ON stock_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own batches"
  ON stock_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own batches"
  ON stock_batches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own batches"
  ON stock_batches FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS batch_consumptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES stock_batches(id) ON DELETE SET NULL,   -- NULL = untracked oversell
  injection_id UUID,                                              -- denormalized for fast aggregation
  qty INTEGER NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  profit DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE batch_consumptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own consumptions"
  ON batch_consumptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own consumptions"
  ON batch_consumptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own consumptions"
  ON batch_consumptions FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_batches_product ON stock_batches(product_id, purchased_at);
CREATE INDEX IF NOT EXISTS idx_batches_injection ON stock_batches(injection_id);
CREATE INDEX IF NOT EXISTS idx_batches_user ON stock_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_injection ON batch_consumptions(injection_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_created ON batch_consumptions(created_at);
CREATE INDEX IF NOT EXISTS idx_consumptions_sale ON batch_consumptions(sale_id);

ALTER PUBLICATION supabase_realtime ADD TABLE stock_batches;

-- Backfill: one opening batch per existing product so FIFO has stock from day one.
INSERT INTO stock_batches (user_id, product_id, qty_purchased, qty_remaining, unit_cost, total_cost, purchased_at)
SELECT user_id, id, quantity, quantity, cost_price, cost_price * quantity, created_at
FROM products
WHERE quantity > 0
  AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.product_id = products.id);
