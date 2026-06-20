-- migration_016: link "who owes me" debts to a capital injection
-- When a customer takes goods on credit that were bought with a loan/capital
-- injection, the resulting receivable can be tagged to that injection. This lets
-- the owner see, per loan, how much cash is still tied up in customers' hands —
-- alongside the profit already recovered from the stock the injection funded.
--
-- Only meaningful for type = 'owed' debts (money owed TO the user). 'owing' debts
-- (money the user owes) leave injection_id NULL.

ALTER TABLE debts
  ADD COLUMN IF NOT EXISTS injection_id UUID
    REFERENCES capital_injections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_debts_injection ON debts(injection_id);
