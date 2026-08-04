-- migration_028: SECURITY DEFINER cash-posting RPCs.
-- Run AFTER migration_027. See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5.
--
-- migration_026 correctly locked cash_movements to OWNER-ONLY — Manager and
-- Staff must never read or write it directly. But the permission matrix also
-- lets Manager/Staff record sales, debts, and expenses, and every one of
-- those actions posts a cash_movements row today via direct client inserts
-- using the caller's own resolved id (services/cashApi.ts). Since
-- business_id_for(auth.uid()) for a staff/manager caller never equals their
-- own auth.uid(), the owner-only RLS (migration_026) rejects every such
-- insert — a staff-recorded sale would fail to post its cash entry, or (pre-
-- fix, before cashApi.ts was ever business-scoped) throw a misleading error
-- after the sale itself already committed.
--
-- These two functions are the one legitimate, narrow bypass of the owner-only
-- wall: they always write/delete under the CALLER'S RESOLVED BUSINESS id
-- (business_id_for(auth.uid())), never an id the caller supplies — so an
-- active member of business O can post a cash entry attributed to O, but can
-- never post one attributed to any other business. This is not a general
-- escape hatch; it does exactly what a direct owner insert would have done,
-- just on behalf of an owner's authorized staff/manager.

-- RETURNS void (not the inserted row): the caller doesn't need it back
-- (postMovement discards it), and a staff caller has no other way to read
-- cash_movements at all — returning the full row would be a needless extra
-- exposure of owner-only data through a side channel.
CREATE OR REPLACE FUNCTION post_cash_movement(
  p_account      text,
  p_direction    text,
  p_amount       numeric,
  p_category     text,
  p_ref_table    text DEFAULT NULL,
  p_ref_id       text DEFAULT NULL,
  p_transfer_id  uuid DEFAULT NULL,
  p_note         text DEFAULT NULL,
  p_created_at   timestamptz DEFAULT now()
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := business_id_for(auth.uid());
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'not a recognized business member';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  INSERT INTO cash_movements
    (user_id, account, direction, amount, category, ref_table, ref_id, transfer_id, note, created_at)
  VALUES
    (v_business_id, p_account, p_direction, p_amount, p_category, p_ref_table, p_ref_id, p_transfer_id, p_note, p_created_at);
END $$;

-- Mirrors postMovement's counterpart (deleteMovementsByRef) — same
-- owner-scoping rationale, used when reversing a deleted sale/expense's
-- entire cash entry set for one ref (e.g. all movements for one sale_group_id,
-- which is unique per sale — safe to delete every matching row).
CREATE OR REPLACE FUNCTION delete_cash_movements_by_ref(p_ref_table text, p_ref_id text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := business_id_for(auth.uid());
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'not a recognized business member';
  END IF;

  DELETE FROM cash_movements
   WHERE user_id = v_business_id AND ref_table = p_ref_table AND ref_id = p_ref_id;
END $$;

-- Reverses ONE specific payment's movement, not every movement sharing a ref:
-- debts.id (unlike sales' sale_group_id) is NOT unique per cash entry — a
-- single debt can accumulate many partial payments, each its own
-- cash_movements row sharing ref_id = debt.id. Deleting by ref alone (the
-- function above) would wipe every payment ever made on that debt, not just
-- the one being undone/deleted. Matches the most recent row for this ref
-- within the caller's own business scoped by amount (mirroring the
-- amount-matching already done client-side in Debts.tsx), and deletes at
-- most one row (LIMIT 1) even if two payments happen to share an amount.
CREATE OR REPLACE FUNCTION delete_cash_movement_by_ref_amount(p_ref_table text, p_ref_id text, p_amount numeric)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := business_id_for(auth.uid());
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'not a recognized business member';
  END IF;

  DELETE FROM cash_movements
   WHERE id = (
     SELECT id FROM cash_movements
     WHERE user_id = v_business_id AND ref_table = p_ref_table AND ref_id = p_ref_id
       AND abs(amount - p_amount) < 0.001
     ORDER BY created_at DESC
     LIMIT 1
   );
END $$;
