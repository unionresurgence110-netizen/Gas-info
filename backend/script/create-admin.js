// Run only from a trusted machine with the backend environment configured.
// Required env: DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
(async () => {
  const { DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL || !ADMIN_USERNAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD in your private environment first.');
  }
  if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 128) throw new Error('Admin password must be 12–128 characters.');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
  try {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING user_id, username, email, role`,
      [ADMIN_USERNAME, ADMIN_EMAIL.toLowerCase(), hash]
    );
    console.log('Admin created:', result.rows[0]);
  } catch (error) {
    if (error.code === '23505') console.error('That username or email already exists. No account was changed.');
    else console.error(error.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();
