// server.js (user-service-index.js)
// This file is the main entry point to start the Express server for the User Service

require('dotenv').config(); // Load environment variables

// Import the Express application instance from app.js
const app = require('./app');

// Get the port from environment variables, defaulting to 3001 (User Service default)
const port = process.env.USER_SERVICE_PORT || 3001;

// Start the server by calling listen on the imported app instance
// Store the returned server instance in a variable
const server = app.listen(port, () => {
    console.log(`User Service listening at http://localhost:${port}`);
    // Optional: Log other relevant environment variables at startup
    console.log(`  -> SUPABASE_URL: ${process.env.SUPABASE_URL ? 'Loaded' : 'Not Set!'}`);
    console.log(`  -> SUPABASE_KEY: ${process.env.SUPABASE_KEY ? 'Loaded' : 'Not Set!'}`);
    console.log(`  -> PROPERTIES_SERVICE_URL: ${process.env.PROPERTIES_SERVICE_URL || 'Not Set!'}`);
});

// Optional: Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    // Use the 'server' instance to close
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// EXPORT the server instance so other modules (like tests) can access it
module.exports = server;