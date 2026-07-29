const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { parsePhoneNumber, normalizeDialCode } = require('../lib/phone');
const { calculateEmployeeCompletion } = require('../lib/completion-helper');
const { authenticateToken } = require('./auth');

// Secure Profile Update (Self)
router.put('/me', authenticateToken, async (req, res) => {
    try {
        const uid = req.user?.id;
        if (!uid) return res.status(401).json({ success: false, error: 'Unauthorized: No valid session' });

        const { phone_number, emergency_contact } = req.body;
        
        // Prepare strict payload (only allowed fields)
        const employeePayload = {};
        const profilePayload = {};

        if (phone_number !== undefined) {
            employeePayload.phone_number = phone_number || null;
            profilePayload.phone_number = phone_number || null;
        }

        if (emergency_contact !== undefined) {
            // Keep existing structure but override fields safely if it's an object, or just set it
            employeePayload.emergency_contact = emergency_contact || null;
        }

        if (Object.keys(employeePayload).length === 0 && Object.keys(profilePayload).length === 0) {
            return res.json({ success: true, message: 'No fields to update' });
        }

        employeePayload.updated_at = new Date().toISOString();
        profilePayload.updated_at = new Date().toISOString();

        // 1. Update user_profiles
        if (Object.keys(profilePayload).length > 1) { // more than just updated_at
            const { error: profileErr } = await supabase
                .from('user_profiles')
                .update(profilePayload)
                .eq('uid', uid);
            
            if (profileErr) throw profileErr;
        }

        // 2. Update employees
        if (Object.keys(employeePayload).length > 1) {
            const { error: empErr } = await supabase
                .from('employees')
                .update(employeePayload)
                .eq('employee_id_hash', uid);
            
            if (empErr) {
                // Also fallback to email match if employee_id_hash fails, but usually hash is safest
                console.error('[Profile Update] Employee update error by hash:', empErr);
                throw empErr;
            }
        }

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('[Profile Update Error]:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
    }
});

// List Employees
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, fields } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const offset = (pageNum - 1) * limitNum;


        const fieldsToSelect = typeof fields === 'string' ? fields : `
            id,
            full_name,
            email,
            phone_number,
            phone_country_code,
            employee_id_hash,
            photo_url,
            employee_role,
            job_title,
            joining_date,
            completion_percentage,
            is_active,
            is_resigned,
            resignation_date,
            created_at,
            updated_at
        `;

        let query = supabase
            .from('employees')
            .select(fieldsToSelect, { count: 'exact' })
            .order('employee_id_hash', { ascending: true })
            .neq('is_active', false);  // Exclude soft-deleted employees
            
        if (req.query.active === 'true') {
            query = query.neq('is_resigned', true);
        }
            
        const { data, error, count } = await query.range(offset, offset + limitNum - 1);

        if (error) {
            console.error('[Employees List Supabase Error]:', error);
            throw error;
        }


        // If caller requested specific fields, return projection immediately without mapping
        if (fields) {
            return res.json({
                success: true,
                data: data || [],
                pagination: {
                    total: count || 0,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil((count || 0) / limitNum)
                }
            });
        }

        // Map data with extreme safety and row-level try/catch
        const mappedData = [];
        for (const emp of (data || [])) {
            try {
                mappedData.push({
                    id: emp.id,
                    full_name: emp.full_name || '',
                    personalDetails: {
                        fullName: emp.full_name || '',
                        email: emp.email || '',
                        phoneCountryCode: emp.phone_country_code || '+91',
                        phoneNumber: emp.phone_number || '',
                        photo: emp.photo_url || 'https://placehold.co/100x100.png',
                        dateOfBirth: null,
                        gender: '',
                        maritalStatus: '',
                        joiningDate: emp.joining_date
                    },
                    addressDetails: {
                        permanentAddress: {
                            buildingHouseNo: '',
                            buildingApartmentName: '',
                            streetArea: '',
                            cityTownVillage: 'N/A',
                            country: 'India',
                            stateProvince: '',
                            district: 'N/A',
                            pincode: ''
                        },
                        currentAddress: {
                            buildingHouseNo: '',
                            buildingApartmentName: '',
                            streetArea: '',
                            cityTownVillage: 'N/A',
                            country: 'India',
                            stateProvince: '',
                            district: 'N/A',
                            pincode: ''
                        },
                        isCurrentSameAsPermanent: true
                    },
                    employmentDetails: {
                        employeeId: emp.employee_id_hash || '',
                        jobTitle: emp.job_title || '',
                        employeeRole: emp.employee_role || '',
                        joiningDate: emp.joining_date,
                        monthlySalary: 0
                    },
                    completionPercentage: typeof emp.completion_percentage === 'number' ? emp.completion_percentage : 0,
                    isResigned: !!emp.is_resigned,
                    resignationDate: emp.resignation_date || null
                });
            } catch (rowError) {
                console.error(`[Employees List] Skipped malformed employee ID ${emp?.id || 'unknown'}:`, rowError.message);
            }
        }

        res.json({
            success: true,
            data: mappedData,
            pagination: {
                total: count || 0,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil((count || 0) / limitNum)
            }
        });
    } catch (error) {
        console.error('[Employees List Catch Error]:', error);
        res.status(500).json({ success: false, error: error.message, data: [] });
    }
});

