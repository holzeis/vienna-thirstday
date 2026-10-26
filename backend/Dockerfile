# syntax=docker/dockerfile:1

# ---- deps: all dependencies, reused by the build stage ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --legacy-peer-deps --no-audit --no-fund

# ---- build: compile TypeScript to dist/ ----
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production dependencies only, installed here so the runtime stage needs no package manager ----
FROM node:24-alpine AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund
# Gate: a known CRITICAL advisory in a production dependency fails the build (like proxy-addr 2.0.7 did). Build with
# `--build-arg NPM_AUDIT=report` to only print it, for example when an advisory has no fix yet and you accept the risk for now.
ARG NPM_AUDIT=enforce
RUN npm audit --omit=dev --audit-level=critical || [ "$NPM_AUDIT" != "enforce" ]

# ---- runtime ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
# Alpine security fixes published since the base image was built, a minimal init, and NO package managers:
# npm, yarn and corepack bring their own bundled dependencies (a common source of scanner findings) and nothing in this image runs them.
RUN apk upgrade --no-cache \
 && apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --chown=1000:1000 --from=prod-deps /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json ./
COPY --chown=1000:1000 --from=build /app/dist ./dist
COPY --chown=1000:1000 --from=build /app/drizzle ./drizzle

# USER must be the numeric uid, not the name ("node"): k8s's runAsNonRoot can only verify a numeric uid baked into the image.
USER 1000
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]