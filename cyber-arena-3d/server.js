const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static assets from public/
app.use(express.static(path.join(__dirname, 'public')));

// Colors for players
const PLAYER_COLORS = [
  '#00ffcc', '#ff0055', '#ffbb00', '#00bfff', '#bb00ff', '#55ff00'
];

// Spawn points across the arena
const SPAWN_POINTS = [
  { x: 0, y: 1.6, z: 20 },
  { x: 20, y: 1.6, z: 0 },
  { x: -20, y: 1.6, z: 0 },
  { x: 0, y: 1.6, z: -20 },
  { x: 9, y: 1.6, z: 27 },   // all spawns are clear of containers, towers and pads
  { x: -9, y: 1.6, z: -27 },
  { x: 27, y: 1.6, z: -5 },
  { x: -27, y: 1.6, z: 5 }
];

const players = new Map();

// Gameplay rules enforced server-side (clients are not trusted)
const HIT_DAMAGE = 25;
const MAX_HIT_RANGE = 85;         // slightly above client ray range for latency slack
const MIN_FIRE_INTERVAL_MS = 110; // client fires every 130ms; allow some jitter
const ARENA_HALF = 37;
const MAX_Y = 40;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function sanitizeVec(v) {
  if (!v || !isNum(v.x) || !isNum(v.y) || !isNum(v.z)) return null;
  return { x: v.x, y: v.y, z: v.z };
}

function pickColor() {
  const used = new Set();
  players.forEach((p) => used.add(p.color));
  const free = PLAYER_COLORS.find((c) => !used.has(c));
  return free || PLAYER_COLORS[players.size % PLAYER_COLORS.length];
}

function getRandomSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(message);
    }
  }
}

function getLeaderboard() {
  const leaderboard = [];
  players.forEach((p) => {
    leaderboard.push({
      id: p.id,
      name: p.name,
      score: p.score,
      color: p.color
    });
  });
  return leaderboard.sort((a, b) => b.score - a.score);
}

function broadcastLeaderboard() {
  broadcast({
    type: 'leaderboard',
    leaderboard: getLeaderboard()
  });
}

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).substring(2, 8);
  const color = pickColor();
  const spawn = getRandomSpawn();

  const newPlayer = {
    id: playerId,
    name: `Agent-${playerId.slice(2, 6).toUpperCase()}`,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    rotY: 0,
    rotX: 0,
    health: 100,
    score: 0,
    color: color
  };

  players.set(playerId, { ...newPlayer, ws, lastHitAt: 0 });

  // 1. Send initial state to the joining player
  const playerList = [];
  players.forEach((p) => {
    playerList.push({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      rotY: p.rotY,
      rotX: p.rotX,
      health: p.health,
      score: p.score,
      color: p.color
    });
  });

  ws.send(JSON.stringify({
    type: 'init',
    id: playerId,
    player: newPlayer,
    players: playerList,
    leaderboard: getLeaderboard()
  }));

  // 2. Announce new player to existing players
  broadcast({
    type: 'player_joined',
    player: newPlayer
  }, ws);

  broadcastLeaderboard();

  console.log(`[+] Player joined: ${newPlayer.name} (${playerId}) | Total: ${players.size}`);

  // Handle messages
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const player = players.get(playerId);
      if (!player) return;

      switch (data.type) {
        case 'update': {
          if (![data.x, data.y, data.z, data.rotY, data.rotX].every(isNum)) break;
          if (player.health <= 0) break; // ignore movement while dead
          player.x = clamp(data.x, -ARENA_HALF, ARENA_HALF);
          player.y = clamp(data.y, 0, MAX_Y);
          player.z = clamp(data.z, -ARENA_HALF, ARENA_HALF);
          player.rotY = data.rotY;
          player.rotX = clamp(data.rotX, -Math.PI / 2, Math.PI / 2);
          broadcast({
            type: 'player_moved',
            id: playerId,
            x: player.x,
            y: player.y,
            z: player.z,
            rotY: player.rotY,
            rotX: player.rotX
          }, ws);
          break;
        }

        case 'shoot': {
          const origin = sanitizeVec(data.origin);
          const direction = sanitizeVec(data.direction);
          if (!origin || !direction || player.health <= 0) break;
          broadcast({
            type: 'player_shot',
            id: playerId,
            origin,
            direction
          }, ws);
          break;
        }

        case 'hit': {
          const target = players.get(data.targetId);
          if (!target || target.id === playerId) break;
          if (player.health <= 0 || target.health <= 0) break;

          // Rate limit: can't land hits faster than the weapon fires
          const now = Date.now();
          if (now - player.lastHitAt < MIN_FIRE_INTERVAL_MS) break;

          // Range check using server-known positions
          const dist = Math.hypot(target.x - player.x, target.y - player.y, target.z - player.z);
          if (dist > MAX_HIT_RANGE) break;

          player.lastHitAt = now;
          {
            target.health = Math.max(0, target.health - HIT_DAMAGE);
            broadcast({
              type: 'player_damaged',
              id: target.id,
              health: target.health,
              attackerId: playerId
            });

            if (target.health <= 0) {
              player.score += 1;
              broadcast({
                type: 'kill',
                killerId: playerId,
                killerName: player.name,
                victimId: target.id,
                victimName: target.name,
                killerScore: player.score
              });

              // Broadcast updated leaderboard immediately
              broadcastLeaderboard();

              // Auto-respawn fallback after 3 seconds if player didn't click rejoin
              setTimeout(() => {
                if (players.has(target.id) && target.health <= 0) {
                  const respawnPoint = getRandomSpawn();
                  target.health = 100;
                  target.x = respawnPoint.x;
                  target.y = respawnPoint.y;
                  target.z = respawnPoint.z;
                  broadcast({
                    type: 'respawn',
                    id: target.id,
                    x: target.x,
                    y: target.y,
                    z: target.z,
                    health: target.health
                  });
                }
              }, 3000);
            }
          }
          break;
        }

        case 'request_respawn': {
          if (player.health <= 0) {
            const respawnPoint = getRandomSpawn();
            player.health = 100;
            player.x = respawnPoint.x;
            player.y = respawnPoint.y;
            player.z = respawnPoint.z;
            broadcast({
              type: 'respawn',
              id: playerId,
              x: player.x,
              y: player.y,
              z: player.z,
              health: player.health
            });
            console.log(`[↺] Player rejoined match: ${player.name}`);
          }
          break;
        }

        case 'setName':
          if (typeof data.name === 'string' && data.name.trim().length > 0) {
            player.name = data.name.trim().slice(0, 15);
            broadcast({
              type: 'player_renamed',
              id: playerId,
              name: player.name
            });
            broadcastLeaderboard();
          }
          break;
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    players.delete(playerId);
    broadcast({
      type: 'player_left',
      id: playerId
    });
    broadcastLeaderboard();
    console.log(`[-] Player left: ${playerId} | Remaining: ${players.size}`);
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎮 3D FPS Arena Server running on port ${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`===============================================`);
});
