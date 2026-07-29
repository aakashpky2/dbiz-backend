const express = require('express');
const router = express.Router();
const { requirePermission } = require('../lib/permissions');
const { supabase } = require('../lib/supabase');

// --- Teams ---

// List all teams with full member details and work counts
// List all teams with full member details and work counts
router.get('/', async (req, res) => {
  console.log("[GET /api/teams] manual fetch start");

  try {
    // 1. Fetch teams only
    let query = supabase
      .from('teams')
      .select('*')
      .eq('is_deleted', false);

    if (req.query.active === 'true') {
        query = query.eq('status', 'ACTIVE');
    }

    const { data: teams, error: teamsError } = await query.order('name');

    if (teamsError) {
      console.error("[GET /api/teams] teamsError:", teamsError);
      throw teamsError;
    }

    // 2. Fetch team_members only
    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('*');

    if (membersError) {
      console.error("[GET /api/teams] membersError:", membersError);
      throw membersError;
    }

    // 3. Fetch employees only
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, full_name, photo_url, email');

    if (employeesError) {
      console.error("[GET /api/teams] employeesError:", employeesError);
      throw employeesError;
    }

    // 4. Fetch work counts safely
    const { data: activeWorks, error: worksError } = await supabase
      .from('works')
      .select('associate_id')
      .not('status', 'eq', 'Completed');

    if (worksError) {
      console.error("[GET /api/teams] worksError:", worksError);
    }

    const employeeMap = new Map((employees || []).map((e) => [e.id, e]));

    const workCounts = (activeWorks || []).reduce((acc, w) => {
      if (w.associate_id) {
        acc[w.associate_id] = (acc[w.associate_id] || 0) + 1;
      }
      return acc;
    }, {});

    const mapped = (teams || []).map((t) => {
      const teamMembers = (members || []).filter((m) => m.team_id === t.id);

      return {
        id: t.id,
        name: t.name || 'Unnamed Team',
        description: t.description || '',
        type: t.type || 'client',
        clientId: t.client_id || null,
        departmentId: t.department_id || null,
        leadId: t.lead_id || null,
        status: t.status || 'ACTIVE',
        createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
        updatedAt: t.updated_at ? new Date(t.updated_at).getTime() : null,
        members: teamMembers.reduce((acc, m) => {
          if (!m.employee_id) return acc;

          acc[m.employee_id] = {
            role: m.role || 'Member',
            availabilityStatus: m.availability_status || 'Available',
            assignmentType: m.assignment_type || 'Permanent',
            backupMemberId: m.backup_member_id || null,
            leaveFrom: m.leave_from || null,
            leaveTo: m.leave_to || null,
            joinedDate: m.joined_date || null,
            startDate: m.start_date ? new Date(m.start_date).getTime() : null,
            activeWorkCount: workCounts[m.employee_id] || 0,
            employee: employeeMap.get(m.employee_id) || null
          };

          return acc;
        }, {})
      };
    });

    console.log("[GET /api/teams] success:", mapped.length);

    return res.json({
      success: true,
      data: mapped
    });
  } catch (error) {
    console.error("[GET /api/teams] failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch teams",
      details: error
    });
  }
});

