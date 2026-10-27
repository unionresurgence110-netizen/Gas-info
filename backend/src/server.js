// ========== PART 1 START ==========
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowed = (process.env.CORS_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length ? allowed : ['https://unionresurgence110-netizen.github.io'] }));
app.use(express.json({ limit: '200kb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 10000 });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const duplicateCheckLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const accountActionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
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
const roles = (...allowedRoles) => (req,res,next) => allowedRoles.includes(req.user?.role) ? next() : fail(res,403,'Permission denied');
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
  // Keep the compatibility endpoint but do not expose internal table names.
  await pool.query('SELECT 1');
  res.json({ ok:true, database:'connected', schemaDetails:'not exposed publicly' });
}));

app.post('/api/auth/register', authLimiter, asyncRoute(async (req,res) => {
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
app.post('/api/auth/login', authLimiter, asyncRoute(async (req,res) => {
  const email=text(req.body.email,254).toLowerCase(), password=typeof req.body.password==='string'?req.body.password:'';
  if(!email || !password) return fail(res,400,'Email and password are required');
  const r=await pool.query('SELECT user_id,username,email,password_hash,role,account_status FROM users WHERE email=$1',[email]);
  const u=r.rows[0]; if(!u || !(await bcrypt.compare(password,u.password_hash))) return fail(res,401,'Invalid email or password');
  if(!['active','warning'].includes(u.account_status)) return fail(res,403,'Account is suspended or banned');
  await pool.query('UPDATE users SET last_login_at=NOW() WHERE user_id=$1',[u.user_id]);
  delete u.password_hash; res.json({ user:u, token:sign(u) });
}));
app.get('/api/auth/me',auth,getActiveUser,(req,res)=>res.json({user:req.user}));

// Upgrade an existing customer account and create its shop atomically.
app.post('/api/auth/switch-to-trader',accountActionLimiter,auth,getActiveUser,asyncRoute(async(req,res)=>{
 const password=typeof req.body.password==='string'?req.body.password:'';
 const b=req.body.shop||req.body;
 if(req.user.role!=='customer')return fail(res,403,'Only customer accounts can switch to trader.');
 if(password.length<1||password.length>128)return fail(res,400,'Enter your current account password to confirm this change.');
 if(!required(b,['shop_name','province','district','municipality','exact_location']) || !Number.isFinite(Number(b.latitude)) || !Number.isFinite(Number(b.longitude)) || Math.abs(Number(b.latitude))>90 || Math.abs(Number(b.longitude))>180) return fail(res,400,'Shop name, location fields, latitude and longitude are required.');
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const current=await client.query('SELECT user_id,password_hash,role FROM users WHERE user_id=$1 FOR UPDATE',[req.user.user_id]);
  if(!current.rowCount||current.rows[0].role!=='customer'){await client.query('ROLLBACK');return fail(res,409,'This account is no longer a customer account. Please refresh and try again.');}
  if(!(await bcrypt.compare(password,current.rows[0].password_hash))){await client.query('ROLLBACK');return fail(res,401,'Current password is incorrect.');}
  const existing=await client.query('SELECT shop_id FROM shops WHERE owner_user_id=$1',[req.user.user_id]);
  if(existing.rowCount){await client.query('ROLLBACK');return fail(res,409,'A shop is already linked to this account.');}
  const u=await client.query("UPDATE users SET role='trader',updated_at=NOW() WHERE user_id=$1 RETURNING user_id,username,email,role,account_status,created_at",[req.user.user_id]);
  const shop=await client.query(`INSERT INTO shops(owner_user_id,shop_name,phone,business_email,province,district,municipality,ward_no,town_village,exact_location,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.user_id,text(b.shop_name,180),text(b.phone,40)||null,text(b.business_email,254)||null,text(b.province,120),text(b.district,120),text(b.municipality,160),text(b.ward_no,20)||null,text(b.town_village,160)||null,text(b.exact_location,255),Number(b.latitude),Number(b.longitude)]);
  await client.query('COMMIT');
  res.status(201).json({user:u.rows[0],token:sign(u.rows[0]),shop:shop.rows[0],message:'Your account is now a trader account. The shop is pending admin approval.'});
 } catch(e){try{await client.query('ROLLBACK')}catch{};if(e.code==='23505')return fail(res,409,'A shop with these account details may already exist. Check your profile before retrying.');throw e;} finally{client.release();}
}));
// ========== PART 1 END ==========
  
// ========== PART 2 START ==========

// Permanent account deletion. Admin accounts are intentionally excluded.
app.post('/api/account/delete',accountActionLimiter,auth,getActiveUser,asyncRoute(async(req,res)=>{
 const password=typeof req.body.password==='string'?req.body.password:'';
 const confirmation=text(req.body.confirmation,20);
 if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot be deleted through this feature.');
 if(confirmation!=='DELETE')return fail(res,400,'Type DELETE to confirm permanent account deletion.');
 if(!password)return fail(res,400,'Enter your current password to confirm deletion.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const current=await client.query('SELECT user_id,password_hash,role FROM users WHERE user_id=$1 FOR UPDATE',[req.user.user_id]);
  if(!current.rowCount){await client.query('ROLLBACK');return fail(res,404,'Account not found.');}
  if(current.rows[0].role==='admin'){await client.query('ROLLBACK');return fail(res,403,'Admin accounts cannot be deleted through this feature.');}
  if(!(await bcrypt.compare(password,current.rows[0].password_hash))){await client.query('ROLLBACK');return fail(res,401,'Password is incorrect. Account was not deleted.');}
  const uid=req.user.user_id;
  // Remove dependent records in FK-safe order. Shop deletion cascades shop-owned stock,
  // history, images, reviews, reports, and report-verification records.
  await client.query('DELETE FROM report_verifications WHERE requested_by=$1',[uid]);
  await client.query('DELETE FROM reports WHERE reported_by=$1',[uid]);
  await client.query('DELETE FROM reviews WHERE user_id=$1',[uid]);
  await client.query('DELETE FROM website_reviews WHERE user_id=$1',[uid]);
  await client.query('DELETE FROM strikes WHERE user_id=$1 OR issued_by=$1',[uid]);
  await client.query('DELETE FROM stock_update_history WHERE updated_by=$1',[uid]);
  await client.query('DELETE FROM stock WHERE updated_by=$1',[uid]);
  await client.query('DELETE FROM shops WHERE owner_user_id=$1',[uid]);
  await client.query('DELETE FROM notifications WHERE user_id=$1',[uid]);
  await client.query('DELETE FROM notification_events WHERE user_id=$1',[uid]);
  await client.query('DELETE FROM email_verification_tokens WHERE user_id=$1',[uid]);
  const gone=await client.query('DELETE FROM users WHERE user_id=$1 RETURNING user_id',[uid]);
  if(!gone.rowCount)throw new Error('Account deletion did not complete.');
  await client.query('COMMIT');
  res.json({message:'Your account and associated account data were permanently deleted.'});
 }catch(e){try{await client.query('ROLLBACK')}catch{};throw e;}finally{client.release();}
}));

app.get('/api/locations', asyncRoute(async (req,res) => {
 const {province,district,municipality}=req.query;
 // Combine the verified location catalogue with active shop addresses so suggestions
 // stay useful even when a shop address has not separately been added to locations.
 const r=await pool.query(`SELECT DISTINCT province,district,municipality,ward_no,town_village,exact_location
 FROM (
   SELECT province,district,municipality,ward_no,town_village,exact_location FROM locations WHERE status='active'
   UNION
   SELECT province,district,municipality,ward_no,town_village,exact_location FROM shops WHERE shop_status='active'
 ) available
 WHERE ($1::text IS NULL OR province=$1)
   AND ($2::text IS NULL OR district=$2)
   AND ($3::text IS NULL OR municipality=$3)
 ORDER BY province,district,municipality,ward_no,town_village,exact_location LIMIT 1000`,
 [province||null,district||null,municipality||null]);
 res.json({locations:r.rows, count:r.rowCount});
}));
app.get('/api/search', asyncRoute(async (req,res) => {
 const cylinder=text(req.query.cylinder,120), province=text(req.query.province,120), district=text(req.query.district,120), municipality=text(req.query.municipality,160), ward=text(req.query.ward,20), town=text(req.query.town,160), location=text(req.query.location,255);
 const qty=Math.max(1,Math.min(10000,Number.parseInt(req.query.quantity||'1',10)||1));
 const lat=Number(req.query.latitude), lon=Number(req.query.longitude);
 const hasCoordinates=req.query.latitude!==undefined && req.query.longitude!==undefined && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180;
 const r=await pool.query(`SELECT s.shop_id,s.shop_name,s.phone,s.province,s.district,s.municipality,s.ward_no,s.town_village,s.exact_location,s.latitude,s.longitude,st.cylinder_name,st.quantity,st.last_updated_at,COALESCE(rv.rating,0)::numeric(3,2) AS rating,COALESCE(rv.review_count,0)::int AS review_count FROM shops s JOIN stock st ON st.shop_id=s.shop_id LEFT JOIN (SELECT shop_id,AVG(rating) rating,COUNT(*) review_count FROM reviews WHERE status='active' GROUP BY shop_id) rv ON rv.shop_id=s.shop_id WHERE s.shop_status='active' AND ($1='' OR LOWER(st.cylinder_name)=LOWER($1) OR LOWER(st.cylinder_name) LIKE '%'||LOWER($1)||'%') LIMIT 5000`,[cylinder]);
 const norm=v=>String(v??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const matches=(actual,wanted)=>{const a=norm(actual),w=norm(wanted);return !!a&&!!w&&(a===w||a.includes(w)||w.includes(a));};
 const hasTextLocation=!!(province||district||municipality||ward||town||location);
 const requestedLocationFields=[
  ['province','Province',province],['district','District',district],['municipality','Municipality',municipality],
  ['ward_no','Ward',ward],['town_village','Town/Village',town],['exact_location','Exact Location',location]
 ].filter(field=>field[2]);
 let unmatchedLocationFields=[];
 if(requestedLocationFields.length){
  const catalogue=await pool.query(`SELECT province,district,municipality,ward_no,town_village,exact_location FROM locations WHERE status='active'
   UNION SELECT province,district,municipality,ward_no,town_village,exact_location FROM shops WHERE shop_status='active'`);
  unmatchedLocationFields=requestedLocationFields.filter(([column,,value])=>!catalogue.rows.some(row=>matches(row[column],value))).map(([,label])=>label);
 }
 const locationScore=shop=>{
  let score=0;
  if(matches(shop.province,province))score+=1;
  if(matches(shop.district,district))score+=2;
  if(matches(shop.municipality,municipality))score+=3;
  if(matches(shop.ward_no,ward))score+=4;
  if(matches(shop.town_village,town))score+=5;
  if(matches(shop.exact_location,location))score+=6;
  return score;
 };
 const distanceKm=shop=>{
  if(!hasCoordinates||shop.latitude===null||shop.latitude===undefined||shop.longitude===null||shop.longitude===undefined)return null;
  const slat=Number(shop.latitude), slon=Number(shop.longitude);
  if(!Number.isFinite(slat)||!Number.isFinite(slon)||Math.abs(slat)>90||Math.abs(slon)>180)return null;
  const rad=n=>n*Math.PI/180, dLat=rad(slat-lat), dLon=rad(slon-lon);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat))*Math.cos(rad(slat))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
 };
 const ranked=r.rows.map(shop=>({...shop,location_match_score:locationScore(shop),distance_km:distanceKm(shop)}));
 const stockRank=shop=>{
  const n=Number(shop.quantity);
  if(n<=0)return [2,0];
  if(n>=qty)return [0,n];
  return [1,n];
 };
 // When text location was entered, never return unrelated shops if none of the
 // requested location details match any part of their real address.
 const locationEligible=hasTextLocation
   ? ranked.filter(shop=>shop.location_match_score>0)
   : ranked;
 locationEligible.sort((a,b)=>{
  const aCylinder=norm(a.cylinder_name)===norm(cylinder)?0:1, bCylinder=norm(b.cylinder_name)===norm(cylinder)?0:1;
  if(cylinder&&(aCylinder!==bCylinder))return aCylinder-bCylinder;
  // Stock suitability comes first; distance (when supplied) or text-location match
  // then ranks shops within the same stock tier, followed by rating and freshness.
  const as=stockRank(a),bs=stockRank(b);
  if(as[0]!==bs[0])return as[0]-bs[0];
  if(as[1]!==bs[1])return bs[1]-as[1];
  if(hasCoordinates){
   if(a.distance_km!==null&&b.distance_km===null)return -1;
   if(a.distance_km===null&&b.distance_km!==null)return 1;
   if(a.distance_km!==null&&b.distance_km!==null&&Math.abs(a.distance_km-b.distance_km)>0.01)return a.distance_km-b.distance_km;
  }else if(hasTextLocation&&a.location_match_score!==b.location_match_score){
   return b.location_match_score-a.location_match_score;
  }
  const rating=Number(b.rating)-Number(a.rating); if(rating)return rating;
  const freshness=new Date(b.last_updated_at||0)-new Date(a.last_updated_at||0); if(freshness)return freshness;
  return String(a.shop_id).localeCompare(String(b.shop_id));
 });
 const lowerQuantityAvailable=locationEligible.some(x=>Number(x.quantity)>0&&Number(x.quantity)<qty);
 const lowerQuantityOnly=String(req.query.lowerQuantityOnly||'').toLowerCase()==='true';
 const allowLocationFallback=String(req.query.allowLocationFallback||'').toLowerCase()==='true';
 const fallbackAvailable=unmatchedLocationFields.length>0&&locationEligible.length>0&&!allowLocationFallback;
 const needsLocationFallback=unmatchedLocationFields.length>0&&!allowLocationFallback;
 const eligible=lowerQuantityOnly
   ? locationEligible.filter(x=>Number(x.quantity)>0&&Number(x.quantity)<qty)
   : locationEligible;
 const results=needsLocationFallback?[]:eligible.slice(0,100);
 res.json({results,count:results.length,requestedQuantity:qty,lowerQuantityAvailable,lowerQuantityOnly,unmatchedLocationFields,fallbackAvailable,allowLocationFallback,locationMode:hasCoordinates?'distance':hasTextLocation?'progressive-match':'none',disclaimer:'Stock information is provided by the trader and may change at any time. Please check the latest information before visiting.'});
}));

app.post('/api/trader/shops/check-duplicate',duplicateCheckLimiter,asyncRoute(async(req,res)=>{const name=text(req.body.shop_name,180),municipality=text(req.body.municipality,160),phone=text(req.body.phone,40),businessEmail=text(req.body.business_email,254).toLowerCase();if(!name||!municipality)return fail(res,400,'Shop name and municipality are required');const r=await pool.query(`SELECT EXISTS(SELECT 1 FROM shops WHERE shop_status IN ('active','pending','suspended') AND ((LOWER(shop_name)=LOWER($1) AND LOWER(municipality)=LOWER($2)) OR ($3<>'' AND phone=$3) OR ($4<>'' AND LOWER(COALESCE(business_email,''))=LOWER($4)))) AS possible_duplicate`,[name,municipality,phone,businessEmail]);res.json({possibleDuplicate:r.rows[0].possible_duplicate,message:r.rows[0].possible_duplicate?'You may have already registered this shop. Please check your existing account before creating a new listing.':'No strong duplicate match found.'});}));
app.post('/api/trader/shops',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const b=req.body;
 if(!required(b,['shop_name','province','district','municipality','exact_location']) || !Number.isFinite(Number(b.latitude)) || !Number.isFinite(Number(b.longitude)) || Math.abs(Number(b.latitude))>90 || Math.abs(Number(b.longitude))>180) return fail(res,400,'Shop name, location fields, latitude and longitude are required');
 try { const r=await pool.query(`INSERT INTO shops(owner_user_id,shop_name,phone,business_email,province,district,municipality,ward_no,town_village,exact_location,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.user_id,text(b.shop_name,180),text(b.phone,40)||null,text(b.business_email,254)||null,text(b.province,120),text(b.district,120),text(b.municipality,160),text(b.ward_no,20)||null,text(b.town_village,160)||null,text(b.exact_location,255),Number(b.latitude),Number(b.longitude)]); res.status(201).json({shop:r.rows[0],message:'Shop submitted for approval; it is not publicly listed until approved.'}); }
 catch(e){if(e.code==='23505')return fail(res,409,'This trader account already has a shop');throw e;}
}));
app.get('/api/trader/shops/mine',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM shops WHERE owner_user_id=$1',[req.user.user_id]);res.json({shops:r.rows});}));
app.patch('/api/trader/shops/:shopId',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const b=req.body; const shopName=text(b.shop_name,180), phone=text(b.phone,40), businessEmail=text(b.business_email,254).toLowerCase(), province=text(b.province,120), district=text(b.district,120), municipality=text(b.municipality,160), ward=text(b.ward_no,20), town=text(b.town_village,160), exact=text(b.exact_location,255);
 const lat=Number(b.latitude), lon=Number(b.longitude); if(!shopName||!province||!district||!municipality||!exact||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return fail(res,400,'Shop name, complete address, and valid map coordinates are required');
 const r=await pool.query("UPDATE shops SET shop_name=$1,phone=$2,business_email=$3,province=$4,district=$5,municipality=$6,ward_no=$7,town_village=$8,exact_location=$9,latitude=$10,longitude=$11,updated_at=NOW() WHERE shop_id=$12 AND owner_user_id=$13 AND shop_status IN ('active','pending') RETURNING *",[shopName,phone||null,businessEmail||null,province,district,municipality,ward||null,town||null,exact,lat,lon,req.params.shopId,req.user.user_id]); if(!r.rowCount)return fail(res,404,'Shop not found or not editable by this account');res.json({shop:r.rows[0],message:'Shop details updated.'});
}));
app.get('/api/trader/shops/:shopId/stock-history',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{const own=await pool.query('SELECT shop_id FROM shops WHERE shop_id=$1 AND owner_user_id=$2',[req.params.shopId,req.user.user_id]);if(!own.rowCount)return fail(res,404,'Shop not found');const r=await pool.query('SELECT update_id,cylinder_name,previous_quantity,new_quantity,updated_at FROM stock_update_history WHERE shop_id=$1 ORDER BY updated_at DESC LIMIT 100',[req.params.shopId]);res.json({history:r.rows});}));
app.put('/api/trader/shops/:shopId/stock',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const cylinder=text(req.body.cylinder_name,120), quantity=Number(req.body.quantity);
 if(!cylinder || !Number.isInteger(quantity) || quantity<0 || quantity>100000) return fail(res,400,'Cylinder name and a non-negative whole-number quantity are required');
 const client=await pool.connect(); try { await client.query('BEGIN'); const own=await client.query("SELECT shop_id FROM shops WHERE shop_id=$1 AND owner_user_id=$2 AND shop_status IN ('active','pending') FOR UPDATE",[req.params.shopId,req.user.user_id]); if(!own.rowCount){await client.query('ROLLBACK');return fail(res,404,'Shop not found or not owned by this account');}
 const prev=await client.query('SELECT quantity FROM stock WHERE shop_id=$1 AND cylinder_name=$2 FOR UPDATE',[req.params.shopId,cylinder]); const old=prev.rowCount?prev.rows[0].quantity:null;
 const saved=await client.query(`INSERT INTO stock(shop_id,cylinder_name,quantity,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(shop_id,cylinder_name) DO UPDATE SET quantity=EXCLUDED.quantity,last_updated_at=NOW(),updated_by=EXCLUDED.updated_by RETURNING *`,[req.params.shopId,cylinder,quantity,req.user.user_id]);
 await client.query('INSERT INTO stock_update_history(shop_id,updated_by,cylinder_name,previous_quantity,new_quantity) VALUES($1,$2,$3,$4,$5)',[req.params.shopId,req.user.user_id,cylinder,old,quantity]); await client.query('COMMIT'); res.json({stock:saved.rows[0]});
 } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
}));
app.post('/api/shops/:shopId/reviews',auth,getActiveUser,roles('customer'),asyncRoute(async(req,res)=>{
 if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot submit customer reviews'); const rating=Number(req.body.rating), review=text(req.body.review_text,3000); if(!Number.isInteger(rating)||rating<1||rating>5)return fail(res,400,'Rating must be 1–5');
 const shop=await pool.query("SELECT shop_id FROM shops WHERE shop_id=$1 AND shop_status='active'",[req.params.shopId]); if(!shop.rowCount)return fail(res,404,'Active shop not found');
 const r=await pool.query(`INSERT INTO reviews(shop_id,user_id,rating,review_text,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(shop_id,user_id) WHERE status='active' DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,updated_at=NOW() RETURNING *`,[req.params.shopId,req.user.user_id,rating,review||null]);
 const stats=await pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(3,2) AS rating,COUNT(*)::int AS review_count FROM reviews WHERE shop_id=$1 AND status='active'`,[req.params.shopId]);
 res.status(201).json({review:r.rows[0],rating:Number(stats.rows[0].rating),review_count:stats.rows[0].review_count});
}));
app.get('/api/shops/:shopId/reviews',asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT r.review_id,r.rating,r.review_text,r.created_at,r.updated_at,u.username FROM reviews r JOIN users u ON u.user_id=r.user_id WHERE r.shop_id=$1 AND r.status='active' ORDER BY r.created_at DESC LIMIT 100`,[req.params.shopId]);res.json({reviews:r.rows});}));
app.post('/api/shops/:shopId/reports',auth,getActiveUser,roles('customer'),asyncRoute(async(req,res)=>{
 if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot submit customer reports');
 const rawType=text(req.body.report_type,40), desc=text(req.body.description,3000);
// ========== PART 2 END ==========
   
// ========== PART 3 START ==========
  const reportTypes={stock_mismatch:'stock_mismatch',wrong_quantity:'stock_mismatch',wrong_cylinder:'stock_mismatch',incorrect_shop_info:'incorrect_shop_info',other:'other_information_issue',other_information_issue:'other_information_issue'};
  const type=reportTypes[rawType];
  if(!type||!desc)return fail(res,400,'Valid report type and description are required');
  const categoryNote=rawType==='wrong_quantity'?'[Specific issue: reported quantity is incorrect]\n':rawType==='wrong_cylinder'?'[Specific issue: cylinder type is incorrect]\n':'';
  const fullDescription=(categoryNote+desc).slice(0,3000);
  const shop=await pool.query("SELECT shop_id,owner_user_id FROM shops WHERE shop_id=$1 AND shop_status='active'",[req.params.shopId]); if(!shop.rowCount)return fail(res,404,'Active shop not found');
  const r=await pool.query('INSERT INTO reports(shop_id,reported_by,report_type,description) VALUES($1,$2,$3,$4) RETURNING *',[req.params.shopId,req.user.user_id,type,fullDescription]); await pool.query("INSERT INTO notifications(user_id,type,title,message) VALUES($1,'shop_report','New information report','A customer reported an information issue for your shop.')",[shop.rows[0].owner_user_id]); res.status(201).json({report:r.rows[0]});
 }));
