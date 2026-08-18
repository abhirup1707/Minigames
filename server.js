const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const COLORS = ['#ff5c5c','#5c8dff','#55d88a','#ffb84d','#c77dff','#4ddde0','#ff7ac8','#b8e05f'];
const levels = [
  { name: 'Double Switch', width: 1500, height: 720 },
  { name: 'Stack Attack', width: 1500, height: 720 }
];

function newPlayer(id, name, index) {
  return { id, name: (name || `Player ${index + 1}`).slice(0, 14), x: 100 + index * 55, y: 560, vx: 0, vy: 0, color: COLORS[index % COLORS.length], w: 28, h: 42, grounded: false };
}
function roomState(room) {
  return {
    level: room.level,
    players: Object.values(room.players).map(p => ({ id:p.id,name:p.name,x:p.x,y:p.y,vx:p.vx,vy:p.vy,color:p.color,grounded:p.grounded })),
    host: room.host,
    started: room.started
  };
}

io.on('connection', socket => {
  socket.on('createRoom', ({name}) => {
    let code;
    do code = Math.random().toString(36).slice(2,7).toUpperCase(); while (rooms.has(code));
    const room = { code, host: socket.id, level: 0, started: false, players: {} };
    room.players[socket.id] = newPlayer(socket.id, name, 0);
    rooms.set(code, room);
    socket.join(code); socket.data.room = code;
    socket.emit('roomCreated', code); io.to(code).emit('state', roomState(room));
  });

  socket.on('joinRoom', ({code,name}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) return socket.emit('errorMessage','Room not found.');
    if (Object.keys(room.players).length >= 8) return socket.emit('errorMessage','Room is full.');
    if (room.started) return socket.emit('errorMessage','Game already started.');
    const index = Object.keys(room.players).length;
    room.players[socket.id] = newPlayer(socket.id, name, index);
    socket.join(room.code); socket.data.room = room.code;
    socket.emit('roomJoined', room.code); io.to(room.code).emit('state', roomState(room));
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.room); if (!room || room.host !== socket.id) return;
    room.started = true; room.level = 0; resetPlayers(room); io.to(room.code).emit('state', roomState(room));
  });

  socket.on('nextLevel', () => {
    const room = rooms.get(socket.data.room); if (!room || room.host !== socket.id) return;
    room.level = (room.level + 1) % levels.length; resetPlayers(room); io.to(room.code).emit('state', roomState(room));
  });

  socket.on('input', input => {
    const room = rooms.get(socket.data.room); if (!room || !room.started) return;
    const p = room.players[socket.id]; if (!p) return;
    p.vx = Math.max(-4.5, Math.min(4.5, (input.left ? -1 : 0) + (input.right ? 1 : 0)) * 4.5);
    if (input.jump && p.grounded) { p.vy = -11; p.grounded = false; }
  });

  socket.on('disconnect', () => {
    const code = socket.data.room; const room = rooms.get(code); if (!room) return;
    delete room.players[socket.id];
    if (!Object.keys(room.players).length) return rooms.delete(code);
    if (room.host === socket.id) room.host = Object.keys(room.players)[0];
    io.to(code).emit('state', roomState(room));
  });
});

function resetPlayers(room) {
  Object.values(room.players).forEach((p,i) => { p.x=100+i*55; p.y=560; p.vx=0; p.vy=0; p.grounded=false; });
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.started) continue;
    const lvl = levels[room.level];
    for (const p of Object.values(room.players)) {
      p.vy += 0.55; p.x += p.vx; p.y += p.vy;
      if (p.x < 20) p.x=20; if (p.x > lvl.width-50) p.x=lvl.width-50;
      if (p.y + p.h >= 640) { p.y=640-p.h; p.vy=0; p.grounded=true; }
      if (p.y > lvl.height+100) { p.x=100; p.y=560; p.vy=0; }
    }
    io.to(room.code).emit('state', roomState(room));
  }
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Co-op game running on ${PORT}`));
