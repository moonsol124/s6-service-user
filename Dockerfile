# Dockerfile for user-service

# Step 1: Base Image
FROM node:18-alpine As base

# Step 2: Working Directory
WORKDIR /app

# Step 3: Copy package files
COPY package*.json ./

# Step 4: Install production dependencies
# Make sure bcrypt native dependencies can be built on Alpine
# May need build-essentials if bcrypt fails to install
RUN apk add --no-cache python3 make g++ && \
    npm ci --only=production && \
    apk del python3 make g++ # Clean up build tools

# Step 5: Copy application code
COPY . .

# Step 6: Expose the application port
# Your app uses process.env.USER_SERVICE_PORT || 3001
EXPOSE 3001

# Step 7: Run command
# Assumes your main file is index.js
CMD ["node", "app.js"]