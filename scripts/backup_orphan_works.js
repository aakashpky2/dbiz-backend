require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runBackup() {
    console.log("Fetching orphan works...");

    const { data: orphanWorks, error } = await supabase
        .from('works')
        .select('*')
        .is('proposal_id', null);
        
    if (error) {
        console.error("Error fetching orphan works:", error);
        return;
    }

    if (!orphanWorks || orphanWorks.length === 0) {
        console.log("No orphan works found.");
        return;
    }

    console.log(`Found ${orphanWorks.length} orphan works.`);

    // Save backup
    const backupPath = path.join(__dirname, 'orphan_works_backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(orphanWorks, null, 2));
    console.log(`Backup saved to ${backupPath}`);

    // Analyze
    console.log("\n--- ORPHAN WORKS ANALYSIS ---");
    let missingClient = 0;
    let testData = 0;
    
    orphanWorks.forEach(work => {
        let isTest = false;
        const name = work.client_name ? work.client_name.toLowerCase() : '';
        const title = work.title ? work.title.toLowerCase() : '';
        
        if (name.includes('test') || title.includes('test') || name.includes('dummy')) {
            isTest = true;
            testData++;
        }
        if (!work.client_id) {
            missingClient++;
        }
        
        console.log(`Work ID: ${work.id}`);
        console.log(`  Client: ${work.client_name || 'N/A'} (ID: ${work.client_id || 'N/A'})`);
        console.log(`  Title: ${work.title || 'N/A'}`);
        console.log(`  Created At: ${work.created_at}`);
        console.log(`  Is Test/Junk: ${isTest ? 'Yes' : 'No'}`);
        console.log('---');
    });
    
    console.log(`\nSummary:`);
    console.log(`- ${testData} works appear to be test/junk data.`);
    console.log(`- ${missingClient} works are missing a client_id entirely.`);
}

runBackup().catch(console.error);
