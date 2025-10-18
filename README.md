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
- No cookies/localStorage; server-side persistence via Firebase Firestore
- Responses are sent with Cache-Control: no-store to avoid caching
 - IDs are chosen by the user at creation time (no random IDs). They must be unique and match: 3–63 characters, lowercase letters, numbers, hyphens (e.g., `secret-1`). Reserved IDs: `new`, `list`, `healthz`, `robots.txt`.

Tech
- Node.js + Express + EJS
- Firebase Firestore (via service account REST API)
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
- `/s/:id/delete` → POST endpoint to delete a secret (requires strict confirmation)
- `/healthz` → health check
- `/robots.txt` → disallow crawling

Usage
1. Open `/new`, choose a unique ID (e.g., `secret-1`), enter the secret, choose the IANA time zone
2. Configure weekly visibility windows
3. Submit to get your secret URL `/s/:id` (example: `/s/secret-1`)
4. While visible and before any hidden period happens, you may adjust the schedule/time zone at `/s/:id`
5. After a hidden period is detected (or currently hidden), updates are blocked permanently
  - To delete, open `/s/:id` while the secret is currently visible, scroll to Danger zone, type the exact ID as confirmation, and submit. You will be redirected to `/list` with a success banner. Deletion is blocked during hidden periods.

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
- Database: Firebase Firestore (schedule stored as JSON string, timestamps stored as Firestore timestamps)

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

- Configuration
  - Environment variables:
    - `PORT` (optional, default 3000)
    - `FIREBASE_PROJECT_ID`: Firebase project ID (e.g. `secret-time-7f086`)
    - `FIREBASE_CLIENT_EMAIL`: service-account client email
    - `FIREBASE_PRIVATE_KEY`: service-account private key (wrap in quotes and replace actual newlines with `\n` when using `.env`)
    - `FIREBASE_SERVICE_ACCOUNT_JSON` *(optional)*: inline JSON for the Firebase service-account key. When provided, the file is parsed and used to populate any missing variables above.
    - `FIREBASE_SERVICE_ACCOUNT_FILE` *(optional)*: filesystem path to a JSON key downloaded from **Project Settings → Service accounts → Generate new private key**. Parsed the same way as the inline JSON variable.
  - The server authenticates with Google via OAuth2 JWT and talks to the Firestore REST API. Ensure the service account has the **Cloud Datastore User** role (or broader) so it can read/write Firestore.
  - :warning: The Firebase Web SDK config (`apiKey`, `authDomain`, `appId`, etc.) is *not* sufficient for this backend. Those values are safe for client-side apps but cannot authenticate this server to Firestore. Use a service-account key instead.
- Secrets are stored in the `secrets` collection within the default Firestore database. Each document is named after the custom ID and contains the following fields:
  - `secretText` (string)
  - `timezone` (string)
  - `schedule` (stringified JSON schedule)
  - `createdAt` (timestamp)
  - `lockedAt` (timestamp or null)
- Client defaults:
  - On `/new`, `public/app.js` sets the timezone input to `Africa/Cairo` only if the field is empty or currently `UTC`

Development notes
- CSS: `public/styles.css` (dark theme, components, time editor utilities)
- Client script: `public/app.js` (dark hint + default tz behavior)
- Helmet CSP is configured to allow Tailwind CDN and inline styles for this setup

Firestore data model:
- `schedule` is persisted as a JSON string. It is parsed on read before being used by the scheduler logic.
- `createdAt`/`lockedAt` are Firestore timestamp fields encoded as ISO strings when returned by the API.

License
MIT
