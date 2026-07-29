const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

const safeQuery = async (queryPromise, name) => {
    try {
        const res = await queryPromise;
        if (res.error) {
            console.warn(`[Dashboard] ${name} query warning:`, res.error.message || res.error);
            return { data: [], count: 0, error: res.error };
        }
        return res;
    } catch (err) {
        console.error(`[Dashboard] ${name} query exception:`, err);
        return { data: [], count: 0, error: err };
    }
};

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
                // Priority 1 or has VIEW_ALL_ATTENDANCE
                return roles.some(r => r.priority === 1 || (r.permissions && r.permissions.includes('VIEW_ALL_ATTENDANCE')));
            }
        }
    }
    return false;
}

// Helper to get stats from Supabase
router.get('/stats', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const isManager = await isUserManager(req, supabase);
        
        const now = new Date();
        const startStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endStr = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        if (isManager) {
            // Manager sees company-wide stats
            const [empResult, attResult, taskResult] = await Promise.all([
                supabase.from('employees').select('*', { count: 'exact', head: true }),
                // Need unique punch-ins today
                // Wait, `.select('user_id')` to get data and calculate unique
                supabase.from('attendance').select('user_id').eq('type', 'punchIn').gte('timestamp', startStr).lte('timestamp', endStr),
                supabase.from('team_tasks').select('*', { count: 'exact', head: true }).eq('status', 'Pending')
            ]);

            if (empResult.error) throw empResult.error;
            if (attResult.error) throw attResult.error;
            if (taskResult.error) throw taskResult.error;

            const totalEmployees = empResult.count || 0;
            const uniqueUsers = new Set(attResult.data.map(a => a.user_id));
            const presentCount = uniqueUsers.size;
            const pendingTasksCount = taskResult.count || 0;

            const absentCount = Math.max(0, totalEmployees - presentCount);
            const attendancePercentage = totalEmployees > 0 ? Math.round((presentCount / totalEmployees) * 100) : 0;

            res.json({
                totalEmployees,
                attendanceToday: {
                    present: presentCount,
                    absent: absentCount,
                    late: 0,
                    percentage: attendancePercentage,
                },
                pendingTasks: pendingTasksCount,
                complianceScore: -1, // -1 signals "Coming Soon"
            });
        } else {
            // Normal employee sees only their own relevant stats
            // Get their own attendance
            const attResult = await supabase
                .from('attendance')
                .select('id')
                .eq('type', 'punchIn')
                .eq('user_id', userId)
                .gte('timestamp', startStr)
                .lte('timestamp', endStr)
                .limit(1);
            
            const taskResult = await supabase
                .from('team_tasks')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Pending')
                .eq('assigned_to', userId);

            const isPresent = attResult.data && attResult.data.length > 0;

            res.json({
                totalEmployees: 0, // Hides this for normal employees or frontend handles it
                attendanceToday: {
                    present: isPresent ? 1 : 0,
                    absent: isPresent ? 0 : 1,
                    late: 0,
                    percentage: isPresent ? 100 : 0,
                },
                pendingTasks: taskResult.count || 0,
                complianceScore: -1, 
            });
        }
    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// Helper to get recent activity from Supabase
router.get('/activity', async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('id,action,entity_id,details,performed_at')
            .order('performed_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        const activities = logs.map(log => ({
            id: log.id,
            action: log.action || 'Action',
            target: log.details?.target_name || log.entity_id || 'Unknown',
            by: log.details?.performed_by_name || 'System',
            time: log.performed_at
        }));

        res.json(activities);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard activity' });
    }
});

