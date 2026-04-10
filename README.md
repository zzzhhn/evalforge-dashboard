# EvalForge

**Structured human evaluation platform for video generation models.**

EvalForge provides a complete workflow for organizing, executing, and analyzing human evaluations of AI-generated videos. It supports multi-dimension scoring (D1–D6), multi-role access control, real-time anti-cheat detection, and analytics dashboards — designed for research teams running structured evaluation campaigns.

## Features

- **Evaluation Workstation** — Video player with keyboard shortcuts (1–5 scoring, Space play/pause), dimension tabs, failure tag selection, and automatic task progression
- **Multi-Dimension Scoring** — 6 evaluation dimensions (Visual Quality, Motion Rationality, Temporal Consistency, Subject Consistency, Text Alignment, Aesthetic Quality) with configurable anchors and test points
- **Anti-Cheat System** — Watch ratio tracking, dwell time enforcement, fixed-value detection, and rapid-submit detection with severity-based event logging
- **Role-Based Access Control** — 6 roles (Admin, Researcher, Annotator, Vendor Annotator, Reviewer, Viewer) with CASL-powered attribute-based permissions
- **Analytics Dashboard** — Model ranking bar charts, dimension radar charts, and per-dimension score comparison using Recharts
- **Sample Management** — Video asset inventory with per-item evaluation progress tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript, React 19 |
| UI | Tailwind CSS 4, shadcn/ui (base-nova) |
| Database | PostgreSQL (Neon) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Auth | JWT (jose) + bcryptjs, HTTP-only cookies |
| Permissions | CASL (ABAC) |
| Charts | Recharts |

## Getting Started

### Prerequisites

- Node.js 20+
- A PostgreSQL database (recommended: [Neon](https://neon.tech) free tier)

### Setup

```bash
# Clone
git clone https://github.com/zzzhhn/evalforge-dashboard.git
cd evalforge-dashboard

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# Generate Prisma client + run migrations
npx prisma generate
npx prisma migrate dev --name init

# Seed demo data
npm run db:seed

# Start dev server
npm run dev
```

### Demo Credentials

After seeding, you can log in with:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@evalforge.dev | admin123 |
| Annotator | alice@evalforge.dev | eval123 |

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/        # Login page + server action
│   ├── (main)/              # Authenticated routes
│   │   ├── tasks/           # Evaluation task list
│   │   ├── progress/        # Personal progress dashboard
│   │   ├── workstation/     # Video evaluation workstation
│   │   └── admin/           # Admin: samples + analytics
│   └── api/auth/            # Logout route
├── components/
│   ├── admin/               # Analytics charts
│   ├── layout/              # Sidebar + topbar
│   ├── workstation/         # Video player, scoring panel
│   └── ui/                  # shadcn/ui components
├── lib/
│   ├── auth.ts              # JWT token management
│   ├── db.ts                # Prisma client singleton
│   ├── permissions.ts       # CASL ability definitions
│   └── utils.ts             # cn() helper
└── middleware.ts             # Auth guard + route protection

prisma/
├── schema.prisma            # Database schema (9 models)
└── seed.ts                  # Demo data seeder
```

## Database Schema

```
User ──< EvaluationItem ──< Score
                │              │
                │              └── Dimension
                │
                └──< AntiCheatEvent

Model ──< VideoAsset ──< EvaluationItem
              │
              └── Prompt

Dimension (self-referential tree) ──< FailureTag
```

## Deployment

Deployed on [Vercel](https://vercel.com) with Neon PostgreSQL.

```bash
# Build for production
npm run build

# Or deploy via Vercel CLI
vercel --prod
```

## License

MIT
