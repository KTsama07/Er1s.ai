FROM node:18-alpine

WORKDIR /app

# Copy package info and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy application source code
COPY . .

# Expose port (Cloud Run defaults to 8080 but handles process.env.PORT)
EXPOSE 3000

# Default command runs the web server.
# For the worker service, override this via Cloud Run configuration to `npm run worker`
CMD ["npm", "start"]
