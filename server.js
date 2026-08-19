const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const COLORS = ['#ff5c70','#5c8dff','#5be38a','#ffb84d','#c77dff','#42d9e8','#ff72c9','#b7df55'];
const W = 1200, H = 680;
const ARENA = { x: 40, y: 35, w: 1120, h: 610 };
const ROUND_SECONDS = 60;

const obstacles = [
  {x: 250,y:155,w:170,h:34}, {x:780,y:155,w:170,h:34},
  {x:250,y:490,w:170,h:34}, {x:780,y:490,w:170,h:34},
  {x:555,y:115,w:90,h:105}, {x:555,y:460,w:90,h:105}
];

function randomSpawn(i=0){
  const spots=[{x:130,y:120},{x:1070,y:120},{x:130,y:560},{x:1070,y:560},{x:350,y:335},{x:850,y:335},{x:470,y:90},{x:730,y:570}];
  return spots[i%spots.length];
}
function makePlayer(id,name,i){
  const s=randomSpawn(i);
  return {id,name:(name||`Player ${i+1}`).slice(0,14),x:s.x,y:s.y,vx:0,vy:0,color:COLORS[i%COLORS.length],score:0,streak:0,shield:0,dash:0,lastHit:0,w:26};
}
function makeRoom(code,host){return {code,host,players:{},started:false,round:0,time:ROUND_SECONDS,crown:{x:W/2,y:H/2,carrier:null,drop:0},powerups:[],lastTick:Date.now(),ending:false};}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function circleRect(px,py,r,o){const x=clamp(px,o.x,o.x+o.w),y=clamp(py,o.y,o.y+o.h);return Math.hypot(px-x,py-y)<r;}
function blocked(x,y,r=13){if(x<ARENA.x+r||x>ARENA.x+ARENA.w-r||y<ARENA.y+r||y>ARENA.y+ARENA.h-r)return true;return obstacles.some(o=>circleRect(x,y,r,o));}
function movePlayer(p,dx,dy){
  const nx=p.x+dx;
  if(!blocked(nx,p.y,p.w/2))p.x=nx;
  const ny=p.y+dy;
  if(!blocked(p.x,ny,p.w/2))p.y=ny;
}
function spawnPowerup(room){
  const types=['speed','shield','score'];
  for(let tries=0;tries<30;tries++){
    const x=ARENA.x+50+Math.random()*(ARENA.w-100), y=ARENA.y+50+Math.random()*(ARENA.h-100);
    if(!blocked(x,y,20)) {room.powerups.push({id:Math.random().toString(36).slice(2),x,y,type:types[Math.floor(Math.random()*types.length)]});return;}
  }
}
function resetRound(room){
  Object.values(room.players).forEach((p,i)=>{const s=randomSpawn(i);p.x=s.x;p.y=s.y;p.vx=0;p.vy=0;p.streak=0;p.shield=0;p.dash=0;});
  room.crown={x:W/2,y:H/2,carrier:null,drop:0};room.powerups=[];room.time=ROUND_SECONDS;room.lastTick=Date.now();room.ending=false;
  for(let i=0;i<3;i++)spawnPowerup(room);
}
function publicState(room){
  return {started:room.started,round:room.round,time:Math.max(0,Math.ceil(room.time)),players:Object.values(room.players).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,color:p.color,score:p.score,shield:p.shield>0,dash:p.dash})),crown:room.crown,powerups:room.powerups,host:room.host,ending:room.ending};
}
function finishRound(room){
  room.ending=true;
  if(room.crown.carrier && room.players[room.crown.carrier]) room.players[room.crown.carrier].score+=5;
  setTimeout(()=>{
    if(!rooms.has(room.code))return;
    room.round++;
    if(room.round>=3){room.started=false;room.round=3;io.to(room.code).emit('gameOver',publicState(room));return;}
    resetRound(room);room.ending=false;io.to(room.code).emit('roundStart',publicState(room));
  },3500);
}
function tick(room){
  if(!room.started||room.ending)return;
  const now=Date.now(),dt=Math.min(.06,(now-room.lastTick)/1000);room.lastTick=now;room.time-=dt;
  const ps=Object.values(room.players);
  for(const p of ps){
    p.dash=Math.max(0,p.dash-dt);p.shield=Math.max(0,p.shield-dt);
    const speed=p.speedBoost>0?6.8:4.1;
    p.speedBoost=Math.max(0,(p.speedBoost||0)-dt);
    movePlayer(p,p.vx*speed*dt,p.vy*speed*dt);p.vx*=0.72;p.vy*=0.72;
    if(room.crown.carrier===p.id){p.score+=dt*2.2;p.streak+=dt;}
  }
  if(room.crown.carrier && !room.players[room.crown.carrier]){room.crown.carrier=null;room.crown.drop=2;room.crown.x=W/2;room.crown.y=H/2;}
  if(!room.crown.carrier){room.crown.drop=Math.max(0,room.crown.drop-dt);if(room.crown.drop<=0){for(const p of ps)if(dist(p,room.crown)<25){room.crown.carrier=p.id;break;}}}
  for(const p of ps){
    for(let i=room.powerups.length-1;i>=0;i--){const u=room.powerups[i];if(dist(p,u)<25){if(u.type==='speed')p.speedBoost=5;if(u.type==='shield')p.shield=6;if(u.type==='score')p.score+=10;room.powerups.splice(i,1);}}
  }
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
    const a=ps[i],b=ps[j],d=dist(a,b);
    if(d<27&&d>0){
      const nx=(a.x-b.x)/d,ny=(a.y-b.y)/d;
      const push=1.8;movePlayer(a,nx*push,ny*push);movePlayer(b,-nx*push,-ny*push);
      const nowMs=Date.now();
      if(nowMs-a.lastHit>650&&nowMs-b.lastHit>650){
        const target=room.crown.carrier===a.id?a:room.crown.carrier===b.id?b:null;
        if(target){if(target.shield>0){target.shield=0;}else{room.crown.carrier=null;room.crown.x=target.x;room.crown.y=target.y;room.crown.drop=1.2;target.lastHit=nowMs;target.streak=0;}} else if(Math.random()<0.22){a.score=Math.max(0,a.score-1);b.score+=1;}
      }
    }
  }
  if(room.powerups.length<3&&Math.random()<dt*.22)spawnPowerup(room);
  if(room.time<=0)finishRound(room);
  io.to(room.code).emit('state',publicState(room));
}

