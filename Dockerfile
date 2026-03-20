FROM node:18-alpine
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install ALL dependencies from the root (this will handle both root and backend)
RUN npm install

# Copy the rest of the application
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000
CMD ["npm", "start"]
