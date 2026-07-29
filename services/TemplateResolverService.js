const { supabase } = require('../lib/supabase');

class TemplateResolverService {
    static async resolveTemplate(moduleName, actionKey, filterContext = {}) {
        moduleName = String(moduleName || '').toLowerCase().trim();
        actionKey = String(actionKey || '').toLowerCase().trim();

        // 1. Fetch active configurations for this module and action
        let query = supabase
            .from('template_configurations')
            .select(`
                id,
                name,
                module,
                action_key,
                template_id,
                status,
                is_default,
                condition_mode,
                conditions,
                priority,
                description
            `)
            .eq('module', moduleName)
            .eq('status', 'active')
            .not('template_id', 'is', null);

        if (actionKey === 'download_pdf') {
            query = query.or(`action_key.eq.${actionKey},action_key.is.null`);
        } else {
            query = query.eq('action_key', actionKey);
        }

        const { data: configs, error } = await query;

        if (error) {
            console.error('TemplateResolverService error:', error);
            throw new Error('Failed to fetch template configurations: ' + error.message);
        }

        if (!configs || configs.length === 0) {
            return { success: false, message: "No templates configured" };
        }

        const eligibleConfigs = [];

        // 2. Evaluate each config
        for (const config of configs) {
            if (config.condition_mode === 'always') {
                eligibleConfigs.push({ ...config, matchType: 'always' });
            } else if (config.condition_mode === 'conditional') {
                const conditions = config.conditions || [];
                const isMatch = this.evaluateConditions(conditions, filterContext);
                if (isMatch) {
                    eligibleConfigs.push({ ...config, matchType: 'conditional' });
                }
            }
        }

        if (eligibleConfigs.length === 0) {
            return { success: false, message: "No matching template found" };
        }

        // 3. Selection Logic
        const conditionalMatches = eligibleConfigs.filter(c => c.matchType === 'conditional');
        const alwaysMatches = eligibleConfigs.filter(c => c.matchType === 'always');

        let selectedConfigs = [];

        if (conditionalMatches.length > 0) {
            // Conditional matches win over always. Sort by priority (lowest wins)
            conditionalMatches.sort((a, b) => (a.priority || 100) - (b.priority || 100));
            
            const lowestPriority = conditionalMatches[0].priority || 100;
            selectedConfigs = conditionalMatches.filter(c => (c.priority || 100) === lowestPriority);
        } else if (alwaysMatches.length > 0) {
            // Fallback to always templates
            const defaultAlways = alwaysMatches.find(c => c.is_default === true);
            if (defaultAlways) {
                selectedConfigs = [defaultAlways];
            } else {
                selectedConfigs = alwaysMatches;
            }
        }

        // Fetch template content for selected configs
        for (const config of selectedConfigs) {
            if (config.template_id) {
                const { data: tmplData } = await supabase
                    .from('templates')
                    .select('content')
                    .eq('id', config.template_id)
                    .single();
                if (tmplData) {
                    config.templates = { content: tmplData.content };
                }
            }
        }

        // 4. Return result
        if (selectedConfigs.length === 1) {
            const selected = selectedConfigs[0];
            return {
                success: true,
                requiresSelection: false,
                data: {
                    configuration_id: selected.id,
                    template_id: selected.template_id,
                    template_name: selected.name,
                    template_content: selected.templates?.content,
                    module: selected.module,
                    action_key: selected.action_key,
                    priority: selected.priority,
                    matchedReason: selected.matchType === 'conditional' ? 'Matched specific conditions' : 'Fallback to default template'
                }
            };
        } else if (selectedConfigs.length > 1) {
            return {
                success: true,
                requiresSelection: true,
                options: selectedConfigs.map(c => ({
                    configuration_id: c.id,
                    template_id: c.template_id,
                    template_name: c.name,
                    description: c.description,
                    priority: c.priority,
                    matchType: c.matchType,
                    matchedReason: c.matchType === 'conditional' ? 'Matched specific conditions' : 'Fallback to default template'
                }))
            };
        }

        return { success: false, message: "Selection logic failed to resolve" };
    }

