# SAC Skill Tracker

A multi-role web app for swim clubs (and similar skill-based programs) to track member progress, log evaluations, manage class enrollments, and surface a clean dashboard for parents, instructors, and admins.

Originally built for the **Shippensburg Aquatic Club**.

🌐 **Production:** https://skills.swimship.org/ .

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 (App Router) + React 18 |
| Language | TypeScript |
| Styling | Tailwind CSS 3 |
| DB / Auth / Storage | Supabase (PostgreSQL 17, Supabase Auth, Supabase Storage) |
| Client SDK | `@supabase/supabase-js` v2 |
| PDF generation | `jspdf` (skill certificates) |
| CSV parsing | `papaparse` |
| Hosting | Vercel (frontend), Supabase Cloud (DB + Auth) |

---

## Repository layout

```
SAC-Skill-Tracker/
├── frontend/                           Next.js app (this is the deployed bundle)
│   ├── app/                            App-router pages and API routes
│   │   ├── login/                        public sign-in page
│   │   ├── signup/                       public sign-up page
│   │   ├── role-select/                  post-login role chooser (multi-role users)
│   │   ├── account/                      parent / member-side pages
│   │   │   ├── dashboard/                  parent home (swimmer cards, skills preview)
│   │   │   ├── swimmers/[id]/              full per-swimmer profile + class history
│   │   │   └── reset-password/             password recovery landing
│   │   ├── instructor/                   instructor pages (swimmer list, evaluations)
│   │   ├── admin/                        admin dashboard (CRUD + imports)
│   │   ├── super-admin/                  super-admin views
│   │   └── api/                          server-only Next route handlers (REST-ish)
│   │       ├── auth/                       email/role lookups + auth callback
│   │       ├── account/                    parent-facing data endpoints
│   │       ├── instructor/                 instructor-facing endpoints
│   │       ├── admin/                      admin endpoints (incl. imports)
│   │       └── public/                     unauthenticated assets (logo URL)
│   ├── components/                     shared client components
│   │   ├── AuthListener.tsx              global session-expiry watcher
│   │   ├── ImportRoster.tsx / ImportClasses.tsx
│   │   ├── EvaluationForm.tsx
│   │   ├── ClassManager.tsx / SessionManager.tsx / AccountsManager.tsx
│   │   ├── InstructorAssignmentManager.tsx
│   │   ├── AdminInstructorEvaluations.tsx
│   │   └── …more
│   └── lib/                            shared modules
│       ├── supabase.ts / supabaseAdmin.ts    client + service-role wrappers
│       ├── clientAuth.ts                     authFetch + session helpers
│       ├── serverAuth.ts                     server-side auth context
│       ├── authRoles.ts                      role priority + app-role mapping
│       ├── accountSwimmerProfiles.ts         parent profile builder
│       ├── adminDashboardBootstrap.ts        admin landing-page bootstrap
│       ├── adminQueries.ts                   admin data helpers
│       └── serverRouteCache.ts               in-memory cache for hot routes
│
├── supabase/                           SQL migrations + seeds (manually applied)
│   ├── get_parent_dashboard.sql            view + RPC for parent dashboard
│   ├── admin_dashboard_perf.sql            indexes + materialized views
│   ├── admin_dashboard_header_color.sql    admin theming column
│   ├── fix_member_skill_summary_progress_scale.sql    one-off correction
│   └── skill_vals.sql                      sample skill seed
│
├── scripts/                            local utilities
│   └── import_members.py                   one-off Python loader (legacy)
│
└── README.md
```

---

## Roles

The DB has five roles in `public.role`:

| ID | Name | Scope | What they do |
|----|------|-------|--------------|
| 1 | `super_admin` | global | Required to create new organizations (enforced by trigger). Can administer any org. |
| 2 | `org_admin` | organization | Manage members, classes, skills, instructors, imports, branding within their org. |
| 3 | `instructor` | organization | Evaluate members in their assigned class groups. |
| 4 | `guardian` | organization | Parent-side access to linked swimmers' profiles. |
| 5 | `member` | organization | Swimmer-self-login (rare; usually adult swimmers). |

A `person` may have multiple roles across multiple orgs (`person_organization` + `person_org_role`) plus optional global roles (`person_global_role`). On login, the app picks the highest-priority role and routes accordingly; if a user has multiple at-priority roles they get the `/role-select` chooser.

---

## Pages by role

| Role | Lands on | Other reachable pages |
|------|----------|------------------------|
| Guardian | `/account/dashboard` | `/account/swimmers/[id]`, `/account/reset-password` |
| Instructor | `/instructor/dashboard` | `/instructor/swimmers`, `/instructor/swimmers/[id]` |
| Org admin | `/admin/dashboard` | (single tabbed dashboard with Skills, Classes, Sessions, Accounts, Instructor assignments, Imports, Branding, Evaluations) |
| Super admin | `/super-admin/dashboard` | also has the org-admin views |

Public pages: `/login`, `/signup`, `/account/reset-password`.

