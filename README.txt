GAS-INFO
========

GAS-INFO is an informational platform for trader-reported gas-cylinder availability. It does not sell, book, reserve, deliver, or accept payment for cylinders.

Static frontend pages are in the project root. Frontend scripts are in js/. The Express API is in backend/. The PostgreSQL schema for a fresh database is in database/schema.sql.

For backend setup, use Node.js 20+, install dependencies inside backend/, configure private environment variables using backend/.env.example, and start with npm start. Never commit real credentials or .env files. Review the database schema and back up any existing database before applying changes.

See README.md for setup guidance and AUDIT_STATUS.md for locally implemented fixes and remaining live verification. Forgot Password remains paused as requested. Creating this source ZIP does not deploy the website or verify the live Render/Neon services.
