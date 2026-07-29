const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("No Supabase URL/Key found");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    console.log("Starting legacy works migration...");
    
    // Fetch all works
    const { data: works, error: worksError } = await supabase.from('works').select('*');
    if (worksError) {
        console.error("Failed to fetch works:", worksError);
        process.exit(1);
    }
    console.log(`Fetched ${works.length} rows from works table.`);

    // Fetch all user profiles to map 'entered_by' text uid to 'created_by' UUID
    const { data: profiles } = await supabase.from('user_profiles').select('id, uid, email');
    const { data: employees } = await supabase.from('employees').select('id, email');
    
    const profileMap = {};
    if (profiles && employees) {
        profiles.forEach(p => {
            const emp = employees.find(e => e.email === p.email);
            if (emp) {
                profileMap[p.uid] = emp.id;
            }
        });
    }

    // Fetch workflow templates to resolve workflow_template_id
    const { data: templates } = await supabase.from('workflow_templates').select('id, work_type_id').eq('is_active', true);
    const templateMap = {};
    if (templates) {
        templates.forEach(t => templateMap[t.work_type_id] = t.id);
    }

    // Fetch existing tasks to avoid duplicates (based on legacy_work_id stored in description or natively if we added column)
    const { data: existingTasks } = await supabase.from('tasks').select('id, description');
    const existingWorkIds = new Set();
    if (existingTasks) {
        existingTasks.forEach(t => {
            if (t.description && t.description.includes('legacy_work_id:')) {
                const match = t.description.match(/legacy_work_id:([a-fA-F0-9-]+)/);
                if (match) existingWorkIds.add(match[1]);
            }
        });
    }

    // Fetch valid work types
    const { data: workTypes } = await supabase.from('work_types').select('id');
    const validWorkTypeIds = new Set();
    if (workTypes) {
        workTypes.forEach(wt => validWorkTypeIds.add(wt.id));
    }

    const tasksToInsert = [];
    for (const w of works) {
        if (existingWorkIds.has(w.id)) {
            console.log(`Work ${w.id} already mirrored. Skipping.`);
            continue;
        }

        let dbUserId = profileMap[w.entered_by] || null;
        let templateId = templateMap[w.work_type_id] || null;
        
        // Ensure work_type_id is valid
        let finalWorkTypeId = w.work_type_id;
        if (finalWorkTypeId && !validWorkTypeIds.has(finalWorkTypeId)) {
            finalWorkTypeId = null; // nullify if invalid
        }

        tasksToInsert.push({
            client_id: w.client_id,
            client_name: w.client_name,
            work_type_id: finalWorkTypeId,
            workflow_template_id: templateId,
            title: w.work_type_name || 'Legacy Work',
            description: `legacy_work_id:${w.id}\n${w.remarks || ''}`,
            priority: w.priority || 'Medium',
            due_date: w.due_date,
            status: w.workflow_status === 'UNASSIGNED' ? 'AVAILABLE' : (w.workflow_status || 'AVAILABLE'),
            created_by: dbUserId,
            assigned_team_id: w.assigned_team_id,
            assignment_status: w.assignment_status || 'UNASSIGNED',
            claimed_by: w.current_handler_id,
            created_at: w.created_at,
            updated_at: w.updated_at
        });
    }

    if (tasksToInsert.length === 0) {
        console.log("No new works to migrate.");
        return;
    }

    // Batch insert tasks
    // Chunking to avoid payload size issues
    const chunkSize = 100;
    for (let i = 0; i < tasksToInsert.length; i += chunkSize) {
        const chunk = tasksToInsert.slice(i, i + chunkSize);
        const { error: insertError } = await supabase.from('tasks').insert(chunk);
        if (insertError) {
            console.error(`Error inserting chunk ${i}:`, insertError);
        } else {
            console.log(`Inserted ${chunk.length} tasks.`);
        }
    }

    console.log("Migration completed.");
}

runMigration();
