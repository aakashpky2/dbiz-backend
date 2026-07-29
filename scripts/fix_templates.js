const { supabase } = require('../lib/supabase');

async function fixTemplates() {
    console.log('Fetching templates to fix...');
    const { data: templates, error } = await supabase.from('templates').select('*');
    if (error) {
        console.error('Error fetching templates:', error);
        return;
    }

    for (const template of templates) {
        if (!template.content) continue;
        let originalContent = template.content;
        let modifiedContent = originalContent;

        // Replace basic text placeholders with image tags wrapped in if blocks
        const logoReplacement = `{{#if company_logo}}<img src="{{company_logo}}" crossorigin="anonymous" style="height:70px; max-width:200px; object-fit:contain;" />{{/if}}`;
        const sealReplacement = `{{#if company_seal}}<img src="{{company_seal}}" crossorigin="anonymous" style="height:90px; max-width:130px; object-fit:contain;" />{{/if}}`;
        const signatureReplacement = `{{#if company_signature}}<img src="{{company_signature}}" crossorigin="anonymous" style="height:60px; max-width:160px; object-fit:contain;" />{{/if}}`;

        // Only replace if they are NOT already inside an img src attribute.
        // A simple heuristic: if it's strictly {{company_logo}} with whitespace or inside a div, replace it.
        // But if it's already <img src="{{company_logo}}">, don't double wrap it.
        // It's safer to just let the user use the editor, but we'll attempt a safe global replacement
        // if they just have the raw tag.

        if (!modifiedContent.includes('<img src="{{company_logo}}"')) {
            modifiedContent = modifiedContent.replace(/\{\{\s*company_logo\s*\}\}/g, logoReplacement);
        }
        if (!modifiedContent.includes('<img src="{{company_seal}}"')) {
            modifiedContent = modifiedContent.replace(/\{\{\s*company_seal\s*\}\}/g, sealReplacement);
        }
        if (!modifiedContent.includes('<img src="{{company_signature}}"')) {
            modifiedContent = modifiedContent.replace(/\{\{\s*company_signature\s*\}\}/g, signatureReplacement);
        }

        // Remove the test text
        modifiedContent = modifiedContent.replace(/TEST TEMPLATE CONNECTED/g, 'PROPOSAL');

        if (originalContent !== modifiedContent) {
            console.log(`Updating template: ${template.name || template.id}`);
            await supabase.from('templates').update({ content: modifiedContent }).eq('id', template.id);
        }
    }
    console.log('Templates fixed.');
}

fixTemplates();
