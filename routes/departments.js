const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');

// --- Departments ---

router.get('/', async (req, res) => {
    try {
        const queryActive = req.query.active === 'true';

        let query = supabase
            .from('department_master')
            .select(`
                *,
                work_categories:category_master (
                    *,
                    work_types:worktype_master (
                        *
                    )
                )
            `)
            .eq('is_deleted', false);

        if (queryActive) {
            query = query.eq('status', 'ACTIVE');
        }

        const { data: departments, error } = await query.order('department_name');

        if (error) throw error;
        if (!departments) return res.json({ success: true, data: [] });

        const mapped = departments.map(d => ({
            id: d.id,
            name: d.department_name,
            description: d.description,
            status: d.status || (d.is_deleted ? 'INACTIVE' : d.is_validated ? 'ACTIVE' : 'PENDING'),
            isValidated: !!d.is_validated,
            isDeleted: !!d.is_deleted,
            isIncomplete: !!d.is_incomplete,
            workCategories: (d.work_categories || []).map(c => ({
                id: c.id,
                departmentId: c.department_id,
                name: c.category_name,
                description: c.description,
                status: c.status || (c.is_deleted ? 'INACTIVE' : c.is_validated ? 'ACTIVE' : 'PENDING'),
                isValidated: !!c.is_validated,
                isDeleted: !!c.is_deleted,
                isIncomplete: !!c.is_incomplete,
                workTypes: (c.work_types || []).map(t => ({
                    id: t.id,
                    name: t.work_type_name,
                    description: t.description,
                    status: t.status || (t.is_deleted ? 'INACTIVE' : t.is_validated ? 'ACTIVE' : 'PENDING'),
                    isValidated: !!t.is_validated,
                    isDeleted: !!t.is_deleted,
                    isIncomplete: !!t.is_incomplete,
                    constitutionRule: {
                        mode: t.constitution_applicability_type === 'Selected' ? 'SELECT' : t.constitution_applicability_type === 'Except Selected' ? 'EXCEPT' : 'ALL',
                        ids: t.constitution_list || []
                    },
                    timeLimit: t.time_limit,
                    timeLimitHours: t.time_limit_hours,
                    dueTimeConfig: t.due_time_config,
                    durationDays: t.duration_days,
                    durationHours: t.duration_hours,
                    financialYearLogic: t.financial_year_logic,
                    monthLogic: t.month_logic,
                    defaultPriority: t.default_priority,
                    allowOverride: t.allow_override,
                    configName: t.config_name,
                    warningNote: t.warning_note || null
                }))
            }))
        }));

        let filtered = mapped;
        if (queryActive) {
            filtered = mapped.map(d => ({
                ...d,
                workCategories: d.workCategories
                    .filter(c => c.status === 'ACTIVE' && !c.isDeleted)
                    .map(c => ({
                        ...c,
                        workTypes: c.workTypes.filter(wt => wt.status === 'ACTIVE' && !wt.isDeleted)
                    }))
            }));
        }

        res.json({ success: true, data: filtered });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Internal Server Error', details: error.details, hint: error.hint, code: error.code });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('department_master')
            .select(`
                *,
                work_categories:category_master (
                    *,
                    work_types:worktype_master (
                        *
                    )
                )
            `)
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) {
            console.error('[Departments API] Fetch error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Department not found' });
        }

        const d = data;
        const mapped = {
            id: d.id,
            name: d.department_name,
            description: d.description,
            status: d.status || (d.is_deleted ? 'INACTIVE' : d.is_validated ? 'ACTIVE' : 'PENDING'),
            isValidated: !!d.is_validated,
            isDeleted: !!d.is_deleted,
            isIncomplete: !!d.is_incomplete,
            workCategories: (d.work_categories || []).map(c => ({
                id: c.id,
                departmentId: c.department_id,
                name: c.category_name,
                description: c.description,
                status: c.status || (c.is_deleted ? 'INACTIVE' : c.is_validated ? 'ACTIVE' : 'PENDING'),
                isValidated: !!c.is_validated,
                isDeleted: !!c.is_deleted,
                isIncomplete: !!c.is_incomplete,
                workTypes: (c.work_types || []).map(t => ({
                    id: t.id,
                    name: t.work_type_name,
                    description: t.description,
                    status: t.status || (t.is_deleted ? 'INACTIVE' : t.is_validated ? 'ACTIVE' : 'PENDING'),
                    isValidated: !!t.is_validated,
                    isDeleted: !!t.is_deleted,
                    isIncomplete: !!t.is_incomplete
                }))
            }))
        };

        res.json({ success: true, data: mapped });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
    }
});

