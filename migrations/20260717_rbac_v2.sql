BEGIN;

-- 1. Add permission version to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS permission_version INT NOT NULL DEFAULT 1;

-- 2. Responsibility Templates
CREATE TABLE IF NOT EXISTS responsibility_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    status TEXT DEFAULT 'ACTIVE',
    is_system_template BOOLEAN DEFAULT false,
    created_by UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS responsibility_template_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    responsibility_template_id UUID NOT NULL REFERENCES responsibility_templates(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(responsibility_template_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_rtp_template_id ON responsibility_template_permissions(responsibility_template_id);
CREATE INDEX IF NOT EXISTS idx_rtp_permission_key ON responsibility_template_permissions(permission_key);

CREATE TABLE IF NOT EXISTS responsibility_template_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_template_id UUID NOT NULL REFERENCES responsibility_templates(id) ON DELETE CASCADE,
    child_template_id UUID NOT NULL REFERENCES responsibility_templates(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(parent_template_id, child_template_id),
    CHECK (parent_template_id != child_template_id)
);
CREATE INDEX IF NOT EXISTS idx_rtd_parent ON responsibility_template_dependencies(parent_template_id);
CREATE INDEX IF NOT EXISTS idx_rtd_child ON responsibility_template_dependencies(child_template_id);

-- 3. Assignments
CREATE TABLE IF NOT EXISTS user_responsibilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(uid) ON DELETE CASCADE,
    responsibility_template_id UUID NOT NULL REFERENCES responsibility_templates(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    reason TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ur_user_id ON user_responsibilities(user_id);
CREATE INDEX IF NOT EXISTS idx_ur_valid_until ON user_responsibilities(valid_until);

CREATE TABLE IF NOT EXISTS role_responsibilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES system_roles(id) ON DELETE CASCADE,
    responsibility_template_id UUID NOT NULL REFERENCES responsibility_templates(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(role_id, responsibility_template_id)
);
CREATE INDEX IF NOT EXISTS idx_rr_role_id ON role_responsibilities(role_id);

-- 4. Overrides
CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(uid) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    effect TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
    granted_by UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    reason TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_upo_user_id ON user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_upo_permission_key ON user_permission_overrides(permission_key);
CREATE INDEX IF NOT EXISTS idx_upo_valid_until ON user_permission_overrides(valid_until);

-- 5. Scopes (attached to the responsibility assignment)
CREATE TABLE IF NOT EXISTS user_responsibility_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_responsibility_id UUID NOT NULL REFERENCES user_responsibilities(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    granted_by UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_urs_responsibility_id ON user_responsibility_scopes(user_responsibility_id);
CREATE INDEX IF NOT EXISTS idx_urs_permission_key ON user_responsibility_scopes(permission_key);
CREATE INDEX IF NOT EXISTS idx_urs_valid_until ON user_responsibility_scopes(valid_until);

-- 6. Audit Logs
CREATE TABLE IF NOT EXISTS permission_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_user_id UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    permission_key TEXT,
    action TEXT NOT NULL,
    performed_by UUID REFERENCES user_profiles(uid) ON DELETE SET NULL,
    reason TEXT,
    ip_address TEXT,
    browser TEXT,
    device TEXT,
    previous_permission_set JSONB,
    new_permission_set JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pal_target_user_id ON permission_audit_logs(target_user_id);

-- 7. Two-Tier Versioning: System State
CREATE TABLE IF NOT EXISTS rbac_system_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    configuration_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure exactly one row exists
INSERT INTO rbac_system_state (configuration_version)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM rbac_system_state);

-- Function to increment system configuration version
CREATE OR REPLACE FUNCTION increment_rbac_configuration_version()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE rbac_system_state
    SET configuration_version = configuration_version + 1,
        updated_at = NOW();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers for Shared Configuration Changes
DROP TRIGGER IF EXISTS trg_increment_config_rt ON responsibility_templates;
CREATE TRIGGER trg_increment_config_rt
AFTER INSERT OR UPDATE OR DELETE ON responsibility_templates
FOR EACH STATEMENT EXECUTE FUNCTION increment_rbac_configuration_version();

DROP TRIGGER IF EXISTS trg_increment_config_rtp ON responsibility_template_permissions;
CREATE TRIGGER trg_increment_config_rtp
AFTER INSERT OR UPDATE OR DELETE ON responsibility_template_permissions
FOR EACH STATEMENT EXECUTE FUNCTION increment_rbac_configuration_version();

DROP TRIGGER IF EXISTS trg_increment_config_rtd ON responsibility_template_dependencies;
CREATE TRIGGER trg_increment_config_rtd
AFTER INSERT OR UPDATE OR DELETE ON responsibility_template_dependencies
FOR EACH STATEMENT EXECUTE FUNCTION increment_rbac_configuration_version();

DROP TRIGGER IF EXISTS trg_increment_config_rr ON role_responsibilities;
CREATE TRIGGER trg_increment_config_rr
AFTER INSERT OR UPDATE OR DELETE ON role_responsibilities
FOR EACH STATEMENT EXECUTE FUNCTION increment_rbac_configuration_version();

-- Function to increment user's permission_version
CREATE OR REPLACE FUNCTION increment_user_permission_version()
RETURNS TRIGGER AS $$
DECLARE
    target_user_id UUID;
BEGIN
    -- Determine target_user_id based on table
    IF TG_TABLE_NAME = 'user_roles' THEN
        IF TG_OP = 'DELETE' THEN
            target_user_id := OLD.user_id;
        ELSE
            target_user_id := NEW.user_id;
        END IF;
    ELSIF TG_TABLE_NAME = 'user_responsibilities' THEN
        IF TG_OP = 'DELETE' THEN
            target_user_id := OLD.user_id;
        ELSE
            target_user_id := NEW.user_id;
        END IF;
    ELSIF TG_TABLE_NAME = 'user_permission_overrides' THEN
        IF TG_OP = 'DELETE' THEN
            target_user_id := OLD.user_id;
        ELSE
            target_user_id := NEW.user_id;
        END IF;
    ELSIF TG_TABLE_NAME = 'user_responsibility_scopes' THEN
        -- Need to lookup user_id via user_responsibilities
        IF TG_OP = 'DELETE' THEN
            SELECT user_id INTO target_user_id FROM user_responsibilities WHERE id = OLD.user_responsibility_id;
        ELSE
            SELECT user_id INTO target_user_id FROM user_responsibilities WHERE id = NEW.user_responsibility_id;
        END IF;
    END IF;

    IF target_user_id IS NOT NULL THEN
        UPDATE user_profiles
        SET permission_version = permission_version + 1
        WHERE uid = target_user_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_increment_user_version_ur ON user_responsibilities;
CREATE TRIGGER trg_increment_user_version_ur
AFTER INSERT OR UPDATE OR DELETE ON user_responsibilities
FOR EACH ROW EXECUTE FUNCTION increment_user_permission_version();

DROP TRIGGER IF EXISTS trg_increment_user_version_upo ON user_permission_overrides;
CREATE TRIGGER trg_increment_user_version_upo
AFTER INSERT OR UPDATE OR DELETE ON user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION increment_user_permission_version();

DROP TRIGGER IF EXISTS trg_increment_user_version_urs ON user_responsibility_scopes;
CREATE TRIGGER trg_increment_user_version_urs
AFTER INSERT OR UPDATE OR DELETE ON user_responsibility_scopes
FOR EACH ROW EXECUTE FUNCTION increment_user_permission_version();

-- Handle user_roles if the table exists (Legacy schema compatibility)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
        DROP TRIGGER IF EXISTS trg_increment_user_version_uroles ON user_roles;
        CREATE TRIGGER trg_increment_user_version_uroles
        AFTER INSERT OR UPDATE OR DELETE ON user_roles
        FOR EACH ROW EXECUTE FUNCTION increment_user_permission_version();
    END IF;
END;
$$;

COMMIT;
