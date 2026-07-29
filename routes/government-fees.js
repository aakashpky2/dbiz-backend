const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');
const calculatorService = require('../services/GovernmentFeeCalculatorService');

// ==========================================
// CALCULATE GOVERNMENT FEES (Phase 5)
// ==========================================
router.post('/calculate', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    const { work_type_id, parameters } = req.body;
    try {
        const result = await calculatorService.calculateFees(work_type_id, parameters || {});
        res.json({ success: true, data: result });
    } catch (err) {
        console.error("Calculate Fees Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// DYNAMIC GOVERNMENT FEE BUILDER
// ==========================================

// ------------------------------------------
// SOURCE MAPPINGS APIs (Admin Settings)
// ------------------------------------------

// GET /api/government-fees/source-mappings/discover
router.get('/source-mappings/discover', async (req, res) => {
    try {
        const allowedTables = [
            'business_profiles', 'clients', 'proposals', 'rate_cards', 
            'rate_card_items', 'rate_card_government_fees', 'worktype_master', 
            'work_categories', 'works', 'departments', 'business_constitutions', 
            'employees', 'employee_addresses', 'applicants', 'associates', 
            'tasks', 'teams', 'queries', 'temporary_clients'
        ];
        const sensitiveColumns = [
            'password', 'token', 'refresh', 'access', 'otp', 'secret', 
            'auth', 'email', 'phone', 'aadhaar', 'pan'
        ];
        
        // Use Supabase PostgREST OpenAPI spec to dynamically discover tables/columns
        // since run_sql is not available natively.
        const openApiUrl = `${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
        const openApiResponse = await fetch(openApiUrl);
        
        if (!openApiResponse.ok) {
            throw new Error(`Failed to fetch OpenAPI spec: ${openApiResponse.statusText}`);
        }

        const openApiData = await openApiResponse.json();
        const definitions = openApiData.definitions || openApiData.components?.schemas || {};
        
        const groupedData = {};

        for (const tableName of allowedTables) {
            const tableDef = definitions[tableName];
            if (!tableDef || !tableDef.properties) continue;

            const displayNameParts = tableName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1));
            
            groupedData[tableName] = {
                table_name: tableName,
                display_name: displayNameParts.join(' '),
                columns: []
            };

            for (const [columnName, columnProps] of Object.entries(tableDef.properties)) {
                if (sensitiveColumns.some(sc => columnName.toLowerCase().includes(sc))) continue;
                
                // Determine if technical
                const isTechnical = 
                    columnName === 'id' || 
                    columnName === 'uuid' ||
                    columnName === 'status' ||
                    columnName === 'active' ||
                    columnName === 'is_active' ||
                    columnName === 'deleted' ||
                    columnName === 'is_deleted' ||
                    columnName === 'archived' ||
                    columnName === 'enabled' ||
                    columnName === 'disabled' ||
                    columnName === 'version' ||
                    columnName === 'row_version' ||
                    columnName.endsWith('_id') || 
                    columnName.endsWith('_by') || 
                    columnName.endsWith('_at') ||
                    ['created_at', 'updated_at', 'deleted_at', 'inserted_at', 'modified_at', 'archived_at'].includes(columnName) ||
                    (columnProps.format && columnProps.format.includes('timestamp'));

                // Some columns have format, others have type
                const dataType = columnProps.format || columnProps.type || 'text';

                groupedData[tableName].columns.push({
                    column_name: columnName,
                    data_type: dataType,
                    is_sensitive: false,
                    is_technical: isTechnical
                });
            }
            
            // If table has no safe columns, skip it entirely
            if (groupedData[tableName].columns.length === 0) {
                delete groupedData[tableName];
            }
        }

        res.json({ success: true, data: Object.values(groupedData) });
    } catch (err) {
        console.error("Discover Mappings Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/government-fees/source-mappings
router.get('/source-mappings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('government_fee_source_mappings')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error("Fetch Mappings Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/source-mappings
router.post('/source-mappings', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body };
        // Ensure source_json_path defaults to '' instead of null for the unique constraint
        if (!payload.source_json_path) payload.source_json_path = '';

        const { data, error } = await supabase
            .from('government_fee_source_mappings')
            .upsert([payload], { onConflict: 'source_table,source_column' })
            .select('*')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        console.error("POST Mapping Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/government-fees/source-mappings/:id
router.put('/source-mappings/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body, updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('government_fee_source_mappings')
            .update(payload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("PUT Mapping Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/government-fees/source-mappings/:id
router.delete('/source-mappings/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('government_fee_source_mappings')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("DELETE Mapping Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ------------------------------------------
// FIELD BUILDER APIs
// ------------------------------------------

// GET /api/government-fees/fields
router.get('/fields', async (req, res) => {
    try {
        const { work_type_id } = req.query;
        let query = supabase.from('work_type_fee_fields').select('*').order('display_order', { ascending: true });
        
        if (work_type_id) {
            query = query.eq('work_type_id', work_type_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        
        res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error("Fetch Fields Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/fields
router.post('/fields', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body };
        const { data, error } = await supabase
            .from('work_type_fee_fields')
            .insert([payload])
            .select('*')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        console.error("POST Field Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/government-fees/fields/:id
router.put('/fields/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body, updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('work_type_fee_fields')
            .update(payload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("PUT Field Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/government-fees/fields/:id
router.delete('/fields/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        // Soft delete / inactivate
        const { data, error } = await supabase
            .from('work_type_fee_fields')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("DELETE Field Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ------------------------------------------
// GOVERNMENT FEE RULES APIs
// ------------------------------------------

// GET /api/government-fees/rules
router.get('/rules', async (req, res) => {
    try {
        const { work_type_id } = req.query;
        let query = supabase.from('government_fee_rules').select('*').order('created_at', { ascending: false });
        
        if (work_type_id) {
            query = query.eq('work_type_id', work_type_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        
        res.json({ success: true, data: data || [] });
    } catch (err) {
        console.error("Fetch Rules Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/rules
router.post('/rules', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body };
        const { data, error } = await supabase
            .from('government_fee_rules')
            .insert([payload])
            .select('*')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        console.error("POST Rule Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/government-fees/rules/:id
router.put('/rules/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body, updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('government_fee_rules')
            .update(payload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("PUT Rule Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/government-fees/rules/:id
router.delete('/rules/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        // Soft delete / inactivate
        const { data, error } = await supabase
            .from('government_fee_rules')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("DELETE Rule Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ------------------------------------------
// MATCHING API
// ------------------------------------------

// POST /api/government-fees/match
router.post('/match', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    const { work_type_id, values = {} } = req.body;
    try {
        if (!work_type_id) {
            return res.status(400).json({ success: false, error: "work_type_id is required" });
        }

        // Fetch all active fee rules for this work type
        const { data: activeRules, error } = await supabase
            .from('government_fee_rules')
            .select('*')
            .eq('work_type_id', work_type_id)
            .eq('status', 'active');

        if (error) throw error;

        const matchedFees = [];
        const todayStr = new Date().toISOString().split('T')[0];

        for (const rule of activeRules) {
            // Apply effective date filter
            const effectiveFrom = rule.effective_from ? rule.effective_from.split('T')[0] : null;
            const effectiveTo = rule.effective_to ? rule.effective_to.split('T')[0] : null;

            if (effectiveFrom && effectiveFrom > todayStr) {
                continue; // Rule is not yet effective
            }
            if (effectiveTo && effectiveTo < todayStr) {
                continue; // Rule has expired
            }

            // Evaluate conditions
            const conditions = rule.condition_rules || {};
            let isMatch = true;

            for (const [fieldKey, condition] of Object.entries(conditions)) {
                if (!condition || !condition.operator) continue;
                
                const providedValue = values[fieldKey];
                const op = condition.operator;

                // Handle missing provided values based on operation type
                if (providedValue === undefined || providedValue === null) {
                    isMatch = false;
                    break;
                }

                if (op === 'equals') {
                    if (String(providedValue) !== String(condition.value)) isMatch = false;
                } else if (op === 'not_equals') {
                    if (String(providedValue) === String(condition.value)) isMatch = false;
                } else if (op === 'greater_than') {
                    if (Number(providedValue) <= Number(condition.value)) isMatch = false;
                } else if (op === 'greater_than_or_equal') {
                    if (Number(providedValue) < Number(condition.value)) isMatch = false;
                } else if (op === 'less_than') {
                    if (Number(providedValue) >= Number(condition.value)) isMatch = false;
                } else if (op === 'less_than_or_equal') {
                    if (Number(providedValue) > Number(condition.value)) isMatch = false;
                } else if (op === 'between') {
                    const min = Number(condition.min);
                    const max = Number(condition.max);
                    const val = Number(providedValue);
                    if (val < min || val > max) isMatch = false;
                } else if (op === 'in') {
                    const arr = Array.isArray(condition.value) ? condition.value : [];
                    if (!arr.includes(providedValue)) isMatch = false;
                } else if (op === 'not_in') {
                    const arr = Array.isArray(condition.value) ? condition.value : [];
                    if (arr.includes(providedValue)) isMatch = false;
                } else if (op === 'before') {
                    if (new Date(providedValue) >= new Date(condition.value)) isMatch = false;
                } else if (op === 'after') {
                    if (new Date(providedValue) <= new Date(condition.value)) isMatch = false;
                }

                if (!isMatch) break; // All conditions must pass
            }

            if (isMatch) {
                matchedFees.push({
                    id: rule.id,
                    fee_name: rule.fee_name,
                    authority_name: rule.authority_name,
                    amount: Number(rule.amount || 0),
                    calculation_type: rule.calculation_type,
                    isRequired: rule.is_required,
                    isEditable: rule.is_editable,
                    notes: rule.notes
                });
            }
        }

        // Calculate total government fee
        const totalGovernmentFee = matchedFees.reduce((sum, f) => sum + f.amount, 0);

        res.json({
            success: true,
            data: {
                matchedFees,
                totalGovernmentFee
            }
        });

    } catch (err) {
        console.error("Match Fees Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// INDEPENDENT GOVERNMENT FEE LIBRARY APIs
// ==========================================

const applicabilityService = require('../services/GovernmentFeeApplicabilityService');

// GET /api/government-fees/source-mappings
router.get('/source-mappings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('government_fee_source_mappings')
            .select('*')
            .eq('is_active', true)
            .eq('is_visible', true)
            .order('display_name', { ascending: true });

        if (error) throw error;
        
        res.json({
            success: true,
            data: data || []
        });
    } catch (err) {
        console.error("Fetch Source Mappings Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/government-fees/library
router.get('/library', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('government_fee_library')
            .select('*, government_fee_applicability_conditions(*), government_fee_calculation_rules(*)')
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Compute active/scheduled/expired status on the fly based on dates
        const todayStr = new Date().toISOString().split('T')[0];
        const enrichedData = (data || []).map(fee => {
            let computedStatus = fee.status;
            if (fee.status === 'active') {
                const from = fee.effective_from ? fee.effective_from.split('T')[0] : null;
                const to = fee.effective_to ? fee.effective_to.split('T')[0] : null;
                if (from && from > todayStr) computedStatus = 'scheduled';
                else if (to && to < todayStr) computedStatus = 'expired';
            }
            return { ...fee, computed_status: computedStatus };
        });

        res.json({ success: true, data: enrichedData });
    } catch (err) {
        console.error("Fetch Library Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/library
router.post('/library', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const { conditions, calculation_rules, ...payloadRaw } = req.body;
        
        const cleanDate = (val) => val && String(val).trim() !== '' ? val : null;
        const payload = { ...payloadRaw };
        if (payload.effective_from !== undefined) payload.effective_from = cleanDate(payload.effective_from);
        if (payload.effective_to !== undefined) payload.effective_to = cleanDate(payload.effective_to);

        const { data: feeData, error: feeError } = await supabase
            .from('government_fee_library')
            .insert([payload])
            .select('*')
            .single();

        if (feeError) throw feeError;

        if (conditions && Array.isArray(conditions)) {
            const conditionsToInsert = conditions.map(c => {
                const { id, created_at, updated_at, government_fee_id, source_table, source_column, ...rest } = c;
                if (rest.min_date !== undefined) rest.min_date = cleanDate(rest.min_date);
                if (rest.max_date !== undefined) rest.max_date = cleanDate(rest.max_date);
                return {
                    ...rest,
                    government_fee_id: feeData.id,
                    source_table: source_table || '',
                    source_column: source_column || '',
                    status: 'active'
                };
            });
            
            if (conditionsToInsert.length > 0) {
                const { error: condError } = await supabase
                    .from('government_fee_applicability_conditions')
                    .insert(conditionsToInsert);
                if (condError) throw condError;
            }
        }

        if (calculation_rules && Array.isArray(calculation_rules)) {
            for (const rule of calculation_rules) {
                const { id, created_at, updated_at, government_fee_id, slabs, delay_slabs, ...ruleRest } = rule;
                
                const { data: ruleData, error: ruleError } = await supabase
                    .from('government_fee_calculation_rules')
                    .insert([{
                        ...ruleRest,
                        government_fee_id: feeData.id,
                        status: 'active'
                    }])
                    .select('*')
                    .single();
                    
                if (ruleError) throw ruleError;
                
                if (slabs && Array.isArray(slabs) && slabs.length > 0 && rule.calculation_type === 'slab_based') {
                    const slabsToInsert = slabs.map(s => ({
                        ...s,
                        id: undefined,
                        calculation_rule_id: ruleData.id
                    }));
                    const { error: slabError } = await supabase
                        .from('government_fee_rule_slabs')
                        .insert(slabsToInsert);
                    if (slabError) throw slabError;
                }
                
                if (delay_slabs && Array.isArray(delay_slabs) && delay_slabs.length > 0 && rule.calculation_type === 'late_fee' && rule.late_fee_method === 'slab_based_delay') {
                    const delaySlabsToInsert = delay_slabs.map(s => ({
                        ...s,
                        id: undefined,
                        calculation_rule_id: ruleData.id
                    }));
                    const { error: delaySlabError } = await supabase
                        .from('government_fee_late_fee_slabs')
                        .insert(delaySlabsToInsert);
                    if (delaySlabError) throw delaySlabError;
                }
            }
        }

        res.status(201).json({ success: true, data: feeData });
    } catch (err) {
        console.error("POST Library Error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Internal Server Error",
            details: err
        });
    }
});

// PUT /api/government-fees/library/:id
router.put('/library/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const { conditions, calculation_rules, ...payloadRaw } = req.body;
        
        const cleanDate = (val) => val && String(val).trim() !== '' ? val : null;
        const payload = { ...payloadRaw };
        if (payload.effective_from !== undefined) payload.effective_from = cleanDate(payload.effective_from);
        if (payload.effective_to !== undefined) payload.effective_to = cleanDate(payload.effective_to);

        // updated_at is handled by trigger
        const { data: feeData, error: feeError } = await supabase
            .from('government_fee_library')
            .update(payload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (feeError) throw feeError;

        if (conditions && Array.isArray(conditions)) {
            // Hard delete existing conditions to replace them cleanly
            await supabase
                .from('government_fee_applicability_conditions')
                .delete()
                .eq('government_fee_id', req.params.id);

            const conditionsToInsert = conditions.map(c => {
                const { id, created_at, updated_at, government_fee_id, source_table, source_column, ...rest } = c;
                if (rest.min_date !== undefined) rest.min_date = cleanDate(rest.min_date);
                if (rest.max_date !== undefined) rest.max_date = cleanDate(rest.max_date);
                return {
                    ...rest,
                    government_fee_id: req.params.id,
                    source_table: source_table || '',
                    source_column: source_column || '',
                    status: 'active'
                };
            });
            
            if (conditionsToInsert.length > 0) {
                const { error: condError } = await supabase
                    .from('government_fee_applicability_conditions')
                    .insert(conditionsToInsert);
                if (condError) throw condError;
            }
        }
        
        if (calculation_rules && Array.isArray(calculation_rules)) {
            // Hard delete existing calculation rules (this will cascade delete old slabs)
            await supabase
                .from('government_fee_calculation_rules')
                .delete()
                .eq('government_fee_id', req.params.id);
                
            for (const rule of calculation_rules) {
                const { id, created_at, updated_at, government_fee_id, slabs, delay_slabs, ...ruleRest } = rule;
                
                const { data: ruleData, error: ruleError } = await supabase
                    .from('government_fee_calculation_rules')
                    .insert([{
                        ...ruleRest,
                        government_fee_id: req.params.id,
                        status: 'active'
                    }])
                    .select('*')
                    .single();
                    
                if (ruleError) throw ruleError;
                
                if (slabs && Array.isArray(slabs) && slabs.length > 0 && rule.calculation_type === 'slab_based') {
                    const slabsToInsert = slabs.map(s => ({
                        ...s,
                        id: undefined,
                        calculation_rule_id: ruleData.id
                    }));
                    const { error: slabError } = await supabase
                        .from('government_fee_rule_slabs')
                        .insert(slabsToInsert);
                    if (slabError) throw slabError;
                }
                
                if (delay_slabs && Array.isArray(delay_slabs) && delay_slabs.length > 0 && rule.calculation_type === 'late_fee' && rule.late_fee_method === 'slab_based_delay') {
                    const delaySlabsToInsert = delay_slabs.map(s => ({
                        ...s,
                        id: undefined,
                        calculation_rule_id: ruleData.id
                    }));
                    const { error: delaySlabError } = await supabase
                        .from('government_fee_late_fee_slabs')
                        .insert(delaySlabsToInsert);
                    if (delaySlabError) throw delaySlabError;
                }
            }
        }

        res.json({ success: true, data: feeData });
    } catch (err) {
        console.error("PUT Library Error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Internal Server Error",
            details: err
        });
    }
});

// DELETE /api/government-fees/library/:id
router.delete('/library/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        console.log("Deleting fee id:", req.params.id);
        // Soft delete
        const { data, error } = await supabase
            .from('government_fee_library')
            .update({ status: 'deleted' })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        
        if (!data) {
            return res.status(404).json({ success: false, error: "Fee not found" });
        }
        
        console.log("Delete response:", data);
        res.json({ success: true, data });
    } catch (err) {
        console.error("DELETE Library Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/government-fees/library/:id/conditions
router.get('/library/:id/conditions', async (req, res) => {
    try {
        // Fetch applicability conditions
        const { data: conditionsData, error: condError } = await supabase
            .from('government_fee_applicability_conditions')
            .select('*')
            .eq('government_fee_id', req.params.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true });

        if (condError) throw condError;
        
        // Fetch calculation rules with slabs
        const { data: rulesData, error: rulesError } = await supabase
            .from('government_fee_calculation_rules')
            .select('*, slabs:government_fee_rule_slabs(*), delay_slabs:government_fee_late_fee_slabs(*)')
            .eq('government_fee_id', req.params.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true });

        if (rulesError) throw rulesError;

        res.json({ 
            success: true, 
            data: {
                conditions: conditionsData || [],
                calculation_rules: rulesData || []
            } 
        });
    } catch (err) {
        console.error("Fetch Conditions Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/library/:id/conditions
router.post('/library/:id/conditions', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body, government_fee_id: req.params.id };
        const { data, error } = await supabase
            .from('government_fee_applicability_conditions')
            .insert([payload])
            .select('*')
            .single();

        if (error) throw error;
        res.status(201).json({ success: true, data });
    } catch (err) {
        console.error("POST Condition Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/government-fees/conditions/:id
router.put('/conditions/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const payload = { ...req.body };
        const { data, error } = await supabase
            .from('government_fee_applicability_conditions')
            .update(payload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("PUT Condition Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/government-fees/conditions/:id
router.delete('/conditions/:id', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        // Soft delete
        const { data, error } = await supabase
            .from('government_fee_applicability_conditions')
            .update({ status: 'inactive' })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("DELETE Condition Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/government-fees/suggestions
router.post('/suggestions', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        console.log('Suggestions payload:', req.body);
        const { context = {}, manual_values = {}, as_of_date } = req.body;
        const asOfDate = as_of_date || new Date().toISOString().slice(0, 10);
        console.log("Suggestion asOfDate:", asOfDate);

        const result = await applicabilityService.getSuggestions(
            context,
            manual_values,
            asOfDate
        );
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('[Gov Fee Suggestions Error]', error);
        return res.status(500).json({
          success: false,
          error: error.message,
          stack: error.stack
        });
    }
});

// POST /api/government-fees/check-applicability
router.post('/check-applicability', requirePermission('MANAGE_GOVERNMENT_FEES'), async (req, res) => {
    try {
        const { government_fee_ids, context = {}, manual_values = {}, as_of_date } = req.body;
        const asOfDate = as_of_date || new Date().toISOString().slice(0, 10);
        
        const result = await applicabilityService.checkApplicability(
            government_fee_ids,
            context,
            manual_values,
            asOfDate
        );
        res.json({ success: true, data: result });
    } catch (err) {
        console.error("Check Applicability Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
