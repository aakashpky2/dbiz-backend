const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');
// GET /api/templates - List all templates
router.get('/', async (req, res) => {

    try {
        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Supabase Templates Error:", error);
            return res.status(500).json({ success: false, error: error.message });
        }
        

        res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error("Fetch Templates Catch Block:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const TemplateResolverService = require('../services/TemplateResolverService');
const ProposalTemplateContextService = require('../services/ProposalTemplateContextService');

// GET /api/templates/configurations/default
router.get('/configurations/default', async (req, res) => {
    try {
        const { module } = req.query;
        if (!module) {
            return res.status(400).json({ success: false, error: "Module query parameter is required" });
        }

        const { data: configData, error: configError } = await supabase
            .from('template_configurations')
            .select('*')
            .eq('module', module)
            .eq('status', 'active')
            .eq('is_default', true)
            .maybeSingle();

        if (configError) {
            throw configError;
        }

        if (!configData) {
            return res.status(404).json({ success: false, error: "No default configuration found for this module" });
        }

        if (configData.template_id) {
            const { data: templateData, error: templateError } = await supabase
                .from('templates')
                .select('content')
                .eq('id', configData.template_id)
                .maybeSingle();

            if (!templateError && templateData) {
                configData.template_content = templateData.content;
            }
        }

        res.json({ success: true, data: configData });
    } catch (err) {
        console.error("Fetch Default Configuration Catch Block:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/templates/resolve
router.get('/resolve', async (req, res) => {
    try {
        const { module, action_key, context_id } = req.query;



        if (!module || !action_key) {
            return res.status(400).json({ success: false, error: "module and action_key are required" });
        }

        let renderContext = {};
        let filterContext = {};

        // Build context if context_id is provided
        if (context_id) {
            if (module === 'proposal') {
                const ctx = await ProposalTemplateContextService.buildProposalTemplateContext(context_id);
                renderContext = ctx.renderContext;
                filterContext = ctx.filterContext;


            }
        }

        const resolveResult = await TemplateResolverService.resolveTemplate(module, action_key, filterContext);

        if (!resolveResult.success) {
            return res.status(404).json(resolveResult);
        }

        // Attach context to response
        if (resolveResult.requiresSelection) {
            return res.json({
                success: true,
                requiresSelection: true,
                options: resolveResult.options,
                renderContext,
                filterContext
            });
        } else {
            return res.json({
                success: true,
                requiresSelection: false,
                data: {
                    ...resolveResult.data,
                    renderContext,
                    filterContext
                }
            });
        }

    } catch (error) {
        console.error('[Template Resolve Error]', error);
        res.status(500).json({
            success: false,
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// GET /api/templates/resolve/configuration/:id
router.get('/resolve/configuration/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { context_id, module } = req.query;

        const { data: configData, error: configError } = await supabase
            .from('template_configurations')
            .select('*')
            .eq('id', id)
            .single();

        if (configError) throw configError;

        if (configData && configData.template_id) {
            const { data: templateData } = await supabase
                .from('templates')
                .select('content')
                .eq('id', configData.template_id)
                .single();
            if (templateData) {
                configData.templates = { content: templateData.content };
            }
        }

        let renderContext = {};
        
        if (context_id && (module === 'proposal' || configData.module === 'proposal')) {
            const ctx = await ProposalTemplateContextService.buildProposalTemplateContext(context_id);
            renderContext = ctx.renderContext;
        }

        return res.json({
            success: true,
            data: {
                template_content: configData.templates?.content,
                context: renderContext
            }
        });
    } catch (err) {
        console.error("Fetch Manual Configuration Catch Block:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/templates/:id - Get single template
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/templates - Create a new template (Save Draft)
router.post('/', requirePermission('MANAGE_TEMPLATES'), async (req, res) => {
    const { name, content, placeholders, groupId, subGroupId, categoryId, description } = req.body;
    try {
        const payload = {
            name: name || 'Untitled Template',
            content: content || '',
            placeholders: placeholders || [],
            group_id: groupId || null,
            sub_group_id: subGroupId || null,
            category_id: categoryId || null,
            created_at: new Date().toISOString()
        };

        // Only add description if it might exist in the schema
        if (description) payload.description = description;

        const { data, error } = await supabase
            .from('templates')
            .insert([payload])
            .select('*')
            .single();

        if (error) {
            console.error("Create Template Sub-Error:", error);
            // If it's a column error, try again without description
            if (error.message.includes('column "description" of relation "templates" does not exist')) {
                delete payload.description;
                const retry = await supabase.from('templates').insert([payload]).select('*').single();
                if (retry.error) throw retry.error;
                return res.status(201).json({ success: true, data: retry.data });
            }
            return res.status(500).json({ success: false, error: error.message });
        }
        
        res.status(201).json({ success: true, data });
    } catch (err) {
        console.error("Create Template Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/templates/:id - Update an existing template (Save / Publish)
router.put('/:id', requirePermission('MANAGE_TEMPLATES'), async (req, res) => {
    const { name, content, placeholders, groupId, subGroupId, categoryId, description } = req.body;
    try {
        const updateData = {
            name,
            content,
            placeholders,
            group_id: groupId,
            sub_group_id: subGroupId,
            category_id: categoryId
        };
        if (description) updateData.description = description;

        const { data, error } = await supabase
            .from('templates')
            .update(updateData)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) {
            console.error("Update Template Sub-Error:", error);
            // Fallback if column missing
            if (error.message.includes('column "description" of relation "templates" does not exist')) {
                delete updateData.description;
                const retry = await supabase.from('templates').update(updateData).eq('id', req.params.id).select('*').single();
                if (retry.error) throw retry.error;
                return res.json({ success: true, data: retry.data });
            }
            return res.status(500).json({ success: false, error: error.message });
        }
        
        res.json({ success: true, data });
    } catch (err) {
        console.error("Update Template Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/templates/:id
router.delete('/:id', requirePermission('MANAGE_TEMPLATES'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('templates')
            .delete()
            .eq('id', req.params.id)
            .select('*');

        if (error) throw error;
        
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
