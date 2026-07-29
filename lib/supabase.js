const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

// We rely on index.js to load environment variables, 
// but we call dotenv.config() just in case this file is used in isolation (e.g. scripts)
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase;

if (!supabaseUrl || !supabaseKey) {
    console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.warn('API will fail until these are provided in Render environment variables.');
    // Initialize with a dummy URL to prevent crash on startup, but it will fail on actual requests
    supabase = createClient('https://placeholder-domain-because-env-vars-are-missing.supabase.co', 'dummy-key');
} else {
    supabase = createClient(supabaseUrl, supabaseKey);
}

module.exports = { supabase };

