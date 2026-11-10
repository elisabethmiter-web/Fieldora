"use strict";
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const totp = require("./lib/totp");
const mail = require("./lib/mail");
const { buildReport } = require("./lib/report-pdf");
const importer = require("./lib/importer");
const graph = require("./lib/graph");
const custom = require("./lib/custom");
const forms = require("./lib/forms");
const industries = require("./lib/industries");
const archiver = require("archiver");
const ExcelJS = require("exceljs");

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const IS_PROD = process.env.NODE_ENV === "production";

if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!SESSION_SECRET || SESSION_SECRET.length < 16) { console.error("SESSION_SECRET must be set (16+ characters)"); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false,
  max: 5,
});

const COLLECTIONS = new Set(["customers", "jobs"]);
const ROLES = ["owner", "manager", "staff"];
const SESSION_DAYS = 30;
const COOKIE = "fielora_session";
// Fields on a job that only the maintenance-form endpoints may change.
const PROTECTED_JOB_FIELDS = ["form", "formCompletedAt", "formSentAt", "formSentTo"];

/* ---------- database schema ---------- */
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS support_threads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      mode TEXT NOT NULL DEFAULT 'ai',
      last_sender TEXT NOT NULL DEFAULT 'user',
      user_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      admin_read_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
      sender TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS support_messages_thread ON support_messages (thread_id, id);
    CREATE TABLE IF NOT EXISTS admin_log (
      id SERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      admin TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
    DROP TABLE IF EXISTS password_resets;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS password_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      handled_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      handled_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS edit_locks (
      coll TEXT NOT NULL,
      record_id TEXT NOT NULL,
      tab TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      since TIMESTAMPTZ NOT NULL DEFAULT now(),
      heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (coll, record_id, tab)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = {
  require2fa: false,
  homeBase: null, // set at first setup or in Business settings
  business: { name: "", phone: "", email: "", website: "" },
  forms: null,    // filled from the trade's default forms when nothing is saved
  industry: null, // trade preset + edits (see lib/industries.js)
};
async function getSettings() {
  const { rows } = await pool.query("SELECT key, value FROM settings WHERE key <> 'logo'");
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of rows) out[r.key] = out[r.key] && typeof out[r.key] === "object" && !Array.isArray(out[r.key]) && r.value && typeof r.value === "object" ? { ...out[r.key], ...r.value } : r.value;
  out.industry = industries.sanitize(out.industry || { preset: "general" });
  out.custom = custom.merge(out.custom);
  if (!out.forms || !Array.isArray(out.forms.templates)) out.forms = forms.sanitize(industries.presetForms(out.industry.preset));
  return out;
}
async function getLogo() {
  const r = (await pool.query("SELECT value FROM settings WHERE key = 'logo'")).rows[0];
  return r?.value?.data ? { mime: r.value.mime, buffer: Buffer.from(r.value.data, "base64"), v: r.value.v } : null;
}
async function reportAssets(settings) { return { business: settings.business, logo: await getLogo(), footer: settings.forms?.footer || "", industry: settings.industry, custom: settings.custom }; }
async function putSetting(key, value) {
  await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
}

/* ---------- passwords (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/* ---------- encryption for 2FA secrets at rest ---------- */
const ENC_KEY = crypto.createHash("sha256").update(SESSION_SECRET + ":totp").digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `${iv.toString("hex")}.${c.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}
function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(enc, "hex")), d.final()]).toString("utf8");
}
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const s = crypto.randomBytes(5).toString("hex");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

/* ---------- signed tokens (session cookie + 2FA ticket) ---------- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function setSession(res, user) {
  pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]).catch(() => {});
  const token = sign({ t: "s", uid: user.id, v: user.session_version, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${IS_PROD ? "; Secure" : ""}`);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${IS_PROD ? "; Secure" : ""}`);
}

/* ---------- throttling ---------- */
const attempts = new Map();
const throttled = key => { const a = attempts.get(key); return a && a.until > Date.now(); };
function recordFailure(key, limit = 5) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= limit) { a.until = Date.now() + 15 * 60 * 1000; a.count = 0; }
  attempts.set(key, a);
}

/* ---------- app ---------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
// Spreadsheet uploads for the import wizard can be larger than normal requests.
const jsonSmall = express.json({ limit: "400kb" }), jsonLarge = express.json({ limit: "25mb" });
app.use((req, res, next) => (req.path === "/api/import/file" || req.path === "/api/branding/logo" ? jsonLarge : jsonSmall)(req, res, next));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // Send only the site address (never page paths) to other sites. OpenStreetMap blocks map
  // tile requests that arrive with no referrer at all.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

function requireAjax(req, res, next) {
  // Lock release is sent by navigator.sendBeacon when a tab closes, which can't add headers.
  if (/^\/locks\/[a-z]+\/[a-z0-9]+\/release$/i.test(req.path)) return next();
  if (req.method !== "GET" && req.get("X-Requested-With") !== "fielora") return res.status(403).json({ error: "Bad request origin." });
  next();
}
app.use("/api", requireAjax);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const USER_COLS = "id, username, name, email, role, session_version, totp_enabled, must_change_password";

// Paths a signed-in user may reach before finishing required 2FA setup.
const SETUP_ALLOWED = new Set(["/api/me", "/api/logout", "/api/2fa/setup", "/api/2fa/enable"]);
const CHANGE_ALLOWED = new Set(["/api/me", "/api/logout", "/api/password"]);
const auth = wrap(async (req, res, next) => {
  const p = verify(readCookie(req, COOKIE));
  if (!p || p.t !== "s") return res.status(401).json({ error: "Sign in to continue." });
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [p.uid]);
  if (!rows[0] || rows[0].session_version !== p.v) { clearSession(res); return res.status(401).json({ error: "Sign in to continue." }); }
  req.user = rows[0];
  if (!ROLES.includes(req.user.role)) { clearSession(res); return res.status(401).json({ error: "This account type isn’t available. Ask the owner to change it to Staff." }); }
  req.settings = await getSettings();
  if (req.settings.require2fa && !req.user.totp_enabled && !SETUP_ALLOWED.has(req.baseUrl + req.path) && !SETUP_ALLOWED.has(req.originalUrl.split("?")[0])) {
    return res.status(403).json({ error: "Set up two-step login to continue.", code: "2fa_required" });
  }
  if (req.user.must_change_password && !CHANGE_ALLOWED.has(req.originalUrl.split("?")[0])) {
    return res.status(403).json({ error: "Choose a new password to continue.", code: "password_change_required" });
  }
  next();
});
const allow = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Your account doesn’t have access to that." });
const workers = allow("owner", "manager", "staff");
const managers = allow("owner", "manager");   // set up forms, edit/delete jobs and customers, import/export, help with passwords

app.get("/healthz", wrap(async (req, res) => { await pool.query("SELECT 1"); res.send("ok"); }));

/* ---------- setup + sign-in ---------- */
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, email: u.email || "", role: u.role, totpEnabled: !!u.totp_enabled, mustChangePassword: !!u.must_change_password }; }
// An email address is optional; when given it must look valid. Used for password reset links.
function cleanEmail(v) {
  const e = String(v ?? "").trim().toLowerCase().slice(0, 200);
  if (e && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e)) return { error: "Check the email address." };
  return { email: e };
}
function validateNewUser(username, password) {
  if (!/^[a-z0-9._-]{3,32}$/i.test(String(username || "").trim())) return "Usernames are 3–32 letters, numbers, dots, dashes or underscores.";
  if (String(password || "").length < 10) return "Passwords need at least 10 characters.";
  return null;
}

app.get("/api/setup", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
  res.json({ needsSetup: rows[0].n === 0, presets: rows[0].n === 0 ? industries.presetList() : undefined });
}));

app.post("/api/setup", wrap(async (req, res) => {
  const { username, password, name } = req.body || {};
  const err = validateNewUser(username, password);
  if (err) return res.status(400).json({ error: err });
  const em = cleanEmail(req.body?.email);
  if (em.error) return res.status(400).json({ error: em.error });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE users IN EXCLUSIVE MODE");
    const { rows } = await client.query("SELECT count(*)::int AS n FROM users");
    if (rows[0].n > 0) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Setup is already done. Sign in instead." }); }
    const ins = await client.query(
      `INSERT INTO users (username, name, email, pass_hash, role) VALUES ($1, $2, $3, $4, 'owner') RETURNING ${USER_COLS}`,
      [username.trim().toLowerCase(), String(name || "").trim(), em.email, hashPassword(password)]);
    await client.query("COMMIT");
    // first-run choices: trade, business name, home base
    const preset = industries.PRESETS[req.body?.industry] ? req.body.industry : "general";
    await putSetting("industry", industries.fromPreset(preset));
    const bname = String(req.body?.businessName || "").trim().slice(0, 120);
    if (bname) await putSetting("business", { ...DEFAULT_SETTINGS.business, name: bname });
    const town = String(req.body?.homeTown || "").trim().slice(0, 120);
    if (town) { try { const g = await nominatim(town); if (g[0]) await putSetting("homeBase", { label: town, lat: Number(g[0].lat), lng: Number(g[0].lon) }); } catch {} }
    setSession(res, ins.rows[0]);
    res.json({ user: publicUser(ins.rows[0]) });
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}));

app.post("/api/login", wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const key = `pw|${req.ip}|${username}`;
  if (throttled(key)) return res.status(429).json({ error: "Too many tries. Wait 15 minutes and try again." });
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  if (!rows[0] || !checkPassword(password, rows[0].pass_hash)) {
    recordFailure(key);
    return res.status(401).json({ error: "That username and password don’t match." });
  }
  attempts.delete(key);
  const u = rows[0];
  if (!ROLES.includes(u.role)) return res.status(403).json({ error: "This account type isn’t available. Ask the owner to change it to Staff." });
  if (u.totp_enabled) {
    return res.json({ needs2fa: true, ticket: sign({ t: "2fa", uid: u.id, v: u.session_version, exp: Date.now() + 5 * 60 * 1000 }) });
  }
  setSession(res, u);
  res.json({ user: publicUser(u) });
}));

app.post("/api/login/2fa", wrap(async (req, res) => {
  const p = verify(req.body?.ticket);
  if (!p || p.t !== "2fa") return res.status(401).json({ error: "That took too long. Enter your password again.", code: "ticket_expired" });
  const key = `2fa|${p.uid}`;
  if (throttled(key)) return res.status(429).json({ error: "Too many wrong codes. Wait 15 minutes and try again." });
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [p.uid]);
  const u = rows[0];
  if (!u || u.session_version !== p.v || !u.totp_enabled) return res.status(401).json({ error: "Enter your password again.", code: "ticket_expired" });
  const code = String(req.body?.code || "").trim().toLowerCase();
  let ok = false;
  if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
    const step = totp.verify(decrypt(u.totp_secret), code, Number(u.totp_last_step));
    if (step !== null) { ok = true; await pool.query("UPDATE users SET totp_last_step = $1 WHERE id = $2", [step, u.id]); }
  } else if (/^[a-f0-9]{5}-?[a-f0-9]{5}$/.test(code)) {
    const norm = code.replace("-", "").replace(/^(.{5})/, "$1-");
    const hashes = u.recovery_codes || [];
    const idx = hashes.indexOf(sha256(norm));
    if (idx >= 0) {
      ok = true;
      hashes.splice(idx, 1);
      await pool.query("UPDATE users SET recovery_codes = $1 WHERE id = $2", [JSON.stringify(hashes), u.id]);
    }
  }
  if (!ok) { recordFailure(key); return res.status(401).json({ error: "That code isn’t right. Check your authenticator app and try again." }); }
  attempts.delete(key);
  setSession(res, u);
  res.json({ user: publicUser(u), recoveryLeft: (u.recovery_codes || []).length });
}));

app.post("/api/logout", (req, res) => { clearSession(res); res.json({ ok: true }); });

/* ---------- forgot password: a request to the company's owners/managers and to support ---------- */
// No email involved. Whoever helps sets a temporary password, which must be changed at the next sign-in.
app.post("/api/password/request", wrap(async (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase().slice(0, 40);
  if (!username) return res.status(400).json({ error: "Enter your username." });
  const ipKey = `pwreq|${req.ip}`, uKey = `pwreq|${username}`;
  if (throttled(ipKey) || throttled(uKey)) return res.status(429).json({ error: "Too many requests. Wait 15 minutes and try again." });
  recordFailure(ipKey, 10); recordFailure(uKey, 3);
  // Same answer whether or not the username exists, so this can't be used to find accounts.
  const u = (await pool.query("SELECT id, role FROM users WHERE username = $1", [username])).rows[0];
  if (u && ROLES.includes(u.role)) {
    const open = (await pool.query("SELECT id FROM password_requests WHERE user_id = $1 AND status = 'open'", [u.id])).rows[0];
    if (open) await pool.query("UPDATE password_requests SET created_at = now() WHERE id = $1", [open.id]);
    else await pool.query("INSERT INTO password_requests (user_id) VALUES ($1)", [u.id]);
  }
  res.json({ ok: true, support: adminEnabled() });
}));
// Who may help whom: owners help anyone; managers help staff.
const canManage = (actor, target) => actor.role === "owner" || (actor.role === "manager" && target.role === "staff");
async function openPasswordRequests(actor) {
  const { rows } = await pool.query(`SELECT r.id, r.created_at, u.id AS user_id, u.username, u.name, u.role FROM password_requests r JOIN users u ON u.id = r.user_id
    WHERE r.status = 'open' ORDER BY r.created_at`);
  return rows.filter(r => !actor || canManage(actor, r)).map(r => ({ id: r.id, at: r.created_at, user: { id: r.user_id, username: r.username, name: r.name, role: r.role } }));
}
const closeRequests = (userId, by) => pool.query("UPDATE password_requests SET status = 'done', handled_by = $1, handled_at = now() WHERE user_id = $2 AND status = 'open'", [by, userId]);
app.get("/api/password/requests", auth, allow("owner", "manager"), wrap(async (req, res) => res.json({ requests: await openPasswordRequests(req.user) })));
app.post("/api/password/requests/:id/dismiss", auth, allow("owner", "manager"), wrap(async (req, res) => {
  const r = (await pool.query("SELECT r.id, u.role FROM password_requests r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.status = 'open'", [Number(req.params.id)])).rows[0];
  if (!r) return res.status(404).json({ error: "That request was already handled." });
  if (!canManage(req.user, r)) return res.status(403).json({ error: "Only an owner can handle that request." });
  await pool.query("UPDATE password_requests SET status = 'dismissed', handled_by = $1, handled_at = now() WHERE id = $2", [req.user.name || req.user.username, r.id]);
  res.json({ ok: true });
}));
// Each person can keep a contact email address on their account (optional).
app.put("/api/me/email", auth, wrap(async (req, res) => {
  const em = cleanEmail(req.body?.email);
  if (em.error) return res.status(400).json({ error: em.error });
  await pool.query("UPDATE users SET email = $1 WHERE id = $2", [em.email, req.user.id]);
  res.json({ email: em.email });
}));

app.get("/api/me", auth, wrap(async (req, res) => {
  const s = req.settings;
  res.json({
    user: publicUser(req.user),
    needs2faSetup: s.require2fa && !req.user.totp_enabled,
    settings: { require2fa: s.require2fa, homeBase: s.homeBase, business: s.business },
    mail: { configured: mail.configured(), from: mail.configured() ? mail.mailFrom() : "" },
    sharepoint: { configured: graph.configured() },
    industry: s.industry, presets: industries.presetList(),
    notice: s.notice && s.notice.text ? s.notice : null,
    supportChat: chatEnabled() && s.custom.features.help,
    passwordRequests: ["owner", "manager"].includes(req.user.role) ? (await openPasswordRequests(req.user)).length : 0,
    custom: { ...s.custom, assistantNotes: undefined },
    forms: s.forms,
    branding: { logo: !!(await pool.query("SELECT 1 FROM settings WHERE key = 'logo'")).rows.length },
    // Optional backup map provider (e.g. MapTiler, Stadia, Thunderforest) set on Render.
    mapTiles: process.env.MAP_TILES_URL ? { url: process.env.MAP_TILES_URL, attribution: process.env.MAP_TILES_ATTRIBUTION || "" } : null,
  });
}));

/* ---------- two-step login (authenticator app) ---------- */
app.post("/api/2fa/setup", auth, wrap(async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: "Two-step login is already on." });
  const secret = totp.newSecret();
  await pool.query("UPDATE users SET totp_pending = $1 WHERE id = $2", [encrypt(secret), req.user.id]);
  const issuer = (req.settings.business.name || "Fielora").replace(/:/g, "");
  const url = totp.otpauthUrl(secret, req.user.username, issuer);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ secret: secret.replace(/(.{4})/g, "$1 ").trim(), qr });
}));

app.post("/api/2fa/enable", auth, wrap(async (req, res) => {
  const key = `2fa-setup|${req.user.id}`;
  if (throttled(key)) return res.status(429).json({ error: "Too many wrong codes. Wait 15 minutes and try again." });
  const { rows } = await pool.query("SELECT totp_pending FROM users WHERE id = $1", [req.user.id]);
  if (!rows[0]?.totp_pending) return res.status(400).json({ error: "Start setup again." });
  const secret = decrypt(rows[0].totp_pending);
  const step = totp.verify(secret, req.body?.code, 0);
  if (step === null) { recordFailure(key); return res.status(400).json({ error: "That code isn’t right. Make sure your phone’s time is set automatically, then try the newest code." }); }
  const codes = newRecoveryCodes();
  await pool.query(
    "UPDATE users SET totp_secret = $1, totp_pending = NULL, totp_enabled = true, totp_last_step = $2, recovery_codes = $3 WHERE id = $4",
    [encrypt(secret), step, JSON.stringify(codes.map(sha256)), req.user.id]);
  res.json({ ok: true, recoveryCodes: codes });
}));

app.post("/api/2fa/disable", auth, wrap(async (req, res) => {
  if (req.settings.require2fa) return res.status(400).json({ error: "Two-step login is required for everyone, so it can’t be turned off." });
  const { rows } = await pool.query("SELECT pass_hash FROM users WHERE id = $1", [req.user.id]);
  if (!checkPassword(String(req.body?.password || ""), rows[0].pass_hash)) return res.status(400).json({ error: "Your password is wrong." });
  await pool.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_pending = NULL, recovery_codes = '[]' WHERE id = $1", [req.user.id]);
  res.json({ ok: true });
}));

/* ---------- settings (owner) ---------- */
app.put("/api/settings", auth, allow("owner"), wrap(async (req, res) => {
  const b = req.body || {};
  if ("require2fa" in b) {
    if (b.require2fa && !req.user.totp_enabled) return res.status(400).json({ error: "Turn on two-step login for your own account first." });
    await putSetting("require2fa", !!b.require2fa);
  }
  if (b.homeBase) {
    const lat = Number(b.homeBase.lat), lng = Number(b.homeBase.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: "That home base location isn’t valid." });
    await putSetting("homeBase", { label: String(b.homeBase.label || "").slice(0, 80), lat, lng });
  }
  if (b.business) {
    const s = v => String(v || "").trim().slice(0, 120);
    await putSetting("business", { name: s(b.business.name) || DEFAULT_SETTINGS.business.name, phone: s(b.business.phone), email: s(b.business.email), website: s(b.business.website) });
  }
  const st = await getSettings();
  res.json({ settings: { require2fa: st.require2fa, homeBase: st.homeBase, business: st.business } });
}));

/* ---------- data ---------- */
app.get("/api/data", auth, wrap(async (req, res) => {
  const [c, j] = await Promise.all([pool.query("SELECT id, data FROM customers"), pool.query("SELECT id, data FROM jobs")]);
  const toMap = rows => Object.fromEntries(rows.map(r => [r.id, r.data]));
  res.json({ customers: toMap(c.rows), jobs: toMap(j.rows), notice: req.settings.notice?.text ? req.settings.notice : null, supportUnread: chatEnabled() && req.settings.custom.features.help ? await supportUnread(req.user.id) : 0,
    passwordRequests: ["owner", "manager"].includes(req.user.role) ? (await openPasswordRequests(req.user)).length : 0 });
}));

const validId = id => /^[a-z0-9]{6,40}$/i.test(String(id));

app.put("/api/:coll/:id", (req, res, next) => COLLECTIONS.has(req.params.coll) ? next() : next("route"), auth, wrap(async (req, res) => {
  const { coll, id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: "Invalid id." });
  const data = req.body;
  if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Invalid data." });
  const existing = (await pool.query(`SELECT data FROM ${coll} WHERE id = $1`, [id])).rows[0]?.data;
  if (req.user.role === "staff") {
    const ownPersonal = coll === "jobs" && data.type === "personal" && (!existing || (existing.type === "personal" && existing.ownerId === req.user.id));
    if (!ownPersonal) return res.status(403).json({ error: "Staff can view jobs and customers but not change them. Ask a manager or owner.", code: "not_allowed" });
  }
  if (coll === "jobs" && data.type === "personal") data.ownerId = existing?.ownerId ?? req.user.id;
  if (coll === "jobs") {
    if (data.type === "personal") { delete data.customerId; data.title = String(data.title || "").slice(0, 120); }
    for (const f of PROTECTED_JOB_FIELDS) { if (existing && f in existing) data[f] = existing[f]; else delete data[f]; }
  }
  {
    const fields = coll === "jobs" ? req.settings.custom.jobFields : req.settings.custom.customerFields;
    const known = new Set(fields.map(f => f.id)), kept = {};
    for (const [k, v] of Object.entries(existing?.custom || {})) if (!known.has(k)) kept[k] = v;
    const vals = { ...kept, ...custom.cleanValues(fields, data.custom) };
    if (Object.keys(vals).length) data.custom = vals; else delete data.custom;
  }
  if (coll === "customers") {
    if (data.lat !== undefined && data.lat !== "" && !isFinite(Number(data.lat))) delete data.lat;
    if (data.lng !== undefined && data.lng !== "" && !isFinite(Number(data.lng))) delete data.lng;
  }
  await pool.query(
    `INSERT INTO ${coll} (id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [id, data]);
  res.json({ ok: true });
}));

