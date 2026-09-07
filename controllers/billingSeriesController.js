const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MASTER_CATEGORY_NAME = 'Billing Number Series';

// Helper: Ensure category exists and get category ID
async function getSeriesCategoryId() {
    let { data: cat } = await supabase
        .from('app_master_categories')
        .select('id')
        .eq('name', MASTER_CATEGORY_NAME)
        .maybeSingle();

    if (!cat) {
        const { data: newCat, error } = await supabase
            .from('app_master_categories')
            .insert({
                name: MASTER_CATEGORY_NAME,
                description: 'Configuration for Billing Number Series rules, sequences and formats'
            })
            .select('id')
            .single();
        if (error) throw error;
        cat = newCat;
    }
    return cat.id;
}

// Helper: Parse series from database row
function parseSeriesRow(row) {
    let meta = {};
    if (typeof row.description === 'string' && row.description.trim().startsWith('{')) {
        try {
            meta = JSON.parse(row.description);
        } catch (e) {
            console.error('Failed to parse series JSON description:', e);
        }
    } else if (typeof row.description === 'object' && row.description !== null) {
        meta = row.description;
    }

    const startingNumber = Number(meta.starting_number || row.starting_number || 1);
    const currentNumber = Number(meta.current_number !== undefined ? meta.current_number : (row.current_number !== undefined ? row.current_number : startingNumber - 1));
    const numberLength = Number(meta.number_length || row.number_length || 6);
    const prefix = meta.prefix !== undefined ? meta.prefix : (row.prefix || '');
    const suffix = meta.suffix !== undefined ? meta.suffix : (row.suffix || '');

    const businessProfileId = meta.business_profile_id || row.business_profile_id || null;
    const clientId = meta.client_id || row.client_id || null;
    const workId = meta.work_id || row.work_id || null;
    const constitutionId = meta.constitution_id || row.constitution_id || null;

    let specificity = 0;
    if (businessProfileId) specificity++;
    if (clientId) specificity++;
    if (workId) specificity++;
    if (constitutionId) specificity++;

    const nextSeq = Math.max(startingNumber, currentNumber + 1);
    const nextNumberPreview = `${prefix}${String(nextSeq).padStart(numberLength, '0')}${suffix}`;
    const formatPreview = `${prefix}${String(startingNumber).padStart(numberLength, '0')}${suffix}`;

    return {
        id: row.id,
        name: row.name,
        business_profile_id: businessProfileId,
        client_id: clientId,
        work_id: workId,
        constitution_id: constitutionId,
        prefix,
        starting_number: startingNumber,
        current_number: currentNumber,
        number_length: numberLength,
        suffix,
        is_active: row.is_active !== false,
        specificity,
        next_number_preview: nextNumberPreview,
        format_preview: formatPreview,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

// -------------------------------------------------------------
// GET /api/billing/series
// -------------------------------------------------------------
exports.listSeries = async (req, res) => {
    try {
        const categoryId = await getSeriesCategoryId();

        const [seriesRes, profilesRes, clientsRes, tasksRes, constRes, invoicesRes] = await Promise.all([
            supabase.from('app_master_values').select('*').eq('category_id', categoryId).order('created_at', { ascending: false }),
            supabase.from('business_profiles').select('id, profile_name'),
            supabase.from('clients').select('id, client_name'),
            supabase.from('tasks').select('id, title'),
            supabase.from('business_constitutions').select('id, name'),
            supabase.from('billing_invoices').select('id, internal_bill_no, tax_invoice_no')
        ]);

        if (seriesRes.error) throw seriesRes.error;

        const profilesMap = new Map((profilesRes.data || []).map(p => [p.id, p.profile_name || 'Unnamed Profile']));
        const clientsMap = new Map((clientsRes.data || []).map(c => [c.id, c.client_name || 'Unnamed Client']));
        const tasksMap = new Map((tasksRes.data || []).map(t => [t.id, t.title || 'Unnamed Work']));
        const constMap = new Map((constRes.data || []).map(c => [c.id, c.name || 'Unnamed Constitution']));

        const invoicesList = invoicesRes.data || [];

        const seriesList = (seriesRes.data || []).map(row => {
            const parsed = parseSeriesRow(row);

            // Compute usage count
            let usageCount = 0;
            if (invoicesList.length > 0) {
                const pfx = parsed.prefix;
                const sfx = parsed.suffix;
                usageCount = invoicesList.filter(inv => {
                    const no = inv.tax_invoice_no || inv.internal_bill_no || '';
                    if (!no) return false;
                    if (pfx && !no.startsWith(pfx)) return false;
                    if (sfx && !no.endsWith(sfx)) return false;
                    return true;
                }).length;
            }

            return {
                ...parsed,
                usage_count: usageCount,
                profile_name: parsed.business_profile_id ? (profilesMap.get(parsed.business_profile_id) || 'Unknown Profile') : null,
                client_name: parsed.client_id ? (clientsMap.get(parsed.client_id) || 'Unknown Client') : null,
                work_title: parsed.work_id ? (tasksMap.get(parsed.work_id) || 'Unknown Work') : null,
                constitution_name: parsed.constitution_id ? (constMap.get(parsed.constitution_id) || 'Unknown Constitution') : null
            };
        });

        res.json({ success: true, data: seriesList });
    } catch (error) {
        console.error('Error listing billing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// -------------------------------------------------------------
// POST /api/billing/series
// -------------------------------------------------------------
exports.createSeries = async (req, res) => {
    try {
        const {
            name,
            business_profile_id,
            client_id,
            work_id,
            constitution_id,
            prefix = '',
            starting_number = 1,
            number_length = 6,
            suffix = '',
            is_active = true
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Series Name is required.' });
        }

        const bpId = business_profile_id?.trim() || null;
        const cId = client_id?.trim() || null;
        const wId = work_id?.trim() || null;
        const constId = constitution_id?.trim() || null;

        // Mandatory matching validation: At least ONE must be configured
        if (!bpId && !cId && !wId && !constId) {
            return res.status(400).json({
                success: false,
                message: 'Select at least one of Business Profile, Client, Work or Constitution.'
            });
        }

        const startNum = parseInt(starting_number, 10);
        if (isNaN(startNum) || startNum < 1) {
            return res.status(400).json({ success: false, message: 'Starting Number must be a positive integer >= 1.' });
        }

        const numLen = parseInt(number_length, 10);
        if (isNaN(numLen) || numLen < 1) {
            return res.status(400).json({ success: false, message: 'Number Length must be a positive integer >= 1.' });
        }

        const startDigits = String(startNum).length;
        if (numLen < startDigits) {
            return res.status(400).json({
                success: false,
                message: `Number Length (${numLen}) cannot be smaller than the number of digits in Starting Number (${startDigits}).`
            });
        }

        const categoryId = await getSeriesCategoryId();

        // Initial current_number = starting_number - 1 (meaning 0 numbers allocated yet)
        const currentNumber = startNum - 1;

        const metaPayload = {
            business_profile_id: bpId,
            client_id: cId,
            work_id: wId,
            constitution_id: constId,
            prefix: prefix.trim(),
            starting_number: startNum,
            current_number: currentNumber,
            number_length: numLen,
            suffix: suffix.trim(),
            is_active: Boolean(is_active)
        };

        const { data: inserted, error: insErr } = await supabase
            .from('app_master_values')
            .insert({
                category_id: categoryId,
                name: name.trim(),
                description: JSON.stringify(metaPayload),
                is_active: Boolean(is_active),
                order: 1
            })
            .select()
            .single();

        if (insErr) throw insErr;

        res.status(201).json({
            success: true,
            message: 'Billing Number Series created successfully.',
            data: parseSeriesRow(inserted)
        });
    } catch (error) {
        console.error('Error creating billing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// -------------------------------------------------------------
// PUT /api/billing/series/:id
// -------------------------------------------------------------
exports.updateSeries = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            business_profile_id,
            client_id,
            work_id,
            constitution_id,
            prefix,
            starting_number,
            number_length,
            suffix,
            is_active
        } = req.body;

        const { data: existing, error: fetchErr } = await supabase
            .from('app_master_values')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return res.status(404).json({ success: false, message: 'Billing Number Series not found.' });
        }

        const currentParsed = parseSeriesRow(existing);

        // Check usage count
        const { data: invoices } = await supabase
            .from('billing_invoices')
            .select('internal_bill_no, tax_invoice_no');
        
        let usageCount = 0;
        if (invoices && invoices.length > 0) {
            const pfx = currentParsed.prefix;
            const sfx = currentParsed.suffix;
            usageCount = invoices.filter(inv => {
                const no = inv.tax_invoice_no || inv.internal_bill_no || '';
                if (!no) return false;
                if (pfx && !no.startsWith(pfx)) return false;
                if (sfx && !no.endsWith(sfx)) return false;
                return true;
            }).length;
        }

        const isUsed = usageCount > 0;

        const bpId = business_profile_id !== undefined ? (business_profile_id?.trim() || null) : currentParsed.business_profile_id;
        const cId = client_id !== undefined ? (client_id?.trim() || null) : currentParsed.client_id;
        const wId = work_id !== undefined ? (work_id?.trim() || null) : currentParsed.work_id;
        const constId = constitution_id !== undefined ? (constitution_id?.trim() || null) : currentParsed.constitution_id;

        if (!bpId && !cId && !wId && !constId) {
            return res.status(400).json({
                success: false,
                message: 'Select at least one of Business Profile, Client, Work or Constitution.'
            });
        }

        let newPrefix = currentParsed.prefix;
        let newStartNum = currentParsed.starting_number;
        let newNumLen = currentParsed.number_length;
        let newSuffix = currentParsed.suffix;
        let newCurrentNum = currentParsed.current_number;

        if (isUsed) {
            // Edit protection: Structure cannot change once used
            if (
                (prefix !== undefined && prefix.trim() !== currentParsed.prefix) ||
                (starting_number !== undefined && parseInt(starting_number, 10) !== currentParsed.starting_number) ||
                (number_length !== undefined && parseInt(number_length, 10) !== currentParsed.number_length) ||
                (suffix !== undefined && suffix.trim() !== currentParsed.suffix)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Numbering structure (Prefix, Starting Number, Length, Suffix) cannot be changed on a used series. Please create a new series and deactivate this one.'
                });
            }
        } else {
            if (prefix !== undefined) newPrefix = prefix.trim();
            if (suffix !== undefined) newSuffix = suffix.trim();
            if (starting_number !== undefined) {
                const sNum = parseInt(starting_number, 10);
                if (isNaN(sNum) || sNum < 1) {
                    return res.status(400).json({ success: false, message: 'Starting Number must be >= 1.' });
                }
                newStartNum = sNum;
                newCurrentNum = sNum - 1;
            }
            if (number_length !== undefined) {
                const nLen = parseInt(number_length, 10);
                if (isNaN(nLen) || nLen < 1) {
                    return res.status(400).json({ success: false, message: 'Number Length must be >= 1.' });
                }
                newNumLen = nLen;
            }

            const startDigits = String(newStartNum).length;
            if (newNumLen < startDigits) {
                return res.status(400).json({
                    success: false,
                    message: `Number Length (${newNumLen}) cannot be smaller than the number of digits in Starting Number (${startDigits}).`
                });
            }
        }

        const newName = name !== undefined ? name.trim() : existing.name;
        const newIsActive = is_active !== undefined ? Boolean(is_active) : existing.is_active;

        const updatedMeta = {
            business_profile_id: bpId,
            client_id: cId,
            work_id: wId,
            constitution_id: constId,
            prefix: newPrefix,
            starting_number: newStartNum,
            current_number: newCurrentNum,
            number_length: newNumLen,
            suffix: newSuffix,
            is_active: newIsActive
        };

        const { data: updated, error: updErr } = await supabase
            .from('app_master_values')
            .update({
                name: newName,
                description: JSON.stringify(updatedMeta),
                is_active: newIsActive,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();

        if (updErr) throw updErr;

        res.json({
            success: true,
            message: 'Billing Number Series updated successfully.',
            data: parseSeriesRow(updated)
        });
    } catch (error) {
        console.error('Error updating billing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// -------------------------------------------------------------
// DELETE /api/billing/series/:id
// -------------------------------------------------------------
exports.deleteSeries = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: existing, error: fetchErr } = await supabase
            .from('app_master_values')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !existing) {
            return res.status(404).json({ success: false, message: 'Billing Number Series not found.' });
        }

        const currentParsed = parseSeriesRow(existing);

        const { data: invoices } = await supabase
            .from('billing_invoices')
            .select('internal_bill_no, tax_invoice_no');
        
        let usageCount = 0;
        if (invoices && invoices.length > 0) {
            const pfx = currentParsed.prefix;
            const sfx = currentParsed.suffix;
            usageCount = invoices.filter(inv => {
                const no = inv.tax_invoice_no || inv.internal_bill_no || '';
                if (!no) return false;
                if (pfx && !no.startsWith(pfx)) return false;
                if (sfx && !no.endsWith(sfx)) return false;
                return true;
            }).length;
        }

        if (usageCount > 0) {
            // Cannot delete used series — only deactivate allowed
            return res.status(400).json({
                success: false,
                is_used: true,
                message: 'This number series has already been used and cannot be deleted. You can deactivate it instead.'
            });
        }

        const { error: delErr } = await supabase
            .from('app_master_values')
            .delete()
            .eq('id', id);

        if (delErr) throw delErr;

        res.json({ success: true, message: 'Billing Number Series deleted successfully.' });
    } catch (error) {
        console.error('Error deleting billing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// -------------------------------------------------------------
// POST /api/billing/series/resolve (Preview only — does NOT increment)
// -------------------------------------------------------------
exports.resolveSeries = async (req, res) => {
    try {
        const { business_profile_id, client_id, work_id, constitution_id } = req.body;

        const result = await exports.resolveMatchingSeries({
            business_profile_id,
            client_id,
            work_id,
            constitution_id
        });

        if (result.ambiguous) {
            return res.status(409).json({
                success: false,
                ambiguous: true,
                message: result.message,
                conflicting_series: result.conflicting_series
            });
        }

        if (!result.matched) {
            return res.status(200).json({
                success: true,
                matched: false,
                message: 'No active Billing Number Series matches the provided billing criteria.'
            });
        }

        res.json({
            success: true,
            matched: true,
            series_id: result.series.id,
            name: result.series.name,
            specificity: result.series.specificity,
            next_number_preview: result.next_number_preview,
            format_preview: result.series.format_preview,
            series: result.series
        });
    } catch (error) {
        console.error('Error resolving billing series:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// -------------------------------------------------------------
// Internal Helper: Match & Specificity Resolution
// -------------------------------------------------------------
exports.resolveMatchingSeries = async (context = {}) => {
    const { business_profile_id, client_id, work_id, constitution_id } = context;

    const categoryId = await getSeriesCategoryId();
    const { data: rows, error } = await supabase
        .from('app_master_values')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true);

    if (error) throw error;
    if (!rows || rows.length === 0) {
        return { matched: false };
    }

    const allSeries = rows.map(parseSeriesRow);

    // Filter by matching criteria: Every non-empty criteria on the series must match the bill
    const matching = allSeries.filter(series => {
        if (!series.is_active) return false;

        if (series.business_profile_id && String(series.business_profile_id) !== String(business_profile_id || '')) {
            return false;
        }
        if (series.client_id && String(series.client_id) !== String(client_id || '')) {
            return false;
        }
        if (series.work_id && String(series.work_id) !== String(work_id || '')) {
            return false;
        }
        if (series.constitution_id && String(series.constitution_id) !== String(constitution_id || '')) {
            return false;
        }

        return true;
    });

    if (matching.length === 0) {
        return { matched: false };
    }

    // Sort descending by specificity
    matching.sort((a, b) => b.specificity - a.specificity);

    const highestSpecificity = matching[0].specificity;
    const topMatches = matching.filter(s => s.specificity === highestSpecificity);

    // Ambiguity Protection: If 2 or more series match with the same highest specificity, block!
    if (topMatches.length > 1) {
        return {
            matched: false,
            ambiguous: true,
            message: 'Billing Number Series Conflict: More than one active number series matches this bill with equal priority. Please update the Billing Number Series configuration before issuing the invoice.',
            conflicting_series: topMatches.map(s => ({
                id: s.id,
                name: s.name,
                specificity: s.specificity
            }))
        };
    }

    const winner = topMatches[0];
    const nextSeq = Math.max(winner.starting_number, (winner.current_number || 0) + 1);
    const nextNumberPreview = `${winner.prefix}${String(nextSeq).padStart(winner.number_length, '0')}${winner.suffix}`;

    return {
        matched: true,
        ambiguous: false,
        series: winner,
        next_number_preview: nextNumberPreview
    };
};

// -------------------------------------------------------------
// Internal Helper: Atomically allocate next number during issuance
// -------------------------------------------------------------
exports.allocateNextNumber = async (context = {}) => {
    const resolution = await exports.resolveMatchingSeries(context);

    if (resolution.ambiguous) {
        throw new Error(resolution.message);
    }

    if (!resolution.matched || !resolution.series) {
        return null; // Will fallback to default generation
    }

    const series = resolution.series;
    const nextSeq = Math.max(series.starting_number, (series.current_number || 0) + 1);
    const allocatedNumber = `${series.prefix}${String(nextSeq).padStart(series.number_length, '0')}${series.suffix}`;

    // Atomically persist incremented current_number
    const updatedMeta = {
        business_profile_id: series.business_profile_id,
        client_id: series.client_id,
        work_id: series.work_id,
        constitution_id: series.constitution_id,
        prefix: series.prefix,
        starting_number: series.starting_number,
        current_number: nextSeq,
        number_length: series.number_length,
        suffix: series.suffix,
        is_active: series.is_active
    };

    const { error: updErr } = await supabase
        .from('app_master_values')
        .update({
            description: JSON.stringify(updatedMeta),
            updated_at: new Date().toISOString()
        })
        .eq('id', series.id);

    if (updErr) throw updErr;

    return {
        billing_number: allocatedNumber,
        billing_number_series_id: series.id
    };
};
