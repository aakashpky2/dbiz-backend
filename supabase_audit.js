require('dotenv').config({ path: '../backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  try {
    console.log('--- QUERY 1: Completed Works with Progress ---');
    const { data: works, error: worksErr } = await supabase
      .from('works')
      .select('id, status, workflow_status');
    
    const { data: execs, error: execsErr } = await supabase
      .from('workflow_execution_instances')
      .select('id, work_id, status, progress_percentage');
    
    const execMap = new Map();
    (execs || []).forEach(e => execMap.set(e.work_id, e));

    const completed = (works || []).filter(w => 
      (w.status || '').toUpperCase() === 'COMPLETED' || 
      (w.workflow_status || '').toUpperCase() === 'COMPLETED'
    );

    const q1Results = completed.map(w => {
      const e = execMap.get(w.id);
      return {
        id: w.id,
        status: w.status,
        workflow_status: w.workflow_status,
        execution_id: e?.id,
        execution_status: e?.status,
        progress_percentage: e?.progress_percentage
      };
    });

    console.log(JSON.stringify(q1Results, null, 2));

    console.log('\n--- QUERY 2: Completed Employee Candidates ---');
    const { data: steps } = await supabase
      .from('workflow_step_instances')
      .select('execution_instance_id, completed_by, actual_completed_at, step_name, status, workflow_execution_instances(work_id)')
      .eq('status', 'COMPLETED');
    
    const { data: employees } = await supabase.from('employees').select('id, full_name');
    const empMap = new Map();
    (employees || []).forEach(e => empMap.set(e.id, e.full_name));

    const q2Results = (steps || [])
      .filter(s => s.workflow_execution_instances)
      .map(s => ({
        work_id: s.workflow_execution_instances.work_id,
        completed_by: s.completed_by,
        full_name: empMap.get(s.completed_by),
        actual_completed_at: s.actual_completed_at,
        step_name: s.step_name
      }))
      .sort((a, b) => new Date(b.actual_completed_at) - new Date(a.actual_completed_at));

    console.log(JSON.stringify(q2Results, null, 2));

  } catch (err) {
    console.error(err);
  }
}

run();