router.get('/charts', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const isManager = await isUserManager(req, supabase);

        // --- Weekly Activity (Works completed this week) ---
        const now = new Date();
        const dayOfWeek = now.getDay() || 7; // 1-7, where 1 is Monday, 7 is Sunday
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek + 1);
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        let worksQuery = supabase
            .from('works')
            .select('completed_at')
            .gte('completed_at', startOfWeek.toISOString())
            .lte('completed_at', endOfWeek.toISOString())
            .eq('status', 'Completed');
            
        // If they are not a manager, try to limit to their associate_id (assuming it's their employee_id or uid)
        // If associate_id doesn't map to uid, this might return 0, but it won't crash.
        if (!isManager) {
            // Fetch their employee record to get id
            const { data: profile } = await supabase.from('user_profiles').select('employee_id').eq('uid', userId).maybeSingle();
            if (profile && profile.employee_id) {
                worksQuery = worksQuery.eq('associate_id', profile.employee_id);
            } else {
                worksQuery = worksQuery.eq('associate_id', userId);
            }
        }

        const { data: worksData, error: worksError } = await worksQuery;
        if (worksError) {
            console.error("[Dashboard] worksQuery error:", worksError);
            throw worksError;
        }

        // Initialize week days
        const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const weeklyActivityMap = weekDays.reduce((acc, day) => {
            acc[day] = 0;
            return acc;
        }, {});

        worksData?.forEach(work => {
            if (work.completed_at) {
                const date = new Date(work.completed_at);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                if (weeklyActivityMap[dayName] !== undefined) {
                    weeklyActivityMap[dayName]++;
                }
            }
        });

        const weeklyOutput = weekDays.map(day => ({
            day: day,
            value: weeklyActivityMap[day]
        }));

        // --- Attendance Breakdown (Today) ---
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

        let totalEmployees = 0;
        if (isManager) {
            const { count, error: empError } = await supabase
                .from('employees')
                .select('*', { count: 'exact', head: true })
                .eq('is_active', true);
            if (empError) {
                console.error("[Dashboard] empQuery error:", empError);
                throw empError;
            }
            totalEmployees = count || 0;
        } else {
            totalEmployees = 1;
        }

        let attQuery = supabase
            .from('attendance')
            .select('user_id, type, timestamp')
            .gte('timestamp', startOfDay)
            .lte('timestamp', endOfDay)
            .order('timestamp', { ascending: true });

        if (!isManager) {
            attQuery = attQuery.eq('user_id', userId);
        }

        const { data: attData, error: attError } = await attQuery;
        if (attError) {
            console.error("[Dashboard] attQuery error:", attError);
            throw attError;
        }

        let present = 0;
        let incomplete = 0;

        // Group by user_id
        const userAttendance = {};
        attData?.forEach(record => {
            if (!userAttendance[record.user_id]) {
                userAttendance[record.user_id] = [];
            }
            userAttendance[record.user_id].push(record);
        });

        Object.keys(userAttendance).forEach(uid => {
            const records = userAttendance[uid];
            records.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const lastRecord = records[records.length - 1];
            if (lastRecord.type === 'punchIn') {
                incomplete++;
            } else {
                present++;
            }
        });

        const absent = Math.max(0, totalEmployees - (present + incomplete));

        const attendanceBreakdown = [];
        if (present > 0) attendanceBreakdown.push({ name: "Present", value: present });
        if (absent > 0) attendanceBreakdown.push({ name: "Absent", value: absent });
        attendanceBreakdown.push({ name: "Half Day", value: 0 }); // Hardcoded to 0 since no threshold available
        if (incomplete > 0) attendanceBreakdown.push({ name: "Incomplete", value: incomplete });

        // Ensure keys match what frontend expects
        res.json({
            weeklyOutput,
            attendanceBreakdown
        });
    } catch (error) {
        console.error("Charts Error:", error);
        res.status(500).json({ error: 'Failed to fetch dashboard charts', details: error.message || error });
    }
});

async function getDashboardProfile(req, supabase) {
    if (!req.user?.id) return 'intern';
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('is_owner_super_admin, role_ids')
        .eq('uid', req.user.id)
        .maybeSingle();

    if (profile) {
        if (profile.is_owner_super_admin) return 'super_admin';
        
        let parsedRoleIds = [];
        if (Array.isArray(profile.role_ids)) {
            parsedRoleIds = profile.role_ids;
        } else if (typeof profile.role_ids === 'string') {
            try { parsedRoleIds = JSON.parse(profile.role_ids); } catch(e){}
        }

        if (parsedRoleIds.length > 0) {
            const { data: roles } = await supabase
                .from('system_roles')
                .select('name, priority')
                .in('id', parsedRoleIds);
            
            if (roles && roles.length > 0) {
                roles.sort((a, b) => (a.priority || 10) - (b.priority || 10));
                for (const role of roles) {
                    const name = (role.name || '').toLowerCase();
                    if (name.includes('super admin')) return 'super_admin';
                    if (name.includes('admin')) return 'admin';
                    if (name.includes('hr')) return 'hr';
                    if (name.includes('staff')) return 'staff';
                    if (name.includes('intern')) return 'intern';
                }
            }
        }
    }
    return 'staff';
}