app.get('/api/notifications',auth,getActiveUser,asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.user_id]);res.json({notifications:r.rows});}));
app.patch('/api/notifications/:id/read',auth,getActiveUser,asyncRoute(async(req,res)=>{const r=await pool.query('UPDATE notifications SET is_read=TRUE WHERE notification_id=$1 AND user_id=$2 RETURNING *',[req.params.id,req.user.user_id]);if(!r.rowCount)return fail(res,404,'Notification not found');res.json({notification:r.rows[0]});}));

// Profile and dashboard endpoints. Every private query is scoped to the authenticated user.
app.get('/api/customer/location',auth,getActiveUser,asyncRoute(async(req,res)=>{
 if(req.user.role!=='customer')return fail(res,403,'Saved location is available to customer accounts only.');
 const r=await pool.query('SELECT saved_latitude,saved_longitude,saved_location_label,saved_location_updated_at FROM users WHERE user_id=$1',[req.user.user_id]);
 const row=r.rows[0];
 const saved=row && row.saved_latitude!==null && row.saved_longitude!==null;
 res.json({location:saved?{latitude:Number(row.saved_latitude),longitude:Number(row.saved_longitude),label:row.saved_location_label||'Saved location',updated_at:row.saved_location_updated_at}:null});
}));
app.put('/api/customer/location',auth,getActiveUser,asyncRoute(async(req,res)=>{
 if(req.user.role!=='customer')return fail(res,403,'Saved location is available to customer accounts only.');
 const latitude=Number(req.body.latitude),longitude=Number(req.body.longitude),label=text(req.body.label,180)||'Saved location';
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return fail(res,400,'A valid location is required before saving.');
 const r=await pool.query('UPDATE users SET saved_latitude=$1,saved_longitude=$2,saved_location_label=$3,saved_location_updated_at=NOW(),updated_at=NOW() WHERE user_id=$4 RETURNING saved_latitude,saved_longitude,saved_location_label,saved_location_updated_at',[latitude,longitude,label,req.user.user_id]);
 const row=r.rows[0];res.json({location:{latitude:Number(row.saved_latitude),longitude:Number(row.saved_longitude),label:row.saved_location_label,updated_at:row.saved_location_updated_at},message:'Location saved to your account.'});
}));
app.delete('/api/customer/location',auth,getActiveUser,asyncRoute(async(req,res)=>{
 if(req.user.role!=='customer')return fail(res,403,'Saved location is available to customer accounts only.');
 await pool.query('UPDATE users SET saved_latitude=NULL,saved_longitude=NULL,saved_location_label=NULL,saved_location_updated_at=NULL,updated_at=NOW() WHERE user_id=$1',[req.user.user_id]);
 res.json({location:null,message:'Saved location cleared.'});
}));

