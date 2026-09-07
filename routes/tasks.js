const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const TaskWorkflowResolverService = require('../services/TaskWorkflowResolverService');
const WorkflowExecutionService = require('../services/WorkflowExecutionService');
const WorkflowRuntimeService = require('../services/WorkflowRuntimeService');
const WorkflowDocumentService = require('../services/WorkflowDocumentService');
const { requirePermission } = require('../lib/permissions');
const multer = require('multer');

// Configure multer with an absolute memory limit slightly above largest supported config (e.g. 25MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

// Helper to reliably get user profile from request
async function getRequestUserProfile(req) {
    const authUid =
        req.user?.uid ||
        req.user?.id ||
        req.headers['x-user-id'] ||
        req.headers['x-user-uid'];

    const email =
        req.user?.email ||
        req.headers['x-user-email'];

    if (!authUid) {
        return { error: 'Unauthorized: User identification missing' };
    }

    const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('id, uid, email, full_name, display_name, is_owner_super_admin, role_ids, employee_id')
        .eq('uid', String(authUid))
        .maybeSingle();

    if (error) {
        console.error('[Tasks API] Failed to fetch user profile:', error);
        return { error: error.message };
    }

    if (!profile) {
        return { error: 'Unauthorized: User profile not found' };
    }

    let resolvedEmployeeId = profile.employee_id;
    const resolvedEmail = profile.email || email;

    if (!resolvedEmployeeId && resolvedEmail) {
        const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id')
            .ilike('email', resolvedEmail)
            .maybeSingle();
            
        if (!empErr && emp) {
            resolvedEmployeeId = emp.id;
        }
    }

    return {
        authUid: profile.uid,
        dbUserId: profile.id,
        employeeId: resolvedEmployeeId,
        email: resolvedEmail,
        profile
    };
}

// Helper for entity resolution between tasks and works
async function resolveEntity(id) {
    if (!id) return null;

    // 1. Try tasks first
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (taskError) {
        throw taskError;
    }

    if (task) {
        return {
            entityType: 'TASK',
            entityId: id,
            data: task
        };
    }

    // 2. Try works
    const { data: work, error: workError } = await supabase
        .from('works')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (workError) {
        throw workError;
    }

    if (work) {
        return {
            entityType: 'WORK',
            entityId: id,
            data: work
        };
    }

    // 3. Try workflow_step_instances (for V2 route where taskId in URL is step.id)
    const { data: stepInst, error: stepInstErr } = await supabase
        .from('workflow_step_instances')
        .select('*, execution:workflow_execution_instances(work_id, works(*))')
        .eq('id', id)
        .maybeSingle();

    if (!stepInstErr && stepInst && stepInst.execution && stepInst.execution.works) {
        return {
            entityType: 'WORK',
            entityId: stepInst.execution.works.id,
            data: stepInst.execution.works
        };
    }

    return null;
}

