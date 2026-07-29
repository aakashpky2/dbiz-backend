const { supabase } = require('../lib/supabase');

/**
 * Resolves an authenticated user's session UID to their employee ID in the `employees` table.
 * If requireActive is true, it verifies that the employee's status is 'ACTIVE'.
 * Returns { employeeId, error, status }
 */
async function resolveEmployeeIdFromAuth(authUid, requireActive = true) {
    if (!authUid) {
        return { error: 'Missing authenticated user ID' };
    }

    try {
        const { data, error } = await supabase
            .from('employees')
            .select('id, status')
            .eq('auth_user_id', authUid)
            .maybeSingle();

        if (error) {
            console.error('[resolveEmployeeIdFromAuth] Error querying employee:', error);
            return { error: 'Database error resolving employee identity' };
        }

        if (!data) {
            return { error: 'No associated employee record found for this user' };
        }

        if (requireActive && data.status !== 'ACTIVE') {
            return { error: 'Employee is not active', status: data.status };
        }

        return { employeeId: data.id, status: data.status };
    } catch (err) {
        console.error('[resolveEmployeeIdFromAuth] Exception:', err);
        return { error: 'Internal server error resolving employee identity' };
    }
}

module.exports = {
    resolveEmployeeIdFromAuth
};
