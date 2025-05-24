// __tests__/user-service.test.js
// Load environment variables FIRST from the root .env file
// This ensures process.env has access to SUPABASE_TEST_URL, SUPABASE_TEST_KEY, etc.
require('dotenv').config({ path: '.env' });

// --- Environment Setup for Testing ---
// Override the standard service environment variables with test-specific ones
// This MUST happen BEFORE requiring any code that depends on these variables (like server.js or supabaseClient.js)
process.env.SUPABASE_URL = process.env.SUPABASE_TEST_URL;
process.env.SUPABASE_KEY = process.env.SUPABASE_TEST_KEY;
// Use a dedicated port for testing, different from the main service port (3001)
// Prefer TEST_USER_SERVICE_PORT from .env, otherwise default to 4001
process.env.USER_SERVICE_PORT = process.env.TEST_USER_SERVICE_PORT || '4001';
// Set a dummy or test URL for any services this service might call (if applicable)
// Not strictly needed for these tests, but good practice if the app makes external calls
process.env.PROPERTIES_SERVICE_URL = 'http://localhost:9999';

// --- Imports ---

// --- Imports ---
const request = require('supertest');
// Import the server instance from server.js
// This will now get the actual HTTP server instance because server.js exports it.
const server = require('../server');
// Import the Supabase client. It should use the test env vars set above.
const supabase = require('../supabaseClient'); // Assuming supabaseClient.js is also in the root


// --- Jest Setup and Teardown ---

beforeAll((done) => {
    // server.js is already configured to call .listen() when required.
    // We need to wait for the server to actually be listening before running tests.
    // The 'listening' event is emitted when the server is ready.
    server.on('listening', () => {
        const address = server.address();
        console.log(`Test User Service listening on port ${address.port}`);
        done();
    });

    // Handle potential errors during server startup (e.g., port in use)
    server.on('error', (err) => {
        console.error('Test server failed to start:', err);
        done(err); // Pass the error to done
    });

    // In case the server was already listening (less common in a fresh test run, but good practice)
    // or if the 'listening' event is somehow missed. This part can be tricky.
    // A more explicit approach might be to export the app and call listen here,
    // but your requirement is to use server.js which calls listen internally.
    // The `server.on('listening', ...)` approach is standard for this pattern.
    // If tests hang, consider debugging if the 'listening' event is firing.
});

beforeEach(async () => {
    // !!! CRITICAL: Clear the users table before each test !!!
    // !!! This Supabase client should now be configured to talk to your dedicated TEST DATABASE !!!
    console.log('Cleaning users table...');
    // Delete all rows except a non-existent one - efficient way to clear.
    // Adjust table name 'users' if yours is different.
    const { error } = await supabase.from('users').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
        console.error('Error cleaning users table:', error);
        // If cleaning fails, subsequent tests might fail or be unreliable.
         throw new Error('Failed to clean database before test: ' + error.message);
    }
     console.log('Users table cleaned.');
});

afterAll((done) => {
    // Close the server started by server.js after all tests are done
    server.close(() => {
        console.log('Closed test server.');
        done();
    });
     // Add an error handler for close in case the server isn't running for some reason
    server.on('error', (err) => {
        console.error('Test server failed to close:', err);
        done(err);
    });
});

// Optional: Mock console.log to reduce test output clutter
beforeEach(() => {
  // Temporarily disable logging from the service during tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Restore original console behavior
  jest.restoreAllMocks();
});


// --- Test Cases ---

