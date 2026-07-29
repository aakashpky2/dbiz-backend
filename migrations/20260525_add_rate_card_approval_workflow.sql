-- Add approval fields to rate_cards
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50) DEFAULT 'draft';
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Create rate_card_item_change_requests table for item-level approval buffer
CREATE TABLE IF NOT EXISTS rate_card_item_change_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rate_card_id UUID NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
    rate_card_item_id UUID REFERENCES rate_card_items(id) ON DELETE SET NULL,
    change_type VARCHAR(50) NOT NULL, -- 'add', 'edit', 'delete'
    old_data JSONB,
    new_data JSONB,
    approval_status VARCHAR(50) DEFAULT 'pending_approval',
    submitted_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejected_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    rejected_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
