-- migration_032: expose just the business_name to an active Staff member.
-- Found live: Dashboard.tsx's header falls back to a hardcoded placeholder
-- ("Maame Doku's Shop") when state.businessProfile is null. That fallback
-- was dead code before RBAC — an owner always has SELECT access to their own
-- business_profiles row — but migration_027 correctly blocks Staff (not
-- Manager, who keeps SELECT) from reading business_profiles at all, which
-- means an active Staff member's businessProfile is now PERMANENTLY null,
-- making this placeholder permanently visible in place of their real
-- employer's business name.
--
-- Rather than loosen the business_profiles SELECT policy (which would leak
-- phone/email/sms_sender_id and other genuinely sensitive fields to Staff),
-- expose only the business_name through a narrow SECURITY DEFINER function.
-- No role check — any active tenant member (owner, manager, or staff) may
-- see their own business's name; that's not sensitive, unlike the rest of
-- the profile.
CREATE OR REPLACE FUNCTION business_name_for(uid uuid)
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT business_name FROM business_profiles WHERE user_id = business_id_for(uid);
$$;