app.delete("/api/:coll/:id", (req, res, next) => COLLECTIONS.has(req.params.coll) ? next() : next("route"), auth, wrap(async (req, res) => {
  const { coll, id } = req.params;
  if (req.user.role === "staff") {
    const ex = (await pool.query(`SELECT data FROM ${coll} WHERE id = $1`, [id])).rows[0]?.data;
    if (!(coll === "jobs" && ex?.type === "personal" && ex.ownerId === req.user.id)) return res.status(403).json({ error: "Only a manager or owner can delete that.", code: "not_allowed" });
  }
  await pool.query(`DELETE FROM ${coll} WHERE id = $1`, [id]);
  res.json({ ok: true });
}));

async function buildBackup() {
  const [c, j] = await Promise.all([
    pool.query("SELECT id, data, updated_at FROM customers ORDER BY id"),
    pool.query("SELECT id, data, updated_at FROM jobs ORDER BY id"),
  ]);
  const settings = (await pool.query("SELECT key, value FROM settings WHERE key <> 'require2fa'")).rows;
  return { exportedAt: new Date().toISOString(), customers: c.rows, jobs: j.rows, settings };
}
app.get("/api/export", auth, managers, wrap(async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Disposition", `attachment; filename="fielora-backup-${stamp}.json"`);
  res.json(await buildBackup());
}));

