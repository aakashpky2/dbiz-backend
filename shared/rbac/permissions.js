const PERMISSION_CATALOGUE = {
  // --- General ---
  VIEW_DASHBOARD: { category: 'General', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  VIEW_REPORTS: { category: 'General', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  EXPORT_REPORTS: { category: 'General', requires: ['VIEW_REPORTS'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: false },

  // --- Tasks and Work ---
  VIEW_MY_TASKS: { category: 'Work', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  VIEW_ALL_TASKS: { category: 'Work', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  CLAIM_TASKS: { category: 'Work', requires: ['VIEW_MY_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  START_TASKS: { category: 'Work', requires: ['VIEW_MY_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  PAUSE_TASKS: { category: 'Work', requires: ['VIEW_MY_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  COMPLETE_TASKS: { category: 'Work', requires: ['VIEW_MY_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },

  ASSIGN_WORK: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  REASSIGN_WORK: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  ASSIGN_WORK_TO_TEAM: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  ASSIGN_WORK_TO_EMPLOYEE: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  CHANGE_TASK_DUE_DATE: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  CHANGE_TASK_PRIORITY: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  CANCEL_ASSIGNED_WORK: { category: 'Work', requires: ['VIEW_ALL_TASKS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  VIEW_WORK: { category: 'Work', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  MANAGE_WORK: { category: 'Work', requires: ['VIEW_WORK'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  // --- Employee Management ---
  VIEW_EMPLOYEE_DIRECTORY: { category: 'Employee', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN'], version: 1, protected: false },
  CREATE_EMPLOYEE: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  EDIT_EMPLOYEE_BASIC_DETAILS: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  EDIT_EMPLOYEE_EMPLOYMENT_DETAILS: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  EDIT_EMPLOYEE_SALARY: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  DEACTIVATE_EMPLOYEE: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  DELETE_EMPLOYEE: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },

  VIEW_TEAMS: { category: 'Employee', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER', 'ADMIN'], version: 1, protected: false },
  MANAGE_TEAMS: { category: 'Employee', requires: ['VIEW_TEAMS'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },

  // --- Attendance ---
  VIEW_MY_ATTENDANCE: { category: 'Attendance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  VIEW_ALL_ATTENDANCE: { category: 'Attendance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_ATTENDANCE: { category: 'Attendance', requires: ['VIEW_ALL_ATTENDANCE'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },

  VIEW_HOLIDAYS: { category: 'Attendance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_HOLIDAYS: { category: 'Attendance', requires: ['VIEW_HOLIDAYS'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },

  VIEW_LEAVES: { category: 'Attendance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_LEAVES: { category: 'Attendance', requires: ['VIEW_LEAVES'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },

  VIEW_PROMOTIONS: { category: 'Employee', requires: ['VIEW_EMPLOYEE_DIRECTORY'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_PROMOTIONS: { category: 'Employee', requires: ['VIEW_PROMOTIONS'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },

  // --- Recruitment ---
  VIEW_RECRUITMENT: { category: 'Recruitment', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  CREATE_JOB_OPENING: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  EDIT_JOB_OPENING: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_APPLICANTS: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_INTERVIEWS: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_RECRUITMENT_PIPELINE: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_RECRUITMENT_MASTER: { category: 'Recruitment', requires: ['VIEW_RECRUITMENT'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },

  // --- Clients & Proposals ---
  VIEW_CLIENTS: { category: 'Clients', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  MANAGE_CLIENTS: { category: 'Clients', requires: ['VIEW_CLIENTS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  VIEW_PROPOSALS: { category: 'Proposals', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  MANAGE_PROPOSALS: { category: 'Proposals', requires: ['VIEW_PROPOSALS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  // --- Workflows ---
  VIEW_WORKFLOWS: { category: 'Workflow', requires: [], delegatableBy: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], version: 1, protected: false },
  MANAGE_WORKFLOWS: { category: 'Workflow', requires: ['VIEW_WORKFLOWS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_WORK_BASED_FLOW: { category: 'Workflow', requires: ['MANAGE_WORKFLOWS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_CLIENT_BASED_FLOW: { category: 'Workflow', requires: ['MANAGE_WORKFLOWS'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  // --- Admin and Configuration ---
  VIEW_ADMIN_PANEL: { category: 'Admin', requires: [], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: false },
  MANAGE_USERS: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  ASSIGN_ROLES: { category: 'Admin', requires: ['MANAGE_USERS'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  MANAGE_SYSTEM_ROLES: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  MANAGE_PERMISSIONS: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },

  MANAGE_DEPARTMENTS: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_SETTINGS: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  MANAGE_FORMS_AND_FEES: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_TEMPLATES: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_TEMPLATE_CONFIG: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_CONSTITUTIONS: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_ASSOCIATES: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_COMPLIANCE_RULES: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },
  MANAGE_MASTER_DATA: { category: 'Admin', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN', 'ADMIN'], version: 1, protected: false },

  // --- Performance ---
  VIEW_OWN_PERFORMANCE: { category: 'Performance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  VIEW_TEAM_PERFORMANCE: { category: 'Performance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  VIEW_ALL_PERFORMANCE: { category: 'Performance', requires: [], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  EDIT_PERFORMANCE: { category: 'Performance', requires: ['VIEW_ALL_PERFORMANCE'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  MANAGE_PERFORMANCE: { category: 'Performance', requires: ['VIEW_ALL_PERFORMANCE'], delegatableBy: ['SUPER_ADMIN', 'HR_MANAGER'], version: 1, protected: false },
  DELETE_PERFORMANCE: { category: 'Performance', requires: ['VIEW_ALL_PERFORMANCE'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },

  // --- Delegation ---
  VIEW_USER_RESPONSIBILITIES: { category: 'Delegation', requires: ['VIEW_ADMIN_PANEL'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: false },
  GRANT_USER_RESPONSIBILITIES: { category: 'Delegation', requires: ['VIEW_USER_RESPONSIBILITIES'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  REVOKE_USER_RESPONSIBILITIES: { category: 'Delegation', requires: ['VIEW_USER_RESPONSIBILITIES'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  GRANT_TEMPORARY_RESPONSIBILITIES: { category: 'Delegation', requires: ['VIEW_USER_RESPONSIBILITIES'], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },
  DELEGATE_OPERATIONAL_PERMISSIONS: { category: 'Delegation', requires: [], delegatableBy: ['SUPER_ADMIN'], version: 1, protected: true },

  // --- Protected ---
  OWNER_SUPER_ADMIN_CONTROLS: { category: 'Protected', requires: [], delegatableBy: [], version: 1, protected: true },
};

module.exports = {
  PERMISSION_CATALOGUE
};
