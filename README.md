# Komatsu Regulatory Risk Dashboard

A regulatory risk management dashboard built with Next.js, PostgreSQL, and TypeScript. Tracks regulatory alerts, scores them on a 4-factor model (market access, cost, HR, urgency), and surfaces prioritized risks with deadlines, assignments, and geographic breakdowns.

## Local Development Setup

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **PostgreSQL 16** — [postgresql.org/download](https://www.postgresql.org/download/)

### Quick Start (one command)

```bash
./scripts/setup.sh
```

This creates the database user/database, installs dependencies, runs migrations, and seeds demo data. Requires the `postgres` superuser to be accessible (default on macOS Homebrew and most Linux installs).

If `psql` isn't installed but Docker is running (typical on Windows — run the script from Git Bash), the script instead starts a `komatsu-dev-postgres` container (`postgres:17-alpine`) on port **5433** and points `DATABASE_URL` in `.env` at it. After a reboot, run `docker start komatsu-dev-postgres` before `npm run dev`.

### Manual Setup

#### 1. Install dependencies

```bash
npm install
```

#### 2. Create PostgreSQL database

```bash
createuser -P komatsu
# Enter password: komatsu_dev_2024

createdb -O komatsu komatsu_dev
```

Or via `psql`:

```sql
CREATE USER komatsu WITH PASSWORD 'komatsu_dev_2024';
CREATE DATABASE komatsu_dev OWNER komatsu;
```

#### 3. Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` match the seed scripts — no changes needed for local dev.

#### Account email

Workspace invitations and password resets send email through [Resend](https://resend.com/docs/api-reference/emails/send-email). Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in the server environment using a verified sender. Set `NEXTAUTH_URL` to the app's public HTTPS origin for production. For local development, the default loopback URL is supported. Keep [click tracking](https://resend.com/blog/introducing-custom-tracking-domain) disabled on the sending domain to avoid rewriting credential links. An instance without email configuration can still sign users in and out.

#### 4. Run migrations

```bash
npm run db:migrate
```

#### 5. Seed base data

```bash
npm run db:seed
```

#### 6. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### First Login

The seed creates the company, one admin login, the scoring policy, every ISO country and the product families — **no sample alerts**. Load your data from the **Imports** page (`.xlsx` or `.csv`; download a blank template there).

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@komatsu.com | Admin1234! |

Choose your own by setting `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before seeding, and change the password after first login. Re-running `npm run db:seed` never deletes data.

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:migrate` | Run database migrations |
| `npm run db:seed` | Seed database with demo data |
| `npm run db:reset` | Migrate + seed (full reset) |
| `npm run setup` | Install deps + migrate + seed |

## Architecture

- **Framework**: Next.js 16 App Router with TypeScript
- **Database**: PostgreSQL 16 (41 tables)
- **Auth**: Custom session-based auth with bcrypt passwords and SHA-256 token hashing
- **Styling**: Tailwind CSS 4 with Radix UI components
- **Charts**: Recharts

### Scoring Model

Alerts are scored on 4 factors, each rated 1, 3, 6, or 9:

- **Market Access** — revenue at risk
- **Cost to Implement** — compliance cost
- **Human Resources** — FTE required
- **Urgency** — time to deadline

**Raw score** = Market Access x Cost x HR x Urgency

| Band | Score Range |
|------|-------------|
| Low | 1 – 80 |
| Moderate | 81 – 323 |
| High | 324 – 1,295 |
| Critical | 1,296 – 6,561 |

Three escalation rules can override the band upward.

## Project Structure

```
src/
  app/              # Next.js App Router pages and API routes
    (dashboard)/    # Dashboard layout group
    api/            # REST API endpoints
  components/       # React components (ui/, dashboard/, alerts/)
  lib/              # Shared utilities (db, auth, scoring)
  db/
    migrations/     # SQL migration files
scripts/
  setup.sh          # One-command local setup
  migrate.ts        # Migration runner
  seed.ts           # Base data (company, admin, policy, countries, product families)
  run-seed.ts       # Seed runner (npm run db:seed)
templates/          # Blank import templates
```
