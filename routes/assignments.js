const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { requirePermission } = require('../lib/permissions');
const { authenticateToken } = require('./auth');

async function fetchEmployeeContext(req) {
    const authUserId = req.user?.id || req.user?.uid;
    if (!authUserId) return null;
    const { data: emp } = await supabase.from('employees').select('id, full_name, first_name, last_name').eq('auth_user_id', authUserId).maybeSingle();
    return emp ? { authUserId, employee: { firstName: emp.first_name || emp.full_name, lastName: emp.last_name || '' } } : null;
}
async function getWorkAutoAssignmentSetting() {
    try {
        const { data, error } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'work_auto_assignment_enabled')
            .maybeSingle();
        
        if (error || !data) return false;
        
        if (typeof data.value === 'boolean') return data.value;
        if (typeof data.value === 'string') return data.value === 'true';
        if (typeof data.value === 'object' && data.value !== null) {
            return data.value.enabled === true;
        }
        return false;
    } catch (err) {
        console.error("Error fetching assignment setting:", err);
        return false;
    }
}

// Helper to find eligible teams
async function findEligibleTeamsForWork(work) {
    const { data: teams, error } = await supabase
        .from('teams')
        .select('*')
        .eq('status', 'ACTIVE')
        .eq('is_deleted', false);
    
    if (error || !teams) return [];

    const clientId = work.client_id;
    const departmentId = work.department_id;

    if (clientId && departmentId) {
        const matches = teams.filter(t => t.type === 'client-work' && t.client_id === clientId && t.department_id === departmentId);
        if (matches.length > 0) return matches;
    }

    if (clientId) {
        const matches = teams.filter(t => t.type === 'client' && t.client_id === clientId);
        if (matches.length > 0) return matches;
    }

    if (departmentId) {
        const matches = teams.filter(t => t.type === 'department' && t.department_id === departmentId);
        if (matches.length > 0) return matches;
    }

    return [];
}


// POST /api/assignments/team
router.post('/team', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { workId, teamId, assignedByOverride } = req.body;
        if (!workId || !teamId) return res.status(400).json({ success: false, error: 'workId and teamId are required' });

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) return res.status(403).json({ success: false, error: 'Unauthorized' });
        const actorName = assignedByOverride || (employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : ''));

        const { data, error } = await supabase.rpc('assign_work_to_team', {
            p_work_id: workId,
            p_team_id: teamId,
            p_assigned_by_name: actorName
        });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('[POST /api/assignments/team]', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});


// POST /api/assignments/team/reassign
router.post('/team/reassign', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { workId, newTeamId, reason, assignedByOverride } = req.body;
        if (!workId || !newTeamId) return res.status(400).json({ success: false, error: 'workId and newTeamId are required' });

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) return res.status(403).json({ success: false, error: 'Unauthorized' });
        const actorName = assignedByOverride || (employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : ''));

        const { data, error } = await supabase.rpc('reassign_work_to_team', {
            p_work_id: workId,
            p_new_team_id: newTeamId,
            p_assigned_by_name: actorName,
            p_reason: reason || ''
        });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('[POST /api/assignments/team/reassign]', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});


// POST /api/assignments/member
router.post('/member', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { workId, workItemId, teamId, memberId, assignedByOverride } = req.body;
        if (!workId || !teamId || !memberId) return res.status(400).json({ success: false, error: 'workId, teamId, and memberId are required' });

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) return res.status(403).json({ success: false, error: 'Unauthorized' });
        const actorName = assignedByOverride || (employeeCtx.employee.firstName + (employeeCtx.employee.lastName ? ` ${employeeCtx.employee.lastName}` : ''));

        const { data, error } = await supabase.rpc('assign_work_item_to_member', {
            p_work_id: workId,
            p_work_item_id: workItemId || null,
            p_team_id: teamId,
            p_member_id: memberId,
            p_assigned_by_name: actorName
        });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error('[POST /api/assignments/member]', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});


// POST /api/assignments/auto
router.post('/auto', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { workId } = req.body;
        if (!workId) return res.status(400).json({ success: false, error: 'workId is required' });

        const isAutoEnabled = await getWorkAutoAssignmentSetting();
        if (!isAutoEnabled) return res.json({ success: false, reason: 'Auto-assignment disabled' });

        const { data: work, error: workError } = await supabase.from('works').select('*').eq('id', workId).single();
        if (workError || !work) return res.status(404).json({ success: false, reason: 'Work not found' });

        const eligibleTeams = await findEligibleTeamsForWork(work);
        if (eligibleTeams.length === 0) {
            return res.json({ success: false, reason: 'No eligible teams found' });
        }

        const targetTeam = eligibleTeams[0];
        
        // Use RPC to assign
        const { data, error } = await supabase.rpc('assign_work_to_team', {
            p_work_id: workId,
            p_team_id: targetTeam.id,
            p_assigned_by_name: 'SYSTEM (Auto-Assign)'
        });

        if (error) throw error;
        res.json({ success: true, team: targetTeam, data });
    } catch (err) {
        console.error('[POST /api/assignments/auto]', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});


// POST /api/assignments/needs-reassignment
router.post('/needs-reassignment', requirePermission('MANAGE_WORKS'), async (req, res) => {
    try {
        const { workId, oldMemberId, reason } = req.body;
        if (!workId) return res.status(400).json({ success: false, error: 'workId is required' });

        const employeeCtx = await fetchEmployeeContext(req);
        if (!employeeCtx || !employeeCtx.employee) return res.status(403).json({ success: false, error: 'Unauthorized' });
        const actorName = 'SYSTEM (Leave Manager)';

        await supabase.from('works').update({
            assignment_status: 'NEEDS_REASSIGNMENT'
        }).eq('id', workId);
        
        await supabase.from('work_assignment_history').insert({
            work_id: workId,
            old_member_id: oldMemberId,
            action: 'NEEDS_REASSIGNMENT',
            reason: reason || 'Assignee went on leave',
            performed_by: actorName
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[POST /api/assignments/needs-reassignment]', err);
        res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
});


module.exports = router;
