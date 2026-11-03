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
  let clockOffset=0,inputLead=0,roundTrip=0,seq=0,practiceClock=0,lastFrame=null,nextCpuAttack=0,cpuPlans=new Map(),touches=new Map();
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
      'duel-title':['Duel','듀얼'],'duel-back':['← Back','← 뒤로'],
      'duel-random':['Find opponent','랜덤 매칭'],'duel-create':['Create room','방 만들기'],'duel-join':['Join','참가'],
      'duel-practice':['Practice vs CPU','CPU 연습'],'duel-level-label':['Opponent','연습 상대'],
      'duel-settings-label':['Connection settings','접속 설정'],'duel-name-label':['Name','이름'],'duel-server-url-label':['Server address','서버 주소'],
      'duel-online-note':['Find another player on the same server, or invite a friend with a room code.','같은 서버에서 상대를 찾거나 방 코드로 친구를 초대하세요.'],
      'duel-matching-label':['Finding opponent…','상대를 찾고 있습니다…'],
      'duel-matching-note':['The duel starts when another player joins matchmaking. You can cancel at any time.','다른 플레이어가 랜덤 매칭에 들어오면 시작합니다. 언제든 취소할 수 있습니다.'],
      'duel-cancel':['Cancel','취소'],'duel-room-label':['Room code · tap to copy','방 코드 · 눌러서 복사'],
      'duel-room-hint':['Share this code and both press Ready.','이 코드를 공유하고 두 사람 모두 준비를 누르세요.'],
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
  }
  function setup(){lobby();feedback();labels();if(!$('duel-server-url').value)$('duel-server-url').value=window.NEON_CONFIG?.apiBaseUrl||'';}
  function open(){pauseGame();setup();$('duel-title').focus({preventScroll:true});}
  function mount(){View.mount();$('duel-view').hidden=true;$('main-menu').hidden=true;showGameView();setStance('guard');unlockAudio();}
  function stop(){
    generation++;clearTimeout(poll);poll=null;cancelAnimationFrame(frame);frame=null;stream?.close();stream=null;View.unmount();
    session=null;membership=null;room=null;battle=null;matchTicket=null;randomDuel=false;connected=false;connecting=false;roundId='';lastFrame=null;cpuPlans.clear();touches.clear();setBusy(false);
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
    try{const connection=transport();client=connection;const result=join?await connection.joinRoom($('duel-code-input').value.trim().toUpperCase(),name()):await connection.createRoom(name());
      if(current!==generation){connection.leaveRoom(result.room.code,result.playerToken).catch(()=>{});return;}
      randomDuel=false;joinMembership(result);renderRoom(room);pollRoom(current);
    }catch(error){if(current===generation)report(error);}finally{if(current===generation)setBusy(false);}
  }
  function renderRoom(next){
    if(!membership)return;room=next;lobby('duel-room');$('duel-room-code').textContent=next.code;$('duel-players').replaceChildren();
    for(const player of room.players){const li=document.createElement('li'),label=document.createElement('span'),status=document.createElement('span');label.textContent=player.name+(player.id===membership.id?tr(' (you)',' (나)'):'');status.textContent=player.ready?tr('Ready','준비 완료'):tr('Waiting','대기 중');li.append(label,status);$('duel-players').append(li);}
    if(room.players.length<2){const li=document.createElement('li');li.textContent=tr('Waiting for your friend…','친구를 기다리고 있습니다…');$('duel-players').append(li);}
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
    try{const connection=transport();client=connection;const result=await connection.findMatch(name());
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
  async function calibrate(current){
    const before=Date.now(),state=await client.getBattle(membership.code,membership.token),after=Date.now();if(current!==generation)return;
    roundTrip=after-before;clockOffset=state.serverTime+roundTrip/2-after;inputLead=Math.min(100,roundTrip/2);consume(state);
  }
  async function connect(current){
    if(stream||connecting||current!==generation)return;connecting=true;clearTimeout(poll);roundId=room.match?.id||'';mount();
    View.banner('⌖',tr('Connecting…','연결 중…'),'');feedback();
    try{await calibrate(current);}catch(error){if(current===generation)report(error);}if(current!==generation)return;
    const connectingRound=roundId;
    const isCurrent=()=>current===generation&&roundId===connectingRound&&View.isMounted();
    stream=client.connectBattle(membership.code,membership.token,{
      onState:state=>{if(isCurrent())consume(state);},
      onOpen:()=>{if(!isCurrent())return;connected=true;lastSeen=performance.now();if(matchTicket){const ticket=matchTicket;matchTicket=null;client.cancelMatch(ticket.id,ticket.token).catch(()=>{});}},
      onError:()=>{if(isCurrent())connected=false;}
    });
    connecting=false;lastFrame=null;cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);
  }
  function consume(state){
    if(!state.battle)return;const id=state.room?.match?.id;
    if(id&&roundId&&id!==roundId)return;
    if(battle){if(state.battle.now<battle.now)return;if(state.battle.now===battle.now&&(state.battle.events.at(-1)?.id||0)<(battle.events.at(-1)?.id||0))return;}
    room=state.room;battle=state.battle;connected=true;lastSeen=performance.now();
  }
  function practice(){
    stop();session='practice';practiceClock=0;nextCpuAttack=2800;seq=0;battle=Engine.createMatch({players:['you','cpu'],startAt:2200});mount();lastFrame=null;frame=requestAnimationFrame(draw);$('arena').focus({preventScroll:true});
  }
  function runCpu(at){
    if(battle.status!=='running')return;const level=$('duel-cpu-level').value;
    const config=level==='rookie'?{guard:.35,jitter:210,pace:950}:level==='expert'?{guard:.9,jitter:100,pace:550}:{guard:.7,jitter:170,pace:700};
    for(const attack of battle.attacks)if(attack.to==='cpu'&&!cpuPlans.has(attack.attackId))cpuPlans.set(attack.attackId,Math.random()<config.guard?attack.impactAt+(Math.random()*2-1)*config.jitter:Infinity);
    for(const[id,atGuard]of cpuPlans){const attack=battle.attacks.find(a=>a.attackId===id);if(!attack){cpuPlans.delete(id);continue;}if(at>=atGuard){Engine.input(battle,'cpu',{type:'guard',dir:attack.dir},at);cpuPlans.set(id,Infinity);}}
    if(at>=nextCpuAttack){const result=Engine.input(battle,'cpu',{type:'attack',dir:dirs[Math.floor(Math.random()*4)]},at);nextCpuAttack=at+(result.ok?config.pace+Math.random()*350:100);}
  }
  const ownId=()=>session==='practice'?'you':membership?.id;
  const now=()=>session==='practice'?practiceClock:Date.now()+clockOffset+inputLead;
  function render(state,at){
    const me=state.players.find(p=>p.id===ownId()),rival=state.players.find(p=>p.id!==ownId());if(!me||!rival)return;
    const opponentName=session==='practice'?tr('CPU','연습 상대'):room?.players.find(p=>p.id===rival.id)?.name||tr('Opponent','상대');
    const energy=Math.min(Engine.RULES.energyMax,me.energy+(state.status==='running'?Math.max(0,at-state.now)/Engine.RULES.energyRechargeMs:0));
    const connection=session==='practice'?tr('CPU practice','CPU 연습'):connected?Math.round(roundTrip)+'ms':tr('Reconnecting','재연결 중');
    View.render(state,ownId(),at,{opponentName,energy,connection,stance});
    $('action').textContent=state.status==='finished'?session==='practice'?tr('Retry','재도전'):randomDuel?tr('Find next opponent','다음 상대 찾기'):tr('Rematch','재대전'):tr('Leave duel','대전 나가기');
    if(state.status==='countdown')View.banner('⌖',String(Math.max(1,Math.ceil((state.startAt-at)/1000))),tr('Directions: parry · Shift + direction: attack','방향키: 패링 · Shift + 방향: 공격'));
    else if(state.status==='finished')View.banner(state.winnerId===ownId()?'✓':'×',state.winnerId===null?tr('Draw','무승부'):state.winnerId===ownId()?tr('Victory','승리'):tr('Core disconnected','코어 연결 끊김'),state.finishReason==='forfeit'?tr('The opponent left the duel.','상대가 대전에서 나갔습니다.'):tr('Vulnerability reached 100%.','취약률이 100%에 도달했습니다.'));
    else if(session==='online'&&(!connected||performance.now()-lastSeen>2500))View.banner('Ⅱ',tr('Reconnecting…','재연결 중…'),tr('The duel continues on the server.','서버에서는 대전이 계속 진행됩니다.'));
    else View.hideBanner();
  }
  function draw(timestamp){
    if(!session||session==='matching')return;if(!battle){frame=requestAnimationFrame(draw);return;}
    if(session==='practice'){practiceClock+=lastFrame===null?0:Math.max(0,Math.min(50,timestamp-lastFrame));Engine.advance(battle,practiceClock);runCpu(practiceClock);render(Engine.snapshot(battle,practiceClock),practiceClock);}else render(battle,now());
    lastFrame=timestamp;frame=requestAnimationFrame(draw);
  }
  function setStance(value){stance=value;View.setStance(value);}
  function command(dir,type=stance,inputAt=now()){
    if(!battle||battle.status!=='running'||!dirs.includes(dir))return;if(session==='online'&&(!connected||performance.now()-lastSeen>2500))return;
    if(type==='attack')setStance('guard');
    if(session==='practice'){const result=Engine.input(battle,'you',{type,dir,seq:++seq},inputAt);if(!result.ok&&result.reason==='energy')View.setMessage(tr('Attack charging','공격 충전 중'),'var(--muted)');}
    else{const current=generation;client.sendInput(membership.code,membership.token,{type,dir,seq:++seq}).then(result=>{if(current!==generation)return;if(result.state)consume(result.state);if(!result.ok&&result.reason==='energy')View.setMessage(tr('Attack charging','공격 충전 중'),'var(--muted)');}).catch(()=>{if(current===generation)connected=false;});}
  }
  async function action(){
    if(!battle||battle.status!=='finished'){await leave();return;}
    if(session==='practice'){practice();return;}
    if(randomDuel){const current=generation;await leave();if(generation===current+1)await findOpponent();return;}
    if(busy||!membership)return;const current=generation;stream?.close();stream=null;cancelAnimationFrame(frame);frame=null;battle=null;
    const next=await client.getRoom(membership.code,membership.token).catch(()=>room);if(current!==generation||!membership)return;renderRoom(next);pollRoom(current);
  }
  $('menu-duel').addEventListener('click',open);$('duel-back').addEventListener('click',()=>leave(true));
  $('duel-practice').addEventListener('click',practice);$('duel-create').addEventListener('click',()=>requestRoom(false));$('duel-join').addEventListener('click',()=>requestRoom(true));
  $('duel-random').addEventListener('click',findOpponent);$('duel-cancel').addEventListener('click',()=>leave());$('duel-leave').addEventListener('click',()=>leave());$('duel-ready').addEventListener('click',ready);
  $('duel-code-input').addEventListener('keydown',event=>{if(event.code==='Enter')requestRoom(true);});
  $('duel-room-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(room.code);feedback(tr('Room code copied.','방 코드를 복사했습니다.'));}catch{feedback(tr('Share this code: ','이 코드를 공유하세요: ')+room.code);}});
  $('skill').addEventListener('click',()=>{if(View.isMounted()&&battle?.status==='running')setStance(stance==='guard'?'attack':'guard');});
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
    const dir=keys[event.code];if(dir){event.preventDefault();if(!event.repeat)command(dir,event.shiftKey?'attack':stance);}
    if(event.code==='Space'&&battle?.status==='running'){event.preventDefault();if(!event.repeat)setStance(stance==='guard'?'attack':'guard');}
    if(event.code==='Escape'&&!event.repeat){event.preventDefault();if($('game-shell').classList.contains('expanded'))leaveFullscreen();else leave(true);}
  });
  document.addEventListener('visibilitychange',()=>{lastFrame=null;touches.clear();});
  window.addEventListener('pagehide',()=>{stream?.close();if(matchTicket&&client)client.cancelMatch(matchTicket.id,matchTicket.token).catch(()=>{});});
  window.NeonDuel=Object.freeze({open,practice,leave,action,findOpponent,isActive:()=>View.isMounted()});
})();
