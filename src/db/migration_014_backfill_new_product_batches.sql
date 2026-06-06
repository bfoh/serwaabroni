-- migration_014: backfill opening batches for products added AFTER migration_012
--
-- migration_012 only created opening batches for products that existed at the time.
-- Until the add-product write path was fixed to create a batch, any product added
-- afterward had no batch, so its sales fell through to the "untracked" FIFO path
-- (unit_cost 0 → profit overstated). This backfills an opening batch for every
-- in-stock product that still has none, using its current cost as the batch cost.
-- injection_id is left NULL (the funding source cannot be known retroactively).
-- Run once in the Supabase SQL editor.

INSERT INTO stock_batches (user_id, product_id, qty_purchased, qty_remaining, unit_cost, total_cost, purchased_at)
SELECT user_id, id, quantity, quantity, cost_price, cost_price * quantity, created_at
FROM products
WHERE quantity > 0
  AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.product_id = products.id);
