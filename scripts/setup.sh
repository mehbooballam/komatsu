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

if ! command -v psql &> /dev/null; then
  echo "ERROR: PostgreSQL client (psql) not found."
  echo "  macOS:  brew install postgresql@16"
  echo "  Ubuntu: sudo apt install postgresql-client-16"
  exit 1
fi
echo "  psql OK"

# 2. Create database user and database
echo ""
echo "Setting up PostgreSQL database..."

# Check if we can connect to PostgreSQL
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "SELECT 1" &> /dev/null; then
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

# 3. Set up .env file
echo ""
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists — skipping"
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
echo "Demo accounts:"
echo "  Admin:   demo@komatsu.com / Demo1234!"
echo "  Manager: manager@komatsu.com / Manager1234!"
echo "  Owner:   owner@komatsu.com / Owner1234!"
