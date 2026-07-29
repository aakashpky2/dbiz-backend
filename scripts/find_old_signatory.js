const { supabase } = require('../lib/supabase');

async function checkTemplates() {
    const { data: templates, error } = await supabase.from('templates').select('*');
    if (error) {
        console.error('Error fetching templates:', error);
        return;
    }

    for (const template of templates) {
        if (!template.content) continue;
        const hasSignatory = template.content.includes('Authorised Signatory');
        if (hasSignatory) {
            console.log(`\n======================================`);
            console.log(`Template: ${template.name}`);
            console.log(`======================================`);
            // Show the 300 chars around the match
            const idx = template.content.indexOf('Authorised Signatory');
            console.log(template.content.substring(Math.max(0, idx - 150), idx + 150));
        }
    }
}

checkTemplates();
