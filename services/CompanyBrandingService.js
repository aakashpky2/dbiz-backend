const { supabase } = require('../lib/supabase');

class CompanyBrandingService {
    /**
     * Gets the company branding context.
     * Priority:
     * A. active profile branding (if businessProfileId is provided)
     * B. active global default
     * C. empty safe context
     * 
     * @param {string|null} businessProfileId 
     * @returns {Object}
     */
    static async getCompanyBrandingContext(businessProfileId = null) {
        let brandingData = null;

        try {
            // A. Try active profile branding
            if (businessProfileId) {
                const { data: profileBranding, error: profileError } = await supabase
                    .from('company_settings')
                    .select('*')
                    .eq('business_profile_id', businessProfileId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (!profileError && profileBranding) {
                    brandingData = profileBranding;
                } else if (profileError) {
                    console.error('[CompanyBrandingService] Profile branding fetch error:', profileError);
                }
            }

            // B. If not found, try active global default
            if (!brandingData) {
                const { data: globalBranding, error: globalError } = await supabase
                    .from('company_settings')
                    .select('*')
                    .is('business_profile_id', null)
                    .eq('is_default', true)
                    .eq('status', 'active')
                    .maybeSingle();

                if (!globalError && globalBranding) {
                    brandingData = globalBranding;
                } else if (globalError) {
                    console.error('[CompanyBrandingService] Global branding fetch error:', globalError);
                }
            }
        } catch (err) {
            console.error('[CompanyBrandingService] Exception caught:', err);
        }

        // C. Empty safe context fallback
        return {
            company_name: brandingData?.company_name || '',
            company_address: brandingData?.address || '',
            company_email: brandingData?.email || '',
            company_phone: brandingData?.phone || '',
            company_gstin: brandingData?.gstin || '',
            company_website: brandingData?.website || '',
            company_logo: brandingData?.logo_url || '',
            company_seal: brandingData?.seal_url || '',
            company_signature: brandingData?.signature_url || ''
        };
    }
}

module.exports = CompanyBrandingService;
