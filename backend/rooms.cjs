'use strict';
const {randomBytes,randomInt,timingSafeEqual}=require('node:crypto');
const {createHash}=require('node:crypto');
const duel=require('../frontend/js/duel-engine.js');
class ApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const digest=token=>createHash('sha256').update(token).digest();
function player(name){return{id:randomBytes(12).toString('hex'),name,ready:false,token:randomBytes(32).toString('base64url')};}
class RoomStore{
  constructor({now=Date.now,ttlMs=15*60*1000,maxRooms=1000,disconnectGraceMs=15000}={}){this.rooms=new Map();this.now=now;this.ttlMs=ttlMs;this.maxRooms=maxRooms;this.disconnectGraceMs=disconnectGraceMs;}
  prune(){const now=this.now();for(const [code,room]of this.rooms)if(now-room.touchedAt>=this.ttlMs)this.rooms.delete(code);}
  get(code){this.prune();const room=this.rooms.get(code);if(!room)throw new ApiError(404,'ROOM_NOT_FOUND','Room not found or expired.');return room;}
  snapshot(room){
    const now=this.now();if(room.battle){duel.advance(room.battle,now);const phase=room.battle.status==='finished'?'finished':now>=room.match.startAt?'playing':'starting';if(room.phase!==phase){room.phase=phase;if(phase==='finished')for(const p of room.players)p.ready=false;room.revision++;}}
    return{code:room.code,hostId:room.players[0].id,phase:room.phase,revision:room.revision,players:room.players.map(({id,name,ready})=>({id,name,ready})),match:room.match?{...room.match}:null,serverTime:now};
  }
  attach(room,name){const entry=player(name),token=entry.token;delete entry.token;entry.tokenHash=digest(token);room.players.push(entry);room.touchedAt=this.now();room.revision++;return{room:this.snapshot(room),playerId:entry.id,playerToken:token};}
  create(name){
    this.prune();if(this.rooms.size>=this.maxRooms)throw new ApiError(503,'ROOM_CAPACITY','Room capacity reached.');
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
    do{code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(this.rooms.has(code));
    const room={code,players:[],phase:'waiting',match:null,battle:null,presence:new Map(),revision:0,touchedAt:this.now()};this.rooms.set(code,room);return this.attach(room,name);
  }
  join(code,name){const room=this.get(code);if(room.players.length>=2||room.phase!=='waiting')throw new ApiError(409,'ROOM_FULL','Room is full or already starting.');return this.attach(room,name);}
  authorize(code,token){const room=this.get(code),hash=digest(token),entry=room.players.find(p=>timingSafeEqual(p.tokenHash,hash));if(!entry)throw new ApiError(401,'INVALID_TOKEN','Invalid room membership.');room.touchedAt=this.now();return{room,entry};}
  status(code,token){return this.snapshot(this.authorize(code,token).room);}
  ready(code,token,ready){
    const{room,entry}=this.authorize(code,token);this.snapshot(room);if(!['waiting','finished'].includes(room.phase))throw new ApiError(409,'MATCH_STARTED','The match is already in progress.');
    if(entry.ready!==ready){entry.ready=ready;room.revision++;}
    if(room.players.length===2&&room.players.every(p=>p.ready)){room.phase='starting';room.match={id:randomBytes(16).toString('hex'),seed:randomBytes(4).readUInt32BE(),startAt:this.now()+3000};room.battle=duel.createMatch({players:room.players.map(p=>p.id),...room.match});room.presence=new Map(room.players.map(p=>[p.id,{connections:0,disconnectedAt:room.match.startAt,lastSeq:-1,sequences:new Set()}]));room.revision++;}
    return this.snapshot(room);
  }
  battleState(code,token){const{room}=this.authorize(code,token);return this.battleSnapshot(room);}
  battleSnapshot(room){if(!room.battle)throw new ApiError(409,'MATCH_NOT_STARTED','Both players must be ready before the duel starts.');this.checkDisconnects(room,this.disconnectGraceMs);const publicRoom=this.snapshot(room),now=this.now();return{room:publicRoom,battle:duel.snapshot(room.battle,now),serverTime:now};}
  input(code,token,data){
    const{room,entry}=this.authorize(code,token);if(!room.battle)throw new ApiError(409,'MATCH_NOT_STARTED','Both players must be ready before the duel starts.');
    if(data.matchId!==undefined&&data.matchId!==room.match.id)throw new ApiError(409,'STALE_MATCH','This input belongs to a previous duel.');
    if(!['attack','guard'].includes(data.type)||!['up','right','down','left'].includes(data.dir)||!Number.isSafeInteger(data.seq)||data.seq<0||data.seq>0x7fffffff)throw new ApiError(400,'INVALID_INPUT','Input requires attack or guard, a cardinal direction, and a nonnegative sequence number.');
    this.checkDisconnects(room,this.disconnectGraceMs);const presence=room.presence.get(entry.id);
    if(presence.sequences.has(data.seq)||data.seq<presence.lastSeq-128)return{ok:false,reason:'duplicate',state:this.battleSnapshot(room)};
    presence.sequences.add(data.seq);presence.lastSeq=Math.max(presence.lastSeq,data.seq);for(const seq of presence.sequences)if(seq<presence.lastSeq-128)presence.sequences.delete(seq);
    const result=duel.input(room.battle,entry.id,{type:data.type,dir:data.dir},this.now());
    return{...result,state:this.battleSnapshot(room)};
  }
  connect(code,token){const{room,entry}=this.authorize(code,token);if(!room.battle)throw new ApiError(409,'MATCH_NOT_STARTED','Both players must be ready before the duel starts.');this.checkDisconnects(room,this.disconnectGraceMs);const presence=room.presence.get(entry.id);presence.connections++;presence.disconnectedAt=null;return{room,entry,battle:room.battle};}
  disconnect(room,playerId,battle=room.battle){if(room.battle!==battle)return;const presence=room.presence.get(playerId);if(presence){presence.connections=Math.max(0,presence.connections-1);if(!presence.connections)presence.disconnectedAt=this.now();}}
  checkDisconnects(room,graceMs){
    if(!room.battle||room.battle.status==='finished')return;
    const now=this.now();for(const [id,presence]of room.presence)if(!presence.connections&&presence.disconnectedAt!==null&&now-presence.disconnectedAt>=graceMs){duel.forfeit(room.battle,id,now);break;}
  }
  forfeit(code,token){const{room,entry}=this.authorize(code,token);if(room.battle&&room.battle.status!=='finished')duel.forfeit(room.battle,entry.id,this.now());return room.battle?this.battleSnapshot(room):null;}
  leave(code,token){const{room,entry}=this.authorize(code,token);room.players=room.players.filter(p=>p!==entry);if(!room.players.length){this.rooms.delete(code);return{closed:true};}room.match=null;room.battle=null;room.presence.clear();room.phase='waiting';for(const p of room.players)p.ready=false;room.revision++;return{closed:false,room:this.snapshot(room)};}
}
module.exports={RoomStore,ApiError};
