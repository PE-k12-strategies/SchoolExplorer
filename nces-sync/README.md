# NCES / Education Data API Sync

Synchronizes [Urban Institute Education Data API](https://educationdata.urban.org/documentation/) CCD data into Supabase for dashboard use.

**The dashboard never calls the NCES API directly** — it only reads from Supabase tables populated by this sync.

## Configuration

**Primary config file:** `src/config/sync-config.ts`

| Setting | Default | Purpose |
|---------|---------|---------|
| `states` | `['CO']` | Discover and sync **all districts** in these states (`['ALL']` = entire US) |
| `schoolYears` | `[2015, 2020, 2021, 2022, 2023, 2024]` | Years for enrollment trends |
| `financeYears` | `[2019, 2020, 2021]` | Fiscal years for finance data |
| `discoveryYear` | `2024` | Year used to list districts per state |
| `skipIfSyncedWithinDays` | `30` | Default: skip districts synced within this many days |

Jeffco NCES LEA ID: `0804800` — look up others at https://nces.ed.gov/ccd/districtsearch/

## Datasets synced

| Dataset | Supabase table | API endpoint |
|---------|----------------|--------------|
| District directory | `nces_district_directory` | `school-districts/ccd/directory/{year}/` |
| School directory | `nces_school_directory` | `schools/ccd/directory/{year}/` |
| School enrollment | `nces_school_enrollment` | `schools/ccd/enrollment/{year}/{grade}/` |
| District enrollment | `nces_district_enrollment` | `school-districts/ccd/enrollment/{year}/{grade}/` |
| District finance | `nces_district_finance` | `school-districts/ccd/finance/{year}/` |
| District staff (FTE) | `nces_district_staff` | From district directory (no separate CCD staff endpoint) |

All records are **UPSERT**ed. Each row has `last_synced`.

## Setup

### 1. Run SQL migrations

In Supabase SQL Editor, paste and run (in order):

1. `sql/migrations/001_nces_tables.sql`
2. `sql/migrations/002_nces_rls.sql`
3. `sql/migrations/003_nces_multi_state.sql`

### 2. Install and configure

```powershell
cd nces-sync
npm install
copy .env.example .env
```

Edit `.env`:

```
SUPABASE_URL=https://jmmrsetieidkwycnfvkm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Use the **service role** key (Supabase Dashboard → Settings → API). Never commit it or use it in browser code.

### 3. Run sync manually

```powershell
npm run sync
# All Colorado districts, years from sync-config.ts:
npm run sync -- --state CO
# Multiple states:
npm run sync -- --state CO,UT
# Single district only:
npm run sync -- --district 0804800 --skip-discover
# Refresh district list without syncing data:
npm run sync -- --discover-only --state CO
# Re-run but skip districts synced in the last 30 days (default):
npm run sync -- --state CO --skip-discover
# Only never-synced districts (after an interrupted nationwide run):
npm run sync -- --state ALL --skip-discover --resume
# Force full re-pull:
npm run sync -- --state CO --skip-discover --force
```

**Freshness:** By default, districts with `last_synced` within the last 30 days are skipped. Use `--force` to re-pull everything, or `--skip-recent-days 14` for a custom window. `--resume` is stricter: only districts where `last_synced` is null.

## Edge Function

Deploy `supabase/functions/sync-nces` (imports shared code from `nces-sync/src` — deploy from project root):

```powershell
supabase functions deploy sync-nces --no-verify-jwt
```

> **Note:** The Edge Function imports TypeScript modules from `nces-sync/src/`. Deploy from the repository root so those paths resolve. For production schedules, GitHub Actions (`npm run sync`) is the most reliable option.

Set secrets: `SYNC_SECRET` (random string).

Invoke:

```http
POST https://<project>.supabase.co/functions/v1/sync-nces
x-sync-secret: <SYNC_SECRET>
```

Optional body: `{ "leaid": "0804800" }`

## GitHub Action

See `.github/workflows/sync-nces.yml`. Add repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Articulation areas (Jeffco only — not in NCES)

NCES/CCD **does not** include articulation areas. The dashboard filter only works after you map schools manually:

| Table | Purpose |
|-------|---------|
| `nces_articulation_areas` | Area names (pre-seeded for Jeffco `0804800`) |
| `nces_school_articulation_map` | Links `ncessch` → area — **you must populate this** |

See `sql/seed-jeffco-articulation-map.sql` for examples. Until mapped, the articulation dropdown stays disabled on the dashboard.

## Loading all schools (you do NOT load them one-by-one)

Schools are synced **automatically per district** when you run the sync script.

| Step | Command | What it does |
|------|---------|----------------|
| 1. List districts | `npm run sync -- --discover-only --state CO` | All CO districts → `nces_sync_districts` (fast, no enrollment) |
| 2. Full sync | `npm run sync -- --state CO` | Every CO district: schools, enrollment, finance for all years in `sync-config.ts` |
| 3. One district | `npm run sync -- --district 0804800 --skip-discover` | Jeffco only (~164 schools) |

**You do not** enter schools individually. One `--state CO` run loops all ~180 districts and pulls each district's schools from the API.

**Time:** Jeffco alone ≈ 5 min. Full Colorado ≈ 30–60+ min. Entire US (`--state ALL`) = hours — only run if you truly need national data.

**Dashboard:** After sync, pick State → District → Year. All schools for that district appear automatically.

## External keys

| Level | Key column |
|-------|------------|
| District | `leaid` |
| School | `ncessch` |