/* ---------- address lookup for the map (OpenStreetMap Nominatim) ---------- */
// Nominatim's usage policy: at most 1 request per second, identify the app, cache results.
const geoCache = new Map();
let geoChain = Promise.resolve(), lastGeo = 0;
function nominatim(q) {
  const run = async () => {
    const wait = Math.max(0, lastGeo + 1100 - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastGeo = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ca&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { "User-Agent": "Fielora/1.0 (field service scheduling app)", "Accept-Language": "en-CA" } });
    if (!r.ok) throw new Error(`Address lookup failed (${r.status})`);
    return r.json();
  };
  const p = geoChain.then(run, run);
  geoChain = p.catch(() => {});
  return p;
}
app.get("/api/geocode", auth, workers, wrap(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 200);
  if (q.length < 3) return res.status(400).json({ error: "Enter an address to look up." });
  const key = q.toLowerCase();
  if (!geoCache.has(key)) {
    try {
      const rows = await nominatim(q);
      geoCache.set(key, rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lon), label: r.display_name })));
    } catch (e) { return res.status(502).json({ error: "The address lookup service didn’t respond. Try again, or drag the pin on the map." }); }
  }
  res.json({ results: geoCache.get(key) });
}));

/* ---------- maintenance form + report ---------- */
// Form answers come with the template snapshot they were filled in on.
function cleanForm(f, settings) {
  const d = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  let tpl = f?.snapshot;
  if (!tpl || !Array.isArray(tpl.sections)) tpl = settings.forms.templates.find(t => t.id === f?.templateId) || settings.forms.templates[0];
  const { snapshot, values, missing } = forms.cleanAnswers(f, tpl);
  return { form: { templateId: snapshot.id, snapshot, values, serviceDate: d(f?.serviceDate), nextService: d(f?.nextService), emailTo: String(f?.emailTo ?? "").slice(0, 300) }, missing };
}
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
function parseEmails(str) {
  const list = String(str || "").split(/[,;\s]+/).map(e => e.trim()).filter(Boolean);
  return { list, bad: list.filter(e => !EMAIL_RE.test(e)) };
}
async function loadJobAndCustomer(id) {
  const j = (await pool.query("SELECT data FROM jobs WHERE id = $1", [id])).rows[0];
  if (!j) return {};
  const c = j.data.customerId ? (await pool.query("SELECT data FROM customers WHERE id = $1", [j.data.customerId])).rows[0] : null;
  return { job: j.data, customer: c?.data || {} };
}
async function emailReport({ job, customer, form, settings, to }) {
  const assets = await reportAssets(settings), business = assets.business;
  const pdf = await buildReport({ job, customer, form, ...assets });
  const recs = forms.recommendations(form);
  const name = business.name || "Your service team";
  const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const dateText = new Date((form.serviceDate || job.date) + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const html = `<p>Hi ${esc((customer.name || "").split(" ")[0] || "there")},</p>
<p>Thanks for having us out on ${esc(dateText)}. Your service report is attached.</p>
${recs ? `<p><strong>Recommendations:</strong> ${esc(recs)}</p>` : ""}
${form.nextService ? `<p>Your next service is due around ${esc(new Date(form.nextService + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "long" }))}.</p>` : ""}
<p>${esc(form.technician || "")}<br>${esc(name)}${business.phone ? `<br>${esc(business.phone)}` : ""}</p>`;
  const file = `Service-report-${(customer.name || "customer").replace(/[^a-z0-9]+/gi, "-")}-${form.serviceDate || job.date}.pdf`;
  await mail.sendMail({ to, subject: `Your service report — ${dateText}`, html, attachments: [{ name: file, contentType: "application/pdf", content: pdf }] });
}

// Save a draft, or complete the form (marks the job done, rolls the maintenance date, optionally emails the PDF).
app.post("/api/jobs/:id/report", auth, workers, wrap(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: "Invalid id." });
  const { job, customer } = await loadJobAndCustomer(id);
  if (!job) return res.status(404).json({ error: "That job no longer exists." });
  if (job.type === "personal") return res.status(400).json({ error: "Personal time doesn’t have a service form." });
  if (job.formCompletedAt && req.user.role === "staff") return res.status(403).json({ error: "This form is finished. Only a manager or owner can change it.", code: "not_allowed" });
  const { form, missing } = cleanForm(req.body?.form, req.settings);
  const complete = !!req.body?.complete, send = !!req.body?.send;
  if (complete && missing.length) return res.status(400).json({ error: `Fill in the required field${missing.length > 1 ? "s" : ""}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}` });
  form.serviceDate = form.serviceDate || job.date;
  form.technician = req.user.name || req.user.username;
  let recipients = [];
  if (complete && send) {
    const { list, bad } = parseEmails(form.emailTo);
    if (!list.length) return res.status(400).json({ error: "Enter the customer’s email address to send the report." });
    if (bad.length) return res.status(400).json({ error: `Check this email address: ${bad[0]}` });
    recipients = list;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT data FROM jobs WHERE id = $1 FOR UPDATE", [id])).rows[0];
    const next = { ...row.data, form };
    if (complete) {
      next.status = "done";
      next.formCompletedAt = new Date().toISOString();
      if (job.type === "portable" && next.stage !== "returned") next.stage = next.stage || "shop";
    }
    await client.query("UPDATE jobs SET data = $1, updated_at = now() WHERE id = $2", [next, id]);
    if (complete && job.type === "pm" && job.customerId) {
      const c = (await client.query("SELECT data FROM customers WHERE id = $1 FOR UPDATE", [job.customerId])).rows[0];
      if (c && (!c.data.lastService || c.data.lastService < form.serviceDate)) {
        await client.query("UPDATE customers SET data = $1, updated_at = now() WHERE id = $2", [{ ...c.data, lastService: form.serviceDate }, job.customerId]);
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }

  let sent = false, sendError = null;
  if (complete && send) {
    try {
      await emailReport({ job, customer, form, settings: req.settings, to: recipients });
      sent = true;
      await pool.query("UPDATE jobs SET data = data || $1::jsonb, updated_at = now() WHERE id = $2", [JSON.stringify({ formSentAt: new Date().toISOString(), formSentTo: recipients.join(", ") }), id]);
    } catch (e) { sendError = e.code === "not_configured" ? "Outlook email isn’t set up yet, so the report wasn’t emailed." : e.message; console.error("Email failed:", e.message); }
  }
  res.json({ ok: true, completed: complete, sent, sendError });
}));

app.delete("/api/jobs/:id/report", auth, managers, wrap(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ error: "Invalid id." });
  const row = (await pool.query("SELECT data FROM jobs WHERE id = $1", [id])).rows[0];
  if (!row?.data.form) return res.status(404).json({ error: "This job doesn’t have a service form." });
  const next = { ...row.data }; for (const f of PROTECTED_JOB_FIELDS) delete next[f];
  if (next.status === "done") next.status = "booked";
  await pool.query("UPDATE jobs SET data = $1, updated_at = now() WHERE id = $2", [next, id]);
  res.json({ ok: true });
}));
app.post("/api/jobs/:id/report/send", auth, workers, wrap(async (req, res) => {
  const { id } = req.params;
  const { job, customer } = await loadJobAndCustomer(id);
  if (!job || !job.form) return res.status(404).json({ error: "This job doesn’t have a completed form yet." });
  const { list, bad } = parseEmails(req.body?.to);
  if (!list.length) return res.status(400).json({ error: "Enter an email address." });
  if (bad.length) return res.status(400).json({ error: `Check this email address: ${bad[0]}` });
  try {
    await emailReport({ job, customer, form: job.form, settings: req.settings, to: list });
  } catch (e) {
    return res.status(e.code === "not_configured" ? 400 : 502).json({ error: e.code === "not_configured" ? "Outlook email isn’t set up yet." : e.message });
  }
  await pool.query("UPDATE jobs SET data = data || $1::jsonb, updated_at = now() WHERE id = $2", [JSON.stringify({ formSentAt: new Date().toISOString(), formSentTo: list.join(", ") }), id]);
  res.json({ ok: true });
}));

app.get("/api/jobs/:id/report.pdf", auth, workers, wrap(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).send("Invalid id.");
  const { job, customer } = await loadJobAndCustomer(id);
  if (!job || !job.form) return res.status(404).send("This job doesn’t have a service form yet.");
  const pdf = await buildReport({ job, customer, form: job.form, ...(await reportAssets(req.settings)) });
  const file = `Service-report-${(customer.name || "customer").replace(/[^a-z0-9]+/gi, "-")}-${job.form.serviceDate || job.date}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${file}"`);
  res.send(pdf);
}));