// Helper to get or safely initialize active execution instance for a work
async function ensureWorkflowExecutionForWork(workId, work) {
    const { data, error } = await supabase
        .from('workflow_execution_instances')
        .select('*')
        .eq('work_id', workId)
        .not('status', 'eq', 'COMPLETED')
        .not('status', 'eq', 'CANCELLED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    
    if (error) throw error;
    
    if (!data) {
        // If no active one, try to get the latest one anyway (historical or reopened)
        const { data: fallback, error: fbError } = await supabase
            .from('workflow_execution_instances')
            .select('*')
            .eq('work_id', workId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (fbError) throw fbError;
        
        if (fallback) {
            return fallback;
        }

        // Initialize only if work is not completed or cancelled, and a valid workflow is configured
        if (work && work.workflow_status !== 'COMPLETED' && work.workflow_status !== 'CANCELLED' && work.status !== 'COMPLETED') {
            const initRes = await WorkflowExecutionService.initializeWorkflowExecution(workId);
            if (initRes.success) {
                return initRes.execution || initRes.data;
            } else {
                console.warn(`[ensureWorkflowExecutionForWork] Initialization failed for ${workId}:`, initRes.error);
            }
        }
    }
    return data;
}

// Query selector string for tasks
const TASK_SELECT_QUERY = `
    *,
    clients ( client_name ),
    work_types ( name )
`;

// Helper to attach user names to tasks
async function attachUserNames(tasks) {
    const ids = new Set();
    const uidsFallback = new Set(); // To support auth uid fallback
    const teamIds = new Set();

    for (const task of tasks || []) {
        const assignedTo = Array.isArray(task.assigned_to) ? task.assigned_to : [];

        assignedTo.forEach(id => {
            if (!id) return;
            // UUID is 36 chars long.
            if (String(id).length === 36) ids.add(String(id));
            else uidsFallback.add(String(id));
        });

        if (task.claimed_by) {
            if (String(task.claimed_by).length === 36) ids.add(String(task.claimed_by));
            else uidsFallback.add(String(task.claimed_by));
        }
        if (task.created_by) {
            if (String(task.created_by).length === 36) ids.add(String(task.created_by));
            else uidsFallback.add(String(task.created_by));
        }
        if (task.reviewed_by) {
            if (String(task.reviewed_by).length === 36) ids.add(String(task.reviewed_by));
            else uidsFallback.add(String(task.reviewed_by));
        }
        if (task.assigned_team_id) {
            teamIds.add(String(task.assigned_team_id));
        }
    }

    if (ids.size === 0 && uidsFallback.size === 0 && teamIds.size === 0) {
        return (tasks || []).map(task => ({
            ...task,
            assignedToNames: [],
            claimedByName: null,
            createdByName: null,
            reviewedByName: null,
        }));
    }

    let profiles = [];

    if (ids.size > 0) {
        const { data: idProfiles, error } = await supabase
            .from('user_profiles')
            .select('id, uid, full_name, display_name, email')
            .in('id', Array.from(ids));
        if (error) console.error('[Tasks API] user profile by id lookup error:', error);
        if (idProfiles) profiles = profiles.concat(idProfiles);
    }

    if (uidsFallback.size > 0) {
        const { data: uidProfiles, error } = await supabase
            .from('user_profiles')
            .select('id, uid, full_name, display_name, email')
            .in('uid', Array.from(uidsFallback));
        if (error) console.error('[Tasks API] user profile by uid lookup error:', error);
        if (uidProfiles) profiles = profiles.concat(uidProfiles);
    }

    const profileMap = {};
    for (const p of profiles || []) {
        const name = p.full_name || p.display_name || p.email || 'Unknown';
        profileMap[String(p.id)] = name;
        if (p.uid) profileMap[String(p.uid)] = name;
    }

    let teams = [];
    if (teamIds.size > 0) {
        const { data: teamProfiles, error } = await supabase
            .from('teams')
            .select('id, name')
            .in('id', Array.from(teamIds));
        if (error) console.error('[Tasks API] team profile by id lookup error:', error);
        if (teamProfiles) teams = teams.concat(teamProfiles);
    }
    const teamMap = {};
    for (const t of teams || []) {
        teamMap[String(t.id)] = t.name;
    }

    return (tasks || []).map(task => {
        const assignedTo = Array.isArray(task.assigned_to) ? task.assigned_to : [];

        return {
            ...task,
            assignedToNames: assignedTo.map(id => profileMap[String(id)] || 'Unknown'),
            claimedByName: task.claimed_by ? profileMap[String(task.claimed_by)] || 'Unknown' : null,
            createdByName: task.created_by ? profileMap[String(task.created_by)] || 'Unknown' : null,
            reviewedByName: task.reviewed_by ? profileMap[String(task.reviewed_by)] || 'Unknown' : null,
            assignedTeamName: task.assigned_team_id ? teamMap[String(task.assigned_team_id)] || 'No Team' : 'No Team',
        };
    });
}

// Helper to resolve and format a task
async function formatTask(task) {
    const workflowRes = await TaskWorkflowResolverService.resolveWorkflowForTask(task);
    let steps = [];
    if (workflowRes.template) {
        steps = await TaskWorkflowResolverService.getWorkflowSteps(workflowRes.template.id);
    }
    const formatted = TaskWorkflowResolverService.formatTaskWithWorkflow(task, workflowRes, steps);
    
    // Inject normalized backend progress and ownership from pre-resolved data
    if (task.progressPercentage !== undefined) {
        formatted.progressPercentage = task.progressPercentage;
    }
    if (task.completedById) {
        formatted.completedById = task.completedById;
        formatted.completedByName = task.completedByName;
    }
    return formatted;
}

// Helper to resolve completion ownership and progress for a batch of works
async function resolveCompletionOwnership(worksArr) {
    if (!worksArr || worksArr.length === 0) return {};
    const workIds = worksArr.map(w => w.id);
    
    // 1. Fetch executions
    const { data: executions } = await supabase
        .from('workflow_execution_instances')
        .select('*')
        .in('work_id', workIds);
        
    // 2. Fetch steps
    const execIds = (executions || []).map(e => e.id);
    let steps = [];
    if (execIds.length > 0) {
        const { data: stepsData } = await supabase
            .from('workflow_step_instances')
            .select('execution_instance_id, completed_by, actual_completed_at')
            .in('execution_instance_id', execIds)
            .eq('status', 'COMPLETED')
            .order('actual_completed_at', { ascending: false });
        steps = stepsData || [];
    }
    
    // 3. Fetch active works
    const { data: activeWorks } = await supabase
        .from('user_active_work')
        .select('work_id, employee_id, ended_at')
        .in('work_id', workIds)
        .order('ended_at', { ascending: false });

    // Grouping & Resolving
    const map = {};
    const execMap = new Map();
    (executions || []).forEach(e => execMap.set(e.work_id, e));
    
    const stepsMap = new Map();
    steps.forEach(s => {
        if (!stepsMap.has(s.execution_instance_id)) {
            stepsMap.set(s.execution_instance_id, s); // since ordered by desc, first one is latest
        }
    });
    
    const activeWorksMap = new Map();
    (activeWorks || []).forEach(aw => {
        if (aw.ended_at && !activeWorksMap.has(aw.work_id)) {
            activeWorksMap.set(aw.work_id, aw.employee_id);
        }
    });

    for (const work of worksArr) {
        let progress = 0;
        let completedById = null;
        const isCompleted = (work.status || '').toUpperCase() === 'COMPLETED' || (work.workflow_status || '').toUpperCase() === 'COMPLETED';
        
        const exec = execMap.get(work.id);
        if (isCompleted) {
            progress = 100;
        } else if (exec) {
            progress = exec.progress_percentage || 0;
        }
        
        if (isCompleted) {
            if (exec && exec.completed_by) {
                completedById = exec.completed_by;
            } else if (exec && stepsMap.has(exec.id) && stepsMap.get(exec.id).completed_by) {
                completedById = stepsMap.get(exec.id).completed_by;
            } else if (activeWorksMap.has(work.id)) {
                completedById = activeWorksMap.get(work.id);
            } else if (work.current_handler_id) {
                completedById = work.current_handler_id;
            }
        }
        
        map[work.id] = {
            progressPercentage: progress,
            completedById: completedById
        };
    }
    
    return map;
}


// GET /api/tasks/my
router.get('/my', requirePermission('VIEW_MY_TASKS'), async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { dbUserId, employeeId } = currentUser;

        const { data: tasks, error } = await supabase
            .from('tasks')
            .select(TASK_SELECT_QUERY)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch operational works to properly represent them in My Tasks
        const { data: operationalWorks, error: worksError } = await supabase
            .from('works')
            .select('*'); // We fetch all and filter in memory for complex ownership
            
        if (worksError) {
            console.error('[Tasks API] my tasks works fetch error:', worksError);
        }

        // Fetch team memberships
        const { data: teamMemberships } = await supabase
            .from('team_members')
            .select('team_id')
            .eq('employee_id', employeeId)
            .eq('is_active', true);
            
        const teamIds = (teamMemberships || []).map(tm => tm.team_id);

        const ownershipMap = await resolveCompletionOwnership(operationalWorks || []);
        
        // Find works belonging to My Tasks
        const myOperationalWorks = (operationalWorks || []).filter(work => {
            const ownership = ownershipMap[work.id] || {};
            const isAssigned = work.current_handler_id === employeeId;
            const isTeamAssigned = work.assigned_team_id && teamIds.includes(work.assigned_team_id);
            const isCompletedByMe = ownership.completedById === employeeId;
            
            return isAssigned || isTeamAssigned || isCompletedByMe;
        });

        const taskMap = new Map();

        // 1. Process tasks (legacy fallback)
        (tasks || []).forEach(task => {
            let businessKey = `task_${task.id}`;
            if (task.description && task.description.includes('legacy_work_id:')) {
                const match = task.description.match(/legacy_work_id:([a-fA-F0-9-]+)/);
                if (match && match[1]) businessKey = `work_${match[1]}`;
            }
            
            const assignedTo = Array.isArray(task.assigned_to) ? task.assigned_to : [];
            const isMine = (
                assignedTo.map(String).includes(String(dbUserId)) ||
                String(task.claimed_by || '') === String(dbUserId) ||
                String(task.created_by || '') === String(dbUserId)
            );
            
            if (isMine) {
                taskMap.set(businessKey, task);
            }
        });

        // 2. Process operational works
        myOperationalWorks.forEach(work => {
            const businessKey = `work_${work.id}`;
            const ownership = ownershipMap[work.id] || {};
            
            const mappedTask = {
                id: work.id,
                client_id: work.client_id,
                client_name: work.client_name,
                work_type_id: work.work_type_id,
                workflow_template_id: work.workflow_template_id || null,
                title: work.work_type_name || work.name || 'Work',
                description: work.remarks || '',
                priority: work.priority,
                due_date: work.due_date,
                status: work.workflow_status === 'COMPLETED' ? 'COMPLETED' : 
                        (work.current_handler_id && work.started_at ? 'IN_PROGRESS' :
                        (work.current_handler_id ? 'CLAIMED' :
                        (work.assigned_team_id ? 'AVAILABLE' : (work.workflow_status || 'AVAILABLE')))),
                created_by: null,
                assigned_team_id: work.assigned_team_id,
                assignment_status: work.assignment_status,
                claimed_by: work.current_handler_id,
                created_at: work.created_at,
                updated_at: work.updated_at,
                assigned_to: [],
                clients: work.client_name ? { client_name: work.client_name } : null,
                work_types: work.work_type_name ? { name: work.work_type_name } : null,
                progressPercentage: ownership.progressPercentage,
                completed_by: ownership.completedById
            };

            taskMap.set(businessKey, mappedTask);
        });

        const mergedTasks = Array.from(taskMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const tasksWithUsers = await attachUserNames(mergedTasks);
        
        // Attach completedByName explicitly for mapped works
        const { data: allEmployees } = await supabase.from('employees').select('id, full_name');
        const empNameMap = new Map((allEmployees || []).map(e => [e.id, e.full_name]));
        
        tasksWithUsers.forEach(t => {
            if (t.completed_by) {
                t.completedById = t.completed_by;
                t.completedByName = empNameMap.get(t.completed_by) || 'Unknown';
            }
        });

        const formattedTasks = await Promise.all(tasksWithUsers.map(formatTask));

        res.json({ success: true, data: formattedTasks });
    } catch (error) {
        console.error('[Tasks API] my tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/tasks/all
router.get('/all', requirePermission('VIEW_ALL_TASKS'), async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select(TASK_SELECT_QUERY)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch operational works
        const { data: operationalWorks, error: worksError } = await supabase
            .from('works')
            .select('*')
            .or('assigned_team_id.not.is.null,current_handler_id.not.is.null,assignment_status.in.(TEAM_ASSIGNED,MEMBER_ASSIGNED,IN_PROGRESS,NEEDS_REASSIGNMENT),status.eq.COMPLETED,workflow_status.eq.COMPLETED');
            
        if (worksError) {
            console.error('[Tasks API] all tasks works fetch error:', worksError);
        }

        const taskMap = new Map();

        // 1. Process tasks (legacy fallback)
        (tasks || []).forEach(task => {
            let businessKey = `task_${task.id}`;
            if (task.description && task.description.includes('legacy_work_id:')) {
                const match = task.description.match(/legacy_work_id:([a-fA-F0-9-]+)/);
                if (match && match[1]) businessKey = `work_${match[1]}`;
            }
            taskMap.set(businessKey, task);
        });

        const ownershipMap = await resolveCompletionOwnership(operationalWorks || []);

        // 2. Process operational works
        (operationalWorks || []).forEach(work => {
            const businessKey = `work_${work.id}`;
            const ownership = ownershipMap[work.id] || {};
            
            // Map work to exactly match the Task DTO shape
            const mappedTask = {
                id: work.id,
                client_id: work.client_id,
                client_name: work.client_name,
                work_type_id: work.work_type_id,
                workflow_template_id: work.workflow_template_id || null,
                title: work.work_type_name || work.name || 'Work',
                description: work.remarks || '',
                priority: work.priority,
                due_date: work.due_date,
                status: work.workflow_status === 'COMPLETED' ? 'COMPLETED' : 
                        (work.current_handler_id && work.started_at ? 'IN_PROGRESS' :
                        (work.current_handler_id ? 'CLAIMED' :
                        (work.assigned_team_id ? 'AVAILABLE' : (work.workflow_status || 'AVAILABLE')))),
                created_by: null,
                assigned_team_id: work.assigned_team_id,
                assignment_status: work.assignment_status,
                claimed_by: work.current_handler_id,
                created_at: work.created_at,
                updated_at: work.updated_at,
                assigned_to: [],
                clients: work.client_name ? { client_name: work.client_name } : null,
                work_types: work.work_type_name ? { name: work.work_type_name } : null,
                progressPercentage: ownership.progressPercentage,
                completed_by: ownership.completedById
            };

            // Prefer operational works over legacy task representations
            taskMap.set(businessKey, mappedTask);
        });

        const mergedTasks = Array.from(taskMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const tasksWithUsers = await attachUserNames(mergedTasks);
        
        // Attach completedByName explicitly for mapped works
        const { data: allEmployees } = await supabase.from('employees').select('id, full_name');
        const empNameMap = new Map((allEmployees || []).map(e => [e.id, e.full_name]));
        
        tasksWithUsers.forEach(t => {
            if (t.completed_by) {
                t.completedById = t.completed_by;
                t.completedByName = empNameMap.get(t.completed_by) || 'Unknown';
            }
        });

        const formattedTasks = await Promise.all(tasksWithUsers.map(formatTask));

        res.json({ success: true, data: formattedTasks });
    } catch (error) {
        console.error('[Tasks API] all tasks error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// GET /api/tasks/:id
router.get('/:id', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });
        
        const entityRes = await resolveEntity(req.params.id);
        if (!entityRes) {
            return res.status(404).json({ error: 'Task or Work not found' });
        }

        let task;
        let isWork = entityRes.entityType === 'WORK';
        let workProgress = {};

        if (entityRes.entityType === 'TASK') {
            const { data: fullTask, error } = await supabase
                .from('tasks')
                .select(TASK_SELECT_QUERY)
                .eq('id', req.params.id)
                .maybeSingle();
            if (error) throw error;
            if (!fullTask) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            task = fullTask;
        } else {
            const work = entityRes.data;
            // Map work to exactly match the Task DTO shape
            task = {
                id: work.id,
                client_id: work.client_id,
                client_name: work.client_name,
                work_type_id: work.work_type_id,
                workflow_template_id: work.workflow_template_id || null,
                title: work.work_type_name || work.name || 'Work',
                description: work.remarks || '',
                priority: work.priority,
                due_date: work.due_date,
                status: work.workflow_status === 'COMPLETED' ? 'COMPLETED' : 
                        (work.current_handler_id && work.started_at ? 'IN_PROGRESS' :
                        (work.current_handler_id ? 'CLAIMED' :
                        (work.assigned_team_id ? 'AVAILABLE' : (work.workflow_status || 'AVAILABLE')))),
                created_by: null,
                assigned_team_id: work.assigned_team_id,
                assignment_status: work.assignment_status,
                claimed_by: work.current_handler_id,
                created_at: work.created_at,
                updated_at: work.updated_at,
                assigned_to: [],
                clients: work.client_name ? { client_name: work.client_name } : null,
                work_types: work.work_type_name ? { name: work.work_type_name } : null
            };

            // Fetch workflow execution step instances to map to progress
            const execInstance = await ensureWorkflowExecutionForWork(work.id, work);
            if (execInstance) {
                const { data: stepInstances, error: stepErr } = await supabase
                    .from('workflow_step_instances')
                    .select('*')
                    .eq('execution_instance_id', execInstance.id);
                if (stepErr) throw stepErr;

                if (stepInstances) {
                    stepInstances.forEach(si => {
                        if (si.workflow_step_id) {
                            workProgress[si.workflow_step_id] = {
                                status: si.status,
                                remarks: si.remarks || '',
                                checkedDocs: si.document_values || {},
                                customFieldValues: si.custom_field_values || {},
                                completedAt: si.actual_completed_at,
                                stepInstanceId: si.id
                            };
                        }
                    });
                }
            }
        }

        const workflowRes = await TaskWorkflowResolverService.resolveWorkflowForTask(task);
        let steps = [];
        if (workflowRes.template) {
            steps = await TaskWorkflowResolverService.getWorkflowSteps(workflowRes.template.id);
        }

        const tasksWithUsers = await attachUserNames([task]);
        const taskWithUsers = tasksWithUsers[0];

        // For works, we need to temporarily attach the progress so calculateWorkflowProgress works
        if (isWork) {
            taskWithUsers.workflow_progress = workProgress;
        }

        const formatted = TaskWorkflowResolverService.formatTaskWithWorkflow(taskWithUsers, workflowRes, steps);

        // Build a clean template object with only the fields we need
        const templateData = workflowRes.template ? {
            id: workflowRes.template.id,
            workflow_name: workflowRes.template.workflow_name,
            description: workflowRes.template.description,
            status: workflowRes.template.status,
            scope: workflowRes.template.scope,
            common_information_fields: Array.isArray(workflowRes.template.common_information_fields)
                ? workflowRes.template.common_information_fields
                : []
        } : null;

        res.json({
            success: true,
            data: {
                task: formatted,
                workflow: {
                    source: workflowRes.source,
                    template: templateData,
                    steps
                },
                progress: isWork ? workProgress : (task.workflow_progress || {})
            }
        });
    } catch (error) {
        console.error('[Tasks API] get task error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/start
router.post('/:id/start', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { dbUserId } = currentUser;

        const { data: task } = await supabase.from('tasks').select('*').eq('id', req.params.id).single();
        
        const updates = {
            status: 'IN_PROGRESS',
            started_at: new Date().toISOString()
        };
        if (!task.claimed_by) {
            updates.claimed_by = dbUserId;
        }

        const { data, error } = await supabase.from('tasks')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/claim
router.post('/:id/claim', requirePermission('CLAIM_TASKS'), async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { dbUserId } = currentUser;

        const { data: task } = await supabase.from('tasks').select('*').eq('id', req.params.id).single();
        
        if (task.claimed_by) {
            return res.status(400).json({ error: 'Task already claimed' });
        }

        let assignedTo = Array.isArray(task.assigned_to) ? task.assigned_to : [];
        if (typeof task.assigned_to === 'string') {
            try { assignedTo = JSON.parse(task.assigned_to); } catch(e) {}
        }
        if (!assignedTo.includes(dbUserId)) {
            assignedTo.push(dbUserId);
        }

        const { data, error } = await supabase.from('tasks')
            .update({
                claimed_by: dbUserId,
                assigned_to: assignedTo,
                status: 'CLAIMED'
            })
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/assign
router.post('/:id/assign', requirePermission('ASSIGN_WORK'), async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { assignedTo, assignedTeamId } = req.body;
        const updates = {
            assigned_to: assignedTo || [],
            status: 'ASSIGNED'
        };
        if (assignedTeamId !== undefined) updates.assigned_team_id = assignedTeamId;

        const { data, error } = await supabase.from('tasks')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:workId/steps/:stepInstanceId/documents/:fieldKey
router.post('/:workId/steps/:stepInstanceId/documents/:fieldKey', (req, res, next) => {
    upload.single('file')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, error: 'Multer error: ' + err.message });
        } else if (err) {
            return res.status(500).json({ success: false, error: 'Unknown upload error.' });
        }
        next();
    });
}, async (req, res) => {
    try {
        const { workId, stepInstanceId, fieldKey } = req.params;
        const file = req.file;

        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });
        
        if (!currentUser.employeeId) {
            return res.status(403).json({ success: false, error: 'The logged-in user is not linked to an employee record.' });
        }

        const newDocMetadata = await WorkflowDocumentService.uploadStepDocument({
            workId,
            stepIdOrInstanceId: stepInstanceId,
            fieldKey,
            file,
            employeeContext: currentUser
        });

        return res.json({ success: true, data: newDocMetadata, stepInstance: { id: stepInstanceId } });
    } catch (error) {
        console.error('[Tasks API] Upload error:', error);
        res.status(error.status || 500).json({ success: false, error: error.message || error.error || 'Upload failed' });
    }
});

// PATCH /api/tasks/:id/progress
router.patch('/:id/progress', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const entityRes = await resolveEntity(req.params.id);
        if (!entityRes) {
            return res.status(404).json({ success: false, error: 'Task or Work not found' });
        }

        const { stepId, status, remarks, checkedDocs, customFieldValues, commonFieldValues } = req.body;

        if (entityRes.entityType === 'TASK') {
            const task = entityRes.data;
            const progress = task.workflow_progress || {};

            // Handle __common key for common information fields
            if (stepId === '__common' || (!stepId && commonFieldValues)) {
                progress['__common'] = {
                    ...(progress['__common'] || {}),
                    commonFieldValues: commonFieldValues || {},
                    updatedAt: new Date().toISOString()
                };
            } else if (stepId) {
                progress[stepId] = {
                    ...(progress[stepId] || {}),
                    status,
                    remarks,
                    checkedDocs: { ...((progress[stepId] || {}).checkedDocs || {}), ...(checkedDocs || {}) },
                    customFieldValues: { ...((progress[stepId] || {}).customFieldValues || {}), ...(customFieldValues || {}) },
                    updatedAt: new Date().toISOString()
                };
                if (status === 'COMPLETED') {
                    progress[stepId].completedAt = new Date().toISOString();
                }
            }

            const { data, error } = await supabase.from('tasks')
                .update({ workflow_progress: progress })
                .eq('id', req.params.id)
                .select()
                .single();
                
            if (error) throw error;
            return res.json({ success: true, data, progress });
        } else {
            // WORK logic
            const workId = entityRes.entityType === 'WORK' ? entityRes.data.id : req.params.id;
            
            if (stepId === '__common' || (!stepId && commonFieldValues)) {
                return res.json({ success: true, message: 'Common values save not fully supported on V2 works yet.' });
            }

            try {
                const { stepInstanceId } = await WorkflowRuntimeService.resolveStepInstanceId(workId, stepId);

                if (status === 'COMPLETED') {
                    const rpcResult = await WorkflowRuntimeService.completeStep({
                        workId,
                        stepInstanceId,
                        employeeContext: currentUser
                    });
                    return res.json({ success: true, data: rpcResult.step });
                } else {
                    const updatedStep = await WorkflowRuntimeService.saveStepDraft({
                        workId,
                        stepInstanceId,
                        remarks,
                        customFieldValues,
                        nonFileDocumentValues: checkedDocs,
                        employeeContext: currentUser
                    });
                    return res.json({ success: true, data: updatedStep });
                }
            } catch (err) {
                return res.status(err.status || 500).json({ success: false, error: err.message || err.error || 'Failed to process step' });
            }
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/submit-review
router.post('/:id/submit-review', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const entityRes = await resolveEntity(req.params.id);
        if (!entityRes) return res.status(404).json({ success: false, error: 'Task or Work not found' });

        if (entityRes.entityType === 'WORK') {
            return res.status(400).json({ success: false, error: 'Review submission on the parent is not valid for works. Complete approval gates instead.' });
        }

        const { data, error } = await supabase.from('tasks')
            .update({
                status: 'SUBMITTED_FOR_REVIEW',
                review_status: 'PENDING'
            })
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/review
router.post('/:id/review', requirePermission('MANAGE_WORK'), async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const entityRes = await resolveEntity(req.params.id);
        if (!entityRes) return res.status(404).json({ success: false, error: 'Task or Work not found' });

        if (entityRes.entityType === 'WORK') {
            return res.status(400).json({ success: false, error: 'Parent review is not valid for works. Use approval gates.' });
        }

        const { dbUserId } = currentUser;
        const { action, remarks } = req.body; // APPROVE, REJECT, REOPEN
        
        let updates = { reviewed_by: dbUserId, reviewed_at: new Date().toISOString() };

        if (action === 'APPROVE') {
            updates.status = 'COMPLETED';
            updates.review_status = 'APPROVED';
            updates.completed_at = new Date().toISOString();
        } else if (action === 'REJECT') {
            updates.status = 'REJECTED';
            updates.review_status = 'REJECTED';
            updates.review_remarks = remarks;
        } else if (action === 'REOPEN') {
            updates.status = 'IN_PROGRESS';
            updates.review_status = 'REOPENED';
            updates.review_remarks = remarks;
        }

        const { data, error } = await supabase.from('tasks')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
            
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/tasks/:id/complete
router.post('/:id/complete', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { hasPermission } = require('../lib/permissions');
        const canReview = await hasPermission(currentUser.authUid, 'MANAGE_WORK');

        const entityRes = await resolveEntity(req.params.id);
        if (!entityRes) return res.status(404).json({ success: false, error: 'Task or Work not found' });

        if (entityRes.entityType === 'WORK') {
            // Validation and completion for WORK
            const work = entityRes.data;
            try {
                await WorkflowRuntimeService.completeWork({
                    workId: work.id,
                    employeeContext: currentUser
                });
                return res.json({ success: true, data: work, entityType: 'WORK', sourceId: work.id, status: 'COMPLETED' });
            } catch (err) {
                return res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to complete Work' });
            }
        } else {
            // TASK completion
            let updates = {
                status: 'COMPLETED',
                completed_at: new Date().toISOString()
            };

            if (canReview) {
                updates.review_status = 'APPROVED';
                updates.reviewed_by = currentUser.dbUserId;
                updates.reviewed_at = updates.completed_at;
            }

            const { data, error } = await supabase.from('tasks')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();
                
            if (error) throw error;

            // Close any active work sessions (in_progress or paused) for this task for current user
            const now = new Date();
            const { data: activeWorks } = await supabase
                .from('user_active_work')
                .select('*')
                .eq('task_id', req.params.id)
                .eq('employee_id', currentUser.dbUserId)
                .in('status', ['in_progress', 'paused']);

            if (activeWorks && activeWorks.length > 0) {
                for (const aw of activeWorks) {
                    let additionalSeconds = 0;
                    if (aw.status === 'in_progress') {
                        const lastActivity = new Date(aw.last_activity_at);
                        additionalSeconds = Math.floor((now - lastActivity) / 1000);
                    }
                    const newElapsed = (aw.elapsed_seconds || 0) + Math.max(0, additionalSeconds);

                    await supabase.from('user_active_work')
                        .update({
                            status: 'completed',
                            completed_at: now.toISOString(),
                            elapsed_seconds: newElapsed,
                            last_activity_at: now.toISOString(),
                            progress: 100
                        })
                        .eq('id', aw.id);
                }
            }

            res.json({ success: true, data, entityType: 'TASK', sourceId: req.params.id, status: 'COMPLETED' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// Existing GET /api/tasks backward compatibility wrapper
router.get('/', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select(TASK_SELECT_QUERY)
            .order('due_date', { ascending: true });

        if (error) throw error;

        // Upgrade it to include workflow formatted data automatically
        const tasksWithUsers = await attachUserNames(tasks || []);
        const formattedTasks = await Promise.all(tasksWithUsers.map(formatTask));

        res.json({
            success: true,
            data: formattedTasks,
            pagination: {
                total: tasks?.length || 0,
                page: 1,
                limit: tasks?.length || 0,
                totalPages: 1
            }
        });
    } catch (error) {
        console.error('[Tasks API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Existing POST /api/tasks 
router.post('/', async (req, res) => {
    try {
        const currentUser = await getRequestUserProfile(req);
        if (currentUser.error) return res.status(401).json({ success: false, error: currentUser.error });

        const { dbUserId } = currentUser;
        const taskData = req.body;

        const workTypeId = taskData.workTypeId || taskData.work_type_id || null;
        let workflowTemplateId = null;

        // If work_type_id is provided, find active workflow template
        if (workTypeId) {
            const { data: template } = await supabase
                .from('workflow_templates')
                .select('id')
                .eq('work_type_id', workTypeId)
                .eq('is_active', true)
                .maybeSingle();
            
            if (template) {
                workflowTemplateId = template.id;
            }
        }

        const { data, error } = await supabase
            .from('tasks')
            .insert({
                client_id: taskData.clientId || null,
                client_name: taskData.clientName || 'Unknown',
                work_type_id: workTypeId,
                workflow_template_id: workflowTemplateId,
                title: taskData.title,
                description: taskData.description || null,
                priority: taskData.priority || 'Medium',
                due_date: taskData.dueDate || null,
                status: taskData.status || 'AVAILABLE', // Replaced Pending -> AVAILABLE per instruction
                created_by: taskData.createdBy || dbUserId, // Fallback to current dbUserId
                assigned_to: taskData.assignedTo || []
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ success: true, id: data.id, ...data });
    } catch (error) {
        console.error('[Tasks API] Create error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
