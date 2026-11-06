'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const{createHarness}=require('./game-harness.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'../frontend/js',name),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function createDuel(){
  const game=createHarness({'neon-parry-sound':'off'});
  game.run('window.performance={now:()=>Date.now()};Math.random=()=>0.99;');
  for(const name of['duel-boss.js','duel-engine.js','duel-view.js','duel.js'])game.run(source(name));
  game.frameTime=0;return game;
}
function frame(game,elapsed=50){
  game.frameTime+=elapsed;const callbacks=[...game.frames.values()];game.frames.clear();
  for(const callback of callbacks)callback(game.frameTime);
}
function advance(game,duration){for(let elapsed=0;elapsed<duration;elapsed+=50)frame(game);}
function key(game,code,extra={}){
  game.run(`document.dispatchEvent({type:'keydown',code:${JSON.stringify(code)},target:document.getElementById('arena'),${Object.entries(extra).map(([key,value])=>`${key}:${JSON.stringify(value)}`).join(',')}})`);
}
function click(game,id){return game.element(id).listeners.get('click').at(-1)();}
function startPractice(game){game.element('menu-duel').click();game.element('duel-cpu-level').value='normal';game.element('duel-practice').click();frame(game,0);}
function fireTimer(game,ms){return game.run(`(()=>{const entry=[...window.__timers].find(([,timer])=>timer.ms===${ms});if(!entry)throw Error('Missing timer');window.__timers.delete(entry[0]);return entry[1].callback();})()`);}

test('duel keeps the original playable arena and opens a read-only opponent preview',()=>{
  const game=createDuel(),arena=game.element('arena'),fighter=game.element('fighter'),enemies=game.element('enemies');
  const opponent=game.element('duel-opponent'),opponentArena=game.element('duel-opponent-arena');
  for(const id of['duel-arena','duel-fighter','duel-projectiles','duel-battle'])assert.equal(game.element(id),null,id+' must not duplicate the original scene');
  assert.equal(opponent.hidden,true);
  game.element('menu-duel').click();assert.equal(game.element('duel-view').hidden,false);assert.equal(game.element('game-view').hidden,true);assert.equal(game.element('main-menu').hidden,true);
  assert.equal(opponent.hidden,true);
  game.element('duel-practice').click();frame(game,0);
  assert.equal(game.element('duel-view').hidden,true);assert.equal(game.element('game-view').hidden,false);assert.equal(game.element('arena'),arena);assert.equal(game.element('fighter'),fighter);assert.equal(game.element('enemies'),enemies);
  assert.equal(opponent.hidden,false);assert.ok(opponentArena.querySelector('.fighter'));
  assert.equal(game.run("document.querySelectorAll('#arena').length"),1);assert.equal(game.run("document.querySelectorAll('#fighter').length"),1);
  assert.equal(opponentArena.querySelectorAll('[data-dir]').length,0);
  assert.equal(game.element('duel-opponent-name').textContent,'CPU');
  assert.equal(game.element('overlay-title').textContent,'3');assert.equal(game.element('score-label').textContent,'Defenses');assert.equal(game.element('vulnerability-value').textContent,'0%');assert.equal(game.element('best').textContent,'0%');
  assert.match(game.element('run-label').textContent,/CPU practice/);assert.equal(game.element('share').hidden,true);
  key(game,'ArrowUp',{shiftKey:true});assert.equal(game.element('message').textContent,'');
  advance(game,2200);assert.equal(game.element('overlay').hidden,true);assert.equal(game.element('skill-meter').getAttribute('aria-valuemax'),'3');
});