router.post('/', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        const { data, error } = await supabase
            .from('department_master')
            .insert({ 
                department_name: name, 
                description, 
                status: status || 'ACTIVE',
                is_validated: false,
                is_deleted: false
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.put('/:id', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        const { data, error } = await supabase
            .from('department_master')
            .update({ 
                department_name: name, 
                description, 
                status,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.delete('/:id', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('department_master')
            .update({ 
                is_deleted: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// --- Work Categories ---

router.get('/categories/:catId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('category_master')
            .select(`
                *,
                work_types:worktype_master (
                    *
                )
            `)
            .eq('id', req.params.catId)
            .maybeSingle();

        if (error) {
            console.error('[Departments API] Fetch category error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }

        const c = data;
        const mapped = {
            id: c.id,
            departmentId: c.department_id,
            name: c.category_name,
            description: c.description,
            status: c.status || (c.is_deleted ? 'INACTIVE' : c.is_validated ? 'ACTIVE' : 'PENDING'),
            isValidated: !!c.is_validated,
            isDeleted: !!c.is_deleted,
            isIncomplete: !!c.is_incomplete,
            workTypes: (c.work_types || []).map(t => ({
                id: t.id,
                name: t.work_type_name,
                description: t.description,
                status: t.status || (t.is_deleted ? 'INACTIVE' : t.is_validated ? 'ACTIVE' : 'PENDING'),
                isValidated: !!t.is_validated,
                isDeleted: !!t.is_deleted,
                isIncomplete: !!t.is_incomplete
            }))
        };

        res.json({ success: true, data: mapped });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
    }
});

router.post('/:deptId/categories', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        
        const { data: dept } = await supabase.from('department_master').select('department_name').eq('id', req.params.deptId).single();

        const { data, error } = await supabase
            .from('category_master')
            .insert({
                department_id: req.params.deptId,
                department_name: dept?.department_name || '',
                category_name: name,
                description,
                status: status || 'ACTIVE',
                is_validated: false,
                is_deleted: false
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.put('/categories/:catId', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        const { data, error } = await supabase
            .from('category_master')
            .update({ 
                category_name: name, 
                description, 
                status,
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.catId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.delete('/categories/:catId', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('category_master')
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .eq('id', req.params.catId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// --- Work Types ---

router.post('/categories/:catId/types', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, constitutionRule, status, warningNote } = req.body;
        
        const { data: cat } = await supabase.from('category_master').select('department_id, department_name, category_name').eq('id', req.params.catId).single();

        const { data, error } = await supabase
            .from('worktype_master')
            .insert({
                category_id: req.params.catId,
                department_id: cat?.department_id,
                department_name: cat?.department_name,
                category_name: cat?.category_name,
                work_type_name: name,
                description,
                constitution_applicability_type: constitutionRule?.mode === 'SELECT' ? 'Selected' : constitutionRule?.mode === 'EXCEPT' ? 'Except Selected' : 'All',
                constitution_list: constitutionRule?.ids || [],
                status: status || 'ACTIVE',
                is_validated: false,
                is_deleted: false,
                warning_note: warningNote || null
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.put('/types/:typeId', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { name, description, constitutionRule, status, warningNote, deptId, catId } = req.body;
        
        let applicabilityType = constitutionRule?.mode === 'SELECT' ? 'Selected' : constitutionRule?.mode === 'EXCEPT' ? 'Except Selected' : 'All';
        let constitutionList = constitutionRule?.ids || [];
        
        const hasDesc = description && description.trim() !== '';
        const hasConst = applicabilityType === 'All' || (constitutionList && constitutionList.length > 0);
        const isIncomplete = !hasDesc || !hasConst;

        let updateData = { 
            work_type_name: name, 
            description, 
            constitution_applicability_type: applicabilityType,
            constitution_list: constitutionList,
            status,
            warning_note: warningNote || null,
            is_validated: false,
            is_incomplete: isIncomplete,
            updated_at: new Date().toISOString()
        };

        if (deptId && catId) {
            const { data: parentCat } = await supabase.from('category_master').select('department_name, category_name').eq('id', catId).single();
            if (parentCat) {
                updateData.department_id = deptId;
                updateData.category_id = catId;
                updateData.department_name = parentCat.department_name;
                updateData.category_name = parentCat.category_name;
            }
        }

        const { data, error } = await supabase
            .from('worktype_master')
            .update(updateData)
            .eq('id', req.params.typeId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

router.delete('/types/:typeId', requirePermission('MANAGE_DEPARTMENTS'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('worktype_master')
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .eq('id', req.params.typeId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('[Departments API] Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

module.exports = router;
