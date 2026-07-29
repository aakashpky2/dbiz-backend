const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { hasPermission } = require('../lib/permissions');
const WorkflowRuntimeService = require('../services/WorkflowRuntimeService');
const { authenticateToken } = require('./auth');
const WorkflowExecutionService = require('../services/WorkflowExecutionService');

// Helper to resolve employee id securely
async function resolveEmployeeId(req, requestedEmployeeId) {
    const email = req.user?.email;
    if (!email) throw new Error('No email found in authenticated token.');

    const { data: employee, error } = await supabase
        .from('employees')
        .select('id, email')
        .eq('email', email)
        .single();

    if (error || !employee) throw new Error('Employee not found for authenticated user');

    if (requestedEmployeeId && requestedEmployeeId !== employee.id) {
        throw new Error('FORBIDDEN');
    }

    return employee.id;
}

// Notification Helper Function
async function sendNotification({
    recipient_employee_id,
    recipient_role,
    recipient_team_id,
    type,
    title,
    message,
    entity_type,
    entity_id,
    work_id,
    step_instance_id,
    created_by
}) {
    try {
        const { error } = await supabase
            .from('notifications')
            .insert({
                recipient_employee_id,
                recipient_role,
                recipient_team_id,
                type,
                title,
                message,
                entity_type,
                entity_id,
                work_id,
                step_instance_id,
                created_by,
                is_read: false,
                created_at: new Date().toISOString()
            });
        
        if (error) {
            console.warn('[Notification] Failed to insert notification in database:', error.message);
        } else {
            console.log(`[Notification] Successfully sent notification to recipient_employee_id: ${recipient_employee_id || 'null'}, role: ${recipient_role || 'null'}`);
        }
    } catch (err) {
        console.warn('[Notification] Database call errored (table probably does not exist yet):', err.message);
    }
}


