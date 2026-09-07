const { supabase } = require('../lib/supabase');
const ProposalCalculationService = require('./ProposalCalculationService');

class ProposalTemplateContextService {
    static async buildProposalTemplateContext(proposalId) {
        // 1. Safe base query
        const { data: proposal, error } = await supabase
            .from('proposals')
            .select('*')
            .eq('id', proposalId)
            .maybeSingle();

        if (error || !proposal) {
            throw new Error(`Failed to load proposal details: ${error ? error.message : 'Not found'}`);
        }

        // 2. Safely fetch related data
        let client = null;
        if (proposal.client_id) {
            const { data: clientData } = await supabase.from('clients').select('*').eq('id', proposal.client_id).maybeSingle();
            client = clientData;
        }

        let businessProfile = null;
        if (proposal.profile_id || proposal.business_profile_id) {
            const profileId = proposal.profile_id || proposal.business_profile_id;
            const { data: profileData } = await supabase.from('business_profiles').select('*').eq('id', profileId).maybeSingle();
            businessProfile = profileData;
        }

        let branchName = proposal.branch_name || '';
        if (proposal.branch_id && !branchName) {
            const { data: branchData } = await supabase.from('branches').select('name').eq('id', proposal.branch_id).maybeSingle();
            if (branchData) branchName = branchData.name;
        }

        // 3. Fallbacks
        const client_name = proposal.client_name || client?.name || 'Client';
        const client_email = client?.email || proposal.email || '';
        const client_phone = client?.phone || proposal.phone || '';
        const client_gstin = client?.gstin || '';
        const client_address = client?.address || '';

        const business_profile_name = businessProfile?.name || proposal.business_profile_name || '';

        // 4. Proposed Work Handling
        let proposedWork = proposal.proposed_work || [];
        if (typeof proposedWork === 'string') {
            try { proposedWork = JSON.parse(proposedWork); } catch { proposedWork = []; }
        }
        if (!Array.isArray(proposedWork)) proposedWork = [];

        // 5. Calculate totals and format proposedWork items safely
        let totalProfFee = 0;
        let totalGovtFee = 0;

        const formattedServices = proposedWork.map(item => {
            const professionalFee = Number(item.professional_fee || item.professionalFee || item.service_fee || item.fee || item.amount || item.rate || 0);
            const governmentFee = Number(item.government_fee || item.governmentFee || item.government_fee_total || item.govt_fee || item.govtFee || 0);
            const serviceName = item.work_type_name || item.workTypeName || item.service_name || item.name || item.work_name || 'Service';
            
            totalProfFee += professionalFee;
            totalGovtFee += governmentFee;

            return {
                ...item,
                serviceName,
                professionalFee,
                governmentFee,
                itemTotal: professionalFee + governmentFee,
                governmentFeeBreakup: Array.isArray(item.governmentFeeBreakup) ? item.governmentFeeBreakup : (Array.isArray(item.governmentFeeItems) ? item.governmentFeeItems : [])
            };
        });

        const gstPercentage = Number(proposal.gstPercentage || proposal.gst_percentage || 18);
        const totalGst = (totalProfFee * gstPercentage) / 100;
        const finalTotal = totalProfFee + totalGovtFee + totalGst;

        // Fetch company branding based on business profile id
        const businessProfileId = proposal.businessProfileId || proposal.business_profile_id || proposal.profile_id || null;
        const CompanyBrandingService = require('./CompanyBrandingService');
        const brandingContext = await CompanyBrandingService.getCompanyBrandingContext(businessProfileId);

        const baseContext = {
            ...proposal,
            
            // Inject dynamic branding
            ...brandingContext,
            
            proposal_no: proposal.proposal_number || (proposal.id ? `PRP-${proposal.id.substring(0, 6).toUpperCase()}` : 'DRAFT'),
            proposal_date: proposal.created_at ? new Date(proposal.created_at).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN'),
            valid_until: proposal.valid_until || proposal.validity || '',
            branch_name: branchName,

            client_name,
            client_email,
            client_phone,
            client_gstin,
            client_address,
            business_profile_name,

            professional_fee: totalProfFee,
            government_fee: totalGovtFee,
            gst_percentage: gstPercentage,
            gst_amount: totalGst,
            total_amount: finalTotal,

            services: formattedServices,
            government_fee_breakup: proposal.governmentFeeItems || (proposal.governmentFee ? [{ description: 'Government Fee', feeAmount: proposal.governmentFee }] : [])
        };

        const formatCurrency = (val) => {
            const num = Number(val);
            if (isNaN(num)) return '₹0.00';
            return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        // 6. Build work_table using actual items
        let workTableHtml = '';
        if (formattedServices.length === 0) {
            workTableHtml = '<div style="padding: 20px; background: #f8fafc; border: 1px solid #e5e7eb; text-align: center; color: #64748b; font-size: 14px;">No services added</div>';
        } else {
            workTableHtml = `
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; margin-top: 10px;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="border:1px solid #e5e7eb; padding:8px; text-align:left; color: #475569; font-size: 12px; text-transform: uppercase;">Service</th>
                            <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; color: #475569; font-size: 12px; text-transform: uppercase;">Professional Fee</th>
                            <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; color: #475569; font-size: 12px; text-transform: uppercase;">Government Fee</th>
                            <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; color: #475569; font-size: 12px; text-transform: uppercase;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            formattedServices.forEach(s => {
                workTableHtml += `
                        <tr>
                            <td style="padding: 12px 8px; border: 1px solid #e5e7eb; vertical-align: top;">
                                <strong style="color: #1e293b; display: block; margin-bottom: 4px;">${s.serviceName}</strong>
                                ${s.governmentFeeBreakup && s.governmentFeeBreakup.length ? `
                                    <div style="margin-top: 8px; font-size: 12px; color: #64748b; background: #f8fafc; padding: 8px; border-radius: 4px; border: 1px solid #f1f5f9;">
                                        <div style="font-weight: bold; margin-bottom: 4px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">Govt Fee Breakdown:</div>
                                        ${s.governmentFeeBreakup.map(gf => `
                                            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                                                <span>${gf.name || gf.description || 'Fee'}</span>
                                                <span>${formatCurrency(gf.amount || gf.feeAmount || 0)}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </td>
                            <td style="text-align: right; padding: 12px 8px; border: 1px solid #e5e7eb; color: #334155; vertical-align: top;">${formatCurrency(s.professionalFee)}</td>
                            <td style="text-align: right; padding: 12px 8px; border: 1px solid #e5e7eb; color: #334155; vertical-align: top;">${formatCurrency(s.governmentFee)}</td>
                            <td style="text-align: right; padding: 12px 8px; border: 1px solid #e5e7eb; color: #0f172a; font-weight: bold; vertical-align: top;">${formatCurrency(s.itemTotal)}</td>
                        </tr>
                `;
            });

            workTableHtml += `
                    </tbody>
                </table>
            `;
        }

        baseContext.work_table = workTableHtml;
        
        // 7. Return renderContext even with missing values
        const filterContext = {
            branch_id: proposal.branchId || proposal.branch_id || null,
            branch_name: branchName || null,
            business_profile_id: proposal.businessProfileId || proposal.business_profile_id || null,
            business_profile_name: business_profile_name || null,
            client_id: proposal.clientId || proposal.client_id || null,
            client_name: client_name || null,
            client_type: proposal.clientType || proposal.client_type || null,
            constitution_id: proposal.constitutionId || proposal.constitution_id || null,
            constitution_name: proposal.constitution_name || null,
            sub_constitution_id: proposal.subConstitutionId || proposal.sub_constitution_id || null,
            sub_constitution_name: proposal.sub_constitution_name || null,
            work_type_ids: formattedServices.map(w => w.workTypeId || w.work_type_id).filter(Boolean),
            work_type_names: formattedServices.map(w => w.serviceName).filter(Boolean),
            department_ids: formattedServices.map(w => w.departmentId || w.department_id).filter(Boolean),
            category_ids: formattedServices.map(w => w.categoryId || w.category_id).filter(Boolean),
            total_amount: finalTotal,
            professional_fee: totalProfFee,
            government_fee: totalGovtFee,
            state: proposal.state || null,
            district: proposal.district || null
        };

        console.log('[BRANDING CONTEXT]', {
            company_logo: baseContext.company_logo,
            company_seal: baseContext.company_seal,
            company_signature: baseContext.company_signature
        });
        console.log("FINAL RENDER CONTEXT", baseContext);

        return {
            renderContext: baseContext,
            filterContext: filterContext
        };
    }
}

module.exports = ProposalTemplateContextService;
