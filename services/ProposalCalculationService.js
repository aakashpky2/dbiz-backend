/**
 * Service for centralizing financial calculations for Proposals.
 * This ensures consistency across Review screens, PDF Generation, and Emails.
 */

class ProposalCalculationService {
    /**
     * Calculate all financial totals for a given array of proposed work items.
     * @param {Array} items - Array of proposed work items from the proposal
     * @returns {Object} - Subtotals, taxes, discounts, and final totals
     */
    static calculateProposalFinancials(items = []) {
        let profSubtotal = 0;
        let govtSubtotal = 0;
        let totalGst = 0;
        let totalDiscount = 0;

        items.forEach((item) => {
            const pFee = Number(item.professionalFee) || Number(item.professional_fee) || 0;
            const gFee = Number(item.governmentFee) || Number(item.government_fee) || 0;
            
            profSubtotal += pFee;
            govtSubtotal += gFee;

            // Calculate GST
            let itemGst = 0;
            if (item.isGstApplicable && !item.noInvoice) {
                const rate = (Number(item.gstPercentage) || Number(item.gst_percentage) || 18) / 100;
                const on = item.gstAppliedOn || item.gst_applied_on || 'professional';
                if (on === 'professional') itemGst = pFee * rate;
                else if (on === 'government') itemGst = gFee * rate;
                else if (on === 'both') itemGst = (pFee + gFee) * rate;
            }
            totalGst += itemGst;

            // Calculate Item Discount
            const itemTotalBeforeDiscount = pFee + gFee + itemGst;
            let itemDiscount = 0;
            const dType = item.discountType || item.discount_type || 'amount';
            const dValue = Number(item.discountValue) || Number(item.discount_value) || 0;

            if (dType === 'percentage') {
                itemDiscount = itemTotalBeforeDiscount * Math.min(dValue, 100) / 100;
            } else {
                itemDiscount = Math.min(dValue, itemTotalBeforeDiscount);
            }
            totalDiscount += itemDiscount;
        });

        const totalBeforeDiscount = profSubtotal + govtSubtotal + totalGst;
        const finalTotal = Math.max(0, totalBeforeDiscount - totalDiscount);

        return {
            profSubtotal: Math.round(profSubtotal * 100) / 100,
            govtSubtotal: Math.round(govtSubtotal * 100) / 100,
            totalGst: Math.round(totalGst * 100) / 100,
            totalDiscount: Math.round(totalDiscount * 100) / 100,
            totalBeforeDiscount: Math.round(totalBeforeDiscount * 100) / 100,
            finalTotal: Math.round(finalTotal * 100) / 100,
            netTotal: Math.round(finalTotal * 100) / 100
        };
    }
}

module.exports = ProposalCalculationService;
