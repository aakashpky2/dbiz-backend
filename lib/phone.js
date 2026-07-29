/**
 * backend/lib/phone.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized phone-number utility for the Express backend.
 * Used by all routes (clients, queries, proposals, employees, associates, etc.)
 *
 * RULES:
 *  - phone → store ONLY number part (last 10 digits, no +91, no leading 0)
 *  - countryCode → store "+91" style (e.g. "+91", "+44", "+1").
 *  - NEVER store "+91XXXXXXXXXX" in phone.
 */

/**
 * normalizeDialCode(input)
 * "91", "+91", "India", "INDIA" => "+91"
 * invalid / empty               => "+91"
 */
const normalizeDialCode = (input) => {
    if (!input) return '+91';
    const normalized = String(input).trim().toLowerCase();

    // Strip anything that's not a digit
    const digits = normalized.replace(/\D/g, '');
    if (digits) return `+${digits}`;

    return '+91';
};

/**
 * normalizePhoneNumber(value)
 * - remove non-digits
 * - remove leading 91 if length > 10
 * - remove leading 0
 * - return last 10 digits
 */
const normalizePhoneNumber = (value) => {
    if (!value) return '';
    let digits = String(value).replace(/\D/g, '');
    
    // remove leading 91 if length > 10
    if (digits.length > 10 && digits.startsWith('91')) {
        digits = digits.slice(2);
    }
    
    // remove leading 0
    while (digits.startsWith('0')) {
        digits = digits.slice(1);
    }
    
    // return last 10 digits
    return digits.slice(-10);
};

/**
 * parsePhoneNumber(phone, fallbackCountryCode)
 * returns { countryCode, phone } where phone is 10 digits.
 */
const parsePhoneNumber = (phone, fallbackCountryCode = '+91') => {
    const code = normalizeDialCode(fallbackCountryCode);
    if (!phone) return { countryCode: code, phone: '' };

    const normalizedPhone = normalizePhoneNumber(phone);
    
    // If original string had a '+' and was longer than 10, try to extract country code
    const clean = String(phone).replace(/[^\d+]/g, '');
    if (clean.startsWith('+') && clean.length > 10) {
        const extractedCode = normalizeDialCode(clean.slice(0, clean.length - 10));
        return { countryCode: extractedCode, phone: normalizedPhone };
    }

    return { countryCode: code, phone: normalizedPhone };
};

/**
 * normalizeContact(contact)
 * Unifies contact to: { _id, name, email, phone, countryCode, sourceType, memberId, description }
 */
const normalizeContact = (contact) => {
    if (!contact) return contact;

    const rawPhone = contact.phone || contact.contactNumber || contact.contact_number || '';
    const rawCode = contact.countryCode || contact.country_code || '+91';

    const { countryCode, phone } = parsePhoneNumber(rawPhone, rawCode);

    return {
        _id: contact._id || contact.id || Math.random().toString(36).substr(2, 9),
        name: contact.name || '',
        email: contact.email || '',
        phone: phone,
        countryCode: countryCode,
        sourceType: contact.sourceType || 'manual',
        memberId: contact.memberId || null,
        description: contact.description || '',
    };
};

/**
 * normalizeContactsArray(contacts)
 */
const normalizeContactsArray = (contacts) => {
    if (!Array.isArray(contacts)) return [];
    
    const seen = new Set();
    return contacts
        .map(normalizeContact)
        .filter(c => {
            if (!c.phone && !c.email) return true; // Keep if both empty? Or discard? 
            // Rule: remove duplicates (same phone/email)
            const key = `${c.phone}-${c.email}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

/**
 * normalizeEnquiryContacts(contacts)
 * Specific for enquiry/query module
 */
const normalizeEnquiryContacts = (contacts) => {
    if (!Array.isArray(contacts)) return [];
    return contacts.map(c => {
        const { countryCode, phone } = parsePhoneNumber(c.phone || c.contactNumber || '', c.countryCode || '+91');
        return {
            _id: c._id || c.id || Math.random().toString(36).substr(2, 9),
            name: c.name || '',
            email: c.email || '',
            phone: phone,
            countryCode: countryCode,
            description: c.description || ''
        };
    }).filter(c => c.name || c.phone || c.email);
};

module.exports = {
    normalizeDialCode,
    normalizePhoneNumber,
    parsePhoneNumber,
    normalizeContact,
    normalizeContactsArray,
    normalizeEnquiryContacts,
};
