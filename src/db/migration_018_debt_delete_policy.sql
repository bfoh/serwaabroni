-- migration_018: allow users to delete their own debts
--
-- The `debts` table had SELECT/INSERT/UPDATE policies but NO delete policy.
-- With RLS enabled, deletes were silently blocked (0 rows, no error), so
-- deleted debts reappeared on refresh across all tabs (who owes me / i owe them
-- / paid). This adds the missing policy so deletes actually persist. Mirrors
-- migration_004 (the same fix for sales).

CREATE POLICY "Users can delete own debts"
  ON debts FOR DELETE USING (auth.uid() = user_id);