app.patch('/api/profile',auth,getActiveUser,asyncRoute(async(req,res)=>{
 const username=text(req.body.username,50), email=text(req.body.email,254).toLowerCase();
 if(!/^[\p{L}\p{N}_.-]{3,50}$/u.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res,400,'Enter a valid username and email');
 try { const r=await pool.query('UPDATE users SET username=$1,email=$2,updated_at=NOW() WHERE user_id=$3 RETURNING user_id,username,email,role,account_status,created_at',[username,email,req.user.user_id]); res.json({user:r.rows[0]}); }
 catch(e){if(e.code==='23505')return fail(res,409,'Username or email is already in use');throw e;}
}));
app.get('/api/customer/reviews',auth,getActiveUser,roles('customer'),asyncRoute(async(req,res)=>{
 const r=await pool.query(`SELECT rv.review_id,rv.shop_id,rv.rating,rv.review_text,rv.status,rv.created_at,rv.updated_at,s.shop_name FROM reviews rv JOIN shops s ON s.shop_id=rv.shop_id WHERE rv.user_id=$1 ORDER BY rv.updated_at DESC LIMIT 100`,[req.user.user_id]);res.json({reviews:r.rows});
}));
app.get('/api/trader/reviews',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const r=await pool.query(`SELECT rv.review_id,rv.shop_id,rv.rating,rv.review_text,rv.status,rv.created_at,u.username FROM reviews rv JOIN shops s ON s.shop_id=rv.shop_id JOIN users u ON u.user_id=rv.user_id WHERE s.owner_user_id=$1 ORDER BY rv.created_at DESC LIMIT 100`,[req.user.user_id]);res.json({reviews:r.rows});
}));
app.get('/api/trader/reports',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT rp.report_id,rp.report_type,rp.description,rp.status,rp.created_at,rp.updated_at,s.shop_name FROM reports rp JOIN shops s ON s.shop_id=rp.shop_id WHERE s.owner_user_id=$1 ORDER BY rp.created_at DESC LIMIT 100`,[req.user.user_id]);res.json({reports:r.rows});}));
app.post('/api/reports/:reportId/verify',auth,getActiveUser,roles('trader'),asyncRoute(async(req,res)=>{
 const note=text(req.body.note,1500),decision=text(req.body.decision,20); if(!note||!['confirm','dispute'].includes(decision))return fail(res,400,'Choose whether you confirm or dispute the report and add a note');
 const owned=await pool.query(`SELECT r.report_id,r.shop_id FROM reports r JOIN shops s ON s.shop_id=r.shop_id WHERE r.report_id=$1 AND s.owner_user_id=$2 AND r.status IN ('open','trader_response_requested','under_review')`,[req.params.reportId,req.user.user_id]); if(!owned.rowCount)return fail(res,404,'Report not found for your shop');
 const client=await pool.connect();try{await client.query('BEGIN');const v=await client.query(`INSERT INTO report_verifications(report_id,requested_by,status,trader_note) VALUES($1,$2,$3,$4) RETURNING *`,[req.params.reportId,req.user.user_id,decision==='confirm'?'trader_confirmed':'trader_disputed',note]);await client.query(`UPDATE reports SET status='under_review',updated_at=NOW() WHERE report_id=$1`,[req.params.reportId]);await client.query(`INSERT INTO notifications(user_id,type,title,message) SELECT user_id,'report_verification','Trader responded to report',$2 FROM users WHERE role='admin' AND account_status IN ('active','warning')`,[`A trader submitted a verification response for report ${req.params.reportId}.`]);await client.query('COMMIT');res.status(201).json({verification:v.rows[0]});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
// Admin endpoints are guarded server-side; hiding admin links in the frontend is not authorization.
app.get('/api/admin/overview',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{
 const [users,shops,reports,reviews,stale]=await Promise.all([
 pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE account_status IN (\'active\',\'warning\'))::int AS active,COUNT(*) FILTER(WHERE role=\'trader\')::int AS traders FROM users'),
 pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE shop_status=\'pending\')::int AS pending,COUNT(*) FILTER(WHERE shop_status=\'active\')::int AS active FROM shops'),
 pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status IN (\'open\',\'trader_response_requested\',\'under_review\'))::int AS open FROM reports'),
 pool.query("SELECT COUNT(*)::int AS total FROM reviews WHERE status='active'"),
 pool.query("SELECT COUNT(*)::int AS total FROM stock WHERE last_updated_at < NOW()-INTERVAL '6 hours'")]);res.json({users:users.rows[0],shops:shops.rows[0],reports:reports.rows[0],reviews:reviews.rows[0],staleStock:stale.rows[0].total});
}));
app.post('/api/admin/notifications',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{
 const title=text(req.body.title,180), message=text(req.body.message,3000), audience=text(req.body.audience,20);
 if(title.length<3||message.length<3)return fail(res,400,'A title and message of at least 3 characters are required.');
 if(!['all','trader','customer'].includes(audience))return fail(res,400,'Choose all, trader, or customer as the audience.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const sent=await client.query(`INSERT INTO notifications(user_id,type,title,message)
   SELECT user_id,'admin_announcement',$2,$3 FROM users
   WHERE role IN ('customer','trader')
     AND account_status IN ('active','warning')
     AND ($1='all' OR role=$1)
   RETURNING notification_id`,[audience,title,message]);
  await client.query('INSERT INTO moderation_logs(admin_id,action,reason) VALUES($1,$2,$3)',[
   req.user.user_id,'admin_announcement_sent',
   `Audience: ${audience}; recipients: ${sent.rowCount}; title: ${title}; message: ${message}`
  ]);
  await client.query('COMMIT');
  res.status(201).json({sent:sent.rowCount,audience,message:`Notice sent to ${sent.rowCount} eligible account(s).`});
 }catch(e){try{await client.query('ROLLBACK')}catch{};throw e;}finally{client.release();}
}));
app.get('/api/admin/users',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query('SELECT user_id,username,email,role,account_status,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 300');res.json({users:r.rows});}));
app.patch('/api/admin/users/:id/status',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{
 const status=text(req.body.status,20), reason=text(req.body.reason,1000);if(!['active','warning','suspended','banned'].includes(status)||!reason)return fail(res,400,'Valid status and reason are required');if(req.params.id===req.user.user_id)return fail(res,400,'You cannot change your own account status');
 const client=await pool.connect();try{await client.query('BEGIN');const u=await client.query('UPDATE users SET account_status=$1,updated_at=NOW() WHERE user_id=$2 RETURNING user_id,username,email,role,account_status',[status,req.params.id]);if(!u.rowCount){await client.query('ROLLBACK');return fail(res,404,'User not found');}await client.query('INSERT INTO moderation_logs(admin_id,target_user_id,action,reason) VALUES($1,$2,$3,$4)',[req.user.user_id,''+req.params.id,'account_status:'+status,reason]);await client.query('INSERT INTO notifications(user_id,type,title,message) VALUES($1,\'account_status\',\'Account status updated\',$2)',[req.params.id,`Your GAS-INFO account status is now ${status}. Reason: ${reason}`]);await client.query('COMMIT');res.json({user:u.rows[0]});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/admin/shops',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT s.*,u.username AS owner_username,u.email AS owner_email FROM shops s JOIN users u ON u.user_id=s.owner_user_id ORDER BY CASE s.shop_status WHEN 'pending' THEN 0 ELSE 1 END,s.created_at DESC LIMIT 300`);res.json({shops:r.rows});}));
