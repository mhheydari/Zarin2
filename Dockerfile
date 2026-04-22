FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p data

# Initialize database
RUN node src/db/init.js

EXPOSE 3000

CMD ["node", "src/server.js"]
