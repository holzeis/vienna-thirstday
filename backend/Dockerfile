# ---- deps: install once, reused by the build stage ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ---- build: compile TypeScript to dist/ ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: only production deps + compiled output ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

# node:22-alpine already has a "node" user at uid/gid 1000 - reuse it rather
# than creating a new one, and own the app files it needs to read.
# USER must be the numeric uid, not the name ("node") - k8s's
# securityContext.runAsNonRoot can only verify a numeric uid baked into the
# image; a named user fails with "cannot verify user is non-root"
# (CreateContainerConfigError) before the container ever starts (see
# image-watcher/Dockerfile for the same fix, hit there first).
RUN chown -R 1000:1000 /app
USER 1000

EXPOSE 4000
CMD ["node", "dist/index.js"]