---

## Local development

### Prerequisites

* **Node.js** — Node 20.x recommended. Node 22 has a known race condition with Next 14 dev mode that can leave `.next/static/` empty; if you hit unstyled pages with 404'd asset URLs, drop to Node 20.
* **PostgreSQL client tools** (for backups / seed work) — `pg_dump 17`, install via `brew install postgresql@17`.
* A Supabase project (or use the linked one — credentials in `frontend/.env.local`).

### Environment variables

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

The service-role key is required for any server-side admin operation (`/api/admin/*`, imports, `auth.users` mutations). Never commit it.

### Install + run

```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:3000.

### Common dev gotchas

* **Unstyled page / 404 on `/_next/static/*`** — usually a corrupted `.next` or `node_modules`. Fix:
  ```bash
  pkill -9 -f "next" 2>/dev/null
  cd frontend
  rm -rf .next node_modules/.cache
  npm run dev
  ```
  If still broken: `rm -rf node_modules package-lock.json && npm install && npm run dev`.

* **Type-check before pushing**: `npx tsc --noEmit` (run from `frontend/`).

* **Production build**: `npm run build`. Vercel runs this on every push.

---

## Initial database setup (clean install)

After a fresh wipe (`TRUNCATE` of all `public.*` tables except `role`), the minimum to get a working tenant:

1. **Create the org + an admin** via SQL — the `organization.created_by` column is enforced by a trigger to require a `super_admin`. Pattern: insert `person`, grant `super_admin` via `person_global_role`, insert `organization`, then `person_organization` + `person_org_role` to give that person `org_admin` of the new org.
2. **Create a Supabase Auth user** for that admin (Dashboard → Authentication → Users → Add user, or via the Auth Admin API at `POST /auth/v1/admin/users`).
3. **Link them**: `UPDATE public.person SET auth_user_id = '<auth-uuid>' WHERE email = '...'`.
4. **Add skills** via the admin UI (Skills tab) — there's full CRUD at `/api/admin/skills`.
5. **Run roster / class imports** to bring in members + enrollments.

Sample seed scripts for these steps live in chat history / dev notes; not committed to the repo.

---

## Imports

Two import flows on the admin dashboard. **Both currently expect CSV** — the XLSX accept attribute on the class-import dropzone is misleading; the parser uses PapaParse which only handles CSV. Convert XLSX → CSV first.

### Roster import (`/api/admin/import-roster`)

* **Source file**: GoMotion / SportsEngine roster export.
* **Required headers**: `Memb. First Name`, `Memb. Last Name`, `Acct. First Name`, `Acct. Last Name`, `Email`, `Gender`, `Birthday`, `Billing Group`.
* **Maps `Billing Group` → role**:
  * `Group 1`, `Group 2`, `High School` (any variant), `Annual` → MEMBER (creates a `member` row + parent person)
  * `Coaches` → INSTRUCTOR (person-only, no member row)
  * `Board Members` → ADMIN
* **Idempotency**: parent (`person`) is upserted by email. Member dedup is **not** implemented yet — re-running will duplicate swimmers.

### Class import (`/api/admin/import-classes` + `/confirm`)

* **Source file**: NewRegistrationsReport (per-class signup export). Has a title row at the top followed by the column header.
* **Required columns**: `Account`, `Member` (both `"Last, First"`), `Member DOB`, `Gender`, `Email`, `Registered Class`, `Slot`, `Class Length`.
* **Two-step flow**: first POST parses the file and surfaces which classes are new vs. existing; admin fills in schedule for the new ones; second POST confirms and writes `class_entity` + `enrollment` + creates members/parents on the fly.
* **Identity rule for members**: `(organization_id, ilike first_name, ilike last_name, optional date_of_birth)`. Same identity rule used by the parent dashboard, so roster-then-classes flows pick up existing rows rather than duplicating.
* **Limitation**: importing instructors / `class_group` / `group_instructor` rows is **not** automated — admins still wire those manually after import. Without a `group_instructor` link, the `trg_evaluation_same_org` trigger blocks evaluations for the class.

---

## Authentication & session lifecycle

Supabase Auth handles sign-in / sign-up / password reset. The app layers four protections on top so a user with an expired or revoked session is auto-redirected to `/login?reason=session_expired` rather than seeing an error banner:

1. **`getRequiredSession`** in `lib/clientAuth.ts` — synchronous `localStorage` check + JWT `expires_at` check. Catches the common case (token gone or already expired) in microseconds, before any async refresh attempt.
2. **`authFetch` wrapper** — every dashboard's primary `/api/*` call goes through this. Auto-attaches headers, 8-second timeout, redirects on `401`.
3. **`AuthListener` (mounted in `app/layout.tsx`)** — subscribes to `supabase.auth.onAuthStateChange('SIGNED_OUT')`, polls `localStorage` every 30 s, listens to `visibilitychange` (instant re-check after a backgrounded tab refocuses), and listens to cross-tab `storage` events.
4. **Public-path allowlist** — `/login`, `/signup`, `/account/reset-password` skip the redirect so unauthenticated visitors can actually use those pages.

Manual logout button (in each dashboard) calls `logoutAndRedirect`, which awaits `signOut` for proper refresh-token revocation.

---

## Database schema (key tables)

All in `public` schema. See chat-saved memory for the full DDL.

| Table | Purpose |
|---|---|
| `organization` | Tenants. `created_by` must be a `super_admin`. |
| `person` | Login-able humans (parents, instructors, admins). `email` UNIQUE; `auth_user_id` → `auth.users(id)`. |
| `member` | Swimmers (the kids). Owned by an org. `is_active boolean` flag drives the parent dashboard's active-swimmer filter. |
| `guardian_member` | Parent (`person`) ↔ swimmer (`member`) link. |
| `person_member` | Self-link for adult swimmers who log in as themselves. |
| `person_organization` + `person_org_role` | Membership of a person in an org with role(s). |
| `person_global_role` | Global-scope roles (currently just `super_admin`). |
| `class_entity` | Classes. Has `start_date`, `end_date`, `schedule`/`schedule_days[]`/`schedule_time` for display, `length_minutes` for evaluations. |
| `class_group` | Sub-groups inside a class (rosters can be split). |
| `group_instructor` | Which instructor person is assigned to a group. Required for the `trg_evaluation_same_org` trigger. |
| `enrollment` | `(member_id, class_id)` PK; `slot smallint`, optional `group_id`. |
| `skill` | Per-org skill catalog. |
| `member_skill` | Append-only history of swimmer-skill state. `progress` 0–4, `evaluation_id` references the eval that caused the change. |
| `evaluation` | One feedback entry per (instructor, member, optional class, optional skill). |
| `role` | Lookup table — IDs are referenced from app code; never wipe. |

### Views & RPCs (in `supabase/`)

* **`member_skill_current`** (view) — distinct-on `(member_id, skill_id)` deduplication of `member_skill` history; used by both the parent dashboard and the instructor view.
* **`get_parent_dashboard(p_email text)`** RPC — single-shot JSON payload for the parent home page (swimmer list + skills + next class).

### Triggers worth knowing about

* **`trg_organization_created_by_super_admin`** — `organization.created_by` must hold the `super_admin` global role at insert time.
* **`trg_evaluation_same_org`** — an evaluation requires its instructor to be in `group_instructor` for the target class. If imports skip group assignment, evaluations against those classes will be blocked.

---

## Parent dashboard features

* **Active swimmers only** by default; a "Show N inactive" toggle reveals retired/archived swimmers (dimmed, with an "Inactive" pill). Inactive swimmers' pages still load with an amber "This swimmer is inactive" banner — historical records remain readable.
* **Multiple swimmers per parent** supported (via `guardian_member` joins).
* **Class history** is grouped in the dropdown by lifecycle: `Active`, `Upcoming`, then by year (`2026`, `2025`, …), then `Undated`, then `General`. Each option shows the class's start date.
* **Notes & progress history** collapse by default — only the most recent note shows; older notes hide behind a chevron. Progress history (per-skill stage chain) is always collapsed and opens to a plain indented list, oldest → newest reversed so the latest update reads first.
* **Two-card layout** on the swimmer profile: a hero card (name/age/enrollment + skill certificate badges) and a "Class activity" card (selector + inline stats + skills + class notes).

---

## Deployment

* **Frontend** auto-deploys to Vercel on every push to `main`. Preview deployments fire on every PR.
* **Database / Auth** lives in Supabase Cloud. SQL changes are applied manually via the Supabase SQL editor by copy-pasting from `supabase/*.sql`. There is no migration framework in place — apply files in order if cloning a fresh project.
* **Backups**: take a `pg_dump -F c` against the session-pooler endpoint before any destructive migration. Pro plan also has automatic daily backups in the Supabase dashboard.

---

## Future improvements

* True multi-tenant isolation tests (super admin spanning orgs is fine; org admins should never read across orgs — verify via RLS audit).
* Roster import dedup by `(org, name, dob)` to match the class-import identity rule.
* XLSX support in both import flows (currently CSV only despite the file picker).
* Auto-create `class_group` + `group_instructor` from a roster's `Coaches` rows so evaluations work right after import.
* Mobile-first polish on the admin dashboard.
* Notifications (email or in-app) when a swimmer hits proficiency 4 on a skill.
* Export reports (PDF / CSV) of a swimmer's full class history.

---

## Contributors

* Nishant Neupane (@nishantneupane)
* Yashaswe Amatya
* Aidan M. (@aidanm247)
* Lorenzo Zullo (@llzulloll)

---

## Use cases

The data model is generic enough (people → memberships → roles → classes → skill progress) to fit any program with a coach/student structure. Originally built for swim, but reusable for:

* Sports clubs
* After-school programs
* Music or arts instruction
* Corporate training cohorts
* Boy/Girl Scouts skill badges

---
