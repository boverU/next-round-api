# NextRound API — production image.
# Node 20 (package.json engines: >=20). Kept as a single stage: the app is plain
# JS with no build step, and we intentionally keep devDependencies so
# node-pg-migrate can run migrations at container startup.
FROM node:20-alpine

WORKDIR /app

# Install dependencies against the lockfile first for layer caching. All deps
# (incl. node-pg-migrate) are needed — migrations run on boot.
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 4000

# Entry runs pending migrations, then starts the server.
ENTRYPOINT ["./docker-entrypoint.sh"]
