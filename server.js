require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const PORT = Number(process.env.PORT || 10000);
const MAX_VIDEO_BYTES = 35 * 1024 * 1024;
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const uploadRoot = path.join(__dirname, 'uploads');
const videoDir = path.join(uploadRoot, 'videos');
const avatarDir = path.join(uploadRoot, 'avatars');
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(avatarDir, { recursive: true });

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
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const videos = [];
const chatMessages = [];
const privateMessages = [];
const gifts = [];
const stories = [];
const adminBlockedUsers = new Set();
let nextStoryId = 1;
const paypalOrders = new Map();
const liveRooms = new Map();
let nextVideoId = 1;
let nextCommentId = 1;
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
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
    'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/rtf': '.rtf', 'application/zip': '.zip'
  };
  return extensions[mimetype] || '';
}
const allowedMediaTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'];
const allowedAudioTypes = ['audio/mpeg', 'audio/mp3'];
const allowedDocumentTypes = ['application/pdf','text/plain','text/csv','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/rtf','application/zip'];
const videoUpload = multer({ storage: videoStorage, limits: { fileSize: MAX_VIDEO_BYTES, files: 1 }, fileFilter: (_req, f, cb) => {
  const allowed = allowedMediaTypes.includes(f.mimetype);
  cb(allowed ? null : Object.assign(new Error('Erlaubt sind JPG, PNG, WebP, MP4, WebM und MOV.'), { status: 400 }), allowed);
}});
const postUpload = multer({ storage: videoStorage, limits: { fileSize: MAX_VIDEO_BYTES, files: 3 }, fileFilter: (_req, f, cb) => {
  const allowed = f.fieldname === 'music' ? allowedAudioTypes.includes(f.mimetype) : f.fieldname === 'video' ? allowedMediaTypes.includes(f.mimetype) : f.fieldname === 'document' && allowedDocumentTypes.includes(f.mimetype);
  const message = f.fieldname === 'music' ? 'Nur MP3-Musikdateien sind erlaubt.' : f.fieldname === 'document' ? 'Dokumentformat nicht erlaubt. Erlaubt: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, RTF oder ZIP.' : 'Erlaubt sind JPG, PNG, WebP, MP4, WebM und MOV.';
  cb(allowed ? null : Object.assign(new Error(message), { status: 400 }), allowed);
}});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: MAX_AVATAR_BYTES, files: 1 }, fileFilter: (_req, f, cb) => {
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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    cb(allowed.includes(file.mimetype) ? null : Object.assign(new Error('Storys erlauben JPG, PNG, WebP, MP4, WebM oder MOV.'), { status: 400 }), allowed.includes(file.mimetype));
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
const storyCleanupTimer = setInterval(purgeExpiredStories, 15 * 60 * 1000);
if (typeof storyCleanupTimer.unref === 'function') storyCleanupTimer.unref();

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
  if (!sessions.has(id)) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const blocked = req.body.blocked === true;
  if (blocked) adminBlockedUsers.add(id); else adminBlockedUsers.delete(id);
  res.json({ ok: true, blocked });
});
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  const id = String(req.params.id);
  const user = sessions.get(id);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  sessions.delete(id); adminBlockedUsers.delete(id);
  for (const other of sessions.values()) { other.following?.delete(id); other.blockedUsers?.delete(id); other.likes = other.likes || new Set(); }
  for (let i = videos.length - 1; i >= 0; i--) if (String(videos[i].user_id) === id) { const [v] = videos.splice(i,1); if (v.video_url) fs.unlink(path.join(videoDir,path.basename(v.video_url)),()=>{}); }
  for (let i = stories.length - 1; i >= 0; i--) if (String(stories[i].user_id) === id) { const [st] = stories.splice(i,1); if (st.media_url) fs.unlink(path.join(videoDir,path.basename(st.media_url)),()=>{}); }
  res.json({ ok: true });
});

