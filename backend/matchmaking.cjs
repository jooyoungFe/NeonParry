'use strict';
const{randomBytes,randomInt,createHash,timingSafeEqual}=require('node:crypto');
const{ApiError,parseMode}=require('./rooms.cjs');
const digest=token=>createHash('sha256').update(token).digest();

// Queue credentials and room memberships exist only in this process. Queue
// tickets are separate from room tokens and never appear in public room state.
class MatchmakingStore{
  constructor({rooms,now=rooms?.now||Date.now,waitingTtlMs=15000,handoffTtlMs=60000,maxTickets=2000,choose=randomInt,onAbandon}={}){
    if(!rooms)throw new TypeError('Matchmaking requires a room store.');
    this.rooms=rooms;this.now=now;this.waitingTtlMs=waitingTtlMs;this.handoffTtlMs=handoffTtlMs;this.maxTickets=maxTickets;this.choose=choose;
    this.tickets=new Map();this.waiting=new Set();
    this.onAbandon=onAbandon||((member)=>{rooms.forfeit(member.code,member.playerToken);rooms.leave(member.code,member.playerToken);});
  }
  liveMember(ticket){
    const member=ticket.member,room=member&&this.rooms.rooms.get(member.code);
    return room&&room.match?.id===member.matchId&&room.players.some(p=>p.id===member.playerId)?room:null;
  }
  abandon(ticket){
    if(!ticket.member||!this.liveMember(ticket))return;
    try{this.onAbandon(ticket.member);}catch(error){if(!(error instanceof ApiError)||![401,404].includes(error.status))throw error;}
  }
  remove(ticket,{requeuePeer=true}={}){
    this.waiting.delete(ticket.id);this.tickets.delete(ticket.id);
    if(ticket.status!=='matched'||ticket.handedOff)return;
    const peer=[...this.tickets.values()].find(other=>other.status==='matched'&&other.member?.matchId===ticket.member?.matchId);
    const room=this.liveMember(ticket);this.abandon(ticket);
    if(!peer||peer.handedOff)return;
    // No request can interleave with these synchronous mutations. Removing
    // the unclaimed peer closes the unused room.
    if(room&&this.rooms.rooms.get(room.code)===room){
      try{this.rooms.leave(room.code,peer.member.playerToken);}catch(error){if(!(error instanceof ApiError)||![401,404].includes(error.status))throw error;}
    }
    if(requeuePeer&&this.now()-peer.lastSeenAt<this.waitingTtlMs){
      peer.status='waiting';peer.member=null;peer.expiresAt=this.now()+this.waitingTtlMs;this.waiting.add(peer.id);
    }else{this.tickets.delete(peer.id);this.waiting.delete(peer.id);}
  }
  prune(){
    const now=this.now();
    for(const ticket of [...this.tickets.values()])if(this.tickets.has(ticket.id)&&now>=ticket.expiresAt)this.remove(ticket);
  }
  authorize(id,token){
    this.prune();const ticket=this.tickets.get(id);
    if(!ticket)throw new ApiError(404,'MATCH_TICKET_NOT_FOUND','Matchmaking ticket expired or was cancelled.');
    if(typeof token!=='string'||!timingSafeEqual(ticket.tokenHash,digest(token)))throw new ApiError(401,'INVALID_MATCH_TICKET','Invalid matchmaking ticket.');
    return ticket;
  }
  publicState(ticket){
    const state={ticketId:ticket.id,status:ticket.status,mode:ticket.mode,serverTime:this.now(),expiresAt:ticket.expiresAt};
    if(ticket.status==='matched'){
      const room=this.liveMember(ticket);
      if(!room){state.status='cancelled';state.reason='opponent_left';return state;}
      const member=ticket.member;
      state.room=this.rooms.status(member.code,member.playerToken);state.playerId=member.playerId;state.playerToken=member.playerToken;
    }
    return state;
  }
  pair(first,second){
    let host,guest;
    try{
      host=this.rooms.create(first.name,{mode:first.mode,random:true});guest=this.rooms.join(host.room.code,second.name);
      this.rooms.ready(host.room.code,host.playerToken,true);const room=this.rooms.ready(host.room.code,guest.playerToken,true);
      const expiresAt=this.now()+this.handoffTtlMs;
      for(const[ticket,member]of[[first,host],[second,guest]]){
        ticket.status='matched';ticket.member={code:room.code,matchId:room.match.id,playerId:member.playerId,playerToken:member.playerToken};ticket.expiresAt=expiresAt;
        this.waiting.delete(ticket.id);
      }
    }catch(error){
      if(host){for(const member of[guest,host])if(member){try{this.rooms.leave(host.room.code,member.playerToken);}catch{}}}
      throw error;
    }
  }
  find(name,mode='classic'){
    mode=parseMode(mode);
    this.prune();if(this.tickets.size>=this.maxTickets)throw new ApiError(503,'MATCHMAKING_CAPACITY','Matchmaking is temporarily full.');
    const now=this.now(),token=randomBytes(32).toString('base64url');
    const ticket={id:randomBytes(12).toString('hex'),tokenHash:digest(token),name,mode,status:'waiting',member:null,handedOff:false,lastSeenAt:now,expiresAt:now+this.waitingTtlMs};
    const candidates=[...this.waiting].map(id=>this.tickets.get(id)).filter(other=>other?.mode===mode);
    this.tickets.set(ticket.id,ticket);this.waiting.add(ticket.id);
    try{if(candidates.length)this.pair(candidates[this.choose(candidates.length)],ticket);}
    catch(error){this.tickets.delete(ticket.id);this.waiting.delete(ticket.id);throw error;}
    return{...this.publicState(ticket),ticketToken:token};
  }
  status(id,token){
    const ticket=this.authorize(id,token);ticket.lastSeenAt=this.now();if(ticket.status==='waiting')ticket.expiresAt=this.now()+this.waitingTtlMs;
    return this.publicState(ticket);
  }
  cancel(id,token){const ticket=this.authorize(id,token);this.remove(ticket);return{cancelled:true,serverTime:this.now()};}
  handoff(code,playerId){for(const ticket of this.tickets.values())if(ticket.member?.code===code&&ticket.member.playerId===playerId)ticket.handedOff=true;}
}
module.exports={MatchmakingStore};