// GET /api/teams/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: team, error } = await supabase
            .from('teams')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            console.error('[Teams API] Fetch error:', error);
            return res.status(error.code === 'PGRST116' ? 404 : 500).json({ success: false, error: error.message });
        }

        res.json({
            success: true,
            data: {
                id: team.id,
                name: team.name,
                description: team.description,
                type: team.type,
                status: team.status || 'ACTIVE'
            }
        });
    } catch (error) {
        console.error('[Teams API] Internal error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Team
router.post('/', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { name, description, type, clientId, departmentId, leadId, status, createdBy } = req.body;
        
        // Defensive logging
        console.log("Create Team Payload:", req.body);

        // Validation
        if (!name || !name.trim()) return res.status(400).json({ error: 'Team name is required' });
        if (!['client', 'department', 'client-work'].includes(type)) return res.status(400).json({ error: 'Invalid team type' });
        if (type === 'client' && !clientId) return res.status(400).json({ error: 'Client ID is required for client teams' });
        if (type === 'department' && !departmentId) return res.status(400).json({ error: 'Department ID is required for department teams' });
        if (type === 'client-work' && (!clientId || !departmentId)) return res.status(400).json({ error: 'Both Client and Department are required' });
        if (!leadId) return res.status(400).json({ error: 'Team Lead is mandatory' });

        // Check for duplicates (case-insensitive name check)
        const { data: existing } = await supabase
            .from('teams')
            .select('id')
            .ilike('name', name.trim())
            .eq('is_deleted', false)
            .maybeSingle();
            
        if (existing) return res.status(400).json({ error: 'A team with this name already exists' });

        // 1. Create the team
        const { data: team, error: teamError } = await supabase
            .from('teams')
            .insert({ 
                name: name.trim(), 
                description, 
                type, 
                client_id: clientId, 
                department_id: departmentId, 
                lead_id: leadId,
                status: status || 'ACTIVE',
                created_by: createdBy
            })
            .select()
            .single();

        if (teamError) {
            console.error("Create Team Error:", teamError);
            throw teamError;
        }

        // 2. Automatically add the lead as a member
        const { error: memberError } = await supabase
            .from('team_members')
            .insert({
                team_id: team.id,
                employee_id: leadId,
                role: 'Team Lead',
                assignment_type: 'Permanent',
                availability_status: 'Available',
                start_date: new Date().toISOString().split('T')[0],
                joined_date: new Date().toISOString().split('T')[0]
            });

        if (memberError) {
            console.error("Add Lead Member Error:", memberError);
            // We don't fail the whole request if member addition fails, but it's bad.
        }

        // 3. Log activity
        await supabase.from('team_activity_logs').insert({
            team_id: team.id,
            action: 'Team Created',
            performed_by_name: 'Admin',
            details: { name: team.name, leadId }
        });

        res.json(team);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Team
router.patch('/:teamId', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { teamId } = req.params;
        const updates = req.body;
        
        // Defensive logging
        console.log("Update Team Payload:", updates);

        // Fetch old team to check lead change
        const { data: oldTeam } = await supabase.from('teams').select('lead_id').eq('id', teamId).single();

        const { data: team, error: teamError } = await supabase
            .from('teams')
            .update({
                name: updates.name?.trim(),
                description: updates.description,
                type: updates.type,
                client_id: updates.clientId,
                department_id: updates.departmentId,
                lead_id: updates.leadId,
                status: updates.status
            })
            .eq('id', teamId)
            .select()
            .single();

        if (teamError) {
            console.error("Update Team Error:", teamError);
            throw teamError;
        }

        // If lead changed, handle it
        if (updates.leadId && updates.leadId !== oldTeam.lead_id) {
            // 1. Demote old lead to Member
            await supabase
                .from('team_members')
                .update({ role: 'Member' })
                .eq('team_id', teamId)
                .eq('role', 'Team Lead');

            // 2. Upsert new lead
            await supabase
                .from('team_members')
                .upsert({
                    team_id: teamId,
                    employee_id: updates.leadId,
                    role: 'Team Lead',
                    assignment_type: 'Permanent',
                    availability_status: 'Available',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'team_id, employee_id' });
        }

        // Log activity
        await supabase.from('team_activity_logs').insert({
            team_id: teamId,
            action: 'Team Updated',
            performed_by_name: 'Admin',
            details: { updates }
        });

        res.json(team);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Soft Delete Team
router.delete('/:teamId', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { teamId } = req.params;
        const { error } = await supabase
            .from('teams')
            .update({ is_deleted: true, status: 'INACTIVE' })
            .eq('id', teamId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Team Members ---

// --- Team Members ---

router.post('/:teamId/members', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { employeeId, role, assignmentType, startDate } = req.body;
        const { teamId } = req.params;

        if (!employeeId) return res.status(400).json({ error: 'Employee ID is required' });
        const validRoles = ['Team Lead', 'Senior Member', 'Member', 'Reviewer', 'Backup Member'];
        if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

        // If role is Team Lead, check if one already exists
        if (role === 'Team Lead') {
            const { data: existingLead } = await supabase
                .from('team_members')
                .select('id')
                .eq('team_id', teamId)
                .eq('role', 'Team Lead')
                .maybeSingle();
            
            if (existingLead) {
                // Option: explicitly replace or block. Here we block.
                return res.status(400).json({ error: 'A Team Lead already exists. Please change their role first.' });
            }
        }

        const { data, error } = await supabase
            .from('team_members')
            .insert({
                team_id: teamId,
                employee_id: employeeId,
                role: role || 'Member',
                assignment_type: assignmentType || 'Permanent',
                start_date: startDate ? new Date(startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(400).json({ error: 'Member already assigned to this team' });
            throw error;
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/:teamId/members/:employeeId/role', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { role } = req.body;
        const { teamId, employeeId } = req.params;

        if (role === 'Team Lead') {
            const { data: existingLead } = await supabase
                .from('team_members')
                .select('id')
                .eq('team_id', teamId)
                .eq('role', 'Team Lead')
                .neq('employee_id', employeeId)
                .maybeSingle();
            
            if (existingLead) return res.status(400).json({ error: 'A Team Lead already exists.' });
        }

        const { data, error } = await supabase
            .from('team_members')
            .update({ role })
            .eq('team_id', teamId)
            .eq('employee_id', employeeId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/:teamId/members/:employeeId/availability', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { status, leaveFrom, leaveTo } = req.body;
        const { teamId, employeeId } = req.params;

        if (status === 'On Leave') {
            if (!leaveFrom || !leaveTo) return res.status(400).json({ error: 'Leave dates are required' });
            if (new Date(leaveFrom) < new Date().setHours(0,0,0,0)) return res.status(400).json({ error: 'Leave cannot start in the past' });
            if (new Date(leaveTo) < new Date(leaveFrom)) return res.status(400).json({ error: 'End date cannot be before start date' });
        }

        const { data, error } = await supabase
            .from('team_members')
            .update({ 
                availability_status: status,
                leave_from: status === 'On Leave' ? leaveFrom : null,
                leave_to: status === 'On Leave' ? leaveTo : null
            })
            .eq('team_id', teamId)
            .eq('employee_id', employeeId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:teamId/members/:employeeId', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { error } = await supabase
            .from('team_members')
            .delete()
            .eq('team_id', req.params.teamId)
            .eq('employee_id', req.params.employeeId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Transfer Rules ---

router.get('/:teamId/transfer-rules', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('team_transfer_rules')
            .select('*')
            .eq('team_id', req.params.teamId)
            .maybeSingle();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/:teamId/transfer-rules', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { autoTransferEnabled, backupPriority, maxWorkloadThreshold, fallbackToLead } = req.body;
        
        if (maxWorkloadThreshold < 1) return res.status(400).json({ error: 'Max workload must be at least 1' });
        if (!backupPriority) return res.status(400).json({ error: 'Backup priority is required' });

        const { data, error } = await supabase
            .from('team_transfer_rules')
            .upsert({
                team_id: req.params.teamId,
                auto_transfer_enabled: autoTransferEnabled,
                backup_priority: backupPriority,
                max_workload_threshold: maxWorkloadThreshold,
                fallback_to_lead: fallbackToLead
            }, { onConflict: 'team_id' })
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- History / Activity Logs ---

router.get('/:teamId/history', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('team_activity_logs')
            .select('*')
            .eq('team_id', req.params.teamId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:teamId/history', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { performedByAuthId, performedByEmployeeId, performedByName, action, details, remarks } = req.body;
        const { data, error } = await supabase
            .from('team_activity_logs')
            .insert({
                team_id: req.params.teamId,
                performed_by_auth_id: performedByAuthId,
                performed_by_employee_id: performedByEmployeeId,
                performed_by_name: performedByName,
                action,
                details: details || {},
                remarks
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Tasks ---

router.get('/:teamId/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('team_tasks')
            .select('*')
            .eq('team_id', req.params.teamId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, data: tasks });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:teamId/tasks', requirePermission('MANAGE_TEAMS'), async (req, res) => {
    try {
        const { title, description, assignedTo, assignedBy, status, dueDate } = req.body;
        const { data, error } = await supabase
            .from('team_tasks')
            .insert({
                team_id: req.params.teamId,
                title,
                description,
                assigned_to: assignedTo,
                assigned_by: assignedBy,
                status: status || 'Pending',
                due_date: dueDate ? new Date(dueDate).toISOString() : null
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
