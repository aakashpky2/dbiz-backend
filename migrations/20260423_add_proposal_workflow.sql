-- Add sent details to proposals
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_by_name TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_by_email TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_by_position TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_by_phone TEXT;

-- Create proposal_send_logs table
CREATE TABLE IF NOT EXISTS proposal_send_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES proposals(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    sender_email TEXT NOT NULL,
    sender_position TEXT,
    sender_phone TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create proposal_history table
CREATE TABLE IF NOT EXISTS proposal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES proposals(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    previous_stage TEXT,
    new_stage TEXT,
    previous_version TEXT,
    new_version TEXT,
    performed_by TEXT,
    performed_at TIMESTAMPTZ DEFAULT now(),
    description TEXT,
    metadata JSONB
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_proposal_send_logs_proposal_id ON proposal_send_logs(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_history_proposal_id ON proposal_history(proposal_id);
