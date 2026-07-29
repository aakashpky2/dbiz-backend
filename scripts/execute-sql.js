const { supabase } = require('../lib/supabase');
const fs = require('fs');
const path = require('path');

async function executeSqlFile() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Please provide a path to a SQL file.');
        process.exit(1);
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    
    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(absolutePath, 'utf8');
    console.log(`Executing SQL from ${absolutePath}...`);

    try {
        // Try 'execute_sql' as seen in other fix scripts
        const { error } = await supabase.rpc('execute_sql', {
            sql_query: sql
        });

        if (error) {
            console.error('Error executing SQL via execute_sql:', error);
            
            // Fallback try 'run_sql'
            console.log('Trying fallback run_sql...');
            const { error: error2 } = await supabase.rpc('run_sql', {
                sql_query: sql
            });
            
            if (error2) {
                console.error('Error executing SQL via run_sql:', error2);
                console.log('\n--- MANUAL SQL EXECUTION REQUIRED ---');
                console.log('The database user does not have permissions to run arbitrary SQL via RPC.');
                console.log('Please copy the contents of the SQL file and run it in the Supabase SQL Editor.');
                console.log('---------------------------------------\n');
                process.exit(1);
            }
        }
        
        console.log('SQL executed successfully!');
    } catch (e) {
        console.error('Execution failed:', e.message);
        process.exit(1);
    }
}

executeSqlFile();
