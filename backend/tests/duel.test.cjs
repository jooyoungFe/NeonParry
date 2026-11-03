'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const{createServer}=require('../server.cjs');
const{RoomStore}=require('../rooms.cjs');
const{RULES}=require('../../frontend/js/duel-engine.js');
const source=fs.readFileSync(path.join(__dirname,'../../frontend/js/online-client.js'),'utf8');

function until(predicate,timeoutMs=2000){
  return new Promise((resolve,reject)=>{const started=Date.now();function check(){if(predicate())resolve();else if(Date.now()-started>timeoutMs)reject(Error('Timed out waiting for battle state.'));else setTimeout(check,2);}check();});
}
async function fixture(t,storeOptions={}){
  let now=10000;const store=new RoomStore({now:()=>now,...storeOptions});
  const server=createServer({store,tickMs:5});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connections=[],base='http://127.0.0.1:'+server.address().port,urls=[];
  const window={};vm.runInNewContext(source,{window,fetch:(url,options)=>{urls.push(url);return fetch(url,options);},URL,AbortController,TextDecoder,setTimeout,clearTimeout});
  const hostClient=window.NeonOnline.createClient(base),guestClient=window.NeonOnline.createClient(base);
  const host=await hostClient.createRoom('Host'),guest=await guestClient.joinRoom(host.room.code,'Guest'),code=host.room.code;
  await hostClient.setReady(code,host.playerToken,true);const room=await guestClient.setReady(code,guest.playerToken,true);
  const hostStates=[],guestStates=[],errors=[];
  function connect(client,player,states){const connection=client.connectBattle(code,player.playerToken,{onState:state=>states.push(state),onError:error=>errors.push(error)});connections.push(connection);return connection;}
  const hostStream=connect(hostClient,host,hostStates),guestStream=connect(guestClient,guest,guestStates);
  t.after(()=>{for(const connection of connections)connection.close();return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  await until(()=>hostStates.length&&guestStates.length);
  return{store,base,urls,hostClient,guestClient,host,guest,code,room,hostStates,guestStates,errors,hostStream,guestStream,connect,setTime:value=>{now=value;},getTime:()=>now};
}

test('two authenticated streaming clients share attacks, perfect guards, damage and the final winner',async t=>{
  const f=await fixture(t),{hostClient,guestClient,host,guest,code}=f;
  assert.equal(f.hostStates[0].battle.status,'countdown');assert.equal(f.guestStates[0].battle.startAt,f.room.match.startAt);
  f.setTime(f.room.match.startAt);
  const shot=await hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'up'});assert.equal(shot.ok,true);
  assert.equal(shot.impactAt-f.getTime(),2200);
  assert.equal(shot.state.battle.rules.guardWindowMs,360);assert.equal(shot.state.battle.rules.perfectWindowMs,100);
  assert.equal(shot.state.battle.rules.guardCooldownMs,300);assert.equal(shot.state.battle.rules.arrivalGapMs,520);
  await until(()=>f.guestStates.some(state=>state.battle.attacks.some(a=>a.attackId===shot.attackId)));
  f.setTime(shot.impactAt-1);
  const wrongLane=await guestClient.sendInput(code,guest.playerToken,{type:'guard',dir:'left'});assert.equal(wrongLane.guarded,false);
  f.setTime(shot.impactAt);
  const parry=await guestClient.sendInput(code,guest.playerToken,{type:'guard',dir:'up'});assert.equal(parry.guarded,true);assert.equal(parry.perfect,true);
  assert.equal(parry.state.battle.players.find(p=>p.id===guest.playerId).vulnerability,0);
  assert.equal(parry.state.battle.attacks.length,0);
  for(let hit=0;hit<5;hit++){
    f.setTime(Math.max(f.getTime(),f.room.match.startAt+1800*(hit+1)));
    const attack=await hostClient.sendInput(code,host.playerToken,{type:'attack',dir:['left','right','down','up','left'][hit]});assert.equal(attack.ok,true);
    f.setTime(attack.impactAt+RULES.guardWindowMs+1);
    const state=await guestClient.getBattle(code,guest.playerToken);
    if(hit===4){assert.equal(state.battle.status,'finished');assert.equal(state.battle.winnerId,host.playerId);assert.equal(state.battle.finishReason,'vulnerability');}
  }
  await until(()=>f.hostStates.some(s=>s.battle.status==='finished')&&f.guestStates.some(s=>s.battle.status==='finished'));
  assert.equal(f.errors.length,0);assert.ok(f.urls.every(url=>!url.includes(host.playerToken)&&!url.includes(guest.playerToken)));
});