app.patch('/api/admin/shops/:id/status',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{
 const status=text(req.body.status,20),reason=text(req.body.reason,1000);if(!['active','rejected','suspended','closed','pending'].includes(status)||!reason)return fail(res,400,'Valid shop status and reason are required');
 const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('UPDATE shops SET shop_status=$1,updated_at=NOW() WHERE shop_id=$2 RETURNING shop_id,owner_user_id,shop_name,shop_status',[status,req.params.id]);if(!r.rowCount){await client.query('ROLLBACK');return fail(res,404,'Shop not found');}await client.query('INSERT INTO moderation_logs(admin_id,target_user_id,target_shop_id,action,reason) VALUES($1,$2,$3,$4,$5)',[req.user.user_id,r.rows[0].owner_user_id,r.rows[0].shop_id,'shop_status:'+status,reason]);await client.query('INSERT INTO notifications(user_id,type,title,message) VALUES($1,\'shop_status\',\'Shop listing status updated\',$2)',[r.rows[0].owner_user_id,`Your shop "${r.rows[0].shop_name}" status is now ${status}. Reason: ${reason}`]);await client.query('COMMIT');res.json({shop:r.rows[0]});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/admin/reports',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT rp.*,s.shop_name,u.username AS reporter_username FROM reports rp JOIN shops s ON s.shop_id=rp.shop_id JOIN users u ON u.user_id=rp.reported_by ORDER BY CASE rp.status WHEN 'open' THEN 0 WHEN 'trader_response_requested' THEN 1 WHEN 'under_review' THEN 2 ELSE 3 END,rp.created_at DESC LIMIT 300`);res.json({reports:r.rows});}));
app.patch('/api/admin/reports/:id/status',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{
 const status=text(req.body.status,20),reason=text(req.body.reason,1000),result=text(req.body.result,30);if(!['resolved','dismissed'].includes(status)||!reason||!['valid','false_report','inconclusive'].includes(result))return fail(res,400,'Choose resolved/dismissed, a reason, and result valid/false_report/inconclusive');
 const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query('UPDATE reports SET status=$1,updated_at=NOW(),resolved_at=NOW() WHERE report_id=$2 RETURNING *',[status,req.params.id]);if(!r.rowCount){await client.query('ROLLBACK');return fail(res,404,'Report not found');}await client.query(`INSERT INTO report_verifications(report_id,requested_by,status,admin_note,result,resolved_at) VALUES($1,$2,'resolved',$3,$4,NOW())`,[req.params.id,req.user.user_id,reason,result]);await client.query('INSERT INTO moderation_logs(admin_id,action,reason,related_report_id,target_shop_id) VALUES($1,$2,$3,$4,$5)',[req.user.user_id,'report:'+status+':'+result,reason,req.params.id,r.rows[0].shop_id]);await client.query('COMMIT');res.json({report:r.rows[0]});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/admin/reviews',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT rv.review_id,rv.shop_id,rv.user_id,rv.rating,rv.review_text,rv.status,rv.created_at,u.username,s.shop_name FROM reviews rv JOIN users u ON u.user_id=rv.user_id JOIN shops s ON s.shop_id=rv.shop_id ORDER BY rv.created_at DESC LIMIT 300`);res.json({reviews:r.rows});}));
app.patch('/api/admin/reviews/:id/status',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const status=text(req.body.status,20),reason=text(req.body.reason,1000);if(!['active','hidden','removed'].includes(status)||!reason)return fail(res,400,'Valid review status and reason are required');const r=await pool.query('UPDATE reviews SET status=$1,updated_at=NOW() WHERE review_id=$2 RETURNING review_id,status,shop_id,user_id',[status,req.params.id]);if(!r.rowCount)return fail(res,404,'Review not found');await pool.query('INSERT INTO moderation_logs(admin_id,target_user_id,target_shop_id,action,reason) VALUES($1,$2,$3,$4,$5)',[req.user.user_id,r.rows[0].user_id,r.rows[0].shop_id,'review_status:'+status,reason]);res.json({review:r.rows[0]});}));
app.post('/api/admin/strikes',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const userId=text(req.body.user_id,80),reason=text(req.body.reason,1500),expires=req.body.expires_at||null;if(!userId||!reason)return fail(res,400,'User and reason are required');const r=await pool.query('INSERT INTO strikes(user_id,reason,related_report_id,issued_by,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[userId,reason,req.body.related_report_id||null,req.user.user_id,expires]);await pool.query('INSERT INTO moderation_logs(admin_id,target_user_id,action,reason,related_report_id) VALUES($1,$2,\'strike_issued\',$3,$4)',[req.user.user_id,userId,reason,req.body.related_report_id||null]);await pool.query('INSERT INTO notifications(user_id,type,title,message) VALUES($1,\'strike\',\'A moderation strike was issued\',$2)',[userId,reason]);res.status(201).json({strike:r.rows[0]});}));
app.get('/api/admin/logs',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT m.*,a.username AS admin_username,u.username AS target_username,s.shop_name FROM moderation_logs m JOIN users a ON a.user_id=m.admin_id LEFT JOIN users u ON u.user_id=m.target_user_id LEFT JOIN shops s ON s.shop_id=m.target_shop_id ORDER BY m.created_at DESC LIMIT 300`);res.json({logs:r.rows});}));

// Password recovery: requires SMTP environment variables; never returns raw codes or reveals whether an email exists.
function mailTransport(){
 const host=process.env.SMTP_HOST, user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
 if(!host||!user||!pass||!process.env.MAIL_FROM) return null;
 return nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT)||587,secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user,pass}});
}
app.post('/api/auth/password-reset/request',resetLimiter,asyncRoute(async(req,res)=>{
 const email=text(req.body.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail(res,400,'Enter a valid email address');
 const mailer=mailTransport();if(!mailer)return fail(res,503,'Password reset email is not configured yet. The site owner must configure SMTP settings first.');
 const user=await pool.query('SELECT user_id,email FROM users WHERE email=$1 AND account_status IN (\'active\',\'warning\')',[email]);
 if(user.rowCount){const code=String(crypto.randomInt(0,1000000)).padStart(6,'0'),hash=crypto.createHash('sha256').update(code).digest('hex');await pool.query('UPDATE email_verification_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.rows[0].user_id]);await pool.query('INSERT INTO email_verification_tokens(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL \'15 minutes\')',[user.rows[0].user_id,hash]);await mailer.sendMail({from:process.env.MAIL_FROM,to:email,subject:'GAS-INFO password reset code',text:`Your GAS-INFO password reset code is ${code}. It expires in 15 minutes. If you did not request this, ignore this email. Do not share this code.`,html:`<p>Your GAS-INFO password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:5px">${code}</p><p>It expires in 15 minutes. If you did not request this, ignore this email. Do not share this code.</p>`});}
 res.json({message:'If an eligible account uses that email, a verification code has been sent. Check your inbox and spam folder.'});
}));
app.post('/api/auth/password-reset/verify',resetLimiter,asyncRoute(async(req,res)=>{
 const email=text(req.body.email,254).toLowerCase(),code=text(req.body.code,10);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(code))return fail(res,400,'Enter a valid email and six-digit code');
 const hash=crypto.createHash('sha256').update(code).digest('hex');const r=await pool.query(`SELECT t.token_id,t.user_id FROM email_verification_tokens t JOIN users u ON u.user_id=t.user_id WHERE u.email=$1 AND t.token_hash=$2 AND t.used_at IS NULL AND t.expires_at>NOW() ORDER BY t.created_at DESC LIMIT 1`,[email,hash]);if(!r.rowCount)return fail(res,400,'The code is invalid or expired. Request a new code.');
 await pool.query('UPDATE email_verification_tokens SET used_at=NOW() WHERE token_id=$1',[r.rows[0].token_id]);const resetToken=jwt.sign({sub:r.rows[0].user_id,purpose:'password-reset'},process.env.JWT_SECRET,{expiresIn:'10m'});res.json({resetToken});
}));
app.post('/api/auth/password-reset/complete',resetLimiter,asyncRoute(async(req,res)=>{
 const token=text(req.body.resetToken,2048),password=typeof req.body.password==='string'?req.body.password:'';if(password.length<8||password.length>128)return fail(res,400,'Password must be 8–128 characters');let payload;try{payload=jwt.verify(token,process.env.JWT_SECRET);}catch{return fail(res,400,'Password reset session expired. Start again.');}if(payload.purpose!=='password-reset'||!payload.sub)return fail(res,400,'Invalid password reset session');const hash=await bcrypt.hash(password,12);const r=await pool.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE user_id=$2 AND account_status IN (\'active\',\'warning\') RETURNING user_id',[hash,payload.sub]);if(!r.rowCount)return fail(res,400,'Account is unavailable');await pool.query('UPDATE email_verification_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[payload.sub]);res.json({message:'Password changed successfully. Please sign in again.'});
}));


app.get('/api/website-reviews',asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT wr.review_id,wr.rating,wr.review_text,wr.created_at,u.username FROM website_reviews wr JOIN users u ON u.user_id=wr.user_id WHERE wr.status='active' ORDER BY wr.created_at DESC LIMIT 100`);res.json({reviews:r.rows});}));
app.post('/api/website-reviews',auth,getActiveUser,asyncRoute(async(req,res)=>{if(req.user.role==='admin')return fail(res,403,'Admin accounts cannot submit website reviews');const rating=Number(req.body.rating),review=text(req.body.review_text,3000);if(!Number.isInteger(rating)||rating<1||rating>5)return fail(res,400,'Rating must be 1–5');const r=await pool.query(`INSERT INTO website_reviews(user_id,rating,review_text,status) VALUES($1,$2,$3,'active') RETURNING *`,[req.user.user_id,rating,review||null]);res.status(201).json({review:r.rows[0]});}));
app.get('/api/admin/website-reviews',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const r=await pool.query(`SELECT wr.review_id,wr.rating,wr.review_text,wr.status,wr.created_at,u.username FROM website_reviews wr JOIN users u ON u.user_id=wr.user_id ORDER BY wr.created_at DESC LIMIT 300`);res.json({reviews:r.rows});}));
app.patch('/api/admin/website-reviews/:id/status',auth,getActiveUser,roles('admin'),asyncRoute(async(req,res)=>{const status=text(req.body.status,20),reason=text(req.body.reason,1000);if(!['active','hidden','removed'].includes(status)||!reason)return fail(res,400,'Valid review status and reason are required');const r=await pool.query('UPDATE website_reviews SET status=$1,updated_at=NOW() WHERE review_id=$2 RETURNING review_id,status,user_id',[status,req.params.id]);if(!r.rowCount)return fail(res,404,'Website review not found');await pool.query('INSERT INTO moderation_logs(admin_id,target_user_id,action,reason) VALUES($1,$2,$3,$4)',[req.user.user_id,r.rows[0].user_id,'website_review_status:'+status,reason]);res.json({review:r.rows[0]});}));

// Create one in-app reminder for each stock record that has gone stale for 6 hours.
// notification_events lets a later stock update become eligible for a fresh reminder.
async function processStockUpdateReminders(){
 const client=await pool.connect();
 let locked=false, inTransaction=false;
 try{
  const lock=await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[6810261027]);
  locked=Boolean(lock.rows[0]?.acquired);
  if(!locked)return 0;
  await client.query('BEGIN');inTransaction=true;
  const result=await client.query(`
   WITH stale AS (
    SELECT st.stock_id,st.cylinder_name,st.last_updated_at,sh.shop_id,sh.shop_name,sh.owner_user_id
    FROM stock st
    JOIN shops sh ON sh.shop_id=st.shop_id
    JOIN users u ON u.user_id=sh.owner_user_id
    WHERE st.last_updated_at <= NOW()-INTERVAL '6 hours'
      AND sh.shop_status IN ('active','pending')
      AND u.role='trader'
      AND u.account_status IN ('active','warning')
   ),
   new_events AS (
    INSERT INTO notification_events(user_id,event_type,related_id,status,processed_at)
    SELECT s.owner_user_id,'stock_update_reminder',s.stock_id,'sent',NOW()
    FROM stale s
    WHERE NOT EXISTS (
     SELECT 1 FROM notification_events e
     WHERE e.user_id=s.owner_user_id
       AND e.event_type='stock_update_reminder'
       AND e.related_id=s.stock_id
       AND e.created_at >= s.last_updated_at
    )
    RETURNING user_id,related_id
   )
   INSERT INTO notifications(user_id,type,title,message)
   SELECT ne.user_id,'stock_update_reminder','Time to update your stock',
     'Your reported stock for '||st.cylinder_name||' at "'||sh.shop_name||
     '" has not been updated for over 6 hours. Please review and update the reported quantity.'
   FROM new_events ne
   JOIN stock st ON st.stock_id=ne.related_id
   JOIN shops sh ON sh.shop_id=st.shop_id
   RETURNING notification_id
  `);
  await client.query('COMMIT');inTransaction=false;
  return result.rowCount;
 }catch(error){
  if(inTransaction){try{await client.query('ROLLBACK')}catch{}}
  throw error;
 }finally{
  if(locked){try{await client.query('SELECT pg_advisory_unlock($1)',[6810261027])}catch{}}
  client.release();
 }
}

// Optional external scheduler hook for hosting plans that sleep while idle.
// Configure CRON_SECRET and call this endpoint with x-cron-secret to run the same safe sweep.
app.post('/api/internal/jobs/stock-reminders',asyncRoute(async(req,res)=>{
 const secret=process.env.CRON_SECRET;
 if(!secret)return fail(res,404,'Not found');
 const provided=String(req.get('x-cron-secret')||'');
 const expected=Buffer.from(secret),actual=Buffer.from(provided);
 if(!provided||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return fail(res,401,'Unauthorized');
 const notificationsCreated=await processStockUpdateReminders();
 res.json({ok:true,notificationsCreated});
}));

app.use((req,res)=>fail(res,404,'API route not found'));
app.use((err,req,res,next)=>{console.error(err); if(err.code==='23503')return fail(res,400,'Referenced record does not exist'); if(err.code==='22P02')return fail(res,400,'Invalid ID or field format'); res.status(500).json({error:'Internal server error'});});
const port=Number(process.env.PORT)||3000;
if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters.');
app.listen(port,'0.0.0.0',()=>{
 console.log(`GAS-INFO API listening on ${port}`);
 setTimeout(()=>processStockUpdateReminders().then(n=>{if(n)console.log(`Created ${n} stock reminder(s).`)}).catch(e=>console.error('Stock reminder sweep failed:',e.message)),15000).unref();
});
const stockReminderTimer=setInterval(()=>processStockUpdateReminders().then(n=>{if(n)console.log(`Created ${n} stock reminder(s).`)}).catch(e=>console.error('Stock reminder sweep failed:',e.message)),10*60*1000);
stockReminderTimer.unref();
// ========== PART 3 END ==========
                                                                    
 