function asyncRoute(fn) { return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }
function publicUser(user) {
  return { id: user.id, username: user.username, email: null, avatar_url: user.avatar_url || null, created_at: user.created_at, gender: user.gender || '', bio: user.bio || '', relationship_status: user.relationship_status || '', location: user.location || '', following_count: user.following ? user.following.size : 0, followers_count: [...sessions.values()].filter(other => other.following && other.following.has(user.id)).length, posts_count: videos.filter(v => v.user_id === user.id).length, likes_count: videos.filter(v => v.user_id === user.id).reduce((sum, v) => sum + v.likes.size, 0) };
}
app.get('/api/health', (_req,res) => res.json({ ok: true, service: 'gametik', mode: 'memory-only', database: 'not-used', secretKey: 'not-required' }));
app.get('/api/config', (_req,res) => res.json({
  paypalUrl: process.env.PAYPAL_DONATION_URL || '',
  paypalEnabled: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  paypalMode: String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase(),
  currency: (process.env.PAYPAL_CURRENCY || 'EUR').toUpperCase(),
  mode: 'memory-only'
}));
app.post('/api/guest', (req,res) => {
  const nickname = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{2,24}$/.test(nickname)) return res.status(400).json({ error: 'Nickname: 2–24 Zeichen, nur Buchstaben, Zahlen und _.' });
  const token = crypto.randomUUID();
  const user = { id: token, username: nickname, avatar_url: null, created_at: new Date().toISOString(), gender: '', bio: '', relationship_status: '', location: '', likes: new Set(), following: new Set(), blockedUsers: new Set() };
  sessions.set(token, user);
  res.status(201).json({ token, user: publicUser(user) });
});
app.post('/api/auth/logout', auth, (req,res) => { sessions.delete(String(req.user.id)); res.json({ ok: true }); });
app.get('/api/me', auth, (req,res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/me/profile', auth, (req, res) => {
  const gender = String(req.body.gender || '').trim();
  const relationship = String(req.body.relationship_status || '').trim();
  const bio = String(req.body.bio || '').trim();
  const location = String(req.body.location || '').trim();
  if (!['', 'Mann', 'Frau', 'Divers'].includes(gender)) return res.status(400).json({ error: 'Bitte eine gültige Geschlechtsoption wählen.' });
  if (!['', 'Single', 'In einer Beziehung', 'Verheiratet', 'Es ist kompliziert', 'Keine Angabe'].includes(relationship)) return res.status(400).json({ error: 'Bitte einen gültigen Beziehungsstatus wählen.' });
  req.user.gender = gender; req.user.relationship_status = relationship; req.user.bio = bio.slice(0, 300); req.user.location = location.slice(0, 80);
  res.json({ user: publicUser(req.user) });
});
app.get('/api/members', auth, (req,res) => {
  const members = [...sessions.values()]
    .filter(user => user.id !== req.user.id && !isBlockedBetween(req.user, user.id))
    .map(user => publicUser(user));
  res.json({ members });
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
app.post('/api/me/avatar', auth, (req,res,next) => avatarUpload.single('avatar')(req,res,err => {
  if (err) return next(err);
  if (!req.file) return res.status(400).json({ error: 'Bitte ein Profilbild auswählen.' });
  req.user.avatar_url = '/uploads/avatars/' + req.file.filename;
  res.json({ user: publicUser(req.user) });
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
  // On production, configure APP_BASE_URL explicitly to the public HTTPS website URL.
  return `${req.protocol}://${req.get('host')}`;
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
  const product = giftCatalog[giftName];
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
  if (saved.liveRoomId) io.to('live:' + saved.liveRoomId).emit('live:gift', { roomId: saved.liveRoomId, username: req.user.username, gift: saved.gift, paymentId: capture.id, created_at: giftRecord.created_at });

  res.json({ ok: true, status: 'COMPLETED', gift: saved.gift, paymentId: capture.id });
}));
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
  return { id: room.id, roomName: room.roomName, title: room.title, hostId: room.hostId, hostUsername: room.hostUsername, startedAt: room.startedAt, status: room.status };
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
  const room = { id, roomName, title, hostId: String(req.user.id), hostUsername: req.user.username, startedAt: new Date().toISOString(), status: 'live' };
  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: String(req.user.id), name: req.user.username, ttl: '1h' });
  access.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await access.toJwt();
  liveRooms.set(id, room);
  res.status(201).json({ stream: livePublic(room), serverUrl: process.env.LIVEKIT_URL, token, role: 'host' });
}));
app.post('/api/live/:id/join', auth, asyncRoute(async (req, res) => {
  if (!livekitConfigured()) return res.status(503).json({ error: 'Live ist noch nicht eingerichtet. Bitte LiveKit-Zugangsdaten in Render konfigurieren.' });
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.status(404).json({ error: 'Dieser Live-Stream ist nicht mehr verfügbar.' });
  const access = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: String(req.user.id), name: req.user.username, ttl: '1h' });
  access.addGrant({ roomJoin: true, room: room.roomName, canPublish: false, canSubscribe: true, canPublishData: true });
  const token = await access.toJwt();
  res.json({ stream: livePublic(room), serverUrl: process.env.LIVEKIT_URL, token, role: 'viewer' });
}));
app.post('/api/live/:id/end', auth, (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room) return res.status(404).json({ error: 'Live-Stream nicht gefunden.' });
  if (room.hostId !== String(req.user.id)) return res.status(403).json({ error: 'Nur der Stream-Host kann den Stream beenden.' });
  room.status = 'ended'; room.endedAt = new Date().toISOString();
  io.to('live:' + room.id).emit('live:ended', { id: room.id });
  res.json({ ok: true });
});
app.get('/api/live/:id/count', auth, asyncRoute(async (req, res) => {
  const room = liveRooms.get(String(req.params.id));
  if (!room || room.status !== 'live') return res.json({ count: 0, status: 'ended' });
  if (!livekitConfigured()) return res.json({ count: 0, status: 'unconfigured' });
  try {
    const participants = await livekitService().listParticipants(room.roomName);
    res.json({ count: participants.length, status: room.status });
  } catch (error) {
    console.error('LiveKit participant count failed:', error.message);
    res.json({ count: 0, status: room.status, countAvailable: false });
  }
}));


io.use((socket,next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const user = sessions.get(String(token || ''));
  if (!user) return next(new Error('Bitte zuerst einen Nickname wählen.'));
  socket.user = user;
  next();
});
io.on('connection', socket => {
  socket.emit('chat:history', chatMessages.slice(-80));
  socket.join('user:' + socket.user.id);
  socket.on('live:join-chat', (payload, ack) => {
    const id = String(payload && payload.roomId || '');
    const room = liveRooms.get(id);
    if (!room || room.status !== 'live') { if (ack) ack({ error: 'Live-Stream nicht verfügbar.' }); return; }
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
  socket.on('private:send', (payload,ack) => {
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
httpServer.listen(PORT, '0.0.0.0', () => console.log(`GAMETIK läuft auf Port ${PORT}; Demo-Daten werden im Arbeitsspeicher gehalten.`));
