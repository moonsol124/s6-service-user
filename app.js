// index.js (user-service)
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const supabase = require('./supabaseClient'); // Import the configured Supabase client
require('dotenv').config();

const app = express();
const port = process.env.USER_SERVICE_PORT || 3001; // Use a different port than OAuth server

const SALT_ROUNDS = 10; // Cost factor for bcrypt hashing

// Middleware
app.use(bodyParser.json()); // Parse JSON bodies
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- Routes ---

// User Registration
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    try {
        // Check if user already exists (username or email)
        const { data: existingUsers, error: checkError } = await supabase
            .from('users')
            .select('id')
            .or(`username.eq.${username},email.eq.${email}`);

        if (checkError) {
            console.error('Supabase check error:', checkError);
            return res.status(500).json({ error: 'Database error checking user' });
        }

        if (existingUsers && existingUsers.length > 0) {
            return res.status(409).json({ error: 'Username or email already exists' }); // 409 Conflict
        }

        // Hash the password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert the new user
        const { data, error: insertError } = await supabase
            .from('users')
            .insert([{ username, email, password_hash: passwordHash }])
            .select('id, username, email, created_at'); // Select the fields to return

        if (insertError) {
            console.error('Supabase insert error:', insertError);
            return res.status(500).json({ error: 'Failed to register user' });
        }

        if (!data || data.length === 0) {
             console.error('Supabase insert error: No data returned after insert');
             return res.status(500).json({ error: 'Failed to register user (no data)' });
        }

        // Return the newly created user's info (excluding password hash)
        res.status(201).json(data[0]);

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/profiles', async (req, res) => {
    console.log(`[User Service] Received request for GET /profiles`); // ADD THIS LINE

    // Ideally, this endpoint should also be protected (e.g., require specific scope/role)
    // For now, we assume access is granted if the request reaches here via the gateway
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, email, created_at'); // Select only non-sensitive data

        if (error) {
            console.error('Supabase fetch all profiles error:', error);
            return res.status(500).json({ error: 'Database error fetching profiles' });
        }
        res.status(200).json(data || []);
    } catch (error) {
        console.error('Fetch all profiles error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User Authentication
// This endpoint will be called by the OAuth server
app.post('/authenticate', async (req, res) => {
    const { identifier, password } = req.body; // identifier can be username or email

    if (!identifier || !password) {
        return res.status(400).json({ error: 'Identifier (username or email) and password are required' });
    }

    try {
        // Find the user by username or email
        const { data: users, error } = await supabase
            .from('users')
            .select('id, username, email, password_hash')
            .or(`username.eq.${identifier},email.eq.${identifier}`)
            .limit(1); // Optimization: we only need one match

        if (error) {
            console.error('Supabase find user error:', error);
            return res.status(500).json({ error: 'Database error finding user' });
        }

        if (!users || users.length === 0) {
            console.log(`Authentication failed: User not found for identifier: ${identifier}`);
            return res.status(401).json({ error: 'Invalid credentials' }); // User not found
        }

        const user = users[0];

        // Compare the provided password with the stored hash
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            console.log(`Authentication failed: Password mismatch for user: ${user.username}`);
            return res.status(401).json({ error: 'Invalid credentials' }); // Password doesn't match
        }

        // Authentication successful
        console.log(`Authentication successful for user: ${user.username}`);
        // Return user ID and potentially username/email (but NOT the hash)
        res.status(200).json({
            message: 'Authentication successful',
            userId: user.id,
            username: user.username,
            email: user.email
        });

    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Optional: Get User Profile (Example of a protected endpoint *within* the user service)
// In a real system, you'd likely protect this with some form of internal auth or token
app.get('/profile/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, email, created_at') // Select only non-sensitive data
            .eq('id', userId)
            .single(); // Expects exactly one row or null

        if (error) {
            // Supabase returns an error if .single() finds no rows or more than one
             if (error.code === 'PGRST116') { // Code for 'Standard error response' usually meaning 0 rows for .single()
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('Supabase fetch profile error:', error);
            return res.status(500).json({ error: 'Database error fetching profile' });
        }

        if (!data) {
             return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json(data);

    } catch (error) {
        console.error('Fetch profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.listen(port, () => {
    console.log(`User Service listening at http://localhost:${port}`);
});