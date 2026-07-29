-- Safe B-Tree Indexes for frequently filtered columns
-- These are safe to run concurrently and will not block reads/writes.

CREATE INDEX IF NOT EXISTS idx_proposals_client_id ON proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_profile_id ON proposals(profile_id);

CREATE INDEX IF NOT EXISTS idx_works_proposal_id ON works(proposal_id);
CREATE INDEX IF NOT EXISTS idx_works_client_id ON works(client_id);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(status);

CREATE INDEX IF NOT EXISTS idx_tasks_work_id ON tasks(work_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_rate_cards_status ON rate_cards(status);

-- Complete.
