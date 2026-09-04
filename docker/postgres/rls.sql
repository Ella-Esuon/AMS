-- ─── Row-Level Security Policies ─────────────────────────────────────────────
-- Applied AFTER migrations via Prisma migrate
-- Enable RLS on all tenant-scoped tables and enforce tenant isolation

-- Helper function to get current tenant id from session
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN RETURN NULL;
  WHEN undefined_object THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Helper function to check if RLS is bypassed (super admin)
CREATE OR REPLACE FUNCTION bypass_rls() RETURNS boolean AS $$
BEGIN
  RETURN current_setting('app.bypass_rls', true)::boolean;
EXCEPTION
  WHEN invalid_text_representation THEN RETURN false;
  WHEN undefined_object THEN RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ─── users table ─────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

CREATE POLICY users_tenant_insert ON users
  FOR INSERT WITH CHECK (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── user_profiles table ─────────────────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_tenant_isolation ON user_profiles
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

CREATE POLICY user_profiles_tenant_insert ON user_profiles
  FOR INSERT WITH CHECK (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── departments table ────────────────────────────────────────────────────────
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;

CREATE POLICY departments_tenant_isolation ON departments
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

CREATE POLICY departments_tenant_insert ON departments
  FOR INSERT WITH CHECK (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── locations table ──────────────────────────────────────────────────────────
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;

CREATE POLICY locations_tenant_isolation ON locations
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── roles table ──────────────────────────────────────────────────────────────
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;

CREATE POLICY roles_tenant_isolation ON roles
  USING (bypass_rls() OR "tenantId" IS NULL OR "tenantId" = current_tenant_id());

-- ─── user_roles table ─────────────────────────────────────────────────────────
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY user_roles_tenant_isolation ON user_roles
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── user_policies table ──────────────────────────────────────────────────────
ALTER TABLE user_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY user_policies_tenant_isolation ON user_policies
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── refresh_tokens table ─────────────────────────────────────────────────────
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY refresh_tokens_tenant_isolation ON refresh_tokens
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── audit_logs table ─────────────────────────────────────────────────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── attendance_records table ─────────────────────────────────────────────────
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

CREATE POLICY attendance_records_tenant_isolation ON attendance_records
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── attendance_breaks table ──────────────────────────────────────────────────
ALTER TABLE attendance_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_breaks FORCE ROW LEVEL SECURITY;

CREATE POLICY attendance_breaks_tenant_isolation ON attendance_breaks
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── attendance_policies table ────────────────────────────────────────────────
ALTER TABLE attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY attendance_policies_tenant_isolation ON attendance_policies
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── shifts table ──────────────────────────────────────────────────────────────
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;

CREATE POLICY shifts_tenant_isolation ON shifts
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── shift_break_rules table ──────────────────────────────────────────────────
ALTER TABLE shift_break_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_break_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY shift_break_rules_tenant_isolation ON shift_break_rules
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── shift_assignments table ──────────────────────────────────────────────────
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY shift_assignments_tenant_isolation ON shift_assignments
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── shift_rotations table ─────────────────────────────────────────────────────
ALTER TABLE shift_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_rotations FORCE ROW LEVEL SECURITY;

CREATE POLICY shift_rotations_tenant_isolation ON shift_rotations
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── shift_rotation_slots table ────────────────────────────────────────────────
ALTER TABLE shift_rotation_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_rotation_slots FORCE ROW LEVEL SECURITY;

CREATE POLICY shift_rotation_slots_tenant_isolation ON shift_rotation_slots
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── leave_types table ─────────────────────────────────────────────────────────
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;

CREATE POLICY leave_types_tenant_isolation ON leave_types
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── leave_balances table ──────────────────────────────────────────────────────
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY leave_balances_tenant_isolation ON leave_balances
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── leave_requests table ──────────────────────────────────────────────────────
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY leave_requests_tenant_isolation ON leave_requests
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- ─── notifications table ───────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_tenant_isolation ON notifications
  USING (bypass_rls() OR "tenantId" = current_tenant_id());

-- Grant ams_app role policy access
ALTER TABLE users OWNER TO ams_user;
ALTER TABLE user_profiles OWNER TO ams_user;
ALTER TABLE departments OWNER TO ams_user;
ALTER TABLE locations OWNER TO ams_user;
ALTER TABLE roles OWNER TO ams_user;
ALTER TABLE user_roles OWNER TO ams_user;
ALTER TABLE user_policies OWNER TO ams_user;
ALTER TABLE refresh_tokens OWNER TO ams_user;
ALTER TABLE audit_logs OWNER TO ams_user;
ALTER TABLE attendance_records OWNER TO ams_user;
ALTER TABLE attendance_breaks OWNER TO ams_user;
ALTER TABLE attendance_policies OWNER TO ams_user;
ALTER TABLE shifts OWNER TO ams_user;
ALTER TABLE shift_break_rules OWNER TO ams_user;
ALTER TABLE shift_assignments OWNER TO ams_user;
ALTER TABLE shift_rotations OWNER TO ams_user;
ALTER TABLE shift_rotation_slots OWNER TO ams_user;
ALTER TABLE leave_types OWNER TO ams_user;
ALTER TABLE leave_balances OWNER TO ams_user;
ALTER TABLE leave_requests OWNER TO ams_user;
ALTER TABLE notifications OWNER TO ams_user;
