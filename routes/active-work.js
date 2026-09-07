const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { authenticateToken } = require('./auth');

/**
 * Helper to resolve the authenticated employee securely
 */
async function resolveCurrentEmployee(req) {
    const userId = req.user?.id;
    const email = req.user?.email;

    console.log(`[Active Work] Resolving employee. User ID: ${userId}, Email: ${email}`);

    if (!userId && !email) {
        console.warn('[Active Work] No user ID or email found in authenticated token.');
        return { error: 'No user ID or email found in authenticated token.', status: 401 };
    }

    // 1. Try to find by email first (existing logic)
    if (email) {
        const { data: empByEmail, error: errByEmail } = await supabase
            .from('employees')
            .select('id, email')
            .eq('email', email)
            .maybeSingle();
            
        if (errByEmail) {
            console.error('[Active Work] Supabase error resolving by email:', errByEmail);
        } else if (empByEmail) {
            console.log(`[Active Work] Resolved employee by email: ${empByEmail.id}`);
            return { employee: empByEmail };
        }
    }

    // 2. Fallback to user_profiles if email is missing or employee not found by email
    if (userId) {
        const { data: profile, error: profErr } = await supabase
            .from('user_profiles')
            .select('employee_id')
            .eq('uid', userId)
            .maybeSingle();
            
        if (profErr) {
            console.error('[Active Work] Supabase error resolving user_profile:', profErr);
        } else if (profile && profile.employee_id) {
            const { data: empById, error: errById } = await supabase
                .from('employees')
                .select('id, email')
                .eq('id', profile.employee_id)
                .maybeSingle();
                
            if (errById) {
                 console.error('[Active Work] Supabase error resolving by profile employee_id:', errById);
            } else if (empById) {
                console.log(`[Active Work] Resolved employee via user_profiles: ${empById.id}`);
                return { employee: empById };
            }
        }
        
        // 3. Just checking employees table for user_id (if employees table has user_id)
        const { data: empByUserId, error: errByUserId } = await supabase
            .from('employees')
            .select('id, email')
            .eq('user_id', userId)
            .maybeSingle();
            
        if (errByUserId) {
             console.error('[Active Work] Supabase error resolving by user_id:', errByUserId);
        } else if (empByUserId) {
            console.log(`[Active Work] Resolved employee via user_id column: ${empByUserId.id}`);
            return { employee: empByUserId };
        }
    }

    console.warn(`[Active Work] Employee record not found for logged-in user ${userId || email}`);
    return { error: 'Employee record not found for logged-in user', status: 404 };
}

// Temporary test route to verify deployment
router.get('/ping', (req, res) => res.json({ success: true, route: 'active-work' }));

/**
 * Helper to safely sync parent status for tasks, works, and step instances
 */
async function syncParentStatus(activeWork, action) {
    try {
        const targetStatus = (action === 'start' || action === 'switch') ? 'IN_PROGRESS' : null;
        if (!targetStatus) return;

        if (activeWork.task_id) {
            await supabase.from('tasks').update({ status: targetStatus }).eq('id', activeWork.task_id);
        }
        if (activeWork.workflow_step_instance_id) {
            await supabase.from('workflow_step_instances').update({ status: targetStatus }).eq('id', activeWork.workflow_step_instance_id);
        }
        if (activeWork.work_id) {
            await supabase.from('works').update({ workflow_status: targetStatus, status: targetStatus }).eq('id', activeWork.work_id);
        }
    } catch (err) {
        console.warn('[Active Work] syncParentStatus failed safely:', err.message);
    }
}

/**
 * Helper to safely complete parent tasks
 */
async function completeParentSafely(activeWork) {
    try {
        if (activeWork.task_id) {
            await supabase.from('tasks').update({ status: 'COMPLETED' }).eq('id', activeWork.task_id);
        }
    } catch (err) {
        console.warn('[Active Work] completeParentSafely failed safely:', err.message);
    }
}

/**
 * GET /api/active-work/current
 */
