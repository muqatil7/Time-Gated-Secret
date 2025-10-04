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
- No cookies/localStorage; server-side SQLite only
- Responses are sent with Cache-Control: no-store to avoid caching

Tech
- Node.js + Express + EJS
- SQLite (file) via sqlite3
- Time math with luxon
- Styling via Tailwind CDN + `public/styles.css` (no build step)

Quick start
```
npm install
npm run dev
# open http://localhost:3000
```

Routes
- `/` → redirects to `/new`
- `/new` → create a secret and define schedule (default tz field may auto-fill to Africa/Cairo)
- `/list` → list all secrets with visibility status and previews when visible
- `/s/:id` → show a specific secret; manage schedule only while visible and before any hidden period
- `/s/:id/update-schedule` → POST endpoint to update timezone/schedule (visible and not locked only)
- `/healthz` → health check
- `/robots.txt` → disallow crawling

Usage
1. Open `/new`, enter the secret, choose the IANA time zone
2. Configure weekly visibility windows
3. Submit to get a unique secret URL `/s/:id`
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
- Database file: `data/secrets.sqlite`

Project structure
```
c:\Work_space\Secret-save-site\
  ├─ data\
  │  └─ secrets.sqlite
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
- Client defaults:
  - On `/new`, `public/app.js` sets the timezone input to `Africa/Cairo` only if the field is empty or currently `UTC`

Development notes
- CSS: `public/styles.css` (dark theme, components, time editor utilities)
- Client script: `public/app.js` (dark hint + default tz behavior)
- Helmet CSP is configured to allow Tailwind CDN and inline styles for this setup

License
MIT
