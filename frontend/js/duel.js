'use strict';

// Networking and match lifecycle only. The existing game owns all battle art.
(() => {
  const Engine=window.NeonDuelEngine, View=window.NeonDuelView, $=id=>document.getElementById(id);
  if(!Engine||!View||!$('duel-view'))return;
  const dirs=['up','right','down','left'];
  const keys={ArrowUp:'up',KeyW:'up',ArrowRight:'right',KeyD:'right',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left'};
  const tr=(en,ko)=>t(en,ko), localOnly=!!(window.neonDesktop||window.NEON_CONFIG?.offlineOnly);
  let session=null,client=null,membership=null,room=null,battle=null,matchTicket=null,randomDuel=false;
  let stream=null,poll=null,frame=null,generation=0,busy=false,connecting=false,stance='guard',connected=false,lastSeen=0,roundId='';
  const MODE='clash', STATE_TIMEOUT=3000;
  let clockOffset=0, clockSamples=[], pingTimer=null, lastRenderAt=-Infinity, seq=0, selectedTarget=null;
  let practiceClock=0,lastFrame=null,nextCpuAttack=0,cpuPlans=new Map(),touches=new Map();
  const predictedGuards=new Map();
  let cpuReactionAt=0;
  const messages={
    OFFLINE:['Set the server address first.','먼저 대전 서버 주소를 설정해 주세요.'],
    NETWORK_ERROR:['Cannot reach the server. CPU practice is available offline.','서버에 연결할 수 없습니다. CPU 연습은 오프라인으로 가능합니다.'],
    ROOM_NOT_FOUND:['This room has expired or does not exist.','방이 없거나 만료되었습니다.'],
    ROOM_FULL:['This room is full or the duel has started.','방이 가득 찼거나 이미 대전 중입니다.'],
    ORIGIN_DENIED:['This page is not allowed by the server.','이 페이지에서 연결할 수 없는 서버입니다.'],
    INVALID_URL:['Enter a valid HTTP(S) server address.','올바른 HTTP(S) 서버 주소를 입력해 주세요.'],
    INVALID_ROOM_CODE:['Enter the six-character room code.','6자리 방 코드를 입력해 주세요.'],
    MATCH_TICKET_NOT_FOUND:['The search expired. Please try again.','매칭 대기가 만료되었습니다. 다시 찾아주세요.'],
    RATE_LIMITED:['Too many requests. Please wait a moment.','요청이 많습니다. 잠시 후 다시 시도해 주세요.']
  };
  function feedback(text=''){$('duel-feedback').textContent=text;}
  function report(error){const pair=messages[error.code];feedback(pair?tr(...pair):tr('Connection failed. Check the server address.','연결에 실패했습니다. 서버 주소를 확인해 주세요.'));}
  function setBusy(value){busy=value;for(const id of ['duel-random','duel-create','duel-join','duel-ready'])$(id).disabled=value||(localOnly&&id!=='duel-ready');}
  function labels(){
    const values={
      'duel-title':['Duel','듀얼'],'duel-back':['← Back','← 뒤로'],'duel-help':['Help','도움말'],
      'duel-random':['Find opponent','랜덤 매칭'],'duel-create':['Create room','방 만들기'],'duel-join':['Join','참가'],
      'duel-practice':['Practice vs CPU','CPU 연습'],'duel-level-label':['Opponent','연습 상대'],
      'duel-settings-label':['Connection settings','접속 설정'],'duel-name-label':['Name','이름'],'duel-server-url-label':['Server address','서버 주소'],
      'duel-online-note':['Random 1v1 or a room for up to 8.','랜덤 1대1 또는 최대 8인 친구방.'],
      'duel-rules-title':['Rules','대전 규칙'],
      'duel-rules-text':['Directions to parry. Empty parries add 4%p vulnerability. Shift + direction to attack.','방향키로 패링하고 Shift + 방향키로 공격합니다. 헛방어를 하면 취약률이 4%p 올라요.'],
      'duel-threats-text':['Pick upgrades with 1–3 or a tap. After every minute of combat, fight a boss on your own arena. The duel resumes when everyone finishes.','능력은 1~3번 키나 터치로 고르세요. 대전 1분마다 각자 보스와 싸우고, 모두 끝나면 대전을 재개합니다.'],
      'duel-matching-label':['Finding opponent…','상대를 찾고 있습니다…'],
      'duel-matching-note':['The duel starts when another player joins matchmaking. You can cancel at any time.','다른 플레이어가 랜덤 매칭에 들어오면 시작합니다. 언제든 취소할 수 있습니다.'],
      'duel-cancel':['Cancel','취소'],'duel-room-label':['Room code · tap to copy','방 코드 · 눌러서 복사'],
      'duel-room-hint':['Share the code. Press Ready once everyone has joined.','방 코드를 공유하세요. 모두 들어온 뒤 준비를 눌러 주세요.'],
      'duel-ready':['Ready','준비'],'duel-leave':['Leave room','방 나가기']
    };
    for(const[id,pair]of Object.entries(values))$(id).textContent=tr(...pair);
    $('duel-code-input').setAttribute('aria-label',tr('Room code','방 코드'));
    if(localOnly)$('duel-online-note').textContent=tr('Online play is available in the server version. CPU practice works here.','온라인 대전은 서버로 실행한 버전에서 이용할 수 있습니다. 여기서는 CPU 연습이 가능합니다.');
    setBusy(false);
  }
  function lobby(panel='duel-setup'){
    View.unmount();$('main-menu').hidden=true;$('game-view').hidden=true;$('menu-open').hidden=true;$('duel-view').hidden=false;
    for(const id of ['duel-setup','duel-room','duel-matching'])$(id).hidden=id!==panel;
    $('duel-help').hidden=panel!=='duel-setup';
  }
  function setup(){lobby();feedback();labels();if(!$('duel-server-url').value)$('duel-server-url').value=window.NEON_CONFIG?.apiBaseUrl||'';}
  function open(){pauseGame();setup();$('duel-title').focus({preventScroll:true});}
  function mount(players){
    View.mount({
      players,selfId:ownId(),onTarget:session==='online'?selectTarget:null,onUpgrade:pickUpgrade,
      upgradesEnabled:session==='practice'||room?.mode===MODE
    });
    $('duel-view').hidden=true;$('main-menu').hidden=true;showGameView();setStance('guard');unlockAudio();
  }
  function resetClock(){
    clearTimeout(pingTimer);pingTimer=null;
    clockOffset=0;clockSamples=[];lastRenderAt=-Infinity;selectedTarget=null;predictedGuards.clear();
    View.setLatency?.(null);
  }
  function stop(){
    generation++;clearTimeout(poll);poll=null;cancelAnimationFrame(frame);frame=null;stream?.close();stream=null;View.unmount();
    session=null;membership=null;room=null;battle=null;matchTicket=null;randomDuel=false;connected=false;connecting=false;roundId='';lastFrame=null;cpuPlans.clear();touches.clear();resetClock();setBusy(false);
  }
  async function leave(toMenu=false){
    const previous=membership,ticket=matchTicket,transport=client;stop();setup();
    if(toMenu){$('duel-view').hidden=true;showMenuView();}
    if(ticket&&transport)try{await transport.cancelMatch(ticket.id,ticket.token);}catch{}
    if(previous&&transport)try{await transport.leaveRoom(previous.code,previous.token);}catch{}
  }
  function transport(){return window.NeonOnline.createClient($('duel-server-url').value.trim());}
  function name(){return $('duel-name').value.trim()||'Player';}
  function joinMembership(result){membership={code:result.room.code,token:result.playerToken,id:result.playerId};room=result.room;session='online';seq=0;}
  async function requestRoom(join){
    if(localOnly||busy)return;setBusy(true);feedback();const current=++generation;
    try{const connection=transport();client=connection;const result=join?await connection.joinRoom($('duel-code-input').value.trim().toUpperCase(),name()):await connection.createRoom(name(),MODE);
      if(current!==generation){connection.leaveRoom(result.room.code,result.playerToken).catch(()=>{});return;}
      randomDuel=false;joinMembership(result);renderRoom(room);pollRoom(current);
    }catch(error){if(current===generation)report(error);}finally{if(current===generation)setBusy(false);}
  }
  function renderRoom(next){
    if(!membership)return;room=next;lobby('duel-room');$('duel-room-code').textContent=next.code;$('duel-players').replaceChildren();
    for(const player of room.players){const li=document.createElement('li'),label=document.createElement('span'),status=document.createElement('span');label.textContent=player.name+(player.id===membership.id?tr(' (you)',' (나)'):'');status.textContent=player.ready?tr('Ready','준비 완료'):tr('Waiting','대기 중');li.append(label,status);$('duel-players').append(li);}
    if(room.players.length<2){const li=document.createElement('li');li.textContent=tr('Waiting for players…','다른 플레이어를 기다리는 중…');$('duel-players').append(li);}
    const mine=room.players.find(p=>p.id===membership.id);$('duel-ready').textContent=mine?.ready?tr('Cancel ready','준비 취소'):tr('Ready','준비');
    $('duel-ready').disabled=busy||['starting','playing'].includes(room.phase);
  }
  function pollRoom(current){
    clearTimeout(poll);if(current!==generation||session!=='online')return;
    poll=setTimeout(async()=>{try{const next=await client.getRoom(membership.code,membership.token);if(current!==generation||connecting||View.isMounted())return;
      if(next.match&&['starting','playing'].includes(next.phase)){room=next;await connect(current);return;}renderRoom(next);
    }catch(error){if(current===generation)report(error);}pollRoom(current);},800);
  }
  async function ready(){
    if(busy||!membership)return;setBusy(true);feedback();const current=generation;
    try{const mine=room?.players.find(p=>p.id===membership.id),next=await client.setReady(membership.code,membership.token,!mine?.ready);if(current!==generation||connecting||View.isMounted())return;
      room=next;if(next.match&&['starting','playing'].includes(next.phase))await connect(current);else renderRoom(next);
    }catch(error){if(current===generation)report(error);}finally{if(current===generation)setBusy(false);}
  }
  async function findOpponent(){
    if(localOnly||busy)return;const current=++generation;setBusy(true);feedback();session='matching';randomDuel=true;lobby('duel-matching');
    try{const connection=transport();client=connection;const result=await connection.findMatch(name(),MODE);
      if(current!==generation){connection.cancelMatch(result.ticketId,result.ticketToken).catch(()=>{});return;}
      matchTicket={id:result.ticketId,token:result.ticketToken};await matchingState(result,current);
    }catch(error){if(current===generation){session=null;setup();report(error);}}finally{if(current===generation)setBusy(false);}
  }
  async function matchingState(result,current){
    if(current!==generation)return;
    if(result.status==='matched'&&result.room){joinMembership(result);await connect(current);return;}
    if(result.status==='cancelled'){await leave();feedback(tr('The opponent left. Please search again.','상대가 나갔습니다. 다시 매칭해 주세요.'));return;}
    session='matching';lobby('duel-matching');clearTimeout(poll);
    poll=setTimeout(async()=>{if(current!==generation||!matchTicket)return;try{const next=await client.getMatch(matchTicket.id,matchTicket.token);await matchingState(next,current);}catch(error){if(current===generation){await leave();report(error);}}},1000);
  }
  function noteClock({serverTime,midpoint,rttMs}){
    if(![serverTime,midpoint,rttMs].every(Number.isFinite)||rttMs<0)return;
    clockSamples.push({offset:serverTime-midpoint,rttMs});
    if(clockSamples.length>5)clockSamples.shift();
    const best=clockSamples.reduce((fastest,sample)=>sample.rttMs<=fastest.rttMs?sample:fastest);
    clockOffset=best.offset;
    View.setLatency?.(rttMs);
  }
  async function calibrate(isCurrent,transport,member){
    const before=Date.now(),state=await transport.getBattle(member.code,member.token),after=Date.now();
    if(!isCurrent())return;
    noteClock({serverTime:state.serverTime,midpoint:(before+after)/2,rttMs:after-before});
    consume(state);
  }
  function samplePing(isCurrent,transport,member,delay){
    if(!transport.ping)return;
    clearTimeout(pingTimer);
    pingTimer=setTimeout(async()=>{
      if(!isCurrent()||battle?.status==='finished')return;
      try{
        const sample=await transport.ping(member.code,member.token);
        if(isCurrent()&&battle?.status!=='finished')noteClock(sample);
      }catch(error){
        if(error.status===404||error.status===405)return;
      }
      if(isCurrent()&&battle?.status!=='finished')samplePing(isCurrent,transport,member,8000);
    },delay);
  }
  async function connect(current){
    if(stream||connecting||current!==generation)return;
    connecting=true;clearTimeout(poll);resetClock();
    roundId=room.match?.id||'';
    const connectingRound=roundId,transport=client,member=membership;
    mount(room.match?.players||room.players);
    View.banner('⌖',tr('Connecting…','연결 중…'),'');feedback();
    const isCurrent=()=>current===generation&&roundId===connectingRound&&View.isMounted();
    const firstState=calibrate(isCurrent,transport,member).catch(error=>{if(isCurrent()&&!battle)report(error);});
    stream=transport.connectBattle(member.code,member.token,{
      onState:state=>{if(isCurrent())consume(state);},
      onOpen:()=>{if(!isCurrent())return;if(matchTicket){const ticket=matchTicket;matchTicket=null;transport.cancelMatch(ticket.id,ticket.token).catch(()=>{});}},
      onError:()=>{if(isCurrent())connected=false;}
    });
    samplePing(isCurrent,transport,member,0);
    lastFrame=null;cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);
    await firstState;
    if(isCurrent())connecting=false;
  }
  function consume(state){
    if(!state.battle)return;const id=state.room?.match?.id;
    if(id&&roundId&&id!==roundId)return;
    if(battle){if(state.battle.now<battle.now)return;if(state.battle.now===battle.now&&(state.battle.events.at(-1)?.id||0)<(battle.events.at(-1)?.id||0))return;}
    if(!battle&&!clockSamples.length)clockOffset=state.serverTime-Date.now();
    room=state.room;battle=state.battle;connected=true;lastSeen=performance.now();
    if(battle.status==='finished'){clearTimeout(pingTimer);pingTimer=null;}
  }
  function practice(){
    stop();session='practice';practiceClock=0;nextCpuAttack=2800;cpuReactionAt=0;seq=0;
    battle=Engine.createMatch({players:['you','cpu'],startAt:2200,mode:MODE,seed:Math.floor(Math.random()*2**32)});
    mount([{id:'you',name:tr('You','나')},{id:'cpu',name:'CPU'}]);
    lastFrame=null;frame=requestAnimationFrame(draw);$('arena').focus({preventScroll:true});
  }
  function runCpu(at){
    if(battle.status!=='running')return;
    const cpu=battle.players.find(player=>player.id==='cpu');
    if(cpu.eliminated)return;
    const level=$('duel-cpu-level').value;
    const config=level==='rookie'?{guard:.35,jitter:210,pace:950}:level==='expert'?{guard:.9,jitter:100,pace:550}:{guard:.7,jitter:170,pace:700};
    const fight=cpu.boss;
    if(fight?.phase==='reaction'){
      if(at>=cpuReactionAt){
        Engine.input(battle,'cpu',{type:'guard',dir:fight.sequence[fight.sequenceIndex]},at);
        cpuReactionAt=at+260;
      }
      return;
    }
    const attacks=battle.boss
      ?fight.attacks
      :battle.attacks.filter(attack=>attack.to==='cpu'&&attack.state!=='dormant');
    const byId=new Map(attacks.map(attack=>[attack.attackId??attack.id,attack]));
    for(const [id,attack] of byId){
      if(cpuPlans.has(id))continue;
      const attempt=Math.random()<config.guard?attack.impactAt+(Math.random()*2-1)*config.jitter:Infinity;
      cpuPlans.set(id,Math.max(attack.launchedAt,attack.revealAt??-Infinity,attempt));
    }
    for(const [id,atGuard] of cpuPlans){
      const attack=byId.get(id);
      if(!attack||!attacks.includes(attack)){cpuPlans.delete(id);continue;}
      if(at>=atGuard){
        Engine.input(battle,'cpu',{type:'guard',dir:attack.dir},at);
        cpuPlans.set(id,Infinity);
        if(battle.boss&&fight.phase!=='active')break;
      }
    }
    if(!battle.boss&&at>=nextCpuAttack){
      const result=Engine.input(battle,'cpu',{type:'attack',dir:dirs[Math.floor(Math.random()*4)]},at);
      nextCpuAttack=at+(result.ok?config.pace+Math.random()*350:100);
    }
  }
  const ownId=()=>session==='practice'?'you':membership?.id;
  const now=()=>session==='practice'?practiceClock:Math.max(lastRenderAt,Date.now()+clockOffset);
  const canSend=()=>connected&&performance.now()-lastSeen<=STATE_TIMEOUT;
  function render(state,at){
    const me=state.players.find(p=>p.id===ownId()),rival=state.players.find(p=>p.id!==ownId());if(!me||!rival)return;
    const opponentName=session==='practice'?'CPU':room?.players.find(p=>p.id===rival.id)?.name||tr('Opponent','상대');
    let energy=me.energy;
    if(state.status==='running'&&!me.eliminated&&at>state.now){
      const personalRecharge=1+(me.upgrades?.recharge||0)/100;
      const gained=Number.isFinite(state.rechargeRate)
        ?Engine.baseEnergyGain(state,state.now,at)
        :(at-state.now)/Engine.RULES.energyRechargeMs;
      energy=Math.min(Engine.RULES.energyMax,energy+gained*personalRecharge);
    }
    const connection=session==='practice'?tr('CPU practice','CPU 연습'):canSend()||state.status==='finished'?'':tr('Reconnecting','재연결 중');
    if(state.boss&&stance==='attack')setStance('guard');
    View.render(state,ownId(),at,{opponentName,energy,connection,stance,online:session==='online'});
    $('action').textContent=state.status==='finished'?session==='practice'?tr('Retry','재도전'):randomDuel?tr('Find next opponent','다음 상대 찾기'):tr('Rematch','재대전'):tr('Leave duel','대전 나가기');
    if(state.status==='countdown')View.banner('⌖',String(Math.max(1,Math.ceil((state.startAt-at)/1000))),tr('Directions: parry · Shift + direction: attack','방향키: 패링 · Shift + 방향: 공격'));
    else if(state.status==='finished'){
      const won=state.winnerId===ownId();
      const title=state.winnerId===null?tr('Draw','무승부'):won?tr('Victory','승리'):tr('Core disconnected','코어 연결 끊김');
      const detail=state.finishReason==='forfeit'?tr('An opponent left the duel.','상대가 대전에서 나갔습니다.'):won?tr('Last core standing.','마지막까지 버텼습니다.'):tr('Vulnerability reached 100%.','취약률이 100%에 도달했습니다.');
      View.banner(won?'✓':'×',title,detail);
    }else if(session==='online'&&!canSend())View.banner('Ⅱ',tr('Reconnecting…','재연결 중…'),tr('The duel continues on the server.','서버에서는 대전이 계속 진행됩니다.'));
    else if(me.eliminated)View.banner('×',tr('Eliminated','탈락'),tr('Watch the remaining players.','남은 플레이어의 대전을 볼 수 있어요.'));
    else if(me.boss?.phase==='done'){
      const cleared=me.boss.result==='cleared';
      View.banner(cleared?'✓':'Ⅱ',cleared?tr('Boss cleared','보스 처치'):tr('Boss escaped','보스 이탈'),
        tr('Waiting for the other players to finish.','다른 플레이어의 보스전이 끝나면 대전을 재개합니다.'));
    }else View.hideBanner();
  }
  function draw(timestamp){
    if(!session||session==='matching')return;if(!battle){frame=requestAnimationFrame(draw);return;}
    if(session==='practice'){practiceClock+=lastFrame===null?0:Math.max(0,Math.min(50,timestamp-lastFrame));Engine.advance(battle,practiceClock);runCpu(practiceClock);render(Engine.snapshot(battle,practiceClock),practiceClock);}else{lastRenderAt=now();render(battle,lastRenderAt);}
    lastFrame=timestamp;frame=requestAnimationFrame(draw);
  }
  function setStance(value){stance=value;View.setStance(value);}
  function send(command){
    const current=generation,matchId=roundId;
    const isCurrent=()=>current===generation&&roundId===matchId&&View.isMounted();
    return client.sendInput(membership.code,membership.token,{...command,matchId,seq:++seq}).then(result=>{
      if(!isCurrent())return;
      if(result.state)consume(result.state);
      if(!result.ok&&result.reason==='energy')View.setMessage(tr('Attack charging','공격 충전 중'),'var(--muted)');
    }).catch(()=>{
      if(isCurrent())View.setMessage(tr('Input did not reach the server','입력이 서버에 닿지 않았어요'),'var(--muted)');
    });
  }
  function pickUpgrade(offerId,choiceId){
    if(battle?.status!=='running'||battle.boss)return;
    const offer=battle.players.find(player=>player.id===ownId()&&!player.eliminated)?.offer;
    if(!offer||offer.id!==offerId||!offer.choices.some(choice=>choice.id===choiceId))return;
    const command={type:'upgrade',offerId,choiceId};
    if(session==='practice')Engine.input(battle,'you',{...command,seq:++seq},now());
    else if(canSend())send(command);
  }
  function selectTarget(targetId){
    if(session!=='online'||battle?.mode!==MODE||battle.status!=='running'||battle.boss||!canSend())return;
    const me=battle.players.find(player=>player.id===ownId());
    if(me?.eliminated||!battle.players.some(player=>player.id===targetId&&player.id!==ownId()&&!player.eliminated))return;
    selectedTarget=targetId;
    View.setTarget?.(targetId);
    send({type:'target',targetId});
  }
  function command(dir,type=stance,inputAt=now()){
    if(!battle||battle.status!=='running'||!dirs.includes(dir)||battle.players.find(player=>player.id===ownId())?.eliminated)return;
    if(session==='online'&&!canSend())return;
    if(battle.boss&&(type==='attack'||battle.players.find(player=>player.id===ownId())?.boss?.phase==='done'))return;
    if(type==='attack')setStance('guard');
    if(session==='practice'){
      const result=Engine.input(battle,'you',{type,dir,seq:++seq},inputAt);
      if(!result.ok&&result.reason==='energy')View.setMessage(tr('Attack charging','공격 충전 중'),'var(--muted)');
      return;
    }
    if(type==='guard'&&!battle.boss){
      const pressedAt=performance.now(),lastPress=predictedGuards.get(dir)??-Infinity;
      if(pressedAt-lastPress>=(battle.rules?.guardCooldownMs||Engine.RULES.guardCooldownMs)){
        View.predictGuard?.(dir);
        predictedGuards.set(dir,pressedAt);
      }
    }
    const targetId=type==='attack'&&battle.players.some(player=>player.id===selectedTarget&&!player.eliminated)?selectedTarget:undefined;
    send({type,dir,targetId});
  }
  async function action(){
    if(!battle||battle.status!=='finished'){await leave();return;}
    if(session==='practice'){practice();return;}
    if(randomDuel){const current=generation;await leave();if(generation===current+1)await findOpponent();return;}
    if(busy||!membership)return;const current=generation;roundId='';stream?.close();stream=null;cancelAnimationFrame(frame);frame=null;battle=null;connected=false;resetClock();
    const next=await client.getRoom(membership.code,membership.token).catch(()=>room);if(current!==generation||!membership)return;renderRoom(next);pollRoom(current);
  }
  $('menu-duel').addEventListener('click',open);$('duel-back').addEventListener('click',()=>leave(true));
  $('duel-help').addEventListener('click',()=>openHelp('duel'));
  $('duel-practice').addEventListener('click',practice);$('duel-create').addEventListener('click',()=>requestRoom(false));$('duel-join').addEventListener('click',()=>requestRoom(true));
  $('duel-random').addEventListener('click',findOpponent);$('duel-cancel').addEventListener('click',()=>leave());$('duel-leave').addEventListener('click',()=>leave());$('duel-ready').addEventListener('click',ready);
  $('duel-code-input').addEventListener('keydown',event=>{if(event.code==='Enter')requestRoom(true);});
  $('duel-room-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(room.code);feedback(tr('Room code copied.','방 코드를 복사했습니다.'));}catch{feedback(tr('Share this code: ','이 코드를 공유하세요: ')+room.code);}});
  $('skill').addEventListener('click',()=>{if(View.isMounted()&&battle?.status==='running'&&!battle.boss)setStance(stance==='guard'?'attack':'guard');});
  $('arena').addEventListener('pointerdown',event=>{if(!View.isMounted()||event.button>0)return;event.preventDefault();touches.set(event.pointerId,{x:event.clientX,y:event.clientY,at:now(),dir:pointerDirection(event.clientX,event.clientY,event.target),dx:0,dy:0,attack:event.shiftKey});try{$('arena').setPointerCapture(event.pointerId);}catch{}});
  $('arena').addEventListener('pointermove',event=>{const point=touches.get(event.pointerId);if(!point)return;const dx=event.clientX-point.x,dy=event.clientY-point.y;if(Math.hypot(dx,dy)>Math.hypot(point.dx,point.dy)){point.dx=dx;point.dy=dy;}});
  $('arena').addEventListener('pointerup',event=>{
    const point=touches.get(event.pointerId);touches.delete(event.pointerId);if(!point||!View.isMounted())return;
    const dx=event.clientX-point.x,dy=event.clientY-point.y;if(Math.hypot(dx,dy)>Math.hypot(point.dx,point.dy)){point.dx=dx;point.dy=dy;}
    if(Math.hypot(point.dx,point.dy)>=28){const vertical=point.dir==='up'||point.dir==='down';if(point.dir&&(vertical?Math.abs(point.dy)>Math.abs(point.dx)*1.2:Math.abs(point.dx)>Math.abs(point.dy)*1.2))command(point.dir,'attack');}
    else if(point.dir)command(point.dir,point.attack?'attack':stance,now()-point.at<=180?point.at:now());
  });
  $('arena').addEventListener('pointercancel',event=>touches.delete(event.pointerId));
  for(const button of document.querySelectorAll('[data-dir]'))button.addEventListener('click',event=>{if(event.detail===0&&View.isMounted())command(button.dataset.dir);});
  document.addEventListener('keydown',event=>{
    if(!View.isMounted()||event.target.closest('input,textarea,select,[contenteditable]')||event.ctrlKey||event.metaKey||event.altKey)return;
    const upgradeKey=/^(?:Digit|Numpad)([1-3])$/.exec(event.code);
    const offer=upgradeKey&&battle?.players.find(player=>player.id===ownId()&&!player.eliminated)?.offer;
    if(offer){
      event.preventDefault();
      const choice=offer.choices[Number(upgradeKey[1])-1];
      if(!event.repeat&&choice)pickUpgrade(offer.id,choice.id);
      return;
    }
    const dir=keys[event.code];if(dir){event.preventDefault();if(!event.repeat)command(dir,event.shiftKey?'attack':stance);}
    if(event.code==='Space'&&battle?.status==='running'&&!battle.boss&&!event.target.closest('[data-duel-target],[data-duel-upgrade]')){event.preventDefault();if(!event.repeat)setStance(stance==='guard'?'attack':'guard');}
    if(event.code==='Escape'&&!event.repeat){event.preventDefault();if($('game-shell').classList.contains('expanded'))leaveFullscreen();else leave(true);}
  });
  document.addEventListener('visibilitychange',()=>{lastFrame=null;touches.clear();});
  window.addEventListener('pagehide',()=>{stream?.close();if(matchTicket&&client)client.cancelMatch(matchTicket.id,matchTicket.token).catch(()=>{});});
  window.NeonDuel=Object.freeze({open,practice,leave,action,findOpponent,isActive:()=>View.isMounted()});
})();