router.get('/current', authenticateToken, async (req, res) => {
    try {
        console.log(`[Active Work] GET /current requested`);
        const resolution = await resolveCurrentEmployee(req);
        if (resolution.error) {
            return res.status(resolution.status || 500).json({ success: false, message: resolution.error });
        }
        const employee = resolution.employee;
        
        const { data: activeWork, error } = await supabase
            .from('user_active_work')
            .select(`
                id,
                task_id,
                work_id,
                status,
                started_at,
                last_activity_at,
                elapsed_seconds,
                tasks!task_id ( title, due_date, priority, status ),
                works!work_id ( client_name, work_type_name, priority, workflow_status )
            `)
            .eq('employee_id', employee.id)
            .in('status', ['in_progress', 'paused'])
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[Active Work] Supabase schema/query error in /current:', error);
            return res.status(500).json({ success: false, message: 'Database error fetching active work', details: error.message });
        }

        if (activeWork) {
            // Guard against completed task
            if (activeWork.tasks?.status === 'COMPLETED' || activeWork.tasks?.status === 'Completed' || activeWork.tasks?.status === 'REJECTED') {
                console.log(`[ACTIVE WORK CLEAR] returning null because task completed (ID: ${activeWork.task_id})`);
                const now = new Date();
                let additionalSeconds = 0;
                if (activeWork.status === 'in_progress') {
                    const lastActivity = new Date(activeWork.last_activity_at);
                    additionalSeconds = Math.floor((now - lastActivity) / 1000);
                }
                const newElapsed = (activeWork.elapsed_seconds || 0) + Math.max(0, additionalSeconds);

                await supabase.from('user_active_work').update({
                    status: 'completed',
                    completed_at: now.toISOString(),
                    elapsed_seconds: newElapsed,
                    last_activity_at: now.toISOString(),
                    progress: 100
                }).eq('id', activeWork.id);

                return res.json({ success: true, data: null });
            }

            const formatted = {
                id: activeWork.id,
                task_id: activeWork.task_id || activeWork.work_id,
                title: activeWork.tasks?.title || (activeWork.works ? `${activeWork.works.client_name} - ${activeWork.works.work_type_name}` : 'Unknown Task'),
                status: activeWork.status,
                started_at: activeWork.started_at,
                last_activity_at: activeWork.last_activity_at,
                elapsed_seconds: activeWork.elapsed_seconds,
                due_date: activeWork.tasks?.due_date,
                priority: activeWork.tasks?.priority || activeWork.works?.priority,
                task_status: activeWork.tasks?.status || activeWork.works?.workflow_status || activeWork.works?.status
            };
            return res.json({ success: true, data: formatted });
        }

        res.json({ success: true, data: null });
    } catch (err) {
        console.error('[Active Work] Exception in /current:', err);
        res.status(500).json({ success: false, message: 'Internal server error handled safely.' });
    }
});

/**
 * POST /api/active-work/start
 */
router.post('/start', authenticateToken, async (req, res) => {
    try {
        console.log(`[Active Work] POST /start requested`);
        const resolution = await resolveCurrentEmployee(req);
        if (resolution.error) {
            return res.status(resolution.status || 500).json({ success: false, message: resolution.error });
        }
        const employee = resolution.employee;
        
        const { taskId } = req.body;

        if (!taskId) {
            return res.status(400).json({ success: false, message: 'taskId is required.' });
        }

        // Check if taskId is a task or a work
        const { data: isTask } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
        const { data: isWork } = await supabase.from('works').select('id').eq('id', taskId).maybeSingle();
        
        if (!isTask && !isWork) {
             return res.status(404).json({ success: false, message: 'Provided ID does not match any task or work.' });
        }

        const isWorkId = !!isWork;
        const isTaskId = !!isTask && !isWork;

        // Helper to format active work response
        const formatResponse = (aw) => ({
            id: aw.id,
            task_id: aw.task_id || aw.work_id,
            title: aw.tasks?.title || (aw.works ? `${aw.works.client_name} - ${aw.works.work_type_name}` : 'Unknown Task'),
            status: aw.status,
            started_at: aw.started_at,
            last_activity_at: aw.last_activity_at,
            elapsed_seconds: aw.elapsed_seconds,
            due_date: aw.tasks?.due_date,
            priority: aw.tasks?.priority || aw.works?.priority
        });

        // Idempotency Check for exact match
        let query = supabase.from('user_active_work')
            .select(`
                id,
                task_id,
                work_id,
                status,
                started_at,
                last_activity_at,
                elapsed_seconds,
                tasks!task_id ( title, due_date, priority, status ),
                works!work_id ( client_name, work_type_name, priority, workflow_status )
            `)
            .eq('employee_id', employee.id)
            .in('status', ['in_progress', 'paused'])
            .eq(isWorkId ? 'work_id' : 'task_id', taskId);
        
        const { data: specificExisting, error: queryErr } = await query.limit(1).maybeSingle();
        
        if (queryErr && queryErr.code !== 'PGRST116') {
             console.error('[Active Work] Supabase schema/query error checking existing active work:', queryErr);
             return res.status(200).json({ success: false, message: 'REAL ERROR', details: queryErr.message });
        }

        if (specificExisting) {
            if (specificExisting.status === 'in_progress') {
                return res.status(200).json({ success: true, data: formatResponse(specificExisting) });
            } else if (specificExisting.status === 'paused') {
                const now = new Date().toISOString();
                const { data: resumed, error: resumeErr } = await supabase.from('user_active_work')
                    .update({ status: 'in_progress', last_activity_at: now })
                    .eq('id', specificExisting.id)
                    .select(`
                        id,
                        task_id,
                        work_id,
                        status,
                        started_at,
                        last_activity_at,
                        elapsed_seconds,
                        tasks!task_id ( title, due_date, priority, status ),
                        works!work_id ( client_name, work_type_name, priority, workflow_status )
                    `).single();
                    
                if (resumeErr) {
                    console.error('[Active Work] Error resuming work:', resumeErr);
                    return res.status(200).json({ success: false, message: 'Database error resuming work', details: resumeErr.message });
                }
                await syncParentStatus(resumed, 'start');
                return res.status(200).json({ success: true, data: formatResponse(resumed) });
            }
        }

        // Check if ANY other work is in progress
        const { data: anyExisting, error: anyErr } = await supabase
            .from('user_active_work')
            .select('id, status')
            .eq('employee_id', employee.id)
            .eq('status', 'in_progress')
            .limit(1)
            .maybeSingle();

        if (anyErr && anyErr.code !== 'PGRST116') {
            console.error('[Active Work] Supabase error checking any existing:', anyErr);
            return res.status(200).json({ success: false, message: 'REAL ERROR', details: anyErr.message });
        }

        if (anyExisting) {
            return res.status(409).json({ 
                success: false,
                message: 'Another task is already in progress. Pause it before starting a new task.',
                activeTask: anyExisting
            });
        }

        const { data, error } = await supabase
            .from('user_active_work')
            .insert({
                employee_id: employee.id,
                task_id: isWorkId ? null : taskId,
                work_id: isWorkId ? taskId : null,
                status: 'in_progress',
                started_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                elapsed_seconds: 0
            })
            .select(`
                id,
                task_id,
                work_id,
                status,
                started_at,
                last_activity_at,
                elapsed_seconds,
                tasks!task_id ( title, due_date, priority, status ),
                works!work_id ( client_name, work_type_name, priority, workflow_status )
            `)
            .single();

        if (error) {
            console.error('[Active Work] Supabase error starting new work:', error);
            return res.status(500).json({ success: false, message: 'Database schema error: ' + error.message });
        }
        
        await syncParentStatus(data, 'start');
        
        res.status(201).json({ success: true, data: formatResponse(data) });
    } catch (err) {
        console.error('[Active Work] Exception in /start:', err);
        res.status(500).json({ success: false, message: 'Internal server error handled safely.' });
    }
});

