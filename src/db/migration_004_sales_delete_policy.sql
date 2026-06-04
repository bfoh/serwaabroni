-- migration_004: allow users to delete their own sales
--
-- The `sales` table had SELECT/INSERT/UPDATE policies but NO delete policy.
-- With RLS enabled, deletes were silently blocked (0 rows, no error), so
-- deleted sales reappeared on refresh and revenue/profit/cash never dropped.
-- This adds the missing policy so deletes actually persist.

CREATE POLICY "Users can delete own sales"
  ON sales FOR DELETE USING (auth.uid() = user_id);
