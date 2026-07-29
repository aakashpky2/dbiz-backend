const { PERMISSION_CATALOGUE } = require('./permissions');
const { mapLegacyPermissions } = require('./compatibility');

/**
 * Resolves effective permissions given a user's roles, responsibility templates, and overrides.
 * Returns an AccessResolution object.
 */
function resolveEffectivePermissions(context) {
  const { 
    isOwnerSuperAdmin, 
    roles = [], 
    assignedTemplates = [], 
    templateDefinitions = {}, // { [templateId]: { permissions: [], childTemplates: [] } }
    overrides = [], 
    activeScopes = [] 
  } = context;

  const now = new Date();
  const effective = new Set();
  const denied = new Set();
  const permissionSources = {};
  const effectiveScopes = {};
  const invalidPermissions = [];
  
  const addSource = (perm, source) => {
    if (!permissionSources[perm]) permissionSources[perm] = [];
    if (!permissionSources[perm].includes(source)) permissionSources[perm].push(source);
  };

  // 1. Protected owner account rules
  if (isOwnerSuperAdmin) {
    const allPermissions = Object.keys(PERMISSION_CATALOGUE);
    allPermissions.forEach(p => {
      effective.add(p);
      addSource(p, 'OWNER');
    });
    
    // Fast path: Owners have unrestricted scopes initially, though this can be refined later.
    return {
      permissions: Array.from(effective),
      deniedPermissions: [],
      permissionSources,
      effectiveScopes,
      invalidPermissions
    };
  }

  // 2. Collect role permissions
  roles.forEach(role => {
    const mapped = mapLegacyPermissions(role.permissions || [], role.name);
    mapped.forEach(p => {
      effective.add(p);
      addSource(p, 'ROLE');
    });
  });

  // 3. Flatten nested templates safely (preventing circular dependencies)
  const visitedTemplates = new Set();
  const recursionStack = new Set();
  
  const expandTemplate = (templateId) => {
    if (recursionStack.has(templateId)) {
      const cycle = Array.from(recursionStack).concat(templateId);
      const error = new Error("The selected dependency creates a circular responsibility chain.");
      error.code = "RESPONSIBILITY_DEPENDENCY_CYCLE";
      error.cycle = cycle;
      throw error;
    }
    
    if (visitedTemplates.has(templateId)) return;
    
    recursionStack.add(templateId);
    visitedTemplates.add(templateId);
    
    const def = templateDefinitions[templateId];
    if (def) {
      if (def.permissions) {
        def.permissions.forEach(p => {
          effective.add(p);
          addSource(p, 'RESPONSIBILITY');
        });
      }
      if (def.childTemplates) {
        def.childTemplates.forEach(childId => expandTemplate(childId));
      }
    }
    
    recursionStack.delete(templateId);
  };

  assignedTemplates.forEach(tId => expandTemplate(tId));

  // Filter overrides and responsibilities for valid_until expiry
  const validOverrides = overrides.filter(o => !o.valid_until || new Date(o.valid_until) > now);

  // 4. Expand required dependencies (from roles and responsibilities)
  expandDependencies(effective, addSource, 'DEPENDENCY');

  // 5. Apply active explicit ALLOW overrides
  const allowOverrides = validOverrides.filter(o => o.effect === 'ALLOW').map(o => o.permission_key);
  allowOverrides.forEach(p => {
    effective.add(p);
    addSource(p, 'USER_ALLOW');
  });

  // 6. Expand dependencies introduced by ALLOW overrides
  expandDependencies(effective, addSource, 'DEPENDENCY');

  // 7. Apply active explicit DENY overrides
  const denyOverrides = validOverrides.filter(o => o.effect === 'DENY').map(o => o.permission_key);
  denyOverrides.forEach(p => {
    effective.delete(p);
    denied.add(p);
  });

  // 8. Remove permissions whose required dependencies are denied
  removeMissingDependencies(effective, denied, invalidPermissions);

  // 9. Scope generation
  // Combine scopes for permissions we actually have.
  const validScopes = activeScopes.filter(s => !s.valid_until || new Date(s.valid_until) > now);
  validScopes.forEach(s => {
    if (effective.has(s.permission_key)) {
      if (!effectiveScopes[s.permission_key]) {
        effectiveScopes[s.permission_key] = [];
      }
      effectiveScopes[s.permission_key].push({
        type: s.scope_type,
        values: s.scope_values
      });
    }
  });

  return {
    permissions: Array.from(effective),
    deniedPermissions: Array.from(denied),
    permissionSources,
    effectiveScopes,
    invalidPermissions
  };
}

function expandDependencies(permissionSet, addSource, sourceName) {
  let changed = true;
  while (changed) {
    changed = false;
    const current = Array.from(permissionSet);
    for (const perm of current) {
      const meta = PERMISSION_CATALOGUE[perm];
      if (meta && meta.requires) {
        for (const req of meta.requires) {
          if (!permissionSet.has(req)) {
            permissionSet.add(req);
            addSource(req, sourceName);
            changed = true;
          }
        }
      }
    }
  }
}

function removeMissingDependencies(permissionSet, deniedSet, invalidPermissions) {
  let changed = true;
  while (changed) {
    changed = false;
    const current = Array.from(permissionSet);
    for (const perm of current) {
      const meta = PERMISSION_CATALOGUE[perm];
      if (meta && meta.requires) {
        const missing = meta.requires.filter(req => !permissionSet.has(req) || deniedSet.has(req));
        if (missing.length > 0) {
          permissionSet.delete(perm);
          invalidPermissions.push({ permission: perm, missingDependencies: missing });
          changed = true;
        }
      }
    }
  }
}

module.exports = {
  resolveEffectivePermissions,
  expandDependencies,
  removeMissingDependencies
};
