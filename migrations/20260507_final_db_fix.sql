-- Final Database Safety Fixes

-- Works Table
alter table works add column if not exists occurrence text;
alter table works add column if not exists financial_year text;
alter table works add column if not exists period text;
alter table works add column if not exists priority text default 'Medium';
alter table works add column if not exists reference_type text default 'Direct';
alter table works add column if not exists associate_id uuid;
alter table works add column if not exists associate_name text;
alter table works add column if not exists associate_effective_date date;
alter table works add column if not exists due_date date;
alter table works add column if not exists finish_by_date date;
alter table works add column if not exists finish_by_time time;
alter table works add column if not exists duration_days integer default 0;
alter table works add column if not exists duration_hours integer default 0;
alter table works add column if not exists professional_fee numeric default 0;
alter table works add column if not exists government_fee numeric default 0;
alter table works add column if not exists gst_percentage numeric default 18;
alter table works add column if not exists gst_amount numeric default 0;
alter table works add column if not exists total_amount numeric default 0;
alter table works add column if not exists remarks text;
alter table works add column if not exists status text default 'Not Started';
alter table works add column if not exists proposal_id uuid;
alter table works add column if not exists pending_order integer;

-- Proposals Table
alter table proposals add column if not exists converted_to_work boolean default false;
alter table proposals add column if not exists converted_at timestamptz;
alter table proposals add column if not exists converted_by uuid;
alter table proposals add column if not exists conversion_status text default 'Not Converted';

-- Data Cleanup
update proposals p
set
  status = 'Closed',
  current_stage = 'Closed',
  converted_to_work = true,
  conversion_status = 'Converted',
  converted_at = coalesce(p.converted_at, now())
where exists (
  select 1 from works w where w.proposal_id = p.id
)
and (
  p.converted_to_work is distinct from true
  or lower(coalesce(p.status, '')) = 'converted'
  or lower(coalesce(p.current_stage, '')) = 'converted'
  or coalesce(p.conversion_status, '') <> 'Converted'
);

update proposals p
set
  status = 'Accepted',
  current_stage = 'Accepted',
  converted_to_work = false,
  conversion_status = 'Not Converted',
  converted_at = null,
  converted_by = null
where not exists (
  select 1 from works w where w.proposal_id = p.id
)
and (
  lower(coalesce(p.status, '')) = 'converted'
  or lower(coalesce(p.current_stage, '')) = 'converted'
  or p.converted_to_work = true
  or coalesce(p.conversion_status, '') = 'Converted'
);
