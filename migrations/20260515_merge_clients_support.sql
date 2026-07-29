-- ==========================================
-- Merge Clients Support Migration
-- ==========================================

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS merged_into_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS merge_history JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_clients_is_deleted ON clients(is_deleted);
CREATE INDEX IF NOT EXISTS idx_clients_merged_into ON clients(merged_into_client_id);

-- Ensure updated_at exists (it was added in fix_missing_tables.sql but double check)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