/* ---------- "someone else has this open" locks ---------- */
const LOCK_STALE_SECONDS = 90;
const validTab = t => typeof t === "string" && /^[a-z0-9]{8,40}$/i.test(t);
function lockParams(req, res) {
  const { coll, id } = req.params;
  const tab = req.body?.tab || req.query.tab;
  if (!COLLECTIONS.has(coll) || !validId(id) || !validTab(tab)) { res.status(400).json({ error: "Invalid request." }); return null; }
  return { coll, id, tab };
}
async function otherEditors(coll, id, tab, me) {
  await pool.query(`DELETE FROM edit_locks WHERE heartbeat < now() - interval '${LOCK_STALE_SECONDS} seconds'`);
  const { rows } = await pool.query(
    `SELECT l.user_id, u.name, u.username, (extract(epoch from l.since) * 1000)::bigint AS since
       FROM edit_locks l JOIN users u ON u.id = l.user_id
      WHERE l.coll = $1 AND l.record_id = $2 AND l.tab <> $3 ORDER BY l.since`, [coll, id, tab]);
  return rows.map(r => ({ name: r.user_id === me ? "You" : (r.name || r.username), self: r.user_id === me, since: Number(r.since) }));
}
async function recordVersion(coll, id) {
  const { rows } = await pool.query(`SELECT (extract(epoch from updated_at) * 1000000)::bigint::text AS v FROM ${coll} WHERE id = $1`, [id]);
  return rows[0] ? rows[0].v : null;
}
app.post("/api/locks/:coll/:id", auth, wrap(async (req, res) => {
  const p = lockParams(req, res); if (!p) return;
  await pool.query(
    `INSERT INTO edit_locks (coll, record_id, tab, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (coll, record_id, tab) DO UPDATE SET heartbeat = now(), user_id = EXCLUDED.user_id`, [p.coll, p.id, p.tab, req.user.id]);
  const out = { others: await otherEditors(p.coll, p.id, p.tab, req.user.id) };
  if (req.body?.open) out.version = await recordVersion(p.coll, p.id);
  res.json(out);
}));
app.delete("/api/locks/:coll/:id", auth, wrap(async (req, res) => {
  const p = lockParams(req, res); if (!p) return;
  await pool.query("DELETE FROM edit_locks WHERE coll = $1 AND record_id = $2 AND tab = $3 AND user_id = $4", [p.coll, p.id, p.tab, req.user.id]);
  res.json({ ok: true });
}));
app.post("/api/locks/:coll/:id/release", express.text({ type: "*/*" }), auth, wrap(async (req, res) => {
  const p = lockParams(Object.assign(req, { body: { tab: req.query.tab } }), res); if (!p) return;
  await pool.query("DELETE FROM edit_locks WHERE coll = $1 AND record_id = $2 AND tab = $3 AND user_id = $4", [p.coll, p.id, p.tab, req.user.id]);
  res.status(204).end();
}));
app.post("/api/check-conflict", auth, wrap(async (req, res) => {
  const { coll, id, version } = req.body || {};
  if (!COLLECTIONS.has(coll) || !validId(id)) return res.status(400).json({ error: "Invalid request." });
  if (version === null || version === undefined) return res.json({ changed: false });
  const current = await recordVersion(coll, id);
  if (current === null) return res.json({ changed: true, deleted: true });
  res.json({ changed: current !== String(version), deleted: false });
}));

/* ---------- trade and job types (owner) ---------- */
app.put("/api/industry", auth, allow("owner"), wrap(async (req, res) => {
  const ind = industries.sanitize(req.body?.industry);
  await putSetting("industry", ind);
  let formsOut;
  if (req.body?.applyForms) { formsOut = forms.sanitize(industries.presetForms(ind.preset)); await putSetting("forms", formsOut); }
  res.json({ industry: ind, forms: formsOut || (await getSettings()).forms });
}));
app.get("/api/industry/preset/:id", auth, allow("owner"), (req, res) => {
  if (!industries.PRESETS[req.params.id]) return res.status(404).json({ error: "Unknown trade." });
  res.json({ industry: industries.fromPreset(req.params.id) });
});