test('original skill button and Space select one attack while Shift attacks without held-key repeats',()=>{
  const game=createDuel();startPractice(game);advance(game,2200);
  assert.equal(game.element('arena').dataset.stance,'guard');
  key(game,'ArrowUp');frame(game);
  assert.match(game.element('message').textContent,/Empty guard.*\+4%p/);
  assert.equal(game.element('vulnerability-value').textContent,'4%');
  game.element('skill').click();assert.equal(game.element('skill').getAttribute('aria-pressed'),'true');assert.equal(game.element('arena').dataset.stance,'attack');
  key(game,'ArrowRight');frame(game);assert.match(game.element('message').textContent,/Attack sent →/);assert.equal(game.element('skill').getAttribute('aria-pressed'),'false');assert.equal(game.element('arena').dataset.stance,'guard');
  assert.equal(game.element('fighter').dataset.pose,'right');assert.ok(game.element('effects').children.length>0);
  const opponentArena=game.element('duel-opponent-arena');
  assert.equal(opponentArena.querySelectorAll('[data-kind="virus"]').length,1,'the manual shot appears on the right');
  assert.equal(opponentArena.querySelector('[data-kind="virus"]').getAttribute('visibility'),'visible');
  assert.equal(game.element('enemies').children.length,0);
  assert.equal(game.element('vulnerability-value').textContent,'4%','a deliberate attack does not add vulnerability');
  key(game,'Space');assert.equal(game.element('arena').dataset.stance,'attack');key(game,'Space',{repeat:true});assert.equal(game.element('arena').dataset.stance,'attack');key(game,'Space');assert.equal(game.element('arena').dataset.stance,'guard');
  advance(game,350);key(game,'ArrowDown',{shiftKey:true,repeat:true});frame(game);assert.match(game.element('message').textContent,/Attack sent →/);
  key(game,'ArrowDown',{shiftKey:true});frame(game);assert.match(game.element('message').textContent,/Attack sent ↓/);assert.equal(game.element('arena').dataset.stance,'guard');
  assert.equal(game.element('fighter').dataset.pose,'down');assert.equal(game.element('enemies').children.length,0,'outgoing commands never become incoming scene actors');
  assert.equal(opponentArena.querySelectorAll('[data-kind="virus"]').length,2);
});

test('faster CPU attacks use the original Virus actor and perfect-parry effects',()=>{
  const game=createDuel();startPractice(game);advance(game,2800);
  const actor=game.run("enemies.find(enemy=>enemy.dir==='left')");
  assert.equal(actor.kind,'virus');assert.equal(actor.node.getAttribute('data-kind'),'virus');assert.equal(actor.at,2800);assert.equal(actor.arrival,4713);assert.equal(actor.travel,1913);
  assert.equal(game.element('duel-opponent-arena').querySelectorAll('[data-kind="virus"]').length,0,'CPU attack travels in the local arena only');
  assert.equal(actor.outline.getAttribute('d'),game.run("shapePath('virus')"));assert.equal(actor.node.parentNode,game.element('enemies'));
  advance(game,1950);key(game,'ArrowLeft');frame(game,0);
  assert.match(game.element('message').textContent,/Perfect/);assert.equal(game.element('score').textContent,'1');assert.equal(game.element('vulnerability-value').textContent,'0%');
  assert.equal(game.element('fighter').dataset.pose,'left');assert.equal(game.element('fighter').dataset.flash,'true');assert.equal(actor.node.parentNode,null);assert.ok(game.element('foreground-fx').children.length>0);assert.ok(game.element('effects').children.length>0);
  advance(game,200);assert.equal(game.element('vulnerability').getAttribute('aria-valuenow'),'0');
});

test('vulnerability ends CPU practice and retry resets both arenas for a fresh countdown',()=>{
  const game=createDuel();startPractice(game);advance(game,2200);
  key(game,'ArrowRight',{shiftKey:true});advance(game,11800);
  assert.equal(game.element('vulnerability-value').textContent,'100%');assert.equal(game.element('overlay-title').textContent,'Core disconnected');assert.equal(game.element('action').textContent,'Retry');assert.equal(game.element('overlay').hidden,false);
  assert.equal(game.element('duel-opponent-vulnerability').textContent,'15%','only the manual shot damages the CPU');
  game.element('action').click();frame(game,0);
  assert.equal(game.element('overlay-title').textContent,'3');assert.equal(game.element('vulnerability-value').textContent,'0%');assert.equal(game.element('best').textContent,'0%');assert.equal(game.element('skill-meter').getAttribute('aria-valuenow'),'2.00');assert.equal(game.element('enemies').children.length,0);
  assert.equal(game.element('duel-opponent').hidden,false);
  assert.equal(game.element('duel-opponent-vulnerability').textContent,'0%');
  assert.equal(game.element('duel-opponent-arena').querySelectorAll('[data-kind="virus"]').length,0);
});

