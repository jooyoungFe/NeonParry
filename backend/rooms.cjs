'use strict';
const {randomBytes,randomInt,timingSafeEqual,createHash}=require('node:crypto');
const duel=require('../frontend/js/duel-engine.js');
class ApiError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const digest=token=>createHash('sha256').update(token).digest();
const MAX_GUARD_DELAY_MS=120;
const PING_TTL_MS=5000;
const isChoiceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
function parseMode(mode='classic'){
  if(mode!=='classic'&&mode!=='clash')throw new ApiError(400,'INVALID_MODE','Choose classic or clash.');
  return mode;
}
function player(name){return{id:randomBytes(12).toString('hex'),name,ready:false,token:randomBytes(32).toString('base64url')};}
class RoomStore{
  constructor({now=Date.now,ttlMs=15*60*1000,maxRooms=1000,disconnectGraceMs=15000}={}){this.rooms=new Map();this.now=now;this.ttlMs=ttlMs;this.maxRooms=maxRooms;this.disconnectGraceMs=disconnectGraceMs;}
  prune(){const now=this.now();for(const [code,room]of this.rooms)if(now-room.touchedAt>=this.ttlMs)this.rooms.delete(code);}
  get(code){this.prune();const room=this.rooms.get(code);if(!room)throw new ApiError(404,'ROOM_NOT_FOUND','Room not found or expired.');return room;}
  advanceRoom(room,now=this.now()){
    if(!room.battle)return;
    duel.advance(room.battle,now);
    const phase=room.battle.status==='finished'?'finished':now>=room.match.startAt?'playing':'starting';
    if(room.phase===phase)return;
    room.phase=phase;room.revision++;
    if(phase==='finished'){
      if(room.mode==='clash'){
        // A disconnected fighter can return as a spectator during this round.
        // A member who never returned must not block readiness for the next.
        const present=room.players.filter(p=>!room.presence.get(p.id)?.timedOut);
        if(present.length){
          for(const p of room.players)if(room.presence.get(p.id)?.timedOut)room.presence.delete(p.id);
          room.players=present;
        }
      }
      for(const p of room.players)p.ready=false;
    }
  }
  snapshot(room,now=this.now()){
    this.advanceRoom(room,now);
    const match=room.match?{...room.match}:null;
    if(match?.players)match.players=match.players.map(p=>({...p}));
    return{code:room.code,hostId:room.players[0].id,mode:room.mode,maxPlayers:room.maxPlayers,phase:room.phase,revision:room.revision,players:room.players.map(({id,name,ready})=>({id,name,ready})),match,serverTime:now};
  }
  attach(room,name){const entry=player(name),token=entry.token;delete entry.token;entry.tokenHash=digest(token);room.players.push(entry);room.touchedAt=this.now();room.revision++;return{room:this.snapshot(room),playerId:entry.id,playerToken:token};}
  create(name,{mode='classic',random=false}={}){
    mode=parseMode(mode);
    this.prune();if(this.rooms.size>=this.maxRooms)throw new ApiError(503,'ROOM_CAPACITY','Room capacity reached.');
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
    do{code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(this.rooms.has(code));
    const room={code,mode,maxPlayers:mode==='clash'&&!random?8:2,players:[],phase:'waiting',match:null,battle:null,presence:new Map(),revision:0,touchedAt:this.now()};this.rooms.set(code,room);return this.attach(room,name);
  }
  join(code,name){
    const room=this.get(code);
    if(room.mode==='clash')this.advanceBattle(room);
    if(room.players.length>=room.maxPlayers||(room.phase!=='waiting'&&!(room.mode==='clash'&&room.phase==='finished')))throw new ApiError(409,'ROOM_FULL','Room is full or already starting.');
    return this.attach(room,name);
  }
  authorize(code,token){const room=this.get(code),hash=digest(token),entry=room.players.find(p=>timingSafeEqual(p.tokenHash,hash));if(!entry)throw new ApiError(401,'INVALID_TOKEN','Invalid room membership.');room.touchedAt=this.now();return{room,entry};}
  status(code,token){return this.snapshot(this.authorize(code,token).room);}
  startIfReady(room){
    if(!['waiting','finished'].includes(room.phase)||room.players.length<2||!room.players.every(p=>p.ready))return;
    const roster=room.players.map(({id,name})=>({id,name}));
    const match={id:randomBytes(16).toString('hex'),seed:randomBytes(4).readUInt32BE(),startAt:this.now()+3000,mode:room.mode};
    if(room.mode==='clash')match.players=roster;
    room.battle=duel.createMatch({...match,players:roster.map(p=>p.id),guardGraceMs:room.mode==='clash'?MAX_GUARD_DELAY_MS:0});
    room.match=match;room.phase='starting';room.presence=new Map(roster.map(p=>[p.id,{connections:0,disconnectedAt:match.startAt,lastSeq:-1,lastTargetSeq:-1,sequences:new Set()}]));room.revision++;
  }
  ready(code,token,ready){
    const{room,entry}=this.authorize(code,token);this.advanceRoom(room);if(!room.players.includes(entry))throw new ApiError(401,'INVALID_TOKEN','Invalid room membership.');if(!['waiting','finished'].includes(room.phase))throw new ApiError(409,'MATCH_STARTED','The match is already in progress.');
    if(entry.ready!==ready){entry.ready=ready;room.revision++;}
    this.startIfReady(room);
    return this.snapshot(room);
  }
  issuePing(code,token){
    const{entry}=this.authorize(code,token),serverTime=this.now(),nonce=randomBytes(18).toString('base64url');
    entry.pingSample={nonce,serverTime};return{nonce,serverTime};
  }
  guardDelayMs(entry){const minimum=entry.rttSamples?.length?Math.min(...entry.rttSamples):0;return Math.min(MAX_GUARD_DELAY_MS,Math.floor(minimum/2));}
  answerPing(code,token,nonce){
    const{entry}=this.authorize(code,token),sample=entry.pingSample,serverTime=this.now();
    const rttMs=sample?serverTime-sample.serverTime:Infinity;
    if(!sample||typeof nonce!=='string'||nonce!==sample.nonce||rttMs<0||rttMs>=PING_TTL_MS)throw new ApiError(400,'INVALID_PING','This latency sample is invalid or expired.');
    delete entry.pingSample;entry.rttSamples=[...(entry.rttSamples||[]).slice(-4),rttMs];
    return{rttMs,guardDelayMs:this.guardDelayMs(entry),serverTime};
  }
  advanceBattle(room,now=this.now()){
    this.checkDisconnects(room,this.disconnectGraceMs,now);
    this.advanceRoom(room,now);
  }
  battleState(code,token){const{room}=this.authorize(code,token);return this.battleSnapshot(room);}
  battleSnapshot(room){
    if(!room.battle)throw new ApiError(409,'MATCH_NOT_STARTED','Players must be ready before the duel starts.');
    const now=this.now();this.checkDisconnects(room,this.disconnectGraceMs,now);
    return{room:this.snapshot(room,now),battle:duel.snapshot(room.battle,now),serverTime:now};
  }
  input(code,token,data){
    const{room,entry}=this.authorize(code,token);if(!room.battle)throw new ApiError(409,'MATCH_NOT_STARTED','Both players must be ready before the duel starts.');
    if(data.matchId!==undefined&&data.matchId!==room.match.id)throw new ApiError(409,'STALE_MATCH','This input belongs to a previous duel.');
    const clash=room.mode==='clash',isTarget=clash&&data.type==='target',isUpgrade=clash&&data.type==='upgrade';
    if((!isTarget&&!isUpgrade&&(!['attack','guard'].includes(data.type)||!duel.DIRECTIONS.includes(data.dir)))||!Number.isSafeInteger(data.seq)||data.seq<0||data.seq>0x7fffffff)throw new ApiError(400,'INVALID_INPUT','Use an allowed action and a nonnegative sequence number.');
    const now=this.now();this.advanceBattle(room,now);const presence=room.presence.get(entry.id);
    if(!presence)throw new ApiError(409,'MATCH_NOT_STARTED','Wait for the next duel.');
    if(presence.sequences.has(data.seq)||data.seq<presence.lastSeq-128)return{ok:false,reason:'duplicate',state:this.battleSnapshot(room)};
    if(isTarget&&data.seq<=presence.lastTargetSeq)return{ok:false,reason:'stale_target',state:this.battleSnapshot(room)};
    const command={type:data.type};
    if(!isTarget&&!isUpgrade)command.dir=data.dir;
    if(isUpgrade){
      if(!isChoiceId(data.offerId)||!isChoiceId(data.choiceId))throw new ApiError(400,'INVALID_INPUT','Choose an option from the current upgrade offer.');
      command.offerId=data.offerId;command.choiceId=data.choiceId;
    }
    if(isTarget||(clash&&data.type==='attack'&&data.targetId!==undefined)){
      if(typeof data.targetId!=='string'||data.targetId===entry.id||!room.battle.players.some(p=>p.id===data.targetId&&!p.eliminated))throw new ApiError(400,'INVALID_TARGET','Choose another living player.');
      command.targetId=data.targetId;
    }
    presence.sequences.add(data.seq);presence.lastSeq=Math.max(presence.lastSeq,data.seq);for(const seq of presence.sequences)if(seq<presence.lastSeq-128)presence.sequences.delete(seq);
    if(isTarget)presence.lastTargetSeq=data.seq;
    const result=duel.input(room.battle,entry.id,command,now,clash?{guardDelayMs:this.guardDelayMs(entry)}:undefined);
    return{...result,state:this.battleSnapshot(room)};
  }
  connect(code,token){const{room,entry}=this.authorize(code,token);this.advanceBattle(room);const presence=room.presence.get(entry.id);if(!room.battle||!presence)throw new ApiError(409,'MATCH_NOT_STARTED','Wait for the next duel.');presence.connections++;presence.disconnectedAt=null;presence.timedOut=false;return{room,entry,battle:room.battle};}
  disconnect(room,playerId,battle=room.battle){if(room.battle!==battle)return;const presence=room.presence.get(playerId);if(presence){presence.connections=Math.max(0,presence.connections-1);if(!presence.connections)presence.disconnectedAt=this.now();}}
  checkDisconnects(room,graceMs,now=this.now()){
    if(!room.battle||room.battle.status==='finished')return;
    for(const [id,presence]of room.presence)if(!presence.connections&&presence.disconnectedAt!==null&&now-presence.disconnectedAt>=graceMs){
      duel.forfeit(room.battle,id,now);presence.disconnectedAt=null;presence.timedOut=true;
      if(room.mode==='classic'||room.battle.status==='finished')break;
    }
  }
  forfeit(code,token){const{room,entry}=this.authorize(code,token);if(room.battle&&room.battle.status!=='finished')duel.forfeit(room.battle,entry.id,this.now());return room.battle?this.battleSnapshot(room):null;}
  leave(code,token){
    const{room,entry}=this.authorize(code,token);
    if(room.mode==='clash'&&room.battle){
      const now=this.now();this.advanceBattle(room,now);
      if(room.battle.status!=='finished'&&room.presence.has(entry.id))duel.forfeit(room.battle,entry.id,now);
      this.advanceRoom(room,now);
    }
    room.players=room.players.filter(p=>p!==entry);room.presence.delete(entry.id);
    if(!room.players.length){this.rooms.delete(code);return{closed:true};}
    if(room.mode==='classic'){
      room.match=null;room.battle=null;room.presence.clear();room.phase='waiting';for(const p of room.players)p.ready=false;
    }
    room.revision++;
    return{closed:false,room:this.snapshot(room)};
  }
}
module.exports={RoomStore,ApiError,parseMode};
