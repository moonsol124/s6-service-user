// index.js (user-service)
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const supabase = require('./supabaseClient'); // Import the configured Supabase client
require('dotenv').config();

const app = express();
const port = process.env.USER_SERVICE_PORT || 3001;

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


// --- NEW: Delete User by ID (DELETE /profiles/:userId) ---
app.delete('/profiles/:userId', async (req, res) => {
    const userId = req.params.userId; // Get the ID from the URL
    console.log(`[User Service DELETE /profiles/:userId] Received request for user ID: ${userId}`);

    // TODO: Add Authorization Check here! Only allow deleting own profile or if admin.
    // Check the X-User-ID header forwarded by the Gateway and query the DB to see if that user has the 'admin' role.

    try {
         const { data, error } = await supabase
            .from('users')
            .delete() // Use delete()
            .eq('id', userId) // Delete WHERE id matches userId
             // Optionally select the deleted ID or count to check if a row was affected
            .select('id'); // Selecting 'id' will return an array of the deleted IDs

        console.log(`[User Service DELETE /profiles/:userId] Supabase delete result for ${userId}:`, data, error);

        if (error) {
             // Supabase delete might return an error even if 0 rows matched, depending on version/syntax.
             // Check specifically for no rows affected if possible, or assume error means something else failed.
             console.error('[User Service DELETE /profiles/:userId] Supabase delete error:', error);
             return res.status(500).json({ error: 'Database error deleting user' });
        }

         // Check if any rows were actually deleted
         if (!data || data.length === 0) {
             console.warn(`[User Service DELETE /profiles/:userId] No rows deleted for user ID: ${userId}. User not found?`);
             return res.status(404).json({ error: 'User not found' });
         }


        console.log(`[User Service DELETE /profiles/:userId] User ${userId} deleted successfully.`);
        // Return a success response (e.g., 204 No Content is standard for successful delete)
        res.status(204).send(); // 204 No Content

    } catch (error) {
        console.error('[User Service DELETE /profiles/:userId] Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error during user deletion' });
    }
});


app.listen(port, () => {
    console.log(`User Service listening at http://localhost:${port}`);
});