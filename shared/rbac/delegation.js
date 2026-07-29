const { PERMISSION_CATALOGUE } = require('./permissions');

/**
 * Checks if a delegator can delegate a specific permission to a target with a given scope.
 * 
 * @param {object} delegatorContext - The AccessResolution object of the delegator
 * @param {string} targetPermission - The permission being granted
 * @param {object} targetScope - The scope being granted
 * @returns {boolean} true if delegation is permitted, false otherwise
 */
function canDelegate(delegatorContext, targetPermission, targetScope) {
  const meta = PERMISSION_CATALOGUE[targetPermission];
  
  if (!meta) return false;

  // 1. Protected permissions cannot be delegated
  if (meta.protected) {
    return false; // Only Owner/Super Admin rules handle these directly, not standard delegation
  }

  // 2. The delegator must possess the permission they are trying to grant
  if (!delegatorContext.permissions.includes(targetPermission)) {
    return false;
  }

  // 3. The delegator must possess authority to delegate it
  // This relies on delegatableBy, which is an array of permission keys the delegator must hold.
  if (meta.delegatableBy && meta.delegatableBy.length > 0) {
    const hasAuthority = meta.delegatableBy.some(authPerm => delegatorContext.permissions.includes(authPerm));
    if (!hasAuthority) {
      return false;
    }
  }

  // 4. A delegated scope cannot exceed the delegator's scope.
  // For now, if the delegator has a specific scope for this permission, we verify the targetScope is a subset.
  // (Full subset logic depends on scope definitions, simplified here)
  const delegatorScopes = delegatorContext.effectiveScopes[targetPermission];
  if (delegatorScopes && delegatorScopes.length > 0) {
    // If delegator is restricted, target must also be restricted.
    if (!targetScope || targetScope.type === 'ALL') {
      const hasAllScope = delegatorScopes.some(s => s.type === 'ALL');
      if (!hasAllScope) return false;
    }
  }

  return true;
}

module.exports = {
  canDelegate
};
