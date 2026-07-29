const { PERMISSION_CATALOGUE } = require('./permissions');

const LEGACY_PERMISSION_COMPATIBILITY = {
  'Staff': {
    VIEW_TASKS: ['VIEW_MY_TASKS'],
  },
  'Employee': {
    VIEW_TASKS: ['VIEW_MY_TASKS'],
  },
  'Developer': {
    VIEW_TASKS: ['VIEW_MY_TASKS'],
  },
  'Intern': {
    VIEW_TASKS: ['VIEW_MY_TASKS'],
  },
  'HR Manager': {
    VIEW_TASKS: ['VIEW_MY_TASKS', 'VIEW_ALL_TASKS'],
    MANAGE_EMPLOYEES: [
      'VIEW_EMPLOYEE_DIRECTORY',
      'CREATE_EMPLOYEE',
      'EDIT_EMPLOYEE_BASIC_DETAILS',
      'EDIT_EMPLOYEE_EMPLOYMENT_DETAILS',
      'DEACTIVATE_EMPLOYEE',
      'VIEW_PROMOTIONS',
      'MANAGE_PROMOTIONS'
    ],
  },
  'Manager': {
    VIEW_TASKS: ['VIEW_MY_TASKS', 'VIEW_ALL_TASKS'],
    MANAGE_EMPLOYEES: [
      'VIEW_EMPLOYEE_DIRECTORY',
    ],
  },
  'Admin': {
    VIEW_TASKS: ['VIEW_MY_TASKS', 'VIEW_ALL_TASKS'],
    MANAGE_EMPLOYEES: [
      'VIEW_EMPLOYEE_DIRECTORY',
      'CREATE_EMPLOYEE',
      'EDIT_EMPLOYEE_BASIC_DETAILS',
      'EDIT_EMPLOYEE_EMPLOYMENT_DETAILS',
      'DEACTIVATE_EMPLOYEE',
      'VIEW_PROMOTIONS',
      'MANAGE_PROMOTIONS'
    ],
    MANAGE_WORK: [
      'VIEW_WORK',
      'ASSIGN_WORK',
      'REASSIGN_WORK',
      'ASSIGN_WORK_TO_TEAM',
      'ASSIGN_WORK_TO_EMPLOYEE',
      'CHANGE_TASK_DUE_DATE',
      'CHANGE_TASK_PRIORITY',
      'CANCEL_ASSIGNED_WORK'
    ]
  },
  'Super Admin': {
    VIEW_TASKS: ['VIEW_MY_TASKS', 'VIEW_ALL_TASKS'],
    MANAGE_EMPLOYEES: [
      'VIEW_EMPLOYEE_DIRECTORY',
      'CREATE_EMPLOYEE',
      'EDIT_EMPLOYEE_BASIC_DETAILS',
      'EDIT_EMPLOYEE_EMPLOYMENT_DETAILS',
      'EDIT_EMPLOYEE_SALARY',
      'DEACTIVATE_EMPLOYEE',
      'DELETE_EMPLOYEE',
      'VIEW_PROMOTIONS',
      'MANAGE_PROMOTIONS'
    ],
    MANAGE_WORK: [
      'VIEW_WORK',
      'ASSIGN_WORK',
      'REASSIGN_WORK',
      'ASSIGN_WORK_TO_TEAM',
      'ASSIGN_WORK_TO_EMPLOYEE',
      'CHANGE_TASK_DUE_DATE',
      'CHANGE_TASK_PRIORITY',
      'CANCEL_ASSIGNED_WORK'
    ]
  }
};

/**
 * Maps old broad permissions to granular permissions based strictly on a reviewed compatibility matrix.
 */
function mapLegacyPermissions(legacyPermissions, roleName) {
  const newPermissions = new Set(legacyPermissions);
  
  if (!roleName) return Array.from(newPermissions);
  
  // Find matching role mapping using case-insensitive match if needed
  const roleKey = Object.keys(LEGACY_PERMISSION_COMPATIBILITY).find(k => k.toLowerCase() === roleName.toLowerCase());
  if (!roleKey) return Array.from(newPermissions);

  const roleMap = LEGACY_PERMISSION_COMPATIBILITY[roleKey];

  for (const [oldKey, newKeys] of Object.entries(roleMap)) {
    if (newPermissions.has(oldKey)) {
      newPermissions.delete(oldKey);
      newKeys.forEach(k => newPermissions.add(k));
    }
  }
  
  return Array.from(newPermissions);
}

module.exports = {
  mapLegacyPermissions,
  LEGACY_PERMISSION_COMPATIBILITY
};