io.on('connection',socket=>{
  socket.on('createRoom',({name})=>{let code;do code=Math.random().toString(36).slice(2,7).toUpperCase();while(rooms.has(code));const r=makeRoom(code,socket.id);r.players[socket.id]=makePlayer(socket.id,name,0);rooms.set(code,r);socket.join(code);socket.data.room=code;socket.emit('roomCreated',code);io.to(code).emit('state',publicState(r));});
  socket.on('joinRoom',({code,name})=>{const r=rooms.get(String(code||'').trim().toUpperCase());if(!r)return socket.emit('errorMessage','Room not found.');if(r.started)return socket.emit('errorMessage','Game already started.');if(Object.keys(r.players).length>=8)return socket.emit('errorMessage','Room is full.');const i=Object.keys(r.players).length;r.players[socket.id]=makePlayer(socket.id,name,i);socket.join(r.code);socket.data.room=r.code;socket.emit('roomJoined',r.code);io.to(r.code).emit('state',publicState(r));});
  socket.on('startGame',()=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id||Object.keys(r.players).length<1)return;r.started=true;r.round=0;Object.values(r.players).forEach(p=>p.score=0);resetRound(r);io.to(r.code).emit('roundStart',publicState(r));});
  socket.on('input',input=>{const r=rooms.get(socket.data.room);if(!r||!r.started||r.ending)return;const p=r.players[socket.id];if(!p)return;let x=(input.right?1:0)-(input.left?1:0),y=(input.down?1:0)-(input.up?1:0);const len=Math.hypot(x,y)||1;p.vx=x/len;p.vy=y/len;if(input.dash&&p.dash<=0&&(x||y)){p.vx*=2.5;p.vy*=2.5;p.dash=1.7;}});
  socket.on('restart',()=>{const r=rooms.get(socket.data.room);if(!r||r.host!==socket.id)return;r.started=true;r.round=0;Object.values(r.players).forEach(p=>p.score=0);resetRound(r);io.to(r.code).emit('roundStart',publicState(r));});
  socket.on('disconnect',()=>{const r=rooms.get(socket.data.room);if(!r)return;delete r.players[socket.id];if(!Object.keys(r.players).length){rooms.delete(r.code);return;}if(r.host===socket.id)r.host=Object.keys(r.players)[0];io.to(r.code).emit('state',publicState(r));});
});
setInterval(()=>{for(const r of rooms.values())tick(r);},33);
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`Crown Rush running on ${PORT}`));