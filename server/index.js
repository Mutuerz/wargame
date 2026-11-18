'use strict';
// Bridgehead online server: plain HTTP for a health check, WebSocket for the game.
// Run behind Caddy (TLS) in production; see deploy/README.md.
const http = require('http');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const rooms = new Map();
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  let players = 0; for (const r of rooms.values()) players += r.clients.size;
  res.end(`Bridgehead server is running. Rooms: ${rooms.size}. Players online: ${players}.\n`);
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Soldier';
const cleanRoom = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';

wss.on('connection', ws => {
  const c = {
    id: nextId++, name: 'Soldier', room: null, team: 0, cls: 'rifleman', sid: -1,
    send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    sendRaw(s) { if (ws.readyState === 1 && ws.bufferedAmount < 1 << 20) ws.send(s); },
  };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') return c.send({ t: 'pong', c: msg.c });
    if (msg.t === 'join') {
      if (c.room) c.room.leave(c);
      c.name = cleanName(msg.name);
      const code = cleanRoom(msg.room);
      let room = rooms.get(code);
      if (!room) { room = new Room(code, r => rooms.delete(r.code)); rooms.set(code, room); }
      room.join(c, { team: msg.team, cls: msg.cls });
      return;
    }
    if (msg.t === 'leave') { if (c.room) c.room.leave(c); return; }
    if (c.room) {
      try { c.room.handle(c, msg); } catch (e) { console.error('room error', e); }
    }
  });
  ws.on('close', () => { if (c.room) c.room.leave(c); });
  c.send({ t: 'hello', id: c.id });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, HOST, () => console.log(`Bridgehead server on http://${HOST}:${PORT}`));
