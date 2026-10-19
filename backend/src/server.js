require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowed = (process.env.CORS_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length ? allowed : true }));
app.use(express.json({ limit: '200kb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 10000 });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const fail = (res, status, error) => res.status(status).json({ error });
const text = (v, max=255) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const required = (obj, fields) => fields.every(k => typeof obj[k] === 'string' && obj[k].trim());
function sign(user) { return jwt.sign({ sub:user.user_id, role:user.role }, process.env.JWT_SECRET, { expiresIn:'7d' }); }
function auth(req,res,next) {
  const token = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return fail(res,401,'Login required');
  try { req.auth = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return fail(res,401,'Session expired or invalid'); }
}
const roles = (...allowedRoles) => (req,res,next) => allowedRoles.includes(req.auth?.role) ? next() : fail(res,403,'Permission denied');
async function getActiveUser(req,res,next) {
  try {
    const { rows } = await pool.query('SELECT user_id, username, email, role, account_status FROM users WHERE user_id=$1',[req.auth.sub]);
    if (!rows[0] || !['active','warning'].includes(rows[0].account_status)) return fail(res,403,'Account is unavailable');
    req.user = rows[0]; next();
  } catch(e) { next(e); }
}
app.get('/', (req,res) => res.json({ name:'GAS-INFO API', status:'running', purpose:'Gas availability information only' }));
app.get('/api/health', asyncRoute(async (req,res) => {
  const r = await pool.query('SELECT NOW() AS database_time');
  res.json({ ok:true, database:'connected', time:r.rows[0].database_time });
}));
app.get('/api/health/schema', asyncRoute(async (req,res) => {
  const r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  res.json({ count:r.rowCount, tables:r.rows.map(x=>x.table_name) });
}));

app.post('/api/auth/register', asyncRoute(async (req,res) => {
  const username=text(req.body.username,50), email=text(req.body.email,254).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
  const role=req.body.role==='trader'?'trader':'customer';
  if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<8 || password.length>128) return fail(res,400,'Enter a username, valid email, and password of 8–128 characters');
  if (!/^[\p{L}\p{N}_.-]{3,50}$/u.test(username)) return fail(res,400,'Username must be 3–50 letters, numbers, dots, underscores or hyphens');
  const hash=await bcrypt.hash(password,12);
  try {
    const r=await pool.query('INSERT INTO users(username,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING user_id,username,email,role,account_status,created_at',[username,email,hash,role]);
    const user=r.rows[0]; res.status(201).json({ user, token:sign(user), note: role==='trader'?'Trader account created. Shop details must be completed before listing.':undefined });
  } catch(e) { if(e.code==='23505') return fail(res,409,'Username or email is already registered'); throw e; }
}));
app.post('/api/auth/login', asyncRoute(async (req,res) => {
  const email=text(req.body.email,254).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
  if(!email || !password) return fail(res,400,'Email and password are required');
  const r=await pool.query('SELECT user_id,username,email,password_hash,role,account_status FROM users WHERE email=$1',[email]);
  const u=r.rows[0]; if(!u || !(await bcrypt.compare(password,u.password_hash))) return fail(res,401,'Invalid email or password');
  if(!['active','warning'].includes(u.account_status)) return fail(res,403,'Account is suspended or banned');
  await pool.query('UPDATE users SET last_login_at=NOW() WHERE user_id=$1',[u.user_id]);
  delete u.password_hash; res.json({ user:u, token:sign(u) });
}));
app.get('/api/auth/me',auth,getActiveUser,(req,res)=>res.json({user:req.user}));

app.get('/api/locations', asyncRoute(async (req,res) => {
 const {province,district,municipality}=req.query;
 const r=await pool.query(`SELECT DISTINCT province,district,municipality,ward_no,town_village,exact_location FROM locations WHERE status='active' AND ($1::text IS NULL OR province=$1) AND ($2::text IS NULL OR district=$2) AND ($3::text IS NULL OR municipality=$3) ORDER BY province,district,municipality,ward_no,town_village,exact_location LIMIT 1000`,[province||null,district||null,municipality||null]);
 res.json({locations:r.rows, count:r.rowCount});
}));
app.get('/api/search', asyncRoute(async (req,res) => {
 const cylinder=text(req.query.cylinder,120), province=text(req.query.province,120), district=text(req.query.district,120), municipality=text(req.query.municipality,160), ward=text(req.query.ward,20), town=text(req.query.town,160), location=text(req.query.location,255);
 const qty=Math.max(0,Math.min(10000,Number.parseInt(req.query.quantity||'1',10)||1));
 const r=await pool.query(`SELECT s.shop_id,s.shop_name,s.phone,s.province,s.district,s.municipality,s.ward_no,s.town_village,s.exact_location,s.latitude,s.longitude,st.cylinder_name,st.quantity,st.last_updated_at,COALESCE(rv.rating,0)::numeric(3,2) AS rating,COALESCE(rv.review_count,0)::int AS review_count FROM shops s JOIN stock st ON st.shop_id=s.shop_id LEFT JOIN (SELECT shop_id,AVG(rating) rating,COUNT(*) review_count FROM reviews WHERE status='active' GROUP BY shop_id) rv ON rv.shop_id=s.shop_id WHERE s.shop_status='active' AND ($1='' OR LOWER(st.cylinder_name)=LOWER($1)) AND ($2='' OR s.province=$2) AND ($3='' OR s.district=$3) AND ($4='' OR s.municipality=$4) AND ($5='' OR COALESCE(s.ward_no,'')=$5) AND ($6='' OR COALESCE(s.town_village,'') ILIKE '%'||$6||'%') AND ($7='' OR s.exact_location ILIKE '%'||$7||'%') ORDER BY (st.quantity >= $8) DESC, (st.quantity >= $8 AND st.quantity>0) DESC, COALESCE(rv.rating,0) DESC, st.last_updated_at DESC LIMIT 100`,[cylinder,province,district,municipality,ward,town,location,qty]);
 const lower=r.rows.filter(x=>Number(x.quantity)<qty);
 res.json({ results:r.rows, count:r.rowCount, requestedQuantity:qty, lowerQuantityAvailable:lower.length>0, disclaimer:'Stock information is provided by the trader and may change at any time. Please check the latest information before visiting.' });
}));

app.post('/api/trader/shops',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const b=req.body;
 if(!required(b,['shop_name','province','district','municipality','exact_location']) || !Number.isFinite(Number(b.latitude)) || !Number.isFinite(Number(b.longitude)) || Math.abs(Number(b.latitude))>90 || Math.abs(Number(b.longitude))>180) return fail(res,400,'Shop name, location fields, latitude and longitude are required');
 try { const r=await pool.query(`INSERT INTO shops(owner_user_id,shop_name,phone,business_email,province,district,municipality,ward_no,town_village,exact_location,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.user_id,text(b.shop_name,180),text(b.phone,40)||null,text(b.business_email,254)||null,text(b.province,120),text(b.district,120),text(b.municipality,160),text(b.ward_no,20)||null,text(b.town_village,160)||null,text(b.exact_location,255),Number(b.latitude),Number(b.longitude)]); res.status(201).json({shop:r.rows[0],message:'Shop submitted for approval; it is not publicly listed until approved.'}); }
 catch(e){if(e.code==='23505')return fail(res,409,'This trader account already has a shop');throw e;}
}));
app.get('/api/trader/shops/mine',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM shops WHERE owner_user_id=$1',[req.user.user_id]);res.json({shops:r.rows});}));
app.put('/api/trader/shops/:shopId/stock',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const cylinder=text(req.body.cylinder_name,120), quantity=Number(req.body.quantity);
 if(!cylinder || !Number.isInteger(quantity) || quantity<0 || quantity>100000) return fail(res,400,'Cylinder name and a non-negative whole-number quantity are required');
 const client=await pool.connect(); try { await client.query('BEGIN'); const own=await client.query("SELECT shop_id FROM shops WHERE shop_id=$1 AND owner_user_id=$2 AND shop_status IN ('active','pending') FOR UPDATE",[req.params.shopId,req.user.user_id]); if(!own.rowCount){await client.query('ROLLBACK');return fail(res,404,'Shop not found or not owned by this account');}
 const prev=await client.query('SELECT quantity FROM stock WHERE shop_id=$1 AND cylinder_name=$2 FOR UPDATE',[req.params.shopId,cylinder]); const old=prev.rowCount?prev.rows[0].quantity:null;
 const saved=await client.query(`INSERT INTO stock(shop_id,cylinder_name,quantity,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(shop_id,cylinder_name) DO UPDATE SET quantity=EXCLUDED.quantity,last_updated_at=NOW(),updated_by=EXCLUDED.updated_by RETURNING *`,[req.params.shopId,cylinder,quantity,req.user.user_id]);
 await client.query('INSERT INTO stock_update_history(shop_id,updated_by,cylinder_name,previous_quantity,new_quantity) VALUES($1,$2,$3,$4,$5)',[req.params.shopId,req.user.user_id,cylinder,old,quantity]); await client.query('COMMIT'); res.json({stock:saved.rows[0]});
 } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
}));
app.post('/api/shops/:shopId/reviews',auth,getActiveUser,asyncRoute(async(req,res)=>{
 if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot submit customer reviews'); const rating=Number(req.body.rating), review=text(req.body.review_text,3000); if(!Number.isInteger(rating)||rating<1||rating>5)return fail(res,400,'Rating must be 1–5');
 const shop=await pool.query("SELECT shop_id FROM shops WHERE shop_id=$1 AND shop_status='active'",[req.params.shopId]); if(!shop.rowCount)return fail(res,404,'Active shop not found');
 const r=await pool.query(`INSERT INTO reviews(shop_id,user_id,rating,review_text,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(shop_id,user_id) WHERE status='active' DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,updated_at=NOW() RETURNING *`,[req.params.shopId,req.user.user_id,rating,review||null]); res.status(201).json({review:r.rows[0]});
}));
app.get('/api/shops/:shopId/reviews',asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT r.review_id,r.rating,r.review_text,r.created_at,r.updated_at,u.username FROM reviews r JOIN users u ON u.user_id=r.user_id WHERE r.shop_id=$1 AND r.status='active' ORDER BY r.created_at DESC LIMIT 100`,[req.params.shopId]);res.json({reviews:r.rows});}));
app.post('/api/shops/:shopId/reports',auth,getActiveUser,asyncRoute(async(req,res)=>{
 if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot submit customer reports'); const type=text(req.body.report_type,40), desc=text(req.body.description,3000); if(!['stock_mismatch','incorrect_shop_info','other_information_issue'].includes(type)||!desc)return fail(res,400,'Valid report type and description are required');
 const shop=await pool.query("SELECT shop_id,owner_user_id FROM shops WHERE shop_id=$1 AND shop_status='active'",[req.params.shopId]); if(!shop.rowCount)return fail(res,404,'Active shop not found');
 const r=await pool.query('INSERT INTO reports(shop_id,reported_by,report_type,description) VALUES($1,$2,$3,$4) RETURNING *',[req.params.shopId,req.user.user_id,type,desc]); await pool.query("INSERT INTO notifications(user_id,type,title,message) VALUES($1,'shop_report','New information report','A customer reported an information issue for your shop.')",[shop.rows[0].owner_user_id]); res.status(201).json({report:r.rows[0]});
}));
app.get('/api/notifications',auth,getActiveUser,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.user_id]);res.json({notifications:r.rows});}));
app.patch('/api/notifications/:id/read',auth,getActiveUser,asyncRoute(async(req,res)=>{const r=await pool.query('UPDATE notifications SET is_read=TRUE WHERE notification_id=$1 AND user_id=$2 RETURNING *',[req.params.id,req.user.user_id]);if(!r.rowCount)return fail(res,404,'Notification not found');res.json({notification:r.rows[0]});}));

app.use((req,res)=>fail(res,404,'API route not found'));
app.use((err,req,res,next)=>{console.error(err); if(err.code==='23503')return fail(res,400,'Referenced record does not exist'); if(err.code==='22P02')return fail(res,400,'Invalid ID or field format'); res.status(500).json({error:'Internal server error'});});
const port=Number(process.env.PORT)||3000;
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters.');
app.listen(port,'0.0.0.0',()=>console.log(`GAS-INFO API listening on ${port}`));