test('returning from duel restores paused single-player globals, exact enemy nodes, sprite paths and storage',async()=>{
  const game=createDuel();
  game.run("Object.assign(runSelection,{mode:'stage',difficulty:'hard',stage:3,skill:'decoy'});launchRun();score=17;clock=3400;vulnerability=30;charge=7;spawnEnemy('right',3200,2200,'virus');strikePose('up',true);returnToMenu();window.__soloEnemies=enemies;window.__soloEnemy=enemies[0];window.__soloEnemyNode=enemies[0].node;window.__soloSpriteNodes=[...$('fighter').querySelectorAll('path')];window.__soloSpritePaths=window.__soloSpriteNodes.map(node=>node.getAttribute('d'));window.__soloArena=$('arena');window.__soloFighter=$('fighter');");
  const original=game.plain('({runSelection,activeRun,score,clock,vulnerability,charge,mode,GUARD_WINDOW,PERFECT_WINDOW,COOLDOWN})'),storage=game.snapshotStorage();
  startPractice(game);advance(game,5000);key(game,'ArrowLeft');frame(game,0);key(game,'ArrowRight',{shiftKey:true});frame(game);
  assert.equal(game.run("window.__soloEnemyNode.parentNode===null"),true);
  game.element('menu-open').click();await settle();
  assert.equal(game.element('duel-view').hidden,true);assert.equal(game.element('main-menu').hidden,false);assert.equal(game.run('window.NeonDuel.isActive()'),false);
  assert.equal(game.element('duel-opponent').hidden,true);
  assert.equal(game.element('duel-opponent-arena').children.length,0);
  assert.deepEqual(game.plain('({runSelection,activeRun,score,clock,vulnerability,charge,mode,GUARD_WINDOW,PERFECT_WINDOW,COOLDOWN})'),original);assert.deepEqual(game.snapshotStorage(),storage);
  assert.equal(game.run("enemies===window.__soloEnemies&&enemies[0]===window.__soloEnemy&&enemies[0].node===window.__soloEnemyNode&&window.__soloEnemyNode.parentNode===$('enemies')"),true);
  assert.equal(game.run("$('arena')===window.__soloArena&&$('fighter')===window.__soloFighter&&[...$('fighter').querySelectorAll('path')].every((node,index)=>node===window.__soloSpriteNodes[index]&&node.getAttribute('d')===window.__soloSpritePaths[index])"),true);
  game.run('continueRun();');assert.equal(game.run('mode'),'running');assert.equal(game.run('score'),17);assert.equal(game.run('clock'),3400);assert.equal(game.element('game-view').hidden,false);
});

function installOnline(game){
  game.run(`
    window.__now=10000;Date.now=()=>window.__now;
    window.__timers=new Map();window.__timerId=0;
    window.setTimeout=(callback,ms)=>{const id=++window.__timerId;window.__timers.set(id,{callback,ms});return id;};window.clearTimeout=id=>window.__timers.delete(id);
    window.__room={code:'ABC234',phase:'waiting',players:[{id:'me',name:'Me',ready:false},{id:'other',name:'Other',ready:false}],match:null};
    window.__state=null;window.__callbacks=null;window.__pendingInput=null;window.__resolveRoom=null;window.__deferGetRoom=false;
    window.__autoOpen=true;window.__closed=0;window.__cancelled=[];window.__left=[];window.__getBattleCalls=0;window.__findCalls=0;window.__getMatchCalls=0;window.__sendCalls=[];window.__connectCalls=0;window.__deferBattle=false;window.__battleResolvers=[];
    window.__ticket={ticketId:'ticket-1',ticketToken:'ticket-secret',status:'waiting',serverTime:10000};window.__nextTicket=null;window.__deferFind=false;window.__resolveFind=null;window.__deferPoll=false;window.__resolvePoll=null;
    window.__roundId='round-1';window.__startAt=10000;window.__mode='classic';
    window.__startRound=()=>{
      const players=window.__room.players;
      window.__room={...window.__room,phase:'playing',match:{id:window.__roundId,startAt:window.__startAt,players}};
      const match=NeonDuelEngine.createMatch({players:players.map(p=>p.id),startAt:window.__startAt,mode:window.__mode});
      window.__state={room:window.__room,battle:NeonDuelEngine.snapshot(match,window.__startAt),serverTime:window.__startAt};
      return window.__room;
    };
    window.__matched=()=>{window.__startRound();return{...window.__ticket,status:'matched',room:window.__room,playerId:'me',playerToken:'token'};};
    window.__client={
      createRoom:async()=>({room:window.__room,playerId:'me',playerToken:'token'}),
      setReady:async()=>window.__startRound(),
      getBattle:()=>{window.__getBattleCalls++;return window.__deferBattle?new Promise(resolve=>window.__battleResolvers.push(resolve)):Promise.resolve(window.__state);},
      connectBattle:(code,token,callbacks)=>{window.__connectCalls++;window.__callbacks=callbacks;if(window.__autoOpen)callbacks.onOpen();return{close(){window.__closed++;}};},
      sendInput:async(code,token,input)=>{window.__sendCalls.push(input);return{ok:true,state:window.__pendingInput||window.__state};},
      getRoom:()=>window.__deferGetRoom?new Promise(resolve=>{window.__resolveRoom=resolve;}):Promise.resolve(window.__room),
      leaveRoom:async(code,token)=>{window.__left.push({code,token});return{closed:false};},
      findMatch:()=>{window.__findCalls++;return window.__deferFind?new Promise(resolve=>{window.__resolveFind=resolve;}):Promise.resolve(window.__ticket);},
      getMatch:()=>{window.__getMatchCalls++;return window.__deferPoll?new Promise(resolve=>{window.__resolvePoll=resolve;}):Promise.resolve(window.__nextTicket||window.__ticket);},
      cancelMatch:async(id,token)=>{window.__cancelled.push({id,token});return{cancelled:true};}
    };
    window.NeonOnline={createClient:()=>window.__client};
  `);
  game.element('menu-duel').click();game.element('duel-server-url').value='https://duel.example';
}
async function startOnline(game){installOnline(game);await click(game,'duel-create');await click(game,'duel-ready');frame(game,0);}