/* ---------- service form builder + logo (owner) ---------- */
app.put("/api/forms", auth, managers, wrap(async (req, res) => {
  let cfg; try { cfg = forms.sanitize(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  await putSetting("forms", cfg); res.json({ forms: cfg });
}));
app.post("/api/forms/reset", auth, managers, wrap(async (req, res) => {
  await pool.query("DELETE FROM settings WHERE key = 'forms'"); res.json({ forms: forms.sanitize(industries.presetForms(req.settings.industry.preset)) });
}));
app.post("/api/forms/preview", auth, managers, wrap(async (req, res) => {
  let tpl; try { tpl = forms.sanitize({ templates: [req.body?.template], assign: {} }).templates[0]; } catch (e) { return res.status(400).json({ error: e.message }); }
  const sample = { text: "Sample answer", textarea: "Sample notes written on site. Everything checked and working normally.", number: "12.6", select: null, yesno: "Yes", date: new Date().toISOString().slice(0, 10) };
  const values = {}; let k = 0;
  for (const f of tpl.sections.flatMap(x => x.fields)) {
    if (f.type === "check") values[f.id] = { result: (k++ % 6 === 5) ? "Needs attention" : "OK", note: (k % 6 === 0) ? "Sample note" : "" };
    else values[f.id] = f.type === "select" ? f.options[0] : sample[f.type];
  }
  const today = new Date().toISOString().slice(0, 10);
  const pdf = await buildReport({ job: { type: "pm", date: today }, form: { snapshot: tpl, values, serviceDate: today, nextService: "", technician: req.user.name || req.user.username },
    customer: { name: "Sample Customer", address: "123 Example Rd", town: "Springfield", phone: "555-0100", brand: req.settings.industry.brands[0] || "Sample brand", model: "Model 100", serial: "SAMPLE-0001", equipmentType: req.settings.industry.equipmentTypes[0] || "", kw: 22, fuel: req.settings.industry.fuels[0] || "" },
    ...(await reportAssets({ ...req.settings, forms: { ...req.settings.forms, footer: req.body?.footer ?? req.settings.forms.footer } })) });
  res.setHeader("Content-Type", "application/pdf"); res.send(pdf);
}));
app.get("/api/branding/logo", auth, wrap(async (req, res) => {
  const logo = await getLogo(); if (!logo) return res.status(404).end();
  res.setHeader("Content-Type", logo.mime); res.setHeader("Cache-Control", "private, max-age=300"); res.send(logo.buffer);
}));
app.post("/api/branding/logo", auth, managers, wrap(async (req, res) => {
  const m = String(req.body?.data || "").match(/^data:(image\/(png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "Use a PNG or JPG image for the logo." });
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: "That logo is too large. Use an image under 1.5 MB." });
  await putSetting("logo", { mime: m[1], data: m[3], v: Date.now() }); res.json({ ok: true });
}));
app.delete("/api/branding/logo", auth, managers, wrap(async (req, res) => {
  await pool.query("DELETE FROM settings WHERE key = 'logo'"); res.json({ ok: true });
}));

/* ---------- exports (owner and staff) ---------- */
function typeLabels(settings) {
  const jt = settings.industry.jobTypes;
  return { pm: jt.pm.label, repair: jt.repair.label, install: jt.install.label, assess: jt.assess.label, portable: jt.shop.label, personal: "Personal time" };
}
const PLAN_LABEL = { "12": "Yearly", "6": "Every 6 months", "3": "Every 3 months", none: "No plan" };
const stamp = () => new Date().toISOString().slice(0, 10);
function addMonthsIso(iso, m) {
  if (!iso) return ""; const [y, mo, d] = iso.split("-").map(Number); const dt = new Date(y, mo - 1, 1); dt.setMonth(dt.getMonth() + m);
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); dt.setDate(Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function styleSheet(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D2125" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns.forEach(c => { let w = (c.header || "").length; c.eachCell({ includeEmpty: false }, cell => { w = Math.max(w, Math.min(60, String(cell.value ?? "").length)); }); c.width = Math.max(10, w + 2); });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}
app.get("/api/export/workbook.xlsx", auth, managers, wrap(async (req, res) => {
  const [cr, jr] = await Promise.all([pool.query("SELECT id, data FROM customers"), pool.query("SELECT id, data FROM jobs")]);
  const customers = Object.fromEntries(cr.rows.map(r => [r.id, r.data]));
  const wb = new ExcelJS.Workbook(); wb.creator = "Fielora"; const TYPE_LABEL = typeLabels(req.settings), IND = req.settings.industry; wb.created = new Date();
  // Customers (with every extra detail as its own column)
  const extraKeys = [...new Set(cr.rows.flatMap(r => Object.keys(r.data.extra || {})))];
  const ws1 = wb.addWorksheet("Customers");
  ws1.columns = ["Customer ID", "Name", "Phone", "Email", "Street address", "Town", "Postal code", `${IND.equipment} type`, `${IND.equipment} brand`, "Model", "Serial number", IND.sizeUnit ? `Size (${IND.sizeUnit})` : "Size", "Fuel / energy", "Maintenance plan", "Last serviced", "Next service due", "Latitude", "Longitude", "Notes", ...extraKeys, ...req.settings.custom.customerFields.map(f => f.label)].map((h, i) => ({ header: h, key: `c${i}` }));
  for (const r of cr.rows.sort((a, b) => a.data.name.localeCompare(b.data.name))) {
    const c = r.data;
    ws1.addRow([r.id, c.name, c.phone, c.email, c.address, c.town, c.postal, c.equipmentType, c.brand, c.model, c.serial, c.kw, c.fuel, PLAN_LABEL[c.plan || "none"], c.lastService, c.plan && c.plan !== "none" ? addMonthsIso(c.lastService, Number(c.plan)) : "", c.lat, c.lng, c.notes, ...extraKeys.map(k => c.extra?.[k] ?? ""), ...req.settings.custom.customerFields.map(f => custom.display(f, c.custom?.[f.id]))]);
  }
  styleSheet(ws1);
  // Jobs and appointments
  const ws2 = wb.addWorksheet("Jobs and appointments");
  ws2.columns = ["Job ID", "Date", "Start", "Hours", "Type", "Customer / title", "Town", "Status", "Priority", "Portable status", "Job notes", "Internal notes", "Service form", "Report emailed to", "Emailed on", ...req.settings.custom.jobFields.map(f => f.label)].map((h, i) => ({ header: h, key: `j${i}` }));
  for (const r of jr.rows.sort((a, b) => (a.data.date + (a.data.time || "")).localeCompare(b.data.date + (b.data.time || "")))) {
    const j = r.data, c = customers[j.customerId] || {};
    ws2.addRow([r.id, j.date, j.time || "All day", j.duration || "", TYPE_LABEL[j.type] || j.type, j.type === "personal" ? j.title : (c.name || "Unknown customer"), c.town || "",
      ({ booked: "Booked", parts: "Waiting on parts", done: "Done", cancelled: "Cancelled" })[j.status] || j.status, j.priority === "outage" ? "Power outage" : "Normal",
      j.type === "portable" ? (j.stage || "") : "", j.notes || "", j.report || "", j.formCompletedAt ? "Finished" : (j.form ? "Draft" : ""), j.formSentTo || "", (j.formSentAt || "").slice(0, 10), ...req.settings.custom.jobFields.map(f => custom.display(f, j.custom?.[f.id]))]);
  }
  styleSheet(ws2);
  // One sheet per service form design, one row per filled-in form
  const byTpl = new Map();
  for (const r of jr.rows) {
    if (!r.data.form) continue;
    const f = forms.upgradeLegacy(r.data.form); if (!f?.snapshot) continue;
    const key = f.snapshot.name || f.snapshot.title || "Service form";
    if (!byTpl.has(key)) byTpl.set(key, { fields: new Map(), rows: [] });
    const g = byTpl.get(key);
    for (const fl of f.snapshot.sections.flatMap(x => x.fields)) if (!g.fields.has(fl.id)) g.fields.set(fl.id, fl);
    g.rows.push({ id: r.id, job: r.data, f });
  }
  const used = new Set();
  for (const [name, g] of byTpl) {
    let sheet = `Form - ${name}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31); while (used.has(sheet)) sheet = sheet.slice(0, 29) + "_" + used.size; used.add(sheet);
    const ws = wb.addWorksheet(sheet); const fl = [...g.fields.values()];
    ws.columns = ["Job ID", "Service date", "Customer", "Town", "Technician", "Status", "Next service", "Emailed to", ...fl.map(x => x.label)].map((h, i) => ({ header: h, key: `c${i}` }));
    for (const { id, job, f } of g.rows.sort((a, b) => String(a.f.serviceDate || a.job.date).localeCompare(String(b.f.serviceDate || b.job.date)))) {
      const c = customers[job.customerId] || {};
      ws.addRow([id, f.serviceDate || job.date, c.name || "", c.town || "", f.technician || "", job.formCompletedAt ? "Finished" : "Draft", f.nextService || "", job.formSentTo || "", ...fl.map(x => forms.display(x, f.values?.[x.id]))]);
    }
    styleSheet(ws);
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="fielora-export-${stamp()}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));
app.get("/api/export/reports.zip", auth, managers, wrap(async (req, res) => {
  const [cr, jr] = await Promise.all([pool.query("SELECT id, data FROM customers"), pool.query("SELECT id, data FROM jobs WHERE data ? 'form'")]);
  const customers = Object.fromEntries(cr.rows.map(r => [r.id, r.data]));
  if (!jr.rows.length) return res.status(404).json({ error: "There are no service forms to export yet." });
  const assets = await reportAssets(req.settings); const TYPE_LABEL = typeLabels(req.settings);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="fielora-service-reports-${stamp()}.zip"`);
  const zip = archiver("zip", { zlib: { level: 6 } });
  zip.on("error", e => { console.error(e); res.destroy(e); });
  zip.pipe(res);
  const safe = t => String(t || "Unknown").replace(/[^a-z0-9 ._-]+/gi, "").trim().slice(0, 60) || "Unknown";
  const names = new Set();
  for (const r of jr.rows) {
    const c = customers[r.data.customerId] || {};
    const pdf = await buildReport({ job: r.data, customer: c, form: r.data.form, ...assets });
    let file = `${safe(c.name)}/${safe(r.data.form.serviceDate || r.data.date)} ${safe(TYPE_LABEL[r.data.type])}${r.data.formCompletedAt ? "" : " (draft)"}.pdf`;
    while (names.has(file)) file = file.replace(/\.pdf$/, " (2).pdf"); names.add(file);
    zip.append(pdf, { name: file });
  }
  await zip.finalize();
}));

/* ---------- import (SharePoint list, Excel or CSV) ---------- */
const imports = new Map(); // importId -> { userId, columns, records, label, sheets, sheet, created }
setInterval(() => { const cut = Date.now() - 60 * 60 * 1000; for (const [k, v] of imports) if (v.created < cut) imports.delete(k); }, 10 * 60 * 1000).unref();
function sampleOf(records) {
  return records.slice(0, 6).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")])));
}
function storeImport(req, res, data) {
  if (!data.records.length) return res.status(400).json({ error: "No rows found under the column headings." });
  if (data.records.length > 10000) return res.status(400).json({ error: "That’s more than 10,000 rows. Split it into smaller files." });
  const id = crypto.randomBytes(12).toString("hex");
  imports.set(id, { ...data, userId: req.user.id, created: Date.now() });
  res.json({ importId: id, label: data.label, columns: data.columns, sample: sampleOf(data.records), rowCount: data.records.length,
    mapping: importer.guessMapping(data.columns), fields: importer.FIELDS, sheets: data.sheets || null, sheet: data.sheet || null });
}
async function parseBuffer(name, buffer, sheet) {
  const ext = (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  if (["xlsx", "xlsm"].includes(ext)) {
    const x = await importer.parseXlsx(buffer, sheet);
    return { ...importer.toRecords(x.rows), sheets: x.sheets, sheet: x.sheet };
  }
  if (["csv", "txt"].includes(ext)) return importer.toRecords(importer.parseCsv(buffer.toString("utf8")));
  if (ext === "xls") throw new Error("Old .xls files can’t be read. Open it in Excel and save as .xlsx, or export as CSV.");
  throw new Error("Use a CSV or Excel (.xlsx) file.");
}
app.post("/api/import/file", auth, managers, wrap(async (req, res) => {
  if (!req.settings.custom.features.import) return res.status(403).json({ error: "Importing is turned off for this app." });
  const { filename, data, sheet } = req.body || {};
  if (!filename || !data) return res.status(400).json({ error: "Choose a file to import." });
  try {
    const parsed = await parseBuffer(filename, Buffer.from(String(data), "base64"), sheet);
    storeImport(req, res, { ...parsed, label: filename });
  } catch (e) { res.status(400).json({ error: e.message || "Couldn’t read that file." }); }
}));
app.post("/api/import/sharepoint", auth, managers, wrap(async (req, res) => {
  if (!req.settings.custom.features.import) return res.status(403).json({ error: "Importing is turned off for this app." });
  if (!graph.configured()) return res.status(400).json({ error: "Microsoft 365 isn’t connected yet. Export the list to CSV or Excel and upload it instead, or follow “Connect SharePoint” in the README." });
  const url = String(req.body?.url || "").trim();
  let u; try { u = new URL(url); } catch { return res.status(400).json({ error: "Paste the full SharePoint link, starting with https://" }); }
  if (!/\.sharepoint\.com$/i.test(u.hostname) && !/1drv\.ms$|onedrive\.live\.com$/i.test(u.hostname)) return res.status(400).json({ error: "That isn’t a SharePoint link. It should contain “sharepoint.com”." });
  try {
    const list = await graph.readList(url);
    if (list) return storeImport(req, res, list);
    const f = await graph.readFileFromLink(url);
    const parsed = await parseBuffer(f.name, f.buffer, req.body?.sheet);
    storeImport(req, res, { ...parsed, label: `SharePoint file “${f.name}”` });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

function validMapping(imp, mapping) {
  if (!mapping || typeof mapping !== "object") return null;
  const out = {};
  for (const c of imp.columns) out[c] = importer.FIELDS[mapping[c]] ? mapping[c] : "extra";
  return out;
}
async function planImport(imp, mapping, mode) {
  const warn = { ambiguous: 0, badDates: 0, assumedYearly: 0 };
  const existing = (await pool.query("SELECT id, data FROM customers")).rows;
  const byKey = new Map(existing.map(r => [importer.dedupeKey(r.data), r]));
  const seen = new Map(); const rows = []; let noName = 0, inFileDupes = 0;
  for (const rec of imp.records) {
    const c = importer.convert(rec, mapping, warn);
    if (!c.name) { noName++; continue; }
    const key = importer.dedupeKey(c);
    if (seen.has(key)) { inFileDupes++; const prev = rows[seen.get(key)]; prev.c = { ...prev.c, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "" && v !== undefined)), extra: { ...(prev.c.extra || {}), ...(c.extra || {}) } }; continue; }
    const match = mode === "new" ? null : byKey.get(key);
    seen.set(key, rows.length); rows.push({ c, match });
  }
  const counts = { create: rows.filter(r => !r.match).length, update: mode === "update" ? rows.filter(r => r.match).length : 0, skip: mode === "skip" ? rows.filter(r => r.match).length : 0, noName, inFileDupes };
  return { rows, counts, warn };
}
app.post("/api/import/preview", auth, managers, wrap(async (req, res) => {
  if (!req.settings.custom.features.import) return res.status(403).json({ error: "Importing is turned off for this app." });
  const imp = imports.get(req.body?.importId);
  if (!imp || imp.userId !== req.user.id) return res.status(410).json({ error: "This import has expired. Start again." });
  const mapping = validMapping(imp, req.body.mapping);
  if (!Object.values(mapping).some(f => ["name", "firstName", "lastName", "contact"].includes(f))) return res.status(400).json({ error: "Choose which column has the customer’s name." });
  const mode = ["update", "skip", "new"].includes(req.body.mode) ? req.body.mode : "update";
  const { rows, counts, warn } = await planImport(imp, mapping, mode);
  res.json({ counts, warn, preview: rows.slice(0, 8).map(r => ({ ...r.c, _match: r.match ? (mode === "update" ? "update" : "skip") : "new" })) });
}));
const newId = () => Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
app.post("/api/import/commit", auth, managers, wrap(async (req, res) => {
  if (!req.settings.custom.features.import) return res.status(403).json({ error: "Importing is turned off for this app." });
  const imp = imports.get(req.body?.importId);
  if (!imp || imp.userId !== req.user.id) return res.status(410).json({ error: "This import has expired. Start again." });
  const mapping = validMapping(imp, req.body.mapping);
  const mode = ["update", "skip", "new"].includes(req.body.mode) ? req.body.mode : "update";
  const addHistory = !!req.body.addHistory;
  const { rows } = await planImport(imp, mapping, mode);
  const result = { created: 0, updated: 0, skipped: 0, history: 0, needLocation: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pmDates = new Set((await client.query("SELECT data->>'customerId' AS c, data->>'date' AS d FROM jobs WHERE data->>'type' = 'pm'")).rows.map(r => `${r.c}|${r.d}`));
    for (const { c, match } of rows) {
      let id, data;
      if (match && mode === "skip") { result.skipped++; continue; }
      if (match && mode === "update") {
        const old = match.data; id = match.id;
        data = { ...old, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== "extra" && v !== "" && v !== undefined)), extra: { ...(old.extra || {}), ...(c.extra || {}) } };
        if ((c.address && c.address !== old.address) || (c.town && c.town !== old.town)) { delete data.lat; delete data.lng; }
        if (old.plan && old.plan !== "none" && c.plan === "none") data.plan = old.plan;
        result.updated++;
      } else { id = newId(); data = { ...c, createdAt: Date.now() }; result.created++; }
      await client.query(`INSERT INTO customers (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [id, data]);
      if (!(isFinite(data.lat) && isFinite(data.lng) && data.lat !== "" && data.lng !== "") && (data.address || data.town)) result.needLocation.push(id);
      if (addHistory && data.lastService && !pmDates.has(`${id}|${data.lastService}`)) {
        await client.query("INSERT INTO jobs (id, data) VALUES ($1, $2)", [newId(), { customerId: id, type: "pm", date: data.lastService, time: "", duration: 0, priority: "normal", status: "done", stage: null, notes: "Imported from SharePoint — last service on record", report: "", createdAt: Date.now() }]);
        pmDates.add(`${id}|${data.lastService}`); result.history++;
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
  imports.delete(req.body.importId);
  res.json(result);
}));

/* ---------- support chat (AI assistant first, a person can step in from Fielora Admin) ---------- */
const AI_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const SUPPORT_NAME = process.env.SUPPORT_NAME || "Fielora Support";
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "";
const AI_PER_HOUR = 40;
const HELP_GUIDE = require("fs").readFileSync(require("path").join(__dirname, "lib", "help-guide.md"), "utf8");
const aiAvailable = () => !!AI_KEY;
const peopleAvailable = () => adminEnabled();
const chatEnabled = () => aiAvailable() || peopleAvailable();
const aiCalls = new Map();   // userId -> timestamps of recent AI replies
async function openThreadFor(userId) {
  return (await pool.query("SELECT * FROM support_threads WHERE user_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1", [userId])).rows[0] || null;
}
async function threadMessages(id) {
  return (await pool.query("SELECT id, sender, name, body, at FROM support_messages WHERE thread_id = $1 ORDER BY id", [id])).rows;
}
async function addMessage(threadId, sender, name, body) {
  const m = (await pool.query("INSERT INTO support_messages (thread_id, sender, name, body) VALUES ($1, $2, $3, $4) RETURNING id, sender, name, body, at", [threadId, sender, name, body])).rows[0];
  if (sender !== "system") await pool.query("UPDATE support_threads SET last_sender = $1, updated_at = now() WHERE id = $2", [sender, threadId]);
  return m;
}
function chatState(t) {
  return { aiAvailable: aiAvailable(), peopleAvailable: peopleAvailable(), supportName: SUPPORT_NAME, supportContact: SUPPORT_CONTACT, mode: t?.mode || (aiAvailable() ? "ai" : "human"), status: t?.status || "none" };
}
function customForAI(c) {
  if (!c) return "";
  const lines = [];
  const off = Object.entries(custom.FEATURES).filter(([k]) => c.features[k] === false).map(([, v]) => v);
  if (off.length) lines.push(`These parts of Fielora are turned off for this business, so never suggest them: ${off.join(", ")}.`);
  const words = Object.entries(c.labels || {}).map(([k, v]) => `"${custom.LABELS[k]}" is called "${v}"`);
  if (words.length) lines.push(`This business uses its own words; use them in answers: ${words.join("; ")}.`);
  if (c.customerFields.length) lines.push(`Extra fields on each customer: ${c.customerFields.map(f => f.label).join(", ")}.`);
  if (c.jobFields.length) lines.push(`Extra fields on each job (in the job window, under "More details"): ${c.jobFields.map(f => f.label).join(", ")}.`);
  if (c.assistantNotes) lines.push(`Notes from the support team about this business:\n${c.assistantNotes}`);
  return lines.length ? "About this business's setup:\n" + lines.join("\n") + "\n" : "";
}
function systemPrompt(user, settings) {
  const ind = settings.industry || {};
  const types = Object.entries(ind.jobTypes || {}).filter(([, v]) => v && v.on !== false).map(([, v]) => v.label).filter(Boolean);
  const trade = industries.presetList().find(x => x.id === ind.preset)?.name || ind.preset || "field service";
  return `You are the help assistant inside Fielora, a scheduling and service-report app. You are chatting with ${user.name || user.username} (access level: ${({ owner: "Owner", manager: "Manager", staff: "Staff" })[user.role] || "Staff"}) at ${settings.business.name || "a field service business"}, which uses Fielora for ${trade}.
${types.length ? `Their job types are called: ${types.join(", ")}.` : ""} ${ind.equipment ? `They call what they service "${ind.equipment}".` : ""}
Outlook email is ${mail.configured() ? "connected" : "not connected"} for this business. Two-step login is ${settings.require2fa ? "required for everyone" : "optional"}. Today is ${new Date().toISOString().slice(0, 10)}.

${customForAI(settings.custom)}
How to answer:
- Answer only questions about using Fielora, using ONLY the guide below. Never invent buttons, menus or features. If the guide doesn't cover it, say you're not sure and offer to pass the question to a person.
- Be short and practical: a sentence or two, or a few numbered steps with the exact button names in bold. Plain language, Canadian spelling, no jargon.
- Respect their access level (see the guide's Access levels section). If the task needs a Manager or Owner, say so and tell them who to ask.
- You can't see or change their data or account, and you can't take actions for them. Don't pretend to.
- Never ask for or repeat passwords, codes or recovery codes. If someone shares one, tell them not to and to change it.
- Hand the chat to a person when: they ask for a person; they need something done to an account or their data (password or two-step reset they can't do themselves, lost data, restoring a backup); it's an error, bug or something not working as the guide says; it's about billing, their contract, connecting Outlook/SharePoint or the web address; or they're frustrated or the question is outside the guide. To hand over, start your reply with [[HANDOFF]] and then write one short, friendly sentence saying you're passing this to the support team.
- Politely decline anything unrelated to Fielora.

<guide>
${HELP_GUIDE}
</guide>`;
}
async function askAI(thread, user, settings) {
  const history = (await threadMessages(thread.id)).filter(m => m.sender !== "system").slice(-24);
  const msgs = [];
  for (const m of history) {
    const role = m.sender === "user" ? "user" : "assistant";
    const text = m.sender === "admin" ? `(${m.name} from the support team wrote:) ${m.body}` : m.body;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n\n" + text; else msgs.push({ role, content: text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 900, system: [{ type: "text", text: systemPrompt(user, settings), cache_control: { type: "ephemeral" } }], messages: msgs }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `AI service error ${r.status}`);
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}
async function handToPeople(thread, reasonText) {
  await pool.query("UPDATE support_threads SET mode = 'human', updated_at = now() WHERE id = $1", [thread.id]);
  thread.mode = "human";
  const text = peopleAvailable()
    ? (reasonText || `This chat has been passed to the ${SUPPORT_NAME} team. Someone will reply here, usually during business hours. You can close this window; we’ll show a dot on Help when they answer.`)
    : `A person from support isn’t available in this chat. ${SUPPORT_CONTACT ? `Contact ${SUPPORT_CONTACT}.` : "Contact your IT provider, or ask an Owner in your business."}`;
  return addMessage(thread.id, "system", "", text);
}
const chatOut = async (t, extra = {}) => ({ thread: t ? { id: t.id, status: t.status, mode: t.mode } : null, messages: t ? await threadMessages(t.id) : [], ...chatState(t), ...extra });
app.get("/api/support/chat", auth, wrap(async (req, res) => {
  const t = await openThreadFor(req.user.id);
  if (t) await pool.query("UPDATE support_threads SET user_read_at = now() WHERE id = $1", [t.id]);
  res.json({ enabled: chatEnabled(), ...(await chatOut(t)) });
}));
app.post("/api/support/chat/messages", auth, wrap(async (req, res) => {
  if (!chatEnabled() || !req.settings.custom.features.help) return res.status(400).json({ error: "Help chat isn’t turned on for this app." });
  const body = String(req.body?.body || "").trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: "Type a message first." });
  let t = await openThreadFor(req.user.id);
  if (!t) t = (await pool.query("INSERT INTO support_threads (user_id, mode) VALUES ($1, $2) RETURNING *", [req.user.id, aiAvailable() ? "ai" : "human"])).rows[0];
  const isNew = (await pool.query("SELECT count(*)::int AS n FROM support_messages WHERE thread_id = $1", [t.id])).rows[0].n === 0;
  await addMessage(t.id, "user", req.user.name || req.user.username, body);
  if (t.mode === "ai" && aiAvailable()) {
    const now = Date.now(), recent = (aiCalls.get(req.user.id) || []).filter(x => now - x < 3600e3);
    if (recent.length >= AI_PER_HOUR) await handToPeople(t, `That’s a lot of questions in an hour, so I’ve passed this chat to the ${SUPPORT_NAME} team. Someone will reply here.`);
    else {
      recent.push(now); aiCalls.set(req.user.id, recent);
      try {
        let answer = await askAI(t, req.user, req.settings);
        if (answer && answer.includes("[[HANDOFF]]")) {
          answer = answer.replace("[[HANDOFF]]", "").trim();
          if (answer) await addMessage(t.id, "ai", "Fielora assistant", answer);
          await handToPeople(t);
        } else if (answer) await addMessage(t.id, "ai", "Fielora assistant", answer);
      } catch (e) {
        console.error("AI support reply failed:", e.message);
        await handToPeople(t, peopleAvailable() ? `The assistant couldn’t answer just now, so I’ve passed this to the ${SUPPORT_NAME} team. Someone will reply here.` : undefined);
      }
    }
  } else if (isNew && t.mode === "human" && peopleAvailable()) {
    await addMessage(t.id, "system", "", `Thanks. The ${SUPPORT_NAME} team will reply here, usually during business hours.`);
  }
  t = (await pool.query("SELECT * FROM support_threads WHERE id = $1", [t.id])).rows[0];
  await pool.query("UPDATE support_threads SET user_read_at = now() WHERE id = $1", [t.id]);
  res.json(await chatOut(t));
}));
app.post("/api/support/chat/human", auth, wrap(async (req, res) => {
  let t = await openThreadFor(req.user.id);
  if (!t) t = (await pool.query("INSERT INTO support_threads (user_id, mode) VALUES ($1, 'ai') RETURNING *", [req.user.id])).rows[0];
  if (t.mode !== "human") await handToPeople(t);   // always confirms with a message, even on a brand-new chat
  res.json(await chatOut(t));
}));
app.post("/api/support/chat/close", auth, wrap(async (req, res) => {
  const t = await openThreadFor(req.user.id);
  if (t) { await addMessage(t.id, "system", "", `${req.user.name || req.user.username} closed the chat.`); await pool.query("UPDATE support_threads SET status = 'closed', updated_at = now() WHERE id = $1", [t.id]); }
  res.json(await chatOut(null));
}));
async function supportUnread(userId) {
  return (await pool.query(`SELECT count(*)::int AS n FROM support_messages m JOIN support_threads t ON t.id = m.thread_id
    WHERE t.user_id = $1 AND t.status = 'open' AND m.sender IN ('admin','system') AND m.at > t.user_read_at`, [userId])).rows[0].n;
}

/* ---------- admin API (for the Fielora Admin dashboard) ---------- */
// Off unless ADMIN_API_KEY is set on this app. The dashboard sends it as a Bearer token.
// Every action is written to admin_log, which the business owner can read under Account → Support access.
const APP_VERSION = require("./package.json").version;
const ADMIN_KEY = process.env.ADMIN_API_KEY || "";
const adminEnabled = () => ADMIN_KEY.length >= 32;
const adminAuth = (req, res, next) => {
  if (!adminEnabled()) return res.status(404).json({ error: "Admin access is turned off for this app." });
  const key = `admin|${req.ip}`;
  if (throttled(key)) return res.status(429).json({ error: "Too many wrong keys. Wait 15 minutes." });
  const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(ADMIN_KEY).digest();
  if (!got || !crypto.timingSafeEqual(a, b)) { recordFailure(key, 10); return res.status(401).json({ error: "Wrong admin key." }); }
  attempts.delete(key);
  req.adminName = String(req.get("x-admin-name") || "Support").slice(0, 60);
  next();
};
const adminLog = (req, action, detail = "") => pool.query("INSERT INTO admin_log (admin, action, detail) VALUES ($1, $2, $3)", [req.adminName, action, String(detail).slice(0, 300)]);
const A = express.Router();
A.use(adminAuth);
A.get("/status", wrap(async (req, res) => {
  const st = await getSettings();
  const q = async sql => (await pool.query(sql)).rows[0];
  const [users, customers, jobs, recent, act, db] = await Promise.all([
    q("SELECT count(*)::int AS n, count(*) FILTER (WHERE role = 'owner')::int AS owners, count(*) FILTER (WHERE role = 'manager')::int AS managers, (SELECT count(*)::int FROM password_requests WHERE status = 'open') AS pwreq, count(*) FILTER (WHERE totp_enabled)::int AS tfa, count(*) FILTER (WHERE email <> '')::int AS emails FROM users"),
    q("SELECT count(*)::int AS n, count(*) FILTER (WHERE data->>'plan' IS NOT NULL AND data->>'plan' <> '')::int AS onplan FROM customers"),
    q("SELECT count(*)::int AS n FROM jobs"),
    q(`SELECT count(*) FILTER (WHERE updated_at > now() - interval '30 days')::int AS jobs30,
              count(*) FILTER (WHERE data->'form' IS NOT NULL AND data->>'status' = 'done' AND updated_at > now() - interval '30 days')::int AS reports30 FROM jobs`),
    q("SELECT greatest((SELECT max(updated_at) FROM jobs), (SELECT max(updated_at) FROM customers), (SELECT max(last_login_at) FROM users)) AS last"),
    q("SELECT pg_database_size(current_database())::bigint AS bytes"),
  ]);
  const chats = (await pool.query("SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'open' AND mode = 'human' AND last_sender <> 'admin')::int AS waiting FROM support_threads")).rows[0];
  res.json({
    version: APP_VERSION, node: process.version, uptimeSec: Math.round(process.uptime()),
    business: st.business, trade: industries.presetList().find(x => x.id === st.industry?.preset)?.name || st.industry?.preset, require2fa: !!st.require2fa,
    outlook: mail.configured(), sharepoint: graph.configured(), notice: st.notice?.text ? st.notice : null,
    counts: { users: users.n, owners: users.owners, managers: users.managers, passwordRequests: users.pwreq, twoStep: users.tfa, withEmail: users.emails, customers: customers.n, onPlan: customers.onplan, jobs: jobs.n, jobs30: recent.jobs30, reports30: recent.reports30 },
    lastActivity: act.last, dbBytes: Number(db.bytes),
    chat: { ai: aiAvailable(), openChats: chats.open, waiting: chats.waiting },
    custom: { plugin: pluginInfo(), hidden: Object.keys(st.custom.features).filter(k => !st.custom.features[k]), labels: Object.keys(st.custom.labels).length,
      fields: st.custom.customerFields.length + st.custom.jobFields.length, css: !!st.custom.css },
  });
}));
A.get("/users", wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT id, username, name, email, role, totp_enabled, must_change_password, last_login_at, created_at FROM users ORDER BY username");
  res.json({ users: rows.map(u => ({ ...publicUser(u), lastLogin: u.last_login_at, created: u.created_at })), requests: await openPasswordRequests(null) });
}));
A.post("/users", wrap(async (req, res) => {
  const { username, password, name, role } = req.body || {};
  const err = validateNewUser(username, password); if (err) return res.status(400).json({ error: err });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Choose Owner, Manager or Staff." });
  const em = cleanEmail(req.body?.email); if (em.error) return res.status(400).json({ error: em.error });
  try {
    const { rows } = await pool.query(`INSERT INTO users (username, name, email, pass_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5, true) RETURNING ${USER_COLS}`,
      [username.trim().toLowerCase(), String(name || "").trim(), em.email, hashPassword(password), role]);
    await adminLog(req, "Added a person", `${rows[0].username} (${role})`);
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { if (e.code === "23505") return res.status(409).json({ error: "That username is taken." }); throw e; }
}));
async function adminUser(req, res) {
  const u = (await pool.query("SELECT id, username, email, role FROM users WHERE id = $1", [Number(req.params.id)])).rows[0];
  if (!u) res.status(404).json({ error: "That person no longer exists." });
  return u;
}
A.post("/users/:id/reset-password", wrap(async (req, res) => {
  const u = await adminUser(req, res); if (!u) return;
  if (String(req.body?.password || "").length < 10) return res.status(400).json({ error: "Passwords need at least 10 characters." });
  await pool.query("UPDATE users SET pass_hash = $1, must_change_password = true, session_version = session_version + 1 WHERE id = $2", [hashPassword(req.body.password), u.id]);
  await closeRequests(u.id, req.adminName);
  await adminLog(req, "Set a temporary password", u.username); res.json({ ok: true });
}));
A.post("/users/:id/reset-2fa", wrap(async (req, res) => {
  const u = await adminUser(req, res); if (!u) return;
  await pool.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_pending = NULL, recovery_codes = '[]', session_version = session_version + 1 WHERE id = $1", [u.id]);
  await adminLog(req, "Reset two-step login", u.username); res.json({ ok: true });
}));
A.get("/password-requests", wrap(async (req, res) => res.json({ requests: await openPasswordRequests(null) })));
A.post("/password-requests/:id/dismiss", wrap(async (req, res) => {
  const r = (await pool.query("UPDATE password_requests SET status = 'dismissed', handled_by = $1, handled_at = now() WHERE id = $2 AND status = 'open' RETURNING user_id", [req.adminName, Number(req.params.id)])).rows[0];
  if (!r) return res.status(404).json({ error: "That request was already handled." });
  await adminLog(req, "Dismissed a password request"); res.json({ ok: true });
}));
A.patch("/users/:id", wrap(async (req, res) => {
  const u = await adminUser(req, res); if (!u) return;
  const { role } = req.body || {};
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });
    if (u.role === "owner" && role !== "owner" && await ownerCount() <= 1) return res.status(400).json({ error: "There has to be at least one owner." });
    await pool.query("UPDATE users SET role = $1, session_version = session_version + (CASE WHEN role <> $1 THEN 1 ELSE 0 END) WHERE id = $2", [role, u.id]);
    await adminLog(req, "Changed access", `${u.username} → ${role}`);
  }
  if (req.body?.email !== undefined) {
    const em = cleanEmail(req.body.email); if (em.error) return res.status(400).json({ error: em.error });
    await pool.query("UPDATE users SET email = $1 WHERE id = $2", [em.email, u.id]);
    await adminLog(req, "Changed an email address", u.username);
  }
  res.json({ ok: true });
}));
A.get("/backup", wrap(async (req, res) => {
  const data = await buildBackup(); await adminLog(req, "Downloaded a backup");
  res.json(data);
}));
A.put("/notice", wrap(async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 300);
  const level = ["info", "warning"].includes(req.body?.level) ? req.body.level : "info";
  await putSetting("notice", text ? { text, level, at: new Date().toISOString() } : {});
  await adminLog(req, text ? "Posted a notice" : "Removed the notice", text); res.json({ ok: true });
}));
const THREAD_SQL = `SELECT t.*, u.username, u.name AS user_name, u.role,
    (SELECT body FROM support_messages WHERE thread_id = t.id AND sender <> 'system' ORDER BY id DESC LIMIT 1) AS last_body,
    (SELECT count(*)::int FROM support_messages WHERE thread_id = t.id AND sender = 'user' AND at > t.admin_read_at) AS unread
  FROM support_threads t JOIN users u ON u.id = t.user_id`;
const threadOut = t => ({ id: t.id, status: t.status, mode: t.mode, lastSender: t.last_sender, updatedAt: t.updated_at, createdAt: t.created_at,
  user: { username: t.username, name: t.user_name, role: t.role }, preview: (t.last_body || "").slice(0, 140), unread: t.unread,
  waiting: t.status === "open" && t.mode === "human" && t.last_sender !== "admin" });
A.get("/chats", wrap(async (req, res) => {
  const { rows } = await pool.query(`${THREAD_SQL} WHERE t.status = 'open' OR t.updated_at > now() - interval '14 days' ORDER BY t.updated_at DESC LIMIT 100`);
  res.json({ chats: rows.map(threadOut), aiAvailable: aiAvailable() });
}));
A.get("/chats/:id", wrap(async (req, res) => {
  const t = (await pool.query(`${THREAD_SQL} WHERE t.id = $1`, [Number(req.params.id)])).rows[0];
  if (!t) return res.status(404).json({ error: "That chat no longer exists." });
  await pool.query("UPDATE support_threads SET admin_read_at = now() WHERE id = $1", [t.id]);
  res.json({ chat: threadOut(t), messages: await threadMessages(t.id) });
}));
A.post("/chats/:id/messages", wrap(async (req, res) => {
  const body = String(req.body?.body || "").trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: "Type a reply first." });
  const t = (await pool.query("SELECT * FROM support_threads WHERE id = $1", [Number(req.params.id)])).rows[0];
  if (!t) return res.status(404).json({ error: "That chat no longer exists." });
  if (t.mode !== "human") await addMessage(t.id, "system", "", `${req.adminName} from ${SUPPORT_NAME} joined the chat.`);
  await pool.query("UPDATE support_threads SET mode = 'human', status = 'open', admin_read_at = now() WHERE id = $1", [t.id]);
  const m = await addMessage(t.id, "admin", req.adminName, body);
  res.json({ message: m });
}));
A.post("/chats/:id/mode", wrap(async (req, res) => {
  const mode = req.body?.mode === "ai" ? "ai" : "human";
  if (mode === "ai" && !aiAvailable()) return res.status(400).json({ error: "The assistant isn’t set up on this app (ANTHROPIC_API_KEY)." });
  const t = (await pool.query("UPDATE support_threads SET mode = $1, updated_at = now() WHERE id = $2 RETURNING *", [mode, Number(req.params.id)])).rows[0];
  if (!t) return res.status(404).json({ error: "That chat no longer exists." });
  await addMessage(t.id, "system", "", mode === "ai" ? "The assistant is answering again. Ask for a person any time." : `${req.adminName} from ${SUPPORT_NAME} joined the chat.`);
  res.json({ ok: true });
}));
A.post("/chats/:id/close", wrap(async (req, res) => {
  const t = (await pool.query("UPDATE support_threads SET status = 'closed', updated_at = now() WHERE id = $1 RETURNING *", [Number(req.params.id)])).rows[0];
  if (!t) return res.status(404).json({ error: "That chat no longer exists." });
  await addMessage(t.id, "system", "", `${req.adminName} closed the chat. Send a new message any time to start another.`);
  res.json({ ok: true });
}));
A.get("/custom", wrap(async (req, res) => {
  const st = await getSettings();
  res.json({ custom: st.custom, options: { features: custom.FEATURES, labels: custom.LABELS, fieldTypes: custom.FIELD_TYPES, provinces: Object.keys(custom.PROVINCES) }, plugin: pluginInfo() });
}));
A.put("/custom", wrap(async (req, res) => {
  const { custom: c, errors } = custom.clean(req.body?.custom);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  await putSetting("custom", c);
  const parts = [];
  const off = Object.keys(c.features).filter(k => !c.features[k]); if (off.length) parts.push(`hidden: ${off.join(", ")}`);
  if (Object.keys(c.labels).length) parts.push(`${Object.keys(c.labels).length} word changes`);
  if (c.customerFields.length + c.jobFields.length) parts.push(`${c.customerFields.length + c.jobFields.length} custom fields`);
  await adminLog(req, "Changed this business's customizations", parts.join("; ").slice(0, 300));
  res.json({ custom: c });
}));
A.get("/log", wrap(async (req, res) => {
  res.json({ log: (await pool.query("SELECT at, admin, action, detail FROM admin_log ORDER BY id DESC LIMIT 100")).rows });
}));
app.use("/api/admin/v1", A);
// The business owner can see whether support access is on, and everything done through it.
app.get("/api/support-log", auth, allow("owner"), wrap(async (req, res) => {
  res.json({ enabled: adminEnabled(), log: (await pool.query("SELECT at, admin, action, detail FROM admin_log ORDER BY id DESC LIMIT 50")).rows });
}));

/* ---------- team (owner manages) ---------- */
async function ownerCount() { return (await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'owner'")).rows[0].n; }

app.get("/api/users", auth, managers, wrap(async (req, res) => {
  const { rows } = await pool.query("SELECT id, username, name, email, role, totp_enabled, must_change_password, last_login_at FROM users ORDER BY username");
  res.json({ users: rows.map(u => ({ ...publicUser(u), lastLogin: u.last_login_at, canManage: u.id !== req.user.id && canManage(req.user, u) })), requests: await openPasswordRequests(req.user) });
}));
app.post("/api/users", auth, managers, wrap(async (req, res) => {
  const { username, password, name, role } = req.body || {};
  const err = validateNewUser(username, password);
  if (err) return res.status(400).json({ error: err });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Choose what this person can do." });
  if (req.user.role === "manager" && role !== "staff") return res.status(403).json({ error: "Managers can add Staff. Ask an owner to add a Manager or Owner." });
  const em = cleanEmail(req.body?.email);
  if (em.error) return res.status(400).json({ error: em.error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, name, email, pass_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5, true) RETURNING ${USER_COLS}`,
      [username.trim().toLowerCase(), String(name || "").trim(), em.email, hashPassword(password), role]);
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That username is taken." });
    throw e;
  }
}));
async function teamTarget(req, res) {
  const id = Number(req.params.id);
  const t = (await pool.query("SELECT id, username, role FROM users WHERE id = $1", [id])).rows[0];
  if (!t) { res.status(404).json({ error: "That person no longer exists." }); return null; }
  if (t.id === req.user.id) { res.status(400).json({ error: "Use Account → Change your password for your own account." }); return null; }
  if (!canManage(req.user, t)) { res.status(403).json({ error: "Managers can only manage Staff. Ask an owner." }); return null; }
  return t;
}
app.patch("/api/users/:id", auth, managers, wrap(async (req, res) => {
  const t = await teamTarget(req, res); if (!t) return;
  const { role, name } = req.body || {};
  if (role !== undefined) {
    if (req.user.role !== "owner") return res.status(403).json({ error: "Only an owner can change someone’s access." });
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });
    if (t.role === "owner" && role !== "owner" && await ownerCount() <= 1) return res.status(400).json({ error: "There has to be at least one owner." });
    await pool.query("UPDATE users SET role = $1, session_version = session_version + (CASE WHEN role <> $1 THEN 1 ELSE 0 END) WHERE id = $2", [role, t.id]);
  }
  if (name !== undefined) await pool.query("UPDATE users SET name = $1 WHERE id = $2", [String(name).trim().slice(0, 60), t.id]);
  if (req.body?.email !== undefined) {
    const em = cleanEmail(req.body.email);
    if (em.error) return res.status(400).json({ error: em.error });
    await pool.query("UPDATE users SET email = $1 WHERE id = $2", [em.email, t.id]);
  }
  res.json({ ok: true });
}));
app.post("/api/users/:id/reset-2fa", auth, managers, wrap(async (req, res) => {
  const t = await teamTarget(req, res); if (!t) return;
  await pool.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_pending = NULL, recovery_codes = '[]', session_version = session_version + 1 WHERE id = $1", [t.id]);
  res.json({ ok: true });
}));
app.post("/api/users/:id/reset-password", auth, managers, wrap(async (req, res) => {
  const t = await teamTarget(req, res); if (!t) return;
  if (String(req.body?.password || "").length < 10) return res.status(400).json({ error: "Passwords need at least 10 characters." });
  await pool.query("UPDATE users SET pass_hash = $1, must_change_password = true, session_version = session_version + 1 WHERE id = $2", [hashPassword(req.body.password), t.id]);
  await closeRequests(t.id, req.user.name || req.user.username);
  res.json({ ok: true });
}));
app.delete("/api/users/:id", auth, managers, wrap(async (req, res) => {
  const t = await teamTarget(req, res); if (!t) return;
  if (t.role === "owner" && await ownerCount() <= 1) return res.status(400).json({ error: "There has to be at least one owner." });
  await pool.query("DELETE FROM users WHERE id = $1", [t.id]);
  res.json({ ok: true });
}));

app.post("/api/password", auth, wrap(async (req, res) => {
  const { current, next: newPw } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
  if (!checkPassword(String(current || ""), rows[0].pass_hash)) return res.status(400).json({ error: "Your current password is wrong." });
  if (String(newPw || "").length < 10) return res.status(400).json({ error: "Passwords need at least 10 characters." });
  if (checkPassword(String(newPw), rows[0].pass_hash)) return res.status(400).json({ error: "Choose a password that’s different from the temporary one." });
  const upd = await pool.query("UPDATE users SET pass_hash = $1, must_change_password = false, session_version = session_version + 1 WHERE id = $2 RETURNING *", [hashPassword(newPw), req.user.id]);
  await closeRequests(req.user.id, "Changed by the person");
  setSession(res, upd.rows[0]);
  res.json({ ok: true });
}));

/* ---------- static app ---------- */
app.get("/manifest.webmanifest", wrap(async (req, res) => {
  const st = await getSettings(); const name = st.business.name || "Fielora";
  const base = JSON.parse(require("fs").readFileSync(path.join(__dirname, "public", "manifest.webmanifest"), "utf8"));
  res.setHeader("Content-Type", "application/manifest+json");
  res.json({ ...base, name, short_name: name.length > 14 ? (name.split(/\s+/)[0] || name).slice(0, 14) : name, description: `Scheduling and service reports for ${name}.` });
}));
/* ---------- per-customer custom code (custom/<FIELORA_CUSTOM>/) ---------- */
// One codebase for every customer. A customer-only feature lives in its own folder and loads only on the
// app whose Render settings say FIELORA_CUSTOM=<that folder>. See custom/README.md.
const PLUGIN_ID = (process.env.FIELORA_CUSTOM || "").trim().toLowerCase();
const PLUGIN_DIR = /^[a-z0-9][a-z0-9-]{0,40}$/.test(PLUGIN_ID) ? path.join(__dirname, "custom", PLUGIN_ID) : null;
let pluginMeta = null;
function pluginInfo() { return PLUGIN_ID ? { id: PLUGIN_ID, loaded: !!pluginMeta && !pluginMeta.error, name: pluginMeta?.name || PLUGIN_ID, version: pluginMeta?.version || "", error: pluginMeta?.error || (PLUGIN_DIR ? undefined : "Invalid FIELORA_CUSTOM name") } : null; }
if (PLUGIN_DIR) {
  const fs = require("fs");
  if (!fs.existsSync(PLUGIN_DIR)) { pluginMeta = { error: `custom/${PLUGIN_ID} doesn’t exist` }; console.error(`FIELORA_CUSTOM=${PLUGIN_ID} but custom/${PLUGIN_ID} doesn’t exist`); }
  else {
    try {
      const serverFile = path.join(PLUGIN_DIR, "server.js");
      const mod = fs.existsSync(serverFile) ? require(serverFile) : {};
      pluginMeta = { name: mod.name || PLUGIN_ID, version: mod.version || "" };
      if (typeof mod.register === "function") mod.register({ app, pool, auth, allow, workers, wrap, getSettings, putSetting, adminRouter: A, adminLog, express });
      console.log(`Custom code loaded: custom/${PLUGIN_ID}`);
    } catch (e) { pluginMeta = { error: e.message }; console.error(`Custom code custom/${PLUGIN_ID} failed to load:`, e); }
  }
}
app.get("/custom.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8"); res.setHeader("Cache-Control", "no-cache");
  const f = PLUGIN_DIR && pluginMeta && !pluginMeta.error ? path.join(PLUGIN_DIR, "client.js") : null;
  if (f && require("fs").existsSync(f)) return res.sendFile(f);
  res.send("/* no custom code for this app */");
});
app.get("/custom.css", (req, res) => {
  res.setHeader("Content-Type", "text/css; charset=utf-8"); res.setHeader("Cache-Control", "no-cache");
  const f = PLUGIN_DIR && pluginMeta && !pluginMeta.error ? path.join(PLUGIN_DIR, "client.css") : null;
  if (f && require("fs").existsSync(f)) return res.sendFile(f);
  res.send("/* no custom styles */");
});

app.use("/vendor/leaflet", express.static(path.join(__dirname, "node_modules", "leaflet", "dist"), { maxAge: "7d" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: 0 }));
app.get("*", (req, res, next) => req.path.startsWith("/api") ? next() : res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server. Try again." });
});

// Waits for the database before starting. On Render the database can still be starting
// (or restarting) when the app boots; retry for about two minutes with a clear log message.
async function waitForDatabase(tries = 24) {
  for (let i = 1; ; i++) {
    try { await pool.query("SELECT 1"); return; }
    catch (e) {
      const hint = e.code === "ECONNREFUSED" || e.code === "ENOTFOUND" || e.code === "ETIMEDOUT"
        ? "The database isn’t reachable yet. If this keeps happening, check that the database shows Available, is in the same Render region as this service, and that DATABASE_URL is its Internal Database URL."
        : e.message;
      if (i >= tries) throw new Error(`Couldn’t connect to the database after ${tries} tries. ${hint}`);
      console.log(`Waiting for the database (try ${i} of ${tries}): ${e.code || e.message}. ${i === 1 ? hint : ""}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
waitForDatabase().then(migrate)
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`Fielora listening on ${PORT}`)))
  .catch(e => { console.error("Database setup failed:", e); process.exit(1); });
