'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');

const PORT = Number.parseInt(process.env.PORT || '4000', 10);
const TICK_MS = 50;
const MAX_WAITING = 500;
// Resolve the arena from the common Render layouts. This explicitly supports
// the path seen in Render logs: /opt/render/project/src/public/battle-arena.html.
const ARENA_CANDIDATES = [
  path.join(__dirname, 'src', 'public', 'battle-arena.html'),
  path.join(__dirname, 'public', 'battle-arena.html'),
  path.join(__dirname, 'battle-arena.html'),
  path.join(process.cwd(), 'src', 'public', 'battle-arena.html'),
  path.join(process.cwd(), 'public', 'battle-arena.html'),
  path.join(process.cwd(), 'battle-arena.html'),
];
function resolveArenaFile() {
  return ARENA_CANDIDATES.find((candidate) => {
    try { return require('node:fs').statSync(candidate).isFile(); }
    catch { return false; }
  }) || null;
}
const ARENA_FILE = resolveArenaFile();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map((value) => value.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.status(200).json({
  ok: true,
  service: 'gametik-battle-arena',
  protocol: 'socket.io',
  tickRate: Math.round(1000 / TICK_MS),
  waitingPlayers: waitQueue.length,
  activeMatches: matches.size,
}));
app.get('/', (_req, res) => {
  const arenaFile = resolveArenaFile();
  if (!arenaFile) {
    console.error('[GameTik Battle Arena] HTML missing. Checked:', ARENA_CANDIDATES.join(' | '));
    return res.status(503).type('text/plain').send('Battle Arena HTML fehlt. Bitte battle-arena.html unter src/public/ oder public/ bereitstellen.');
  }
  return res.sendFile(arenaFile);
});
app.use(express.static(path.join(__dirname, 'src', 'public'), {
  index: false,
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  etag: true,
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  maxHttpBufferSize: 80_000,
  pingInterval: 25_000,
  pingTimeout: 20_000,
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by ALLOWED_ORIGINS'));
    },
    methods: ['GET', 'POST'],
    credentials: false,
  },
  // CORS headers alone do not restrict WebSocket upgrades; check Origin here too.
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback('Origin not allowed by ALLOWED_ORIGINS', false);
  },
});

