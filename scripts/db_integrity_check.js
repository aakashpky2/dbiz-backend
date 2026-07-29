require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runIntegrityCheck() {
    console.log("Starting Database Integrity Check...\n");

    // 1. Check Orphan Records
    console.log("--- ORPHAN RECORDS CHECK ---");
    
    // Works without proposals
    const { count: orphanWorks } = await supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .is('proposal_id', null);
    console.log(`Orphan Works (no proposal_id): ${orphanWorks || 0}`);

    // Tasks without works
    const { count: orphanTasks } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .is('work_id', null);
    console.log(`Orphan Tasks (no work_id): ${orphanTasks || 0}`);

    // 2. Duplicate Active Records
    console.log("\n--- DUPLICATE ACTIVE RECORDS CHECK ---");
    
    // Active Rate Cards (grouped by service_name or something similar)
    const { data: rateCards } = await supabase
        .from('rate_cards')
        .select('service_name')
        .eq('status', 'Active');
    
    if (rateCards) {
        const counts = {};
        rateCards.forEach(r => counts[r.service_name] = (counts[r.service_name] || 0) + 1);
        const duplicates = Object.entries(counts).filter(([name, c]) => c > 1);
        console.log(`Duplicate Active Rate Cards (by service_name): ${duplicates.length}`);
    }

    console.log("\nIntegrity check complete.");
}

runIntegrityCheck().catch(console.error);
