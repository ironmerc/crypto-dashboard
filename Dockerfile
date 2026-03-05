# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application files
COPY . .

# Run tests - ensuring build only succeeds if tests pass in the container environment
RUN npm run test -- --run

# Build the application
RUN npm run build

# Production Stage - Nginx
FROM nginx:alpine

# Copy the custom Nginx config for Single Page Applications
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
