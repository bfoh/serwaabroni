-- ============================================================
-- MIGRATION 002: Add barcode + fix expenses schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Add barcode column to products (for barcode scanner feature)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode TEXT;

-- 2. Add name column to expenses (required — what the expense was for)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS name TEXT;

-- 3. Add notes column to expenses (optional extra details)
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. Make description nullable (app now sends name as primary, description is optional)
ALTER TABLE expenses
  ALTER COLUMN description DROP NOT NULL;

-- 5. Copy existing description data into name (for existing records)
UPDATE expenses
  SET name = description
  WHERE name IS NULL AND description IS NOT NULL;

-- 6. Set default for name on any remaining rows
UPDATE expenses
  SET name = 'Unknown Expense'
  WHERE name IS NULL;

-- 7. Add index on barcode for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- 8. Add index on expenses.category for filtering
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- 9. Add RLS update policy for expenses (was missing)
CREATE POLICY "Users can update own expenses"
  ON expenses FOR UPDATE USING (auth.uid() = user_id);

-- Done!
