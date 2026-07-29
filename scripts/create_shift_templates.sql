CREATE TABLE shift_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    working_days TEXT[] NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read and insert shift templates
CREATE POLICY "Allow authenticated read" ON shift_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert" ON shift_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update" ON shift_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated delete" ON shift_templates FOR DELETE TO authenticated USING (true);

-- Also allow anon read/insert if your app works without strict auth on this table
CREATE POLICY "Allow public read" ON shift_templates FOR SELECT TO anon USING (true);
CREATE POLICY "Allow public insert" ON shift_templates FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow public update" ON shift_templates FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow public delete" ON shift_templates FOR DELETE TO anon USING (true);
