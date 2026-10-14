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
// Render runs behind a reverse proxy; honor its HTTPS forwarding headers for PayPal return URLs.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/uploads/videos', express.static(videoDir, { maxAge: '1h' }));
app.use('/uploads/avatars', express.static(avatarDir, { maxAge: '1h' }));
const publicDir = __dirname;
// Serve only the public browser files. Do not expose server.js, package files, README, or config files.
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/app.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').sendFile(path.join(publicDir, 'app.js'));
});

const sessions = new Map();
const videos = [];
const chatMessages = [];
const privateMessages = [];
const gifts = [];
const paypalOrders = new Map();
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
function mimeFilter(allowedTypes, message) {
  return (_req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) return cb(null, true);
    const error = new Error(message);
    error.status = 415;
    cb(error);
  };
}
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: mimeFilter(['video/mp4', 'video/webm', 'video/quicktime'], 'Erlaubt sind MP4, WebM und MOV.')
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
  fileFilter: mimeFilter(['image/jpeg', 'image/png', 'image/webp'], 'Erlaubt sind JPG, PNG und WebP.')
});
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
  paypalEnabled: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  paypalMode: String(process.env.PAYPAL_MODE || 'sandbox').toLowerCase(),
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
  Krone: { price: '4.99', label: 'Virtuelles Geschenk: Krone' }
});

app.post('/api/payments/paypal/create-order', auth, asyncRoute(async (req, res) => {
  const giftName = String(req.body.gift || '').trim();
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
    gift: saved.gift,
    paymentId: capture.id,
    created_at: new Date().toISOString()
  };
  gifts.push(giftRecord);

  res.json({ ok: true, status: 'COMPLETED', gift: saved.gift, paymentId: capture.id });
}));
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
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err instanceof multer.MulterError ? 400 : (Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500));
  const message = err.code === 'LIMIT_FILE_SIZE'
    ? 'Datei zu groß. Videos maximal 35 MiB, Profilbilder maximal 3 MiB.'
    : (status === 500 ? 'Interner Serverfehler.' : (err.message || 'Anfrage konnte nicht verarbeitet werden.'));
  res.status(status).json({ error: message });
});
httpServer.listen(PORT, '0.0.0.0', () => console.log(`GAMETIK läuft auf Port ${PORT}; Demo-Daten werden im Arbeitsspeicher gehalten.`));
