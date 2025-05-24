// index.js (user-service)
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
// Add axios for making HTTP requests to other services
const axios = require('axios'); // <--- ADD THIS LINE
const supabase = require('./supabaseClient'); // Import the configured Supabase client
require('dotenv').config();
 
const app = express(); 
const port = process.env.USER_SERVICE_PORT || 3001;  
 
// Add environment variable for the Properties Service URL
const propertiesServiceUrl = process.env.PROPERTIES_SERVICE_URL; // Reads from .env

// Add a check during startup for the properties service URL
if (!propertiesServiceUrl) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!! CRITICAL ERROR: PROPERTIES_SERVICE_URL environment variable not set!');
    console.error('!! User deletion cleanup will fail.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    // Consider exiting or preventing server start in production if this is missing
    // process.exit(1);
} else {
     console.log(`User Service configured to call Properties Service at: ${propertiesServiceUrl}`);
}


const SALT_ROUNDS = 10;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Routes ---

// User Registration (POST /register)
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    try {
        // Ensure the username and email are unique before creating
        const { data: existingUsers, error: checkError } = await supabase
            .from('users')
            .select('id')
            .or(`username.eq.${username},email.eq.${email}`);

        if (checkError) {
            console.error('[User Service POST /register] Supabase check error:', checkError);
            return res.status(500).json({ error: 'Database error checking user' });
        }

        if (existingUsers && existingUsers.length > 0) {
            console.warn(`[User Service POST /register] Registration failed: Username or email already exists for ${username}/${email}`);
            return res.status(409).json({ error: 'Username or email already exists' });
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert the new user. Optionally add a default role here if not set by frontend.
        // Based on your DB schema, 'role' defaults to 'user' if not provided in insert.
        const { data, error: insertError } = await supabase
            .from('users')
            // If you want to allow setting role on creation via this endpoint (e.g. for admin),
            // include role: req.body.role here and update schema/validation if needed.
            .insert([{ username, email, password_hash: passwordHash }])
            .select('id, username, email, created_at, role'); // Include role in the response

        if (insertError) {
            console.error('[User Service POST /register] Supabase insert error:', insertError);
            return res.status(500).json({ error: 'Failed to register user' });
        }

        if (!data || data.length === 0) {
             console.error('[User Service POST /register] Supabase insert error: No data returned after insert');
             return res.status(500).json({ error: 'Failed to register user (no data)' });
        }

        console.log(`[User Service POST /register] User registered successfully: ${data[0].username} (ID: ${data[0].id})`);
        res.status(201).json(data[0]);

    } catch (error) {
        console.error('[User Service POST /register] Registration error:', error);
        res.status(500).json({ error: 'Internal server error during registration' });
    }
});

// Get All Profiles (GET /profiles)
app.get('/profiles', async (req, res) => {
    console.log(`[User Service GET /profiles] Received request`);

    // TODO: Add Authorization Check here! Only admins should view all users.
    // Example: Check the X-User-ID header and query that user's role.

    try {
        const { data, error } = await supabase
            .from('users')
            // --- SELECT 'role' column ---
            .select('id, username, email, created_at, role'); // <<< Ensure 'role' is selected

        if (error) {
            console.error('[User Service GET /profiles] Supabase fetch error:', error);
            return res.status(500).json({ error: 'Database error fetching profiles' });
        }
        console.log(`[User Service GET /profiles] Found ${data?.length || 0} profiles.`);
        res.status(200).json(data || []);
    } catch (error) {
        console.error('[User Service GET /profiles] Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error fetching profiles' });
    }
});

