require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function repairOrphans() {
    const backupData = JSON.parse(fs.readFileSync('./orphan_works_backup.json', 'utf8'));
    
    // Existing proposals for CDS and ABC
    const proposalMap = {
        '8d7c1e3a-7647-4060-b697-1d4ce9b0357e': '8898361f-9f63-4788-8ec6-59eb5900ac18', // CDS
        '34c34db0-1061-49dd-8c1d-f5d16a2b7c0f': 'c6ef3161-6dfd-4c9a-87fb-74d3eeade383'  // ABC
    };
    
    for (const work of backupData) {
        let proposalId = proposalMap[work.client_id];
        
        if (!proposalId) {
            // Need to create a direct/dummy proposal
            console.log(`Creating direct proposal for client ${work.client_id}...`);
            const { data: newProp, error: propErr } = await supabase
                .from('proposals')
                .insert({
                    client_id: work.client_id,
                    client_name: work.client_name,
                    profile_id: work.profile_id,
                    status: 'Accepted',
                    current_stage: 'Closed',
                    total_amount: 0,
                    description: 'Directly imported/created work (Repaired)',
                    converted_to_work: true,
                    conversion_status: 'Converted'
                })
                .select('id')
                .single();
                
            if (propErr) {
                console.error("Failed to create proposal:", propErr);
                continue;
            }
            proposalId = newProp.id;
            proposalMap[work.client_id] = proposalId; // Cache it so multiple works use the same proposal
            console.log(`Created proposal ${proposalId}`);
        }
        
        // Update the work
        const { error: updateErr } = await supabase
            .from('works')
            .update({ proposal_id: proposalId })
            .eq('id', work.id);
            
        if (updateErr) {
            console.error(`Failed to repair work ${work.id}:`, updateErr);
        } else {
            console.log(`Successfully repaired work ${work.id} -> Proposal ${proposalId}`);
        }
    }
    
    console.log("Repair process finished.");
}

repairOrphans().catch(console.error);