test('online snapshots show the opponent parrying and taking damage on the right only',async()=>{
  const game=createDuel();await startOnline(game);
  const opponentArena=game.element('duel-opponent-arena'),opponentFighter=opponentArena.querySelector('.fighter');
  assert.equal(game.element('duel-opponent-name').textContent,'Other');
  game.run(`
    window.__realMatch=NeonDuelEngine.createMatch({players:['me','other'],startAt:10000});
    window.__publishDuel=at=>{
      window.__now=at;
      window.__callbacks.onState({room:window.__room,battle:NeonDuelEngine.snapshot(window.__realMatch,at),serverTime:at});
    };
    NeonDuelEngine.input(window.__realMatch,'me',{type:'attack',dir:'up'},10000);
    window.__publishDuel(10100);
  `);frame(game);
  assert.ok(opponentArena.querySelector('[data-kind="virus"]'));
  assert.equal(game.element('enemies').children.length,0);

  game.run("NeonDuelEngine.input(window.__realMatch,'other',{type:'guard',dir:'up'},12200);window.__publishDuel(12200);");frame(game);
  assert.equal(opponentArena.querySelector('[data-kind="virus"]'),null);
  assert.equal(opponentFighter.dataset.pose,'up');
  assert.equal(opponentFighter.dataset.flash,'true');
  assert.equal(game.element('fighter').dataset.pose,'idle');
  assert.equal(game.element('score').textContent,'0');
  assert.equal(game.element('duel-opponent-vulnerability').textContent,'0%');

  game.run("NeonDuelEngine.input(window.__realMatch,'me',{type:'attack',dir:'right'},12550);window.__publishDuel(12600);");frame(game);
  assert.ok(opponentArena.querySelector('[data-kind="virus"]'));
  game.run('window.__publishDuel(15112);');frame(game);
  assert.equal(opponentArena.querySelector('[data-kind="virus"]'),null);
  assert.ok(opponentArena.querySelector('[data-fx="damage"]'));
  assert.equal(game.element('arena').querySelector('[data-fx="damage"]'),null);
  assert.equal(game.element('duel-opponent-vulnerability').textContent,'15%');
  assert.equal(game.element('vulnerability-value').textContent,'0%');

  game.run('window.__publishDuel(15500);');frame(game);
  assert.equal(opponentArena.querySelector('[data-fx="damage"]'),null,'new snapshots do not replay the same damage effect');
  assert.equal(game.element('duel-opponent-vulnerability').textContent,'15%');
});