// User Authentication (POST /authenticate)
app.post('/authenticate', async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Identifier (username or email) and password are required' });
    }

    try {
        const { data: users, error } = await supabase
            .from('users')
            // Select role here as well, it might be useful for JWT claims
            .select('id, username, email, password_hash, role') // <<< Select 'role' for authentication
            .or(`username.eq.${identifier},email.eq.${identifier}`)
            .limit(1);

        if (error) {
            console.error('[User Service POST /authenticate] Supabase find user error:', error);
            return res.status(500).json({ error: 'Database error finding user' });
        }

        if (!users || users.length === 0) {
            console.log(`[User Service POST /authenticate] Authentication failed: User not found for identifier: ${identifier}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            console.log(`[User Service POST /authenticate] Authentication failed: Password mismatch for user: ${user.username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        console.log(`[User Service POST /authenticate] Authentication successful for user: ${user.username}`);
        // Return essential user info including role for JWT claims
        res.status(200).json({
            message: 'Authentication successful',
            userId: user.id, // This becomes the 'sub' claim in the JWT
            username: user.username,
            email: user.email,
            role: user.role // <<< Include role in authentication response
        });

    } catch (error) {
        console.error('[User Service POST /authenticate] Authentication error:', error);
        res.status(500).json({ error: 'Internal server error during authentication' });
    }
});

// Get User by ID (GET /profiles/:userId)
app.get('/profiles/:userId', async (req, res) => {
    const userId = req.params.userId;
    console.log(`[User Service GET /profiles/:userId] Received request for user ID: ${userId}`);

    // TODO: Add Authorization Check here! Only allow fetching own profile or if admin.

    try {
        const { data, error } = await supabase
            .from('users')
            // --- SELECT 'role' column ---
            .select('id, username, email, created_at, role') // <<< Ensure 'role' is selected
            .eq('id', userId)
            .single(); // Use single() as we expect exactly one user

        console.log(`[User Service GET /profiles/:userId] Supabase query result for ${userId}:`, data, error);

        if (error) {
             if (error.code === 'PGRST116') {
                console.warn(`[User Service GET /profiles/:userId] User ${userId} not found in DB.`);
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('[User Service GET /profiles/:userId] Supabase error:', error);
            return res.status(500).json({ error: 'Database error fetching profile' });
        }

        if (!data) { // Redundant with single() error, but good safeguard
             console.warn(`[User Service GET /profiles/:userId] Supabase returned no data for ${userId} (after no error).`);
             return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[User Service GET /profiles/:userId] Found user ${userId}.`);
        res.status(200).json(data);

    } catch (error) {
        console.error('[User Service GET /profiles/:userId] Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error fetching profile' });
    }
});

// --- NEW: Update User by ID (PUT /profiles/:userId) ---
app.put('/profiles/:userId', async (req, res) => {
    const userId = req.params.userId; // Get the ID from the URL
    const { username, email, role } = req.body; // Get updated fields from the body
    console.log(`[User Service PUT /profiles/:userId] Received request to update user ID: ${userId}`);
    console.log('[User Service PUT /profiles/:userId] Request body:', req.body);

    // TODO: Add Authorization Check here! Only allow updating own profile (certain fields) or if admin (all fields).
    // Check the X-User-ID header to know who is making the request.

    // Basic validation for fields you expect to be updated
    if (!username || !email || !role) {
         // Note: Password updates should be handled separately
        console.warn(`[User Service PUT /profiles/:userId] Missing fields in body for user ${userId}.`);
        return res.status(400).json({ error: 'Username, email, and role are required for update' });
    }
     if (!['user', 'admin'].includes(role)) {
         console.warn(`[User Service PUT /profiles/:userId] Invalid role value "${role}" for user ${userId}.`);
         return res.status(400).json({ error: 'Invalid role value. Must be "user" or "admin".' });
     }


    try {
        const { data, error } = await supabase
            .from('users')
            .update({
                username: username,
                email: email,
                role: role, // Update the role
                updated_at: new Date().toISOString() // Update the updated_at timestamp
                // Do NOT update password_hash here unless it's a specific password change endpoint
            })
            .eq('id', userId) // Find the user by ID
            .select('id, username, email, created_at, role'); // Select updated fields to return

        console.log(`[User Service PUT /profiles/:userId] Supabase update result for ${userId}:`, data, error);

        if (error) {
             // Supabase returns an error if .update().eq().select() finds no rows or more than one (with single() at the end)
             // but it also returns error if it fails e.g. on constraints.
             // Check for 0 rows updated explicitly if needed, although select() returns data if rows were updated.
             if (error.code === 'PGRST116') { // Assuming this code indicates 0 rows updated
                  console.warn(`[User Service PUT /profiles/:userId] User ${userId} not found for update.`);
                  return res.status(404).json({ error: 'User not found' });
             }
             console.error('[User Service PUT /profiles/:userId] Supabase update error:', error);
             // Check for unique constraint violations if updating email/username
             if (error.code === '23505') { // PostgreSQL unique violation error code
                 return res.status(409).json({ error: 'Username or email already exists' });
             }
            return res.status(500).json({ error: 'Database error updating user' });
        }

         if (!data || data.length === 0) {
             // This can happen if the ID didn't match anything to update
              console.warn(`[User Service PUT /profiles/:userId] Supabase update returned no data for ${userId} (after no error). User not found?`);
              return res.status(404).json({ error: 'User not found' });
         }

        console.log(`[User Service PUT /profiles/:userId] User ${userId} updated successfully.`);
        res.status(200).json(data[0]); // Return the updated user object

    } catch (error) {
        console.error('[User Service PUT /profiles/:userId] Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error during user update' });
    }
});

// --- User and Property Deletion Endpoint ---
// DELETE /profiles/:userId
// Deletes the user from the users table AND calls the properties service
// to delete associated properties.
app.delete('/profiles/:userId', async (req, res) => { // <--- THIS IS THE MODIFIED FUNCTION
    const userId = req.params.userId; // Get the ID from the URL
    console.log(`[User Service DELETE /profiles/:userId] Received request for user ID: ${userId}`);

    // --- IMPORTANT: Add Authorization Check Here! ---
    // Before deleting anything, verify that the user making this request is authorized
    // to delete this user account (e.g., it's their own account, or the requester is an admin).
    // This logic must be implemented based on how you handle authentication/authorization
    // (e.g., checking JWT claims, session data, or calling an auth service).
    // If not authorized, return res.status(403).json({ error: 'Forbidden' });
    // --- End Authorization Check ---


    try {
        // 1. Attempt to delete the user from the 'users' table in the User Service's DB
        const { data: deletedUsers, error: userDeleteError } = await supabase
            .from('users')
            .delete()
            .eq('id', userId) // Delete WHERE id matches userId
            .select('id'); // Select the deleted ID to confirm deletion

        console.log(`[User Service DELETE /profiles/:userId] Supabase user delete result for ${userId}:`, deletedUsers, userDeleteError);

        if (userDeleteError) {
             console.error('[User Service DELETE /profiles/:userId] Supabase user delete error:', userDeleteError);
             // If the error is that the user wasn't found, return 404. Otherwise, 500.
             if (userDeleteError.code === 'PGRST116' || (deletedUsers && deletedUsers.length === 0)) {
                 console.warn(`[User Service DELETE /profiles/:userId] User ${userId} not found in DB.`);
                 return res.status(404).json({ error: 'User not found' });
             }
             return res.status(500).json({ error: userDeleteError.message || 'Database error deleting user' });
        }

         // Check if any user was actually deleted (redundant check after select('id') but safe)
         if (!deletedUsers || deletedUsers.length === 0) {
             console.warn(`[User Service DELETE /profiles/:userId] No rows deleted for user ID: ${userId} (after no Supabase error). This should not happen if select('id') was used on a matching row.`);
             return res.status(404).json({ error: 'User not found' });
         }

        console.log(`[User Service DELETE /profiles/:userId] User ${userId} deleted successfully from User Service DB.`);

        // --- 2. Call the Properties Service to delete related data ---
        // We only attempt this if the user was successfully deleted from the user service DB
        if (propertiesServiceUrl) { // Only attempt if the URL is configured
            const propertiesDeleteEndpoint = `${propertiesServiceUrl}/properties/user/${userId}`;
            console.log(`[User Service DELETE /profiles/:userId] Calling Properties Service endpoint: ${propertiesDeleteEndpoint}`);

            try {
                 // Make the API call to the Properties Service using axios.delete
                 // Axios throws an error for non-2xx status codes by default,
                 // which is exactly what we want here to catch failures in the Properties Service.
                 await axios.delete(propertiesDeleteEndpoint);

                 console.log(`[User Service DELETE /profiles/:userId] Properties Service call successful for user ${userId}.`);

                 // If both user deletion AND properties deletion calls succeeded, return 204
                 res.status(204).send();

            } catch (propertiesError) {
                 // This catch block handles errors specifically from the axios.delete call
                 console.error(`[User Service DELETE /profiles/:userId] Error calling Properties Service for user ${userId}:`, propertiesError.message || propertiesError);

                 // If the Properties Service call failed (network issue, Properties Service error, etc.),
                 // indicate a partial failure to the client. User was deleted, but properties might remain.
                 // Return 500 to signify that the complete operation did not succeed.
                 // You might include more details in the error response if propertiesError.response exists.
                 const errorDetails = propertiesError.response?.data?.error || propertiesError.message;
                 res.status(500).json({ error: `Failed to delete associated properties: ${errorDetails}` });
            }
        } else {
             // Case where PROPERTIES_SERVICE_URL was not set
             console.warn(`[User Service DELETE /profiles/:userId] PROPERTIES_SERVICE_URL not configured. Skipping properties cleanup for user ${userId}.`);
             // User was deleted, but cleanup was skipped. Return 204, but ideally this warning
             // is addressed in deployment configuration.
             res.status(204).send();
        }


    } catch (err) {
        // This catch block handles unexpected errors during the *user* deletion process
        // before or outside the Properties Service call.
        console.error('[User Service DELETE /profiles/:userId] Unhandled error during user deletion process:', err);
        res.status(500).json({ error: 'Internal server error during user deletion process' });
    }
});


// Get User by ID (GET /profiles/:userId) - This seems duplicated, check your code
// I will include the previous definition, assume this was meant to be kept.
/*
app.get('/profiles/:userId', async (req, res) => {
    // ... (Keep the logic for GET /profiles/:userId from before) ...
     const userId = req.params.userId;
    console.log(`[User Service GET /profiles/:userId] Received request for user ID: ${userId}`);

    // TODO: Add Authorization Check here! Only allow fetching own profile or if admin.

    try {
        const { data, error } = await supabase
            .from('users')
            // --- SELECT 'role' column ---
            .select('id, username, email, created_at, role') // <<< Ensure 'role' is selected
            .eq('id', userId)
            .single(); // Use single() as we expect exactly one user

        console.log(`[User Service GET /profiles/:userId] Supabase query result for ${userId}:`, data, error);

        if (error) {
             if (error.code === 'PGRST116') {
                console.warn(`[User Service GET /profiles/:userId] User ${userId} not found in DB.`);
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('[User Service GET /profiles/:userId] Supabase error:', error);
            return res.status(500).json({ error: 'Database error fetching profile' });
        }

        if (!data) { // Redundant with single() error, but good safeguard
             console.warn(`[User Service GET /profiles/:userId] Supabase returned no data for ${userId} (after no error).`);
             return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[User Service GET /profiles/:userId] Found user ${userId}.`);
        res.status(200).json(data);

    } catch (error) {
        console.error('[User Service GET /profiles/:userId] Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error fetching profile' });
    }
});
*/

module.exports = app; // <--- ADD THIS LINE TO EXPORT THE APP INSTANCE
 
// // --- Start Server ---
// app.listen(port, () => {
//     console.log(`User Service listening at http://localhost:${port}`);
// });