const { supabase } = require('../lib/supabase');

async function removeOldSignatory() {
    console.log('Fetching templates...');
    const { data: templates, error } = await supabase.from('templates').select('*');
    if (error) {
        console.error('Error fetching templates:', error);
        return;
    }

    // Regex to match the old table containing "Authorised Signatory"
    // Since it could be in a <table>, we'll try to find the <table> tag that encloses it.
    for (const template of templates) {
        if (!template.content) continue;
        
        let newContent = template.content;

        // Try to remove the table specifically (Tiptap format)
        newContent = newContent.replace(/<table[^>]*>([\s\S]*?)Authorised Signatory([\s\S]*?)<\/table>/i, '');
        
        // Also remove the specific div format from Standard Professional Proposal
        newContent = newContent.replace(/<table[^>]*>[\s\S]*?For\s*\{\{company_name\}\}[\s\S]*?Authorised Signatory[\s\S]*?<\/table>/i, '');

        if (newContent !== template.content) {
            console.log(`Updating ${template.name}...`);
            await supabase.from('templates').update({ content: newContent }).eq('id', template.id);
        }
    }
    console.log('Cleanup complete.');
}

removeOldSignatory();