test('four-player duel routes attacks and upgrade picks through their visible controls',async()=>{
  const game=createDuel();installOnline(game);
  game.run("window.__mode='clash';window.__room.players.push({id:'byte',name:'Byte'},{id:'rook',name:'Rook'});");
  await click(game,'duel-create');await click(game,'duel-ready');frame(game,0);

  const tiles=game.element('duel-opponent-tiles').querySelectorAll('[data-duel-target]');
  assert.equal(tiles.length,3);
  tiles[2].click();
  key(game,'ArrowRight',{shiftKey:true});
  assert.equal(game.run('window.__sendCalls[0].targetId'),'rook');
  assert.equal(game.run('window.__sendCalls[1].targetId'),'rook','an attack immediately after a click uses the clicked target');
  await settle();

  game.run(`
    window.__now=18000;
    const match=NeonDuelEngine.createMatch({players:window.__room.players.map(player=>player.id),startAt:10000,mode:'clash',seed:123});
    window.__callbacks.onState({room:window.__room,battle:NeonDuelEngine.snapshot(match,18000),serverTime:18000});
  `);
  frame(game);
  const slot=game.element('duel-upgrade-slot');
  const choices=slot.querySelectorAll('[data-duel-upgrade]');
  assert.ok(slot.parentNode.children.indexOf(slot)<slot.parentNode.children.findIndex(node=>node.classList.contains('console')));
  assert.equal(choices.length,3);
  assert.equal(game.element('duel-speed').textContent,'Shot speed +45%');
  assert.equal(game.element('duel-upgrades').hidden,false);
  assert.equal(game.element('overlay').hidden,true,'drafting leaves the arena playable');
  key(game,'Digit2',{shiftKey:true});await settle();
  assert.equal(game.run('window.__sendCalls[2].type'),'upgrade');
  assert.equal(game.run('window.__sendCalls[2].offerId'),'offer-1');
  assert.equal(game.run('window.__sendCalls[2].choiceId'),choices[1].getAttribute('data-duel-upgrade'));
});

test('a duel boss locks player attacks and shows each arena’s own fight',async()=>{
  const game=createDuel();installOnline(game);
  game.run("window.__mode='clash';");
  await click(game,'duel-create');await click(game,'duel-ready');frame(game,0);
  game.run(`
    window.__bossMatch=NeonDuelEngine.createMatch({players:['me','other'],startAt:10000,mode:'clash'});
    window.__showBoss=at=>{
      window.__now=at;
      window.__callbacks.onState({room:window.__room,battle:NeonDuelEngine.snapshot(window.__bossMatch,at),serverTime:at});
    };
    window.__showBoss(70000);
  `);
  frame(game);
  assert.equal(game.element('boss-banner-title').textContent,'Fake Domain');
  assert.equal(game.element('duel-upgrades').hidden,true);
  assert.equal(game.element('skill').disabled,true);
  key(game,'ArrowRight',{shiftKey:true});
  assert.equal(game.run('window.__sendCalls.length'),0);

  game.run(`
    window.__showBoss(71750);
    const mine=window.__bossMatch.players[0].boss;
    const incoming=mine.attacks[0];
    NeonDuelEngine.input(window.__bossMatch,'me',{type:'guard',dir:incoming.dir},incoming.impactAt);
    window.__showBoss(incoming.impactAt);
  `);
  frame(game);
  assert.equal(game.element('boss-entities').querySelectorAll('.domain-number').length,3);
  assert.equal(game.element('duel-opponent-arena').querySelectorAll('.boss-node').length,1);
  assert.equal(game.element('duel-opponent-arena').querySelectorAll('.domain-number').length,0);

  game.run(`
    Object.assign(window.__bossMatch.players[0].boss,{phase:'done',phaseUntil:null,result:'cleared'});
    window.__showBoss(window.__now);
  `);
  frame(game);
  assert.equal(game.element('overlay-title').textContent,'Boss cleared');
  assert.match(game.element('overlay-copy').textContent,/Waiting for the other players/);
});

