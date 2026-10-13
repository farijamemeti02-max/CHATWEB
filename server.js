require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/uploads/videos', express.static(videoDir, { maxAge: '1h' }));
app.use('/uploads/avatars', express.static(avatarDir, { maxAge: '1h' }));
const publicDir = __dirname;
// Explicitly serve the homepage so GET / works even if static index resolution differs.
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use(express.static(publicDir));

const sessions = new Map();
const videos = [];
const chatMessages = [];
const privateMessages = [];
const gifts = [];
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
    'image/webp': '.webp'
  };
  return extensions[mimetype] || '';
}
const videoUpload = multer({ storage: videoStorage, limits: { fileSize: MAX_VIDEO_BYTES, files: 1 }, fileFilter: (_req,f,cb) => {
  cb(['video/mp4','video/webm','video/quicktime'].includes(f.mimetype) ? null : new Error('Erlaubt sind MP4, WebM und MOV.'), ['video/mp4','video/webm','video/quicktime'].includes(f.mimetype));
}});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: MAX_AVATAR_BYTES, files: 1 }, fileFilter: (_req,f,cb) => {
  cb(['image/jpeg','image/png','image/webp'].includes(f.mimetype) ? null : new Error('Erlaubt sind JPG, PNG und WebP.'), ['image/jpeg','image/png','image/webp'].includes(f.mimetype));
}});
function getSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token);
}
function auth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Wähle zuerst einen Nickname.' });
  req.user = session;
  next();
}
function asyncRoute(fn) { return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }
function publicUser(user) {
  return { id: user.id, username: user.username, email: null, avatar_url: user.avatar_url || null, created_at: user.created_at };
}
app.get('/api/health', (_req,res) => res.json({ ok: true, service: 'gametik', mode: 'memory-only', database: 'not-used', secretKey: 'not-required' }));
app.get('/api/config', (_req,res) => res.json({
  paypalUrl: process.env.PAYPAL_DONATION_URL || '',
  paypalEnabled: Boolean(process.env.PAYPAL_DONATION_URL),
  currency: (process.env.PAYPAL_CURRENCY || 'EUR').toUpperCase(),
  mode: 'memory-only'
}));
app.post('/api/guest', (req,res) => {
  const nickname = String(req.body.nickname || '').trim();
  if (!/^[A-Za-z0-9_]{2,24}$/.test(nickname)) return res.status(400).json({ error: 'Nickname: 2–24 Zeichen, nur Buchstaben, Zahlen und _.' });
  const token = crypto.randomUUID();
  const user = { id: token, username: nickname, avatar_url: null, created_at: new Date().toISOString(), likes: new Set(), following: new Set() };
  sessions.set(token, user);
  res.status(201).json({ token, user: publicUser(user) });
});
app.post('/api/auth/logout', auth, (req,res) => { sessions.delete(String(req.user.id)); res.json({ ok: true }); });
app.get('/api/me', auth, (req,res) => res.json({ user: publicUser(req.user) }));
app.get('/api/members', auth, (req,res) => {
  const members = [...sessions.values()]
    .filter(user => user.id !== req.user.id)
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
app.get('/api/videos', (req,res) => {
  const viewer = getSession(req);
  res.json({ videos: videos.slice().reverse().map(v => ({
    ...v,
    user_id: v.user_id,
    like_count: v.likes.size,
    comment_count: v.comments.length,
    following: viewer ? viewer.following.has(v.user_id) : false,
    liked: viewer ? viewer.likes.has(v.id) : false
  })) });
});
app.post('/api/videos', auth, (req,res,next) => videoUpload.single('video')(req,res,err => {
  if (err) return next(err);
  if (!req.file) return res.status(400).json({ error: 'Bitte ein Video auswählen.' });
  const video = {
    id: nextVideoId++, user_id: req.user.id, username: req.user.username,
    avatar_url: req.user.avatar_url || null,
    video_url: '/uploads/videos/' + req.file.filename,
    caption: String(req.body.caption || '').trim().slice(0,500),
    created_at: new Date().toISOString(), likes: new Set(), comments: []
  };
  videos.push(video);
  res.status(201).json({ video: { ...video, likes: undefined, comments: undefined, like_count: 0, comment_count: 0 } });
}));
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
app.post('/api/users/:id/follow', auth, (req,res) => {
  const targetId = String(req.params.id);
  if (targetId === String(req.user.id)) return res.status(400).json({ error: 'Du kannst dir nicht selbst folgen.' });
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
app.post('/api/payments/paypal/create-order', (_req,res) => res.status(503).json({
  error: process.env.PAYPAL_DONATION_URL
    ? 'Ohne PayPal-API-Schlüssel ist keine automatische Geschenkzahlung möglich. Nutze den PayPal-Link als externe Zahlung.'
    : 'PayPal ist nicht eingerichtet. Ohne Schlüssel ist nur ein externer PayPal.me-Link möglich.'
}));
app.post('/api/payments/paypal/capture-order', (_req,res) => res.status(503).json({ error: 'PayPal-Zahlungsbestätigung ist im schlüssellosen Demo-Modus deaktiviert.' }));
app.get('/api/demo-stats', (_req,res) => res.json({ sessions: sessions.size, videos: videos.length, messages: chatMessages.length, gifts: gifts.length }));

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
httpServer.listen(PORT, '0.0.0.0', () => console.log(`GAMETIK Demo läuft auf Port ${PORT} ohne Datenbank und ohne Schlüssel.`));
