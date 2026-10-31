# CivicPulse AI — Full-stack starter

A React + Vite frontend and Express + SQLite API for a civic complaint reporting prototype.

## Requirements
- Node.js 20 LTS (recommended)
- npm

## Run locally
1. Extract the ZIP and open this folder in VS Code.
2. Open Terminal in this folder.
3. Install packages:
   ```bash
   npm install
   ```
4. Start frontend and backend:
   ```bash
   npm run dev
   ```
5. Open the Vite URL printed in the terminal, normally `http://localhost:5173`.

The Vite development server proxies `/api` and `/uploads` requests to the Express API at port 4000.

## Admin login page

The header includes a separate **Admin** entry point. It uses the existing backend login endpoint, rejects accounts that do not have the `admin` role, and opens the existing protected admin dashboard. Admin registration is intentionally disabled in this screen.

## Demo admin account
- Email: `admin@civicpulse.local`
- Password: `Admin@12345`

Change these demo credentials before any real deployment. This is a local demo account, not a production identity system.

## Included
- Responsive React interface inspired by the provided CivicPulse poster
- Tamil/English UI text switch for major navigation and workflow labels
- Citizen registration/login using bcrypt password hashes and JWT bearer tokens
- SQLite persistence for accounts, complaints and feedback
- Complaint creation and tracking by complaint ID
- JPG/PNG/WebP image upload (5 MB limit)
- Browser geolocation permission flow
- Browser speech recognition where supported
- Rule-based demo classification and suggested department/priority
- Separate admin login entry point with role check
- Admin complaint list, counts, and status updates
- Feedback API endpoint

## Important limitations before real-world use
- The “AI” classifier is rule-based demo logic, not a trained AI model. Validate all suggestions with officials.
- Nearby issues is a designed preview, not a live map. Connect a map provider and geocoding service for production.
- Voice recognition uses browser Web Speech API and may not work in all browsers or for every language/accent.
- Complaint creation supports guest submissions. If you want all complaints tied to an account, add authentication to the create endpoint and require login in the UI.
- This starter is not production-hardened. Before public deployment add HTTPS, rate limiting, CSRF strategy appropriate to the auth model, strict CORS, request validation, audit logs, backups, secure secrets, content scanning, retention policies, admin MFA, and security testing.
- Uploaded images are stored locally. Use private object storage and access controls in a real deployment.
- JWT secret currently has a development fallback. Set `JWT_SECRET` in your deployment environment.
- This is a project starter, not a substitute for a reviewed security/privacy implementation.

## API overview
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `POST /api/classify`
- `POST /api/complaints` (multipart form; optional `photo`)
- `GET /api/complaints/track/:code`
- `GET /api/complaints/mine` (Bearer token)
- `GET /api/admin/summary` (admin token)
- `PATCH /api/admin/complaints/:id/status` (admin token)
- `POST /api/feedback`

## Data storage
The SQLite database is created automatically at `server/civicpulse.db` when the API starts. Do not commit the database or uploaded user data to source control.
