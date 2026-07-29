const path = require('path');
const fs = require('fs');

let fieldsConfig;
try {
    const configPath = path.join(__dirname, '../config/employee-completion-fields.json');
    fieldsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.error('Failed to load employee-completion-fields.json, using fallback', e);
    fieldsConfig = {
        "personal": ["fullName", "email", "phone", "dob", "gender", "maritalStatus"],
        "address_perm": ["aadhar", "building", "street", "city", "state", "district", "country", "pincode", "lat", "lng"],
        "address_curr": ["building", "street", "city", "state", "district", "country", "pincode"],
        "emergency_primary": ["name", "phone", "relation"],
        "employment": ["jobTitle", "role", "termYears", "termMonths", "salary", "casualLeaves", "sickLeaves", "startTime", "endTime", "workingDays", "joiningDate"],
        "medical": ["bloodGroup"],
        "education": ["qualification", "institution", "specialization"],
        "bank": ["holder", "number", "ifsc", "branch"]
    };
}

/**
 * Normalizes employee data from either raw database shape or frontend mapped shape
 * into a consistent internal structure for completion auditing.
 */
function normalizeEmployeeForCompletion(data) {
    if (!data) return null;

    // Helper to get value from either snake_case or camelCase
    const getVal = (obj, ...keys) => {
        if (!obj) return null;
        for (const key of keys) {
            if (obj[key] !== undefined && obj[key] !== null) return obj[key];
        }
        return null;
    };

    // 1. Root & Personal
    const personal = data.personalDetails || data;
    
    // 2. Address Logic
    const addressData = data.addressDetails || {};
    const isSame = data.is_current_same_as_permanent !== undefined ? data.is_current_same_as_permanent : 
                  (data.isCurrentSameAsPermanent !== undefined ? data.isCurrentSameAsPermanent : 
                  (addressData.isCurrentSameAsPermanent !== undefined ? addressData.isCurrentSameAsPermanent : true));
    
    const dbAddresses = Array.isArray(data.employee_addresses) ? data.employee_addresses : [];
    const permAddr = addressData.permanentAddress || dbAddresses.find(a => a.address_type === 'PERMANENT') || {};
    const currAddr = addressData.currentAddress || dbAddresses.find(a => a.address_type === 'CURRENT') || {};

    // 3. Emergency Contacts
    const emergency = data.emergencyContact || data.employee_emergency_contacts || {};
    const primary = (emergency.primaryContact || (Array.isArray(data.employee_emergency_contacts) ? data.employee_emergency_contacts.find(e => e.contact_type === 'PRIMARY') : emergency)) || {};
    const secondary = (emergency.secondaryContact || (Array.isArray(data.employee_emergency_contacts) ? data.employee_emergency_contacts.find(e => e.contact_type === 'SECONDARY') : null)) || {};

    // 4. Employment
    const employment = data.employmentDetails || (Array.isArray(data.employee_employment_details) ? data.employee_employment_details[0] : data) || {};

    // 5. Medical
    const medical = data.medicalInfo || (Array.isArray(data.employee_medical_info) ? data.employee_medical_info[0] : data.medical_info) || data || {};

    // 6. Qualifications
    const quals = data.qualificationDetails || data.employee_qualifications || [];
    const firstQual = (Array.isArray(quals) ? quals[0] : quals) || {};

    // 7. Bank Details
    const bank = data.bankDetails || data.employee_bank_details || (Array.isArray(data.employee_bank_details) ? data.employee_bank_details[0] : data.bank_details) || {};

    return {
        personal: {
            fullName: getVal(personal, 'full_name', 'fullName'),
            email: personal.email,
            phone: getVal(personal, 'phone_number', 'phoneNumber') || getVal(personal, 'phone', 'phone'),
            dob: getVal(personal, 'date_of_birth', 'dateOfBirth'),
            gender: personal.gender,
            maritalStatus: getVal(personal, 'marital_status', 'maritalStatus'),
            joiningDate: getVal(employment, 'joining_date', 'joiningDate') || getVal(personal, 'joining_date', 'joiningDate'),
        },
        address: {
            isSame,
            permanent: {
                aadhar: getVal(permAddr, 'aadhar_number', 'aadharNumber'),
                building: getVal(permAddr, 'building_no', 'buildingHouseNo'),
                street: getVal(permAddr, 'street', 'streetArea'),
                city: getVal(permAddr, 'city', 'cityTownVillage'),
                state: getVal(permAddr, 'state', 'stateProvince'),
                district: permAddr.district,
                country: permAddr.country,
                pincode: permAddr.pincode,
                lat: permAddr.latitude,
                lng: permAddr.longitude,
            },
            current: {
                building: getVal(currAddr, 'building_no', 'buildingHouseNo'),
                street: getVal(currAddr, 'street', 'streetArea'),
                city: getVal(currAddr, 'city', 'cityTownVillage'),
                state: getVal(currAddr, 'state', 'stateProvince'),
                district: currAddr.district,
                country: currAddr.country,
                pincode: currAddr.pincode,
            }
        },
        emergency: {
            primary: {
                name: getVal(primary, 'primary_name', 'name') || primary.name,
                phone: getVal(primary, 'primary_phone', 'phoneNumber') || primary.phoneNumber,
                relation: getVal(primary, 'primary_relation', 'relation') || primary.relation,
            },
            secondary: {
                name: getVal(secondary, 'secondary_name', 'name') || secondary.name,
                phone: getVal(secondary, 'secondary_phone', 'phoneNumber') || secondary.phoneNumber,
                relation: getVal(secondary, 'secondary_relation', 'relation') || secondary.relation,
            }
        },
        employment: {
            employeeId: getVal(employment, 'employee_id_hash', 'employeeId'),
            jobTitle: getVal(employment, 'job_title', 'jobTitle'),
            role: getVal(employment, 'employee_role', 'employeeRole'),
            termYears: getVal(employment, 'employment_term_years', 'employmentTermYears'),
            termMonths: getVal(employment, 'employment_term_months', 'employmentTermMonths'),
            relievingDate: getVal(employment, 'relieving_date', 'relievingDate'),
            salary: getVal(employment, 'monthly_salary', 'monthlySalary'),
            casualLeaves: getVal(employment, 'casual_leaves_per_month', 'casualLeavesPerMonth'),
            sickLeaves: getVal(employment, 'sick_leaves_per_month', 'sickLeavesPerMonth'),
            startTime: getVal(employment, 'start_time', 'startTime'),
            endTime: getVal(employment, 'end_time', 'endTime'),
            workingDays: getVal(employment, 'working_days', 'workingDays'),
            joiningDate: getVal(employment, 'joining_date', 'joiningDate') || getVal(personal, 'joining_date', 'joiningDate'),
        },
        medical: {
            bloodGroup: getVal(medical, 'blood_group', 'bloodGroup'),
            healthIssues: getVal(medical, 'health_issues', 'healthIssues'),
        },
        education: {
            qualification: getVal(firstQual, 'highest_qualification', 'qualification_name', 'highestQualification'),
            institution: getVal(firstQual, 'institution_name', 'institution', 'institutionName'),
            specialization: getVal(firstQual, 'specialization'),
        },
        bank: {
            holder: getVal(bank, 'account_holder_name', 'accountHolderName'),
            number: getVal(bank, 'account_number', 'accountNumber'),
            ifsc: getVal(bank, 'ifsc_code', 'ifscCode'),
            branch: getVal(bank, 'bank_branch', 'bankBranch'),
        }
    };
}

