const { supabase } = require('../lib/supabase');
const math = require('mathjs');

class GovernmentFeeApplicabilityService {

    _resolveJsonPath(obj, path) {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    _evaluateCondition(actualValue, operator, expectedValue, minVal, maxVal, minDate, maxDate) {
        if (actualValue === null || actualValue === undefined) return false;

        let a = actualValue !== null && actualValue !== undefined ? String(actualValue).trim().toLowerCase() : '';
        let e = expectedValue !== null && expectedValue !== undefined ? String(expectedValue).trim().toLowerCase() : '';

        switch (operator) {
            case 'equals': return a === e;
            case 'not_equals': return a !== e;
            case 'contains': return a.includes(e);
            case 'in': return Array.isArray(expectedValue) ? expectedValue.map(v => String(v).trim().toLowerCase()).includes(String(a)) : false;
            case 'not_in': return Array.isArray(expectedValue) ? !expectedValue.map(v => String(v).trim().toLowerCase()).includes(String(a)) : false;
            case 'greater_than': return Number(actualValue) > Number(expectedValue);
            case 'greater_than_or_equal': return Number(actualValue) >= Number(expectedValue);
            case 'less_than': return Number(actualValue) < Number(expectedValue);
            case 'less_than_or_equal': return Number(actualValue) <= Number(expectedValue);
            case 'between': return Number(actualValue) >= Number(minVal) && Number(actualValue) <= Number(maxVal);
            case 'before': return new Date(actualValue) < new Date(expectedValue);
            case 'after': return new Date(actualValue) > new Date(expectedValue);
            default: return false;
        }
    }

    async _fetchContextRecord(tableName, context, recordCache = {}) {
        const idMap = {
            'business_profiles': context.business_profile_id,
            'clients': context.client_id,
            'proposals': context.proposal_id,
            'rate_card_items': context.rate_card_item_id,
            'rate_cards': context.rate_card_id
        };

        let id = idMap[tableName];

        if (tableName === 'business_constitutions' && !id && context.business_profile_id) {
            if (!recordCache['business_profiles']) recordCache['business_profiles'] = await this._fetchContextRecord('business_profiles', context, recordCache);
            if (recordCache['business_profiles']) id = recordCache['business_profiles'].constitution_id;
        }

        if (tableName === 'business_sub_constitutions' && !id && context.business_profile_id) {
            if (!recordCache['business_profiles']) recordCache['business_profiles'] = await this._fetchContextRecord('business_profiles', context, recordCache);
            if (recordCache['business_profiles']) id = recordCache['business_profiles'].sub_constitution_id;
        }

        if (!id) return null;

        const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
        if (error) return null;
        return data;
    }

    async checkApplicability(governmentFeeIds, context, manualValues, asOfDate) {
        let feesQuery = supabase.from('government_fee_library').select('*');
        if (governmentFeeIds && Array.isArray(governmentFeeIds) && governmentFeeIds.length > 0) {
            feesQuery = feesQuery.in('id', governmentFeeIds);
        }

        let todayStr = asOfDate;
        if (!todayStr) {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            todayStr = `${year}-${month}-${day}`;
        }

        const { data: fees, error: feesError } = await feesQuery;
        if (feesError) throw new Error("Error loading government fees: " + feesError.message);

        let conditionsQuery = supabase.from('government_fee_applicability_conditions').select('*').eq('status', 'active');
        if (governmentFeeIds && Array.isArray(governmentFeeIds) && governmentFeeIds.length > 0) {
            conditionsQuery = conditionsQuery.in('government_fee_id', governmentFeeIds);
        }
        const { data: conditions, error: conditionsError } = await conditionsQuery;
        if (conditionsError) throw new Error("Error loading applicability conditions: " + conditionsError.message);

        const conditionsByFee = {};
        for (const c of conditions) {
            if (!conditionsByFee[c.government_fee_id]) conditionsByFee[c.government_fee_id] = [];
            conditionsByFee[c.government_fee_id].push(c);
        }

        let rulesQuery = supabase.from('government_fee_calculation_rules')
            .select('*, slabs:government_fee_rule_slabs(*), delay_slabs:government_fee_late_fee_slabs(*)')
            .eq('status', 'active');
        if (governmentFeeIds && Array.isArray(governmentFeeIds) && governmentFeeIds.length > 0) {
            rulesQuery = rulesQuery.in('government_fee_id', governmentFeeIds);
        }
        const { data: rules, error: rulesError } = await rulesQuery;
        if (rulesError) throw new Error("Error loading rules: " + rulesError.message);

        const rulesByFee = {};
        for (const r of rules) {
            if (!rulesByFee[r.government_fee_id]) rulesByFee[r.government_fee_id] = [];
            rulesByFee[r.government_fee_id].push(r);
        }

        const recordCache = {};
        const { data: mappingsData, error: mappingsError } = await supabase.from('government_fee_source_mappings').select('*').eq('is_active', true);
        if (mappingsError) throw new Error("Error loading source mappings: " + mappingsError.message);
        
        const mappingsMap = {};
        for (const m of mappingsData) mappingsMap[m.id] = m;

        const applicableFees = [];
        const rejectedFees = [];
        let totalGovernmentFee = 0;
        const missingValuesRequiredMap = new Map();
        const resolvedValues = {};

        const resolveMappingValue = async (mapping_id) => {
            const mapping = mappingsMap[mapping_id];
            if (!mapping) return { mapping: null, value: undefined };
            const { source_table, source_column, source_json_path, display_name } = mapping;
            let actualValue = manualValues[mapping_id];
            if (actualValue === undefined || actualValue === null) {
                if (!recordCache[source_table]) recordCache[source_table] = await this._fetchContextRecord(source_table, context, recordCache);
                const dbRecord = recordCache[source_table];
                if (dbRecord) {
                    actualValue = dbRecord[source_column];
                    if (actualValue === undefined && dbRecord.fields && typeof dbRecord.fields === 'object') {
                        actualValue = dbRecord.fields[source_column];
                        if (actualValue === undefined && source_column === 'state') actualValue = dbRecord.fields['state__province'];
                        if (actualValue === undefined && source_column === 'city') actualValue = dbRecord.fields['city__town__village'];
                        if (actualValue === undefined && source_column === 'address') actualValue = dbRecord.fields['street__area'];
                    }
                    if (source_json_path && actualValue && typeof actualValue === 'object') {
                        actualValue = this._resolveJsonPath(actualValue, source_json_path);
                    }
                }
            }
            if (actualValue !== undefined && actualValue !== null && actualValue !== '') resolvedValues[display_name] = actualValue;
            return { mapping, value: actualValue };
        };

        const registerMissingValue = (mapping, purpose) => {
            if (!mapping) return;
            missingValuesRequiredMap.set(mapping.id, {
                mapping_id: mapping.id,
                display_name: mapping.display_name,
                data_type: mapping.data_type || 'text',
                required_for: purpose || 'Government Fee Calculation'
            });
        };

        for (const fee of fees) {
            let isApplicable = true;
            let rejectionReason = null;

            const effectiveFrom = fee.effective_from ? fee.effective_from.toString().slice(0, 10) : null;
            const effectiveTo = fee.effective_to ? fee.effective_to.toString().slice(0, 10) : null;

            if (fee.status !== 'active') {
                isApplicable = false;
                rejectionReason = "Fee is inactive.";
            } else if (effectiveFrom && effectiveFrom > todayStr) {
                isApplicable = false;
                rejectionReason = `Fee is not yet effective.`;
            } else if (effectiveTo && effectiveTo < todayStr) {
                isApplicable = false;
                rejectionReason = `Fee has expired.`;
            }

            const feeConditions = conditionsByFee[fee.id] || [];
            
            if (isApplicable && feeConditions.length > 0) {
                const conditionGroups = { AND: [], OR: [] };
                for (const condition of feeConditions) {
                    const grp = condition.condition_group === 'OR' ? 'OR' : 'AND';
                    conditionGroups[grp].push(condition);
                }

                let allAndPassed = true;
                let anyOrPassed = false;
                let hasRequiredFailure = false;

                const evalCondition = async (condition) => {
                    const { mapping, value } = await resolveMappingValue(condition.mapping_id);
                    if (!mapping) return false;
                    if (value === undefined || value === null || value === '') {
                        if (condition.is_required) {
                            registerMissingValue(mapping, `Condition for ${fee.fee_name}`);
                            hasRequiredFailure = true;
                        }
                        return false;
                    }
                    return this._evaluateCondition(value, condition.operator, condition.compare_value, condition.min_value, condition.max_value, condition.min_date, condition.max_date);
                };

                for (const condition of conditionGroups.AND) {
                    const passed = await evalCondition(condition);
                    if (!passed) { allAndPassed = false; }
                }

                if (conditionGroups.OR.length > 0) {
                    for (const condition of conditionGroups.OR) {
                        const passed = await evalCondition(condition);
                        if (passed) anyOrPassed = true;
                    }
                } else {
                    anyOrPassed = true; // No OR conditions present
                }

                if (!allAndPassed || !anyOrPassed || hasRequiredFailure) {
                    isApplicable = false;
                    rejectionReason = "Applicability conditions not met or missing values.";
                }
            }

            if (isApplicable) {
                const feeRules = rulesByFee[fee.id] || [];
                const matchedLines = [];
                
                if (feeRules.length === 0) {
                    // Fallback to legacy amount
                    matchedLines.push({
                        condition_label: 'Base Fee',
                        amount: parseFloat(fee.amount || 0),
                        explanation: `Fixed Amount: ${fee.amount || 0}`
                    });
                } else {
                    for (const rule of feeRules) {
                        let amount = 0;
                        let explanation = '';
                        let missingData = false;

                        if (rule.calculation_type === 'fixed') {
                            amount = parseFloat(rule.fee_amount || 0);
                            explanation = `Fixed Amount = ₹${amount}`;
                        } else if (rule.calculation_type === 'percentage') {
                            const { mapping, value } = await resolveMappingValue(rule.calculation_base_mapping_id);
                            if (value === undefined || value === null || value === '') {
                                registerMissingValue(mapping, `Percentage Base for ${fee.fee_name}`);
                                missingData = true;
                            } else {
                                const baseVal = parseFloat(value);
                                const rate = parseFloat(rule.percentage_rate || 0);
                                amount = baseVal * (rate / 100);
                                explanation = `${rate}% of ${mapping.display_name} ₹${baseVal} = ₹${amount.toFixed(2)}`;
                                
                                if (rule.minimum_fee !== null && amount < rule.minimum_fee) {
                                    amount = rule.minimum_fee;
                                    explanation += ` (raised to min ₹${rule.minimum_fee})`;
                                }
                                if (rule.maximum_fee !== null && amount > rule.maximum_fee) {
                                    amount = rule.maximum_fee;
                                    explanation += ` (capped at max ₹${rule.maximum_fee})`;
                                }
                            }
                        } else if (rule.calculation_type === 'slab_based') {
                            const { mapping, value } = await resolveMappingValue(rule.slab_base_mapping_id);
                            if (value === undefined || value === null || value === '') {
                                registerMissingValue(mapping, `Slab Base for ${fee.fee_name}`);
                                missingData = true;
                            } else {
                                const baseVal = parseFloat(value);
                                const slabs = rule.slabs || [];
                                const matchedSlab = slabs.find(s => {
                                    const min = s.min_value !== null ? parseFloat(s.min_value) : -Infinity;
                                    const max = s.max_value !== null ? parseFloat(s.max_value) : Infinity;
                                    return baseVal >= min && baseVal <= max;
                                });
                                
                                if (matchedSlab) {
                                    if (matchedSlab.fee_type === 'percentage') {
                                        const rate = parseFloat(matchedSlab.percentage_rate || 0);
                                        amount = baseVal * (rate / 100);
                                        explanation = `${mapping.display_name} ₹${baseVal} matched slab (${matchedSlab.min_value || 0} to ${matchedSlab.max_value || '...'}) -> ${rate}% = ₹${amount.toFixed(2)}`;
                                        if (matchedSlab.minimum_fee !== null && amount < matchedSlab.minimum_fee) {
                                            amount = matchedSlab.minimum_fee;
                                            explanation += ` (min ₹${matchedSlab.minimum_fee})`;
                                        }
                                        if (matchedSlab.maximum_fee !== null && amount > matchedSlab.maximum_fee) {
                                            amount = matchedSlab.maximum_fee;
                                            explanation += ` (max ₹${matchedSlab.maximum_fee})`;
                                        }
                                    } else {
                                        amount = parseFloat(matchedSlab.amount || 0);
                                        explanation = `${mapping.display_name} ₹${baseVal} matched slab (${matchedSlab.min_value || 0} to ${matchedSlab.max_value || '...'}) -> Fixed = ₹${amount}`;
                                    }
                                } else {
                                    explanation = `No matching slab found for ${mapping.display_name} ₹${baseVal}`;
                                }
                            }
                        } else if (rule.calculation_type === 'late_fee') {
                            const { mapping: dueMapping, value: dueVal } = await resolveMappingValue(rule.due_date_mapping_id);
                            const { mapping: actualMapping, value: actualVal } = await resolveMappingValue(rule.actual_date_mapping_id);
                            if (!dueVal) registerMissingValue(dueMapping, `Due Date for ${fee.fee_name}`);
                            if (!actualVal) registerMissingValue(actualMapping, `Actual Date for ${fee.fee_name}`);
                            
                            if (dueVal && actualVal) {
                                const due = new Date(dueVal);
                                const actual = new Date(actualVal);
                                const delayDays = Math.floor((actual - due) / (1000 * 60 * 60 * 24)) - (rule.grace_period_days || 0);
                                
                                if (delayDays > 0) {
                                    if (rule.late_fee_method === 'fixed_once') {
                                        amount = parseFloat(rule.fixed_amount || 0);
                                        explanation = `Late Fee: Delay ${delayDays} days -> Fixed = ₹${amount}`;
                                    } else if (rule.late_fee_method === 'per_day') {
                                        const perDay = parseFloat(rule.per_day_amount || 0);
                                        amount = delayDays * perDay;
                                        explanation = `Late Fee: Delay ${delayDays} days × ₹${perDay}/day = ₹${amount}`;
                                    } else if (rule.late_fee_method === 'slab_based_delay') {
                                        const slabs = rule.delay_slabs || [];
                                        const matchedSlab = slabs.find(s => {
                                            const max = s.max_days !== null ? parseInt(s.max_days) : Infinity;
                                            return delayDays >= s.min_days && delayDays <= max;
                                        });
                                        if (matchedSlab) {
                                            amount = parseFloat(matchedSlab.amount || 0);
                                            explanation = `Late Fee: Delay ${delayDays} days matched slab -> ₹${amount}`;
                                        } else {
                                            explanation = `Late Fee: No matching delay slab for ${delayDays} days`;
                                        }
                                    }
                                } else {
                                    explanation = `Late Fee: Filed on time (Delay <= Grace Period)`;
                                }
                            } else {
                                missingData = true;
                            }
                        } else if (rule.calculation_type === 'formula') {
                            if (rule.formula_expression) {
                                let expr = rule.formula_expression;
                                let formulaMissingData = false;
                                
                                // Find all bracketed variables e.g. [Authorized Capital]
                                const varRegex = /\[([^\]]+)\]/g;
                                let match;
                                const varsToInject = {};
                                
                                while ((match = varRegex.exec(expr)) !== null) {
                                    const varName = match[1];
                                    const mapping = Object.values(mappingsMap).find(m => m.display_name === varName);
                                    if (mapping) {
                                        const { value } = await resolveMappingValue(mapping.id);
                                        if (value === undefined || value === null || value === '') {
                                            registerMissingValue(mapping, `Formula variable for ${fee.fee_name}`);
                                            formulaMissingData = true;
                                        } else {
                                            varsToInject[varName] = parseFloat(value) || 0;
                                        }
                                    }
                                }
                                
                                if (!formulaMissingData) {
                                    // Replace variables in expression
                                    for (const [vName, vVal] of Object.entries(varsToInject)) {
                                        expr = expr.split(`[${vName}]`).join(vVal);
                                    }
                                    
                                    try {
                                        amount = math.evaluate(expr);
                                        explanation = `Formula [${rule.formula_expression}] evaluated to ₹${amount.toFixed(2)}`;
                                    } catch (e) {
                                        console.error("Mathjs evaluation error:", e);
                                        explanation = `Formula error: ${e.message}`;
                                    }
                                } else {
                                    missingData = true;
                                }
                            }
                        }

                        if (!missingData && amount > 0) {
                            if (rule.maximum_late_fee !== null && rule.calculation_type === 'late_fee' && amount > rule.maximum_late_fee) {
                                amount = rule.maximum_late_fee;
                                explanation += ` (Max Late Fee Capped at ₹${amount})`;
                            }
                            
                            matchedLines.push({
                                calculation_rule_id: rule.id,
                                amount: amount,
                                explanation: explanation
                            });
                        }
                    }
                }

                if (matchedLines.length > 0) {
                    for (const line of matchedLines) {
                        applicableFees.push({
                            id: fee.id,
                            fee_name: `${fee.fee_name} - ${line.explanation}`,
                            amount: line.amount,
                            applicability_status: 'applicable',
                            matched_conditions: []
                        });
                        totalGovernmentFee += line.amount;
                    }
                } else if (feeRules.length === 0) {
                    rejectedFees.push({ id: fee.id, fee_name: fee.fee_name, reason: "Calculated amount is 0 or missing data." });
                }
            } else {
                rejectedFees.push({ id: fee.id, fee_name: fee.fee_name, reason: rejectionReason });
            }
        }

        const missingValuesArray = Array.from(missingValuesRequiredMap.values());

        return {
            applicableFees,
            rejectedFees,
            totalGovernmentFee,
            missingValuesRequired: missingValuesArray,
            resolvedValues
        };
    }

    async getSuggestions(context, manualValues = {}, asOfDate = new Date()) {
        // Pass null for governmentFeeIds to evaluate against all active fees in the library
        return this.checkApplicability(null, context, manualValues, asOfDate);
    }
}

module.exports = new GovernmentFeeApplicabilityService();
