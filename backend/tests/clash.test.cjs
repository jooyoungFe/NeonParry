'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const{setTimeout:delay}=require('node:timers/promises');
const{createServer}=require('../server.cjs');
const{RoomStore}=require('../rooms.cjs');
const{RULES}=require('../../frontend/js/duel-engine.js');

async function until(predicate){
  const deadline=Date.now()+2000;
  while(!predicate()){
    if(Date.now()>=deadline)throw Error('Timed out waiting for clash state.');
    await delay(4);
  }
}
async function fixture(t,options={}){
  let now=10000;
  const store=new RoomStore({now:()=>now,disconnectGraceMs:2000}),server=createServer({store,tickMs:5,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,streams=[];
  t.after(()=>{
    for(const stream of streams)stream.controller.abort();
    return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  });
  async function request(path,{method='GET',token,data,headers={}}={}){
    const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    return{status:response.status,data:await response.json()};
  }
  const post=(path,data,token)=>request(path,{method:'POST',data,token});
  const roomPath=code=>'/api/v1/rooms/'+code;
  async function create(players,mode='clash'){
    const host=await post('/api/v1/rooms',{name:players[0],mode});assert.equal(host.status,201);
    const path=roomPath(host.data.room.code),members=[host.data];
    for(const name of players.slice(1)){
      const joined=await post(path+'/join',{name});assert.equal(joined.status,201);members.push(joined.data);
    }
    return{path,members,code:host.data.room.code};
  }
  async function ready(path,members){
    let state;
    for(const member of members){state=await post(path+'/ready',{ready:true},member.playerToken);assert.equal(state.status,200);}
    assert.equal(state.data.phase,'starting');return state.data;
  }
  async function stream(path,member){
    const controller=new AbortController(),states=[];
    const entry={controller,states,closed:false,error:null};streams.push(entry);
    const response=await fetch(base+path+'/battle',{headers:{Authorization:'Bearer '+member.playerToken},signal:controller.signal});
    assert.equal(response.status,200);
    (async()=>{
      let buffer='';const decoder=new TextDecoder();
      try{
        for await(const chunk of response.body){
          buffer+=decoder.decode(chunk,{stream:true});let split;
          while((split=buffer.indexOf('\n\n'))>=0){
            const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);
            if(frame.startsWith('event: state\ndata: '))states.push(JSON.parse(frame.slice('event: state\ndata: '.length)));
          }
        }
      }catch(error){if(!controller.signal.aborted)entry.error=error;}
      finally{entry.closed=true;}
    })();
    await until(()=>states.length);return entry;
  }
  return{store,request,post,create,ready,stream,setTime:value=>{now=value;},advance:ms=>{now+=ms;}};
}

test('private clash admits eight, waits for every player and keeps random matchmaking two-player and mode-specific',async t=>{
  const f=await fixture(t),names=Array.from({length:8},(_,i)=>'Player '+(i+1));
  assert.equal((await f.post('/api/v1/rooms',{mode:'forged'})).data.error.code,'INVALID_MODE');
  const{path,members}=await f.create(names);
  assert.equal(members.at(-1).room.maxPlayers,8);
  assert.equal((await f.post(path+'/join',{name:'Ninth'})).status,409);
  for(const member of members.slice(0,-1))assert.equal((await f.post(path+'/ready',{ready:true},member.playerToken)).data.phase,'waiting');
  const start=await f.post(path+'/ready',{ready:true},members.at(-1).playerToken);
  assert.equal(start.data.match.mode,'clash');assert.deepEqual(start.data.match.players.map(p=>p.name),names);
  const classic=await f.post('/api/v1/matchmaking',{name:'Classic'});
  const clash=await f.post('/api/v1/matchmaking',{name:'Clash',mode:'clash'});
  assert.equal(classic.data.status,'waiting');assert.equal(clash.data.status,'waiting');
  const pair=await f.post('/api/v1/matchmaking',{name:'Clash peer',mode:'clash'});
  assert.equal(pair.data.status,'matched');assert.equal(pair.data.room.maxPlayers,2);
  assert.equal(pair.data.room.players.length,2);assert.equal(pair.data.room.match.mode,'clash');
  assert.equal((await f.request('/api/v1/matchmaking/'+classic.data.ticketId,{token:classic.data.ticketToken})).data.status,'waiting');
});

test('clash stream stays quiet between changes; leave and reconnect affect one fighter, with a fresh rematch roster',async t=>{
  const f=await fixture(t),{path,code,members}=await f.create(['A','B','C','D','E']),[a,b,c,d,e]=members;
  const room=await f.ready(path,members);f.setTime(room.match.startAt);
  const aStream=await f.stream(path,a),bStream=await f.stream(path,b);
  f.store.connect(code,c.playerToken);
  const absent=f.store.connect(code,e.playerToken);
  const dStream=await f.stream(path,d);
  await until(()=>aStream.states.length===3);
  const initial=aStream.states.length;
  f.advance(999);await delay(25);assert.equal(aStream.states.length,initial);
  f.advance(1);await until(()=>aStream.states.length===initial+1);
  await f.post(path+'/input',{type:'target',targetId:c.playerId,seq:1},a.playerToken);
  await until(()=>aStream.states.at(-1).battle.players.find(p=>p.id===a.playerId).targetId===c.playerId);
  const left=await f.request(path,{method:'DELETE',token:b.playerToken});
  assert.equal(left.data.room.phase,'playing');assert.equal(left.data.room.match.id,room.match.id);
  assert.ok(left.data.room.players.every(p=>p.ready));assert.equal(left.data.room.match.players.length,5);
  await until(()=>bStream.closed&&aStream.states.at(-1).battle.players.find(p=>p.id===b.playerId).eliminated);
  assert.equal(aStream.closed,false);
  assert.equal((await f.request(path,{token:b.playerToken})).status,401);
  dStream.controller.abort();await until(()=>f.store.rooms.get(code).presence.get(d.playerId).connections===0);
  f.store.disconnect(absent.room,e.playerId,absent.battle);
  f.advance(1999);
  const early=await f.request(path+'/battle/state',{token:a.playerToken});
  assert.equal(early.data.battle.players.find(p=>p.id===d.playerId).eliminated,false);
  f.advance(1);await until(()=>[d,e].every(member=>aStream.states.at(-1).battle.players.find(p=>p.id===member.playerId).eliminated));
  const rejoined=await f.stream(path,d);
  assert.equal(rejoined.states.at(-1).battle.status,'running');
  assert.equal(rejoined.states.at(-1).battle.players.find(p=>p.id===d.playerId).eliminated,true);
  const lastLeave=await f.request(path,{method:'DELETE',token:c.playerToken});
  assert.equal(lastLeave.data.room.phase,'finished');
  assert.deepEqual(lastLeave.data.room.players.map(p=>p.name),['A','D']);
  assert.equal((await f.request(path,{token:e.playerToken})).status,401);
  await until(()=>aStream.closed);assert.equal(aStream.error,null);
  assert.equal(aStream.states.at(-1).battle.winnerId,a.playerId);
  const freshJoin=await f.post(path+'/join',{name:'F'});assert.equal(freshJoin.status,201);
  const next=await f.ready(path,[a,d,freshJoin.data]);
  assert.notEqual(next.match.id,room.match.id);
  assert.deepEqual(next.match.players.map(p=>p.name),['A','D','F']);
  const fresh=await f.request(path+'/battle/state',{token:a.playerToken});
  assert.ok(fresh.data.battle.players.every(p=>!p.eliminated));
});

test('targeting cannot select self, undo a newer selection, or accidentally persist a one-shot override',async t=>{
  const f=await fixture(t),{path,members}=await f.create(['A','B','C']),[a,b,c]=members;
  const room=await f.ready(path,members);f.setTime(room.match.startAt);
  const input=data=>f.post(path+'/input',data,a.playerToken);
  assert.equal((await input({type:'target',targetId:c.playerId,seq:8})).data.targetId,c.playerId);
  assert.equal((await input({type:'target',targetId:b.playerId,seq:7})).data.reason,'stale_target');
  assert.equal((await input({type:'target',targetId:a.playerId,seq:9})).data.error.code,'INVALID_TARGET');
  const shot=(await input({type:'attack',dir:'up',targetId:b.playerId,seq:10})).data;
  assert.equal(shot.state.battle.attacks.find(x=>x.attackId===shot.attackId).to,b.playerId);
  assert.equal(shot.state.battle.players.find(p=>p.id===a.playerId).targetId,c.playerId);
  await f.request(path,{method:'DELETE',token:b.playerToken});
  assert.equal((await input({type:'attack',dir:'up',targetId:b.playerId,seq:11})).data.error.code,'INVALID_TARGET');
  assert.equal((await input({type:'upgrade',offerId:'offer-1',choiceId:'bad choice',seq:12})).data.error.code,'INVALID_INPUT');
});

test('authenticated ping is one-use and measures the guard offset on the server',async t=>{
  const f=await fixture(t),{path,code,members}=await f.create(['A','B']),[a,b]=members;
  const ping=()=>f.request(path+'/ping',{token:b.playerToken});
  const first=(await ping()).data;
  assert.equal(first.serverTime,10000);
  assert.equal((await f.post(path+'/ping',{nonce:first.nonce},a.playerToken)).data.error.code,'INVALID_PING');
  f.advance(400);
  assert.equal((await f.post(path+'/ping',{nonce:first.nonce,rttMs:0},b.playerToken)).data.guardDelayMs,120);
  assert.equal((await f.post(path+'/ping',{nonce:first.nonce},b.playerToken)).status,400);
  const faster=(await ping()).data;f.advance(80);
  const second=await f.post(path+'/ping',{nonce:faster.nonce,rttMs:999},b.playerToken);
  assert.equal(second.data.rttMs,80);assert.equal(second.data.guardDelayMs,40);
  const expired=(await ping()).data;f.advance(5000);
  assert.equal((await f.post(path+'/ping',{nonce:expired.nonce},b.playerToken)).status,400);
  const ready=await f.ready(path,members);f.setTime(ready.match.startAt);
  for(const player of members)f.store.connect(code,player.playerToken);
  const firstShot=(await f.post(path+'/input',{type:'attack',dir:'right',seq:1},a.playerToken)).data;
  const secondShot=(await f.post(path+'/input',{type:'attack',dir:'right',seq:1},b.playerToken)).data;
  assert.equal(firstShot.impactAt,secondShot.impactAt);
  f.setTime(firstShot.impactAt+RULES.guardWindowMs+1);
  const trusted=(await f.post(path+'/input',{type:'guard',dir:'right',seq:2},b.playerToken)).data;
  const spoofed=(await f.post(path+'/input',{type:'guard',dir:'right',seq:2,guardDelayMs:120,now:secondShot.impactAt},a.playerToken)).data;
  assert.equal(trusted.guarded,true);assert.equal(trusted.attackId,firstShot.attackId);
  assert.equal(spoofed.guarded,false);
});

test('clash delivers a three-choice upgrade and applies only the server-offered value once',async t=>{
  const f=await fixture(t),{path,code,members}=await f.create(['A','B']),[a,b]=members;
  const room=await f.ready(path,members);f.setTime(room.match.startAt);
  const stream=await f.stream(path,a);f.store.connect(code,b.playerToken);
  f.setTime(room.match.startAt+RULES.firstUpgradeMs);
  const player=()=>stream.states.at(-1).battle.players.find(p=>p.id===a.playerId);
  await until(()=>player().offer);
  const offer=player().offer;
  assert.equal(offer.choices.length,3);assert.equal(new Set(offer.choices.map(p=>p.id)).size,3);
  const choice=offer.choices.find(p=>p.kind!=='repair');
  const input=data=>f.post(path+'/input',{type:'upgrade',offerId:offer.id,...data},a.playerToken);
  assert.equal((await input({choiceId:'bogus',seq:1})).data.reason,'invalid_choice');
  const applied=(await input({choiceId:choice.id,seq:2,value:999})).data;
  assert.equal(applied.ok,true);assert.equal(applied.value,choice.value);
  await until(()=>player().upgrades[choice.kind]===choice.value);
  assert.equal(player().offer,null);
  assert.equal(stream.states.at(-1).battle.players.find(p=>p.id===b.playerId).upgrades[choice.kind],0);
  assert.equal((await input({choiceId:choice.id,seq:3})).data.reason,'invalid_offer');
});

test('authenticated players behind the same peer address get independent rate limits',async t=>{
  const f=await fixture(t,{rateLimit:2,inputRateLimit:1,pingRateLimit:1}),{path,members}=await f.create(['A','B']),[a,b]=members;
  const start=await f.ready(path,members);f.setTime(start.match.startAt);
  assert.equal((await f.request(path,{token:a.playerToken})).status,200);
  assert.equal((await f.request(path,{token:a.playerToken})).status,429);
  assert.equal((await f.request(path,{token:b.playerToken})).status,200);
  for(const member of members){
    assert.equal((await f.post(path+'/input',{type:'attack',dir:'up',seq:1},member.playerToken)).status,200);
    assert.equal((await f.post(path+'/input',{type:'attack',dir:'up',seq:2},member.playerToken)).status,429);
    assert.equal((await f.request(path+'/ping',{token:member.playerToken})).status,200);
    assert.equal((await f.request(path+'/ping',{token:member.playerToken})).status,429);
  }
  assert.equal((await f.request('/api/v1/rooms',{method:'POST',data:{name:'Spoofed'},headers:{'X-Forwarded-For':'1.2.3.4'}})).status,429);
});
