const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

// Get today's attendance for a user
router.get('/', async (req, res) => {
    try {
        const { userId } = req.query;
        console.error("[ATTENDANCE GET] userId:", userId);
        console.error("[ATTENDANCE GET] env:", {
          hasSupabaseUrl: !!process.env.SUPABASE_URL,
          hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        });

        if (!userId) return res.status(400).json({ error: 'userId is required' });

        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        console.log(`[Attendance GET] Fetching for ${userId} from ${start} to ${end}`);

        // Try to resolve employee if table uses employee_id instead of auth user_id
        let employeeId = null;
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();
            
        if (employee) {
            employeeId = employee.id;
        }

        // Try querying using the user_id first
        let { data, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .gte('timestamp', start)
            .lte('timestamp', end)
            .order('timestamp', { ascending: true });

        // If error or empty, and we have an employee id, try using employee.id
        if ((error || !data || data.length === 0) && employeeId) {
             const empQuery = await supabase
                .from('attendance')
                .select('*')
                .eq('user_id', employeeId)
                .gte('timestamp', start)
                .lte('timestamp', end)
                .order('timestamp', { ascending: true });
             if (!empQuery.error) {
                 data = empQuery.data;
                 error = null;
             }
        }

        if (error) {
            console.error('[Attendance GET Supabase Error]:', error);
            // Instead of throwing and returning 500, we treat ANY error as an empty state
            // to ensure the frontend doesn't crash.
            return res.json([]);
        }
        res.json(data || []);
    } catch (error) {
        console.error("[ATTENDANCE GET ERROR]", error);
        // Fallback safe response for any unexpected exception
        return res.json([]);
    }
});

// Punch In/Out
router.post('/punch', async (req, res) => {
    try {
        const { type } = req.body;
        // MUST use authenticated user ID instead of spoofable body param
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. User ID missing from session.' });
        }
        
        const now = new Date();

        console.log(`[Attendance Punch] Action: ${type}, User: ${userId}`);

        const insertData = {
            user_id: userId,
            type: type,
            timestamp: now.toISOString()
        };

        const { data, error } = await supabase
            .from('attendance')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('[Attendance Punch Supabase Error]:', error);
            throw error;
        }
        res.json(data);
    } catch (error) {
        console.error('[Attendance Punch Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get monthly attendance records
router.get('/month', async (req, res) => {
    try {
        const { startDate, endDate, employeeId } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required' });
        }

        const isManager = await isUserManager(req, supabase);
        
        let query = supabase
            .from('attendance')
            .select('*')
            .gte('timestamp', startDate)
            .lte('timestamp', endDate)
            .order('timestamp', { ascending: true });

        // Apply RBAC: Normal users only see their own. Managers can filter by employeeId.
        if (!isManager) {
            query = query.eq('user_id', req.user?.id);
        } else if (employeeId && employeeId !== 'all') {
            query = query.eq('user_id', employeeId);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[Attendance Month Supabase Error]:', error);
            throw error;
        }

        // Fetch user profiles to resolve employee UUIDs
        let mappedData = data || [];
        if (mappedData.length > 0) {
            const userIds = [...new Set(mappedData.map(r => r.user_id))];
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('uid, employee_id, email')
                .in('uid', userIds);

            const uidToEmpId = {};
            const uidToEmail = {};
            if (profiles) {
                profiles.forEach(p => { 
                    uidToEmpId[p.uid] = p.employee_id; 
                    uidToEmail[p.uid] = p.email;
                });
            }

            mappedData = mappedData.map(r => ({
                ...r,
                employee_id: uidToEmpId[r.user_id] || null,
                user_email: uidToEmail[r.user_id] || null
            }));
        }

        res.json(mappedData);
    } catch (error) {
        console.error('[Attendance Month Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Update attendance record (Managers only)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { user_id, type, timestamp } = req.body;

        const isManager = await isUserManager(req, supabase);
        // Wait, normal employees shouldn't be able to edit arbitrary records.
        // Even if it's their own, manual edit is usually for HR/Managers.
        if (!isManager) {
            return res.status(403).json({ error: 'Forbidden: Only managers can edit attendance records.' });
        }

        let actualAuthUid = user_id;
        if (user_id) {
            const { data: profile } = await supabase
                .from('user_profiles')
                .select('uid')
                .eq('employee_id', user_id)
                .maybeSingle();
            if (profile) {
                actualAuthUid = profile.uid;
            }
        }

        const updateData = { type, timestamp };
        if (actualAuthUid) updateData.user_id = actualAuthUid;

        const { data, error } = await supabase
            .from('attendance')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete attendance record (Managers only)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const isManager = await isUserManager(req, supabase);
        if (!isManager) {
            return res.status(403).json({ error: 'Forbidden: Only managers can delete attendance records.' });
        }

        const { error } = await supabase
            .from('attendance')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get monthly holidays
router.get('/holidays/month', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate are required' });
        }

        // Fetch all holidays within the date range
        // Note: holidays might just have a 'date' column
        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add an insert route for manual addition by Managers
router.post('/', async (req, res) => {
    try {
        const { user_id, type, timestamp } = req.body;

        const isManager = await isUserManager(req, supabase);
        if (!isManager) {
            return res.status(403).json({ error: 'Forbidden: Only managers can manually add attendance records.' });
        }

        if (!user_id || !type || !timestamp) {
            return res.status(400).json({ error: 'user_id, type, and timestamp are required' });
        }

        let actualAuthUid = user_id;
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('uid')
            .eq('employee_id', user_id)
            .maybeSingle();
        if (profile) {
            actualAuthUid = profile.uid;
        }

        const { data, error } = await supabase
            .from('attendance')
            .insert({ user_id: actualAuthUid, type, timestamp })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Heartbeat API ---
router.post('/heartbeat', async (req, res) => {
    try {
        const { state } = req.body; // 'ACTIVE' | 'IDLE'
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];

        // Fetch latest log for today
        const { data: latestLogs, error } = await supabase
            .from('attendance_activity_logs')
            .select('*')
            .eq('employee_id', userId)
            .eq('attendance_date', dateStr)
            .order('started_at', { ascending: false })
            .limit(1);

        if (error) {
            if (error.code === 'PGRST205') {
                 // Table not created yet, fail gracefully
                 return res.status(200).json({ warning: 'attendance_activity_logs table not found' });
            }
            throw error;
        }
        
        const latestLog = latestLogs && latestLogs.length > 0 ? latestLogs[0] : null;

        const createLog = async (activityType, start, end) => {
            const duration = Math.round((end.getTime() - start.getTime()) / 60000);
            return await supabase.from('attendance_activity_logs').insert({
                employee_id: userId,
                attendance_date: dateStr,
                activity_type: activityType,
                started_at: start.toISOString(),
                ended_at: end.toISOString(),
                duration_minutes: duration > 0 ? duration : 0
            }).select().single();
        };

        const updateLog = async (logId, startStr, end) => {
            const duration = Math.round((end.getTime() - new Date(startStr).getTime()) / 60000);
            return await supabase.from('attendance_activity_logs')
                .update({ ended_at: end.toISOString(), duration_minutes: duration > 0 ? duration : 0 })
                .eq('id', logId)
                .select().single();
        };

        if (!latestLog) {
            const { data: newLog } = await createLog(state, now, now);
            return res.json(newLog);
        }

        const lastEnded = new Date(latestLog.ended_at || latestLog.started_at);
        const gapMinutes = (now.getTime() - lastEnded.getTime()) / 60000;

        if (state === 'ACTIVE') {
            if (gapMinutes > 15) {
                // We missed an OFFLINE gap
                await createLog('OFFLINE', lastEnded, now);
                const { data: newLog } = await createLog('ACTIVE', now, now);
                return res.json(newLog);
            } else if (latestLog.activity_type === 'ACTIVE') {
                // Extend ACTIVE
                const { data: updatedLog } = await updateLog(latestLog.id, latestLog.started_at, now);
                return res.json(updatedLog);
            } else {
                // Switching from IDLE/OFFLINE to ACTIVE
                const { data: newLog } = await createLog('ACTIVE', lastEnded, now);
                return res.json(newLog);
            }
        } else if (state === 'IDLE') {
            if (latestLog.activity_type === 'IDLE') {
                // Extend IDLE
                const { data: updatedLog } = await updateLog(latestLog.id, latestLog.started_at, now);
                return res.json(updatedLog);
            } else {
                // The gap is the IDLE period
                const { data: newLog } = await createLog('IDLE', lastEnded, now);
                return res.json(newLog);
            }
        }

        res.json(latestLog);
    } catch (error) {
        console.error('[Attendance Heartbeat Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- Activity Logs ---
router.get('/activity-logs', async (req, res) => {
    try {
        const { date, startDate, endDate, employeeId } = req.query;
        let query = supabase.from('attendance_activity_logs').select('*');
        
        if (date) query = query.eq('attendance_date', date);
        if (startDate && endDate) {
             query = query.gte('attendance_date', startDate.split('T')[0]).lte('attendance_date', endDate.split('T')[0]);
        }
        
        if (employeeId && employeeId !== 'all') {
             query = query.eq('employee_id', employeeId);
        } else if (!employeeId && req.user?.id) {
             query = query.eq('employee_id', req.user.id);
        }

        const { data, error } = await query;
        if (error) {
             if (error.code === 'PGRST205') return res.json([]);
             throw error;
        }
        res.json(data || []);
    } catch (error) {
        console.error('[Activity Logs Catch]:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- Leaves ---

router.get('/leaves', async (req, res) => {
    try {
        const { userId } = req.query;
        let query = supabase.from('leaves').select('*');
        if (userId) query = query.eq('user_id', userId);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function isUserManager(req, supabase) {
    if (!req.user?.id) return false;
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_owner_super_admin, role_ids')
        .eq('uid', req.user.id)
        .maybeSingle();

    if (profile) {
        if (profile.is_owner_super_admin) return true;
        if (profile.role_ids && profile.role_ids.length > 0) {
            const { data: roles } = await supabase
                .from('system_roles')
                .select('permissions, priority')
                .in('id', profile.role_ids);
            if (roles) {
                return roles.some(r => r.priority === 1 || (r.permissions && r.permissions.includes('MANAGE_LEAVES')));
            }
        }
    }
    return false;
}

router.post('/leaves', async (req, res) => {
    try {
        const {
            employeeId,
            leaveType,
            durationType,
            reason,
            leaveDate,
            startDate,
            endDate,
            halfDayType,
            status
        } = req.body;

        if (!employeeId) {
            return res.status(400).json({ error: 'employeeId is missing' });
        }
        if (!leaveType || !durationType || !reason) {
            return res.status(400).json({ error: 'leaveType, durationType, and reason are required' });
        }

        const isManager = await isUserManager(req, supabase);

        let resolvedUserId = req.user?.id;
        if (!isManager && employeeId !== req.user?.id) {
            resolvedUserId = req.user?.id;
        } else {
            resolvedUserId = employeeId;
        }

        if (!resolvedUserId) {
            return res.status(400).json({ error: "user_id is missing. Authentication failed or invalid employee." });
        }

        const payload = {
            employee_id: employeeId,
            user_id: resolvedUserId,
            leave_type: leaveType,
            duration_type: durationType,
            reason: reason,
            status: status || 'Pending',
            created_by: req.user?.id,
            applied_date: new Date().toISOString()
        };

        if (durationType === 'single') {
            payload.leave_date = leaveDate;
        } else if (durationType === 'half') {
            payload.leave_date = leaveDate;
            payload.half_day_type = halfDayType;
        } else if (durationType === 'multiple') {
            payload.start_date = startDate;
            payload.end_date = endDate;
        }

        const payloadKeys = Object.keys(payload);
        console.log(`[Leave POST] Selected employeeId: ${employeeId}, Resolved user_id: ${!!resolvedUserId}, Payload Keys:`, payloadKeys);

        const { data, error } = await supabase
            .from('leaves')
            .insert(payload)
            .select()
            .single();

        if (error) {
            console.error('[Leave POST Supabase Error]:', error);
            return res.status(400).json({ error: error.message });
        }
        res.status(201).json(data);
    } catch (error) {
        console.error('[Leave POST Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/leaves/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            employeeId,
            leaveType,
            durationType,
            reason,
            leaveDate,
            startDate,
            endDate,
            halfDayType,
            status
        } = req.body;

        const isManager = await isUserManager(req, supabase);

        // Fetch existing leave to check permissions
        const { data: existingLeave } = await supabase
            .from('leaves')
            .select('user_id')
            .eq('id', id)
            .single();

        if (!existingLeave) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        if (!isManager && existingLeave.user_id !== req.user?.id) {
            return res.status(403).json({ error: 'You do not have permission to edit this leave request.' });
        }

        const payload = {
            leave_type: leaveType,
            duration_type: durationType,
            reason: reason,
            status: status || 'Pending'
        };

        if (durationType === 'single') {
            payload.leave_date = leaveDate;
            payload.start_date = null;
            payload.end_date = null;
            payload.half_day_type = null;
        } else if (durationType === 'half') {
            payload.leave_date = leaveDate;
            payload.half_day_type = halfDayType;
            payload.start_date = null;
            payload.end_date = null;
        } else if (durationType === 'multiple') {
            payload.start_date = startDate;
            payload.end_date = endDate;
            payload.leave_date = null;
            payload.half_day_type = null;
        }

        const { data, error } = await supabase
            .from('leaves')
            .update(payload)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Leave PUT Supabase Error]:', error);
            return res.status(400).json({ error: error.message });
        }
        res.json(data);
    } catch (error) {
        console.error('[Leave PUT Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

router.patch('/leaves/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'status is required' });
        }

        const isManager = await isUserManager(req, supabase);
        if (!isManager) {
            return res.status(403).json({ error: 'You do not have permission to approve or reject leave requests.' });
        }

        const { data, error } = await supabase
            .from('leaves')
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('[Leave PATCH Supabase Error]:', error);
            return res.status(400).json({ error: error.message });
        }
        res.json(data);
    } catch (error) {
        console.error('[Leave PATCH Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/leaves/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const isManager = await isUserManager(req, supabase);

        // Fetch existing leave to check permissions
        const { data: existingLeave } = await supabase
            .from('leaves')
            .select('user_id')
            .eq('id', id)
            .single();

        if (!existingLeave) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        if (!isManager && existingLeave.user_id !== req.user?.id) {
            return res.status(403).json({ error: 'You do not have permission to delete this leave request.' });
        }

        const { error } = await supabase
            .from('leaves')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('[Leave DELETE Supabase Error]:', error);
            return res.status(400).json({ error: error.message });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('[Leave DELETE Error]:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
