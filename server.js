require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Server } = require('socket.io');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { Pool } = require('pg');

// Neon PostgreSQL: stores the complete serialized GameTik state across Render deploys.
const dbPool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
  max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000
}) : null;
let dbSaveQueue = Promise.resolve();
let databaseReady = false;

const app = express();
// Render runs behind a trusted reverse proxy. Use the client IP forwarded by
// Render so per-IP admin login throttling does not accidentally lock out every
// visitor behind the same proxy address. Keep this at one proxy hop on Render.
app.set('trust proxy', 1);
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const PORT = Number(process.env.PORT || 10000);
const MAX_VIDEO_BYTES = 35 * 1024 * 1024;
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
// Prefer the configured persistent disk. If the mount is missing or not writable,
// try a writable local directory so the service can still start. Local fallbacks
// are ephemeral on Render and do NOT guarantee data persistence across deploys.
const requestedDataRoot = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
let dataRoot = requestedDataRoot;
function ensureDataDirectories(root) {
  fs.mkdirSync(path.join(root, 'uploads', 'videos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'uploads', 'avatars'), { recursive: true });
  const probe = path.join(root, `.gametik-write-test-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
}
const fallbackCandidates = [
  path.resolve(__dirname, 'data'),
  path.join(require('os').tmpdir(), 'gametik-data')
].filter((candidate, index, all) => candidate !== requestedDataRoot && all.indexOf(candidate) === index);
try {
  ensureDataDirectories(dataRoot);
} catch (initialError) {
  let selected = false;
  for (const fallbackRoot of fallbackCandidates) {
    try {
      ensureDataDirectories(fallbackRoot);
      console.error(`WARN: DATA_DIR '${requestedDataRoot}' is not writable (${initialError.code || initialError.message}). ` +
        `Using temporary/local storage '${fallbackRoot}'. Data may be lost after restart or redeploy; configure a writable Render Persistent Disk.`);
      dataRoot = fallbackRoot;
      selected = true;
      break;
    } catch (fallbackError) {
      console.error(`WARN: GameTik storage fallback '${fallbackRoot}' failed: ${fallbackError.code || fallbackError.message}`);
    }
  }
  if (!selected) throw initialError;
}
const uploadRoot = path.join(dataRoot, 'uploads');
const stateFile = path.join(dataRoot, 'gametik-state.json');
const videoDir = path.join(uploadRoot, 'videos');
const avatarDir = path.join(uploadRoot, 'avatars');
// Cloudflare R2 is used for avatars so they survive Render deploys/restarts.
const r2Bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || '';
const r2PublicUrl = String(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
const r2Endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
const r2Ready = Boolean(r2Endpoint && r2Bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && r2PublicUrl);
const r2 = r2Ready ? new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: r2Endpoint,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
}) : null;
async function restoreAvatarFromR2(userId) {
  if (!r2Ready || !r2 || !userId) return null;
  try {
    const prefix = `avatars/${String(userId).replace(/[^a-zA-Z0-9_-]/g, '')}/`;
    const result = await r2.send(new ListObjectsV2Command({ Bucket: r2Bucket, Prefix: prefix, MaxKeys: 100 }));
    const newest = (result.Contents || []).filter(item => item.Key && item.LastModified).sort((a,b) => new Date(b.LastModified) - new Date(a.LastModified))[0];
    return newest?.Key ? `${r2PublicUrl}/${newest.Key}` : null;
  } catch (e) {
    console.error('Avatar recovery from R2 failed:', e.name || e.message);
    return null;
  }
}
// Send transactional mail through Brevo's HTTPS API. This avoids SMTP port
// timeouts on hosting platforms that restrict outbound SMTP connections.
function brevoSender() {
  const raw = String(process.env.SMTP_FROM || process.env.BREVO_SENDER_EMAIL || '').trim();
  const match = raw.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  const email = (match ? match[2] : raw).trim();
  const name = (match && match[1] ? match[1].replace(/^\"|\"$/g, '') : 'GameTik').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Brevo-Absender ungültig: SMTP_FROM muss eine bestätigte E-Mail-Adresse enthalten.');
  return { name: name || 'GameTik', email };
}
async function sendBrevoEmail({ to, subject, textContent, htmlContent }) {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) throw new Error('BREVO_API_KEY fehlt. In Render den Brevo-API-Schlüssel als Secret setzen.');
  const sender = brevoSender();
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent, htmlContent }),
    signal: AbortSignal.timeout(20000)
  });
  const responseText = await response.text();
  if (!response.ok) {
    // Do not log API keys or email body; the response body contains the provider's diagnostic.
    const safeBody = responseText.slice(0, 500);
    const error = new Error(`Brevo API HTTP ${response.status}: ${safeBody}`);
    error.code = `BREVO_HTTP_${response.status}`;
    throw error;
  }
  return responseText ? JSON.parse(responseText) : {};
}
const passwordResetTokens = new Map();

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});
// Allow the Netlify frontend to call the Render API.
app.use((req, res, next) => {
  const origin = req.get('origin');
  const configuredOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const builtInAllowed = origin && /^https?:\/\/(?:[a-z0-9-]+\.netlify\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)$/i.test(origin);
  if (origin && (builtInAllowed || configuredOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/uploads/videos', express.static(videoDir, { maxAge: '1h' }));
app.use('/uploads/avatars', express.static(avatarDir, { maxAge: '1h' }));
const publicDir = __dirname;
// Explicitly serve the homepage so GET / works even if static index resolution differs.
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
// Do not expose backend source, package metadata, or environment files as public assets.
app.use((req, res, next) => {
  const blocked = new Set(['/server.js', '/package.json', '/package-lock.json', '/README.md', '/.env']);
  if (blocked.has(decodeURIComponent(req.path))) return res.status(404).end();
  next();
});
app.use(express.static(publicDir, { dotfiles: 'deny', index: false }));

const sessions = new Map();
const accounts = new Map(); // normalized username -> persistent account data
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const videos = [];
const chatMessages = [];
const privateMessages = [];
const gifts = [];
// Paid gifts are stored as per-account inventory counts and persisted with GameTik state.
const giftInventory = new Map(); // userId -> { Herz: number, Stern: number, Feuer: number, Krone: number, ... }
const giftInventoryMigrated = new Set(); // user IDs whose earlier standalone purchases have been migrated once
const giftInventoryRecoveredPaymentIds = new Set(); // payment IDs credited from legacy LIVE purchases, preventing duplicate recovery
const creatorBalancesCents = new Map(); // userId -> withdrawable cents earned from gifts received from other users
const walletTransactions = []; // append-only wallet/gift accounting ledger
const payoutRequests = []; // payout requests require operator/PayPal Payouts processing
const processedGiftEarnings = new Set(); // gift record IDs already split, prevents duplicate credit
const candyBalances = new Map();
const candyDailyClaims = new Map();
const candySpinCooldowns = new Map();
const candyFreeSpins = new Map();
const stories = [];
const adminBlockedUsers = new Set();
// Friend requests are held in memory in this demo backend; use a database for persistence.
const friendRequests = new Map(); // recipientId -> [{ id, fromId, created_at }]
const friendships = new Map(); // userId -> Set(userId)
let nextStoryId = 1;
const paypalOrders = new Map();
const liveRooms = new Map();
let nextVideoId = 1;
let nextCommentId = 1;
function serializeMapOfSets(map) { return [...map.entries()].map(([k,v]) => [k, v instanceof Set ? [...v] : v]); }
function snapshotPersistentState() {
  return {
    accounts: [...accounts.entries()], passwordResetTokens: [...passwordResetTokens.entries()],
    sessions: [...sessions.entries()].map(([token,u]) => [token, { ...u, likes:[...(u.likes||[])], following:[...(u.following||[])], blockedUsers:[...(u.blockedUsers||[])] }]),
    videos, chatMessages, privateMessages, gifts, stories,
    giftInventory: [...giftInventory.entries()], giftInventoryMigrated: [...giftInventoryMigrated], giftInventoryRecoveredPaymentIds: [...giftInventoryRecoveredPaymentIds],
    creatorBalancesCents: [...creatorBalancesCents.entries()], walletTransactions, payoutRequests, processedGiftEarnings: [...processedGiftEarnings],
    candyBalances: [...candyBalances.entries()], candyDailyClaims: [...candyDailyClaims.entries()], candySpinCooldowns: [...candySpinCooldowns.entries()], candyFreeSpins: [...candyFreeSpins.entries()],
    friendRequests: [...friendRequests.entries()], friendships: serializeMapOfSets(friendships), adminBlockedUsers:[...adminBlockedUsers],
    nextStoryId, nextVideoId, nextCommentId
  };
}
function savePersistentState() {
  let json;
  try {
    json = JSON.stringify(snapshotPersistentState(), (_key, value) => value instanceof Set ? { __gametikType: 'Set', values: [...value] } : value);
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, stateFile);
  } catch (e) {
    console.error('GameTik local state could not be saved:', e.message);
  }
  if (dbPool && json) {
    // Keep writes ordered, but allow a later save to recover after an earlier DB error.
    const payload = json;
    dbSaveQueue = dbSaveQueue.catch(() => {}).then(async () => {
      if (!databaseReady) return;
      await dbPool.query(`INSERT INTO gametik_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`, [payload]);
    });
    dbSaveQueue.catch(e => console.error('GameTik PostgreSQL save failed:', e.message));
  }
  return dbSaveQueue;
}
// PostgreSQL's pg driver returns jsonb as an ordinary JS object (not a JSON string),
// so JSON.parse's reviver is not applied on that path. Restore our tagged Set values
// recursively before any code tries to construct new Set(value).
function revivePersistentTypes(value) {
  if (Array.isArray(value)) return value.map(revivePersistentTypes);
  if (!value || typeof value !== 'object') return value;
  if (value.__gametikType === 'Set' && Array.isArray(value.values)) {
    return new Set(value.values.map(revivePersistentTypes));
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = revivePersistentTypes(child);
  return result;
}
function applyPersistentState(d) {
  d = revivePersistentTypes(d || {});
  for (const [k,v] of d.accounts || []) accounts.set(k,v);
  for (const [k,v] of d.passwordResetTokens || []) if (v && Number(v.expiresAt) > Date.now()) passwordResetTokens.set(k,v);
  for (const [token,u] of d.sessions || []) {
    const accountEntry = [...(d.accounts || [])].find(([, a]) => String(a.id) === String(u.id));
    const account = accountEntry?.[1];
    const avatarUrl = u.avatar_url || account?.avatar_url || null;
    sessions.set(token,{...u,avatar_url:avatarUrl,likes:new Set(u.likes||[]),following:new Set(u.following||[]),blockedUsers:new Set(u.blockedUsers||[])});
    // Repair older state snapshots where the avatar URL was stored only on the session.
    if (accountEntry && avatarUrl && !account.avatar_url) account.avatar_url = avatarUrl;
  }
  for (const [k,v] of Object.entries({videos,chatMessages,privateMessages,gifts,stories})) v.push(...(d[k]||[]));
  for (const video of videos) {
    if (!(video.likes instanceof Set)) video.likes = new Set(Array.isArray(video.likes) ? video.likes : []);
    if (!Array.isArray(video.comments)) video.comments = [];
    if (!Array.isArray(video.ratings)) video.ratings = [];
    if (!video.reactions || typeof video.reactions !== 'object') video.reactions = {};
    for (const [kind, value] of Object.entries(video.reactions)) if (!(value instanceof Set)) video.reactions[kind] = new Set(Array.isArray(value) ? value : []);
  }
  for (const [k,v] of d.giftInventory||[]) giftInventory.set(String(k), v && typeof v === 'object' ? v : {});
  for (const id of d.giftInventoryMigrated||[]) giftInventoryMigrated.add(String(id));
  for (const id of d.giftInventoryRecoveredPaymentIds||[]) giftInventoryRecoveredPaymentIds.add(String(id));
  for (const [k,v] of d.creatorBalancesCents||[]) creatorBalancesCents.set(String(k), Math.max(0, Math.round(Number(v)||0)));
  walletTransactions.push(...(d.walletTransactions||[]));
  payoutRequests.push(...(d.payoutRequests||[]));
  for (const id of d.processedGiftEarnings||[]) processedGiftEarnings.add(String(id));
  for (const [k,v] of d.candyBalances||[]) candyBalances.set(k, v);
  for (const [k,v] of d.candyDailyClaims||[]) candyDailyClaims.set(k,v);
  for (const [k,v] of d.candySpinCooldowns||[]) candySpinCooldowns.set(k,v);
  for (const [k,v] of d.candyFreeSpins||[]) candyFreeSpins.set(k,v);
  for (const [k,v] of d.friendRequests||[]) friendRequests.set(k,v);
  for (const [k,v] of d.friendships||[]) friendships.set(k,new Set(v||[]));
  for (const id of d.adminBlockedUsers||[]) adminBlockedUsers.add(id);
  nextStoryId=d.nextStoryId||1; nextVideoId=d.nextVideoId||1; nextCommentId=d.nextCommentId||1;
}
function loadLocalPersistentState() {
  try { if (fs.existsSync(stateFile)) applyPersistentState(JSON.parse(fs.readFileSync(stateFile, 'utf8'), (_key, value) => value && value.__gametikType === 'Set' ? new Set(value.values || []) : value)); }
  catch (e) { console.error('GameTik local state could not be loaded:', e.message); }
}
async function initializePersistence() {
  if (!dbPool) {
    loadLocalPersistentState();
    console.error('WARN: DATABASE_URL is not set. GameTik is using local JSON storage; data may be lost on Render redeploy.');
    return;
  }
  await dbPool.query(`CREATE TABLE IF NOT EXISTS gametik_state (id integer PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT NOW())`);
  const result = await dbPool.query('SELECT payload FROM gametik_state WHERE id = 1');
  if (result.rows.length) {
    applyPersistentState(typeof result.rows[0].payload === 'string' ? JSON.parse(result.rows[0].payload, (_key, value) => value && value.__gametikType === 'Set' ? new Set(value.values || []) : value) : result.rows[0].payload);
    console.log('GameTik state loaded from PostgreSQL.');
  } else {
    loadLocalPersistentState();
    await dbPool.query(`INSERT INTO gametik_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO NOTHING`, [JSON.stringify(snapshotPersistentState())]);
    console.log('GameTik PostgreSQL state table initialized.');
  }
  databaseReady = true;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected || '', 'hex');
  return expectedBuf.length === actual.length && crypto.timingSafeEqual(actual, expectedBuf);
}
function createUser(username, accountId = crypto.randomUUID(), profile = {}) {
  const id = String(accountId), token = crypto.randomUUID();
  const user = { id, username, avatar_url: profile.avatar_url || null, created_at: profile.created_at || new Date().toISOString(), gender: profile.gender || '', bio: profile.bio || '', relationship_status: profile.relationship_status || '', location: profile.location || '', social_private: profile.social_private !== false, social_visibility: profile.social_visibility || (profile.social_private === false ? 'public' : 'private'), likes:new Set(), following:new Set(), blockedUsers:new Set() };
  sessions.set(token,user); friendships.set(id,new Set()); friendRequests.set(id,[]);
  return {token,user};
}
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, videoDir),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + safeExtension(file.mimetype, file.originalname))
});
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + safeExtension(file.mimetype, file.originalname))
});
function safeExtension(mimetype, originalName) {
  // Use the validated MIME type to prevent mismatched extensions (e.g. an MP4 named .jpg).
  const extensions = {
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/ogg': '.ogv', 'video/x-m4v': '.m4v',
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/bmp': '.bmp',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/webm': '.webm', 'audio/flac': '.flac', 'audio/x-flac': '.flac',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
    'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/rtf': '.rtf', 'application/zip': '.zip'
  };
  return extensions[mimetype] || '';
}
const allowedMediaTypes = ['video/mp4','video/webm','video/quicktime','video/ogg','video/x-m4v','image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp'];
const allowedAudioTypes = ['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac','audio/x-flac'];
const allowedDocumentTypes = ['application/pdf','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/rtf','application/zip'];
const videoUpload = multer({ storage: videoStorage, limits: { fileSize: MAX_VIDEO_BYTES, files: 1 }, fileFilter: (_req, f, cb) => {
  const allowed = allowedMediaTypes.includes(f.mimetype);
  cb(allowed ? null : Object.assign(new Error('Erlaubt sind gängige Bildformate (JPG, PNG, WebP, GIF, AVIF, BMP) sowie MP4, WebM, MOV, OGV und M4V.'), { status: 400 }), allowed);
}});
const postUpload = multer({ storage: videoStorage, limits: { fileSize: MAX_VIDEO_BYTES, files: 3 }, fileFilter: (_req, f, cb) => {
  const allowed = f.fieldname === 'music' ? allowedAudioTypes.includes(f.mimetype) : f.fieldname === 'video' ? allowedMediaTypes.includes(f.mimetype) : f.fieldname === 'document' && allowedDocumentTypes.includes(f.mimetype);
  const message = f.fieldname === 'music' ? 'Erlaubt sind MP3, M4A, AAC, OGG, WAV, WebM und FLAC.' : f.fieldname === 'document' ? 'Dokumentformat nicht erlaubt. Erlaubt: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, RTF oder ZIP.' : 'Erlaubt sind gängige Bildformate (JPG, PNG, WebP, GIF, AVIF, BMP) sowie MP4, WebM, MOV, OGV und M4V.';
  cb(allowed ? null : Object.assign(new Error(message), { status: 400 }), allowed);
}});
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AVATAR_BYTES, files: 1 }, fileFilter: (_req, f, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype);
  cb(allowed ? null : Object.assign(new Error('Erlaubt sind JPG, PNG und WebP.'), { status: 400 }), allowed);
}});
const storyUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, videoDir),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + safeExtension(file.mimetype, file.originalname))
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp','video/mp4','video/webm','video/quicktime','video/ogg','video/x-m4v'];
    cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('Storys erlauben gängige Bildformate sowie MP4, WebM, MOV, OGV oder M4V.'), { status: 400 }), allowed.includes(file.mimetype));
  }
});
function purgeExpiredStories() {
  const now = Date.now();
  for (let i = stories.length - 1; i >= 0; i--) {
    const story = stories[i];
    if (Date.parse(story.expires_at) <= now) {
      if (story.media_url && story.media_url.startsWith('/uploads/videos/')) {
        fs.unlink(path.join(videoDir, path.basename(story.media_url)), () => {});
      }
      stories.splice(i, 1);
    }
  }
}
const storyCleanupTimer = setInterval(() => { purgeExpiredStories(); savePersistentState(); }, 15 * 60 * 1000);
if (typeof storyCleanupTimer.unref === 'function') storyCleanupTimer.unref();
// Safety net: persist state changes from routes/realtime handlers that do not explicitly save.
const stateFlushTimer = setInterval(savePersistentState, 2000);
if (typeof stateFlushTimer.unref === 'function') stateFlushTimer.unref();

function getSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token);
}
function auth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Wähle zuerst einen Nickname.' });
  if (adminBlockedUsers.has(String(session.id))) return res.status(403).json({ error: 'Dein Konto wurde vom Administrator gesperrt.' });
  req.user = session;
  next();
}
function isBlockedBetween(viewer, ownerId) {
  if (!viewer) return false;
  const owner = sessions.get(String(ownerId));
  return viewer.blockedUsers?.has(String(ownerId)) || owner?.blockedUsers?.has(String(viewer.id)) || adminBlockedUsers.has(String(ownerId));
}
function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = adminSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ error: 'Administrator-Anmeldung erforderlich.' });
  }
  req.admin = session;
  next();
}
app.post('/api/admin/login', (req, res) => {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const attempts = adminLoginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (attempts.resetAt <= now) { attempts.count = 0; attempts.resetAt = now + 15 * 60 * 1000; }
  if (attempts.count >= 10) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.resetAt - now) / 1000))));
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' });
  }
  const configuredUser = String(process.env.ADMIN_USERNAME || '').trim();
  const configuredPassword = String(process.env.ADMIN_PASSWORD || '');
  if (!configuredUser || configuredPassword.length < 12) {
    return res.status(503).json({ error: 'Admin-Zugang fehlt. ADMIN_USERNAME und ein ADMIN_PASSWORD mit mindestens 12 Zeichen in Render einrichten.' });
  }
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  const safeEqual = (a, b) => {
    const ah = crypto.createHash('sha256').update(a).digest();
    const bh = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ah, bh);
  };
  if (!safeEqual(username, configuredUser) || !safeEqual(password, configuredPassword)) {
    attempts.count += 1;
    adminLoginAttempts.set(ip, attempts);
    return res.status(401).json({ error: 'Benutzername oder Passwort ist falsch.' });
  }
  adminLoginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, { username: configuredUser, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ token, username: configuredUser, expiresIn: 28800 });
});
app.post('/api/admin/logout', adminAuth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  adminSessions.delete(token);
  res.json({ ok: true });
});
app.get('/api/admin/overview', adminAuth, (_req, res) => {
  res.json({
    admin: reqAdminName(_req),
    stats: { onlineSessions: sessions.size, blockedUsers: adminBlockedUsers.size, videos: videos.length, stories: stories.length, publicMessages: chatMessages.length, privateMessages: privateMessages.length, gifts: gifts.length, paypalOrders: paypalOrders.size },
    users: [...sessions.values()].map(user => ({ ...publicUser(user), adminBlocked: adminBlockedUsers.has(String(user.id)), blockedByUser: Boolean(user.blockedUsers?.size) })),
    videos: videos.slice().reverse().map(v => ({ id: v.id, username: v.username, caption: v.caption, created_at: v.created_at, likes: v.likes.size })),
    stories: stories.slice().reverse().map(story => ({ id: story.id, username: story.username, type: story.type, caption: story.caption, created_at: story.created_at, expires_at: story.expires_at })),
    gifts: gifts.slice().reverse().slice(0, 100).map(g => ({ username: g.username, gift: g.gift, created_at: g.created_at, paymentId: g.paymentId || null }))
  });
});
function reqAdminName(req) { return req.admin?.username || ''; }
app.delete('/api/admin/videos/:id', adminAuth, (req, res) => {
  const index = videos.findIndex(v => v.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Video nicht gefunden.' });
  const [video] = videos.splice(index, 1);
  if (video.video_url) fs.unlink(path.join(videoDir, path.basename(video.video_url)), () => {});
  for (const user of sessions.values()) user.likes?.delete(video.id);
  res.json({ ok: true });
});
app.delete('/api/admin/stories/:id', adminAuth, (req, res) => {
  const index = stories.findIndex(story => story.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Story nicht gefunden.' });
  const [story] = stories.splice(index, 1);
  if (story.media_url) fs.unlink(path.join(videoDir, path.basename(story.media_url)), () => {});
  res.json({ ok: true });
});
app.patch('/api/admin/users/:id/block', adminAuth, (req, res) => {
  const id = String(req.params.id);
  const userExists = [...sessions.values()].some(user => String(user.id) === id);
  if (!userExists) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const blocked = req.body.blocked === true;
  if (blocked) adminBlockedUsers.add(id); else adminBlockedUsers.delete(id);
  savePersistentState();
  res.json({ ok: true, blocked });
});
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  const id = String(req.params.id);
  const account = [...accounts.entries()].find(([, value]) => String(value.id) === id);
  const matchingTokens = [...sessions.entries()].filter(([, user]) => String(user.id) === id).map(([token]) => token);
  if (!matchingTokens.length && !account) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  for (const token of matchingTokens) sessions.delete(token);
  if (account) accounts.delete(account[0]);
  adminBlockedUsers.delete(id); friendRequests.delete(id); friendships.delete(id);
  for (const [recipient, list] of friendRequests) friendRequests.set(recipient, list.filter(r => String(r.fromId) !== id));
  for (const set of friendships.values()) set.delete(id);
  for (const other of sessions.values()) { other.following?.delete(id); other.blockedUsers?.delete(id); }
  for (let i = videos.length - 1; i >= 0; i--) if (String(videos[i].user_id) === id) { const [v] = videos.splice(i,1); if (v.video_url) fs.unlink(path.join(videoDir,path.basename(v.video_url)),()=>{}); }
  for (let i = stories.length - 1; i >= 0; i--) if (String(stories[i].user_id) === id) { const [st] = stories.splice(i,1); if (st.media_url) fs.unlink(path.join(videoDir,path.basename(st.media_url)),()=>{}); }
  savePersistentState();
  res.json({ ok: true });
});

function asyncRoute(fn) { return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }
function publicUser(user) {
  return { id: user.id, username: user.username, email: null, avatar_url: user.avatar_url || null, created_at: user.created_at, gender: user.gender || '', bio: user.bio || '', relationship_status: user.relationship_status || '', location: user.location || '', social_private: user.social_private !== false, social_visibility: ['public','friends','private'].includes(user.social_visibility) ? user.social_visibility : (user.social_private === false ? 'public' : 'private'), following_count: user.following ? user.following.size : 0, followers_count: [...sessions.values()].filter(other => other.following && other.following.has(user.id)).length, posts_count: videos.filter(v => v.user_id === user.id).length, likes_count: videos.filter(v => v.user_id === user.id).reduce((sum, v) => sum + v.likes.size, 0) };
}
// Ranked Battle Arena results are deliberately fail-closed until the duel simulation is authoritative on the server.
// Local bot rounds are practice-only; a browser must never be allowed to award itself ranked wins or XP.
app.get('/api/arena/ranked-status', auth, (_req, res) => res.json({
  enabled: false,
  mode: 'practice-only',
  message: 'Online-Ranglisten bleiben deaktiviert, bis serverautoritatives Online-Duell-Gameplay verfügbar ist.'
}));
app.post('/api/arena/ranked-result', auth, (_req, res) => res.status(409).json({
  accepted: false,
  error: 'Online-Ergebnisse werden derzeit nicht angenommen. Bot-Runden sind ungewertet; Online-Siege dürfen erst nach serverseitiger Duellprüfung zählen.'
}));

app.get('/api/health', (_req,res) => res.status(dbPool && databaseReady ? 200 : 503).json({ ok: Boolean(dbPool && databaseReady), service: 'gametik', mode: dbPool && databaseReady ? 'postgresql' : 'file-backed', storagePath: dataRoot, persistentStorage: Boolean(dbPool && databaseReady), database: dbPool && databaseReady ? 'postgresql-connected' : 'DATABASE_URL-missing-or-not-ready', r2Configured: Boolean(r2Ready), passwordResetConfigured: Boolean(process.env.BREVO_API_KEY && (process.env.SMTP_FROM || process.env.BREVO_SENDER_EMAIL) && (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL)), secretKey: 'passwords-hashed' }));
app.get('/api/config', (_req,res) => res.json({
  paypalUrl: process.env.PAYPAL_DONATION_URL || '',
  paypalEnabled: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  paypalMode: String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase(),
  currency: (process.env.PAYPAL_CURRENCY || 'EUR').toUpperCase(),
  mode: dataRoot === requestedDataRoot ? 'configured-file-store' : 'fallback-file-store',
  persistentStorage: dataRoot === requestedDataRoot && Boolean(process.env.DATA_DIR)
}));
app.post('/api/auth/register', asyncRoute(async (req,res) => {
  const username=String(req.body.username||'').trim();
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return res.status(400).json({error:'Benutzername: 3–24 Zeichen, nur Buchstaben, Zahlen und _. '});
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Bitte eine gültige E-Mail-Adresse eingeben.'});
  if (password.length < 10 || password.length > 128) return res.status(400).json({error:'Das Passwort muss 10–128 Zeichen lang sein.'});
  const key=username.toLowerCase();
  if (accounts.has(key)) return res.status(409).json({error:'Dieser Benutzername ist bereits vergeben.'});
  if ([...accounts.values()].some(a=>a.email===email)) return res.status(409).json({error:'Diese E-Mail-Adresse ist bereits registriert.'});
  const credentials=hashPassword(password), id=crypto.randomUUID();
  accounts.set(key,{id,username,email,passwordSalt:credentials.salt,passwordHash:credentials.hash,created_at:new Date().toISOString()});
  const created=createUser(username,id);
  try { await savePersistentState(); } catch (e) { accounts.delete(key); sessions.delete(created.token); return res.status(503).json({error:'Konto konnte nicht dauerhaft gespeichert werden. Bitte in Kürze erneut versuchen.'}); }
  res.status(201).json({token:created.token,user:publicUser(created.user)});
}));
app.post('/api/auth/login', asyncRoute(async (req,res) => {
  const identity=String(req.body.identity||req.body.username||'').trim();
  const password=String(req.body.password||'');
  const account=[...accounts.values()].find(a=>a.username.toLowerCase()===identity.replace(/^@/,'').toLowerCase() || a.email===identity.toLowerCase());
  if (!account || !verifyPassword(password,account.passwordSalt,account.passwordHash)) return res.status(401).json({error:'Benutzername/E-Mail oder Passwort ist falsch.'});
  let existing=[...sessions.entries()].find(([,u])=>String(u.id)===String(account.id));
  let token,user;
  if(existing){ token=existing[0]; user=existing[1]; }
  else ({token,user}=createUser(account.username,account.id,account));
  if (!user.avatar_url) user.avatar_url = account.avatar_url || await restoreAvatarFromR2(account.id);
  if (user.avatar_url) account.avatar_url = user.avatar_url;
  try { await savePersistentState(); } catch (e) { return res.status(503).json({error:'Anmeldung möglich, aber die Sitzung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.'}); }
  res.json({token,user:publicUser(user)});
}));
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body.email || req.body.identity || '').trim().toLowerCase();
  // Same response whether or not the account exists, to avoid disclosing registered emails.
  const generic = 'Wenn diese E-Mail zu einem Konto gehört, wird ein Link zum Zurücksetzen gesendet.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' });
  const account = [...accounts.entries()].find(([, a]) => String(a.email || '').toLowerCase() === email);
  if (!account) return res.json({ message: generic });
  const appBase = appBaseUrl(req).replace(/\/$/, '');
  if (!appBase || !/^https:\/\//i.test(appBase)) {
    console.error('Password reset not sent: APP_BASE_URL / RENDER_EXTERNAL_URL is missing or not HTTPS.');
    return res.status(503).json({ error: 'Passwort-Reset ist nicht konfiguriert. In Render APP_BASE_URL auf die öffentliche HTTPS-Adresse dieser GameTik-Webseite setzen.' });
  }
  try {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Remove expired tokens and older tokens for the same account.
    for (const [k, v] of passwordResetTokens) if (Number(v.expiresAt) <= Date.now() || v.accountKey === account[0]) passwordResetTokens.delete(k);
    passwordResetTokens.set(tokenHash, { accountKey: account[0], expiresAt: Date.now() + 60 * 60 * 1000 });
    try { await savePersistentState(); } catch (dbError) { passwordResetTokens.delete(tokenHash); return res.status(503).json({ error: 'Der Reset-Link konnte nicht sicher gespeichert werden. Bitte später erneut versuchen.' }); }
    const link = `${appBase}/?resetToken=${encodeURIComponent(rawToken)}`;
    await sendBrevoEmail({
      to: email,
      subject: 'GameTik – Passwort zurücksetzen',
      textContent: `Du hast das Zurücksetzen deines GameTik-Passworts angefordert. Öffne diesen Link innerhalb von 60 Minuten:\n\n${link}\n\nFalls der Button nicht funktioniert, kopiere die vollständige Adresse in deinen Browser.\n\nWenn du die Anfrage nicht gestellt hast, ignoriere diese E-Mail.`,
      // Intentionally do not include an HTML anchor. Brevo click tracking can rewrite
      // reset URLs to a tracking domain; if that domain is unavailable, the user cannot
      // reach the app. The recipient can copy the direct HTTPS URL below.
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>GameTik – Passwort zurücksetzen</h2><p>Du hast das Zurücksetzen deines Passworts angefordert.</p><p>Öffne die folgende direkte GameTik-Adresse in deinem Browser oder kopiere sie vollständig in die Adresszeile:</p><p style="overflow-wrap:anywhere;word-break:break-all;background:#f3f3f7;padding:12px;border-radius:8px">${link}</p><p>Der Link ist 60 Minuten gültig und kann nur einmal verwendet werden.</p><p>Wenn du das nicht angefordert hast, ignoriere diese E-Mail.</p></div>`
    });
    res.json({ message: generic });
  } catch (mailError) {
    console.error('GameTik password reset email failed:', mailError.code || mailError.message);
    res.status(502).json({ error: 'Die E-Mail konnte nicht gesendet werden. Prüfe BREVO_API_KEY und ob SMTP_FROM eine bei Brevo verifizierte Absenderadresse enthält.' });
  }
});
app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  const rawToken = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) return res.status(400).json({ error: 'Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Das neue Passwort muss 10–128 Zeichen lang sein.' });
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = passwordResetTokens.get(tokenHash);
  if (!record || Number(record.expiresAt) <= Date.now()) { passwordResetTokens.delete(tokenHash); savePersistentState(); return res.status(400).json({ error: 'Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen Link an.' }); }
  const account = accounts.get(record.accountKey);
  if (!account) { passwordResetTokens.delete(tokenHash); savePersistentState(); return res.status(400).json({ error: 'Das Konto wurde nicht gefunden. Bitte wende dich an den Support.' }); }
  const credentials = hashPassword(password);
  account.passwordSalt = credentials.salt;
  account.passwordHash = credentials.hash;
  accounts.set(record.accountKey, account);
  for (const [k, v] of passwordResetTokens) if (v.accountKey === record.accountKey) passwordResetTokens.delete(k);
  // Invalidate sessions for this account after password change.
  for (const [sessionToken, user] of sessions) if (String(user.id) === String(account.id)) sessions.delete(sessionToken);
  try { await savePersistentState(); } catch (e) { return res.status(503).json({ error: 'Das neue Passwort konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.' }); }
  res.json({ message: 'Passwort erfolgreich geändert. Bitte melde dich mit dem neuen Passwort an.' });
}));
app.post('/api/guest', (req,res) => {
  const nickname = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{2,24}$/.test(nickname)) return res.status(400).json({ error: 'Nickname: 2–24 Zeichen, nur Buchstaben, Zahlen und _.' });
  if ([...sessions.values()].some(u => u.username.toLowerCase() === nickname.toLowerCase())) return res.status(409).json({ error: 'Dieser Nickname ist bereits vergeben. Bitte registriere dich oder melde dich an.' });
  const token = crypto.randomUUID();
  const user = { id: token, username: nickname, avatar_url: null, created_at: new Date().toISOString(), gender: '', bio: '', relationship_status: '', location: '', social_private: true, social_visibility: 'private', likes: new Set(), following: new Set(), blockedUsers: new Set() };
  friendships.set(token, new Set()); friendRequests.set(token, []);
  sessions.set(token, user);
  savePersistentState();
  res.status(201).json({ token, user: publicUser(user) });
});
app.post('/api/auth/logout', auth, (req,res) => { const token=String(req.headers.authorization||'').replace(/^Bearer /,''); sessions.delete(token); savePersistentState(); res.json({ ok: true }); });
app.get('/api/me', auth, (req,res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/me/profile', auth, (req, res) => {
  const gender = String(req.body.gender || '').trim();
  const relationship = String(req.body.relationship_status || '').trim();
  const bio = String(req.body.bio || '').trim();
  const location = String(req.body.location || '').trim();
  if (!['', 'Mann', 'Frau', 'Divers'].includes(gender)) return res.status(400).json({ error: 'Bitte eine gültige Geschlechtsoption wählen.' });
  if (!['', 'Single', 'In einer Beziehung', 'Verheiratet', 'Es ist kompliziert', 'Keine Angabe'].includes(relationship)) return res.status(400).json({ error: 'Bitte einen gültigen Beziehungsstatus wählen.' });
  req.user.gender = gender; req.user.relationship_status = relationship; req.user.bio = bio.slice(0, 300); req.user.location = location.slice(0, 80);
  if (['public','friends','private'].includes(req.body.social_visibility)) { req.user.social_visibility = req.body.social_visibility; req.user.social_private = req.body.social_visibility !== 'public'; } else if (typeof req.body.social_private === 'boolean') { req.user.social_private = req.body.social_private; req.user.social_visibility = req.body.social_private ? 'private' : 'public'; }
  savePersistentState();
  res.json({ user: publicUser(req.user) });
});
app.get('/api/members', auth, (req,res) => {
  const members = [...sessions.values()]
    .filter(user => user.id !== req.user.id && !isBlockedBetween(req.user, user.id))
    .map(user => publicUser(user));
  res.json({ members });
});
// Search active GameTik accounts by @username (case-insensitive).
app.get('/api/users/search', auth, (req, res) => {
  const query = String(req.query.q || '').trim().replace(/^@+/, '').toLowerCase().slice(0, 40);
  if (!query) return res.json({ users: [] });
  const users = [...sessions.values()]
    .filter(user => user.id !== String(req.user.id) && !isBlockedBetween(req.user, user.id) && user.username.toLowerCase().includes(query))
    .slice(0, 20)
    .map(user => ({ ...publicUser(user), following: req.user.following.has(String(user.id)), friend: friendships.get(String(req.user.id))?.has(String(user.id)) || false }));
  res.json({ users });
});
// Public profile endpoint for opening another member from search, feed, followers, or messages.
app.get('/api/users/:id/profile', (req, res) => {
  const targetId = String(req.params.id || '');
  const target = [...sessions.values()].find(user => String(user.id) === targetId);
  if (!target) return res.status(404).json({ error: 'Dieses Profil ist momentan nicht verfügbar.' });
  const viewer = getSession(req);
  if (viewer && isBlockedBetween(viewer, targetId)) return res.status(404).json({ error: 'Dieses Profil ist nicht verfügbar.' });
  const visibility = ['public','friends','private'].includes(target.social_visibility) ? target.social_visibility : (target.social_private === false ? 'public' : 'private');
  const isSelf = Boolean(viewer && String(viewer.id) === targetId);
  const isFollowing = Boolean(viewer && viewer.following?.has(targetId));
  const isFriend = Boolean(viewer && friendships.get(String(viewer.id))?.has(targetId));
  const canSeePosts = isSelf || visibility === 'public' || (visibility === 'friends' && isFriend);
  const profile = { ...publicUser(target), following: isFollowing, friend: isFriend };
  const posts = videos.filter(v => String(v.user_id) === targetId && canSeePosts && (isSelf || v.visibility !== 'private'))
    .slice().reverse().map(v => ({ id: v.id, username: v.username, user_id: v.user_id, avatar_url: target.avatar_url || null,
      video_url: v.video_url || null, media_type: v.media_type || 'video', caption: v.caption || '', created_at: v.created_at,
      like_count: v.likes?.size || 0, comment_count: v.comments?.length || 0, music_url: v.music_url || null }));
  res.json({ user: profile, posts, is_self: isSelf, following: isFollowing, friend: isFriend });
});
app.get('/api/me/social', auth, (req, res) => {
  const meId = String(req.user.id);
  const followers = [...sessions.values()].filter(user => user.id !== meId && user.following?.has(meId) && !isBlockedBetween(req.user, user.id)).map(publicUser);
  const following = [...req.user.following].map(id => sessions.get(String(id))).filter(user => user && !isBlockedBetween(req.user, user.id)).map(publicUser);
  const friends = [...(friendships.get(meId) || new Set())].map(id => sessions.get(String(id))).filter(user => user && !isBlockedBetween(req.user, user.id)).map(publicUser);
  const requests = (friendRequests.get(meId) || []).map(r => ({ ...r, user: sessions.get(String(r.fromId)) })).filter(r => r.user && !isBlockedBetween(req.user, r.fromId)).map(r => ({ id: r.id, created_at: r.created_at, user: publicUser(r.user) }));
  res.json({ followers, following, friends, requests, request_count: requests.length });
});
app.get('/api/users/:id/social', auth, (req, res) => {
  const targetId = String(req.params.id), target = sessions.get(targetId);
  if (!target) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  if (isBlockedBetween(req.user, targetId)) return res.status(403).json({ error: 'Dieser Bereich ist nicht verfügbar.' });
  const isSelf = String(req.user.id) === targetId;
  const isFriend = friendships.get(targetId)?.has(String(req.user.id)) || false;
  const visibility = ['public','friends','private'].includes(target.social_visibility) ? target.social_visibility : (target.social_private === false ? 'public' : 'private');
  if (!isSelf && (visibility === 'private' || (visibility === 'friends' && !isFriend))) return res.status(403).json({ error: visibility === 'private' ? 'Dieser Nutzer hat seine Freundes- und Folgenlisten für alle verborgen.' : 'Diese Listen sind nur für bestätigte Freunde sichtbar.' });
  const followers = [...sessions.values()].filter(u => u.id !== targetId && u.following?.has(targetId) && !isBlockedBetween(req.user, u.id)).map(publicUser);
  const following = [...(target.following || new Set())].map(id => sessions.get(String(id))).filter(u => u && !isBlockedBetween(req.user, u.id)).map(publicUser);
  const friends = [...(friendships.get(targetId) || new Set())].map(id => sessions.get(String(id))).filter(u => u && !isBlockedBetween(req.user, u.id)).map(publicUser);
  res.json({ followers, following, friends, private: visibility !== 'public', visibility });
});
app.post('/api/users/:id/friend-request', auth, (req, res) => {
  const targetId = String(req.params.id), meId = String(req.user.id);
  if (targetId === meId) return res.status(400).json({ error: 'Du kannst dir selbst keine Freundschaftsanfrage senden.' });
  if (!sessions.has(targetId)) return res.status(404).json({ error: 'Dieser Nutzer ist momentan nicht verfügbar.' });
  if (isBlockedBetween(req.user, targetId)) return res.status(403).json({ error: 'Wegen einer Blockierung nicht möglich.' });
  if (friendships.get(meId)?.has(targetId)) return res.status(409).json({ error: 'Ihr seid bereits befreundet.' });
  const list = friendRequests.get(targetId) || [];
  if (list.some(r => String(r.fromId) === meId)) return res.status(409).json({ error: 'Anfrage wurde bereits gesendet.' });
  if ((friendRequests.get(meId) || []).some(r => String(r.fromId) === targetId)) return res.status(409).json({ error: 'Dieser Nutzer hat dir bereits eine Anfrage gesendet. Öffne deine Anfragen.' });
  list.push({ id: crypto.randomUUID(), fromId: meId, created_at: new Date().toISOString() });
  friendRequests.set(targetId, list);
  res.status(201).json({ ok: true, pending: true });
});
app.post('/api/friend-requests/:id/accept', auth, (req, res) => {
  const meId = String(req.user.id), requestId = String(req.params.id), list = friendRequests.get(meId) || [];
  const index = list.findIndex(r => r.id === requestId);
  if (index < 0) return res.status(404).json({ error: 'Freundschaftsanfrage nicht gefunden.' });
  const request = list[index], fromId = String(request.fromId);
  if (!sessions.has(fromId) || isBlockedBetween(req.user, fromId)) { list.splice(index, 1); return res.status(404).json({ error: 'Nutzer nicht mehr verfügbar.' }); }
  const mine = friendships.get(meId) || new Set(), theirs = friendships.get(fromId) || new Set();
  mine.add(fromId); theirs.add(meId); friendships.set(meId, mine); friendships.set(fromId, theirs);
  list.splice(index, 1); friendRequests.set(meId, list);
  res.json({ ok: true, friend: publicUser(sessions.get(fromId)) });
});
app.delete('/api/friend-requests/:id', auth, (req, res) => {
  const meId = String(req.user.id), list = friendRequests.get(meId) || [], index = list.findIndex(r => r.id === String(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Freundschaftsanfrage nicht gefunden.' });
  list.splice(index, 1); friendRequests.set(meId, list); res.json({ ok: true });
});

app.get('/api/messages/:userId', auth, (req,res) => {
  const otherId = String(req.params.userId);
  if (otherId === req.user.id) return res.status(400).json({ error: 'Du kannst dir selbst keine Nachricht schicken.' });
  if (!sessions.has(otherId)) return res.status(404).json({ error: 'Dieser Nutzer ist momentan nicht verfügbar.' });
  const messages = privateMessages.filter(m =>
    (m.fromId === req.user.id && m.toId === otherId) ||
    (m.fromId === otherId && m.toId === req.user.id)
  ).slice(-100);
  res.json({ messages });
});
app.post('/api/me/avatar', auth, (req,res,next) => avatarUpload.single('avatar')(req,res,async err => {
  if (err) return next(err);
  if (!req.file) return res.status(400).json({ error: 'Bitte ein Profilbild auswählen.' });
  if (!r2Ready || !r2) return res.status(503).json({ error: 'Cloudflare R2 ist nicht vollständig eingerichtet. Prüfe R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME und R2_PUBLIC_URL in Render.' });
  try {
    const ext = safeExtension(req.file.mimetype, req.file.originalname) || '.img';
    const key = `avatars/${String(req.user.id).replace(/[^a-zA-Z0-9_-]/g, '')}/${crypto.randomUUID()}${ext}`;
    await r2.send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype, CacheControl: 'public, max-age=31536000, immutable' }));
    req.user.avatar_url = `${r2PublicUrl}/${key}`;
    // Keep the avatar URL on the canonical account record as well as the session.
    // This lets a fresh session recover the same R2 image after a restart or re-login.
    const accountEntry = [...accounts.entries()].find(([, account]) => String(account.id) === String(req.user.id));
    if (accountEntry) {
      accountEntry[1].avatar_url = req.user.avatar_url;
      accountEntry[1].created_at = accountEntry[1].created_at || req.user.created_at;
      accounts.set(accountEntry[0], accountEntry[1]);
    }
    try {
      await savePersistentState();
    } catch (dbError) {
      console.error('Avatar URL could not be committed to PostgreSQL:', dbError.message);
      return res.status(503).json({ error: 'Das Bild wurde hochgeladen, aber die Verknüpfung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.' });
    }
    res.json({ user: publicUser(req.user) });
  } catch (uploadError) {
    console.error('Cloudflare R2 avatar upload failed:', uploadError.name || uploadError.message);
    res.status(502).json({ error: 'Profilbild konnte nicht in Cloudflare R2 gespeichert werden. Prüfe Bucket, Schlüssel, öffentliche URL und Berechtigungen.' });
  }
}));
app.get('/api/stories', (req, res) => {
  purgeExpiredStories();
  const viewer = getSession(req);
  res.json({ stories: stories.slice().reverse().filter(story => !isBlockedBetween(viewer, story.user_id)).map(story => ({ ...story, following: viewer ? viewer.following.has(String(story.user_id)) : false, remaining_ms: Math.max(0, Date.parse(story.expires_at) - Date.now()) })) });
});
app.post('/api/stories', auth, (req, res, next) => storyUpload.single('media')(req, res, err => {
  if (err) return next(err);
  const type = String(req.body.type || '').toLowerCase();
  const caption = String(req.body.caption || '').trim().slice(0, 300);
  const rejectStory = (message) => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: message });
  };
  if (!['photo', 'video', 'text'].includes(type)) return rejectStory('Bitte Foto, Video oder Text auswählen.');
  if (type === 'text' && !caption) return rejectStory('Bitte einen Text für deine Story eingeben.');
  if (type !== 'text' && !req.file) return res.status(400).json({ error: 'Bitte eine Foto- oder Videodatei auswählen.' });
  if (type === 'photo' && !req.file.mimetype.startsWith('image/')) return rejectStory('Für eine Foto-Story bitte ein Bild auswählen.');
  if (type === 'video' && !req.file.mimetype.startsWith('video/')) return rejectStory('Für eine Video-Story bitte ein Video auswählen.');
  const created = new Date();
  const story = {
    id: nextStoryId++, user_id: req.user.id, username: req.user.username,
    avatar_url: req.user.avatar_url || null, type, caption,
    media_url: req.file ? '/uploads/videos/' + req.file.filename : null,
    created_at: created.toISOString(), expires_at: new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
  stories.push(story);
  savePersistentState();
  res.status(201).json({ story });
}));
app.delete('/api/stories/:id', auth, (req, res) => {
  purgeExpiredStories();
  const idx = stories.findIndex(story => story.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Story nicht gefunden oder abgelaufen.' });
  if (stories[idx].user_id !== req.user.id) return res.status(403).json({ error: 'Du kannst nur deine eigenen Storys löschen.' });
  const story = stories[idx];
  stories.splice(idx, 1);
  if (story.media_url && story.media_url.startsWith('/uploads/videos/')) fs.unlink(path.join(videoDir, path.basename(story.media_url)), () => {});
  res.json({ ok: true });
});

app.get('/api/videos', (req,res) => {
  const viewer = getSession(req);
  res.json({ videos: videos.slice().reverse().filter(v => (v.visibility !== 'private' || (viewer && viewer.id === v.user_id)) && !isBlockedBetween(viewer, v.user_id)).map(v => ({
    ...v,
    user_id: v.user_id,
    like_count: v.likes.size,
    comment_count: v.comments.length,
    reactions: Object.fromEntries(Object.entries(v.reactions || {}).map(([k,set])=>[k,set.size])), rating_average: v.ratings?.length ? Math.round(v.ratings.reduce((a,r)=>a+r.score,0)/v.ratings.length*10)/10 : 0, rating_count: v.ratings?.length || 0,
    following: viewer ? viewer.following.has(v.user_id) : false,
    liked: viewer ? viewer.likes.has(v.id) : false
  })) });
});
app.post('/api/videos', auth, (req,res,next) => postUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'music', maxCount: 1 }, { name: 'document', maxCount: 1 }])(req,res,err => {
  if (err) return next(err);
  const mediaFile = req.files?.video?.[0];
  const musicFile = req.files?.music?.[0];
  const documentFile = req.files?.document?.[0];
  if (!mediaFile && !documentFile) return res.status(400).json({ error: 'Bitte ein Foto, Video oder Dokument auswählen.' });
  const isPhoto = !!mediaFile && mediaFile.mimetype.startsWith('image/');
  const video = {
    id: nextVideoId++, user_id: req.user.id, username: req.user.username,
    avatar_url: req.user.avatar_url || null,
    video_url: mediaFile ? '/uploads/videos/' + mediaFile.filename : null,
    media_type: mediaFile ? (isPhoto ? 'photo' : 'video') : 'document',
    document_url: documentFile ? '/uploads/videos/' + documentFile.filename : null,
    document_name: documentFile ? String(documentFile.originalname || 'Anhang').replace(/[\r\n]/g, '').slice(0,180) : null,
    music_url: musicFile ? '/uploads/videos/' + musicFile.filename : null,
    music_original_name: musicFile ? String(musicFile.originalname || 'Eigene Musik').slice(0,120) : null,
    caption: String(req.body.caption || '').trim().slice(0,500),
    hashtags: String(req.body.hashtags || '').split(/\s+/).map(tag => tag.trim()).filter(tag => /^#[\p{L}\p{N}_]{1,40}$/u.test(tag)).slice(0,10),
    visibility: String(req.body.visibility || 'public') === 'private' ? 'private' : 'public',
    created_at: new Date().toISOString(), likes: new Set(), comments: [], reactions: {}, ratings: []
  };
  videos.push(video);
  savePersistentState();
  res.status(201).json({ video: { ...video, likes: undefined, comments: undefined, like_count: 0, comment_count: 0 } });
}));
app.delete('/api/videos/:id', auth, (req,res) => {
  const idx = videos.findIndex(v => v.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  if (videos[idx].user_id !== req.user.id) return res.status(403).json({ error: 'Du kannst nur deine eigenen Beiträge löschen.' });
  const [item] = videos.splice(idx, 1);
  if (item.video_url && item.video_url.startsWith('/uploads/videos/')) fs.unlink(path.join(videoDir, path.basename(item.video_url)), () => {});
  if (item.document_url && item.document_url.startsWith('/uploads/videos/')) fs.unlink(path.join(videoDir, path.basename(item.document_url)), () => {});
  if (item.music_url && item.music_url.startsWith('/uploads/videos/')) fs.unlink(path.join(videoDir, path.basename(item.music_url)), () => {});
  res.json({ ok: true });
});
app.post('/api/videos/:id/reaction', auth, (req,res) => {
  const video = videos.find(v => v.id === Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  const type = String(req.body.type || '');
  if (!['heart','like','love','dislike'].includes(type)) return res.status(400).json({ error: 'Ungültige Reaktion.' });
  if (!video.reactions) video.reactions = {};
  if (!video.reactions[type]) video.reactions[type] = new Set();
  const set = video.reactions[type];
  if (set.has(req.user.id)) set.delete(req.user.id); else set.add(req.user.id);
  res.json({ counts: Object.fromEntries(Object.entries(video.reactions).map(([k,v])=>[k,v.size])), selected: set.has(req.user.id) });
});
app.post('/api/videos/:id/rating', auth, (req,res) => {
  const video = videos.find(v => v.id === Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Beitrag nicht gefunden.' });
  const score = Number(req.body.score);
  if (!Number.isInteger(score) || score < 1 || score > 10) return res.status(400).json({ error: 'Bewertung muss zwischen 1 und 10 liegen.' });
  if (!video.ratings) video.ratings = [];
  const previous = video.ratings.find(r => r.user_id === req.user.id);
  if (previous) previous.score = score; else video.ratings.push({user_id:req.user.id,score});
  res.json({ average: Math.round(video.ratings.reduce((a,r)=>a+r.score,0)/video.ratings.length*10)/10, count: video.ratings.length });
});
app.post('/api/videos/:id/like', auth, (req,res) => {
  const video = videos.find(v => v.id === Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Video nicht gefunden.' });
  if (req.user.likes.has(video.id)) { req.user.likes.delete(video.id); video.likes.delete(req.user.id); }
  else { req.user.likes.add(video.id); video.likes.add(req.user.id); }
  res.json({ liked: req.user.likes.has(video.id), like_count: video.likes.size });
});
app.get('/api/videos/:id/comments', (req,res) => {
  const video = videos.find(v => v.id === Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Video nicht gefunden.' });
  res.json({ comments: video.comments });
});
app.post('/api/videos/:id/comments', auth, (req,res) => {
  const video = videos.find(v => v.id === Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Video nicht gefunden.' });
  const body = String(req.body.body || '').trim().slice(0,500);
  if (!body) return res.status(400).json({ error: 'Kommentar darf nicht leer sein.' });
  const comment = { id: nextCommentId++, username: req.user.username, body, created_at: new Date().toISOString() };
  video.comments.push(comment);
  res.status(201).json({ comment });
});
app.post('/api/users/:id/block', auth, (req,res) => {
  const targetId = String(req.params.id);
  if (targetId === String(req.user.id)) return res.status(400).json({ error: 'Du kannst dich nicht selbst blockieren.' });
  if (!sessions.has(targetId)) return res.status(404).json({ error: 'Dieser Nutzer ist momentan nicht verfügbar.' });
  if (!req.user.blockedUsers) req.user.blockedUsers = new Set();
  const blocked = req.user.blockedUsers.has(targetId);
  if (blocked) req.user.blockedUsers.delete(targetId); else req.user.blockedUsers.add(targetId);
  req.user.following?.delete(targetId);
  sessions.get(targetId)?.following?.delete(String(req.user.id));
  res.json({ blocked: !blocked });
});
app.post('/api/users/:id/follow', auth, (req,res) => {
  const targetId = String(req.params.id);
  if (targetId === String(req.user.id)) return res.status(400).json({ error: 'Du kannst dir nicht selbst folgen.' });
  if (isBlockedBetween(req.user, targetId)) return res.status(403).json({ error: 'Folgen ist wegen einer Blockierung nicht möglich.' });
  if (!sessions.has(targetId)) return res.status(404).json({ error: 'Dieser Nutzer ist momentan nicht verfügbar.' });
  const isFollowing = req.user.following.has(targetId);
  if (isFollowing) req.user.following.delete(targetId); else req.user.following.add(targetId);
  res.json({ following: !isFollowing });
});
app.post('/api/gifts', auth, (req,res) => {
  const gift = String(req.body.gift || '').slice(0,40);
  if (!gift) return res.status(400).json({ error: 'Geschenk fehlt.' });
  const record = { id: crypto.randomUUID(), username: req.user.username, videoId: req.body.videoId || null, gift, created_at: new Date().toISOString() };
  gifts.push(record);
  res.status(201).json({ gift: record, note: 'Demo-Geschenk gespeichert; keine Zahlung ausgelöst.' });
});
app.get('/api/gifts/inventory', auth, asyncRoute(async (req, res) => {
  const userId = String(req.user.id);
  const inventory = giftInventory.get(userId) || {};
  // One-time recovery for standalone purchases recorded by the older version before inventory existed.
  if (!giftInventoryMigrated.has(userId)) {
    for (const record of gifts) {
      if (record && record.username === req.user.username && record.paymentId && !record.liveRoomId && !record.inventorySend && record.gift && record.gift !== 'Spende') {
        inventory[record.gift] = Math.max(0, Number(inventory[record.gift]) || 0) + 1;
      }
    }
    giftInventory.set(userId, inventory);
    giftInventoryMigrated.add(userId);
    await savePersistentState();
  }
  // Recover completed legacy purchases made from inside LIVE. Older code emitted these
  // immediately and skipped the inventory; credit each recorded payment only once.
  // The user can now send the recovered item later from inventory without paying again.
  let recoveredAny = false;
  for (const record of gifts) {
    const paymentId = String(record?.paymentId || '').trim();
    if (!paymentId || record.username !== req.user.username || !record.liveRoomId || record.inventorySend || !['Herz', 'Krone'].includes(record.gift) || giftInventoryRecoveredPaymentIds.has(paymentId)) continue;
    inventory[record.gift] = Math.max(0, Number(inventory[record.gift]) || 0) + 1;
    giftInventoryRecoveredPaymentIds.add(paymentId);
    recoveredAny = true;
  }
  if (recoveredAny) {
    giftInventory.set(userId, inventory);
    await savePersistentState();
  }
  res.json({ inventory: Object.fromEntries(Object.entries(inventory).map(([name,count]) => [name, Math.max(0, Number(count)||0)]).filter(([,count]) => count > 0)) });
}));
app.post('/api/gifts/inventory/send', auth, asyncRoute(async (req, res) => {
  const giftName = String(req.body.gift || '').trim();
  const roomId = String(req.body.liveRoomId || '').trim();
  const room = liveRooms.get(roomId);
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Bitte wähle einen aktuell aktiven Live-Stream.' });
  if (!giftName || giftName === 'Spende') return res.status(400).json({ error: 'Dieses Geschenk kann nicht aus dem Inventar versendet werden.' });
  const inventory = giftInventory.get(String(req.user.id)) || {};
  const available = Math.max(0, Number(inventory[giftName]) || 0);
  if (available < 1) return res.status(409).json({ error: 'Dieses Geschenk ist nicht in deinem Inventar vorhanden. Bitte kaufe es zuerst.' });
  inventory[giftName] = available - 1;
  if (inventory[giftName] <= 0) delete inventory[giftName];
  giftInventory.set(String(req.user.id), inventory);
  const giftRecord = { id: crypto.randomUUID(), senderId: String(req.user.id), username: req.user.username, gift: giftName, liveRoomId: roomId, recipientId: String(room.hostId), recipientUsername: String(room.hostUsername || ''), inventorySend: true, created_at: new Date().toISOString() };
  gifts.push(giftRecord);
  // Split the gift's listed value only when it is sent to another user's stream.
  // Self-gifting remains allowed, but never creates withdrawable earnings.
  const giftPriceCents = ({ Herz: 99, Stern: 199, Feuer: 299, Krone: 499 })[giftName] || 0;
  if (String(req.user.id) !== String(room.hostId) && giftPriceCents > 0 && !processedGiftEarnings.has(giftRecord.id)) {
    const platformCents = Math.floor(giftPriceCents * 70 / 100);
    const creatorCents = giftPriceCents - platformCents;
    const creatorId = String(room.hostId);
    creatorBalancesCents.set(creatorId, Math.max(0, Number(creatorBalancesCents.get(creatorId) || 0)) + creatorCents);
    walletTransactions.push({ id: crypto.randomUUID(), type: 'gift_earned', userId: creatorId, amountCents: creatorCents, grossCents: giftPriceCents, platformCents, gift: giftName, giftId: giftRecord.id, fromUsername: req.user.username, created_at: giftRecord.created_at, note: '30 % Creator-Anteil; 70 % Plattform-Anteil vor Zahlungsgebühren.' });
    processedGiftEarnings.add(giftRecord.id);
    await savePersistentState();
  } else if (String(req.user.id) === String(room.hostId)) {
    walletTransactions.push({ id: crypto.randomUUID(), type: 'self_gift', userId: String(req.user.id), amountCents: 0, gift: giftName, giftId: giftRecord.id, created_at: giftRecord.created_at, note: 'Selbstgeschenk: erlaubt, erzeugt kein auszahlbares Guthaben.' });
  }
  const giftPoints = ({ Herz: 99, Stern: 199, Feuer: 299, Krone: 499 })[giftName] || 0;
  if (room.game?.active && giftPoints > 0 && Date.now() < room.game.endsAt) {
    room.game.hostPoints = Math.min(1000000000, Number(room.game.hostPoints || 0) + giftPoints);
    io.to('live:' + roomId).emit('live:game-state', { roomId, game: room.game });
  }
  io.to('live:' + roomId).emit('live:gift', { roomId, username: req.user.username, gift: giftName, points: giftPoints, inventorySend: true, created_at: giftRecord.created_at });
  await savePersistentState();
  res.json({ ok: true, gift: giftName, remaining: Math.max(0, Number(inventory[giftName]) || 0), inventory: Object.fromEntries(Object.entries(inventory).filter(([,count]) => Number(count) > 0)) });
}));
app.get('/api/wallet', auth, (req, res) => {
  const userId = String(req.user.id);
  const priceCents = ({ Herz: 99, Stern: 199, Feuer: 299, Krone: 499 });
  // Include verified legacy PayPal purchases and later inventory sends in the wallet activity.
  // Purchases are shown as spending/history, never as withdrawable creator earnings.
  const paidGiftTransactions = gifts
    .filter(g => g && g.username === req.user.username && g.paymentId && Object.prototype.hasOwnProperty.call(priceCents, g.gift))
    .map(g => ({ id: `purchase-${g.paymentId}`, type: 'gift_purchased', userId, amountCents: priceCents[g.gift], gift: g.gift, paymentId: g.paymentId, created_at: g.created_at || new Date().toISOString(), note: 'Bezahlter Geschenkkauf; kein auszahlbares Guthaben.' }));
  const sentGiftTransactions = gifts
    .filter(g => g && String(g.senderId || '') === userId && g.inventorySend)
    .map(g => ({ id: `sent-${g.id}`, type: 'gift_sent', userId, amountCents: priceCents[g.gift] || 0, gift: g.gift, created_at: g.created_at || new Date().toISOString(), note: String(g.recipientId || '') === userId ? 'Selbstgeschenk versendet; erzeugt kein auszahlbares Guthaben.' : 'Geschenk aus dem Inventar versendet; kein erneuter Kauf.' }));
  const ledger = walletTransactions.filter(t => String(t.userId) === userId);
  const knownIds = new Set(ledger.map(t => String(t.id)));
  const activity = [...ledger, ...paidGiftTransactions.filter(t => !knownIds.has(String(t.id))), ...sentGiftTransactions.filter(t => !knownIds.has(String(t.id)))];
  const transactions = activity.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0,100);
  const purchasedGiftTotalCents = paidGiftTransactions.reduce((sum, t) => sum + (Number(t.amountCents) || 0), 0);
  const requests = payoutRequests.filter(p => String(p.userId) === userId).slice(-50).reverse();
  res.json({ currency: 'EUR', balanceCents: Math.max(0, Number(creatorBalancesCents.get(userId) || 0)), purchasedGiftTotalCents, transactions, payoutRequests: requests, payoutEnabled: String(process.env.PAYPAL_PAYOUTS_ENABLED || '').toLowerCase() === 'true', payoutNote: 'Auszahlungsanfragen werden erst nach Einrichtung und Freigabe von PayPal Payouts tatsächlich ausgezahlt.' });
});
app.post('/api/wallet/payout-request', auth, asyncRoute(async (req, res) => {
  const userId = String(req.user.id);
  const email = String(req.body.paypalEmail || '').trim().toLowerCase();
  const amountCents = Math.round(Number(req.body.amount) * 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Bitte eine gültige PayPal-E-Mail-Adresse eingeben.' });
  if (!Number.isSafeInteger(amountCents) || amountCents < 500) return res.status(400).json({ error: 'Die Mindestauszahlung beträgt 5,00 €.' });
  const balance = Math.max(0, Number(creatorBalancesCents.get(userId) || 0));
  if (amountCents > balance) return res.status(409).json({ error: 'Dein verfügbares Guthaben reicht für diese Auszahlung nicht aus.' });
  creatorBalancesCents.set(userId, balance - amountCents);
  const request = { id: crypto.randomUUID(), userId, username: req.user.username, paypalEmail: email, amountCents, status: 'pending', created_at: new Date().toISOString(), note: 'Anfrage gespeichert; noch keine PayPal-Zahlung ausgeführt.' };
  payoutRequests.push(request);
  walletTransactions.push({ id: crypto.randomUUID(), type: 'payout_requested', userId, amountCents: -amountCents, payoutRequestId: request.id, created_at: request.created_at, note: 'Betrag für ausstehende Auszahlung reserviert.' });
  await savePersistentState();
  res.status(201).json({ ok: true, request: { id: request.id, amountCents, status: request.status, created_at: request.created_at }, balanceCents: balance - amountCents, message: 'Auszahlungsanfrage gespeichert. Dies ist noch keine ausgeführte PayPal-Auszahlung.' });
}));
// PayPal Orders API. Secrets are read only from server environment variables.
function paypalBaseUrl() {
  return String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase() === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}
async function paypalRequest(endpoint, options = {}) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error('PayPal ist noch nicht eingerichtet. Bitte Client ID und Secret in Render eintragen.');
    error.status = 503;
    throw error;
  }

  const tokenResponse = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error('PayPal OAuth failed with status:', tokenResponse.status);
    const error = new Error('PayPal konnte den Server nicht authentifizieren. Bitte Sandbox-Zugangsdaten prüfen.');
    error.status = 502;
    throw error;
  }

  const response = await fetch(`${paypalBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('PayPal API request failed with status:', response.status);
    const error = new Error('PayPal konnte die Anfrage nicht verarbeiten. Bitte Zugangsdaten und Konto prüfen.');
    error.status = 502;
    throw error;
  }
  return data;
}

function appBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (configured && /^https:\/\/[^/]+$/i.test(configured)) return configured;
  // Render sits behind a proxy; honor its forwarded HTTPS protocol when no explicit URL is set.
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get('host')}`;
}

const giftCatalog = Object.freeze({
  Herz: { price: '0.99', label: 'Virtuelles Geschenk: Herz' },
  Stern: { price: '1.99', label: 'Virtuelles Geschenk: Stern' },
  Feuer: { price: '2.99', label: 'Virtuelles Geschenk: Feuer' },
  Krone: { price: '4.99', label: 'Virtuelles Geschenk: Krone' },
  Spende: { price: '5.00', label: 'Freiwillige GameTik-Spende' }
});

app.post('/api/payments/paypal/create-order', auth, asyncRoute(async (req, res) => {
  const giftName = String(req.body.gift || '').trim();
  const liveRoomId = req.body.liveRoomId == null ? null : String(req.body.liveRoomId);
  if (liveRoomId) { const liveRoom = liveRooms.get(liveRoomId); if (!liveRoom || liveRoom.status !== 'live') return res.status(404).json({ error: 'Der Live-Stream ist nicht mehr aktiv.' }); }
  const premiumMatch = /^GAMETIK-GIFT-(\d{1,4})$/.exec(giftName);
  const premiumPrice = premiumMatch ? Number(premiumMatch[1]) : 0;
  const product = giftCatalog[giftName] || (premiumPrice >= 5 && premiumPrice <= 1000 && premiumPrice % 5 === 0 ? { price: premiumPrice.toFixed(2), label: `GAMETIK 3D-Premium-Geschenk · ${premiumPrice} EUR` } : null);
  if (!product) return res.status(400).json({ error: 'Bitte ein gültiges Geschenk auswählen.' });

  const currency = String(process.env.PAYPAL_CURRENCY || 'EUR').toUpperCase();
  if (currency !== 'EUR') return res.status(500).json({ error: 'GAMETIK unterstützt für diese Geschenke derzeit nur EUR.' });

  const base = appBaseUrl(req);
  const order = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': crypto.randomUUID() },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: String(req.user.id),
        description: product.label,
        amount: { currency_code: currency, value: product.price }
      }],
      application_context: {
        brand_name: 'GAMETIK',
        user_action: 'PAY_NOW',
        return_url: `${base}/?paypal=success`,
        cancel_url: `${base}/?paypal=cancel`
      }
    })
  });

  const approvalUrl = (order.links || []).find(link => link.rel === 'approve')?.href;
  if (!order.id || !approvalUrl) {
    const error = new Error('PayPal hat keinen gültigen Freigabe-Link zurückgegeben.');
    error.status = 502;
    throw error;
  }

  paypalOrders.set(order.id, {
    userId: String(req.user.id),
    gift: giftName,
    videoId: req.body.videoId == null ? null : String(req.body.videoId),
    liveRoomId,
    price: product.price,
    currency,
    captured: false,
    createdAt: Date.now()
  });

  // Keep demo memory bounded.
  if (paypalOrders.size > 1000) {
    const oldest = paypalOrders.keys().next().value;
    paypalOrders.delete(oldest);
  }

  res.status(201).json({ orderID: order.id, approvalUrl });
}));

