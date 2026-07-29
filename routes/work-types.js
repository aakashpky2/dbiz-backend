const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// GET /api/work-types
router.get('/', async (req, res) => {
    try {
        const queryActive = req.query.active === 'true';
        let query = supabase
            .from('worktype_master')
            .select('*')
            .eq('is_deleted', false);

        if (queryActive) {
            query = query.eq('status', 'ACTIVE');
        }

        const { data, error } = await query.order('work_type_name', { ascending: true });

        if (error) {
            console.error('[WorkTypes API] Fetch all error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        // Map it to standard output as expected by frontend
        const mappedData = data.map(wt => ({
            id: wt.id,
            name: wt.work_type_name,
            status: wt.status || 'ACTIVE'
        }));

        res.json({ success: true, data: mappedData });
    } catch (error) {
        console.error('[WorkTypes API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// GET /api/work-types/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('worktype_master')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('[WorkTypes API] Fetch error:', error);
            return res.status(error.code === 'PGRST116' ? 404 : 500).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            data: {
                id: data.id,
                name: data.work_type_name,
                dueTimeConfig: data.due_time_config,
                timeLimit: data.time_limit,
                timeLimitHours: data.time_limit_hours,
                durationDays: data.duration_days,
                durationHours: data.duration_hours,
                financialYearLogic: data.financial_year_logic,
                monthLogic: data.month_logic,
                defaultPriority: data.default_priority,
                allowOverride: data.allow_override,
                allowOccurrenceOverride: data.allow_occurrence_override,
                allowDueDateOverride: data.allow_due_date_override,
                allowFinishByOverride: data.allow_finish_by_override,
                finishByEnabled: data.finish_by_enabled,
                finishByMode: data.finish_by_mode,
                finishByDays: data.finish_by_days,
                finishByEvent: data.finish_by_event,
                finishByDirection: data.finish_by_direction,
                configName: data.config_name,
                warning_note: data.warning_note
            }
        });
    } catch (error) {
        console.error('[WorkTypes API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/work-types/:id/time-limit
router.patch('/:id/time-limit', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            dueTimeConfig, 
            timeLimit, 
            timeLimitHours, 
            durationDays, 
            durationHours,
            allowOverride,
            allowOccurrenceOverride,
            allowDueDateOverride,
            allowFinishByOverride,
            finishByEnabled,
            finishByMode,
            finishByDays,
            finishByEvent,
            finishByDirection,
            configName
        } = req.body;

        const updateData = {
            due_time_config: dueTimeConfig,
            time_limit: timeLimit,
            time_limit_hours: timeLimitHours,
            duration_days: durationDays,
            duration_hours: durationHours,
            allow_override: allowOverride,
            allow_occurrence_override: allowOccurrenceOverride,
            allow_due_date_override: allowDueDateOverride,
            allow_finish_by_override: allowFinishByOverride,
            finish_by_enabled: finishByEnabled,
            finish_by_mode: finishByMode,
            finish_by_days: finishByDays,
            finish_by_event: finishByEvent,
            finish_by_direction: finishByDirection,
            config_name: configName,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('worktype_master')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[WorkTypes API] Update error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, data });
    } catch (error) {
        console.error('[WorkTypes API] Internal error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
