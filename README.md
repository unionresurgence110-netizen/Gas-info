# GAS-INFO

GAS-INFO is an informational platform for trader-reported gas-cylinder availability. It does not sell, book, reserve, deliver, or accept payment for gas cylinders.

## Project layout

- Static frontend pages are served from the project root (GitHub Pages-compatible).
- `js/` contains frontend behavior, API integration, authentication, and dashboard logic.
- `backend/` contains the Node.js/Express API.
- `database/schema.sql` contains the PostgreSQL schema for a fresh database.
- `AUDIT_STATUS.md` records locally implemented fixes and what still needs live verification.

## Backend setup

1. Use Node.js 20 or later.
2. In `backend/`, install dependencies with `npm install`.
3. Configure private environment variables based on `backend/.env.example`: `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, and `CORS_ORIGIN` with comma-separated allowed origins.
4. Apply `database/schema.sql` to a fresh PostgreSQL database only after reviewing it for your environment. Do not run migrations against existing production data without a backup and review.
5. Start the API with `npm start` from `backend/`.

Never commit real credentials or `.env` files. Forgot Password remains paused; its SMTP settings are not required for ordinary login/registration.

## Verification status

Run `node --check` on the JavaScript files and test the full GitHub Pages → Render → PostgreSQL flow with test accounts before deploying. Local source checks do not verify the live service or deployed database. See `AUDIT_STATUS.md` for the exact pending checks.
