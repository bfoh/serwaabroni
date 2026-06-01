-- ============================================================
-- SERWAABRONI DATABASE MIGRATION
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. PRODUCTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cost_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'piece',
  category TEXT NOT NULL DEFAULT 'Groceries',
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  qr_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own products"
  ON products FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products"
  ON products FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON products FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON products FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 2. SALES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  profit DECIMAL(10,2) NOT NULL DEFAULT 0,
  customer_name TEXT,
  customer_phone TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'momo', 'bank')),
  qr_invoice TEXT,
  sale_group_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_group ON sales(sale_group_id);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sales"
  ON sales FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sales"
  ON sales FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sales"
  ON sales FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 3. DEBTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS debts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  phone TEXT,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('owed', 'owing')),
  due_date TIMESTAMPTZ,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own debts"
  ON debts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own debts"
  ON debts FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own debts"
  ON debts FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 4. EXPENSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own expenses"
  ON expenses FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own expenses"
  ON expenses FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own expenses"
  ON expenses FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 5. BUSINESS PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  business_name TEXT NOT NULL DEFAULT 'My Shop',
  owner_name TEXT,
  phone TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON business_profiles FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON business_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON business_profiles FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 6. SYNC QUEUE TABLE (for offline support)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  payload JSONB NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  synced BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync queue"
  ON sync_queue FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync queue"
  ON sync_queue FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. OTP CODES TABLE (for Arkesel custom SMS auth)
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS but allow anon access (needed before login)
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert otp"
  ON otp_codes FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update otp"
  ON otp_codes FOR UPDATE USING (true);

CREATE POLICY "Anyone can select otp"
  ON otp_codes FOR SELECT USING (true);

CREATE POLICY "Anyone can delete otp"
  ON otp_codes FOR DELETE USING (true);

-- Auto-cleanup expired OTPs
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM otp_codes WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_debts_user_id ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_business_profiles_updated_at
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Dashboard summary function
CREATE OR REPLACE FUNCTION get_dashboard_summary(user_uuid UUID)
RETURNS TABLE (
  total_balance DECIMAL,
  today_sales DECIMAL,
  pending_debts DECIMAL,
  total_products BIGINT,
  low_stock_items BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(total) FROM sales WHERE sales.user_id = user_uuid), 0) -
    COALESCE((SELECT SUM(amount) FROM expenses WHERE expenses.user_id = user_uuid), 0) as total_balance,
    COALESCE((SELECT SUM(total) FROM sales WHERE sales.user_id = user_uuid AND sales.created_at >= CURRENT_DATE), 0) as today_sales,
    COALESCE((SELECT SUM(amount) FROM debts WHERE debts.user_id = user_uuid AND debts.type = 'owed' AND debts.is_paid = false), 0) as pending_debts,
    (SELECT COUNT(*) FROM products WHERE products.user_id = user_uuid) as total_products,
    (SELECT COUNT(*) FROM products WHERE products.user_id = user_uuid AND products.quantity <= products.low_stock_threshold) as low_stock_items;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;

ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;
ALTER PUBLICATION supabase_realtime ADD TABLE debts;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE business_profiles;

-- ============================================================
-- 8. CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  total_purchases DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own customers"
  ON customers FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own customers"
  ON customers FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own customers"
  ON customers FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own customers"
  ON customers FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