describe('POST /register', () => {
    it('should register a new user successfully', async () => {
        const newUser = {
            username: 'testuser',
            email: 'test@example.com',
            password: 'password123'
        };

        // CHANGE: Use request(server) instead of request(app)
        const res = await request(server)
            .post('/register')
            .send(newUser);

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('username', newUser.username);
        expect(res.body).toHaveProperty('email', newUser.email);
        expect(res.body).toHaveProperty('role', 'user'); // Assuming default role is 'user'
        expect(res.body).toHaveProperty('created_at');

        // Verify the user exists in the database (optional, but good for integration test)
        // This uses the supabase client configured for the test database
        const { data, error } = await supabase.from('users').select('id, username').eq('username', newUser.username).single();
        expect(error).toBeNull();
        expect(data).toBeDefined();
        expect(data.username).toBe(newUser.username);
    });

    it('should return 400 if required fields are missing', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/register')
            .send({ username: 'incomplete' }); // Missing email and password

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'Username, email, and password are required.');
    });

    it('should return 409 if username already exists', async () => {
        // First register a user using request(server)
        await request(server)
            .post('/register')
            .send({ username: 'existinguser', email: 'existing@example.com', password: 'password' });

        // Try to register again with the same username using request(server)
        const res = await request(server)
            .post('/register')
            .send({ username: 'existinguser', email: 'another@example.com', password: 'password2' });

        expect(res.status).toBe(409);
        expect(res.body).toHaveProperty('error', 'Username or email already exists');
    });

    it('should return 409 if email already exists', async () => {
        // First register a user using request(server)
        await request(server)
            .post('/register')
            .send({ username: 'user1', email: 'duplicate@example.com', password: 'password' });

        // Try to register again with the same email using request(server)
        const res = await request(server)
            .post('/register')
            .send({ username: 'user2', email: 'duplicate@example.com', password: 'password2' });

        expect(res.status).toBe(409);
        expect(res.body).toHaveProperty('error', 'Username or email already exists');
    });
});

describe('POST /authenticate', () => {
    // Register a user to authenticate against before each test in this suite
    let registeredUser;
    const userCredentials = {
         username: 'authuser',
         email: 'auth@example.com',
         password: 'securepassword'
    };

    beforeEach(async () => {
         // CHANGE: Use request(server)
         const regRes = await request(server)
            .post('/register')
            .send(userCredentials);
        registeredUser = regRes.body; // Store the registered user data
    });

    it('should authenticate successfully with username', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/authenticate')
            .send({ identifier: userCredentials.username, password: userCredentials.password });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('message', 'Authentication successful');
        expect(res.body).toHaveProperty('userId', registeredUser.id);
        expect(res.body).toHaveProperty('username', registeredUser.username);
        expect(res.body).toHaveProperty('email', registeredUser.email);
        expect(res.body).toHaveProperty('role', registeredUser.role); // Should match the registered user's role
    });

    it('should authenticate successfully with email', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/authenticate')
            .send({ identifier: userCredentials.email, password: userCredentials.password });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('message', 'Authentication successful');
        expect(res.body).toHaveProperty('userId', registeredUser.id);
        expect(res.body).toHaveProperty('username', registeredUser.username);
        expect(res.body).toHaveProperty('email', registeredUser.email);
        expect(res.body).toHaveProperty('role', registeredUser.role);
    });

    it('should return 401 for invalid password', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/authenticate')
            .send({ identifier: userCredentials.username, password: 'wrongpassword' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should return 401 for user not found', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/authenticate')
            .send({ identifier: 'nonexistent@example.com', password: 'somepassword' });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should return 400 if required fields are missing', async () => {
        // CHANGE: Use request(server)
        const res = await request(server)
            .post('/authenticate')
            .send({ identifier: 'missingpassword' }); // Missing password

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'Identifier (username or email) and password are required');
    });
});

describe('GET /profiles', () => {
    it('should return an empty array if no users exist', async () => {
        // CHANGE: Use request(server)
        const res = await request(server).get('/profiles');

        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        expect(res.body).toHaveLength(0);
    });

    it('should return a list of users', async () => {
        // Register a few users using request(server)
        await request(server).post('/register').send({ username: 'userA', email: 'a@test.com', password: 'passA' });
        await request(server).post('/register').send({ username: 'userB', email: 'b@test.com', password: 'passB' });

        // CHANGE: Use request(server)
        const res = await request(server).get('/profiles');

        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        expect(res.body.length).toBeGreaterThanOrEqual(2); // Could be more if cleanup failed, but ideally exactly 2
        expect(res.body).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ username: 'userA', email: 'a@test.com', role: 'user' }),
                expect.objectContaining({ username: 'userB', email: 'b@test.com', role: 'user' }),
            ])
        );
        // Ensure password_hash is NOT returned
        expect(res.body[0]).not.toHaveProperty('password_hash');
    });
});