app.post('/api/payments/paypal/capture-order', auth, asyncRoute(async (req, res) => {
  const orderId = String(req.body.orderID || req.body.orderId || '').trim();
  if (!orderId || orderId.length > 100) return res.status(400).json({ error: 'Ungültige PayPal-Bestellnummer.' });

  const saved = paypalOrders.get(orderId);
  if (!saved || saved.userId !== String(req.user.id)) {
    return res.status(404).json({ error: 'PayPal-Bestellung nicht gefunden oder gehört zu einem anderen Nutzer.' });
  }
  if (saved.captured) return res.status(409).json({ error: 'Diese Bestellung wurde bereits verarbeitet.' });

  // Confirm approval, user, amount and currency with PayPal before capture.
  const current = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
  const unit = current.purchase_units?.[0];
  if (
    current.status !== 'APPROVED' ||
    unit?.custom_id !== String(req.user.id) ||
    unit?.amount?.value !== saved.price ||
    unit?.amount?.currency_code !== saved.currency
  ) {
    return res.status(400).json({ error: 'PayPal-Bestellung ist nicht freigegeben oder die Bestelldaten stimmen nicht.' });
  }

  const captured = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `capture-${orderId}` },
    body: '{}'
  });
  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];

  if (
    captured.status !== 'COMPLETED' ||
    capture?.status !== 'COMPLETED' ||
    capture?.amount?.value !== saved.price ||
    capture?.amount?.currency_code !== saved.currency
  ) {
    return res.status(402).json({ error: 'PayPal hat die Zahlung nicht als erfolgreich abgeschlossen bestätigt.' });
  }

  // Store the gift only after PayPal confirms a completed capture.
  saved.captured = true;
  const giftRecord = {
    id: crypto.randomUUID(),
    username: req.user.username,
    videoId: saved.videoId,
    liveRoomId: saved.liveRoomId || null,
    gift: saved.gift,
    paymentId: capture.id,
    created_at: new Date().toISOString()
  };
  gifts.push(giftRecord);
  if (saved.gift !== 'Spende') {
    const inventory = giftInventory.get(String(req.user.id)) || {};
    inventory[saved.gift] = Math.max(0, Number(inventory[saved.gift]) || 0) + 1;
    giftInventory.set(String(req.user.id), inventory);
  }
  // Paid gifts are inventory items first, even if the checkout began in LIVE.
  // They are only broadcast to viewers when the user explicitly sends them from inventory.

  await savePersistentState();
  res.json({ ok: true, status: 'COMPLETED', gift: saved.gift, paymentId: capture.id, inventoryAdded: saved.gift !== 'Spende' });
}));
// Virtual candy wallet: free-only credits, no cash value, no purchase or cash-out.
function candyBalance(userId) { return Math.max(0, Number(candyBalances.get(String(userId)) || 0)); }
app.get('/api/candy/balance', auth, (req, res) => res.json({ balance: candyBalance(req.user.id), unit: 'Süßigkeiten', note: 'Virtuelle kostenlose Punkte ohne Geldwert.' }));
app.post('/api/candy/claim', auth, (req, res) => {
  const id = String(req.user.id), today = new Date().toISOString().slice(0,10);
  if (candyDailyClaims.get(id) === today) return res.status(429).json({ error: 'Deine täglichen kostenlosen Süßigkeiten hast du bereits abgeholt.', balance: candyBalance(id) });
  candyDailyClaims.set(id, today); candyBalances.set(id, candyBalance(id) + 10);
  res.json({ ok: true, awarded: 10, balance: candyBalance(id) });
});
app.post('/api/candy/spin', auth, (req, res) => {
  const id = String(req.user.id), now = Date.now(), last = Number(candySpinCooldowns.get(id) || 0);
  if (now - last < 8000) return res.status(429).json({ error: 'Bitte warte kurz vor dem nächsten Dreh.', balance: candyBalance(id), waitMs: 8000 - (now-last) });
  const freeSpins = Math.max(0, Number(candyFreeSpins.get(id) || 0));
  const balance = candyBalance(id);
  if (freeSpins <= 0 && balance < 1) return res.status(400).json({ error: 'Du brauchst 1 kostenlose Süßigkeit pro Runde. Hole zuerst deine Gratis-Süßigkeiten ab.', balance, freeSpins });
  candySpinCooldowns.set(id, now);
  if (freeSpins > 0) candyFreeSpins.set(id, freeSpins - 1);
  else candyBalances.set(id, balance - 1);
  // Five reels × three rows. GameTik logo scatters anywhere; 3+ award 10 free spins.
  const symbols = ['🥷','⚔️','🔷','🤖','🛡️','👾','⚡'];
  const grid = Array.from({length:15}, () => symbols[Math.floor(Math.random()*symbols.length)]);
  const logoCount = Math.random() < 0.14 ? 3 + Math.floor(Math.random()*2) : (Math.random() < 0.1 ? 2 : 0);
  const positions = new Set();
  while (positions.size < logoCount) positions.add(Math.floor(Math.random()*15));
  positions.forEach(index => { grid[index] = 'GAMETIK'; });
  let reward = 0;
  if (logoCount >= 3) { candyFreeSpins.set(id, Math.min(100, Number(candyFreeSpins.get(id)||0) + 10)); }
  else {
    const counts = new Map(); grid.filter(x=>x!=='GAMETIK').forEach(x=>counts.set(x,(counts.get(x)||0)+1));
    const match = Math.max(0,...counts.values());
    if (match >= 5) reward = 5; else if (match >= 4) reward = 3; else if (match >= 3) reward = 1;
  }
  candyBalances.set(id, candyBalance(id) + reward);
  res.json({ ok: true, reward, balance: candyBalance(id), symbols: grid, logoCount, bonus: logoCount >= 3, freeSpins: Math.max(0,Number(candyFreeSpins.get(id)||0)), roundCost: freeSpins > 0 ? 0 : 1, note: 'Nur kostenlose virtuelle Süßigkeiten; kein Geldeinsatz und keine Auszahlung.' });
});
app.post('/api/candy/gift', auth, (req, res) => {
  const roomId = String(req.body.liveRoomId || ''), amount = Math.max(1, Math.min(20, Math.floor(Number(req.body.amount) || 1)));
  const room = liveRooms.get(roomId);
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser LIVE-Stream ist nicht aktiv.' });
  if (String(req.user.id) === room.hostId) return res.status(400).json({ error: 'Der Gastgeber kann sich selbst keine Süßigkeiten schicken.' });
  const id = String(req.user.id), balance = candyBalance(id);
  if (balance < amount) return res.status(400).json({ error: 'Nicht genug Süßigkeiten. Hole kostenlose Süßigkeiten oder spiele 🎰.', balance });
  candyBalances.set(id, balance - amount);
  if (room.game?.active && Date.now() < room.game.endsAt) {
    room.game.communityPoints = Math.min(1000000000, Number(room.game.communityPoints || 0) + amount);
    room.game.candyCount = Math.min(1000000000, Number(room.game.candyCount || 0) + amount);
    io.to('live:' + roomId).emit('live:game-state', { roomId, game: room.game });
  }
  io.to('live:' + roomId).emit('live:gift', { roomId, username: req.user.username, gift: 'Süßigkeiten 🍬 ×' + amount, points: amount, free: true, created_at: new Date().toISOString() });
  res.json({ ok: true, spent: amount, balance: candyBalance(id) });
});
app.get('/api/demo-stats', (_req,res) => res.json({ sessions: sessions.size, videos: videos.length, messages: chatMessages.length, gifts: gifts.length }));
app.get('/api/live/config', (_req, res) => res.json({ enabled: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET), provider: 'LiveKit', note: 'Live-Streams benötigen LiveKit-Zugangsdaten.' }));
function livekitConfigured() {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}
function livekitService() {
  const host = String(process.env.LIVEKIT_URL || '').replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  return new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}
