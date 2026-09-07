# ---- build: compile the Vite app into static assets ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .

# The app is served behind an nginx reverse proxy that forwards /api to the
# backend (see nginx/default.conf.template), so the default same-origin path
# works for local dev, docker-compose, and Kubernetes alike without a rebuild.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# A small incrementing build number (git commit count on main - see
# docker-publish.yml), shown subtly in the UI so you can tell at a glance
# whether a deploy actually picked up the latest build.
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build

# ---- runtime: nginx serving the static build + reverse-proxying /api ----
# nginx-unprivileged (same nginx image, maintained by the same vendor) runs
# as a real non-root user out of the box - uid 101, listening on 8080 since
# non-root can't bind port 80 - with /var/cache/nginx, /etc/nginx/conf.d
# (where the templated config below gets written at startup) and its pid
# file (/tmp/nginx.pid) already owned by that user. Plain nginx:alpine runs
# its master process as root; this avoids that instead of trying to
# re-plumb ownership/ports onto the stock image ourselves.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# Hostname:port of the backend service. In docker-compose this is the service
# name ("backend:4000"); in Kubernetes it's the backend Service's DNS name.
ENV BACKEND_HOST=backend:4000

EXPOSE 8080
