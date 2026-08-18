const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express(); const server = http.createServer(app); const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
const rooms = new Map();
const COLORS=['#ff5c5c','#5c8dff','#55d88a','#ffb84d','#c77dff','#4ddde0','#ff7ac8','#b8e05f'];
const levels=[
 {name:'DOUBLE SWITCH',hint:'Stand on BOTH switches to open the door.',width:1500},
 {name:'STACK ATTACK',hint:'Build a human tower and reach the high door.',width:1500}
];
function newPlayer(id,name,i){return{id,name:(name||`Player ${i+1}`).slice(0,14),x:100+i*55,y:598,vx:0,vy:0,color:COLORS[i%COLORS.length],w:28,h:42,grounded:false};}
function platforms(level){return level===0?[{x:0,y:640,w:1500,h:80},{x:300,y:520,w:180,h:22},{x:1030,y:500,w:190,h:22}]:[{x:0,y:640,w:1500,h:80},{x:360,y:535,w:210,h:22},{x:650,y:450,w:220,h:22},{x:980,y:365,w:250,h:22},{x:1240,y:280,w:180,h:22}];}
function state(room){return{level:room.level,levelName:levels[room.level].name,hint:levels[room.level].hint,players:Object.values(room.players).map(p=>({...p})),host:room.host,started:room.started,complete:room.complete};}
function reset(room){Object.values(room.players).forEach((p,i)=>{p.x=100+i*55;p.y=598;p.vx=0;p.vy=0;p.grounded=false;});room.complete=false;}
function overlap(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function update(room){const ps=Object.values(room.players), plats=platforms(room.level);
 for(const p of ps){p.vy+=0.55;p.x+=p.vx;p.y+=p.vy;p.grounded=false;if(p.x<5)p.x=5;if(p.x>1450)p.x=1450;
  for(const q of plats){if(p.x+p.w>q.x&&p.x<q.x+q.w&&p.y+p.h>=q.y&&p.y+p.h<=q.y+30&&p.vy>=0){p.y=q.y-p.h;p.vy=0;p.grounded=true;}}
  if(p.y>760){p.x=100;p.y=598;p.vy=0;}
 }
 // simple player stacking / bumping
 for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){const a=ps[i],b=ps[j];if(overlap(a,b)){if(a.y<b.y){b.y=a.y-b.h;b.vy=Math.min(b.vy,0);b.grounded=true;}else{a.y=b.y-a.h;a.vy=Math.min(a.vy,0);a.grounded=true;}}}
 const sw1=ps.some(p=>p.x>190&&p.x<285&&p.y>590), sw2=ps.some(p=>p.x>900&&p.x<995&&p.y>590);
 room.complete=room.level===0 ? sw1&&sw2&&ps.some(p=>p.x>1360&&p.y>540) : ps.some(p=>p.x>1330&&p.y<260);
 io.to(room.code).emit('state',state(room));
}
io.on('connection',socket=>{
 socket.on('createRoom',({name})=>{let code;do code=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(code));const room={code,host:socket.id,level:0,started:false,complete:false,players:{}};room.players[socket.id]=newPlayer(socket.id,name,0);rooms.set(code,room);socket.join(code);socket.data.room=code;socket.emit('roomCreated',code);io.to(code).emit('state',state(room));});
 socket.on('joinRoom',({code,name})=>{const room=rooms.get(String(code||'').toUpperCase());if(!room)return socket.emit('errorMessage','Room not found.');if(Object.keys(room.players).length>=8)return socket.emit('errorMessage','Room is full.');if(room.started)return socket.emit('errorMessage','Game already started.');const i=Object.keys(room.players).length;room.players[socket.id]=newPlayer(socket.id,name,i);socket.join(room.code);socket.data.room=room.code;socket.emit('roomJoined',room.code);io.to(room.code).emit('state',state(room));});
 socket.on('startGame',()=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id)return;r.started=true;r.level=0;reset(r);io.to(r.code).emit('state',state(r));});
 socket.on('nextLevel',()=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id||!r.complete)return;r.level=(r.level+1)%levels.length;reset(r);io.to(r.code).emit('state',state(r));});
 socket.on('input',input=>{const r=rooms.get(socket.data.room);if(!r||!r.started)return;const p=r.players[socket.id];if(!p)return;p.vx=((input.left?-1:0)+(input.right?1:0))*4.5;if(input.jump&&p.grounded){p.vy=-11;p.grounded=false;}});
 socket.on('disconnect',()=>{const c=socket.data.room,r=rooms.get(c);if(!r)return;delete r.players[socket.id];if(!Object.keys(r.players).length)return rooms.delete(c);if(r.host===socket.id)r.host=Object.keys(r.players)[0];io.to(c).emit('state',state(r));});
});
setInterval(()=>{for(const r of rooms.values())if(r.started&&!r.complete)update(r);},50);
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`Co-op game running on ${PORT}`));
