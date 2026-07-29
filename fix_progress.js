require('dotenv').config({ path: '../backend/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  try {
    console.log('--- REPAIRING HISTORICAL PROGRESS ---');
    
    // Find all completed works
    const { data: works, error: worksErr } = await supabase
      .from('works')
      .select('id, status, workflow_status');
      
    if (worksErr) throw worksErr;

    const completedWorks = works.filter(w => 
      (w.status || '').toUpperCase() === 'COMPLETED' || 
      (w.workflow_status || '').toUpperCase() === 'COMPLETED'
    );
    
    console.log(`Found ${completedWorks.length} completed works.`);
    const workIds = completedWorks.map(w => w.id);

    if (workIds.length === 0) {
        console.log('No works to repair.');
        return;
    }

    // Fetch executions for those works
    const { data: execs, error: execsErr } = await supabase
      .from('workflow_execution_instances')
      .select('id, work_id, status, progress_percentage')
      .in('work_id', workIds);
      
    if (execsErr) throw execsErr;
    
    console.log(`Found ${execs.length} corresponding workflow executions.`);

    const toUpdate = execs.filter(e => e.progress_percentage !== 100);
    
    console.log(`Found ${toUpdate.length} executions needing progress_percentage update to 100.`);

    for (const exec of toUpdate) {
        console.log(`Updating execution ${exec.id} for work ${exec.work_id} to progress=100...`);
        const { error: updErr } = await supabase
            .from('workflow_execution_instances')
            .update({ progress_percentage: 100, status: 'COMPLETED' })
            .eq('id', exec.id);
            
        if (updErr) {
            console.error(`Failed to update ${exec.id}:`, updErr);
        } else {
            console.log(`Successfully updated ${exec.id}`);
        }
    }
    
    console.log('--- REPAIR COMPLETE ---');

  } catch (err) {
    console.error('Error during repair:', err);
  }
}

run();
