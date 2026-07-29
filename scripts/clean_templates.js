const { supabase } = require('../lib/supabase');

async function fixHtmlGarbage() {
    console.log('Fetching templates to fix garbage text...');
    const { data: templates, error } = await supabase.from('templates').select('*');
    if (error) {
        console.error('Error fetching templates:', error);
        return;
    }

    for (const template of templates) {
        if (!template.content) continue;
        let originalContent = template.content;
        
        // Remove rogue "html" at the very beginning of the document
        // Some editors might inject it if copied from a view-source or devtools
        let modifiedContent = originalContent.replace(/^\s*html\s*/i, '');
        
        // Let's also check header and footer if they exist (they might not be in the content column, but in separate columns depending on DB schema)
        
        if (originalContent !== modifiedContent) {
            console.log(`Updating template: ${template.name || template.id}`);
            await supabase.from('templates').update({ content: modifiedContent }).eq('id', template.id);
        }
    }
    console.log('Garbage text removed.');
}

fixHtmlGarbage();
