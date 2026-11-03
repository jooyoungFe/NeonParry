'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const{RoomStore}=require('../rooms.cjs');
const{MatchmakingStore}=require('../matchmaking.cjs');
const{createServer}=require('../server.cjs');
const source=fs.readFileSync(path.join(__dirname,'../../frontend/js/online-client.js'),'utf8');

function queue(options={}){
  let now=10000;const rooms=new RoomStore({now:()=>now}),matchmaking=new MatchmakingStore({rooms,...options});
  return{rooms,matchmaking,setTime:value=>{now=value;}};
}
function until(predicate){return new Promise((resolve,reject)=>{const started=Date.now();function check(){if(predicate())resolve();else if(Date.now()-started>2000)reject(Error('Timed out waiting for matchmaking handoff.'));else setTimeout(check,2);}check();});}
async function fixture(t,options={}){
  let now=10000;const store=new RoomStore({now:()=>now}),server=createServer({store,tickMs:5,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const urls=[],base='http://127.0.0.1:'+server.address().port;
  const window={};vm.runInNewContext(source,{window,fetch:(url,init)=>{urls.push(url);return fetch(url,init);},URL,AbortController,TextDecoder,setTimeout,clearTimeout});
  const client=window.NeonOnline.createClient(base),streams=[];
  t.after(()=>{for(const stream of streams)stream.close();return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  return{store,client,base,urls,streams,setTime:value=>{now=value;}};
}

test('anonymous tickets pair in a separate room with private credentials and an automatic countdown',()=>{
  const{rooms,matchmaking}=queue(),friend=rooms.create('Friend');
  const a=matchmaking.find('A');assert.equal(a.status,'waiting');assert.equal(a.room,undefined);assert.equal(a.playerToken,undefined);assert.ok(a.ticketToken);
  const b=matchmaking.find('B'),matchedA=matchmaking.status(a.ticketId,a.ticketToken);
  assert.equal(b.status,'matched');assert.equal(matchedA.status,'matched');assert.equal(b.room.code,matchedA.room.code);assert.notEqual(b.room.code,friend.room.code);
  assert.equal(b.room.phase,'starting');assert.equal(b.room.match.startAt,13000);assert.ok(b.room.players.every(p=>p.ready));
  assert.notEqual(b.playerId,matchedA.playerId);assert.notEqual(b.playerToken,matchedA.playerToken);assert.equal(matchedA.ticketToken,undefined);
  assert.ok(!JSON.stringify(matchedA).includes(b.ticketToken));assert.ok(!JSON.stringify(matchedA).includes(b.playerToken));
  assert.throws(()=>matchmaking.status(a.ticketId,b.ticketToken),e=>e.status===401&&e.code==='INVALID_MATCH_TICKET');
  assert.throws(()=>matchmaking.cancel(a.ticketId,b.playerToken),e=>e.status===401);
  assert.equal(rooms.status(friend.room.code,friend.playerToken).players.length,1);
});

test('waiting heartbeats expire abandoned tickets before another player can be paired with them',()=>{
  const{matchmaking,setTime,rooms}=queue({waitingTtlMs:100});
  const ghost=matchmaking.find('Ghost');setTime(10100);
  const live=matchmaking.find('Live');assert.equal(live.status,'waiting');assert.equal(rooms.rooms.size,0);
  assert.throws(()=>matchmaking.status(ghost.ticketId,ghost.ticketToken),e=>e.code==='MATCH_TICKET_NOT_FOUND');
  setTime(10199);assert.equal(matchmaking.status(live.ticketId,live.ticketToken).expiresAt,10299);
  setTime(10298);assert.equal(matchmaking.status(live.ticketId,live.ticketToken).status,'waiting');
  setTime(10398);assert.throws(()=>matchmaking.status(live.ticketId,live.ticketToken),e=>e.status===404);
  assert.equal(matchmaking.tickets.size,0);assert.equal(matchmaking.waiting.size,0);
});

test('cancel winning the pairing race cleans both unused memberships and requeues the live opponent',()=>{
  const{matchmaking,rooms}=queue(),a=matchmaking.find('A'),b=matchmaking.find('B'),oldMatch=b.room.match.id;
  assert.equal(matchmaking.cancel(a.ticketId,a.ticketToken).cancelled,true);assert.equal(rooms.rooms.size,0);
  const waitingB=matchmaking.status(b.ticketId,b.ticketToken);assert.equal(waitingB.status,'waiting');assert.equal(waitingB.playerToken,undefined);
  const c=matchmaking.find('C'),newB=matchmaking.status(b.ticketId,b.ticketToken);assert.equal(c.status,'matched');assert.equal(newB.room.code,c.room.code);assert.notEqual(newB.room.match.id,oldMatch);
  assert.throws(()=>matchmaking.status(a.ticketId,a.ticketToken),e=>e.status===404);
});

test('handoff expiry and post-handoff ticket cancellation preserve the live duel',()=>{
  const{matchmaking,rooms,setTime}=queue({handoffTtlMs:100}),a=matchmaking.find('A'),b=matchmaking.find('B'),matchedA=matchmaking.status(a.ticketId,a.ticketToken);
  rooms.connect(matchedA.room.code,matchedA.playerToken);matchmaking.handoff(matchedA.room.code,matchedA.playerId);
  rooms.connect(b.room.code,b.playerToken);matchmaking.handoff(b.room.code,b.playerId);
  matchmaking.cancel(a.ticketId,a.ticketToken);assert.equal(rooms.rooms.get(b.room.code).players.length,2);
  setTime(10100);matchmaking.prune();assert.equal(matchmaking.tickets.size,0);
  assert.equal(rooms.status(b.room.code,b.playerToken).phase,'starting');assert.equal(rooms.rooms.get(b.room.code).players.length,2);
});

test('unused matched tickets expire without leaving ghost opponents or rooms',()=>{
  const{matchmaking,rooms,setTime}=queue({waitingTtlMs:100,handoffTtlMs:200});matchmaking.find('A');matchmaking.find('B');
  setTime(10200);matchmaking.prune();assert.equal(matchmaking.tickets.size,0);assert.equal(matchmaking.waiting.size,0);assert.equal(rooms.rooms.size,0);
});

test('queue and room capacity errors do not consume an existing live opponent',()=>{
  const limited=queue({maxTickets:1}),a=limited.matchmaking.find('A');assert.throws(()=>limited.matchmaking.find('B'),e=>e.code==='MATCHMAKING_CAPACITY');assert.equal(limited.matchmaking.status(a.ticketId,a.ticketToken).status,'waiting');
  const{rooms,matchmaking}=queue();rooms.maxRooms=1;const friend=rooms.create('Friend'),waiting=matchmaking.find('Waiting');
  assert.throws(()=>matchmaking.find('Retry'),e=>e.code==='ROOM_CAPACITY');assert.equal(matchmaking.tickets.size,1);assert.equal(matchmaking.status(waiting.ticketId,waiting.ticketToken).status,'waiting');
  rooms.leave(friend.room.code,friend.playerToken);const retry=matchmaking.find('Retry');assert.equal(retry.status,'matched');assert.equal(rooms.rooms.size,1);
});

test('HTTP clients match, authenticate ticket polls, join the existing combat stream and keep tokens out of URLs',async t=>{
  const f=await fixture(t),{client}=f,a=await client.findMatch('A'),b=await client.findMatch('B'),matchedA=await client.getMatch(a.ticketId,a.ticketToken);
  assert.equal(a.status,'waiting');assert.equal(b.status,'matched');assert.equal(matchedA.room.match.id,b.room.match.id);
  await assert.rejects(client.getMatch(a.ticketId,b.ticketToken),e=>e.code==='INVALID_MATCH_TICKET'&&e.status===401);
  const states=[],stream=client.connectBattle(matchedA.room.code,matchedA.playerToken,{onState:state=>states.push(state)});f.streams.push(stream);await until(()=>states.length);
  assert.equal(states[0].battle.status,'countdown');
  await client.cancelMatch(a.ticketId,a.ticketToken);assert.equal((await client.getRoom(matchedA.room.code,matchedA.playerToken)).players.length,2);
  assert.ok(f.urls.every(url=>![a.ticketToken,b.ticketToken,matchedA.playerToken,b.playerToken].some(token=>url.includes(token))));
});

test('matched cancellation sends a final forfeit to an opponent who already handed off',async t=>{
  const f=await fixture(t),{client}=f,a=await client.findMatch('A'),b=await client.findMatch('B'),matchedA=await client.getMatch(a.ticketId,a.ticketToken),states=[];
  f.streams.push(client.connectBattle(matchedA.room.code,matchedA.playerToken,{onState:state=>states.push(state)}));await until(()=>states.length);
  await client.cancelMatch(b.ticketId,b.ticketToken);await until(()=>states.some(state=>state.battle.status==='finished'));
  assert.equal(states.at(-1).battle.winnerId,matchedA.playerId);assert.equal(states.at(-1).battle.finishReason,'forfeit');
  assert.equal((await client.getRoom(matchedA.room.code,matchedA.playerToken)).players.length,1);
});

test('matchmaking enrollment is bounded and rejects invalid names and unauthenticated ticket retrieval',async t=>{
  const f=await fixture(t,{matchmakingRateLimit:2}),{client}=f;
  await assert.rejects(client.findMatch('x'.repeat(25)),e=>e.code==='INVALID_NAME'&&e.status===400);
  const ticket=await client.findMatch('Valid');await assert.rejects(client.findMatch('Too many'),e=>e.code==='RATE_LIMITED'&&e.status===429);
  const response=await fetch(f.base+'/api/v1/matchmaking/'+ticket.ticketId);assert.equal(response.status,401);assert.equal((await response.json()).error.code,'TOKEN_REQUIRED');
  assert.throws(()=>client.getMatch('not-a-ticket',ticket.ticketToken),e=>e.code==='INVALID_MATCH_TICKET');
});