test('an older SSE snapshot cannot undo a newer authoritative input response in the original sidebar',async()=>{
  const game=createDuel();await startOnline(game);
  game.run("window.__pendingInput=JSON.parse(JSON.stringify(window.__state));window.__pendingInput.battle.now=10200;window.__pendingInput.serverTime=10200;window.__pendingInput.battle.players[0].vulnerability=40;window.__pendingInput.battle.events=[{id:9,at:10200,type:'hit',playerId:'me',damage:25}];");
  key(game,'ArrowUp');await settle();frame(game);assert.equal(game.element('vulnerability-value').textContent,'40%');
  game.run('window.__callbacks.onState(window.__state);');frame(game);assert.equal(game.element('vulnerability-value').textContent,'40%');
  game.run("window.__state.battle.now=10200;window.__state.serverTime=10200;window.__state.battle.players[0].vulnerability=15;window.__state.battle.events=[{id:8,at:10200,type:'hit',playerId:'me',damage:15}];window.__callbacks.onState(window.__state);");
  frame(game);assert.equal(game.element('vulnerability-value').textContent,'40%','event order breaks ties within the same millisecond');
});

test('leaving while an online retry request is pending cannot remount the original game view',async()=>{
  const game=createDuel();await startOnline(game);
  game.run("window.__state.battle.status='finished';window.__state.battle.winnerId='me';window.__state.battle.finishedAt=10000;window.__state.room.phase='finished';window.__callbacks.onState(window.__state);window.__deferGetRoom=true;");frame(game);
  assert.equal(game.element('action').textContent,'Rematch');const pending=game.run('window.NeonDuel.action()');game.element('menu-open').click();game.run('window.__resolveRoom(window.__room);');await assert.doesNotReject(pending);await settle();
  assert.equal(game.element('duel-view').hidden,true);assert.equal(game.element('game-view').hidden,true);assert.equal(game.element('main-menu').hidden,false);assert.equal(game.run('window.NeonDuel.isActive()'),false);
});

test('a pre-ready waiting-room poll resolving after connect cannot unmount the battle view',async()=>{
  const game=createDuel();installOnline(game);await click(game,'duel-create');game.run('window.__deferGetRoom=true;window.__oldWaitingRoom=JSON.parse(JSON.stringify(window.__room));');
  const pendingPoll=fireTimer(game,800);await click(game,'duel-ready');assert.equal(game.run('window.NeonDuel.isActive()'),true);
  game.run('window.__resolveRoom(window.__oldWaitingRoom);');await pendingPoll;frame(game,0);
  assert.equal(game.element('game-view').hidden,false);assert.equal(game.run('window.NeonDuel.isActive()'),true);assert.equal(game.run('window.__connectCalls'),1);
});

test('a late playing-room poll cannot open a second stream while clock calibration is pending',async()=>{
  const game=createDuel();installOnline(game);await click(game,'duel-create');game.run('window.__deferGetRoom=true;window.__deferBattle=true;');
  const pendingPoll=fireTimer(game,800),pendingReady=click(game,'duel-ready');await settle();game.run('window.__resolveRoom(window.__room);');await settle();
  game.run('window.__deferBattle=false;for(const resolve of window.__battleResolvers)resolve(window.__state);');await Promise.all([pendingPoll,pendingReady]);
  assert.equal(game.run('window.__getBattleCalls'),1);assert.equal(game.run('window.__connectCalls'),1);assert.equal(game.run('window.NeonDuel.isActive()'),true);
});

test('callbacks from a closed prior round cannot replace a new rematch in the same room',async()=>{
  const game=createDuel();await startOnline(game);
  game.run("window.__oldCallbacks=window.__callbacks;window.__state.battle.status='finished';window.__state.battle.winnerId='other';window.__state.battle.players[0].vulnerability=100;window.__state.room.phase='finished';window.__callbacks.onState(window.__state);window.__oldRoundState=JSON.parse(JSON.stringify(window.__state));");
  await game.run('window.NeonDuel.action()');game.run("window.__roundId='round-2';window.__now=13000;window.__startAt=13000;");await click(game,'duel-ready');frame(game,0);
  assert.equal(game.element('vulnerability-value').textContent,'0%');assert.equal(game.element('action').textContent,'Leave duel');
  game.run('window.__oldCallbacks.onState(window.__oldRoundState);');frame(game);
  assert.equal(game.element('vulnerability-value').textContent,'0%');assert.equal(game.element('action').textContent,'Leave duel');assert.equal(game.element('overlay').hidden,true);
});

