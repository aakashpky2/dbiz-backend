const normalizePhone = (value) => {
    if (!value) return null;
    
    let digits = '';
    if (typeof value === 'object') {
        digits = String(value.number || value.phone || value.value || '').replace(/\D/g, '');
    } else {
        digits = String(value).replace(/\D/g, '');
    }

    if (!digits) return null;

    let number = digits;
    
    // Remove leading 91 if it's more than 10 digits
    if (number.length > 10 && number.startsWith('91')) {
        number = number.slice(-10);
    }
    
    // Remove leading 0 if it's more than 10 digits
    if (number.length > 10 && number.startsWith('0')) {
        number = number.slice(-10);
    }

    // If still > 10 digits, take last 10
    if (number.length > 10) {
        number = number.slice(-10);
    }

    return number.length === 10 ? number : digits; // Fallback to digits if not 10, but try to normalize
};

const normalizeContacts = (contacts) => {
    if (!Array.isArray(contacts)) return [];

    const contactMap = new Map();
    
    return contacts
        .map(c => {
            if (!c || typeof c !== 'object') return null;
            
            const phone = normalizePhone(c.phone);
            const countryCode = c.countryCode || '+91';
            
            return {
                _id: c._id || c.id || `contact-${Math.random().toString(36).substr(2, 9)}`,
                name: (c.name || '').trim(),
                email: (c.email || '').trim().toLowerCase(),
                phone: phone,
                countryCode: countryCode,
                sourceType: c.sourceType || 'manual',
                memberId: c.memberId || null,
                description: (c.description || '').trim()
            };
        })
        .filter(c => {
            if (!c) return false;
            // Remove empty contacts (no name AND no email AND no phone)
            if (!c.name && !c.email && !c.phone) return false;
            
            // Duplicate removal
            const emailKey = c.email ? `email:${c.email}` : null;
            const phoneKey = c.phone ? `phone:${c.phone}` : null;
            
            if (emailKey && contactMap.has(emailKey)) return false;
            if (phoneKey && contactMap.has(phoneKey)) return false;
            
            if (emailKey) contactMap.set(emailKey, true);
            if (phoneKey) contactMap.set(phoneKey, true);
            
            return true;
        });
};

const normalizeRoles = (roles) => {
    if (!roles || typeof roles !== 'object') return {};
    
    const normalized = {};
    
    Object.entries(roles).forEach(([roleKey, roleValue]) => {
        if (!roleValue || typeof roleValue !== 'object') return;
        
        // Ensure members is an array if the frontend sends it as one
        let members = [];
        if (Array.isArray(roleValue.members)) {
            members = roleValue.members.map((mValue, index) => {
                if (!mValue || typeof mValue !== 'object') return null;
                const details = mValue.details || {};
                
                // Normalize any phone fields in details
                const cleanedDetails = { ...details };
                Object.entries(cleanedDetails).forEach(([k, v]) => {
                    if (k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile') || k.toLowerCase().includes('contact')) {
                        const normalized = normalizePhone(v);
                        if (normalized) cleanedDetails[k] = normalized;
                    }
                });

                return {
                    ...mValue,
                    _id: mValue._id || mValue.id || `member-${index}`,
                    details: cleanedDetails
                };
            }).filter(Boolean);
        } else if (roleValue.members && typeof roleValue.members === 'object') {
            // Fallback for object-style members (legacy or different source)
            members = Object.entries(roleValue.members).map(([mKey, mValue]) => {
                if (!mValue || typeof mValue !== 'object') return null;
                const details = mValue.details || {};
                
                const cleanedDetails = { ...details };
                Object.entries(cleanedDetails).forEach(([k, v]) => {
                    if (k.toLowerCase().includes('phone') || k.toLowerCase().includes('mobile') || k.toLowerCase().includes('contact')) {
                        const normalized = normalizePhone(v);
                        if (normalized) cleanedDetails[k] = normalized;
                    }
                });

                return {
                    ...mValue,
                    _id: mValue._id || mValue.id || mKey,
                    details: cleanedDetails
                };
            }).filter(Boolean);
        }
        
        normalized[roleKey] = {
            ...roleValue,
            members: members
        };
    });
    
    return normalized;
};

const normalizeClientPayload = (data) => {
    if (!data || typeof data !== 'object') return {};

    // First pass: deep clone and basic normalization
    const payload = {
        ...data,
        contacts: normalizeContacts(data.contacts),
        roles: normalizeRoles(data.roles),
        fields: data.fields || {},
        signatories: Array.isArray(data.signatories) ? data.signatories : [],
    };

    // Handle primary_signatories specifically (could be either camel or snake)
    payload.primary_signatories = data.primary_signatories || data.primarySignatories || {};

    // Map camelCase to snake_case for DB
    const mapping = {
        clientName: 'client_name',
        clientType: 'client_type',
        constitutionId: 'constitution_id',
        associateId: 'associate_id',
        profileId: 'profile_id',
        primarySignatories: 'primary_signatories',
        sourceType: 'reference',
        changeStatus: 'change_status',
        completionStatus: 'completion_status',
        originalData: 'original_data',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    };

    Object.entries(mapping).forEach(([camel, snake]) => {
        if (data[camel] !== undefined) {
            let value = data[camel];
            
            // Handle date conversion if they are numbers (timestamps)
            if ((snake === 'created_at' || snake === 'updated_at') && typeof value === 'number') {
                if (value > 0) {
                    value = new Date(value).toISOString();
                } else {
                    value = undefined; // Remove if 0 to let DB handle it
                }
            }
            
            if (value !== undefined) {
                payload[snake] = value;
            }
            
            // Remove camelCase unless it's the same as snake
            if (camel !== snake) delete payload[camel];
        }
    });

    // Clean up unwanted fields
    delete payload.phone;
    delete payload.email;
    delete payload.localPhone;
    delete payload.manual_contact;
    delete payload.isValidationMode;
    delete payload.primarySignatories; // Already mapped to snake_case

    // If createdAt is still numeric in payload (sent directly as snake_case)
    if (typeof payload.created_at === 'number') {
        payload.created_at = payload.created_at > 0 ? new Date(payload.created_at).toISOString() : undefined;
    }
    if (typeof payload.updated_at === 'number') {
        payload.updated_at = payload.updated_at > 0 ? new Date(payload.updated_at).toISOString() : undefined;
    }

    // Final sweep: remove undefined values
    Object.keys(payload).forEach(key => {
        if (payload[key] === undefined) delete payload[key];
    });

    return payload;
};

module.exports = {
    normalizePhone,
    normalizeContacts,
    normalizeRoles,
    normalizeClientPayload
};