/**
 * POST /api/active-work/resume
 */
router.post('/resume', authenticateToken, async (req, res) => {
    try {
        console.log(`[Active Work] POST /resume requested`);
        const resolution = await resolveCurrentEmployee(req);
        if (resolution.error) {
            return res.status(resolution.status || 500).json({ success: false, message: resolution.error });
        }
        const employee = resolution.employee;
        
        const { activeWorkId } = req.body;

        if (!activeWorkId) {
            return res.status(400).json({ success: false, message: 'activeWorkId is required.' });
        }

        const { data: specificExisting, error: queryErr } = await supabase
            .from('user_active_work')
            .select(`
                id,
                task_id,
                work_id,
                status,
                started_at,
                last_activity_at,
                elapsed_seconds,
                tasks!task_id ( title, due_date, priority, status ),
                works!work_id ( client_name, work_type_name, priority, workflow_status )
            `)
            .eq('id', activeWorkId)
            .eq('employee_id', employee.id)
            .single();
            
        if (queryErr) {
             console.error('[Active Work] Error finding active work to resume:', queryErr);
             return res.status(404).json({ success: false, message: 'Active work not found or database error' });
        }

        const formatResponse = (aw) => ({
            id: aw.id,
            task_id: aw.task_id || aw.work_id,
            title: aw.tasks?.title || (aw.works ? `${aw.works.client_name} - ${aw.works.work_type_name}` : 'Unknown Task'),
            status: aw.status,
            started_at: aw.started_at,
            last_activity_at: aw.last_activity_at,
            elapsed_seconds: aw.elapsed_seconds,
            due_date: aw.tasks?.due_date,
            priority: aw.tasks?.priority || aw.works?.priority
        });

        if (specificExisting.status === 'in_progress') {
            return res.status(200).json({ success: true, data: formatResponse(specificExisting) });
        } else if (specificExisting.status === 'paused') {
            const now = new Date().toISOString();
            const { data: resumed, error: resumeErr } = await supabase.from('user_active_work')
                .update({ status: 'in_progress', last_activity_at: now })
                .eq('id', specificExisting.id)
                .select(`
                    id,
                    task_id,
                    work_id,
                    status,
                    started_at,
                    last_activity_at,
                    elapsed_seconds,
                    tasks!task_id ( title, due_date, priority, status ),
                    works!work_id ( client_name, work_type_name, priority, workflow_status )
                `).single();
                
            if (resumeErr) {
                console.error('[Active Work] Error resuming work:', resumeErr);
                return res.status(200).json({ success: false, message: 'Database error resuming work', details: resumeErr.message });
            }
            await syncParentStatus(resumed, 'start');
            return res.status(200).json({ success: true, data: formatResponse(resumed) });
        }

        return res.status(400).json({ success: false, message: 'Active work is neither paused nor in progress' });

    } catch (err) {
        console.error('[Active Work] Exception in /resume:', err);
        res.status(500).json({ success: false, message: 'Internal server error handled safely.' });
    }
});