test('random matching stays in its waiting panel without inventing a CPU opponent, then cancels cleanly',async()=>{
  const game=createDuel();installOnline(game);await click(game,'duel-random');
  assert.equal(game.element('duel-matching').hidden,false);assert.equal(game.element('game-view').hidden,true);assert.equal(game.run('window.NeonDuel.isActive()'),false);
  for(let poll=0;poll<5;poll++){await fireTimer(game,1000);advance(game,1000);}
  assert.equal(game.run('window.__getMatchCalls'),5);assert.equal(game.run('window.__getBattleCalls'),0);assert.equal(game.element('enemies').children.length,0);assert.equal(game.element('duel-matching').hidden,false);
  await click(game,'duel-cancel');assert.equal(game.element('duel-setup').hidden,false);assert.equal(game.element('duel-matching').hidden,true);assert.deepEqual(game.plain('window.__cancelled'),[{id:'ticket-1',token:'ticket-secret'}]);assert.equal(game.run('window.__timers.size'),0);
});

test('a matched queue poll automatically enters the original arena and hands off its ticket only when the stream opens',async()=>{
  const game=createDuel();installOnline(game);const arena=game.element('arena'),fighter=game.element('fighter');await click(game,'duel-random');
  game.run('window.__autoOpen=false;window.__nextTicket=window.__matched();');await fireTimer(game,1000);frame(game,0);
  assert.equal(game.element('duel-view').hidden,true);assert.equal(game.element('game-view').hidden,false);assert.equal(game.element('arena'),arena);assert.equal(game.element('fighter'),fighter);assert.equal(game.run('window.__getBattleCalls'),1);assert.equal(game.run('window.__cancelled.length'),0);
  game.run('window.__callbacks.onOpen();');await settle();assert.deepEqual(game.plain('window.__cancelled'),[{id:'ticket-1',token:'ticket-secret'}]);
  key(game,'ArrowRight',{shiftKey:true});await settle();assert.equal(game.run('window.__sendCalls[0].type'),'attack');assert.equal(game.run('window.__sendCalls[0].dir'),'right');assert.equal(game.element('arena').dataset.stance,'guard');
});

test('a find response arriving after cancellation cleans up its late ticket without opening a battle',async()=>{
  const game=createDuel();installOnline(game);game.run('window.__deferFind=true;');const pending=click(game,'duel-random');await click(game,'duel-cancel');game.run('window.__resolveFind(window.__matched());');await pending;await settle();
  assert.equal(game.element('duel-setup').hidden,false);assert.equal(game.element('game-view').hidden,true);assert.equal(game.run('window.NeonDuel.isActive()'),false);assert.equal(game.run('window.__getBattleCalls'),0);assert.deepEqual(game.plain('window.__cancelled'),[{id:'ticket-1',token:'ticket-secret'}]);
});

test('a matched poll arriving after cancellation cannot reopen the arena',async()=>{
  const game=createDuel();installOnline(game);await click(game,'duel-random');game.run('window.__deferPoll=true;');const pending=fireTimer(game,1000);await click(game,'duel-cancel');game.run('window.__resolvePoll(window.__matched());');await pending;
  assert.equal(game.element('duel-setup').hidden,false);assert.equal(game.element('game-view').hidden,true);assert.equal(game.run('window.NeonDuel.isActive()'),false);assert.equal(game.run('window.__getBattleCalls'),0);assert.equal(game.run('window.__cancelled.length'),1);
});

test('late stream callbacks from a cancelled search cannot consume or cancel a new waiting ticket',async()=>{
  const game=createDuel();installOnline(game);game.run('window.__ticket=window.__matched();window.__autoOpen=false;');await click(game,'duel-random');
  game.run('window.__oldCallbacks=window.__callbacks;');await game.run('window.NeonDuel.leave()');game.run("window.__ticket={ticketId:'ticket-2',ticketToken:'second-secret',status:'waiting',serverTime:10000};");await click(game,'duel-random');
  game.run('window.__oldCallbacks.onOpen();window.__oldCallbacks.onState(window.__state);');frame(game);
  assert.equal(game.element('duel-matching').hidden,false);assert.equal(game.element('game-view').hidden,true);assert.equal(game.run('window.NeonDuel.isActive()'),false);assert.deepEqual(game.plain('window.__cancelled'),[{id:'ticket-1',token:'ticket-secret'}]);assert.equal(game.run('window.__closed'),1);assert.equal(game.run('window.__left.length'),1);
});