// GET /api/my-tasks/all (Admins only)
router.get('/all', authenticateToken, async (req, res) => {
    try {
        const requesterId = await resolveEmployeeId(req);
        const allowed = await hasPermission(requesterId, 'VIEW_ALL_TASKS');
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'Access Denied: Requires VIEW_ALL_TASKS permission.' });
        }

        // 2. Fetch ALL active works
        const { data: works, error: worksError } = await supabase
            .from('works')
            .select(`
                *,
                current_handler:employees!current_handler_id(id, full_name),
                assigned_team:teams!assigned_team_id(id, name),
                work_member_assignments(id, assigned_member_id, status)
            `)
            .in('assignment_status', ['TEAM_ASSIGNED', 'MEMBER_ASSIGNED'])
            .neq('workflow_status', 'COMPLETED');

        if (worksError) throw worksError;

        // Fetch completed tasks as well
        const { data: completedWorks, error: completedError } = await supabase
            .from('works')
            .select(`
                *,
                current_handler:employees!current_handler_id(id, full_name),
                assigned_team:teams!assigned_team_id(id, name),
                work_member_assignments(id, assigned_member_id, status)
            `)
            .eq('workflow_status', 'COMPLETED')
            .limit(100); // Limit for performance

        if (completedError) throw completedError;

        const allWorks = [...(works || []), ...(completedWorks || [])];

        const { data: employees } = await supabase.from('employees').select('id, full_name');
        const employeeMap = new Map(employees ? employees.map(e => [e.id, e]) : []);

        const workIds = allWorks.map(w => w.id);
        
        let executions = [];
        let steps = [];
        
        if (workIds.length > 0) {
            const { data: execData } = await supabase
                .from('workflow_execution_instances')
                .select('*')
                .in('work_id', workIds);
                
            executions = execData || [];
            
            if (executions.length > 0) {
                const execIds = executions.map(e => e.id);
                const { data: stepsData } = await supabase
                    .from('workflow_step_instances')
                    .select('*')
                    .in('execution_instance_id', execIds)
                    .order('step_order', { ascending: true });
                
                steps = stepsData || [];
            }
        }

        const v2ExecMap = new Map(executions.map(e => [e.work_id, e]));
        const v2StepsMap = new Map();
        steps.forEach(s => {
            if (!v2StepsMap.has(s.execution_instance_id)) {
                v2StepsMap.set(s.execution_instance_id, []);
            }
            v2StepsMap.get(s.execution_instance_id).push(s);
        });

        // In-flight V2 execution auto-spawning for any works that are missing V2 executions
        for (const work of allWorks) {
            if (!v2ExecMap.has(work.id)) {
                console.log(`[MyTasks] In-flight auto-spawning execution for work ID: ${work.id}`);
                const initRes = await WorkflowExecutionService.initializeWorkflowExecution(work.id);
                if (initRes && initRes.success && !initRes.v1Fallback) {
                    const { data: newExec } = await supabase
                        .from('workflow_execution_instances')
                        .select('*')
                        .eq('work_id', work.id)
                        .maybeSingle();
                    if (newExec) {
                        executions.push(newExec);
                        v2ExecMap.set(work.id, newExec);
                        
                        const { data: newSteps } = await supabase
                            .from('workflow_step_instances')
                            .select('*')
                            .eq('execution_instance_id', newExec.id)
                            .order('step_order', { ascending: true });
                        if (newSteps && newSteps.length > 0) {
                            steps.push(...newSteps);
                            newSteps.forEach(s => {
                                if (!v2StepsMap.has(s.execution_instance_id)) {
                                    v2StepsMap.set(s.execution_instance_id, []);
                                }
                                v2StepsMap.get(s.execution_instance_id).push(s);
                            });
                        }
                    }
                }
            }
        }

        const allTasks = [];

        allWorks.forEach(work => {
            const execution = v2ExecMap.get(work.id);
            if (execution) {
                const executionSteps = v2StepsMap.get(execution.id) || [];
                executionSteps.forEach(step => {
                    const handlerName = step.claimed_by ? (employeeMap.get(step.claimed_by)?.full_name || 'Claimed') : null;
                    allTasks.push({
                        id: step.id,
                        work_id: work.id,
                        is_v2: true,
                        client_name: work.client_name,
                        work_type_name: `${work.work_type_name}: ${step.step_name}`,
                        step_name: step.step_name,
                        priority: work.priority,
                        due_date: step.due_date || step.planned_finish_date || work.due_date,
                        finish_by_date: step.finish_by_date || step.planned_finish_date || work.finish_by_date,
                        assignment_status: 'MEMBER_ASSIGNED',
                        workflow_status: step.status,
                        current_handler_id: step.claimed_by,
                        claimed_at: step.actual_started_at,
                        current_handler: step.claimed_by ? { full_name: handlerName } : null,
                        assigned_team: work.assigned_team,
                        execution_instance_id: execution.id,
                        step_order: step.step_order,
                        step_type: step.step_type,
                        progress_percentage: execution.progress_percentage
                    });
                });
            } else {
                // No Flow Work Fallback
                allTasks.push({
                    id: work.id,
                    work_id: work.id,
                    is_v2: false,
                    is_no_flow: true,
                    client_name: work.client_name,
                    work_type_name: work.work_type_name,
                    step_name: 'No Flow Assigned',
                    priority: work.priority,
                    due_date: work.due_date,
                    finish_by_date: work.finish_by_date,
                    assignment_status: work.assignment_status,
                    workflow_status: work.workflow_status,
                    current_handler_id: work.current_handler_id,
                    claimed_at: work.claimed_at,
                    current_handler: work.current_handler_id ? (employeeMap.get(work.current_handler_id) ? { full_name: employeeMap.get(work.current_handler_id).full_name } : null) : null,
                    assigned_team: work.assigned_team,
                    progress_percentage: work.workflow_status === 'COMPLETED' ? 100 : 0
                });
            }
        });

        res.json({
            success: true,
            data: allTasks
        });

    } catch (error) {
        console.error('[AllTasks API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/my-tasks/:employeeId
router.get('/:employeeId', authenticateToken, async (req, res) => {
    const { employeeId } = req.params;

    try {
        let resolvedId;
        try {
            resolvedId = await resolveEmployeeId(req, employeeId);
        } catch (err) {
            if (err.message === 'FORBIDDEN') {
                return res.status(403).json({ success: false, error: 'Access Denied: You can only view your own tasks.' });
            }
            throw err;
        }

        const allowed = await hasPermission(resolvedId, 'VIEW_MY_TASKS');
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'Access Denied: Requires VIEW_MY_TASKS permission.' });
        }

        console.log(`[MyTasks] Resolved employee id: "${resolvedId}"`);

        // STEP 1: Find all active teams of employee
        const { data: teamMemberships, error: teamError } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('employee_id', resolvedId)
            .eq('is_active', true)
            .not('availability_status', 'in', '("On Leave", "Inactive")');

        if (teamError) throw teamError;

        console.log(`[MyTasks] Team memberships found:`, teamMemberships ? teamMemberships.length : 0);
        const teamIds = teamMemberships ? teamMemberships.map(tm => tm.team_id) : [];
        console.log(`[MyTasks] Team ids:`, teamIds);

        if (teamIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    availableTasks: [],
                    myActiveTasks: [],
                    teamTasksInProgress: [],
                    completedTasks: []
                }
            });
        }

        // STEP 2: Fetch all works assigned to those teams
        const { data: works, error: worksError } = await supabase
            .from('works')
            .select(`
                *,
                current_handler:employees!current_handler_id(id, full_name),
                assigned_team:teams!assigned_team_id(id, name),
                work_member_assignments(id, assigned_member_id, status)
            `)
            .in('assigned_team_id', teamIds)
            .in('assignment_status', ['TEAM_ASSIGNED', 'MEMBER_ASSIGNED'])
            .neq('workflow_status', 'COMPLETED');

        if (worksError) throw worksError;

        // Fetch completed tasks separately if needed, but the prompt says classification logic
        // include completedTasks. Let's fetch them too.
        const { data: completedWorks, error: completedError } = await supabase
            .from('works')
            .select(`
                *,
                current_handler:employees!current_handler_id(id, full_name),
                assigned_team:teams!assigned_team_id(id, name),
                work_member_assignments(id, assigned_member_id, status)
            `)
            .in('assigned_team_id', teamIds)
            .eq('workflow_status', 'COMPLETED')
            .limit(50); // Limit completed tasks for performance

        if (completedError) throw completedError;

        const allRelevantWorks = [...(works || []), ...(completedWorks || [])];

        const { data: employees } = await supabase.from('employees').select('id, full_name');
        const employeeMap = new Map(employees ? employees.map(e => [e.id, e]) : []);

        const workIds = allRelevantWorks.map(w => w.id);
        
        let executions = [];
        let steps = [];
        
        if (workIds.length > 0) {
            const { data: execData } = await supabase
                .from('workflow_execution_instances')
                .select('*')
                .in('work_id', workIds);
                
            executions = execData || [];
            
            if (executions.length > 0) {
                const execIds = executions.map(e => e.id);
                const { data: stepsData } = await supabase
                    .from('workflow_step_instances')
                    .select('*')
                    .in('execution_instance_id', execIds)
                    .order('step_order', { ascending: true });
                
                steps = stepsData || [];
            }
        }

        const v2ExecMap = new Map(executions.map(e => [e.work_id, e]));
        const v2StepsMap = new Map();
        steps.forEach(s => {
            if (!v2StepsMap.has(s.execution_instance_id)) {
                v2StepsMap.set(s.execution_instance_id, []);
            }
            v2StepsMap.get(s.execution_instance_id).push(s);
        });

        // In-flight V2 execution auto-spawning for any works that are missing V2 executions
        for (const work of allRelevantWorks) {
            if (!v2ExecMap.has(work.id)) {
                console.log(`[MyTasks] In-flight auto-spawning execution for work ID: ${work.id}`);
                const initRes = await WorkflowExecutionService.initializeWorkflowExecution(work.id);
                if (initRes && initRes.success && !initRes.v1Fallback) {
                    const { data: newExec } = await supabase
                        .from('workflow_execution_instances')
                        .select('*')
                        .eq('work_id', work.id)
                        .maybeSingle();
                    if (newExec) {
                        executions.push(newExec);
                        v2ExecMap.set(work.id, newExec);
                        
                        const { data: newSteps } = await supabase
                            .from('workflow_step_instances')
                            .select('*')
                            .eq('execution_instance_id', newExec.id)
                            .order('step_order', { ascending: true });
                        if (newSteps && newSteps.length > 0) {
                            steps.push(...newSteps);
                            newSteps.forEach(s => {
                                if (!v2StepsMap.has(s.execution_instance_id)) {
                                    v2StepsMap.set(s.execution_instance_id, []);
                                }
                                v2StepsMap.get(s.execution_instance_id).push(s);
                            });
                        }
                    }
                }
            }
        }

        // STEP 3: Classification logic
        const responseData = {
            availableTasks: [],
            myActiveTasks: [],
            teamTasksInProgress: [],
            completedTasks: []
        };

        allRelevantWorks.forEach(work => {
            const execution = v2ExecMap.get(work.id);
            
            if (execution) {
                // V2 Engine: Classify individual steps instead of the work
                const executionSteps = v2StepsMap.get(execution.id) || [];
                executionSteps.forEach(step => {
                    const handlerName = step.claimed_by ? (employeeMap.get(step.claimed_by)?.full_name || 'Claimed') : null;
                    
                    const stepTaskObj = {
                        id: step.id, // Step Instance ID
                        work_id: work.id, // Parent Work ID
                        is_v2: true,
                        client_name: work.client_name,
                        work_type_name: `${work.work_type_name}: ${step.step_name}`,
                        step_name: step.step_name,
                        priority: work.priority,
                        due_date: step.due_date || step.planned_finish_date || work.due_date,
                        finish_by_date: step.finish_by_date || step.planned_finish_date || work.finish_by_date,
                        assignment_status: 'MEMBER_ASSIGNED',
                        workflow_status: step.status,
                        current_handler_id: step.claimed_by,
                        claimed_at: step.actual_started_at,
                        current_handler: step.claimed_by ? { full_name: handlerName } : null,
                        assigned_team: work.assigned_team,
                        execution_instance_id: execution.id,
                        step_order: step.step_order,
                        step_type: step.step_type,
                        depends_on_step_instance_ids: step.depends_on_step_instance_ids
                    };

                    const isStepClaimedByMe = step.claimed_by === resolvedId;
                    const isStepClaimedByOthers = step.claimed_by && step.claimed_by !== resolvedId;

                    if (step.status === 'COMPLETED') {
                        responseData.completedTasks.push(stepTaskObj);
                    } else if (isStepClaimedByMe && step.status === 'IN_PROGRESS') {
                        responseData.myActiveTasks.push(stepTaskObj);
                    } else if (isStepClaimedByOthers && step.status === 'IN_PROGRESS') {
                        responseData.teamTasksInProgress.push(stepTaskObj);
                    } else if (!step.claimed_by && step.status === 'AVAILABLE') {
                        responseData.availableTasks.push(stepTaskObj);
                    }
                });
            } else {
                // No Flow Work Fallback: Classify basic work unit
                const isClaimedByMe = work.current_handler_id === resolvedId;
                const isClaimedByOthers = work.current_handler_id && work.current_handler_id !== resolvedId;

                const noFlowTaskObj = {
                    id: work.id,
                    work_id: work.id,
                    is_v2: false,
                    is_no_flow: true,
                    client_name: work.client_name,
                    work_type_name: work.work_type_name,
                    step_name: 'No Flow Assigned',
                    priority: work.priority,
                    due_date: work.due_date,
                    finish_by_date: work.finish_by_date,
                    assignment_status: work.assignment_status,
                    workflow_status: work.workflow_status,
                    current_handler_id: work.current_handler_id,
                    claimed_at: work.claimed_at,
                    current_handler: work.current_handler_id ? (employeeMap.get(work.current_handler_id) ? { full_name: employeeMap.get(work.current_handler_id).full_name } : null) : null,
                    assigned_team: work.assigned_team
                };

                if (work.workflow_status === 'COMPLETED') {
                    responseData.completedTasks.push(noFlowTaskObj);
                } else if (isClaimedByMe && work.workflow_status === 'IN_PROGRESS') {
                    responseData.myActiveTasks.push(noFlowTaskObj);
                } else if (isClaimedByOthers && work.workflow_status === 'IN_PROGRESS') {
                    responseData.teamTasksInProgress.push(noFlowTaskObj);
                } else if (!work.current_handler_id && (work.workflow_status === 'AVAILABLE' || work.workflow_status === 'TEAM_ASSIGNED')) {
                    responseData.availableTasks.push(noFlowTaskObj);
                }
            }
        });

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('[MyTasks API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/my-tasks/claim
router.post('/claim', authenticateToken, async (req, res) => {
    const { workId, employeeId } = req.body;

    try {
        let resolvedId;
        try {
            resolvedId = await resolveEmployeeId(req, employeeId);
        } catch (err) {
            if (err.message === 'FORBIDDEN') {
                return res.status(403).json({ success: false, error: 'Access Denied: You can only claim tasks for yourself.' });
            }
            throw err;
        }

        const allowed = await hasPermission(resolvedId, 'CLAIM_TASKS');
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'Access Denied: Requires CLAIM_TASKS permission.' });
        }
        const now = new Date().toISOString();

        // Retrieve actor's full name
        const { data: actorEmployee } = await supabase
            .from('employees')
            .select('full_name')
            .eq('id', resolvedId)
            .maybeSingle();
        const actorName = actorEmployee?.full_name || 'An employee';

        // 1. Check if the incoming ID is a V2 Step Instance
        const { data: stepInstance, error: stepFetchError } = await supabase
            .from('workflow_step_instances')
            .select('*, execution:workflow_execution_instances(*)')
            .eq('id', workId)
            .maybeSingle();

        if (stepInstance) {
            // Collision prevention and atomic claim for V2 Step via RPC
            const { data: rpcResult, error: rpcErr } = await supabase.rpc('claim_workflow_step', {
                p_step_id: workId,
                p_employee_id: resolvedId
            });

            if (rpcErr) throw rpcErr;
            if (!rpcResult.success) {
                return res.status(409).json({ success: false, error: rpcResult.error || 'This step has already been claimed or is no longer available.' });
            }

            // Recipient IDs set
            const recipientIds = new Set();

            // 1. Assigned team members, Leads, Seniors
            if (stepInstance.assigned_team_id) {
                const { data: members } = await supabase
                    .from('team_members')
                    .select('employee_id')
                    .eq('team_id', stepInstance.assigned_team_id)
                    .eq('is_active', true);

                if (members) {
                    members.forEach(m => {
                        if (m.employee_id && m.employee_id !== resolvedId) {
                            recipientIds.add(m.employee_id);
                        }
                    });
                }
            }

            // 2. Admins/System Admins
            const { data: admins } = await supabase
                .from('employees')
                .select('id')
                .eq('is_active', true)
                .in('employee_role', ['ADMIN', 'SUPER_ADMIN', 'HR', 'SUPERADMIN']);

            if (admins) {
                admins.forEach(a => {
                    if (a.id && a.id !== resolvedId) {
                        recipientIds.add(a.id);
                    }
                });
            }

            // 3. Employees already working on parallel steps of the same workflow execution
            if (stepInstance.execution_instance_id) {
                const { data: parallelSteps } = await supabase
                    .from('workflow_step_instances')
                    .select('claimed_by')
                    .eq('execution_instance_id', stepInstance.execution_instance_id)
                    .eq('status', 'IN_PROGRESS');

                if (parallelSteps) {
                    parallelSteps.forEach(ps => {
                        if (ps.claimed_by && ps.claimed_by !== resolvedId) {
                            recipientIds.add(ps.claimed_by);
                        }
                    });
                }
            }

            // Query work details to get work name and client name
            const { data: parentWork } = await supabase
                .from('works')
                .select('client_name, work_type_name, assigned_team:teams(name)')
                .eq('id', stepInstance.execution.work_id)
                .maybeSingle();

            const clientName = parentWork?.client_name || 'N/A';
            const workTypeName = parentWork?.work_type_name || 'N/A';
            const teamName = parentWork?.assigned_team?.name || 'N/A';

            // Send V2 Step claim notifications
            const notificationPromises = Array.from(recipientIds).map(recipientId => {
                return sendNotification({
                    recipient_employee_id: recipientId,
                    type: 'TASK_CLAIMED',
                    title: 'Task Claimed',
                    message: `${actorName} started ${stepInstance.step_name} for ${workTypeName} - ${clientName}.`,
                    entity_type: 'step_instance',
                    entity_id: workId,
                    work_id: stepInstance.execution.work_id,
                    step_instance_id: workId,
                    created_by: resolvedId
                });
            });
            await Promise.all(notificationPromises);

            return res.json({ success: true, message: 'Step claimed successfully' });
        }

        // 2. Check if the incoming ID is a No-Flow Work in the works table
        const { data: work, error: fetchError } = await supabase
            .from('works')
            .select('*')
            .eq('id', workId)
            .maybeSingle();

        if (work) {
            // Check if there is already an execution spawned
            const { data: hasExec } = await supabase
                .from('workflow_execution_instances')
                .select('id')
                .eq('work_id', workId)
                .maybeSingle();

            if (hasExec) {
                return res.status(400).json({ success: false, error: 'V2 Execution exists for this work. Please claim the step instead.' });
            }

            // Collision prevention for No Flow Work: Update status only if AVAILABLE and current_handler_id is NULL
            const { data: updatedWorks, error: updateError } = await supabase
                .from('works')
                .update({
                    current_handler_id: resolvedId,
                    claimed_at: now,
                    started_at: work.started_at || now,
                    workflow_status: 'IN_PROGRESS',
                    assignment_status: 'MEMBER_ASSIGNED',
                    updated_at: now
                })
                .eq('id', workId)
                .is('current_handler_id', null)
                .eq('workflow_status', 'AVAILABLE')
                .select();

            if (updateError) throw updateError;

            if (!updatedWorks || updatedWorks.length === 0) {
                return res.status(409).json({ success: false, error: 'This work has already been claimed by another team member.' });
            }

            // Log history safely
            await supabase
                .from('work_assignment_history')
                .insert({
                    work_id: workId,
                    new_member_id: resolvedId,
                    action: 'WORK_CLAIMED',
                    performed_by: resolvedId,
                    created_at: now
                });

            // Recipient IDs set
            const recipientIds = new Set();

            // 1. Assigned team members, Leads, Seniors
            if (work.assigned_team_id) {
                const { data: members } = await supabase
                    .from('team_members')
                    .select('employee_id')
                    .eq('team_id', work.assigned_team_id)
                    .eq('is_active', true);

                if (members) {
                    members.forEach(m => {
                        if (m.employee_id && m.employee_id !== resolvedId) {
                            recipientIds.add(m.employee_id);
                        }
                    });
                }
            }

            // 2. Admins/System Admins
            const { data: admins } = await supabase
                .from('employees')
                .select('id')
                .eq('is_active', true)
                .in('employee_role', ['ADMIN', 'SUPER_ADMIN', 'HR', 'SUPERADMIN']);

            if (admins) {
                admins.forEach(a => {
                    if (a.id && a.id !== resolvedId) {
                        recipientIds.add(a.id);
                    }
                });
            }

            const clientName = work.client_name || 'N/A';
            const workTypeName = work.work_type_name || 'N/A';

            // Send No Flow claim notifications
            const notificationPromises = Array.from(recipientIds).map(recipientId => {
                return sendNotification({
                    recipient_employee_id: recipientId,
                    type: 'TASK_CLAIMED',
                    title: 'Task Claimed',
                    message: `${actorName} started ${workTypeName} for ${clientName}.`,
                    entity_type: 'work',
                    entity_id: workId,
                    work_id: workId,
                    created_by: resolvedId
                });
            });
            await Promise.all(notificationPromises);

            return res.json({ success: true, message: 'No-Flow Work claimed successfully' });
        }

        return res.status(404).json({ success: false, error: 'Step instance or work not found' });

    } catch (error) {
        console.error('[MyTasks Claim API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/my-tasks/complete
router.post('/complete', async (req, res) => {
    const { workId, employeeId } = req.body;
    const requesterId = req.headers['x-user-id'] || employeeId;

    try {
        const allowed = await hasPermission(requesterId, 'COMPLETE_TASKS');
        if (!allowed) {
            return res.status(403).json({ success: false, error: 'Access Denied: Requires COMPLETE_TASKS permission.' });
        }

        const resolvedId = await resolveEmployeeId(employeeId);
        const now = new Date().toISOString();

        // 1. Check if the incoming ID is a V2 Step Instance
        const { data: stepInstance } = await supabase
            .from('workflow_step_instances')
            .select('*, execution:workflow_execution_instances(*)')
            .eq('id', workId)
            .maybeSingle();

        if (stepInstance) {
            // V2 Step Completion Workflow with DAG Status Propagation
            // We use the new WorkflowRuntimeService
            try {
                // employeeContext is expected to have dbUserId or employeeId
                const employeeContext = { dbUserId: resolvedId, employeeId: resolvedId, authUid: requesterId };
                await WorkflowRuntimeService.completeStep({
                    workId: stepInstance.execution.work_id,
                    stepInstanceId: workId,
                    employeeContext
                });
                
                // Close any active work sessions (in_progress or paused) for this work/step
                const { data: activeWorks } = await supabase
                    .from('user_active_work')
                    .select('*')
                    .eq('work_id', workId)
                    .in('status', ['in_progress', 'paused']);

                if (activeWorks && activeWorks.length > 0) {
                    for (const aw of activeWorks) {
                        let additionalSeconds = 0;
                        if (aw.status === 'in_progress') {
                            const lastActivity = new Date(aw.last_activity_at);
                            additionalSeconds = Math.floor((new Date(now) - lastActivity) / 1000);
                        }
                        const newElapsed = (aw.elapsed_seconds || 0) + Math.max(0, additionalSeconds);

                        await supabase.from('user_active_work')
                            .update({
                                status: 'completed',
                                completed_at: now,
                                elapsed_seconds: newElapsed,
                                last_activity_at: now,
                                progress: 100
                            })
                            .eq('id', aw.id);
                    }
                }

                return res.json({ success: true, message: 'Step completed successfully' });
            } catch (err) {
                console.error('[MyTasksRoutes] Complete Step Error:', err);
                return res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to complete V2 Step' });
            }
        }

        // 2. Check if the incoming ID is a No-Flow Work in the works table
        const { data: work, error: fetchError } = await supabase
            .from('works')
            .select('*')
            .eq('id', workId)
            .maybeSingle();

        if (work) {
            // Check if there is already an execution spawned
            const { data: hasExec } = await supabase
                .from('workflow_execution_instances')
                .select('id')
                .eq('work_id', workId)
                .maybeSingle();

            if (hasExec) {
                return res.status(400).json({ success: false, error: 'V2 Execution exists for this work. Please complete the step instead.' });
            }

            const { error: updateError } = await supabase
                .from('works')
                .update({
                    workflow_status: 'COMPLETED',
                    completed_at: now,
                    status: 'Completed'
                })
                .eq('id', workId);

            if (updateError) throw updateError;

            // Log completion history safely
            await supabase
                .from('work_assignment_history')
                .insert({
                    work_id: workId,
                    performed_by: resolvedId,
                    action: 'WORK_COMPLETED',
                    created_at: now
                });

            // Close any active work sessions (in_progress or paused) for this work
            const { data: activeWorks } = await supabase
                .from('user_active_work')
                .select('*')
                .eq('work_id', workId)
                .in('status', ['in_progress', 'paused']);

            if (activeWorks && activeWorks.length > 0) {
                for (const aw of activeWorks) {
                    let additionalSeconds = 0;
                    if (aw.status === 'in_progress') {
                        const lastActivity = new Date(aw.last_activity_at);
                        additionalSeconds = Math.floor((new Date(now) - lastActivity) / 1000);
                    }
                    const newElapsed = (aw.elapsed_seconds || 0) + Math.max(0, additionalSeconds);

                    await supabase.from('user_active_work')
                        .update({
                            status: 'completed',
                            completed_at: now,
                            elapsed_seconds: newElapsed,
                            last_activity_at: now,
                            progress: 100
                        })
                        .eq('id', aw.id);
                }
            }

            return res.json({ success: true, message: 'No-Flow Work completed successfully' });
        }

        return res.status(404).json({ success: false, error: 'Step instance or work not found' });
    } catch (error) {
        console.error('[MyTasks Complete API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/my-tasks/timeline/:executionId
router.get('/timeline/:executionId', async (req, res) => {
    const { executionId } = req.params;
    try {
        // Fetch parent execution
        const { data: exec, error: execErr } = await supabase
            .from('workflow_execution_instances')
            .select(`
                *,
                work:works(id, client_name, work_type_name, priority, due_date, finish_by_date)
            `)
            .eq('id', executionId)
            .single();

        if (execErr) throw execErr;

        // Fetch all steps for this execution
        const { data: steps, error: stepsErr } = await supabase
            .from('workflow_step_instances')
            .select('*')
            .eq('execution_instance_id', executionId)
            .order('step_order', { ascending: true });

        if (stepsErr) throw stepsErr;

        // Fetch employees to map handler names
        const { data: employees } = await supabase.from('employees').select('id, full_name');
        const empMap = new Map(employees ? employees.map(e => [e.id, e.full_name]) : []);

        const stepsWithHandlers = steps.map(s => ({
            ...s,
            claimed_by_name: s.claimed_by ? (empMap.get(s.claimed_by) || 'Claimed') : null,
            completed_by_name: s.completed_by ? (empMap.get(s.completed_by) || 'Completed') : null
        }));

        res.json({
            success: true,
            execution: exec,
            steps: stepsWithHandlers
        });
    } catch (error) {
        console.error('[Timeline API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

