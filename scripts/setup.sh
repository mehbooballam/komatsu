#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Komatsu Regulatory Risk Dashboard"
echo " Local Development Setup"
echo "========================================"
echo ""

DB_USER="${DB_USER:-komatsu}"
DB_PASS="${DB_PASS:-komatsu_dev_2024}"
DB_NAME="${DB_NAME:-komatsu_dev}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

# 1. Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found v$(node -v))"
  exit 1
fi
echo "  Node.js $(node -v) OK"

DB_MODE="psql"
if ! command -v psql &> /dev/null; then
  if command -v docker &> /dev/null && docker info &> /dev/null; then
    DB_MODE="docker"
    echo "  psql not found — using Docker for PostgreSQL"
  else
    echo "ERROR: Neither the PostgreSQL client (psql) nor a running Docker was found."
    echo "  macOS:   brew install postgresql@16"
    echo "  Ubuntu:  sudo apt install postgresql-client-16"
    echo "  Windows: install Docker Desktop and start it, then re-run this script"
    exit 1
  fi
else
  echo "  psql OK"
fi

# 2. Set up .env file
echo ""
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists — skipping"
fi

# 3. Create database user and database
echo ""
echo "Setting up PostgreSQL database..."

if [ "$DB_MODE" = "docker" ]; then
  # A dedicated container on its own port, so it never clashes with another
  # Postgres already bound to 5432.
  DB_CONTAINER="${DB_CONTAINER:-komatsu-dev-postgres}"
  DB_PORT="${DB_DOCKER_PORT:-5433}"

  if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    docker start "$DB_CONTAINER" > /dev/null
    echo "  Started existing container '$DB_CONTAINER'"
  else
    docker run -d --name "$DB_CONTAINER" \
      -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB="$DB_NAME" \
      -p "$DB_PORT:5432" postgres:17-alpine > /dev/null
    echo "  Created container '$DB_CONTAINER' on port $DB_PORT"
  fi

  echo "  Waiting for PostgreSQL to accept connections..."
  for _ in $(seq 1 60); do
    docker exec "$DB_CONTAINER" pg_isready -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" &> /dev/null && break
    sleep 1
  done

  DATABASE_URL="postgresql://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"
  sed -i.bak "s#^DATABASE_URL=.*#DATABASE_URL=$DATABASE_URL#" .env && rm -f .env.bak
  echo "  Set DATABASE_URL in .env to port $DB_PORT"

# Check if we can connect to PostgreSQL
elif ! psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "SELECT 1" &> /dev/null; then
  echo "WARNING: Cannot connect as postgres superuser."
  echo "  If the DB user and database already exist, that's fine — continuing."
  echo "  Otherwise, create them manually:"
  echo ""
  echo "    createuser -h $DB_HOST -p $DB_PORT -U postgres -P $DB_USER"
  echo "    createdb -h $DB_HOST -p $DB_PORT -U postgres -O $DB_USER $DB_NAME"
  echo ""
else
  # Create user if not exists
  if psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    echo "  User '$DB_USER' already exists"
  else
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
    echo "  Created user '$DB_USER'"
  fi

  # Create database if not exists
  if psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
    echo "  Database '$DB_NAME' already exists"
  else
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    echo "  Created database '$DB_NAME'"
  fi
fi

# 4. Install dependencies
echo ""
echo "Installing Node.js dependencies..."
npm install

# 5. Run migrations
echo ""
echo "Running database migrations..."
npx tsx scripts/migrate.ts

# 6. Seed data
echo ""
echo "Seeding database..."
npx tsx scripts/run-seed.ts

echo ""
echo "========================================"
echo " Setup complete!"
echo "========================================"
echo ""
echo "Start the development server:"
echo "  npm run dev"
echo ""
echo "Open http://localhost:3000"
echo ""
echo "Sign in with the admin login printed above, then upload your alerts on the Imports page."