// Get Single Employee
router.get('/:id', async (req, res) => {
    try {
        console.log(`[Employees GetByID] Fetching ID: ${req.params.id}`);
        const { data, error } = await supabase
            .from('employees')
            .select(`
                *,
                employee_addresses(*),
                employee_bank_details(*),
                employee_qualifications(*),
                employee_employment_details(*),
                employee_emergency_contacts(*),
                employee_medical_info(*)
            `)
            .eq('id', req.params.id)
            .single();

        if (error) {
            console.error('[Employees GetByID Supabase Error]:', error);
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Employee not found' });
            throw error;
        }

        const permanentAddr = (Array.isArray(data.employee_addresses) ? data.employee_addresses.find(a => a.address_type === 'PERMANENT') : (data.employee_addresses?.address_type === 'PERMANENT' ? data.employee_addresses : null)) || {};
        const currentAddr = (Array.isArray(data.employee_addresses) ? data.employee_addresses.find(a => a.address_type === 'CURRENT') : (data.employee_addresses?.address_type === 'CURRENT' ? data.employee_addresses : null)) || permanentAddr;
        
        const bank = (Array.isArray(data.employee_bank_details) ? data.employee_bank_details[0] : data.employee_bank_details) || {};
        const qualifications = Array.isArray(data.employee_qualifications) ? data.employee_qualifications : (data.employee_qualifications ? [data.employee_qualifications] : []);
        const employmentAttr = (Array.isArray(data.employee_employment_details) ? data.employee_employment_details[0] : data.employee_employment_details) || {};
        const emergencyAttr = (Array.isArray(data.employee_emergency_contacts) ? data.employee_emergency_contacts[0] : data.employee_emergency_contacts) || {};
        const medicalAttr = (Array.isArray(data.employee_medical_info) ? data.employee_medical_info[0] : data.employee_medical_info) || {};

        const mappedData = {
            id: data.id,
            personalDetails: {
                fullName: data.full_name || '',
                email: data.email || '',
                phoneCountryCode: data.phone_country_code || '+91',
                phoneNumber: data.phone_number || '',
                photo: data.photo_url || null,
                dateOfBirth: data.date_of_birth || null,
                gender: data.gender || '',
                maritalStatus: data.marital_status || '',
                joiningDate: data.joining_date ? new Date(data.joining_date) : undefined
            },
            addressDetails: {
                isCurrentSameAsPermanent: data.employee_addresses?.length === 1 || !data.employee_addresses?.find(a => a.address_type === 'CURRENT'),
                permanentAddress: {
                    buildingHouseNo: permanentAddr.building_no || '',
                    buildingApartmentName: permanentAddr.building_apartment_name || '',
                    streetArea: permanentAddr.street || '',
                    cityTownVillage: permanentAddr.city || '',
                    district: permanentAddr.district || '',
                    stateProvince: permanentAddr.state || '',
                    country: permanentAddr.country || 'India',
                    pincode: permanentAddr.pincode || '',
                    latitude: permanentAddr.latitude,
                    longitude: permanentAddr.longitude,
                    aadharNumber: permanentAddr.aadhar_number || ''
                },
                currentAddress: {
                    buildingHouseNo: currentAddr.building_no || '',
                    buildingApartmentName: currentAddr.building_apartment_name || '',
                    streetArea: currentAddr.street || '',
                    cityTownVillage: currentAddr.city || '',
                    district: currentAddr.district || '',
                    stateProvince: currentAddr.state || '',
                    country: currentAddr.country || 'India',
                    pincode: currentAddr.pincode || ''
                }
            },
            emergencyContact: {
                primaryContact: {
                    name: emergencyAttr.primary_name || '',
                    phoneNumber: emergencyAttr.primary_phone || '',
                    relation: emergencyAttr.primary_relation || ''
                },
                secondaryContact: {
                    name: emergencyAttr.secondary_name || '',
                    phoneNumber: emergencyAttr.secondary_phone || '',
                    relation: emergencyAttr.secondary_relation || ''
                }
            },
            medicalInfo: {
                bloodGroup: medicalAttr.blood_group || data.blood_group || '',
                healthIssues: medicalAttr.health_issues || []
            },
            employmentDetails: {
                employeeId: data.employee_id_hash,
                jobTitle: data.job_title || employmentAttr.job_title || '',
                employeeRole: data.employee_role || employmentAttr.employee_role || '',
                monthlySalary: data.monthly_salary || employmentAttr.monthly_salary,
                employmentTermYears: data.employment_term_years || employmentAttr.employment_term_years || 0,
                employmentTermMonths: data.employment_term_months || employmentAttr.employment_term_months || 0,
                relievingDate: data.relieving_date || employmentAttr.relieving_date || null,
                casualLeavesPerMonth: data.casual_leaves_per_month || employmentAttr.casual_leaves_per_month || 1,
                sickLeavesPerMonth: data.sick_leaves_per_month || employmentAttr.sick_leaves_per_month || 1,
                startTime: data.start_time || employmentAttr.start_time || '09:00',
                endTime: data.end_time || employmentAttr.end_time || '17:00',
                workingDays: data.working_days || employmentAttr.working_days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
            },
            bankDetails: {
                accountHolderName: bank.account_holder_name || '',
                accountNumber: bank.account_number || '',
                ifscCode: bank.ifsc_code || '',
                bankBranch: bank.bank_branch || ''
            },
            qualificationDetails: qualifications.map(q => ({
                highestQualification: q.highest_qualification || '',
                institutionName: q.institution_name || '',
                specialization: q.specialization || ''
            })),
            completionPercentage: calculateEmployeeCompletion(data), // Use calculated value
            isResigned: data.is_resigned || false,
            resignationDate: data.resignation_date || null
        };

        res.json({ success: true, data: mappedData });
    } catch (error) {
        console.error('[Employees GetByID Internal Error]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create Employee with full details
router.post('/', async (req, res) => {
    try {
        const { personalDetails, addressDetails, emergencyContact, medicalInfo, qualificationDetails, bankDetails, employmentDetails, completionPercentage } = req.body;
        console.log(`[Employees Create] Building payload for: ${personalDetails.email}`);

        // 1. Fetch Employee ID Configuration
        const { data: config, error: configFetchError } = await supabase
            .from('employee_id_configs')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (configFetchError) throw configFetchError;
        if (!config) {
            return res.status(400).json({ 
                success: false, 
                error: 'Employee ID configuration is missing. Please configure Employee ID format in Settings first.' 
            });
        }

        // 2. Generate Candidate ID (Smarter Sequential Logic)
        // First, check the employees table for the actual highest number to prevent out-of-sync issues
        const { data: latestEmp } = await supabase
            .from('employees')
            .select('employee_id_hash')
            .like('employee_id_hash', `${config.prefix}%`)
            .order('employee_id_hash', { ascending: false })
            .limit(1)
            .maybeSingle();

        let nextNumber = (config.last_generated_number || 0) + 1;

        if (latestEmp?.employee_id_hash) {
            // Extract numeric part (e.g. DBIZ036 -> 36)
            const numericPart = latestEmp.employee_id_hash.replace(config.prefix, '').replace(config.suffix || '', '');
            const parsed = parseInt(numericPart, 10);
            if (!isNaN(parsed) && parsed >= nextNumber) {
                nextNumber = parsed + 1;
            }
        }

        const paddedNumber = String(nextNumber).padStart(config.digit_count, '0');
        const generatedId = `${config.prefix}${paddedNumber}${config.suffix || ''}`;

        // Normalize personal phone
        const { fullPhone: normalizedPersonalPhone, countryCode: normalizedPersonalCode } = parsePhoneNumber(
            personalDetails.phoneNumber,
            personalDetails.phoneCountryCode || '+91'
        );

        // 3. Core Employee Insertion
        const { data: empData, error: empError } = await supabase
            .from('employees')
            .insert({
                employee_id_hash: generatedId,
                full_name: personalDetails.fullName,
                email: personalDetails.email,
                phone_number: normalizedPersonalPhone || personalDetails.phoneNumber || '',
                phone_country_code: normalizedPersonalCode,
                photo_url: personalDetails.photo,
                date_of_birth: personalDetails.dateOfBirth,
                gender: personalDetails.gender,
                marital_status: personalDetails.maritalStatus,
                joining_date: employmentDetails?.joiningDate || personalDetails.joiningDate,
                blood_group: medicalInfo?.bloodGroup,
                completion_percentage: completionPercentage || 0,
                emergency_contact: emergencyContact, 
                medical_info: medicalInfo,
                // Employment fields in core table
                job_title: employmentDetails?.jobTitle,
                employee_role: employmentDetails?.employeeRole,
                monthly_salary: employmentDetails?.monthlySalary || 0,
                employment_term_years: employmentDetails?.employmentTermYears || 0,
                employment_term_months: employmentDetails?.employmentTermMonths || 0,
                relieving_date: employmentDetails?.relievingDate,
                casual_leaves_per_month: employmentDetails?.casualLeavesPerMonth || 1,
                sick_leaves_per_month: employmentDetails?.sickLeavesPerMonth || 1,
                start_time: employmentDetails?.startTime || '09:30',
                end_time: employmentDetails?.endTime || '17:30',
                working_days: employmentDetails?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
            })
            .select()
            .single();

        if (empError) {
            console.error('[Employees Create Core Error]:', empError);
            if (empError.code === '23505') {
                if (empError.message.includes('email')) throw new Error('Email already exists.');
                if (empError.message.includes('employee_id_hash')) throw new Error('Generated Employee ID conflict. Please try again.');
                throw new Error('Record already exists.');
            }
            throw empError;
        }

        // 4. Update the Configuration Counter (After successful insert)
        await supabase
            .from('employee_id_configs')
            .update({ 
                last_generated_number: nextNumber,
                updated_at: new Date().toISOString()
            })
            .eq('id', config.id);

        const employeeId = empData.id;

        // 3. Child Table Insertions
        const childRecords = [];

        // Addresses
        if (addressDetails.permanentAddress) {
            childRecords.push(supabase.from('employee_addresses').insert({
                employee_id: employeeId,
                address_type: 'PERMANENT',
                building_no: addressDetails.permanentAddress.buildingHouseNo,
                building_apartment_name: addressDetails.permanentAddress.buildingApartmentName,
                street: addressDetails.permanentAddress.streetArea,
                city: addressDetails.permanentAddress.cityTownVillage,
                district: addressDetails.permanentAddress.district,
                state: addressDetails.permanentAddress.stateProvince,
                country: addressDetails.permanentAddress.country || 'India',
                pincode: addressDetails.permanentAddress.pincode,
                aadhar_number: addressDetails.permanentAddress.aadharNumber,
                latitude: addressDetails.permanentAddress.latitude,
                longitude: addressDetails.permanentAddress.longitude
            }));
        }

        if (!addressDetails.isCurrentSameAsPermanent && addressDetails.currentAddress) {
            childRecords.push(supabase.from('employee_addresses').insert({
                employee_id: employeeId,
                address_type: 'CURRENT',
                building_no: addressDetails.currentAddress.buildingHouseNo,
                building_apartment_name: addressDetails.currentAddress.buildingApartmentName,
                street: addressDetails.currentAddress.streetArea,
                city: addressDetails.currentAddress.cityTownVillage,
                district: addressDetails.currentAddress.district,
                state: addressDetails.currentAddress.stateProvince,
                country: addressDetails.currentAddress.country || 'India',
                pincode: addressDetails.currentAddress.pincode
            }));
        }


        // Emergency — normalize phones
        if (emergencyContact?.primaryContact) {
            const { fullPhone: p1, countryCode: c1 } = parsePhoneNumber(
                emergencyContact.primaryContact.phoneNumber,
                emergencyContact.primaryContact.countryCode || '+91'
            );
            const { fullPhone: p2, countryCode: c2 } = parsePhoneNumber(
                emergencyContact.secondaryContact?.phoneNumber,
                emergencyContact.secondaryContact?.countryCode || '+91'
            );
            childRecords.push(supabase.from('employee_emergency_contacts').insert({
                employee_id: employeeId,
                primary_name: emergencyContact.primaryContact.name,
                primary_phone: p1 || emergencyContact.primaryContact.phoneNumber || '',
                primary_relation: emergencyContact.primaryContact.relation,
                secondary_name: emergencyContact.secondaryContact?.name,
                secondary_phone: p2 || emergencyContact.secondaryContact?.phoneNumber || '',
                secondary_relation: emergencyContact.secondaryContact?.relation
            }));
        }

        // Medical
        if (medicalInfo) {
            childRecords.push(supabase.from('employee_medical_info').insert({
                employee_id: employeeId,
                blood_group: medicalInfo.bloodGroup,
                health_issues: medicalInfo.healthIssues || []
            }));
        }

        // Bank
        if (bankDetails?.accountNumber) {
            childRecords.push(supabase.from('employee_bank_details').insert({
                employee_id: employeeId,
                account_holder_name: bankDetails.accountHolderName,
                account_number: bankDetails.accountNumber,
                ifsc_code: bankDetails.ifscCode,
                bank_branch: bankDetails.bankBranch
            }));
        }

        // Qualifications (Array)
        if (Array.isArray(qualificationDetails) && qualificationDetails.length > 0) {
            const quals = qualificationDetails
                .filter(q => q.highestQualification)
                .map(q => ({
                    employee_id: employeeId,
                    highest_qualification: q.highestQualification,
                    institution_name: q.institutionName,
                    specialization: q.specialization || ''
                }));
            if (quals.length > 0) {
                childRecords.push(supabase.from('employee_qualifications').insert(quals));
            }
        }

        // Run all child inserts and check for errors
        const results = await Promise.all(childRecords);
        for (const res of results) {
            if (res.error) {
                console.error('[Employees Create] Child Record Insert Failed:', res.error);
                throw new Error(`Failed to save child record: ${res.error.message}`);
            }
        }

        // 5. Final Step: Recalculate Completion and Update DB
        const { data: fullEmp, error: fetchError } = await supabase
            .from('employees')
            .select('*, employee_addresses(*), employee_emergency_contacts(*), employee_bank_details(*), employee_qualifications(*), employee_medical_info(*), employee_employment_details(*)')
            .eq('id', employeeId)
            .single();

        if (fetchError) throw fetchError;

        const finalCompletion = calculateEmployeeCompletion(fullEmp);
        await supabase.from('employees').update({ completion_percentage: finalCompletion }).eq('id', employeeId);

        console.log(`[Employees Create] Successfully created employee ${employeeId}. Calculated Completion: ${finalCompletion}%`);
        res.json({ 
            success: true, 
            id: employeeId,
            calculatedCompletion: finalCompletion
        });
    } catch (error) {
        console.error('[Employees Create Catch]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id/resign', async (req, res) => {
    try {
        const employeeId = req.params.id;
        const { resignationDate } = req.body;
        if (!resignationDate) return res.status(400).json({ success: false, error: 'Resignation date is required' });

        console.log(`[Employees Resign] Resigning employee ID: ${employeeId} on ${resignationDate}`);

        // 1. Update Employee table
        const { error: empError } = await supabase
            .from('employees')
            .update({
                is_resigned: true,
                resignation_date: resignationDate,
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId);

        if (empError) throw empError;

        // 2. Disable corresponding User Profile if it exists
        const { error: profileError } = await supabase
            .from('user_profiles')
            .update({
                is_enabled: false,
                updated_at: new Date().toISOString()
            })
            .eq('employee_id', employeeId);

        if (profileError) {
            console.warn(`[Employees Resign] Warning: Failed to disable profile or no profile exists: ${profileError.message}`);
        }

        // 3. Log Audit Action
        await supabase.from('audit_logs').insert({
            action: 'EDIT',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            details: { action: 'Marked as Resigned', resignationDate }
        }).then(({ error }) => {
            if (error) console.warn('[Employees Resign] Audit log failed:', error.message);
        });

        res.json({ success: true, message: 'Employee successfully marked as resigned' });
    } catch (error) {
        console.error('[Employees Resign Error]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id/cancel-resign', async (req, res) => {
    try {
        const employeeId = req.params.id;
        console.log(`[Employees CancelResign] Activating employee ID: ${employeeId}`);

        // 1. Update Employee table
        const { error: empError } = await supabase
            .from('employees')
            .update({
                is_resigned: false,
                resignation_date: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId);

        if (empError) throw empError;

        // 2. Enable corresponding User Profile if it exists
        const { error: profileError } = await supabase
            .from('user_profiles')
            .update({
                is_enabled: true,
                updated_at: new Date().toISOString()
            })
            .eq('employee_id', employeeId);

        if (profileError) {
            console.warn(`[Employees CancelResign] Warning: Failed to enable profile or no profile exists: ${profileError.message}`);
        }

        // 3. Log Audit Action
        await supabase.from('audit_logs').insert({
            action: 'EDIT',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            details: { action: 'Cancelled Resignation' }
        }).then(({ error }) => {
            if (error) console.warn('[Employees CancelResign] Audit log failed:', error.message);
        });

        res.json({ success: true, message: 'Employee resignation successfully cancelled' });
    } catch (error) {
        console.error('[Employees CancelResign Error]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


// router.put('/:id', async (req, res) => {
//     try {
//         // 1. Update Core Employee
//         const { error: empError } = await supabase
//             .from('employees')
//             .update({
//                 full_name: personalDetails.fullName,
//                 email: personalDetails.email,
//                 phone_number: personalDetails.phoneNumber,
//                 phone_country_code: personalDetails.phoneCountryCode || '+91',
//                 photo_url: personalDetails.photo,
//                 date_of_birth: personalDetails.dateOfBirth,
//                 gender: personalDetails.gender,
//                 marital_status: personalDetails.maritalStatus,
//                 joining_date: personalDetails.joiningDate,
//                 blood_group: medicalInfo?.bloodGroup,
//                 completion_percentage: completionPercentage || 0,
//                 emergency_contact: emergencyContact,
//                 medical_info: medicalInfo,
//                 updated_at: new Date().toISOString()
//             })
//             .eq('id', employeeId);

//         if (empError) {
//             if (empError.code === '23505') throw new Error('Conflict: Email exists elsewhere.');
//             throw empError;
//         }

//         // 2. Clean and Refresh Child Tables
//         const tablesToClear = [
//             'employee_addresses',
//             'employee_emergency_contacts',
//             'employee_medical_info',
//             'employee_bank_details',
//             'employee_qualifications'
//         ];

//         await Promise.all(tablesToClear.map(table => supabase.from(table).delete().eq('employee_id', employeeId)));

//         // 3. Re-insert Child Data
//         const childRecords = [];
        
//         // Addresses
//         if (addressDetails.permanentAddress) {
//             childRecords.push(supabase.from('employee_addresses').insert({
//                 employee_id: employeeId, address_type: 'PERMANENT',
//                 building_no: addressDetails.permanentAddress.buildingHouseNo,
//                 building_apartment_name: addressDetails.permanentAddress.buildingApartmentName,
//                 street: addressDetails.permanentAddress.streetArea,
//                 city: addressDetails.permanentAddress.cityTownVillage,
//                 district: addressDetails.permanentAddress.district,
//                 state: addressDetails.permanentAddress.stateProvince,
//                 country: addressDetails.permanentAddress.country || 'India',
//                 pincode: addressDetails.permanentAddress.pincode,
//                 latitude: addressDetails.permanentAddress.latitude,
//                 longitude: addressDetails.permanentAddress.longitude,
//                 aadhar_number: addressDetails.permanentAddress.aadharNumber
//             }));
//         }
//         if (!addressDetails.isCurrentSameAsPermanent && addressDetails.currentAddress) {
//             childRecords.push(supabase.from('employee_addresses').insert({
//                 employee_id: employeeId, address_type: 'CURRENT',
//                 building_no: addressDetails.currentAddress.buildingHouseNo,
//                 building_apartment_name: addressDetails.currentAddress.buildingApartmentName,
//                 street: addressDetails.currentAddress.streetArea,
//                 city: addressDetails.currentAddress.cityTownVillage,
//                 district: addressDetails.currentAddress.district,
//                 state: addressDetails.currentAddress.stateProvince,
//                 country: addressDetails.currentAddress.country || 'India',
//                 pincode: addressDetails.currentAddress.pincode
//             }));
//         }


//         // Emergency
//         if (emergencyContact?.primaryContact) {
//             childRecords.push(supabase.from('employee_emergency_contacts').insert({
//                 employee_id: employeeId,
//                 primary_name: emergencyContact.primaryContact.name,
//                 primary_phone: emergencyContact.primaryContact.phoneNumber,
//                 primary_relation: emergencyContact.primaryContact.relation,
//                 secondary_name: emergencyContact.secondaryContact?.name,
//                 secondary_phone: emergencyContact.secondaryContact?.phoneNumber,
//                 secondary_relation: emergencyContact.secondaryContact?.relation
//             }));
//         }

//         // Medical
//         if (medicalInfo) {
//             childRecords.push(supabase.from('employee_medical_info').insert({
//                 employee_id: employeeId,
//                 blood_group: medicalInfo.bloodGroup,
//                 health_issues: medicalInfo.healthIssues || []
//             }));
//         }

//         // Bank
//         if (bankDetails?.accountNumber) {
//             childRecords.push(supabase.from('employee_bank_details').insert({
//                 employee_id: employeeId,
//                 account_holder_name: bankDetails.accountHolderName,
//                 account_number: bankDetails.accountNumber,
//                 ifsc_code: bankDetails.ifscCode,
//                 bank_branch: bankDetails.bankBranch
//             }));
//         }

//         // Qualification
//         if (qualificationDetails?.highestQualification) {
//             childRecords.push(supabase.from('employee_qualifications').insert({
//                 employee_id: employeeId,
//                 highest_qualification: qualificationDetails.highestQualification,
//                 institution_name: qualificationDetails.institutionName,
//                 specialization: qualificationDetails.specialization || ''
//             }));
//         }

//         await Promise.all(childRecords);

//         res.json({ success: true });
//     } catch (error) {
//         console.error('[Employees Update Catch]:', error.message);
//         res.status(500).json({ error: error.message });
//     }
// });

// Dedicated Employment Routes

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[Employees Update] Received request for ID: ${id}`);
    
    // 1. Properly destructure request body
    const {
        personalDetails = {},
        addressDetails = {},
        emergencyContact = {},
        medicalInfo = {},
        qualificationDetails = [],
        bankDetails = {},
        employmentDetails = {},
    } = req.body;

    // Debug logging as requested
    console.log("Emergency Contact Payload:", JSON.stringify(emergencyContact, null, 2));
    console.log("Qualification Details Payload:", JSON.stringify(qualificationDetails, null, 2));

    try {
        if (!id) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        // Normalize personal phone on update
        const { fullPhone: normalizedPersonalPhone, countryCode: normalizedPersonalCode } = parsePhoneNumber(
            personalDetails.phoneNumber,
            personalDetails.phoneCountryCode || '+91'
        );

        // 1. Update Core Employee Row (Initial update for base fields)
        const corePayload = {
            full_name: personalDetails.fullName || '',
            email: personalDetails.email || '',
            phone_number: normalizedPersonalPhone || personalDetails.phoneNumber || '',
            phone_country_code: normalizedPersonalCode,
            photo_url: personalDetails.photo || null,
            date_of_birth: personalDetails.dateOfBirth || null,
            gender: personalDetails.gender || null,
            marital_status: personalDetails.maritalStatus || null,
            joining_date: employmentDetails?.joiningDate || personalDetails.joiningDate || null,
            blood_group: medicalInfo?.bloodGroup || null,
            updated_at: new Date().toISOString(),
            // Employment fields in core table
            job_title: employmentDetails?.jobTitle || null,
            employee_role: employmentDetails?.employeeRole || null,
            monthly_salary: employmentDetails?.monthlySalary || 0,
            employment_term_years: employmentDetails?.employmentTermYears || 0,
            employment_term_months: employmentDetails?.employmentTermMonths || 0,
            relieving_date: employmentDetails?.relievingDate || null,
            casual_leaves_per_month: employmentDetails?.casual_leaves_per_month || employmentDetails?.casualLeavesPerMonth || 1,
            sick_leaves_per_month: employmentDetails?.sick_leaves_per_month || employmentDetails?.sickLeavesPerMonth || 1,
            start_time: employmentDetails?.start_time || employmentDetails?.startTime || '09:30',
            end_time: employmentDetails?.end_time || employmentDetails?.endTime || '17:30',
            working_days: employmentDetails?.working_days || employmentDetails?.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        };

        const { error: empError } = await supabase
            .from('employees')
            .update(corePayload)
            .eq('id', id);

        if (empError) {
            console.error('[Employees Update] Core Table Write Failed:', empError);
            if (empError.code === '23505') {
                return res.status(409).json({ success: false, error: 'Conflict: Email already exists for another employee.' });
            }
            throw empError;
        }

        // 2. Child Table Updates using UPSERT instead of DELETE+INSERT
        const upsertTasks = [];

        // Addresses UPSERT
        if (addressDetails?.permanentAddress) {
            upsertTasks.push(supabase.from('employee_addresses').upsert({
                employee_id: id,
                address_type: 'PERMANENT',
                building_no: addressDetails.permanentAddress.buildingHouseNo || '',
                building_apartment_name: addressDetails.permanentAddress.buildingApartmentName || '',
                street: addressDetails.permanentAddress.streetArea || '',
                city: addressDetails.permanentAddress.cityTownVillage || '',
                district: addressDetails.permanentAddress.district || '',
                state: addressDetails.permanentAddress.stateProvince || '',
                country: addressDetails.permanentAddress.country || 'India',
                pincode: addressDetails.permanentAddress.pincode || '',
                latitude: addressDetails.permanentAddress.latitude ?? null,
                longitude: addressDetails.permanentAddress.longitude ?? null,
                aadhar_number: addressDetails.permanentAddress.aadharNumber || '',
            }, { onConflict: 'employee_id, address_type' }));
        }

        if (!addressDetails?.isCurrentSameAsPermanent && addressDetails?.currentAddress) {
            upsertTasks.push(supabase.from('employee_addresses').upsert({
                employee_id: id,
                address_type: 'CURRENT',
                building_no: addressDetails.currentAddress.buildingHouseNo || '',
                building_apartment_name: addressDetails.currentAddress.buildingApartmentName || '',
                street: addressDetails.currentAddress.streetArea || '',
                city: addressDetails.currentAddress.cityTownVillage || '',
                district: addressDetails.currentAddress.district || '',
                state: addressDetails.currentAddress.stateProvince || '',
                country: addressDetails.currentAddress.country || 'India',
                pincode: addressDetails.currentAddress.pincode || '',
            }, { onConflict: 'employee_id, address_type' }));
        } else if (addressDetails?.isCurrentSameAsPermanent) {
            upsertTasks.push(supabase.from('employee_addresses').delete().eq('employee_id', id).eq('address_type', 'CURRENT'));
        }

        // Emergency Contacts UPSERT
        if (emergencyContact) {
            const { fullPhone: ep1 } = parsePhoneNumber(
                emergencyContact.primaryContact?.phoneNumber,
                emergencyContact.primaryContact?.countryCode || '+91'
            );
            const { fullPhone: ep2 } = parsePhoneNumber(
                emergencyContact.secondaryContact?.phoneNumber,
                emergencyContact.secondaryContact?.countryCode || '+91'
            );
            upsertTasks.push(supabase.from('employee_emergency_contacts').upsert({
                employee_id: id,
                primary_name: emergencyContact.primaryContact?.name || '',
                primary_phone: ep1 || emergencyContact.primaryContact?.phoneNumber || '',
                primary_relation: emergencyContact.primaryContact?.relation || '',
                secondary_name: emergencyContact.secondaryContact?.name || '',
                secondary_phone: ep2 || emergencyContact.secondaryContact?.phoneNumber || '',
                secondary_relation: emergencyContact.secondaryContact?.relation || '',
            }, { onConflict: 'employee_id' }));
        }

        // Medical Info UPSERT
        if (medicalInfo) {
            upsertTasks.push(supabase.from('employee_medical_info').upsert({
                employee_id: id,
                blood_group: medicalInfo.bloodGroup || null,
                health_issues: medicalInfo.healthIssues || [],
            }, { onConflict: 'employee_id' }));
        }

        // Bank Details UPSERT
        if (bankDetails) {
            upsertTasks.push(supabase.from('employee_bank_details').upsert({
                employee_id: id,
                account_holder_name: bankDetails.accountHolderName || '',
                account_number: bankDetails.accountNumber || '',
                ifsc_code: bankDetails.ifscCode || '',
                bank_branch: bankDetails.bankBranch || '',
            }, { onConflict: 'employee_id' }));
        }

        // Await primary upserts and check for errors
        const results = await Promise.all(upsertTasks);
        for (const res of results) {
            if (res.error) {
                console.error('[Employees Update] Child Table Update Failed:', res.error);
                throw new Error(`Failed to save child record: ${res.error.message}`);
            }
        }

        // Qualification Details SYNC (Proper Upsert/Sync logic preserving Row IDs)
        if (Array.isArray(qualificationDetails)) {
            const { data: existingQuals, error: fetchQErr } = await supabase
                .from('employee_qualifications')
                .select('*')
                .eq('employee_id', id);

            if (fetchQErr) {
                console.error('[Employees Update] Failed to fetch existing qualifications:', fetchQErr.message);
                throw fetchQErr;
            }

            const validQuals = qualificationDetails.filter(q => q.highestQualification);

            for (let i = 0; i < validQuals.length; i++) {
                const q = validQuals[i];
                const existingQual = existingQuals && existingQuals[i];

                if (existingQual) {
                    const { error: updErr } = await supabase
                        .from('employee_qualifications')
                        .update({
                            highest_qualification: q.highestQualification,
                            institution_name: q.institutionName,
                            specialization: q.specialization || ''
                        })
                        .eq('id', existingQual.id);

                    if (updErr) {
                        console.error('[Employees Update] Qualification Update Failed:', updErr.message);
                        throw updErr;
                    }
                } else {
                    const { error: insErr } = await supabase
                        .from('employee_qualifications')
                        .insert({
                            employee_id: id,
                            highest_qualification: q.highestQualification,
                            institution_name: q.institutionName,
                            specialization: q.specialization || ''
                        });

                    if (insErr) {
                        console.error('[Employees Update] Qualification Insert Failed:', insErr.message);
                        throw insErr;
                    }
                }
            }

            // If there are fewer incoming qualifications than existing ones, delete the extra ones
            if (existingQuals && existingQuals.length > validQuals.length) {
                const idsToDelete = existingQuals.slice(validQuals.length).map(eq => eq.id);
                const { error: delErr } = await supabase
                    .from('employee_qualifications')
                    .delete()
                    .in('id', idsToDelete);

                if (delErr) {
                    console.error('[Employees Update] Qualification Deletion Failed:', delErr.message);
                    throw delErr;
                }
            }
        }

        // 3. Final Step: Recalculate Completion and Update DB
        // Fetch the full record with all children to ensure helper has everything
        const { data: fullEmp, error: fetchError } = await supabase
            .from('employees')
            .select('*, employee_addresses(*), employee_emergency_contacts(*), employee_bank_details(*), employee_qualifications(*), employee_medical_info(*), employee_employment_details(*)')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        const finalCompletion = calculateEmployeeCompletion(fullEmp);
        await supabase.from('employees').update({ completion_percentage: finalCompletion }).eq('id', id);

        console.log(`[Employees Update] Successfully updated employee ${id}. Calculated Completion: ${finalCompletion}%`);
        return res.json({ 
            success: true, 
            message: 'Employee updated successfully',
            calculatedCompletion: finalCompletion
        });
    } catch (error) {
        console.error('[Employees Update Catch Error]:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'An internal error occurred during employee update',
        });
    }
});

router.get('/:id/employment', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('employee_employment_details')
            .select('*')
            .eq('employee_id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        
        // If not found in child table, get missing fields from main employees table
        let empIdHash = data?.employee_id_hash || '';
        let empJobTitle = data?.job_title || '';
        
        if (!empIdHash || !empJobTitle) {
            const { data: baseEmp } = await supabase
                .from('employees')
                .select('employee_id_hash, job_title')
                .eq('id', req.params.id)
                .maybeSingle();
            
            if (!empIdHash) empIdHash = baseEmp?.employee_id_hash || '';
            if (!empJobTitle) empJobTitle = baseEmp?.job_title || '';
        }

        // Return default shape if none exists
        if (!data) {
            return res.json({ 
                success: true, 
                data: {
                    employeeId: empIdHash,
                    jobTitle: empJobTitle,
                    joiningDate: null,
                    employeeRole: '',
                    monthlySalary: 0,
                    casualLeavesPerMonth: 1,
                    sickLeavesPerMonth: 1,
                    startTime: '09:30',
                    endTime: '17:30',
                    workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: data.id,
                employeeId: empIdHash,
                joiningDate: data.joining_date,
                relievingDate: data.relieving_date,
                employeeRole: data.employee_role,
                jobTitle: empJobTitle,
                monthlySalary: data.monthly_salary,
                casualLeavesPerMonth: data.casual_leaves_per_month,
                sickLeavesPerMonth: data.sick_leaves_per_month,
                startTime: data.start_time,
                endTime: data.end_time,
                workingDays: data.working_days,
                employmentTermYears: data.employment_term_years,
                employmentTermMonths: data.employment_term_months
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id/employment', async (req, res) => {
    try {
        const employeeId = req.params.id;
        const employment = req.body;

        // 1. Get Employee ID (should already exist from creation)
        let employeeIdHash = employment.employeeId;
        if (!employeeIdHash || employeeIdHash.trim() === '') {
            const { data: baseEmp } = await supabase
                .from('employees')
                .select('employee_id_hash')
                .eq('id', employeeId)
                .maybeSingle();
            
            employeeIdHash = baseEmp?.employee_id_hash || `EMP-${Date.now()}`;
        }

        const payload = {
            employee_id: employeeId,
            employee_role: employment.employeeRole,
            joining_date: employment.joiningDate,
            relieving_date: employment.relievingDate,
            monthly_salary: employment.monthlySalary || 0,
            casual_leaves_per_month: employment.casualLeavesPerMonth || 1,
            sick_leaves_per_month: employment.sickLeavesPerMonth || 1,
            start_time: employment.startTime,
            end_time: employment.endTime,
            working_days: employment.workingDays,
            employment_term_years: employment.employmentTermYears || 0,
            employment_term_months: employment.employmentTermMonths || 0
        };

        await supabase.from('employees').update({
            employee_id_hash: employeeIdHash,
            job_title: employment.jobTitle,
            employee_role: employment.employeeRole,
            joining_date: employment.joiningDate,
            monthly_salary: employment.monthlySalary || 0,
            casual_leaves_per_month: employment.casualLeavesPerMonth || 1,
            sick_leaves_per_month: employment.sickLeavesPerMonth || 1,
            start_time: employment.startTime,
            end_time: employment.endTime,
            working_days: employment.workingDays
        }).eq('id', employeeId);

        // 3. Save employment details (Manual upsert since table lacks unique constraint on employee_id)
        const { data: existing } = await supabase
            .from('employee_employment_details')
            .select('id')
            .eq('employee_id', employeeId)
            .maybeSingle();

        const { error } = existing 
            ? await supabase.from('employee_employment_details').update(payload).eq('id', existing.id)
            : await supabase.from('employee_employment_details').insert(payload);

        if (error) throw error;

        // 4. Final Step: Recalculate Completion and Update DB
        const { data: fullEmp, error: fetchError } = await supabase
            .from('employees')
            .select('*, employee_addresses(*), employee_emergency_contacts(*), employee_bank_details(*), employee_qualifications(*), employee_medical_info(*), employee_employment_details(*)')
            .eq('id', employeeId)
            .single();

        if (fetchError) throw fetchError;

        const finalCompletion = calculateEmployeeCompletion(fullEmp);
        await supabase.from('employees').update({ completion_percentage: finalCompletion }).eq('id', employeeId);

        console.log(`[Employment Update] Successfully updated employee ${employeeId}. Calculated Completion: ${finalCompletion}%`);
        res.json({ 
            success: true, 
            employeeId: employeeIdHash,
            calculatedCompletion: finalCompletion
        });
    } catch (error) {
        console.error('[Employment Save Error]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE Employee (SOFT DELETE — keeps all child records, sets is_active = false)
router.delete('/:id', async (req, res) => {
    try {
        const employeeId = req.params.id;
        if (!employeeId) return res.status(400).json({ success: false, error: 'Employee ID is required' });

        console.log(`[Employees Delete] Soft deleting employee ID: ${employeeId}`);

        // Update the main employee row to set is_active = false
        const { error: empError } = await supabase
            .from('employees')
            .update({ 
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId);

        if (empError) {
            console.error('[Employees Delete] Employee soft delete error:', empError);
            throw empError;
        }

        // Log audit action
        await supabase.from('audit_logs').insert({
            action: 'DELETE',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            details: { message: 'Soft deleted employee record' }
        }).then(({ error }) => {
            if (error) console.warn('[Employees Delete] Audit log failed:', error.message);
        });

        res.json({ success: true, message: 'Employee profile soft deleted successfully' });
    } catch (error) {
        console.error('[Employees Delete Catch]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE Employee permanently (Admin only / direct backend route)
router.delete('/:id/permanent', async (req, res) => {
    try {
        const employeeId = req.params.id;
        if (!employeeId) return res.status(400).json({ success: false, error: 'Employee ID is required' });

        console.log(`[Employees Delete] Hard deleting employee ID: ${employeeId}`);

        // Delete child records first (to avoid FK constraint violations)
        const childTables = [
            'employee_addresses',
            'employee_bank_details',
            'employee_qualifications',
            'employee_employment_details',
            'employee_emergency_contacts',
            'employee_medical_info'
        ];

        for (const table of childTables) {
            const { error: childErr } = await supabase.from(table).delete().eq('employee_id', employeeId);
            if (childErr) {
                console.error(`[Employees Delete] Error deleting from ${table}:`, childErr.message);
            }
        }

        // Delete the main employee row
        const { error: empError } = await supabase.from('employees').delete().eq('id', employeeId);
        if (empError) {
            console.error('[Employees Delete] Employee row delete error:', empError);
            throw empError;
        }

        // Log audit action
        await supabase.from('audit_logs').insert({
            action: 'DELETE_PERMANENT',
            entity_type: 'EMPLOYEE',
            entity_id: employeeId,
            details: { message: 'Permanently deleted employee record' }
        }).then(({ error }) => {
            if (error) console.warn('[Employees Delete] Audit log failed:', error.message);
        });

        res.json({ success: true, message: 'Employee permanently deleted' });
    } catch (error) {
        console.error('[Employees Delete Catch]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
