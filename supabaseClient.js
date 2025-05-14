// supabaseClient.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Load environment variables from .env file

// Prioritize test environment variables if they are set
const supabaseUrl = process.env.SUPABASE_TEST_USER_URL;
const supabaseKey = process.env.SUPABASE_TEST_USER_KEY;

// IMPORTANT: Keep this check to ensure credentials are provided in either env
if (!supabaseUrl || !supabaseKey) {
    // Refined error message to reflect looking for either set
    console.error("Supabase URL and Key are required (either test or standard). Check your .env file or CI secrets.");
    // Still a good idea to throw if connection cannot be configured
    throw new Error("Supabase configuration missing.");
}

// Create a single supabase client for interacting with your database
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;