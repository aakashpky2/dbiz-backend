-- Run this inside your Supabase SQL Editor to create the Template table

CREATE TABLE templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT,
    placeholders JSONB DEFAULT '[]'::jsonb,
    group_id TEXT,
    sub_group_id TEXT,
    category_id TEXT,
    is_published BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optional: Enable Row Level Security (RLS) if you plan on using anon keys directly. 
-- Since your Node backend is using Service Role / Admin keys, this isn't strictly required for it to work.
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- If you want to view them in the dashboard without restrictions
CREATE POLICY "Enable all for admins" ON templates FOR ALL USING (true);
