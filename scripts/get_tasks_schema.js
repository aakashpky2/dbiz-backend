const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Tasks:");
    const { data: tasks } = await supabase.from('tasks').select('*').limit(1);
    console.log(tasks ? Object.keys(tasks[0]) : "No tasks");
    
    console.log("Works:");
    const { data: works } = await supabase.from('works').select('*').limit(1);
    console.log(works ? Object.keys(works[0]) : "No works");
}
run();