/**
 * POST /api/active-work/pause
 */
router.post('/pause', authenticateToken, async (req, res) => {
    try {
        console.log(`[Active Work] POST /pause requested`);
        const resolution = await resolveCurrentEmployee(req);
        if (resolution.error) {
            return res.status(resolution.status || 500).json({ success: false, message: resolution.error });
        }
        const employee = resolution.employee;
        
        const { activeWorkId } = req.body;

        const { data: current, error: fetchErr } = await supabase
            .from('user_active_work')
            .select('*')
            .eq('id', activeWorkId)
            .eq('employee_id', employee.id)
            .single();

        if (fetchErr && fetchErr.code !== 'PGRST116') {
             console.error('[Active Work] Supabase schema/query error fetching active work:', fetchErr);
             return res.status(200).json({ success: false, message: 'REAL ERROR', details: fetchErr.message });
        }

        if (!current) {
            return res.status(404).json({ success: false, message: 'Active work not found.' });
        }

        if (current.status !== 'in_progress') {
            return res.status(400).json({ success: false, message: 'Work is not currently in progress.' });
        }

        const now = new Date();
        const lastActivity = new Date(current.last_activity_at);
        const additionalSeconds = Math.floor((now - lastActivity) / 1000);
        const newElapsed = current.elapsed_seconds + Math.max(0, additionalSeconds);

        const { data, error } = await supabase
            .from('user_active_work')
            .update({
                status: 'paused',
                paused_at: now.toISOString(),
                elapsed_seconds: newElapsed,
                last_activity_at: now.toISOString()
            })
            .eq('id', activeWorkId)
            .select()
            .single();

        if (error) {
            console.error('[Active Work] Supabase error pausing work:', error);
            return res.status(200).json({ success: false, message: 'REAL ERROR', details: error.message });
        }
        
        await syncParentStatus(data, 'pause');

        res.json({ success: true, data });
    } catch (err) {
        console.error('[Active Work] Exception in /pause:', err);
        res.status(500).json({ success: false, message: 'Internal server error handled safely.' });
    }
});

/**
 * POST /api/active-work/complete
 */
router.post('/complete', authenticateToken, async (req, res) => {
    try {
        console.log(`[Active Work] POST /complete requested`);
        const resolution = await resolveCurrentEmployee(req);
        if (resolution.error) {
            return res.status(resolution.status || 500).json({ success: false, message: resolution.error });
        }
        const employee = resolution.employee;
        
        const { activeWorkId } = req.body;

        const { data: current, error: fetchErr } = await supabase
            .from('user_active_work')
            .select('*')
            .eq('id', activeWorkId)
            .eq('employee_id', employee.id)
            .single();

        if (fetchErr && fetchErr.code !== 'PGRST116') {
             console.error('[Active Work] Supabase schema/query error fetching active work:', fetchErr);
             return res.status(200).json({ success: false, message: 'REAL ERROR', details: fetchErr.message });
        }

        if (!current) {
            return res.status(404).json({ success: false, message: 'Active work not found.' });
        }

        const now = new Date();
        let additionalSeconds = 0;
        if (current.status === 'in_progress') {
            const lastActivity = new Date(current.last_activity_at);
            additionalSeconds = Math.floor((now - lastActivity) / 1000);
        }
        
        const newElapsed = current.elapsed_seconds + Math.max(0, additionalSeconds);

        const { data, error } = await supabase
            .from('user_active_work')
            .update({
                status: 'completed',
                completed_at: now.toISOString(),
                elapsed_seconds: newElapsed,
                last_activity_at: now.toISOString(),
                progress: 100
            })
            .eq('id', activeWorkId)
            .select()
            .single();

        if (error) {
            console.error('[Active Work] Supabase error completing work:', error);
            return res.status(200).json({ success: false, message: 'REAL ERROR', details: error.message });
        }
        
        await completeParentSafely(data);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[Active Work] Exception in /complete:', err);
        res.status(500).json({ success: false, message: 'Internal server error handled safely.' });
    }
});

module.exports = router;