function calculateEmployeeCompletion(data) {
    if (!data) return 0;

    const norm = normalizeEmployeeForCompletion(data);
    if (!norm) return 0;

    const isValuePresent = (val) => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'string' && val.trim() === '') return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
    };

    const audit = [];
    
    // 1. Personal
    fieldsConfig.personal.forEach(k => 
        audit.push({ section: 'personal', key: k, value: norm.personal[k] }));

    // 2. Address
    fieldsConfig.address_perm.forEach(k => 
        audit.push({ section: 'address_perm', key: k, value: norm.address.permanent[k] }));

    if (!norm.address.isSame) {
        fieldsConfig.address_curr.forEach(k => 
            audit.push({ section: 'address_curr', key: k, value: norm.address.current[k] }));
    }

    // 3. Emergency
    fieldsConfig.emergency_primary.forEach(k => 
        audit.push({ section: 'emergency_primary', key: k, value: norm.emergency.primary[k] }));

    // 4. Employment
    fieldsConfig.employment.forEach(k => 
        audit.push({ section: 'employment', key: k, value: norm.employment[k] }));

    // 5. Medical
    fieldsConfig.medical.forEach(k => 
        audit.push({ section: 'medical', key: k, value: norm.medical[k] }));

    // 6. Education
    fieldsConfig.education.forEach(k => 
        audit.push({ section: 'education', key: k, value: norm.education[k] }));

    // 7. Bank
    fieldsConfig.bank.forEach(k => 
        audit.push({ section: 'bank', key: k, value: norm.bank[k] }));

    const totalFields = audit.length;
    const missing = audit.filter(a => !isValuePresent(a.value));
    const completedFields = totalFields - missing.length;
    const percentage = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;

    if (process.env.NODE_ENV !== 'production' && percentage < 100) {
        const sourceShape = (data.personalDetails || data.employmentDetails) ? 'mapped-form' : 'raw-db';
        console.group(`[Completion Audit] ${norm.personal.fullName || 'Employee'} (${norm.employment.role})`);
        console.table({
            employeeId: norm.employment.employeeId || data.id,
            name: norm.personal.fullName,
            source: sourceShape,
            completion: `${percentage}%`,
            missingCount: missing.length
        });
        console.log("Missing Fields:");
        console.table(missing.map(m => ({ Section: m.section, Field: m.key })));
        console.groupEnd();
    }

    return percentage;
}

module.exports = { calculateEmployeeCompletion };
