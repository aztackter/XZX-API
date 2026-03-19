FROM node:18-alpine
WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install ALL dependencies at once from root
RUN npm install --only=production

# Copy the rest of the application
COPY . .

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000
CMD ["npm", "start"]
