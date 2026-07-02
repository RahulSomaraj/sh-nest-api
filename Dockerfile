# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install ALL deps (incl. dev) using the lockfile for a reproducible build.
COPY package.json package-lock.json ./
RUN npm ci

# Compile the Nest app to ./dist
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Production stage ----------
FROM node:20-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app

# Only production deps. bcrypt & sharp pull prebuilt Linux binaries here,
# so they match the container's glibc (not the host's Windows build).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3008
CMD ["node", "dist/main"]