function livePublic(room) {
  return { id: room.id, roomName: room.roomName, title: room.title, hostId: room.hostId, hostUsername: room.hostUsername, startedAt: room.startedAt, status: room.status, likes: Number(room.likes || 0), game: room.game || { active:false, endsAt:null, hostPoints:0, communityPoints:0, winner:null } };
}
app.get('/api/live', (_req, res) => {
  const active = [...liveRooms.values()].filter(room => room.status === 'live').map(livePublic).reverse();
  res.json({ streams: active, enabled: livekitConfigured() });
});
app.post('/api/live/create', auth, asyncRoute(async (req, res) => {
  if (!livekitConfigured()) return res.status(503).json({ error: 'Live ist noch nicht eingerichtet. LIVEKIT_URL, LIVEKIT_API_KEY und LIVEKIT_API_SECRET in Render konfigurieren.' });
  const existing = [...liveRooms.values()].find(room => room.hostId === String(req.user.id) && room.status === 'live');
  if (existing) return res.status(409).json({ error: 'Du hast bereits einen Live-Stream gestartet.', stream: livePublic(existing) });
  const title = String(req.body.title || '').trim().slice(0, 100) || `${req.user.username} ist live`;
  const id = crypto.randomUUID();
  const roomName = `gametik-${id.replace(/-/g, '')}`;
  const room = { id, roomName, title, hostId: String(req.user.id), hostUsername: req.user.username, startedAt: new Date().toISOString(), status: 'live', likes: 0, likedBy: new Set(), likePointsByViewer: new Map(), game: { active: false, endsAt: null, hostPoints: 0, communityPoints: 0, winner: null }, gameTimer: null };
  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: String(req.user.id), name: req.user.username, ttl: '1h' });
  access.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await access.toJwt();
  liveRooms.set(id, room);
  res.status(201).json({ stream: livePublic(room), serverUrl: process.env.LIVEKIT_URL, token, role: 'host' });
}));
// Public guest viewing: guests can watch without creating a GameTik account.
app.post('/api/live/:id/guest-join', asyncRoute(async (req, res) => {
  if (!livekitConfigured()) return res.status(503).json({ error: 'Live ist noch nicht eingerichtet. Bitte LiveKit-Zugangsdaten prüfen.' });
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht mehr verfügbar.' });
  const identity = 'guest-' + crypto.randomUUID();
  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name: 'Gast', ttl: '1h' });
  access.addGrant({ roomJoin: true, room: room.roomName, canPublish: false, canSubscribe: true, canPublishData: false });
  res.json({ stream: livePublic(room), serverUrl: process.env.LIVEKIT_URL, token: await access.toJwt(), role: 'guest', likes: room.likes || 0 });
}));
app.post('/api/live/:id/like', (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht mehr aktiv.' });
  // Jeder Tap wird als Like gezählt und live an alle Zuschauer verteilt.
  room.likes = Math.min(1000000000, Number(room.likes || 0) + 1);
  const token = String((req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  const signedInViewer = token ? sessions.get(token) : null;
  const suppliedViewerId = String(req.body?.viewerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  const viewerKey = signedInViewer ? 'user:' + String(signedInViewer.id) : (suppliedViewerId ? 'guest:' + suppliedViewerId : 'guest:anonymous');
  let pointsAwarded = 0;
  // Während eines aktiven Duells zählen die ersten zehn Likes je Zuschauer als je ein Punkt.
  if (room.game?.active && String(signedInViewer?.id || '') !== String(room.hostId)) {
    if (!(room.likePointsByViewer instanceof Map)) room.likePointsByViewer = new Map();
    const alreadyAwarded = Number(room.likePointsByViewer.get(viewerKey) || 0);
    if (alreadyAwarded < 10) {
      pointsAwarded = 1;
      room.likePointsByViewer.set(viewerKey, alreadyAwarded + 1);
      room.game.communityPoints = Number(room.game.communityPoints || 0) + 1;
      io.to('live:' + room.id).emit('live:game-state', { roomId: room.id, game: room.game });
    }
  }
  io.to('live:' + room.id).emit('live:like-count', { roomId: room.id, likes: room.likes });
  res.json({ ok: true, likes: room.likes, pointsAwarded, game: room.game });
});
app.post('/api/live/:id/join', auth, asyncRoute(async (req, res) => {
  if (!livekitConfigured()) return res.status(503).json({ error: 'Live ist noch nicht eingerichtet. Bitte LiveKit-Zugangsdaten in Render konfigurieren.' });
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht mehr verfügbar.' });
  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: String(req.user.id), name: req.user.username, ttl: '1h' });
  access.addGrant({ roomJoin: true, room: room.roomName, canPublish: false, canSubscribe: true, canPublishData: true });
  const token = await access.toJwt();
  res.json({ stream: livePublic(room), serverUrl: process.env.LIVEKIT_URL, token, role: 'viewer' });
}));
app.post('/api/live/:id/game/start', auth, (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht aktiv.' });
  if (room.hostId !== String(req.user.id)) return res.status(403).json({ error: 'Nur der Gastgeber kann das LIVE-Spiel starten.' });
  const seconds = Math.max(30, Math.min(600, Number(req.body.seconds) || 180));
  if (room.gameTimer) clearTimeout(room.gameTimer);
  room.likePointsByViewer = new Map();
  room.game = { active: true, endsAt: Date.now() + seconds * 1000, hostPoints: 0, communityPoints: 0, winner: null };
  io.to('live:' + room.id).emit('live:game-state', { roomId: room.id, game: room.game });
  room.gameTimer = setTimeout(() => {
    if (!room.game?.active) return;
    room.game.active = false;
    room.game.winner = room.game.hostPoints === room.game.communityPoints ? 'draw' : (room.game.hostPoints > room.game.communityPoints ? 'host' : 'community');
    room.gameTimer = null;
    io.to('live:' + room.id).emit('live:game-state', { roomId: room.id, game: room.game });
  }, seconds * 1000);
  if (room.gameTimer.unref) room.gameTimer.unref();
  res.json({ ok: true, game: room.game });
});
app.post('/api/live/:id/game/stop', auth, (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht aktiv.' });
  if (room.hostId !== String(req.user.id)) return res.status(403).json({ error: 'Nur der Gastgeber kann das LIVE-Spiel beenden.' });
  if (room.gameTimer) clearTimeout(room.gameTimer);
  room.gameTimer = null;
  if (room.game?.active) {
    room.game.active = false;
    room.game.winner = room.game.hostPoints === room.game.communityPoints ? 'draw' : (room.game.hostPoints > room.game.communityPoints ? 'host' : 'community');
  }
  io.to('live:' + room.id).emit('live:game-state', { roomId: room.id, game: room.game });
  res.json({ ok: true, game: room.game });
});

app.post('/api/live/:id/end', auth, asyncRoute(async (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room) return res.status(404).json({ error: 'Live-Stream nicht gefunden.' });
  if (room.hostId !== String(req.user.id)) return res.status(403).json({ error: 'Nur der Stream-Host kann den Stream beenden.' });
  if (room.status !== 'live') return res.json({ ok: true, alreadyEnded: true });

  // Change the app state first, so new viewers can no longer join this stream.
  room.status = 'ended';
  room.endedAt = new Date().toISOString();
  if (room.gameTimer) clearTimeout(room.gameTimer);
  room.gameTimer = null;
  if (room.game?.active) {
    room.game.active = false;
    room.game.winner = room.game.hostPoints === room.game.communityPoints ? 'draw' : (room.game.hostPoints > room.game.communityPoints ? 'host' : 'community');
    io.to('live:' + room.id).emit('live:game-state', { roomId: room.id, game: room.game });
  }
  io.to('live:' + room.id).emit('live:ended', { id: room.id });

  // Close the LiveKit room as well, not just the GameTik UI record.
  try {
    if (livekitConfigured()) await livekitService().deleteRoom(room.roomName);
  } catch (error) {
    // The host still disconnects locally; keep the app state ended if LiveKit has already removed the room.
    console.warn('LiveKit-Raum konnte beim Beenden nicht serverseitig gelöscht werden:', error.message || error);
  }
  return res.json({ ok: true });
}));
app.get('/api/live/:id/count', asyncRoute(async (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.json({ count: 0, likes: 0, status: 'ended' });
  if (!livekitConfigured()) return res.json({ count: 0, likes: room.likes || 0, status: 'unconfigured' });
  try {
    const participants = await livekitService().listParticipants(room.roomName);
    res.json({ count: participants.length, likes: room.likes || 0, status: room.status });
  } catch (error) {
    console.error('LiveKit participant count failed:', error.message);
    res.json({ count: 0, likes: room.likes || 0, status: room.status, countAvailable: false });
  }
}));