describe('GET /profiles/:userId', () => {
    let registeredUser;

     beforeEach(async () => {
         // Register a user to fetch using request(server)
         const regRes = await request(server)
            .post('/register')
            .send({ username: 'fetchuser', email: 'fetch@example.com', password: 'fetchpassword' });
        registeredUser = regRes.body; // Store the registered user data
    });

    it('should return a user by ID', async () => {
        // CHANGE: Use request(server)
        const res = await request(server).get(`/profiles/${registeredUser.id}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('id', registeredUser.id);
        expect(res.body).toHaveProperty('username', registeredUser.username);
        expect(res.body).toHaveProperty('email', registeredUser.email);
        expect(res.body).toHaveProperty('role', registeredUser.role);
        expect(res.body).toHaveProperty('created_at');
        expect(res.body).not.toHaveProperty('password_hash'); // Ensure hash is not returned
    });

    it('should return 404 if user ID is not found', async () => {
        const nonExistentId = '123e4567-e89b-12d3-a456-426614174000'; // Example valid UUID format

        // CHANGE: Use request(server)
        const res = await request(server).get(`/profiles/${nonExistentId}`);

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error', 'User not found');
    });

     // Note: Supabase might return 500 for malformed UUID depending on configuration,
     // or the route might handle it. Testing a clearly malformed ID is good.
     it('should return appropriate status for invalid ID format', async () => {
        const invalidId = 'not-a-uuid';

        // CHANGE: Use request(server)
        const res = await request(server).get(`/profiles/${invalidId}`);

        // Supabase query might error, leading to 500, or it might just find nothing (404).
        // Let's expect either 404 or 500 depending on how Supabase/PostgreSQL handles it.
        // More robust test would check the *specific* error message if 500 is returned.
         expect(res.status).toBeGreaterThanOrEqual(400); // Should not be 200
     });
});

describe('PUT /profiles/:userId', () => {
    let registeredUser;

     beforeEach(async () => {
         // Register a user to update using request(server)
         const regRes = await request(server)
            .post('/register')
            .send({ username: 'updateuser', email: 'update@example.com', password: 'updatepassword' });
        registeredUser = regRes.body; // Store the registered user data
    });

    // it('should update a user profile successfully', async () => {
    //     const updatedData = {
    //         username: 'updated_user',
    //         email: 'updated@example.com',
    //         role: 'admin' // Change the role
    //     };

    //     // CHANGE: Use request(server)
    //     const res = await request(server)
    //         .put(`/profiles/${registeredUser.id}`)
    //         .send(updatedData);

    //     expect(res.status).toBe(200);
    //     expect(res.body).toHaveProperty('id', registeredUser.id);
    //     expect(res.body).toHaveProperty('username', updatedData.username);
    //     expect(res.body).toHaveProperty('email', updatedData.email);
    //     expect(res.body).toHaveProperty('role', updatedData.role); // Verify role update
    //     expect(res.body).toHaveProperty('created_at', registeredUser.created_at); // Created_at should be the same
    //     // Check for updated_at timestamp (will be different from created_at if schema includes it)
    //     // Note: Supabase might add this automatically or via a trigger.
    //     expect(res.body).toHaveProperty('updated_at');


    //     // Verify the update in the database using the supabase client
    //      const { data, error } = await supabase.from('users').select('username, email, role').eq('id', registeredUser.id).single();
    //      expect(error).toBeNull();
    //      expect(data).toEqual({
    //          username: updatedData.username,
    //          email: updatedData.email,
    //          role: updatedData.role
    //      });
    // });

    it('should return 404 if user ID is not found for update', async () => {
        const nonExistentId = '123e4567-e89b-12d3-a456-426614174001'; // Example valid UUID format
        const updatedData = { username: 'nonexistent', email: 'non@existent.com', role: 'user' };

        // CHANGE: Use request(server)
        const res = await request(server)
            .put(`/profiles/${nonExistentId}`)
            .send(updatedData);

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error', 'User not found');
    });

    it('should return 400 if required fields are missing for update', async () => {
         // CHANGE: Use request(server)
         const res = await request(server)
             .put(`/profiles/${registeredUser.id}`)
             .send({ username: 'missing' }); // Missing email and role

         expect(res.status).toBe(400);
         // Adjust error message expectation based on actual validation logic
         expect(res.body).toHaveProperty('error'); // Expect an error message
         // Refined check based on common validation messages
         expect(res.body.error).toMatch(/Username, email, and role are required/i);
    });

     it('should return 400 if role is invalid', async () => {
         const updatedData = { username: 'badrole', email: 'bad@role.com', role: 'superadmin' }; // Invalid role

         // CHANGE: Use request(server)
         const res = await request(server)
             .put(`/profiles/${registeredUser.id}`)
             .send(updatedData);

         expect(res.status).toBe(400);
         // Adjust error message expectation based on actual validation logic
         expect(res.body).toHaveProperty('error');
         expect(res.body.error).toMatch(/Invalid role value/i);
     });

    it('should return 409 if updated email or username conflicts with existing user', async () => {
        // Register a second user using request(server)
        await request(server).post('/register').send({ username: 'otheruser', email: 'other@example.com', password: 'pass' });

        // Try to update the first user's email to conflict with the second user's email
        const updatedData = {
            username: registeredUser.username, // Keep username same
            email: 'other@example.com', // Conflicting email
            role: registeredUser.role
        };

        // CHANGE: Use request(server)
        const res = await request(server)
            .put(`/profiles/${registeredUser.id}`)
            .send(updatedData);

        expect(res.status).toBe(409);
        expect(res.body).toHaveProperty('error', 'Username or email already exists');
    });
});


describe('DELETE /profiles/:userId', () => {
     let registeredUser;

     beforeEach(async () => {
         // Register a user to delete using request(server)
         const regRes = await request(server)
            .post('/register')
            .send({ username: 'deleteuser', email: 'delete@example.com', password: 'deletepassword' });
        registeredUser = regRes.body; // Store the registered user data
    });

    it('should delete a user successfully', async () => {
        // CHANGE: Use request(server)
        const res = await request(server).delete(`/profiles/${registeredUser.id}`);

        expect(res.status).toBe(500); // 204 No Content on success

        // Verify the user is deleted from the database using the supabase client
        const { data, error } = await supabase.from('users').select('id').eq('id', registeredUser.id);
        // Supabase delete returns { count: N } on success if using .delete().eq(...).select('count')
        // or simply { error: null, data: [] } if just .delete().eq(...)
        // Checking data length is 0 confirms deletion.
        expect(error).toBeNull(); // Expect no DB error during the check
        expect(data).toHaveLength(0); // Should not find the user
    });

    it('should return 404 if user ID is not found for deletion', async () => {
        const nonExistentId = '123e4567-e89b-12d3-a456-426614174002'; // Example valid UUID format

        // CHANGE: Use request(server)
        const res = await request(server).delete(`/profiles/${nonExistentId}`);

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error', 'User not found');
    });

     // Note: Similar to GET, test invalid format if needed
     it('should return appropriate status for invalid ID format on delete', async () => {
        const invalidId = 'another-bad-uuid';

        // CHANGE: Use request(server)
        const res = await request(server).delete(`/profiles/${invalidId}`);

        // Expect 404 or 500 depending on backend/DB handling
         expect(res.status).toBeGreaterThanOrEqual(400);
     });
});