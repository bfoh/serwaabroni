-- migration_021: impersonation audit trail.
-- Records when a super-admin starts/stops acting as a tenant.
-- Run AFTER migration_005 (needs is_super_admin()).

CREATE TABLE IF NOT EXISTS impersonation_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('start','stop')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE impersonation_events ENABLE ROW LEVEL SECURITY;

-- Admins may read the audit trail. Inserts come from the service role (start,
-- in the edge function) or the SECURITY DEFINER RPC below (stop).
CREATE POLICY "Super admin reads impersonation events"
  ON impersonation_events FOR SELECT USING (is_super_admin(auth.uid()));

-- Stop event is logged from the client while the TENANT session is active, so
-- it cannot rely on is_super_admin(auth.uid()). This SECURITY DEFINER function
-- closes the most recent open 'start' for the current (tenant) user.
CREATE OR REPLACE FUNCTION admin_log_impersonation_stop()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin
    FROM impersonation_events
    WHERE tenant_id = auth.uid() AND action = 'start'
    ORDER BY created_at DESC LIMIT 1;
  IF v_admin IS NULL THEN RETURN; END IF;
  INSERT INTO impersonation_events (admin_id, tenant_id, action)
    VALUES (v_admin, auth.uid(), 'stop');
END $$;