io.use((socket,next) => {
  const authData = socket.handshake.auth || {};
  const token = authData.token;
  const user = sessions.get(String(token || ''));
  if (user) { socket.user = user; socket.isGuestLive = false; return next(); }
  const guestRoomId = String(authData.guestLiveRoomId || '');
  const guestRoom = liveRooms.get(guestRoomId);
  if (guestRoom && guestRoom.status === 'live') {
    socket.user = { id: 'guest-' + crypto.randomUUID(), username: 'Gast', blockedUsers: new Set(), following: new Set() };
    socket.isGuestLive = true;
    socket.guestLiveRoomId = guestRoomId;
    return next();
  }
  return next(new Error('Bitte zuerst einen Nickname wählen.'));
});
io.on('connection', socket => {
  socket.emit('chat:history', chatMessages.slice(-80));
  socket.join('user:' + socket.user.id);
  socket.on('live:join-chat', (payload, ack) => {
    const id = String(payload && payload.roomId || '');
    const room = liveRooms.get(id);
    if (!room || room.status !== 'live' || (socket.isGuestLive && socket.guestLiveRoomId !== id)) { if (ack) ack({ error: 'Live-Stream nicht verfügbar.' }); return; }
    socket.join('live:' + id);
    if (ack) ack({ ok: true });
  });
  socket.on('live:chat', (payload, ack) => {
    const id = String(payload && payload.roomId || '');
    const room = liveRooms.get(id);
    const body = String(payload && payload.body || '').trim().slice(0, 300);
    if (!room || room.status !== 'live' || !body || !socket.rooms.has('live:' + id)) { if (ack) ack({ error: 'Live-Chat nicht verfügbar oder Nachricht leer.' }); return; }
    const message = { id: crypto.randomUUID(), roomId: id, username: socket.user.username, body, created_at: new Date().toISOString() };
    io.to('live:' + id).emit('live:chat-message', message);
    if (ack) ack({ ok: true });
  });
  // WebRTC 1:1 call signaling. Media travels peer-to-peer; the server only relays signaling.
  socket.on('call:invite', (payload, ack) => {
    const toId = String(payload && payload.toId || '');
    const kind = payload && payload.kind === 'voice' ? 'voice' : 'video';
    if (!toId || toId === String(socket.user.id)) { if (ack) ack({ error: 'Bitte einen anderen Nutzer auswählen.' }); return; }
    const recipient = sessions.get(toId);
    if (!recipient || !io.sockets.adapter.rooms.has('user:' + toId)) { if (ack) ack({ error: 'Der Nutzer ist gerade nicht online.' }); return; }
    if (socket.user.blockedUsers?.has(toId) || recipient.blockedUsers?.has(String(socket.user.id)) || adminBlockedUsers.has(toId)) { if (ack) ack({ error: 'Anruf zwischen diesen Nutzern nicht möglich.' }); return; }
    io.to('user:' + toId).emit('call:incoming', { callId: crypto.randomUUID(), fromId: String(socket.user.id), fromUsername: socket.user.username, kind });
    if (ack) ack({ ok: true });
  });
  for (const eventName of ['call:accept','call:reject','call:offer','call:answer','call:ice','call:hangup']) {
    socket.on(eventName, (payload, ack) => {
      if (socket.isGuestLive) { if (ack) ack({ error: 'Gäste können Live-Streams ansehen, aber keine privaten Anrufe starten.' }); return; }
      const toId = String(payload && payload.toId || '');
      if (!toId || toId === String(socket.user.id) || !sessions.has(toId)) { if (ack) ack({ error: 'Anrufpartner nicht verfügbar.' }); return; }
      const safe = { ...payload, fromId: String(socket.user.id), fromUsername: socket.user.username };
      delete safe.toId;
      io.to('user:' + toId).emit(eventName, safe);
      if (ack) ack({ ok: true });
    });
  }

  socket.on('private:send', (payload,ack) => {
    if (socket.isGuestLive) { if (ack) ack({ error: 'Bitte melde dich für private Nachrichten an.' }); return; }
    const toId = String(payload && payload.toId || '');
    const body = String(payload && payload.body || '').trim().slice(0,1000);
    if (!body) { if (ack) ack({ error: 'Nachricht darf nicht leer sein.' }); return; }
    if (!toId || toId === socket.user.id) { if (ack) ack({ error: 'Bitte einen anderen Nutzer auswählen.' }); return; }
    const recipient = sessions.get(toId);
    if (!recipient) { if (ack) ack({ error: 'Der Empfänger ist nicht mehr verfügbar. Bitte wähle ihn erneut aus.' }); return; }
    const message = {
      id: crypto.randomUUID(),
      fromId: socket.user.id,
      fromUsername: socket.user.username,
      toId: recipient.id,
      toUsername: recipient.username,
      body,
      created_at: new Date().toISOString()
    };
    privateMessages.push(message);
    if (privateMessages.length > 2000) privateMessages.shift();
    io.to('user:' + socket.user.id).to('user:' + recipient.id).emit('private:message', message);
    if (ack) ack({ ok: true, message });
  });
  socket.on('chat:send', (body,ack) => {
    if (socket.isGuestLive) { if (ack) ack({ error: 'Gäste können nur im Live-Chat schreiben.' }); return; }
    const text = String(body || '').trim().slice(0,1000);
    if (!text) { if (ack) ack({ error: 'Nachricht darf nicht leer sein.' }); return; }
    const message = { id: crypto.randomUUID(), username: socket.user.username, body: text, created_at: new Date().toISOString() };
    chatMessages.push(message);
    if (chatMessages.length > 500) chatMessages.shift();
    io.emit('chat:message', message);
    if (ack) ack({ ok: true });
  });
});
app.use((err,_req,res,_next) => {
  console.error(err.message || err);
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || (err instanceof multer.MulterError ? 400 : 500));
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Datei zu groß. Videos maximal 35 MB, Profilbilder maximal 3 MB.' : (err.message || 'Interner Fehler.') });
});
initializePersistence().then(() => {
  httpServer.listen(PORT, '0.0.0.0', () => console.log(`GAMETIK läuft auf Port ${PORT}; Speicherung: ${dbPool && databaseReady ? 'Neon PostgreSQL' : 'lokale JSON-Datei (nicht dauerhaft auf Render)'}.`));
}).catch(error => {
  console.error('GameTik konnte die Datenbank nicht initialisieren:', error.message);
  // Fail closed: avoid serving an apparently healthy app while configured DB is unavailable.
  process.exit(1);
});
async function shutdown(signal) {
  console.log(`GameTik wird beendet (${signal}); speichere letzten Stand...`);
  clearInterval(stateFlushTimer);
  clearInterval(storyCleanupTimer);
  try { savePersistentState(); await dbSaveQueue; if (dbPool) await dbPool.end(); } catch (e) { console.error('Fehler beim Beenden:', e.message); }
  process.exit(0);
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('beforeExit', () => { if (dbPool) dbPool.end().catch(() => {}); });
