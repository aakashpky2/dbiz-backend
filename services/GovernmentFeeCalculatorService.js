const { supabase } = require('../lib/supabase');

class GovernmentFeeCalculatorService {
    /**
     * Calculates government fees based on the provided template and client parameters.
     * @param {string} workTypeId - The ID of the work type to find the fee template for.
     * @param {Object} parameters - The parameters matching the client/service.
     * @returns {Object} { governmentFeeItems: [], governmentFeeTotal: number }
     */
    async calculateFees(workTypeId, parameters) {
        if (!workTypeId) throw new Error("workTypeId is required to calculate government fees.");
        
        // Step 1: Load Template
        const { data: template, error: templateError } = await supabase
            .from('government_fee_templates')
            .select('*')
            .eq('work_type_id', workTypeId)
            .eq('status', 'active')
            .single();

        if (templateError || !template) {
            console.log(`No active government fee template found for work_type_id: ${workTypeId}`);
            return { governmentFeeItems: [], governmentFeeTotal: 0 };
        }

        // Step 2: Load Components
        const { data: components, error: componentsError } = await supabase
            .from('government_fee_components')
            .select('*')
            .eq('template_id', template.id)
            .order('display_order', { ascending: true });

        if (componentsError || !components || components.length === 0) {
            return { governmentFeeItems: [], governmentFeeTotal: 0 };
        }

        const governmentFeeItems = [];
        let governmentFeeTotal = 0;

        // Step 3 & 4 & 5: Load Rules and Evaluate
        for (const component of components) {
            const { data: rules, error: rulesError } = await supabase
                .from('government_fee_rules')
                .select('*')
                .eq('component_id', component.id)
                .eq('status', 'active')
                .order('priority', { ascending: true });

            if (rulesError || !rules || rules.length === 0) {
                // If it's a manual component with no rules, we might just return an empty amount or skip
                if (component.calculation_method === 'MANUAL') {
                    governmentFeeItems.push({
                        feeName: component.fee_name,
                        authority: component.authority_name,
                        amount: 0,
                        source: 'Manual',
                        isRequired: component.is_required,
                        isManual: true
                    });
                }
                continue;
            }

            // Evaluate Rules sequentially based on priority
            let appliedAmount = null;

            for (const rule of rules) {
                if (this._evaluateRule(rule, parameters)) {
                    appliedAmount = this._calculateAmount(component.calculation_method, rule, parameters);
                    break; // Stop at first matching rule (highest priority)
                }
            }

            if (appliedAmount !== null) {
                governmentFeeItems.push({
                    feeName: component.fee_name,
                    authority: component.authority_name,
                    amount: appliedAmount,
                    source: 'Rule Engine',
                    isRequired: component.is_required,
                    isManual: component.is_editable
                });
                governmentFeeTotal += appliedAmount;
            } else if (component.is_required) {
                 // Fallback if required component didn't match any rule
                 governmentFeeItems.push({
                    feeName: component.fee_name,
                    authority: component.authority_name,
                    amount: 0,
                    source: 'Unmatched Required',
                    isRequired: component.is_required,
                    isManual: true
                });
            }
        }

        // Step 6: Generate Output
        return {
            governmentFeeItems,
            governmentFeeTotal
        };
    }

    _evaluateRule(rule, parameters) {
        // Constitution check
        if (rule.constitution_ids && rule.constitution_ids.length > 0 && parameters.constitution_id) {
            if (!rule.constitution_ids.includes(parameters.constitution_id)) return false;
        }
        // Sub Constitution check
        if (rule.sub_constitution_ids && rule.sub_constitution_ids.length > 0 && parameters.sub_constitution_id) {
            if (!rule.sub_constitution_ids.includes(parameters.sub_constitution_id)) return false;
        }
        // State check
        if (rule.state_ids && rule.state_ids.length > 0 && parameters.state_id) {
            if (!rule.state_ids.includes(parameters.state_id)) return false;
        }
        
        // Numeric Boundaries
        const capital = parseFloat(parameters.authorized_capital || 0);
        if (rule.min_authorized_capital !== null && capital < parseFloat(rule.min_authorized_capital)) return false;
        if (rule.max_authorized_capital !== null && capital > parseFloat(rule.max_authorized_capital)) return false;

        const paidup = parseFloat(parameters.paidup_capital || 0);
        if (rule.min_paidup_capital !== null && paidup < parseFloat(rule.min_paidup_capital)) return false;
        if (rule.max_paidup_capital !== null && paidup > parseFloat(rule.max_paidup_capital)) return false;

        const turnover = parseFloat(parameters.turnover || 0);
        if (rule.min_turnover !== null && turnover < parseFloat(rule.min_turnover)) return false;
        if (rule.max_turnover !== null && turnover > parseFloat(rule.max_turnover)) return false;

        const contribution = parseFloat(parameters.contribution || 0);
        if (rule.min_contribution !== null && contribution < parseFloat(rule.min_contribution)) return false;
        if (rule.max_contribution !== null && contribution > parseFloat(rule.max_contribution)) return false;

        return true;
    }

    _calculateAmount(method, rule, parameters) {
        if (method === 'FIXED') {
            return parseFloat(rule.amount || rule.fee_amount || 0);
        } else if (method === 'PERCENTAGE') {
            const baseValue = parseFloat(parameters.base_value || 0);
            const rate = parseFloat(rule.percentage_rate || 0);
            return (baseValue * rate) / 100;
        } else if (method === 'SLAB') {
            return parseFloat(rule.amount || rule.fee_amount || 0);
        }
        return 0;
    }
}

module.exports = new GovernmentFeeCalculatorService();
