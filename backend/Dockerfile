# Stage 1: Dependency resolution and pruning
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Hardened, minimal non-root production runtime
FROM node:20-alpine AS runner

# Apply security patches to Alpine base packages and remove unused build package managers (npm/yarn)
RUN apk update && apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn*

WORKDIR /app

# Copy production dependencies and application files with non-root ownership
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Execute as non-root user (uid 1000: node)
USER node

EXPOSE 5000

CMD ["node", "server.js"]