const waitQueue = [];
const matches = new Map();
const VALID_ATTACKS = new Set(['jab', 'light', 'hook', 'uppercut', 'kick', 'heavy', 'spin', 'knee', 'special']);
const ATTACKS = {
  jab:      { damage: 7,  duration: 270, recovery: 220, impact: 0.46, cost: 7,  stun: 240 },
  light:    { damage: 10, duration: 300, recovery: 220, impact: 0.46, cost: 7,  stun: 240 },
  hook:     { damage: 13, duration: 380, recovery: 220, impact: 0.57, cost: 9,  stun: 270 },
  uppercut: { damage: 16, duration: 460, recovery: 220, impact: 0.62, cost: 11, stun: 310 },
  kick:     { damage: 15, duration: 520, recovery: 220, impact: 0.66, cost: 15, stun: 270 },
  heavy:    { damage: 18, duration: 480, recovery: 220, impact: 0.62, cost: 15, stun: 300 },
  spin:     { damage: 21, duration: 680, recovery: 260, impact: 0.58, cost: 18, stun: 380 },
  knee:     { damage: 14, duration: 440, recovery: 220, impact: 0.55, cost: 13, stun: 270 },
  special:  { damage: 28, duration: 620, recovery: 480, impact: 0.64, cost: 60, stun: 550 },
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function safeVector(value) { return Number.isFinite(value) ? clamp(value, -1, 1) : 0; }
function roomId() { return `arena-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`; }
function makeFighter(slot, socketId) {
  return {
    slot, socketId,
    x: slot === 'p1' ? -1.45 : 1.45,
    z: 0,
    hp: 100,
    energy: 100,
    input: { x: 0, z: 0, block: false },
    blocking: false,
    blockStartedAt: 0,
    dodgeUntil: 0,
    stunUntil: 0,
    attackUntil: 0,
    cooldownUntil: 0,
    attackType: 'jab',
    pendingHits: [],
    lastActionAt: 0,
  };
}
function createMatch(a, b) {
  const id = roomId();
  const match = {
    id,
    fighters: { p1: makeFighter('p1', a.id), p2: makeFighter('p2', b.id) },
    ended: false,
    winner: null,
    rematchVotes: new Set(),
    round: 1,
    createdAt: Date.now(),
  };
  matches.set(id, match);
  a.data.matchId = id; a.data.slot = 'p1';
  b.data.matchId = id; b.data.slot = 'p2';
  a.join(id); b.join(id);
  a.emit('match:found', { roomId: id, slot: 'p1', opponent: 'PLAYER 02' });
  b.emit('match:found', { roomId: id, slot: 'p2', opponent: 'PLAYER 01' });
  io.to(id).emit('battle:state', serializeMatch(match));
}
function serializeFighter(fighter, now) {
  return {
    x: Number(fighter.x.toFixed(3)),
    z: Number(fighter.z.toFixed(3)),
    hp: fighter.hp,
    energy: Number(fighter.energy.toFixed(1)),
    blocking: fighter.blocking,
    moving: Math.hypot(fighter.input.x, fighter.input.z) > 0.1 && !fighter.blocking,
    attackType: fighter.attackType,
    attackRemaining: Math.max(0, fighter.attackUntil - now) / 1000,
    cooldownRemaining: Math.max(0, fighter.cooldownUntil - now) / 1000,
    stunRemaining: Math.max(0, fighter.stunUntil - now) / 1000,
    dodgeRemaining: Math.max(0, fighter.dodgeUntil - now) / 1000,
  };
}
function serializeMatch(match) {
  const now = Date.now();
  return {
    roomId: match.id,
    round: match.round,
    players: {
      p1: serializeFighter(match.fighters.p1, now),
      p2: serializeFighter(match.fighters.p2, now),
    },
    ended: match.ended,
    winner: match.winner,
  };
}
function broadcastEvent(match, event) { io.to(match.id).emit('battle:event', event); }
function sendError(socket, message) { socket.emit('battle:error', { message }); }
function matchFor(socket) {
  const id = socket.data.matchId;
  const match = id && matches.get(id);
  if (!match || !socket.data.slot) return null;
  return { match, fighter: match.fighters[socket.data.slot], opponent: match.fighters[socket.data.slot === 'p1' ? 'p2' : 'p1'] };
}
function clearWaitingSocket(socketId) {
  const index = waitQueue.findIndex((socket) => socket.id === socketId);
  if (index >= 0) waitQueue.splice(index, 1);
}
function leaveMatch(socket, notifyOpponent = true) {
  const info = matchFor(socket);
  if (!info) { socket.data.matchId = null; socket.data.slot = null; return; }
  const { match, opponent } = info;
  socket.leave(match.id);
  if (notifyOpponent) {
    const otherSocket = io.sockets.sockets.get(opponent.socketId);
    if (otherSocket) otherSocket.emit('match:opponent-left');
  }
  matches.delete(match.id);
  for (const slot of ['p1', 'p2']) {
    const fighter = match.fighters[slot];
    const participant = io.sockets.sockets.get(fighter.socketId);
    if (participant) { participant.data.matchId = null; participant.data.slot = null; participant.leave(match.id); }
  }
}
function tryMatchmaking() {
  while (waitQueue.length >= 2) {
    const a = waitQueue.shift();
    const b = waitQueue.shift();
    if (!a?.connected || !b?.connected) {
      if (a?.connected) waitQueue.unshift(a);
      if (b?.connected) waitQueue.unshift(b);
      continue;
    }
    if (a.data.matchId || b.data.matchId) continue;
    createMatch(a, b);
  }
}
function startAttack(socket, rawType) {
  const info = matchFor(socket);
  if (!info) return sendError(socket, 'Du bist in keinem Online-Match.');
  const { match, fighter, opponent } = info;
  const now = Date.now();
  if (match.ended) return sendError(socket, 'Die Runde ist vorbei. Fordere ein Rematch an.');
  if (typeof rawType !== 'string' || !VALID_ATTACKS.has(rawType)) return sendError(socket, 'Unbekannter Angriff.');
  if (now < fighter.stunUntil) return sendError(socket, 'Du bist kurz benommen.');
  if (now < fighter.cooldownUntil) return sendError(socket, 'Angriff noch nicht bereit.');
  if (fighter.blocking) return sendError(socket, 'Zum Angreifen zuerst blocken lösen.');
  const def = ATTACKS[rawType];
  if (fighter.energy < def.cost) return sendError(socket, rawType === 'special' ? 'Nicht genug Spezialenergie.' : 'Nicht genug Energie.');
  fighter.energy = Math.max(0, fighter.energy - def.cost);
  fighter.attackType = rawType;
  fighter.attackUntil = now + def.duration;
  fighter.cooldownUntil = now + def.duration + def.recovery;
  fighter.pendingHits.push({
    type: rawType,
    dueAt: now + Math.round(def.duration * def.impact),
    damage: def.damage,
    stun: def.stun,
    attackerSlot: fighter.slot,
    targetSlot: opponent.slot,
  });
  broadcastEvent(match, { type: 'attack-start', slot: fighter.slot, attack: rawType, duration: def.duration / 1000 });
}
function dodge(socket) {
  const info = matchFor(socket);
  if (!info) return sendError(socket, 'Du bist in keinem Online-Match.');
  const { match, fighter, opponent } = info, now = Date.now();
  if (match.ended) return sendError(socket, 'Die Runde ist vorbei.');
  if (fighter.energy < 8 || now < fighter.stunUntil || now < fighter.dodgeUntil) return sendError(socket, 'Ausweichen ist gerade nicht möglich.');
  fighter.energy -= 8; fighter.dodgeUntil = now + 420;
  const dx = fighter.x - opponent.x, dz = fighter.z - opponent.z, length = Math.max(0.001, Math.hypot(dx, dz));
  fighter.x = clamp(fighter.x + dx / length * .52, -3.8, 3.8);
  fighter.z = clamp(fighter.z + dz / length * .52, -2.6, 2.6);
  broadcastEvent(match, { type: 'evade', slot: fighter.slot });
}
function setInput(socket, packet) {
  const info = matchFor(socket);
  if (!info || info.match.ended || !packet || typeof packet !== 'object') return;
  const { fighter } = info;
  fighter.input.x = safeVector(packet.x);
  fighter.input.z = safeVector(packet.z);
  fighter.input.block = packet.block === true;
}
function resetRound(match) {
  match.round += 1; match.ended = false; match.winner = null; match.rematchVotes.clear();
  for (const slot of ['p1', 'p2']) {
    const f = match.fighters[slot];
    f.x = slot === 'p1' ? -1.45 : 1.45; f.z = 0; f.hp = 100; f.energy = 100;
    f.input = { x: 0, z: 0, block: false }; f.blocking = false; f.blockStartedAt = 0;
    f.dodgeUntil = 0; f.stunUntil = 0; f.attackUntil = 0; f.cooldownUntil = 0;
    f.attackType = 'jab'; f.pendingHits = []; f.lastActionAt = 0;
  }
  io.to(match.id).emit('battle:state', serializeMatch(match));
}
function tickMatch(match, now) {
  if (match.ended) return;
  for (const slot of ['p1', 'p2']) {
    const f = match.fighters[slot], opponent = match.fighters[slot === 'p1' ? 'p2' : 'p1'];
    const wasBlocking = f.blocking;
    f.blocking = !!f.input.block && f.energy > 0 && now >= f.stunUntil;
    if (f.blocking && !wasBlocking) f.blockStartedAt = now;
    if (f.blocking) f.energy = Math.max(0, f.energy - .25);
    else f.energy = Math.min(100, f.energy + .4);
    if (!f.blocking && now >= f.stunUntil) {
      const length = Math.hypot(f.input.x, f.input.z) || 1;
      const moveScale = now < f.attackUntil ? .48 : 1;
      const step = .13 * moveScale;
      f.x = clamp(f.x + (f.input.x / length) * step, -3.8, 3.8);
      f.z = clamp(f.z + (f.input.z / length) * step, -2.6, 2.6);
    }
    if (f.pendingHits.length) {
      const due = f.pendingHits.filter((hit) => hit.dueAt <= now);
      f.pendingHits = f.pendingHits.filter((hit) => hit.dueAt > now);
      for (const hit of due) {
        if (match.ended) break;
        // Stun interrupts an attack before contact instead of allowing a delayed ghost hit.
        if (f.stunUntil > now) continue;
        const target = match.fighters[hit.targetSlot];
        if (Math.hypot(f.x - target.x, f.z - target.z) > 2.3) continue;
        if (target.dodgeUntil > now) { broadcastEvent(match, { type: 'evade', slot: target.slot, from: f.slot }); continue; }
        if (target.blocking && target.energy > 0) {
          target.energy = Math.max(0, target.energy - 12);
          broadcastEvent(match, { type: 'block', slot: target.slot, from: f.slot });
          if (now - target.blockStartedAt < 650 && target.energy >= 8) {
            target.energy = Math.max(0, target.energy - 8);
            f.stunUntil = Math.max(f.stunUntil, now + 500);
            broadcastEvent(match, { type: 'counter', slot: target.slot, from: f.slot });
          }
          continue;
        }
        target.hp = Math.max(0, target.hp - hit.damage);
        target.pendingHits = [];
        target.attackUntil = 0;
        target.stunUntil = Math.max(target.stunUntil, now + hit.stun);
        target.energy = Math.min(100, target.energy + 5);
        broadcastEvent(match, { type: 'hit', slot: target.slot, from: f.slot, damage: hit.damage, attack: hit.type });
        if (target.hp <= 0) { match.ended = true; match.winner = f.slot; break; }
      }
    }
    // Avoid carrying forward stale direction input after a paused/background tab.
    if (!Number.isFinite(opponent.x) || !Number.isFinite(opponent.z)) { opponent.x = slot === 'p1' ? 1.45 : -1.45; opponent.z = 0; }
  }
  io.to(match.id).emit('battle:state', serializeMatch(match));
}

io.on('connection', (socket) => {
  socket.data.matchId = null;
  socket.data.slot = null;
  socket.data.lastInputAt = 0;
  socket.data.lastAttackEventAt = 0;

  socket.on('matchmaking:join', () => {
    if (socket.data.matchId) return sendError(socket, 'Du bist bereits in einem Match.');
    clearWaitingSocket(socket.id);
    if (waitQueue.length >= MAX_WAITING) return sendError(socket, 'Die Warteschlange ist voll. Bitte später erneut versuchen.');
    waitQueue.push(socket);
    socket.emit('matchmaking:waiting', { message: 'Warte auf einen zweiten Spieler …' });
    tryMatchmaking();
  });
  socket.on('matchmaking:leave', () => { clearWaitingSocket(socket.id); socket.emit('matchmaking:left'); });
  socket.on('battle:input', (packet) => {
    const now = Date.now();
    if (now - socket.data.lastInputAt < 30) return;
    socket.data.lastInputAt = now;
    setInput(socket, packet);
  });
  socket.on('battle:attack', (packet) => {
    const now = Date.now();
    if (now - socket.data.lastAttackEventAt < 45) return;
    socket.data.lastAttackEventAt = now;
    startAttack(socket, packet && packet.type);
  });
  socket.on('battle:dodge', () => dodge(socket));
  socket.on('battle:rematch', () => {
    const info = matchFor(socket);
    if (!info) return sendError(socket, 'Kein aktives Online-Match.');
    const { match } = info;
    if (!match.ended) return sendError(socket, 'Rematch erst nach Ende der Runde möglich.');
    match.rematchVotes.add(socket.data.slot);
    if (match.rematchVotes.size === 2) resetRound(match);
    else socket.emit('battle:rematch:waiting');
  });
  socket.on('battle:leave', () => { clearWaitingSocket(socket.id); leaveMatch(socket); });
  socket.on('disconnect', () => { clearWaitingSocket(socket.id); leaveMatch(socket); tryMatchmaking(); });
});

const ticker = setInterval(() => {
  const now = Date.now();
  for (const match of matches.values()) tickMatch(match, now);
}, TICK_MS);
ticker.unref?.();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[GameTik Battle Arena] Server listening on 0.0.0.0:${PORT}`);
});

function shutdown(signal) {
  console.log(`[GameTik Battle Arena] ${signal}; closing server…`);
  clearInterval(ticker);
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
