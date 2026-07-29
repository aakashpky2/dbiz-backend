// backend/services/InheritanceResolverService.js

class InheritanceResolverService {
    /**
     * Resolves the final rules by merging Step-level fields with defaults.
     * Note: common template-level defaults (default_department_id, default_assigned_role, etc.)
     * have been removed from the schema. Steps now carry their own rules independently.
     * @param {Object} template The workflow template (used for context only).
     * @param {Object} stepRules The step-specific rules from the workflow_step.
     * @returns {Object} The resolved rules for the step.
     */
    static resolveStepRules(template = {}, stepRules = {}) {
        const resolveField = (stepVal, defaultVal) => {
            if (stepVal !== undefined && stepVal !== null && stepVal !== '') {
                if (typeof stepVal === 'object' && Object.keys(stepVal).length === 0) {
                    // Fallthrough to default for empty objects
                } else {
                    return { value: stepVal, source: 'Step Override' };
                }
            }
            return { value: defaultVal, source: 'Default Empty State' };
        };

        return {
            assigned_department_id: resolveField(stepRules.assigned_department_id, null),
            assigned_role: resolveField(stepRules.assigned_role, null),
            reminder_days_before: resolveField(stepRules.reminder_days_before, 0),
            approval_required: resolveField(stepRules.approval_required, false),
            due_date_rule: resolveField(stepRules.step_due_date_rule, {}),
            finish_date_rule: resolveField(stepRules.step_finish_date_rule, {}),
        };
    }

    /**
     * Resolves whether to use the Client Override or Global Template.
     * @param {Object} clientOverride The client override template (if any).
     * @param {Object} globalTemplate The global template (if any).
     * @returns {Object} { source: 'CLIENT_OVERRIDE' | 'GLOBAL_TEMPLATE' | 'NONE', template: Object }
     */
    static resolveTemplateSource(clientOverride, globalTemplate) {
        if (clientOverride && clientOverride.status === 'ACTIVE') {
            return { source: 'CLIENT_OVERRIDE', template: clientOverride };
        }
        
        // Fallback to drafting client override if active doesn't exist
        if (clientOverride) {
            return { source: 'CLIENT_OVERRIDE', template: clientOverride };
        }

        if (globalTemplate) {
            return { source: 'GLOBAL_TEMPLATE', template: globalTemplate };
        }

        return { source: 'NONE', template: null };
    }
}

module.exports = InheritanceResolverService;
