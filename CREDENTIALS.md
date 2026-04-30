# EvalForge Demo Credentials

> Last seeded: 2026-04-30 (Platform v2 replica — full schema)

## Accounts

| Email | Password | Role | Account Type | Notes |
|-------|----------|------|--------------|-------|
| admin@evalforge.dev | admin123 | ADMIN | INTERNAL | Full admin access |
| alice@evalforge.dev | eval123 | ANNOTATOR | INTERNAL | Group Admin (Internal Reviewers) |
| bob@evalforge.dev | eval123 | ANNOTATOR | INTERNAL | |
| charlie@evalforge.dev | eval123 | ANNOTATOR | INTERNAL | |
| diana@evalforge.dev | eval123 | VENDOR_ANNOTATOR | VENDOR | Group Admin (Vendor Pool A) |
| eve@evalforge.dev | eval123 | VENDOR_ANNOTATOR | VENDOR | |
| viewer@evalforge.dev | view123 | VIEWER | INTERNAL | Read-only stakeholder |

## Demo Data

### Models (3)
- **CogVideoX-5B** (T2V, THUDM)
- **Mochi-1** (T2V, Genmo) — used for arena pairing
- **Stable Video Diffusion** (I2V, Stability AI)

### Evaluation Packages (4)
- **T2V_Scoring_{date}** — SCORING mode, 6 video assets across 2 T2V models
- **I2V_Scoring_{date}** — SCORING mode, 1 video asset
- **T2V_Arena_{date}** — ARENA mode, CogVideoX-5B vs Mochi-1 pairwise
- **T2V_Calibration_{date}** — Calibration batch with ground-truth scores

### Other Tables
- 6 dimensions (D1–D6: Visual / Motion / Temporal / Subject / Text / Aesthetic)
- 13 failure tags across dimensions
- 4 prompts (3 T2V + 1 I2V) bundled into 2 PromptSuites
- 1 ImageSet for I2V
- 3 Datasets (model × promptSuite × optional imageSet)
- 39 EvaluationItems (SCORING) + 18 ArenaItems (one pre-voted demo verdict)
- 6 CalibrationGroundTruth rows
- 4 AnnotatorTags (通用 / 运镜 / 物理规律 / 美学) with user assignments
- 2 AnnotatorGroups (Internal Reviewers / Vendor Pool A) with memberships
- 5 CapabilityAssessments with Bayesian IRT posterior fields (TIER_1 → TIER_3)
- 18 AggregatedScores (today's daily rollup, 3 models × 6 dimensions)
- 3 ViewerAssignments granting viewer access to scoring + arena packages

### Public Sample Videos
Seeded `VideoAsset.url` fields point to Google's public sample videos
(`commondatastorage.googleapis.com/gtv-videos-bucket/sample/*.mp4`).
No real OSS bucket required for demo playback.

## Re-seed

```bash
cd evalforge-dashboard
npx tsx prisma/seed.ts
```

Idempotent: users/models/dimensions/tags/groups/packages upserted by unique
fields; volatile tables (scores, items, anti-cheat, capability, aggregated)
cleared and re-created each run.