router.get('/summary', async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const profile = await getDashboardProfile(req, supabase);
        
        const responseData = {
            profile,
            kpis: {},
            charts: {},
            tables: {}
        };

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        if (profile === 'super_admin' || profile === 'admin') {
            // KPIs & Tables
            const [
                clientsRes, proposalsRes, worksRes, auditRes, dscRes, empRes, attRes
            ] = await Promise.all([
                safeQuery(supabase.from('clients').select('id', { count: 'exact', head: true }), 'clients'),
                safeQuery(supabase.from('proposals').select('status, total_amount, created_at'), 'proposals'),
                safeQuery(supabase.from('works').select('status, created_at'), 'works'),
                safeQuery(supabase.from('audit_logs').select('id, action, entity_id, details, performed_at').order('performed_at', { ascending: false }).limit(10), 'audit_logs'),
                safeQuery(supabase.from('dsc_tokens').select('id, valid_till'), 'dsc_tokens'),
                safeQuery(supabase.from('employees').select('id, is_active'), 'employees'),
                safeQuery(supabase.from('attendance').select('user_id, type').gte('timestamp', startOfDay).lte('timestamp', endOfDay), 'attendance')
            ]);
            
            const totalClients = clientsRes.count || 0;
            const proposals = proposalsRes.error ? [] : (proposalsRes.data || []);
            const works = worksRes.error ? [] : (worksRes.data || []);
            const auditLogs = auditRes.error ? [] : (auditRes.data || []);
            const dscTokens = dscRes.error ? [] : (dscRes.data || []);

            const pendingProposals = proposals.filter(p => p.status === 'Pending' || p.status === 'Draft' || p.status?.toLowerCase().includes('pending')).length;
            const acceptedProposals = proposals.filter(p => p.status === 'Accepted' || p.status === 'Approved').length;
            
            const activeWorks = works.filter(w => w.status !== 'Completed').length;
            const completedWorks = works.filter(w => w.status === 'Completed').length;

            const expiringDsc = dscTokens.filter(d => d.valid_till && new Date(d.valid_till) <= new Date(now.getTime() + 30*24*60*60*1000)).length;

            responseData.kpis = {
                totalClients,
                totalProposals: proposals.length,
                pendingProposals,
                acceptedProposals,
                activeWorks,
                completedWorks,
                dscExpiring: expiringDsc
            };

            // Charts
            const propStatusCount = proposals.reduce((acc, p) => { acc[p.status || 'Draft'] = (acc[p.status || 'Draft'] || 0) + 1; return acc; }, {});
            const workStatusCount = works.reduce((acc, w) => { acc[w.status || 'Pending'] = (acc[w.status || 'Pending'] || 0) + 1; return acc; }, {});
            
            const revMap = {};
            proposals.forEach(p => {
                if ((p.status === 'Accepted' || p.status === 'Approved') && p.created_at) {
                    const d = new Date(p.created_at);
                    if (!isNaN(d.getTime())) {
                        const mName = d.toLocaleString('en-US', { month: 'short' });
                        revMap[mName] = (revMap[mName] || 0) + (Number(p.total_amount) || 0);
                    }
                }
            });

            // DSC Expiry
            let expired = 0, under30 = 0, under90 = 0, safe = 0;
            dscTokens.forEach(d => {
                if (!d.valid_till) return;
                const days = (new Date(d.valid_till) - now) / (1000 * 60 * 60 * 24);
                if (days < 0) expired++;
                else if (days <= 30) under30++;
                else if (days <= 90) under90++;
                else safe++;
            });

            // Attendance Summary
            const employees = empRes.error ? [] : (empRes.data || []);
            const attendanceToday = attRes.error ? [] : (attRes.data || []);
            
            const activeEmployees = employees.filter(e => e.is_active).length;
            const userAttendance = {};
            attendanceToday.forEach(record => {
                if (!userAttendance[record.user_id]) userAttendance[record.user_id] = [];
                userAttendance[record.user_id].push(record);
            });
            let present = 0; let incomplete = 0;
            Object.keys(userAttendance).forEach(uid => {
                const records = userAttendance[uid];
                const lastType = records[records.length - 1].type;
                if (lastType === 'punchIn') incomplete++;
                else present++;
            });
            const absent = Math.max(0, activeEmployees - (present + incomplete));
            const attendanceChart = [];
            if (present > 0) attendanceChart.push({ name: 'Present', value: present });
            if (absent > 0) attendanceChart.push({ name: 'Absent', value: absent });
            if (incomplete > 0) attendanceChart.push({ name: 'Incomplete', value: incomplete });

            responseData.charts = {
                proposal_status_chart: Object.entries(propStatusCount).map(([name, value]) => ({ name, value })),
                work_status_chart: Object.entries(workStatusCount).map(([name, value]) => ({ name, value, color: name === 'Completed' ? '#22c55e' : '#3b82f6' })),
                revenue_trend_chart: Object.entries(revMap).map(([name, value]) => ({ name, value })),
                attendance_summary_chart: attendanceChart, 
                dsc_expiry_chart: [
                    { name: 'Expired', value: expired },
                    { name: '< 30 Days', value: under30 },
                    { name: '< 90 Days', value: under90 },
                    { name: 'Valid', value: safe }
                ]
            };
            
            responseData.tables = {
                pending_approvals: proposals.filter(p => p.status === 'Pending Approval' || p.status?.toLowerCase().includes('pending')).slice(0, 5),
                recent_activities: auditLogs.map(log => ({
                    id: log.id,
                    action: log.action || 'Action',
                    target: log.details?.target_name || log.entity_id || 'Unknown',
                    by: log.details?.performed_by_name || 'System',
                    time: log.performed_at
                }))
            };

        } else if (profile === 'hr') {
            const [empRes, attRes, jobRes, candidatesRes] = await Promise.all([
                safeQuery(supabase.from('employees').select('id, is_active'), 'employees'),
                safeQuery(supabase.from('attendance').select('user_id, type').gte('timestamp', startOfDay).lte('timestamp', endOfDay), 'attendance'),
                safeQuery(supabase.from('job_openings').select('id, status'), 'job_openings'),
                safeQuery(supabase.from('candidates').select('id, status'), 'candidates')
            ]);
            
            const employees = empRes.error ? [] : (empRes.data || []);
            const activeEmployees = employees.filter(e => e.is_active).length;
            const presentToday = new Set((attRes.data || []).map(a => a.user_id)).size;

            const candidates = candidatesRes.error ? [] : (candidatesRes.data || []);
            const pendingCandidates = candidates.filter(c => c.status === 'Applied' || c.status === 'Screening').length;

            responseData.kpis = {
                totalEmployees: activeEmployees,
                presentToday,
                recruitmentPending: pendingCandidates
            };

            const candStatus = candidates.reduce((acc, c) => { acc[c.status || 'Applied'] = (acc[c.status || 'Applied'] || 0) + 1; return acc; }, {});

            responseData.charts = {
                attendance_summary_chart: [
                    { name: 'Present', value: presentToday },
                    { name: 'Absent', value: Math.max(0, activeEmployees - presentToday) }
                ],
                late_arrival_trend_chart: [],
                recruitment_pipeline_chart: Object.entries(candStatus).map(([name, value]) => ({ name, value }))
            };
            responseData.tables = {
                employee_status: [],
                intern_summary: []
            };
        } else {
             // Staff and Intern
             const { data: userProfile } = await supabase.from('user_profiles').select('employee_id').eq('uid', userId).maybeSingle();
             const associateId = userProfile?.employee_id || userId;
             
             const [taskRes, worksRes] = await Promise.all([
                 safeQuery(supabase.from('team_tasks').select('id, title, status, due_date').eq('assigned_to', userId), 'team_tasks'),
                 safeQuery(supabase.from('works').select('id, name, status, target_date').eq('associate_id', associateId), 'works')
             ]);

             const tasks = taskRes.error ? [] : (taskRes.data || []);
             const works = worksRes.error ? [] : (worksRes.data || []);

             const pendingTasks = tasks.filter(t => t.status !== 'Completed').length;
             const overdueTasks = tasks.filter(t => t.status !== 'Completed' && t.due_date && new Date(t.due_date) < now).length;
             
             const taskStatusCount = tasks.reduce((acc, t) => { acc[t.status || 'Pending'] = (acc[t.status || 'Pending'] || 0) + 1; return acc; }, {});
             const workStatusCount = works.reduce((acc, w) => { acc[w.status || 'In Progress'] = (acc[w.status || 'In Progress'] || 0) + 1; return acc; }, {});

             responseData.kpis = {
                 myTasks: tasks.length,
                 pendingTasks,
                 overdueTasks,
                 myWorks: works.length
             };

             responseData.charts = {
                 task_status_chart: Object.entries(taskStatusCount).map(([name, value]) => ({ name, value, color: name === 'Completed' ? '#22c55e' : '#eab308' })),
                 work_progress_chart: Object.entries(workStatusCount).map(([name, value]) => ({ name, value, color: name === 'Completed' ? '#14b8a6' : '#8b5cf6' })),
                 intern_task_status_chart: Object.entries(taskStatusCount).map(([name, value]) => ({ name, value })),
                 intern_completion_progress_chart: Object.entries(workStatusCount).map(([name, value]) => ({ name, value }))
             };

             const upcomingTasks = tasks.filter(t => t.status !== 'Completed' && t.due_date).sort((a,b) => new Date(a.due_date) - new Date(b.due_date)).slice(0,5);
             const recentlyAssignedWorks = works.filter(w => w.status !== 'Completed').slice(0,5);

             responseData.tables = {
                 upcoming_deadlines: upcomingTasks.map(t => ({ id: t.id, name: t.title, type: 'Task', dueDate: t.due_date, status: t.status })),
                 recently_assigned: recentlyAssignedWorks.map(w => ({ id: w.id, name: w.name, type: 'Work', dueDate: w.target_date, status: w.status }))
             };
        }

        res.json({
            success: true,
            data: responseData
        });
    } catch (error) {
        console.error("[Dashboard Summary Error]:", error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch dashboard summary', 
            message: error.message || String(error),
            code: error.code || null,
            details: error.details || null,
            hint: error.hint || null
        });
    }
});

module.exports = router;
