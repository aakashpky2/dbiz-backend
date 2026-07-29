const { Pool } = require('pg');
require('dotenv').config({path: './.env'});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = `
CREATE TABLE IF NOT EXISTS public.attendance_activity_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL,
    attendance_date date NOT NULL,
    activity_type text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_minutes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_emp_date 
ON public.attendance_activity_logs(employee_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_time 
ON public.attendance_activity_logs(started_at, ended_at);
`;

pool.query(query)
  .then(() => {
    console.log('Table and indexes created successfully');
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
