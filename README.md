Time-Gated Secret (plaintext)

A minimal Node/Express app that stores a plaintext secret and reveals it only during user-defined weekly time windows (in a fixed IANA time zone). Outside visible windows, the secret cannot be accessed or modified. No cookies or client storage are used.

What’s new (UI/UX)
- Dark, accessible UI with high contrast and focus-visible outlines
- Responsive schedule editor: 1 column on small, 2 columns ≥ md, 3 columns ≥ xl
- Compact time inputs in a wider, dedicated grid to avoid edge collisions
- “View list” navigation button added to Create/Show/Not Found screens
- Default timezone auto-fills to Africa/Cairo on /new if field is empty or "UTC"

Key behavior
- Secret is a simple text string; no encryption (plaintext in DB)
- Weekly schedule with per-day intervals (up to 3) or all-day visibility
- Once the secret ever enters a hidden period, further changes are permanently locked
- Schedule updates are only allowed while the secret is visible and before any hidden period has occurred
- Time zone must be a valid IANA zone (e.g., Africa/Cairo, Europe/London)
- No cookies/localStorage; server-side PostgreSQL only
- Responses are sent with Cache-Control: no-store to avoid caching
 - IDs are chosen by the user at creation time (no random IDs). They must be unique and match: 3–63 characters, lowercase letters, numbers, hyphens (e.g., `secret-1`). Reserved IDs: `new`, `list`, `healthz`, `robots.txt`.

Tech
- Node.js + Express + EJS
- PostgreSQL via `pg`
- Time math with luxon
- Styling via Tailwind CDN + `public/styles.css` (no build step)

Quick start
```
npm install
# Provide database config via env (see Configuration below)
npm run dev
# open http://localhost:3000
```

Routes
- `/` → redirects to `/new`
- `/new` → create a secret with your custom ID and define schedule (default tz field may auto-fill to Africa/Cairo)
- `/list` → list all secrets with visibility status and previews when visible
- `/s/:id` → show a specific secret; manage schedule only while visible and before any hidden period
- `/s/:id/update-schedule` → POST endpoint to update timezone/schedule (visible and not locked only)
- `/healthz` → health check
- `/robots.txt` → disallow crawling

Usage
1. Open `/new`, choose a unique ID (e.g., `secret-1`), enter the secret, choose the IANA time zone
2. Configure weekly visibility windows
3. Submit to get your secret URL `/s/:id` (example: `/s/secret-1`)
4. While visible and before any hidden period happens, you may adjust the schedule/time zone at `/s/:id`
5. After a hidden period is detected (or currently hidden), updates are blocked permanently

UI/UX details
- Global dark theme with `color-scheme: dark` and CSS variables in `public/styles.css`
- Components:
  - `card`: dark surface with subtle border
  - `truncate-2`: multiline text truncation
  - Time editor utilities: `time-grid`, `time-item`, `time-input`, `time-sep`
- Accessibility: semantic landmarks, ARIA where appropriate, improved focus state, and reduced motion support
- Responsiveness: containers use `max-w-5xl`; schedule editor widens at md/xl; Manage panel spans two columns on detail page

Data & security
- Plaintext storage for demonstration only; do not store sensitive data
- No authentication; anyone with the URL can view when visible
- Database: PostgreSQL (JSONB schedule, timestamptz timestamps)

Project structure
```
c:\Work_space\Secret-save-site\
  ├─ public\
  │  ├─ app.js
  │  └─ styles.css
  ├─ src\
  │  ├─ db.js
  │  └─ schedule.js
  ├─ views\
  │  ├─ list.ejs
  │  ├─ new.ejs
  │  ├─ not_found.ejs
  │  └─ show.ejs
  ├─ server.js
  ├─ package.json
  └─ README.md
```

Configuration
- Environment variables:
  - `PORT` (optional, default 3000)
  - `DATABASE_URL` (recommended): full PostgreSQL URL, e.g. `postgresql://user:pass@host:5432/dbname`
  - `DATABASE_SSL` (optional): set to `require` when your provider needs SSL (Render external URLs)
  - Alternatively, you may use standard PG env vars: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Render example (use one):

Internal URL (within Render private network):
```
postgresql://save_secret_user:<PASSWORD>@dpg-d3geup95pdvs73eeqp00-a/save_secret
```

External URL (public, requires SSL):
```
postgresql://save_secret_user:<PASSWORD>@dpg-d3geup95pdvs73eeqp00-a.oregon-postgres.render.com/save_secret
# set DATABASE_SSL=require
```

CLI check:
```
PGPASSWORD=<PASSWORD> psql -h dpg-d3geup95pdvs73eeqp00-a.oregon-postgres.render.com -U save_secret_user save_secret
```

- Client defaults:
  - On `/new`, `public/app.js` sets the timezone input to `Africa/Cairo` only if the field is empty or currently `UTC`

Development notes
- CSS: `public/styles.css` (dark theme, components, time editor utilities)
- Client script: `public/app.js` (dark hint + default tz behavior)
- Helmet CSP is configured to allow Tailwind CDN and inline styles for this setup

Database schema (auto-created on boot):
```
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  secret_text TEXT NOT NULL,
  timezone TEXT NOT NULL,
  schedule JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ
);
```

Notes:
- `schedule` is stored as JSONB. Timestamps are ISO and stored as timestamptz.
- Set `DATABASE_URL` in production. For Render external URLs, set `DATABASE_SSL=require`.

License
MIT