test('server rejects forged identity/direction, ignores client clocks and deduplicates sequences',async t=>{
  const f=await fixture(t),{hostClient,guestClient,host,guest,code}=f;f.setTime(f.room.match.startAt);
  await assert.rejects(hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'diagonal',seq:1}),e=>e.code==='INVALID_INPUT'&&e.status===400);
  await assert.rejects(hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'up',seq:-1}),e=>e.code==='INVALID_INPUT');
  const shot=await hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'up',seq:2,now:0,damage:100,playerId:guest.playerId});
  assert.equal(shot.impactAt,f.getTime()+RULES.travelMs);assert.equal(shot.state.battle.attacks[0].from,host.playerId);
  const duplicate=await hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'right',seq:2});assert.equal(duplicate.ok,false);assert.equal(duplicate.reason,'duplicate');assert.equal(duplicate.state.battle.attacks.length,1);
  const other=await hostClient.createRoom('Other');await assert.rejects(guestClient.getBattle(code,other.playerToken),e=>e.code==='INVALID_TOKEN'&&e.status===401);
  assert.ok(!JSON.stringify(shot.state).includes(host.playerToken));
  f.setTime(shot.impactAt+RULES.guardWindowMs+1);const state=await guestClient.getBattle(code,guest.playerToken);assert.equal(state.battle.players.find(p=>p.id===guest.playerId).vulnerability,RULES.damageBase);
  await assert.rejects(hostClient.setReady(code,host.playerToken,false),e=>e.code==='MATCH_STARTED');
});

test('disconnected player can reconnect during grace, then forfeits after the grace expires',async t=>{
  const f=await fixture(t,{disconnectGraceMs:1000}),{guest,guestClient,code}=f;f.setTime(f.room.match.startAt);
  f.guestStream.close();await until(()=>f.store.rooms.get(code).presence.get(guest.playerId).connections===0);
  f.setTime(f.getTime()+999);const reconnected=f.connect(guestClient,guest,f.guestStates);await until(()=>f.store.rooms.get(code).presence.get(guest.playerId).connections===1);
  assert.equal((await guestClient.getBattle(code,guest.playerToken)).battle.status,'running');
  reconnected.close();await until(()=>f.store.rooms.get(code).presence.get(guest.playerId).connections===0);
  f.setTime(f.getTime()+1000);await until(()=>f.hostStates.some(s=>s.battle.status==='finished'));
  const last=f.hostStates.at(-1);assert.equal(last.battle.winnerId,f.host.playerId);assert.equal(last.battle.finishReason,'forfeit');
});

test('explicit leave publishes a forfeit and clears old battle before a new guest joins',async t=>{
  const f=await fixture(t),{guestClient,guest,hostClient,host,code}=f;
  const left=await guestClient.leaveRoom(code,guest.playerToken);assert.equal(left.room.phase,'waiting');assert.equal(left.room.match,null);
  await until(()=>f.hostStates.some(s=>s.battle.status==='finished'));
  assert.equal(f.hostStates.at(-1).battle.winnerId,host.playerId);
  const replacement=await guestClient.joinRoom(code,'Replacement');assert.notEqual(replacement.playerId,guest.playerId);
  await assert.rejects(hostClient.getBattle(code,host.playerToken),e=>e.code==='MATCH_NOT_STARTED');
  await hostClient.setReady(code,host.playerToken,true);const next=await guestClient.setReady(code,replacement.playerToken,true);assert.notEqual(next.match.id,f.room.match.id);
});

test('a finished match keeps its result until both players ready for a fresh rematch',async t=>{
  const f=await fixture(t),{store,host,guest,hostClient,guestClient,code}=f;
  store.forfeit(code,guest.playerToken);await until(()=>f.hostStates.some(s=>s.battle.status==='finished')&&f.guestStates.some(s=>s.battle.status==='finished'));
  const first=await hostClient.setReady(code,host.playerToken,true);assert.equal(first.phase,'finished');assert.equal(first.match.id,f.room.match.id);assert.equal(first.players.find(p=>p.id===guest.playerId).ready,false);
  assert.equal((await hostClient.getBattle(code,host.playerToken)).battle.winnerId,host.playerId);
  const second=await guestClient.setReady(code,guest.playerToken,true);assert.equal(second.phase,'starting');assert.notEqual(second.match.id,f.room.match.id);
  await assert.rejects(hostClient.sendInput(code,host.playerToken,{type:'attack',dir:'up',matchId:f.room.match.id}),e=>e.code==='STALE_MATCH');
  const nextStates=[];f.connect(hostClient,host,nextStates);await until(()=>nextStates.length);
  assert.equal(nextStates[0].battle.status,'countdown');assert.equal(nextStates[0].battle.winnerId,null);assert.ok(nextStates[0].battle.players.every(p=>p.vulnerability===0&&p.energy===RULES.energyStart));
  assert.equal(store.rooms.get(code).presence.get(host.playerId).connections,1);
});
