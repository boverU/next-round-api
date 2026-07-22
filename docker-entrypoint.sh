#!/bin/sh
# Run pending DB migrations, then start the API. node-pg-migrate reads
# DATABASE_URL straight from the environment (no .env file in the container).
set -e

echo "[entrypoint] waiting for Postgres..."
# node-pg-migrate will fail fast if the DB is unreachable; retry a few times so
# a cold `docker compose up` (DB still booting) doesn't crash the API.
tries=0
until node_modules/.bin/node-pg-migrate up; do
  tries=$((tries + 1))
  if [ "$tries" -ge 15 ]; then
    echo "[entrypoint] migrations failed after $tries attempts, giving up." >&2
    exit 1
  fi
  echo "[entrypoint] migration attempt $tries failed; retrying in 3s..."
  sleep 3
done

echo "[entrypoint] migrations applied; starting API."
exec node server.js