    static evaluateConditions(conditions, context) {
        if (!conditions || conditions.length === 0) return true;

        const andConditions = conditions.filter(c => c.group === 'AND' || !c.group);
        const orConditions = conditions.filter(c => c.group === 'OR');

        let andPass = true;
        if (andConditions.length > 0) {
            andPass = andConditions.every(cond => this.evaluateSingleCondition(cond, context));
        }

        let orPass = false;
        if (orConditions.length > 0) {
            orPass = orConditions.some(cond => this.evaluateSingleCondition(cond, context));
        }

        if (andConditions.length > 0 && orConditions.length > 0) {
            return andPass || orPass;
        } else if (andConditions.length > 0) {
            return andPass;
        } else if (orConditions.length > 0) {
            return orPass;
        }

        return true;
    }

    static evaluateSingleCondition(cond, context) {
        const fieldKey = cond.field_key;
        let contextValue = context[fieldKey];
        const operator = (cond.operator || '').toLowerCase();
        let conditionValue = cond.value;

        // If context has array values (like work_type_ids)
        // We might also want to check the name equivalent (e.g. work_type_names) if the key doesn't have _id.
        // To be safe, let's collect possible context values to match against.
        let valuesToCompare = [contextValue];

        // "Conditions must compare both ID and label where applicable."
        // If fieldKey is 'branch', we should check 'branch_id' and 'branch_name'
        if (fieldKey === 'branch') {
            valuesToCompare = [context.branch_id, context.branch_name];
        } else if (fieldKey === 'business_profile') {
            valuesToCompare = [context.business_profile_id, context.business_profile_name];
        } else if (fieldKey === 'client') {
            valuesToCompare = [context.client_id, context.client_name];
        } else if (fieldKey === 'constitution') {
            valuesToCompare = [context.constitution_id, context.constitution_name];
        } else if (fieldKey === 'sub_constitution') {
            valuesToCompare = [context.sub_constitution_id, context.sub_constitution_name];
        } else if (fieldKey === 'work_type') {
            valuesToCompare = [...(context.work_type_ids || []), ...(context.work_type_names || [])];
        } else if (fieldKey === 'department') {
            valuesToCompare = context.department_ids || [];
        } else if (fieldKey === 'category') {
            valuesToCompare = context.category_ids || [];
        } else if (Array.isArray(contextValue)) {
            valuesToCompare = contextValue;
        }

        // Helper to check if any value in array passes the operator test
        const passes = (testFn) => valuesToCompare.some(val => testFn(val, conditionValue));

        switch (operator) {
            case 'equals':
            case '==':
                return passes((val, target) => String(val).toLowerCase() === String(target).toLowerCase());
            case 'not equals':
            case 'not_equals':
            case '!=':
                return passes((val, target) => String(val).toLowerCase() !== String(target).toLowerCase());
            case 'contains':
                return passes((val, target) => String(val).toLowerCase().includes(String(target).toLowerCase()));
            case 'greater than':
            case 'greater_than':
            case '>':
                return passes((val, target) => Number(val) > Number(target));
            case 'less than':
            case 'less_than':
            case '<':
                return passes((val, target) => Number(val) < Number(target));
            case 'in':
                // target might be an array or comma separated string
                let targetArray = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(s => s.trim().toLowerCase());
                return passes((val) => targetArray.includes(String(val).toLowerCase()));
            case 'between':
                // target should be an array [min, max] or "min,max"
                let min = 0, max = 0;
                if (Array.isArray(conditionValue) && conditionValue.length === 2) {
                    min = Number(conditionValue[0]);
                    max = Number(conditionValue[1]);
                } else if (typeof conditionValue === 'string' && conditionValue.includes(',')) {
                    const parts = conditionValue.split(',');
                    min = Number(parts[0]);
                    max = Number(parts[1]);
                }
                return passes((val) => Number(val) >= min && Number(val) <= max);
            default:
                return false;
        }
    }
}

module.exports = TemplateResolverService;
