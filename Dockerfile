FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm ci --only=production
RUN cd backend && npm ci --only=production
COPY . .
RUN mkdir -p logs
EXPOSE 3000
CMD ["npm", "start"]
