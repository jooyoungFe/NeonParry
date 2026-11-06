
'use strict';

// Easy endless keeps the original game's timings and pacing.
const RUN_DIFFICULTIES={
  easy:{name:['Easy','쉬움'],speed:1,spawn:1,minGap:520,guard:360,perfect:100,cooldown:300,damage:1,bossSpeed:1},
  normal:{name:['Normal','보통'],speed:1.2,spawn:.9,minGap:460,guard:300,perfect:85,cooldown:270,damage:1.1,bossSpeed:1.1},
  hard:{name:['Hard','어려움'],speed:1.45,spawn:.78,minGap:390,guard:245,perfect:70,cooldown:240,damage:1.2,bossSpeed:1.22},
  extreme:{name:['Extreme','익스트림'],speed:1.75,spawn:.65,minGap:330,guard:200,perfect:55,cooldown:210,damage:1.35,bossSpeed:1.4}
};
const STAGE_TARGETS=[15,30,45,65,100];
let runSelection={mode:'endless',difficulty:'easy',stage:1,skill:'vaccine'};
let activeRun=null;
function readProgress(key){
  try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
const endlessRecords=readProgress('neon-parry-endless-bests');
const stageRecords=readProgress('neon-parry-stage-records');
const rushRecords=readProgress('neon-parry-rush-bests');
const achievements=readProgress('neon-parry-achievements');
const discoveries=readProgress('neon-parry-discoveries');
let rushBossBag=[],rushRetryKind=null;
function difficultyName(id){const names=RUN_DIFFICULTIES[id]?.name||RUN_DIFFICULTIES.easy.name;return t(names[0],names[1]);}
function stageTarget(stage){return STAGE_TARGETS[Math.max(0,Math.min(4,Math.floor(Number(stage)||1)-1))];}
function isRush(){return activeRun?.mode==='rush';}
function rushRest(){return isRush()&&bossFight?.phase==='rest';}
function skillsLocked(){return !!bossFight&&!rushRest();}
function currentDifficulty(){const base=RUN_DIFFICULTIES[activeRun?.difficulty||runSelection.difficulty]||RUN_DIFFICULTIES.easy;return isRush()?{...base,bossSpeed:base.bossSpeed*(1+score*.01),damage:base.damage*(1+score*.015)}:base;}
function stagePace(){return activeRun?.mode==='stage'?1+(activeRun.stage-1)*.08:1;}
function minimumArrivalGap(){return currentDifficulty().minGap/stagePace();}
function fragmentWindow(){return 160/currentDifficulty().bossSpeed;}
function getRunBest(){
  const run=activeRun||runSelection;
  const value=run.mode==='rush'?rushRecords[run.difficulty]:run.mode==='stage'?stageRecords[`${run.difficulty}:${run.stage}`]?.bestScore:endlessRecords[run.difficulty];
  return Math.max(0,Number(value)||0);
}
function saveProgress(){
  try{localStorage.setItem('neon-parry-rush-bests',JSON.stringify(rushRecords));localStorage.setItem('neon-parry-endless-bests',JSON.stringify(endlessRecords));localStorage.setItem('neon-parry-stage-records',JSON.stringify(stageRecords));}catch{}
}

let language='en';
try{if(localStorage.getItem('neon-parry-language')==='ko')language='ko';}catch{}
function t(en,ko){return language==='ko'?ko:en;}
const STATIC_TEXT={"s0": ["Parry in the incoming direction when the enemy lights up.<br>Hit the timing ring precisely to recover vulnerability.", "점선 범위에 들어오면 해당 방향으로 방어.<br>정확히 판정선에 맞추면 취약률이 회복됩니다."], "s1": ["▱ Decoy<span>50-point shield</span>", "▱ 미끼폴더<span>50% 피해 흡수</span>"], "s2": ["⇥ Proxy<span>Clear one lane</span>", "⇥ 프록시<span>한 방향 정리</span>"], "s3": ["＋ Vaccine<span>Heal & slow</span>", "＋ 백신<span>회복·둔화</span>"], "s4": ["Space / lane swipe", "Space / 라인 스와이프"], "s5": ["Charge by eliminating threats.", "처치할 때마다 충전됩니다."], "s6": ["Protect the core", "코어를 지키세요."], "s7": ["Share score ↗", "기록 공유 ↗"], "s8": ["Best", "최고 기록"], "s9": ["Start", "방어 시작"], "s10": ["Decoy", "미끼폴더"], "s11": ["Sound on", "소리 켬"], "s12": ["Vulnerability", "취약률"], "s13": ["Eliminations", "방어"], "s14": ["Vaccine", "백신"], "Virus": ["Virus", "바이러스"], "Trojan": ["Trojan", "트로이"], "Worm": ["Worm", "웜"], "Ransomware": ["Ransomware", "랜섬웨어"], "Phishing": ["Phishing", "피싱"], "a15": ["Core defense game", "코어 방어 게임"], "a16": ["Four-lane defense arena. Use arrow keys, WASD, or tap the incoming lane.", "네 방향 방어 영역. 방향키, WASD 또는 다가오는 적의 방향을 터치하세요."], "a17": ["Unlocked threats", "현재 해금된 위협"], "a18": ["Defense status and controls", "방어 상태 및 조작"], "a19": ["Choose a starting skill", "시작 스킬 선택"], "a20": ["Skill charge", "스킬 충전"], "a21": ["Main Domain reaction time", "메인 도메인 반응 시간"], "a22": ["Attempts remaining", "남은 시도횟수"], "a23": ["Vaccine skill", "백신 스킬"], "a24": ["Parry up (↑ or W)", "위쪽 패링 (↑ 또는 W)"], "a25": ["Parry right (→ or D)", "오른쪽 패링 (→ 또는 D)"], "a26": ["Parry down (↓ or S)", "아래쪽 패링 (↓ 또는 S)"], "a27": ["Parry left (← or A)", "왼쪽 패링 (← 또는 A)"], "a28": ["Sound on. Press to mute", "효과음 켜짐. 눌러서 음소거"]};

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const DIRECTIONS = { up:[0,-1], right:[1,0], down:[0,1], left:[-1,0] };
const KEYS = {ArrowUp:'up',KeyW:'up',ArrowRight:'right',KeyD:'right',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left'};
const START_RADIUS = 220, TARGET_RADIUS = 104, IMPACT_RADIUS = 35;
let PERFECT_WINDOW = 100, GUARD_WINDOW = 360, COOLDOWN = 300;
const PERFECT_RECOVERY = 4, MISINPUT_DAMAGE = 4;
const TYPES={
  virus:{color:'#b7eaaa',damage:14,travel:2200,unlock:0},
  ddos:{color:'#e6acc9',damage:24,travel:2200,unlock:3},
  trojan:{color:'#e4ca93',damage:34,travel:1800,unlock:8},
  worm:{color:'#9ccbe1',damage:30,travel:900,unlock:15},
  ransom:{color:'#d5b1e8',damage:8,travel:1250,unlock:25},
  phishing:{color:'#f0bd91',damage:40,travel:1900,unlock:40},
  echo:{color:'#e4ca93',damage:8,travel:700,unlock:8}
};
const SKILLS={vaccine:{get name(){return t('Vaccine','백신')},cost:20,heal:29},proxy:{get name(){return t('Proxy','프록시')},cost:16,duration:6000},decoy:{get name(){return t('Decoy','미끼폴더')},cost:24,capacity:50,ransomHeal:10}};
let selectedSkill='vaccine',charge=0,proxyArmed=false,decoyCapacity=0;
let vaccineSlowAt=-Infinity,retrySkill=null;
let arrivalSlots=[],nextWorm=Infinity,lockedUntil={},proxyUntil={},pointers=new Map();
let best = 0;
try {
  const legacy=Math.max(0,Number(localStorage.getItem('neon-parry-defense-best'))||0);
  endlessRecords.easy=Math.max(legacy,Number(endlessRecords.easy)||0);
} catch {}
best=getRunBest();
let fxClock=0,bossFight=null,nextBossAt=100,cameraZoom=1;
const BOSS_TYPES={domain:{get name(){return t('Fake Domain','페이크 도메인')},attempts:5,color:'#e4ca93',start:startDomainRound,onHit:startDomainReaction,onMiss:failDomain,react:guardMainDomain,get hint(){return t('Hit the fake, then strike the revealed core during slow motion.','가짜를 친 뒤, 정지 중 나타나는 본체를 타격하세요.')}},destroy:{get name(){return t('Dis-Troy','디스-트로이')},attempts:4,color:'#e6acc9',start:startDestroyRound,onHit:resolveDestroyHit,onMiss:missDestroy,get hint(){return t('Parry 1 → 2 → 4 fragments across random lanes.','무작위 방향의 1 → 2 → 4 연속 패링.')}}};
let mode = 'idle', score = 0, vulnerability = 0, enemies = [], effects = [], clock = 0, lastFrame = null, frame = 0;
let nextSpawn = Infinity, lastInput = {}, messageUntil = 0, coreFlashUntil = 0, recoveryUntil = 0;
let previousDirection = null, poseUntil = 0, flashUntil = 0, damagedUntil = 0;
let shake = {at:0,until:0,power:0};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const TRAVEL_TIME = 2200, MIN_ARRIVAL_GAP = 520;
const ROTATION = {up:0,right:90,down:180,left:270};
const OPPOSITE={up:'down',right:'left',down:'up',left:'right'};
const random = (min,max) => min + Math.random() * (max-min);
// Synthesized locally: no downloads, autoplay, or background music.
let soundEnabled=true,audioContext=null,audioBus=null,noiseBuffer=null;
const soundVoices=new Set();
try{soundEnabled=localStorage.getItem('neon-parry-sound')!=='off';}catch{}
function updateSoundButton(){
  if(!(window.AudioContext||window.webkitAudioContext)){$('sound-toggle').disabled=true;$('sound-toggle').textContent=t('Audio unavailable','소리 미지원');return;}
  $('sound-toggle').textContent=soundEnabled?t('Sound on','소리 켬'):t('Sound off','소리 끔');
  $('sound-toggle').setAttribute('aria-pressed',String(soundEnabled));
  $('sound-toggle').setAttribute('aria-label',soundEnabled?t('Sound on. Press to mute','효과음 켜짐. 눌러서 음소거'):t('Sound off. Press to unmute','효과음 꺼짐. 눌러서 켜기'));
}
function unlockAudio(){
  if(!soundEnabled)return;
  try{
    if(!audioContext||audioContext.state==='closed'){
      const Engine=window.AudioContext||window.webkitAudioContext;if(!Engine)return;
      audioContext=new Engine();audioBus=audioContext.createGain();audioBus.gain.value=.18;
      const limiter=audioContext.createDynamicsCompressor();limiter.threshold.value=-12;limiter.ratio.value=8;
      audioBus.connect(limiter);limiter.connect(audioContext.destination);
      noiseBuffer=audioContext.createBuffer(1,Math.ceil(audioContext.sampleRate*.3),audioContext.sampleRate);
      const data=noiseBuffer.getChannelData(0);let seed=17;
      for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=(seed/4294967296)*2-1;}
    }
    if(audioContext.state==='suspended')Promise.resolve(audioContext.resume()).catch(()=>{});
    audioBus.gain.setTargetAtTime(.18,audioContext.currentTime,.008);
  }catch{} // Audio support must never prevent gameplay.
}
function audioVoice(source,duration,volume,delay=0,filter=null){
  if(!audioContext||!audioBus||soundVoices.size>=24)return;
  const start=audioContext.currentTime+delay,gain=audioContext.createGain();
  gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(volume,start+.003);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  source.connect(filter||gain);if(filter)filter.connect(gain);gain.connect(audioBus);soundVoices.add(source);
  source.onended=()=>{source.disconnect();gain.disconnect();if(filter)filter.disconnect();soundVoices.delete(source);};
  source.start(start);source.stop(start+duration+.012);
}
function playSound(event){
  if(!soundEnabled||!audioContext||audioContext.state!=='running')return;
  try{
    const tone=(frequency,duration=.08,wave='triangle',volume=.12,end=frequency,delay=0)=>{
      if(soundVoices.size>=24)return;
      const node=audioContext.createOscillator(),at=audioContext.currentTime+delay;node.type=wave;
      node.frequency.setValueAtTime(frequency,at);node.frequency.exponentialRampToValueAtTime(Math.max(25,end),at+duration);audioVoice(node,duration,volume,delay);
    };
    const noise=(duration=.06,volume=.12,frequency=2300,delay=0)=>{
      if(soundVoices.size>=24)return;
      const source=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter();source.buffer=noiseBuffer;filter.type='highpass';filter.frequency.value=frequency;audioVoice(source,duration,volume,delay,filter);
    };
    if(event==='boss-warning'){tone(120,.22,'square',.09,180);tone(180,.24,'square',.08,260,.26);noise(.12,.09,1200,.12);return;}
    if(event==='boss-freeze'){noise(.08,.16,2100);tone(750,.25,'triangle',.13,90);return;}
    if(event==='boss-hit'){noise(.07,.2,1300);tone(280,.1,'triangle',.2,90);tone(1100,.09,'sine',.1,550);return;}
    if(event==='boss-finish'){noise(.25,.3,650);tone(72,.5,'sine',.4,28);tone(1500,.24,'sawtooth',.13,80);tone(520,.24,'triangle',.15,780,.2);return;}
    if(event==='boss-fail'){noise(.24,.22,400);tone(180,.3,'sawtooth',.18,32);return;}
    if(event==='spawn'){noise(.035,.035,4300);return;}
    if(event==='guard'){noise(.045,.18,1800);tone(420,.08,'triangle',.16,220);return;}
    if(event==='perfect'){noise(.04,.16,2600);tone(900,.1,'triangle',.15,1250);tone(1500,.1,'sine',.11,1250,.035);return;}
    if(event==='damage'){noise(.15,.22,350);tone(130,.14,'sawtooth',.12,45);return;}
    if(event==='miss'){tone(160,.055,'square',.06,100);return;}
    if(event==='gameover'){noise(.24,.18,450);tone(280,.45,'sawtooth',.13,30);return;}
    if(event==='reveal'){noise(.04,.09,1800);noise(.025,.07,3800,.05);tone(560,.08,'square',.04,190);return;}
    if(event==='break'){noise(.14,.18,1800);tone(230,.13,'triangle',.1,55);return;}
    if(event==='absorb'){tone(310,.08,'triangle',.13,160);noise(.035,.07,3000);return;}
    if(event==='proxy'){noise(.18,.12,2400);tone(720,.18,'sawtooth',.06,90);return;}
    const notes=event==='decoy'?[380,570,760]:event==='vaccine'?[520,780,1040]:[330,660];
    notes.forEach((note,i)=>tone(note,.12,'sine',.1,note*1.08,i*.045));
  }catch{}
}
function silenceSound(){if(audioContext&&audioBus)try{audioBus.gain.setTargetAtTime(0,audioContext.currentTime,.01);}catch{}}
function targetDirection(enemy){return enemy.kind==='phishing'?OPPOSITE[enemy.dir]:enemy.dir;}
function contactEnemy(enemy){
  if(enemy.kind!=='phishing')return enemy;
  const dir=targetDirection(enemy),[dx,dy]=DIRECTIONS[dir];return{...enemy,dir,x:240+dx*enemy.radius,y:240+dy*enemy.radius};
}
// Reserve absolute arrival slots for regular attacks, Trojan rebounds and worm charges.
// Slots remain reserved after a kill, preventing new attacks from collapsing the rhythm.
function pace() {
  const seconds=Math.max(0,clock)/1000;
  const difficulty=currentDifficulty(),stageScale=stagePace();
  const speed=Math.min(2.6,1+seconds/90)*difficulty.speed*stageScale;
  return {gap:Math.max(minimumArrivalGap(),1450*Math.pow(.985,seconds)*difficulty.spawn/stageScale),speed,travel:TRAVEL_TIME/speed};
}
function scaledTravel(kind) { return TYPES[kind].travel/pace().speed; }
function reserveArrival(earliest) {
  const gap=minimumArrivalGap();
  arrivalSlots=arrivalSlots.filter(t=>t>=clock-gap);
  let time=earliest;
  for(const slot of [...arrivalSlots].sort((a,b)=>a-b)) {
    if(Math.abs(time-slot)<gap) time=slot+gap;
  }
  arrivalSlots.push(time); return time;
}
function availableDirections(exclude=null) {
  return Object.keys(DIRECTIONS).filter(dir=>dir!==exclude && clock>=(proxyUntil[dir]||0));
}
function chooseKind() {
  const roll=Math.random();
  if(score>=40&&roll<.18)return 'phishing';
  if(score>=25&&roll<(score>=40?.36:.2))return 'ransom';
  return score>=3 && roll<.58?'ddos':'virus';
}
function scheduleRegular() {
  const kind=chooseKind();
  const dirs=availableDirections(previousDirection).filter(dir=>kind!=='phishing'||clock>=(proxyUntil[OPPOSITE[dir]]||0));
  if(!dirs.length){nextSpawn=clock+200;return;}
  const dir=dirs[Math.floor(Math.random()*dirs.length)],travel=scaledTravel(kind);
  const arrival=reserveArrival(clock+travel);
  spawnEnemy(dir,arrival-travel,travel,kind,{arrival,trojan:score>=8&&Math.random()<.13});
  previousDirection=dir;updateGuardZone();
  nextSpawn=Math.max(clock+pace().gap,arrival-travel+pace().gap)+random(0,120);
}
function updateGuardZone(travel=scaledTravel('virus')) {
  const range = (START_RADIUS-TARGET_RADIUS)*GUARD_WINDOW/travel;
  $('guard-band').setAttribute('stroke-width',range*2);
  $('guard-outer').setAttribute('r',TARGET_RADIUS+range);
  $('guard-inner').setAttribute('r',TARGET_RADIUS-range);
}
function svg(tag, attrs) {
  const node = document.createElementNS(NS,tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  return node;
}
function updateHUD() {
  $('score').textContent = score;
  $('score-label').textContent=isRush()?t('Bosses','보스 처치'):t('Eliminations','방어');
  document.querySelector('.legend').hidden=isRush();
  $('best').textContent = best;
  $('vulnerability-value').textContent = vulnerability + '%';
  $('vulnerability-fill').style.width = Math.min(100,vulnerability) + '%';
  $('vulnerability').setAttribute('aria-valuenow',Math.min(100,vulnerability));
  $('vulnerability').setAttribute('aria-valuetext',vulnerability + '% · ' + (vulnerability > 100 ? t('Core disconnected','코어 손상') : t('Game ends above 100%','100% 초과 시 종료')));
  $('state-light').dataset.mode = mode;
  $('arena').dataset.state = mode;
  updateSkillHUD();updateDecoyHUD();updateBossHUD();
  updateRunHUD();
  for(const item of document.querySelectorAll('[data-unlock]'))item.hidden=score<Number(item.dataset.unlock);
}
function rememberBest() {
  if(typeof checkScoreAchievements==='function')checkScoreAchievements();
  if (score <= best) return;
  best = score;
  if(isRush()){rushRecords[activeRun.difficulty]=best;}else if(activeRun?.mode==='stage'){
    const key=`${activeRun.difficulty}:${activeRun.stage}`;
    stageRecords[key]={...stageRecords[key],bestScore:best};
  }else{
    const difficulty=activeRun?.difficulty||'easy';endlessRecords[difficulty]=best;
    if(difficulty==='easy')try{localStorage.setItem('neon-parry-defense-best',best);}catch{}
  }
  saveProgress();
}
function showMessage(text,color='var(--green)') {
  $('message').textContent = text;
  $('message').style.color = color;
  messageUntil = clock + 800;
}
function startGame() {
  cancelAnimationFrame(frame);
  if(!activeRun){launchRun();return;}
  const difficulty=currentDifficulty();
  GUARD_WINDOW=difficulty.guard;PERFECT_WINDOW=difficulty.perfect;COOLDOWN=difficulty.cooldown;
  best=getRunBest();activeRun.bossDefeated=false;
  $('achievement-toast').hidden=true;if(typeof achievementUntil!=='undefined')achievementUntil=0;
  $('game-shell').dataset.runMode=activeRun.mode;
  mode = 'running'; score = 0; vulnerability = 0; clock = 0; fxClock=0;bossFight=null;nextBossAt=100;cameraZoom=1;lastFrame = null;
  $('boss-entities').replaceChildren();$('camera').removeAttribute('transform');updateBossHUD();
  enemies = []; effects = []; nextSpawn = 1200/difficulty.speed; lastInput = {}; messageUntil = 0; coreFlashUntil = 0; recoveryUntil = 0;
  $('enemies').replaceChildren(); $('effects').replaceChildren(); $('foreground-fx').replaceChildren(); $('phishing-links').replaceChildren();
  previousDirection=null; poseUntil=0; flashUntil=0; damagedUntil=0;
  charge=0; proxyArmed=false; decoyCapacity=0; vaccineSlowAt=-Infinity;retrySkill=null;rushBossBag=[];rushRetryKind=null;arrivalSlots=[]; nextWorm=Infinity; lockedUntil={}; proxyUntil={}; pointers.clear();
  $('skill-choices').hidden=true; $('arena').dataset.armed='false';
  shake={at:0,until:0,power:0}; $('world').removeAttribute('transform');
  $('vulnerability').dataset.damaged='false'; resetPose();
  $('core').style.opacity = '1';
  for (const dir of Object.keys(DIRECTIONS)) lastInput[dir] = -Infinity;
  updateGuardZone(); $('vulnerability-fill').dataset.recovering = 'false';
  $('overlay').hidden = true;
  $('message').textContent = ''; $('share-status').textContent = '';
  $('action').textContent = t('Pause','일시정지'); updateHUD(); updateLaneStates();
  if(isRush())startRushRest();
  playSound('start');frame = requestAnimationFrame(loop);
}
function pauseGame() {
  if (mode !== 'running') return;
  silenceSound();mode = 'paused'; cancelAnimationFrame(frame); lastFrame = null; pointers.clear(); proxyArmed=false; $('arena').dataset.armed='false';
  $('overlay-title').textContent = t('Paused','일시정지');
  $('overlay-copy').textContent = t('Resume when you are ready.','준비되면 같은 위치에서 이어가세요.');
  $('overlay-symbol').textContent = 'Ⅱ'; $('overlay').hidden = false;
  $('action').textContent = t('Resume','계속하기'); updateHUD();
}
function resumeGame() {
  if(mode!=='paused'||($('help-dialog').open||$('patch-dialog').open))return;
  mode = 'running'; lastFrame = null; $('overlay').hidden = true;
  $('action').textContent = t('Pause','일시정지'); updateHUD(); frame = requestAnimationFrame(loop);
}
function gameOver() {
  playSound('gameover');if(bossFight)clearBossActors();bossFight=null;cameraZoom=1;$('camera').removeAttribute('transform');updateBossHUD();mode = 'over'; cancelAnimationFrame(frame); rememberBest(); updateHUD();
  $('world').removeAttribute('transform'); resetPose();
  shake={at:0,until:0,power:0}; poseUntil=0; flashUntil=0; damagedUntil=0; coreFlashUntil=0;
  for(const effect of effects)effect.node.remove(); effects=[];
  $('vulnerability').dataset.damaged='false';
  $('overlay-symbol').textContent = '×'; $('overlay-title').textContent = t('Core disconnected','코어 연결 끊김');
  $('overlay-copy').textContent = t(`${score} eliminations · ${vulnerability}% vulnerability`,`${score}회 방어 · 취약률 ${vulnerability}%`);
  $('overlay').hidden = false; $('action').textContent = t('Retry','다시 방어');
  $('skill-choices').hidden=false; proxyArmed=false; pointers.clear(); $('arena').dataset.armed='false'; updateSkillHUD();
}
function launchRun(){
  const difficulty=Object.hasOwn(RUN_DIFFICULTIES,runSelection.difficulty)?runSelection.difficulty:'easy';
  const stage=Math.max(1,Math.min(5,Math.floor(Number(runSelection.stage)||1)));
  const skill=Object.hasOwn(SKILLS,runSelection.skill)&&!(runSelection.mode==='rush'&&runSelection.skill==='proxy')?runSelection.skill:'vaccine';
  runSelection={mode:['stage','rush'].includes(runSelection.mode)?runSelection.mode:'endless',difficulty,stage,skill};
  activeRun={...runSelection,target:runSelection.mode==='stage'?stageTarget(stage):Infinity,bossRequired:runSelection.mode==='stage'&&stage===5,bossDefeated:false,stats:{skillsUsed:0,nonPerfectKills:0}};
  selectedSkill=skill;
  for(const button of document.querySelectorAll('[data-skill]'))button.setAttribute('aria-pressed',String(button.dataset.skill===selectedSkill));
  if($('help-dialog').open)$('help-dialog').close();
  if($('patch-dialog').open)$('patch-dialog').close();
  if(typeof showGameView==='function')showGameView();
  startGame();requestAnimationFrame(fitConsole);
  $('action').focus({preventScroll:true});
}
function replayRun(){
  if(activeRun)runSelection={mode:activeRun.mode,difficulty:activeRun.difficulty,stage:activeRun.stage,skill:retrySkill||activeRun.skill};
  launchRun();
}
function advanceStage(){
  if(mode!=='cleared'||activeRun?.mode!=='stage'||activeRun.stage>=5)return;
  runSelection={mode:'stage',difficulty:activeRun.difficulty,stage:activeRun.stage+1,skill:retrySkill||activeRun.skill};launchRun();
}
function returnToMenu(){
  if(window.NeonDuel?.isActive()){window.NeonDuel.leave(true);return;}
  pauseGame();pointers.clear();
  if(typeof showMenuView==='function')showMenuView();
  if(typeof refreshMenu==='function')refreshMenu();
}
function continueRun(){
  if(mode!=='paused'||!activeRun)return;
  if(typeof showGameView==='function')showGameView();
  resumeGame();requestAnimationFrame(fitConsole);$('action').focus({preventScroll:true});
}
function updateRunHUD(){
  const run=activeRun||runSelection,isStage=run.mode==='stage';
  if($('run-label'))$('run-label').textContent=`${difficultyName(run.difficulty)} · ${run.mode==='rush'?t('Boss rush','보스 러쉬'):isStage?t(`Stage ${run.stage} / 5`,`스테이지 ${run.stage} / 5`):t('Endless','무한 모드')}`;
  const progress=$('stage-progress');
  if(progress){
    progress.hidden=!isStage;
    const target=stageTarget(run.stage),value=Math.min(score,target);
    const meter=$('stage-progress-meter')||progress;
    meter.setAttribute('aria-label',t('Stage progress','스테이지 진행도'));meter.setAttribute('aria-valuemax',target);meter.setAttribute('aria-valuenow',value);
    if($('stage-progress-fill'))$('stage-progress-fill').style.width=(100*value/target)+'%';
    if($('stage-goal'))$('stage-goal').textContent=mode==='cleared'?t('Stage cleared','스테이지 클리어'):activeRun?.bossRequired&&score>=target?t('Defeat the boss to clear','보스를 처치하면 클리어'):t(`${value} / ${target} eliminations`,`${value} / ${target}회 방어`);
  }
  if($('next-stage')){
    $('next-stage').hidden=mode!=='cleared'||!isStage||run.stage>=5;
    $('next-stage').textContent=t('Next stage →','다음 스테이지 →');
  }
}
function checkStageCompletion(){
  if(mode!=='running'||activeRun?.mode!=='stage'||score<activeRun.target)return false;
  if(activeRun.bossRequired&&!activeRun.bossDefeated){maybeQueueBoss();return false;}
  completeStage();return true;
}
function stageResultCopy(){return t(`${score} eliminations · ${vulnerability}% vulnerability`,`${score}회 방어 · 취약률 ${vulnerability}%`);}
function completeStage(){
  if(mode!=='running'||activeRun?.mode!=='stage')return;
  mode='cleared';cancelAnimationFrame(frame);lastFrame=null;silenceSound();pointers.clear();proxyArmed=false;
  for(const enemy of [...enemies])removeEnemy(enemy);
  clearBossActors();bossFight=null;cameraZoom=1;shake={at:0,until:0,power:0};
  $('camera').removeAttribute('transform');$('world').removeAttribute('transform');resetPose();
  for(const effect of effects)effect.node.remove();effects=[];
  nextSpawn=Infinity;nextWorm=Infinity;
  const key=`${activeRun.difficulty}:${activeRun.stage}`,previous=stageRecords[key]||{};
  rememberBest();
  stageRecords[key]={...stageRecords[key],cleared:true,bestScore:Math.max(Number(previous.bestScore)||0,score),bestVulnerability:Math.min(Number.isFinite(previous.bestVulnerability)?previous.bestVulnerability:Infinity,vulnerability)};
  saveProgress();
  if(typeof checkStageAchievements==='function')checkStageAchievements();
  $('overlay-symbol').textContent='✓';$('overlay-title').textContent=t(`Stage ${activeRun.stage} cleared`,`스테이지 ${activeRun.stage} 클리어`);$('overlay-copy').textContent=stageResultCopy();
  $('overlay').hidden=false;$('skill-choices').hidden=false;$('action').textContent=t('Retry stage','스테이지 재도전');
  updateHUD();updateLaneStates();
  if(typeof refreshMenu==='function')refreshMenu();
}
function shapePath(kind,inset=0) {
  const r=13-inset;
  if(kind==='virus')return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`;
  if(kind==='ddos')return `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
  if(kind==='worm')return `M${-r} -5H${-r+7}V-9H4V-5H${r}V5H4V9H${-r+7}V5H${-r}Z`;
  if(kind==='phishing')return `M${-r} -4L0 ${-r}L${r} -4L4 0L${r} 5L0 ${r}L${-r} 5L-4 0Z`;
  if(kind==='ransom')return `M${-r+3} -4V${r-1}H${r-3}V-4Z M-6 -4V-9L0 -13L6 -9V-4`;
  return `M${-r} 0L${-r*.5} ${-r*.85}H${r*.5}L${r} 0L${r*.5} ${r*.85}H${-r*.5}Z`;
}
function createEnemyActor(dir,at,travel,kind,options={}) {
  const color=TYPES[kind].color,group=svg('g',{'data-kind':kind});
  const outline=svg('path',{d:shapePath(kind),fill:'#171a1b',stroke:color,'stroke-width':1.25});
  const fill=svg('path',{d:shapePath(kind,2),fill:color,stroke:kind==='ransom'?color:'none','stroke-width':.5});
  group.append(outline,fill);
  if(kind==='ransom')group.append(svg('path',{d:'M0 3V8',stroke:'#171a1b','stroke-width':2}));
  const count=svg('text',{x:0,y:-19,class:'enemy-count'});group.append(count);
  return {dir,at,travel,kind,node:group,fill,outline,count,radius:options.startRadius||START_RADIUS,startRadius:options.startRadius||START_RADIUS,arrival:options.arrival??at+travel,state:options.state||'moving',trojan:!!options.trojan,remaining:options.remaining||0,spawned:false,...options};
}
function spawnEnemy(dir, at=clock, travel=TRAVEL_TIME, kind='virus',options={}) {
  const enemy=createEnemyActor(dir,at,travel,kind,options),group=enemy.node;
  $('enemies').append(group);
  if(kind==='phishing'){
    enemy.revealed=false;enemy.mirror=group.cloneNode(true);enemy.mirror.setAttribute('data-role','phishing-body');
    enemy.mirror.setAttribute('opacity','.5');enemy.mirror.firstElementChild.setAttribute('stroke-dasharray','2 3');
    enemy.link=svg('path',{class:'phishing-link',visibility:'hidden'});$('phishing-links').append(enemy.link);$('enemies').append(enemy.mirror);
  }
  enemies.push(enemy);renderEnemy(enemy);return enemy;
}
function enemyPosition(enemy,now=clock) {
  const [dx,dy]=DIRECTIONS[enemy.dir];
  if(enemy.push&&now<enemy.push.until){const t=Math.max(0,(now-enemy.push.at)/(enemy.push.until-enemy.push.at)),radius=enemy.push.from+(enemy.push.to-enemy.push.from)*(1-(1-t)**3);return{x:240+dx*radius,y:240+dy*radius,radius};}
  if(enemy.state==='echo') {
    const t=Math.min(1,Math.max(0,(now-enemy.at)/enemy.travel));
    const radius=IMPACT_RADIUS+Math.sin(t*Math.PI)*56-t*IMPACT_RADIUS;
    return{x:240+dx*radius,y:240+dy*radius,radius};
  }
  if(enemy.hop && now<enemy.hop.until) {
    const t=Math.max(0,(now-enemy.hop.at)/(enemy.hop.until-enemy.hop.at)),u=1-t;
    const dest={x:240+dx*enemy.startRadius,y:240+dy*enemy.startRadius};
    return{x:u*u*enemy.hop.x+2*u*t*240+t*t*dest.x,y:u*u*enemy.hop.y+2*u*t*240+t*t*dest.y,radius:enemy.startRadius};
  }
  if(enemy.state==='dormant')return{x:240+dx*enemy.startRadius,y:240+dy*enemy.startRadius,radius:enemy.startRadius};
  const progress=Math.max(0,(now-enemy.at)/enemy.travel);
  const movement=enemy.kind==='worm'?progress*progress:progress;
  const radius=enemy.startRadius-(enemy.startRadius-TARGET_RADIUS)*movement;
  return{x:240+dx*radius,y:240+dy*radius,radius};
}
function paintEnemy(enemy,now=clock) {
  const visible=enemy.state==='dormant'||enemy.state==='echo'||enemy.hop||enemy.push||now>=enemy.at;
  enemy.node.setAttribute('visibility',visible?'visible':'hidden');
  const position=enemyPosition(enemy,now);enemy.radius=position.radius;enemy.x=position.x;enemy.y=position.y;
  enemy.node.setAttribute('transform',`translate(${position.x} ${position.y})`);
  const progress=enemy.state==='dormant'?0:Math.max(0,(now-enemy.at)/enemy.travel);
  enemy.fill.setAttribute('transform',`scale(${Math.sqrt(Math.min(1,progress))})`);
  enemy.count.textContent=enemy.state==='dormant'?enemy.remaining:enemy.kind==='worm'?'!':'';
  const ready=enemy.state==='moving'&&(!enemy.hop||now>=enemy.hop.until)&&(!enemy.push||now>=enemy.push.until)&&Math.abs(now-enemy.arrival)<=GUARD_WINDOW;
  enemy.outline.setAttribute('stroke-width',ready?2.5:1.25);enemy.outline.setAttribute('stroke',ready?'#edffe3':TYPES[enemy.kind].color);
  return {visible,ready};
}
function renderEnemy(enemy) {
  const {visible,ready}=paintEnemy(enemy);
  if(visible&&!enemy.duelVisual&&typeof discover==='function')discover('enemy',enemy.kind==='echo'?'trojan':enemy.kind);
  if(enemy.kind==='phishing'){
    if(visible&&!enemy.revealed&&clock>=enemy.arrival-GUARD_WINDOW){enemy.revealed=true;playSound('reveal');}
    const [dx,dy]=DIRECTIONS[targetDirection(enemy)];
    enemy.mirror.setAttribute('transform',`translate(${240+dx*enemy.radius} ${240+dy*enemy.radius})`);
    enemy.mirror.setAttribute('visibility',visible&&enemy.revealed?'visible':'hidden');
    enemy.mirror.firstElementChild.setAttribute('stroke-width',ready?2.5:1.25);
    enemy.mirror.firstElementChild.setAttribute('stroke',ready?'#ffe2c7':TYPES.phishing.color);
    enemy.mirror.children[1].setAttribute('transform',enemy.fill.getAttribute('transform'));
    enemy.link.setAttribute('visibility',visible&&enemy.revealed?'visible':'hidden');
    enemy.link.setAttribute('d',`M${enemy.x} ${enemy.y}L${240+dx*enemy.radius} ${240+dy*enemy.radius}`);
    enemy.outline.setAttribute('stroke-width',1.25);
    if(enemy.revealed)enemy.outline.setAttribute('stroke-dasharray','1 4');
  }
  if(visible&&!enemy.spawned){enemy.spawned=true;glitchAt(enemy.x,enemy.y,24,enemy.kind==='trojan'||enemy.kind==='echo'?'reveal':'spawn');}
}
function removeEnemy(enemy) {
  const index=enemies.indexOf(enemy);if(index<0)return false;
  enemies.splice(index,1);enemy.node.remove();if(enemy.mirror)enemy.mirror.remove();if(enemy.link)enemy.link.remove();return true;
}
function releaseTrojan(host,defeated) {
  if(!host.trojan || mode!=='running')return;
  host.trojan=false;
  glitchAt(host.x,host.y,25,'reveal');
  if(!defeated) {
    spawnEnemy(host.dir,clock,scaledTravel('echo'),'echo',{state:'echo',startRadius:IMPACT_RADIUS});
    showMessage(t('Trojan / secondary breach','트로이 / 추가 침투'),'var(--pink)');return;
  }
  const dirs=availableDirections(host.dir);if(!dirs.length)return;
  const dir=dirs[Math.floor(Math.random()*dirs.length)],hopEnd=clock+400,travel=scaledTravel('trojan');
  const arrival=reserveArrival(hopEnd+travel);
  spawnEnemy(dir,arrival-travel,travel,'trojan',{startRadius:160,arrival,hop:{at:clock,until:hopEnd,x:host.x,y:host.y}});
  showMessage(t('Trojan / rerouted','트로이 / 다른 경로로 탈출'),'#e4ca93');
}
function spawnWorm(dir,remaining=2+Math.floor(Math.random()*2),options={}) {
  if(enemies.some(e=>e.kind==='worm'&&e.state==='dormant'&&e.dir===dir))return null;
  return spawnEnemy(dir,clock,scaledTravel('worm'),'worm',{state:'dormant',startRadius:157,remaining,trojan:score>=8&&Math.random()<.13,...options});
}
function tickWorms(dir) {
  for(const worm of enemies.filter(e=>e.kind==='worm'&&e.state==='dormant'&&e.dir===dir)) {
    worm.remaining--;worm.count.textContent=worm.remaining;
    if(worm.remaining<=0){worm.state='moving';worm.travel=scaledTravel('worm');worm.arrival=reserveArrival(clock+200+worm.travel);worm.at=worm.arrival-worm.travel;worm.hop={at:clock,until:worm.at,x:worm.x,y:worm.y};glitchAt(worm.x,worm.y,25,'reveal');showMessage(t('Worm / charge queued','웜 / 돌진 대기'),'#9ccbe1');}
  }
}
function updateDecoyHUD(){
  $('decoy-panel').hidden=decoyCapacity<=0;
  $('decoy-value').textContent=decoyCapacity+' / 50';$('decoy-meter').setAttribute('aria-valuenow',decoyCapacity);
  $('decoy-fill').style.width=(decoyCapacity*2)+'%';
  $('decoy-folder').setAttribute('visibility',decoyCapacity>0?'visible':'hidden');
  $('folder-capacity').setAttribute('width',24*decoyCapacity/50);
}
function folderBurst(){
  const group=svg('g',{transform:'translate(272 267)'}),pieces=[];
  for(let i=0;i<6;i++){const part=svg('path',{d:'M-3 -2H3V2H-3Z',fill:i%2?'#9ccbe1':'#dcebf0'});group.append(part);pieces.push(part);}
  addTimedEffect(group,400,t=>{group.setAttribute('opacity',1-t);if(!reducedMotion.matches)pieces.forEach((part,i)=>part.setAttribute('transform',`translate(${(i-2.5)*13*t} ${-12*t+35*t*t}) rotate(${i%2?-230*t:230*t})`));},true);
}
function dealDamage(amount,text,coreHit=true,kind=null) {
  if(coreHit)amount=Math.round(amount*currentDifficulty().damage*10)/10;
  if(coreHit&&decoyCapacity>0){
    decoyCapacity=Math.max(0,Math.round((decoyCapacity-amount)*10)/10);const broken=decoyCapacity===0;
    if(kind==='ransom'){vulnerability=Math.max(0,vulnerability-SKILLS.decoy.ransomHeal);recoveryUntil=clock+650;$('vulnerability-fill').dataset.recovering='true';}
    if(broken){folderBurst();playSound('break');}else{glitchAt(272,267,17,'absorb');playSound('absorb');}
    if(kind==='ransom')playSound('vaccine');
    showMessage(kind==='ransom'?t('Decoy / ransomware absorbed · vulnerability −10 pp','미끼폴더 / 랜섬웨어 흡수·취약률 −10%'):broken?t('Decoy destroyed / excess damage blocked','미끼폴더 파괴 / 초과 피해 차단'):t('Decoy / attack absorbed','미끼폴더 / 공격 흡수'),'#9ccbe1');updateHUD();return{absorbed:true};
  }
  vulnerability=Math.round((vulnerability+amount)*10)/10;recoveryUntil=0;$('vulnerability-fill').dataset.recovering='false';
  if(coreHit)coreFlashUntil=clock+300;
  playSound(coreHit?'damage':'miss');damageFeedback(coreHit);showMessage(t(`${text} / vulnerability +${amount} pp`,`${text} / 취약률 +${amount}%`),'var(--pink)');updateHUD();
  if(vulnerability>100)gameOver();return{absorbed:false};
}
function onImpact(enemy) {
  renderEnemy(enemy);const contact=contactEnemy(enemy);removeEnemy(enemy);
  const result=dealDamage(TYPES[enemy.kind].damage,enemy.kind==='echo'?t('Trojan follow-up','트로이 재침투'):enemy.kind==='phishing'?t('Phishing breach','피싱 본체 침투'):t('Core hit','코어 피격'),true,enemy.kind);
  if(enemy.kind==='ransom'&&!result.absorbed)lockedUntil[contact.dir]=clock+1200;
  if(mode==='running')releaseTrojan(contact,false);
}
function addEffect(dir,result,schedule=addTimedEffect) {
  const rotate = ROTATION[dir];
  const group = svg('g',{transform:`rotate(${rotate} 240 240)`,stroke:result==='miss'?'#e6acc9':result==='perfect'?'#b7eaaa':'#c1cec3',fill:'none'});
  group.append(svg('path',{d:'M217 29V136 M263 29V136','stroke-width':1.5}));
  if (result!=='miss') group.append(svg('path',{d:'M224 137Q240 129 256 137','stroke-width':result==='perfect'?3:1.5}));
  if (result==='perfect') group.append(svg('path',{d:'M222 122l5 -7m4 7l5 -7m4 7l5 -7','stroke-width':1.5}));
  schedule(group,240,t=>group.setAttribute('opacity',1-t));
}
// Visual effects use game time too, so pause freezes particles and restores cleanly.
function addTimedEffect(node,duration,draw,foreground=false) {
  $(foreground?'foreground-fx':'effects').append(node);
  const effect={node,at:fxClock,duration,draw}; effects.push(effect); draw(0); return effect;
}
function shakeCamera(power) {
  if(reducedMotion.matches) return;
  shake={at:fxClock,until:fxClock+130,power};
}
function resetPose(node=$) {
  node('fighter').setAttribute('transform','translate(240 240)');
  node('fighter').dataset.pose='idle'; node('fighter').dataset.flash='false';
  node('guard-pose').setAttribute('visibility','hidden');
  node('guard-arm').setAttribute('d','M5 -6L17 0L12 6L1 0Z');
  node('legs').setAttribute('d','M-7 9L-12 25L-5 25L2 15L9 25L17 25L10 7Z');
  node('scarf').setAttribute('d','M-7 -9L-25 -5L-17 0L0 -4Z');
}
function strikePose(dir,perfect) {
  poseUntil=fxClock+170; flashUntil=fxClock+65;
  paintStrikePose(dir,perfect,$,addTimedEffect);
}
function paintStrikePose(dir,perfect,node,schedule) {
  const [dx,dy]=DIRECTIONS[dir];
  node('fighter').dataset.pose=dir;
  node('fighter').dataset.flash=String(!reducedMotion.matches);
  // Discrete contact pose: snap toward the threat, then cut back to idle.
  node('fighter').setAttribute('transform',`translate(${240+dx*7} ${240+dy*7}) scale(${dir==='left'?-1:1} 1) rotate(${dir==='down'?13:dir==='up'?-12:-8})`);
  const arms={up:'M2 -5L-2 -17L9 -29L16 -24L10 -11L12 0Z',right:'M3 -7L19 -13L28 -4L21 3L8 0Z',down:'M5 -5L19 5L18 23L10 26L8 10L0 0Z',left:'M3 -7L19 -13L28 -4L21 3L8 0Z'};
  node('guard-arm').setAttribute('d',arms[dir]);
  node('legs').setAttribute('d','M-7 8L-19 22L-10 25L3 15L13 25L23 25L10 7Z');
  node('scarf').setAttribute('d','M-7 -9L-32 -15L-25 -4L0 -4Z');
  node('guard-pose').setAttribute('transform',`rotate(${ROTATION[dir]} 240 240)`);
  node('guard-pose').setAttribute('visibility','visible');
  const trail=svg('g',{transform:`rotate(${ROTATION[dir]} 240 240)`,fill:'none'});
  trail.append(svg('path',{d:'M232 204L226 185L237 157 M248 204L254 185L243 157',stroke:perfect?'#e9ffda':'#97ac93','stroke-width':perfect?1.5:1}));
  trail.append(svg('path',{d:'M219 143L225 135H255L261 143',stroke:'#edffe1','stroke-width':perfect?2:1}));
  schedule(trail,180,t=>trail.setAttribute('opacity',(1-t)*.8),true);
}
function shatterEnemy(enemy,perfect,schedule=addTimedEffect) {
  const [dx,dy]=DIRECTIONS[enemy.dir];
  const x=240+dx*enemy.radius,y=240+dy*enemy.radius;
  const color=TYPES[enemy.kind].color;
  const group=svg('g',{transform:`translate(${x} ${y})`});
  const halves=[];
  for(let i=0;i<2;i++) {
    const shard=svg('g',{});
    const path=enemy.kind==='virus'?(i===0?'M0 -13L-13 0L0 13Z':'M0 -13L13 0L0 13Z'):(i===0?'M0 -12A12 12 0 0 0 0 12Z':'M0 -12A12 12 0 0 1 0 12Z');
    shard.append(svg('path',{d:path,fill:color,stroke:'#efffe4','stroke-width':1}));
    group.append(shard);halves.push(shard);
  }
  const slash=svg('path',{d:'M-23 19L22 -20 M-12 24L18 -9',stroke:'#f3ffe7','stroke-width':perfect?2:1,fill:'none'}); group.append(slash);
  const sparks=[];
  for(let i=0;i<(perfect?8:5);i++) {
    const shard=svg('path',{d:'M0 0L7 -2L3 2Z',fill:i%2?color:'#dcebd5'});group.append(shard);sparks.push(shard);
  }
  schedule(group,reducedMotion.matches?150:430,t=>{
    group.setAttribute('opacity',Math.max(0,1-t));
    if(reducedMotion.matches)return;
    halves.forEach((half,i)=>{const sign=i===0?1:-1;half.setAttribute('transform',`translate(${sign*30*t} ${sign*16*t-12*t}) rotate(${sign*(perfect?310:240)*t}) skewX(${sign*Math.sin(t*Math.PI)*30}) scale(${1-t*.65})`)});
    sparks.forEach((spark,i)=>spark.setAttribute('transform',`rotate(${i*360/sparks.length+30*t}) translate(${8+t*(perfect?42:30)} 0) scale(${1-t*.7})`));
    slash.setAttribute('opacity',Math.max(0,1-t*3));
  },true);
}
function glitchAt(x,y,spread,kind,schedule=addTimedEffect) {
  if(kind==='spawn')playSound('spawn');else if(kind==='reveal')playSound('reveal');
  const group=svg('g',{'data-fx':kind,transform:`translate(${x} ${y})`});
  const bars=[];
  for(let i=0;i<7;i++) {
    const bar=svg('rect',{x:-spread*.7+(i%3)*5,y:-spread+i*spread/3,width:8+(i*7)%spread,height:i%3===0?3:1,fill:i%2?'#e6acc9':'#b7eaaa'});
    group.append(bar);bars.push(bar);
  }
  const duration=kind==='spawn'?220:360;
  schedule(group,reducedMotion.matches?120:duration,t=>{
    group.setAttribute('opacity',(1-t)*(reducedMotion.matches ? .25 : .75));
    if(reducedMotion.matches)return;
    const cut=Math.floor(t*7);
    bars.forEach((bar,i)=>{bar.setAttribute('transform',`translate(${((cut*13+i*7)%17)-8} 0)`);bar.setAttribute('visibility',(cut+i)%4===0?'hidden':'visible')});
  },true);
}
function damageFeedback(coreHit=false) {
  damagedUntil=fxClock+280; $('vulnerability').dataset.damaged='true';
  if(coreHit) {glitchAt(240,240,39,'damage');shakeCamera(4);}
}
function paintTimedEffects(list,now) {
  for(const effect of [...list]) {
    const t=Math.min(1,Math.max(0,(now-effect.at)/effect.duration));effect.draw(t);
    if(t===1){effect.node.remove();list.splice(list.indexOf(effect),1);}
  }
}
function updateEffects() {
  paintTimedEffects(effects,fxClock);
  if(fxClock>=poseUntil && $('fighter').dataset.pose!=='idle') resetPose();
  if(fxClock>=flashUntil || reducedMotion.matches) $('fighter').dataset.flash='false';
  $('vulnerability').dataset.damaged=String(fxClock<damagedUntil);
  if(!reducedMotion.matches&&fxClock<shake.until) {
    const elapsed=fxClock-shake.at,amount=shake.power*(shake.until-fxClock)/130;
    $('world').setAttribute('transform',`translate(${Math.sin(elapsed*.19)*amount} ${Math.cos(elapsed*.23)*amount*.65})`);
  } else $('world').removeAttribute('transform');
}
// Boss state and registry are separate from ordinary enemies, allowing new patterns
// without letting normal cleanup/proxy logic accidentally delete an encounter.
function maybeQueueBoss(){
  if(isRush())return;
  if(activeRun?.mode==='stage'&&!activeRun.bossRequired)return;
  if(bossFight||score<nextBossAt||mode!=='running')return;
  const milestone=nextBossAt;nextBossAt+=100;
  bossFight={phase:'draining',milestone,kind:null,attacks:[],mains:new Map(),lastPress:{}};
  vaccineSlowAt=-Infinity;proxyUntil={};proxyArmed=false;pointers.clear();$('arena').dataset.armed='false';
  nextSpawn=Infinity;nextWorm=Infinity;updateLaneStates();updateSkillHUD();
  for(const enemy of [...enemies]){
    if(!enemy.spawned&&enemy.state==='moving'){removeEnemy(enemy);continue;}
    if(enemy.kind==='worm'&&enemy.state==='dormant'){
      enemy.remaining=0;enemy.state='moving';enemy.travel=scaledTravel('worm');enemy.arrival=reserveArrival(clock+200+enemy.travel);enemy.at=enemy.arrival-enemy.travel;enemy.hop={at:clock,until:enemy.at,x:enemy.x,y:enemy.y};
    }
  }
  updateBossHUD();showMessage(t(`${milestone} / clear remaining threats`,`${milestone} / 남은 위협 정리`));
}
function clearBossActors(){
  $('boss-entities').replaceChildren();
  if(bossFight){bossFight.attacks=[];bossFight.mains.clear();}
}
function bossPhase(phase,duration=0){
  bossFight.phase=phase;bossFight.phaseAt=fxClock;bossFight.phaseUntil=fxClock+duration;updateBossHUD();
}
function updateBossHUD(){
  const fight=bossFight;
  $('boss-hud').hidden=!fight;$('boss-banner').hidden=true;$('reaction-meter').hidden=!fight||fight.phase!=='reaction';
  $('arena').dataset.bossPhase=fight?.phase||'';
  if(!fight)return;
  if(fight.phase==='rest'){
    $('boss-banner').hidden=false;$('boss-banner').dataset.result='';$('boss-name').textContent=t('Boss rush / recovery','보스 러쉬 / 회복');
    $('boss-banner-tag').textContent='/// RECOVERY';$('boss-banner-title').textContent=t('Rest','휴식');
    $('boss-banner-copy').textContent=t('5 seconds · use your skill','5초 휴식 · 스킬을 사용하세요');$('boss-pips').replaceChildren();return;
  }
  const definition=fight.kind?BOSS_TYPES[fight.kind]:null;
  $('boss-name').textContent=t(`${fight.milestone} / ${definition?.name||'Clearing threats'}`,`${fight.milestone} / ${definition?.name||'위협 정리'}`);
  $('boss-pips').replaceChildren();$('boss-pips').style.setProperty('--boss-color',definition?.color||'#e4ca93');
  if(definition)for(let i=0;i<definition.attempts;i++){const pip=document.createElement('i');if(i<fight.remaining)pip.className='live';$('boss-pips').append(pip);}
  $('boss-pips').setAttribute('aria-label',t(`Attempts remaining: ${fight.remaining??'-'}`,`남은 시도횟수 ${fight.remaining??'-'}`));
  if(['warning','finisher','failed'].includes(fight.phase)){
    $('boss-banner').hidden=false;$('boss-banner').dataset.result=fight.phase==='finisher'?'win':'';
    $('boss-banner-tag').textContent=fight.phase==='warning'?`/// INTRUSION ${fight.milestone}`:fight.phase==='finisher'?'/// CONNECTION SEVERED':'-- SIGNAL LOST --';
    $('boss-banner-title').textContent=fight.phase==='warning'?definition.name:fight.phase==='finisher'?t('Intrusion blocked','침입 차단'):t('Domain escaped','도메인 이탈');
    $('boss-banner-copy').textContent=fight.phase==='warning'?definition.hint:(fight.phase==='finisher'?definition.name+t(' eliminated',' 제거'):t('Prepare for the next threat.','다음 위협에 대비하세요.'));
  }
}
function startBossWarning(){
  const choices=Object.keys(BOSS_TYPES);
  if(isRush()){
    if(rushRetryKind){bossFight.kind=rushRetryKind;rushRetryKind=null;}else{
      if(!rushBossBag.length){rushBossBag=[...choices];for(let i=rushBossBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rushBossBag[i],rushBossBag[j]]=[rushBossBag[j],rushBossBag[i]];}}
      bossFight.kind=rushBossBag.shift();
    }
  }else bossFight.kind=choices[Math.floor(Math.random()*choices.length)];
  if(typeof discover==='function')discover('boss',bossFight.kind);
  bossFight.remaining=BOSS_TYPES[bossFight.kind].attempts;bossFight.total=bossFight.remaining;
  vaccineSlowAt=-Infinity;lockedUntil={};proxyUntil={};arrivalSlots=[];pointers.clear();proxyArmed=false;$('arena').dataset.armed='false';
  bossPhase('warning',1750);playSound('boss-warning');updateLaneStates();updateSkillHUD();
}
function randomBossDirection(exclude=null){const dirs=Object.keys(DIRECTIONS).filter(dir=>dir!==exclude);return dirs[Math.floor(Math.random()*dirs.length)];}
function makeBossAttack(dir,arrival,travel,depth=0){
  const definition=BOSS_TYPES[bossFight.kind],r=bossFight.kind==='domain'?20:depth===0?23:depth===1?17:12;
  const group=svg('g',{class:'boss-node'}),outline=svg('path',{d:`M${-r} ${-r*.55}L0 ${-r}L${r} ${-r*.55}V${r*.55}L0 ${r}L${-r} ${r*.55}Z`,fill:'#202820',stroke:definition.color,'stroke-width':1.5});
  const fill=svg('path',{d:`M${-r+3} 0L0 ${-r+3}L${r-3} 0L0 ${r-3}Z`,fill:definition.color});
  const label=svg('text',{x:0,y:-r-9,class:'boss-attack-label'});label.textContent=bossFight.kind==='domain'?'//':depth===0?'1':depth===1?'½':'¼';
  group.append(outline,fill,label);$('boss-entities').append(group);
  const attack={dir,arrival,at:arrival-travel,travel,depth,node:group,fill,outline,startRadius:205,radius:205,kind:bossFight.kind==='domain'?'trojan':'ddos'};
  bossFight.attacks.push(attack);renderBossAttack(attack);return attack;
}
function renderBossAttack(attack){
  const t=Math.max(0,(clock-attack.at)/attack.travel);attack.radius=attack.startRadius-(attack.startRadius-TARGET_RADIUS)*t;
  const [dx,dy]=DIRECTIONS[attack.dir];attack.x=240+dx*attack.radius;attack.y=240+dy*attack.radius;
  attack.node.setAttribute('visibility',clock>=attack.at?'visible':'hidden');attack.node.setAttribute('transform',`translate(${attack.x} ${attack.y})`);
  attack.fill.setAttribute('transform',`scale(${Math.sqrt(Math.min(1,t))})`);
  attack.outline.setAttribute('stroke-width',Math.abs(clock-attack.arrival)<=(attack.depth?fragmentWindow():GUARD_WINDOW)?2.5:1.5);
}
function startDomainRound(dir=randomBossDirection(bossFight.lastDir)){
  clearBossActors();bossFight.lastDir=dir;bossFight.lastPress={};bossPhase('active');const travel=1350/currentDifficulty().bossSpeed;makeBossAttack(dir,clock+travel,travel);
}
function startDomainReaction(attack){
  bossFight.origin=attack.dir;bossFight.lastContact={x:attack.x,y:attack.y,dir:attack.dir};
  const duration={5:2400,4:2200,3:2000,2:1800,1:6000}[bossFight.remaining]/currentDifficulty().bossSpeed;
  const targets=Object.keys(DIRECTIONS).filter(dir=>dir!==attack.dir);
  const sequence=Array.from({length:bossFight.remaining===1?3:1},()=>targets).flat();
  for(let i=sequence.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sequence[i],sequence[j]]=[sequence[j],sequence[i]];}
  bossFight.sequence=sequence;bossFight.sequenceIndex=0;
  bossFight.reactionDuration=duration;bossPhase('reaction',duration);playSound('boss-freeze');
  for(const dir of targets){
    const [dx,dy]=DIRECTIONS[dir],x=240+dx*TARGET_RADIUS,y=240+dy*TARGET_RADIUS;
    const group=svg('g',{transform:`translate(${x} ${y})`});
    group.append(svg('path',{class:'boss-main',d:'M-17 -9L0 -19L17 -9V9L0 19L-17 9Z'}));
    group.append(svg('path',{class:'boss-main-cross',d:'M-25 -13V-25H-13 M13 -25H25V-13 M25 13V25H13 M-13 25H-25V13 M-8 0H8 M0 -8V8'}));
    const label=svg('text',{class:'domain-number',y:5}),queue=svg('text',{class:'domain-queue',y:35});group.append(label,queue);
    $('boss-entities').append(group);bossFight.mains.set(dir,{node:group,label,queue,x,y,dir,radius:TARGET_RADIUS,kind:'trojan'});
  }
  updateDomainNumbers();updateBossHUD();
}
function updateDomainNumbers(){
  const fight=bossFight,next=fight.sequence[fight.sequenceIndex];
  for(const [dir,main] of fight.mains){
    const numbers=fight.sequence.map((d,i)=>d===dir&&i>=fight.sequenceIndex?i+1:null).filter(n=>n!==null);
    main.label.textContent=numbers[0]||'';main.queue.textContent=numbers.slice(1).join(' · ');main.node.dataset.next=String(dir===next);
  }
}
function startDestroyRound(dir=randomBossDirection(bossFight.lastDir)){
  clearBossActors();bossFight.lastDir=dir;bossFight.lastPress={};bossFight.depth=0;bossPhase('active');
  const travel=(1500-(4-bossFight.remaining)*200)/currentDifficulty().bossSpeed;makeBossAttack(dir,clock+travel,travel,0);
}
function spawnDestroyWave(depth){
  const fight=bossFight;fight.depth=depth;fight.wavePlan=[];fight.previewNodes=[];
  let previous=fight.lastContact?.dir||fight.lastDir;
  for(let i=0;i<2**depth;i++){
    const dir=randomBossDirection(previous);fight.wavePlan.push(dir);previous=dir;
    const node=svg('g',{'data-preview':i,transform:`rotate(${ROTATION[dir]} 240 240)`});
    const defs=svg('defs',{}),gradient=svg('linearGradient',{id:`preview-light-${i}`,x1:'0%',y1:'0%',x2:'0%',y2:'100%'});
    for(const [offset,opacity] of [['0%',.95],['32%',.55],['100%',0]])gradient.append(svg('stop',{offset,'stop-color':'#e6acc9','stop-opacity':opacity}));
    defs.append(gradient);node.append(defs);
    node.append(svg('path',{d:'M200 0H280L260 88Q240 124 220 88Z',fill:`url(#preview-light-${i})`}));
    node.append(svg('rect',{x:207,y:1,width:66,height:3,fill:'#f4c9df'}));
    const number=svg('text',{x:240,y:52,class:'boss-attack-label',transform:`rotate(${-ROTATION[dir]} 240 52)`});number.textContent=i+1;node.append(number);node.setAttribute('opacity',0);
    $('boss-entities').append(node);fight.previewNodes.push(node);
  }
  fight.previewInterval=190/currentDifficulty().bossSpeed;
  bossPhase('telegraph',fight.wavePlan.length*fight.previewInterval+160/currentDifficulty().bossSpeed);updateDestroyPreview();playSound('reveal');
}
function updateDestroyPreview(){
  const fight=bossFight,duration=300/currentDifficulty().bossSpeed;
  for(let i=0;i<fight.previewNodes.length;i++){
    const age=fxClock-fight.phaseAt-i*fight.previewInterval;
    const opacity=age>=0&&age<duration?(reducedMotion.matches?.65:(1-age/duration)**2):0;
    fight.previewNodes[i].setAttribute('opacity',opacity);
  }
}
function launchDestroyWave(){
  const fight=bossFight,bossSpeed=currentDifficulty().bossSpeed;
  for(const node of fight.previewNodes)node.remove();fight.previewNodes=[];
  const base=(1500-(4-fight.remaining)*200)/bossSpeed,travel=base*(fight.depth===1?.62:.48),gap=(220-(4-fight.remaining)*20)/bossSpeed;
  bossPhase('active');fight.lastPress={};
  fight.wavePlan.forEach((dir,i)=>makeBossAttack(dir,clock+travel+i*gap,travel,fight.depth));
  playSound('reveal');
}
function bossHitFeedback(contact,heavy=false){
  strikePose(contact.dir,heavy);shatterEnemy(contact,heavy);addEffect(contact.dir,heavy?'perfect':'guard');shakeCamera(heavy?3:1.8);playSound('boss-hit');
  charge=Math.min(SKILLS[selectedSkill].cost,charge+1);updateSkillHUD();
}
function bossParry(dir,inputClock=clock){
  const fight=bossFight;if(!fight||!DIRECTIONS[dir])return;
  if(fxClock-(fight.lastPress[dir]??-Infinity)<90)return;
  fight.lastPress[dir]=fxClock;
  if(fight.phase==='reaction'){BOSS_TYPES[fight.kind].react?.(dir);return;}
  if(fight.phase!=='active')return;
  const candidates=fight.attacks.filter(a=>a.dir===dir&&Math.abs(inputClock-a.arrival)<=(a.depth?fragmentWindow():GUARD_WINDOW)).sort((a,b)=>Math.abs(inputClock-a.arrival)-Math.abs(inputClock-b.arrival));
  const attack=candidates[0];
  if(!attack){dealDamage(MISINPUT_DAMAGE,t('Empty parry','헛방어'),false);addEffect(dir,'miss');return;}
  if(activeRun?.stats&&Math.abs(inputClock-attack.arrival)>PERFECT_WINDOW)activeRun.stats.nonPerfectKills++;
  renderBossAttack(attack);attack.node.remove();fight.attacks.splice(fight.attacks.indexOf(attack),1);fight.lastContact=attack;bossHitFeedback(attack,false);
  BOSS_TYPES[fight.kind].onHit(attack);
}
function guardMainDomain(dir){
  const fight=bossFight;
  if(fxClock>=fight.phaseUntil){failDomain();return;}
  const main=fight.mains.get(dir);
  if(!main||fight.sequence[fight.sequenceIndex]!==dir){
    dealDamage(MISINPUT_DAMAGE,t('Wrong sequence','순서 오류'),false);addEffect(dir,'miss');return;
  }
  fight.sequenceIndex++;fight.lastContact=main;bossHitFeedback(main,true);
  if(!fight.sequence.slice(fight.sequenceIndex).includes(dir)){main.node.remove();fight.mains.delete(dir);}
  if(fight.sequenceIndex===fight.sequence.length){
    fight.remaining--;vulnerability=Math.max(0,Math.round((vulnerability-5)*10)/10);recoveryUntil=clock+700;$('vulnerability-fill').dataset.recovering='true';updateHUD();
    showMessage(t('Sequence cleared / vulnerability −5 pp','순서 패링 성공 / 취약률 −5%p'));
    if(!fight.remaining)finishBoss();else bounceBoss(550);
  }else updateDomainNumbers();
}
function resolveDestroyHit(){
  const fight=bossFight;
  if(fight.attacks.length===0){
    if(fight.depth<2)spawnDestroyWave(fight.depth+1);
    else{fight.remaining--;vulnerability=Math.max(0,vulnerability-20);recoveryUntil=clock+700;$('vulnerability-fill').dataset.recovering='true';updateHUD();showMessage(t('Split blocked / vulnerability −20 pp','분열 차단 / 취약률 −20%p'));if(!fight.remaining)finishBoss();else bounceBoss(600);}
  }
}
function bounceBoss(duration){
  clearBossActors();bossFight.nextDir=randomBossDirection(bossFight.lastDir);bossPhase('rebound',duration);
  const from=bossFight.lastContact,[dx,dy]=DIRECTIONS[bossFight.nextDir],x=240+dx*180,y=240+dy*180;
  const chip=svg('path',{d:'M-12 0L0 -12L12 0L0 12Z',fill:BOSS_TYPES[bossFight.kind].color});
  addTimedEffect(chip,duration,t=>{const u=1-t;chip.setAttribute('transform',`translate(${u*u*from.x+2*u*t*240+t*t*x} ${u*u*from.y+2*u*t*240+t*t*y}) rotate(${t*220})`);chip.setAttribute('opacity',1-t*.3);},true);
}
function failDomain(){
  if(!bossFight||bossFight.kind!=='domain'||bossFight.phase==='failed')return;
  const amount=bossFight.remaining*20;clearBossActors();bossPhase('failed',1000);playSound('boss-fail');
  dealDamage(amount,t('Main Domain missed','메인 도메인 반응 실패'),true,'boss');
}
function missDestroy(attack){
  if(!bossFight||bossFight.phase!=='active')return;
  const amount=27.5*bossFight.remaining*(.5**attack.depth);clearBossActors();bossPhase('retry',950);playSound('boss-fail');
  dealDamage(amount,t(`Split stage ${attack.depth} missed`,`분열 ${attack.depth}단계 누락`),true,'boss');
}
function finishBoss(){
  const fight=bossFight,contact=fight.lastContact||{x:240,y:136,dir:'up'};clearBossActors();bossPhase('finisher',1150);playSound('boss-finish');shakeCamera(5);
  if(activeRun?.mode==='stage')activeRun.bossDefeated=true;
  strikePose(contact.dir,true);score++;
  if(isRush()){vulnerability=Math.max(0,Math.round((vulnerability-score)*10)/10);recoveryUntil=clock+700;$('vulnerability-fill').dataset.recovering='true';}
  if(activeRun?.mode==='endless'&&fight.milestone===100&&typeof awardAchievement==='function')awardAchievement('first-meeting');
  rememberBest();updateHUD();
  const group=svg('g',{transform:`translate(${contact.x} ${contact.y})`}),halves=[];
  for(let i=0;i<2;i++){const half=svg('path',{d:i?'M0 -35L32 -18V18L0 35Z':'M0 -35L-32 -18V18L0 35Z',fill:BOSS_TYPES[fight.kind].color,stroke:'#f1ffe9','stroke-width':1.5});group.append(half);halves.push(half);}
  const slash=svg('path',{d:'M-75 60L80 -65 M-40 74L65 -45',stroke:'#f4ffe9','stroke-width':4,fill:'none'});group.append(slash);
  const wave=svg('circle',{cx:0,cy:0,r:24,stroke:'#c5edb2','stroke-width':1,fill:'none'});group.append(wave);
  addTimedEffect(group,1000,t=>{group.setAttribute('opacity',1-t);if(!reducedMotion.matches){halves.forEach((part,i)=>part.setAttribute('transform',`translate(${(i?1:-1)*t*90} ${-t*22}) rotate(${(i?-1:1)*t*350}) skewX(${(i?1:-1)*Math.sin(t*Math.PI)*25})`));wave.setAttribute('r',24+t*145);}slash.setAttribute('opacity',Math.max(0,1-t*2.5));},true);
}
function startRushRest(){
  clearBossActors();bossFight={phase:'rest',phaseAt:fxClock,phaseUntil:fxClock+5000,milestone:score+1,kind:null,attacks:[],mains:new Map(),lastPress:{}};
  nextSpawn=Infinity;nextWorm=Infinity;charge=SKILLS[selectedSkill].cost;proxyUntil={};lockedUntil={};arrivalSlots=[];updateHUD();
}
function resumeRegularAfterBoss(){
  if(isRush()){if(bossFight?.phase==='failed')rushRetryKind=bossFight.kind;startRushRest();return;}
  clearBossActors();bossFight=null;arrivalSlots=[];nextSpawn=clock+1300;nextWorm=score>=15?clock+5000:Infinity;lastInput={};for(const dir of Object.keys(DIRECTIONS))lastInput[dir]=-Infinity;
  if(activeRun?.mode==='stage'&&activeRun.bossRequired&&score>=activeRun.target){
    if(checkStageCompletion())return;
    // An escaped Fake Domain does not satisfy the stage's boss objective.
    nextBossAt=activeRun.target;maybeQueueBoss();updateHUD();return;
  }
  updateBossHUD();updateHUD();maybeQueueBoss();
}
function updateBoss(delta){
  if(!bossFight)maybeQueueBoss();
  const fight=bossFight;
  if(fight){
    if(fight.phase==='rest'){
      const seconds=Math.max(0,Math.ceil((fight.phaseUntil-fxClock)/1000));$('boss-banner-title').textContent=t(`Rest · ${seconds}`,`휴식 · ${seconds}`);
      if(fxClock>=fight.phaseUntil)startBossWarning();
    }else if(fight.phase==='draining'&&enemies.length===0)startBossWarning();
    else if(fight.phase==='warning'&&fxClock>=fight.phaseUntil)BOSS_TYPES[fight.kind].start();
    else if(fight.phase==='reaction'){
      const progress=Math.max(0,(fight.phaseUntil-fxClock)/fight.reactionDuration);$('reaction-fill').style.width=(100*progress)+'%';$('reaction-meter').setAttribute('aria-valuenow',Math.round(100*progress));
      if(fxClock>=fight.phaseUntil)failDomain();
    }else if(fight.phase==='telegraph'){
      updateDestroyPreview();if(fxClock>=fight.phaseUntil)launchDestroyWave();
    }else if(fight.phase==='rebound'&&fxClock>=fight.phaseUntil)BOSS_TYPES[fight.kind].start(fight.nextDir);
    else if(fight.phase==='retry'&&fxClock>=fight.phaseUntil)startDestroyRound();
    else if(['failed','finisher'].includes(fight.phase)&&fxClock>=fight.phaseUntil)resumeRegularAfterBoss();
    if(bossFight?.phase==='active')for(const attack of [...bossFight.attacks]){renderBossAttack(attack);if(attack.radius<=IMPACT_RADIUS){BOSS_TYPES[bossFight.kind].onMiss(attack);break;}}
  }
  const target=!reducedMotion.matches&&bossFight?.phase==='reaction'?1.11:!reducedMotion.matches&&bossFight?.phase==='finisher'?1.16:1;
  cameraZoom+=(target-cameraZoom)*Math.min(1,delta/65);
  if(Math.abs(cameraZoom-1)<.001&&target===1){cameraZoom=1;$('camera').removeAttribute('transform');}
  else $('camera').setAttribute('transform',`translate(240 240) scale(${cameraZoom}) translate(-240 -240)`);
}
function parry(dir,inputClock=clock) {
  if(mode==='running'&&bossFight&&bossFight.phase!=='draining'){bossParry(dir,inputClock);return;}
  if(mode!=='running'||!DIRECTIONS[dir]||clock-lastInput[dir]<COOLDOWN)return;
  if(clock<(lockedUntil[dir]||0)){showMessage(t('Ransomware / lane locked','랜섬웨어 / 방향 잠금'),'var(--pink)');return;}
  lastInput[dir]=clock;
  const enemy=enemies.find(e=>targetDirection(e)===dir&&e.state==='moving'&&(!e.hop||clock>=e.hop.until)&&(!e.push||clock>=e.push.until)&&(e.kind!=='phishing'||e.revealed)&&Math.abs(inputClock-e.arrival)<=GUARD_WINDOW);
  if(!enemy){dealDamage(MISINPUT_DAMAGE,t('Empty parry','헛방어'),false);addEffect(dir,'miss');return;}
  const perfect=Math.abs(inputClock-enemy.arrival)<=PERFECT_WINDOW;
  if(!perfect&&activeRun?.stats)activeRun.stats.nonPerfectKills++;
  renderEnemy(enemy);const contact=contactEnemy(enemy);shatterEnemy(contact,perfect);playSound(perfect?'perfect':'guard');strikePose(dir,perfect);shakeCamera(perfect?2.4:1.4);removeEnemy(enemy);
  score++;charge=Math.min(SKILLS[selectedSkill].cost,charge+1);
  const healing=perfect?(enemy.kind==='worm'?20:PERFECT_RECOVERY):0;
  if(healing){vulnerability=Math.max(0,vulnerability-healing);recoveryUntil=clock+650;$('vulnerability-fill').dataset.recovering='true';}
  rememberBest();updateHUD();addEffect(dir,perfect?'perfect':'guard');
  showMessage(perfect?t(`Perfect / vulnerability −${healing} pp`,`정밀 패링 / 취약률 −${healing}%`):t('Guarded','방어'),perfect?'var(--green)':'var(--ink)');
  tickWorms(dir);releaseTrojan(contact,true);checkUnlocks();
}
function checkUnlocks() {
  if(checkStageCompletion())return;
  if(score>=15&&nextWorm===Infinity&&!bossFight)nextWorm=clock+2500;
  maybeQueueBoss();
}
function updateSkillHUD() {
  for(const button of document.querySelectorAll('[data-skill]'))button.hidden=isRush()&&button.dataset.skill==='proxy';
  const config=SKILLS[selectedSkill],ready=charge>=config.cost;
  $('skill-name').textContent=config.name;
  $('skill-key').textContent=selectedSkill!=='proxy'?t('Space / lane swipe','Space / 라인 스와이프'):t('Shift + direction / lane swipe','Shift + 방향 / 라인 스와이프');
  $('skill').disabled=mode!=='running'||!ready||skillsLocked();$('skill').dataset.ready=String(ready&&!skillsLocked()&&mode==='running');
  $('skill').setAttribute('aria-label',config.name+t(' skill',' 스킬')+(ready?t(' ready',' 준비'):t(' charging',' 충전 중')));
  $('skill-meter').setAttribute('aria-valuemax',config.cost);$('skill-meter').setAttribute('aria-valuenow',charge);
  $('skill-fill').style.width=(100*charge/config.cost)+'%';
  $('skill-status').textContent=(mode==='over'||mode==='cleared')?t('Choose a skill, then Retry','스킬을 고른 뒤 재도전하세요'):skillsLocked()?t('Skills locked during boss encounter','보스전 중 스킬 잠금'):rushRest()&&!ready?t('Recharges at next rest','다음 휴식에 충전됩니다'):proxyArmed?t('Tap a lane to use Proxy.','사용할 방향을 터치하세요.'):ready?t('Ready','준비 완료'):t(`Eliminate to charge · ${charge}/${config.cost}`,`처치로 충전 · ${charge}/${config.cost}`);
  $('skill-glyph').setAttribute('d',selectedSkill==='decoy'?'M3 8H12L16 12H29V27H3Z M8 18H24':selectedSkill==='vaccine'?'M16 3L27 8V17L16 29L5 17V8Z M16 10V22 M10 16H22':'M3 7H21L29 16L21 25H3V7Z M9 11H19V21H9Z');
}
function selectSkill(skill) {
  if(mode==='running'||mode==='paused'||!Object.hasOwn(SKILLS,skill)||(isRush()&&skill==='proxy'&&(mode==='over'||mode==='cleared')))return;
  if(mode==='over'||mode==='cleared')retrySkill=skill;
  selectedSkill=skill;charge=0;
  for(const button of document.querySelectorAll('[data-skill]'))button.setAttribute('aria-pressed',String(button.dataset.skill===skill));
  updateSkillHUD();
}
function activateSkill(dir=null) {
  if(mode!=='running')return false;
  if(skillsLocked()){showMessage(t('Skills locked during boss encounter','보스전 중 스킬 잠금'));return false;}
  const config=SKILLS[selectedSkill];
  if(charge<config.cost){showMessage(t('Skill charging','스킬 충전 중'));return false;}
  if(selectedSkill==='proxy'&&!DIRECTIONS[dir]){proxyArmed=!proxyArmed;$('arena').dataset.armed=String(proxyArmed);updateSkillHUD();return false;}
  if(activeRun?.stats)activeRun.stats.skillsUsed++;
  charge=0;proxyArmed=false;$('arena').dataset.armed='false';
  if(selectedSkill==='vaccine') {
    vulnerability=Math.max(0,vulnerability-config.heal);recoveryUntil=clock+800;$('vulnerability-fill').dataset.recovering='true';
    const ring=svg('circle',{cx:240,cy:240,r:36,fill:'none',stroke:'#b7eaaa','stroke-width':2});
    addTimedEffect(ring,550,t=>{ring.setAttribute('r',36+t*155);ring.setAttribute('opacity',1-t);},true);
    vaccineSlowAt=fxClock;playSound('vaccine');
    showMessage(t('Vaccine / −29 pp · field stop + acceleration 1.2s','백신 / 취약률 −29%p · 정지·재가속 1.2초'));
  } else if(selectedSkill==='proxy') {
    let removed=0;
    for(const enemy of [...enemies].filter(e=>targetDirection(e)===dir||(e.kind==='phishing'&&e.dir===dir))){
      if(enemy.spawned)shatterEnemy(contactEnemy(enemy),false);
      if(removeEnemy(enemy)&&enemy.kind!=='echo')removed++;
    }
    if(activeRun?.stats)activeRun.stats.nonPerfectKills+=removed;
    proxyUntil[dir]=clock+config.duration;score+=removed;rememberBest();checkUnlocks();
    addEffect(dir,'perfect');playSound('proxy');showMessage(t('Proxy / lane cleared and blocked','프록시 / 경로 정리·생성 차단'),'#9ccbe1');
  } else {
    decoyCapacity=config.capacity;playSound('decoy');glitchAt(272,267,18,'decoy');showMessage(t('Decoy / shield reset to 50','미끼폴더 / 수용률 50% 설정'),'#9ccbe1');
  }
  updateHUD();updateLaneStates();return true;
}
function updateLaneStates() {
  for(const dir of Object.keys(DIRECTIONS)) {
    let group=$('lane-state-'+dir);
    if(!group){group=svg('g',{id:'lane-state-'+dir,transform:`rotate(${ROTATION[dir]} 240 240)`});
      const block=svg('g',{'data-proxy':dir});block.append(svg('path',{d:'M219 50L225 44H255L261 50 M219 55H261 M224 61H256',stroke:'#9ccbe1','stroke-width':1.5,fill:'none'}));
      const bar=svg('rect',{x:224,y:66,width:32,height:2,fill:'#9ccbe1'});block.append(bar);group.append(block);
      const gate=svg('path',{'data-gate':dir,stroke:'#84977b','stroke-width':1,fill:'none'});group.append(gate);
      const lock=svg('g',{'data-lock':dir});lock.append(svg('path',{d:'M227 57L253 83 M253 57L227 83',stroke:'#d5b1e8','stroke-width':2}));group.append(lock);$('lane-states').append(group);}
    const blocked=clock<(proxyUntil[dir]||0),locked=clock<(lockedUntil[dir]||0);
    const ordinary=enemies.filter(e=>targetDirection(e)===dir&&e.state==='moving'&&(e.kind!=='phishing'||e.revealed)&&e.arrival>=clock-GUARD_WINDOW);
    const bossIncoming=bossFight?.phase==='active'?bossFight.attacks.filter(e=>e.dir===dir&&e.arrival>=clock-(e.depth?fragmentWindow():GUARD_WINDOW)):[];
    const incoming=[...ordinary,...bossIncoming].sort((a,b)=>a.arrival-b.arrival)[0];
    const gate=group.querySelector('[data-gate]');
    if(incoming){
      const radiusAt=offset=>{const t=1+offset/incoming.travel;return Math.max(IMPACT_RADIUS,Math.min(incoming.startRadius,incoming.startRadius-(incoming.startRadius-TARGET_RADIUS)*(incoming.kind==='worm'?Math.max(0,t)**2:t)))};
      const guard=incoming.depth?fragmentWindow():GUARD_WINDOW,outer=240-radiusAt(-guard),inner=240-radiusAt(guard);
      gate.setAttribute('d',`M222 ${outer}H230 M250 ${outer}H258 M222 ${inner}H230 M250 ${inner}H258`);
      gate.setAttribute('visibility','visible');
    }else gate.setAttribute('visibility','hidden');
    group.querySelector('[data-proxy]').setAttribute('visibility',blocked?'visible':'hidden');
    group.querySelector('rect').setAttribute('width',32*Math.max(0,((proxyUntil[dir]||0)-clock)/SKILLS.proxy.duration));
    group.querySelector('[data-lock]').setAttribute('visibility',locked?'visible':'hidden');
    const button=document.querySelector(`.direction[data-dir="${dir}"]`);button.textContent=locked?'×':{up:'↑',right:'→',down:'↓',left:'←'}[dir];
    button.setAttribute('aria-label',{up:t('Up','위쪽'),right:t('Right','오른쪽'),down:t('Down','아래쪽'),left:t('Left','왼쪽')}[dir]+(locked?t(' lane locked',' 방향 잠금'):t(' parry',' 패링')));
  }
}
// Integrate a 300ms stop followed by a 900ms quadratic acceleration.
// All enemy timelines share this clock; frame size cannot change the total slowdown.
function vaccineMovementTime(elapsed){
  if(elapsed<=300)return 0;
  if(elapsed>=1200)return elapsed-900;
  return (elapsed-300)**3/(3*900**2);
}
function step(delta) {
  if(mode!=='running')return;
  fxClock+=delta;
  if(typeof achievementUntil!=='undefined'&&fxClock>=achievementUntil)$('achievement-toast').hidden=true;
  const elapsed=fxClock-vaccineSlowAt;
  const fieldDelta=Number.isFinite(vaccineSlowAt)?vaccineMovementTime(elapsed)-vaccineMovementTime(elapsed-delta):delta;
  clock+=bossFight?.phase==='reaction'?delta*.045:bossFight?.phase==='finisher'?delta*.12:fieldDelta;
  if(messageUntil&&clock>messageUntil){$('message').textContent='';messageUntil=0;}
  if(!isRush()&&!bossFight&&clock>=nextSpawn)scheduleRegular();
  if(!isRush()&&!bossFight&&score>=15&&clock>=nextWorm){
    const dirs=availableDirections().filter(dir=>!enemies.some(e=>e.kind==='worm'&&e.state==='dormant'&&e.dir===dir));
    if(dirs.length&&enemies.filter(e=>e.kind==='worm'&&e.state==='dormant').length<2)spawnWorm(dirs[Math.floor(Math.random()*dirs.length)]);
    nextWorm=clock+random(10000,15000)/pace().speed;
  }
  if(clock>=recoveryUntil)$('vulnerability-fill').dataset.recovering='false';
  for(const enemy of [...enemies]) {
    if(!enemies.includes(enemy))continue;renderEnemy(enemy);
    if(enemy.state==='dormant'||(enemy.hop&&clock<enemy.hop.until)||clock<enemy.at)continue;
    if(enemy.state==='echo'){if(clock>=enemy.at+enemy.travel)onImpact(enemy);}
    else if(enemy.radius<=IMPACT_RADIUS)onImpact(enemy);
    if(mode!=='running')break;
  }
  if(mode==='running')updateBoss(delta);
  updateEffects();updateLaneStates();$('core').style.opacity=clock<coreFlashUntil?'.4':'1';
}
function loop(now) {
  if (mode !== 'running') return;
  // Game time freezes when paused; a stalled frame is not allowed to skip the parry window.
  const delta = lastFrame === null ? 0 : Math.min(50,Math.max(0,now-lastFrame));
  lastFrame = now; step(delta);
  if (mode === 'running') frame = requestAnimationFrame(loop);
}
$('action').addEventListener('click',()=>{
  if(window.NeonDuel?.isActive()){window.NeonDuel.action();return;}
  if(($('help-dialog').open||$('patch-dialog').open))return;
  if (mode==='running') pauseGame(); else if (mode==='paused') resumeGame(); else replayRun();
});
if($('next-stage'))$('next-stage').addEventListener('click',advanceStage);
function pointerDirection(x,y,target) {
  const button=target.closest('[data-dir]');if(button)return button.dataset.dir;
  const rect=$('arena').getBoundingClientRect(),dx=x-rect.left-rect.width/2,dy=y-rect.top-rect.height/2;
  if(Math.hypot(dx,dy)<rect.width*.065)return null;
  return Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
}
$('arena').addEventListener('pointerdown',event=>{
  if(mode!=='running'||event.button>0)return;event.preventDefault();
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,clock,dir:pointerDirection(event.clientX,event.clientY,event.target),dx:0,dy:0});
  try{$('arena').setPointerCapture(event.pointerId);}catch{}
});
$('arena').addEventListener('pointermove',event=>{
  const point=pointers.get(event.pointerId);if(!point)return;
  const dx=event.clientX-point.x,dy=event.clientY-point.y;
  if(Math.hypot(dx,dy)>Math.hypot(point.dx,point.dy)){point.dx=dx;point.dy=dy;}
});
$('arena').addEventListener('pointerup',event=>{
  const point=pointers.get(event.pointerId);pointers.delete(event.pointerId);if(!point||mode!=='running')return;
  const dx=event.clientX-point.x,dy=event.clientY-point.y;
  if(Math.hypot(dx,dy)>Math.hypot(point.dx,point.dy)){point.dx=dx;point.dy=dy;}
  const moved=Math.hypot(point.dx,point.dy)>=28;
  if(moved){
    const vertical=point.dir==='up'||point.dir==='down';
    if(point.dir&&(vertical?Math.abs(point.dy)>Math.abs(point.dx)*1.2:Math.abs(point.dx)>Math.abs(point.dy)*1.2))activateSkill(point.dir);
  } else if(point.dir){if(proxyArmed)activateSkill(point.dir);else parry(point.dir,clock-point.clock<=180?point.clock:clock);}
});
for(const type of ['dblclick','contextmenu','gesturestart'])$('arena').addEventListener(type,event=>event.preventDefault(),{passive:false});
$('arena').addEventListener('pointercancel',event=>pointers.delete(event.pointerId));
for(const button of document.querySelectorAll('[data-skill]'))button.addEventListener('click',()=>selectSkill(button.dataset.skill));
$('skill').addEventListener('click',()=>activateSkill());
// Native keyboard/assistive-technology activation of each direction button.
for (const button of document.querySelectorAll('[data-dir]')) button.addEventListener('click',event=>{if(event.detail===0){if(proxyArmed)activateSkill(button.dataset.dir);else parry(button.dataset.dir);}});
document.addEventListener('keydown',event=>{
  if(window.NeonDuel?.isActive())return;
  if (($('help-dialog').open||$('patch-dialog').open)) return;
  if($('game-view')?.hidden)return;
  if(event.code==='Escape'&&$('game-shell').classList.contains('expanded')){event.preventDefault();leaveFullscreen();return;}
  if (event.target.closest('input,textarea,select,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
  const dir = KEYS[event.code];
  if(dir&&mode==='running'){event.preventDefault();if(!event.repeat){if(event.shiftKey&&selectedSkill==='proxy')activateSkill(dir);else parry(dir);}}
  if(event.code==='Space'&&mode==='running'){event.preventDefault();if(!event.repeat&&selectedSkill!=='proxy')activateSkill();}
  if (event.code==='Escape' && !event.repeat) { if(mode==='running') pauseGame(); else if(mode==='paused') resumeGame(); }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden) pauseGame();});
window.addEventListener('blur',pauseGame);
$('share').addEventListener('click',async()=>{
  pauseGame();
  const text = isRush()?t(`Neon Parry · Best: ${best} bosses!`,`Neon Parry · 최고 ${best}회 보스 처치!`):t(`Neon Parry · Best: ${best} eliminations!`,`Neon Parry · 최고 ${best}회 방어!`);
  const shareURL=window.top===window&&/^https?:$/.test(location.protocol)?location.href:'';
  try {
    if(window.neonDesktop?.copyScore) { await window.neonDesktop.copyScore(text); $('share-status').textContent=t('Score copied.','기록을 복사했어요.'); }
    else if(navigator.share) await navigator.share({title:'Neon Parry',text,...(shareURL?{url:shareURL}:{})});
    else if(navigator.clipboard && location.protocol!=='file:') { await navigator.clipboard.writeText(text+(shareURL?' '+shareURL:'')); $('share-status').textContent=t('Score and link copied.','공유 링크를 복사했어요.'); }
    else $('share-status').textContent=text;
  } catch(error) { if(error.name!=='AbortError') $('share-status').textContent=t('Copy the page address to share.','주소창의 링크를 복사해 공유하세요.'); }
});
document.addEventListener('pointerdown',unlockAudio,{capture:true,passive:true});
document.addEventListener('keydown',unlockAudio,{capture:true});
$('sound-toggle').addEventListener('click',()=>{soundEnabled=!soundEnabled;try{localStorage.setItem('neon-parry-sound',soundEnabled?'on':'off');}catch{}updateSoundButton();if(soundEnabled){unlockAudio();playSound('start');}else silenceSound();});

// Initial hidden fallback; features.js builds the discovery-aware tabbed guide.
const HELP={en:'<p>Arrow keys / WASD, or tap the incoming lane.</p>',ko:'<p>방향키/WASD 또는 적이 오는 라인을 터치하세요.</p>'};
function refreshLanguage(){
  document.documentElement.lang=language;$('language').value=language;
  for(const node of document.querySelectorAll('[data-i18n]'))node.innerHTML=STATIC_TEXT[node.dataset.i18n][language==='ko'?1:0];
  for(const node of document.querySelectorAll('[data-i18n-label]'))node.setAttribute('aria-label',STATIC_TEXT[node.dataset.i18nLabel][language==='ko'?1:0]);
  $('help-open').textContent=t('Help','도움말');$('help-title').textContent=t('How to play','플레이 방법');$('help-close').textContent=t('Close ×','닫기 ×');if(typeof renderGuide==='function')renderGuide();else $('help-content').innerHTML=HELP[language];
  $('action').textContent=mode==='running'?t('Pause','일시정지'):mode==='paused'?t('Resume','계속하기'):mode==='cleared'?t('Retry stage','스테이지 재도전'):mode==='over'?t('Retry','다시 방어'):t('Start','방어 시작');
  if(mode==='paused'){$('overlay-title').textContent=t('Paused','일시정지');$('overlay-copy').textContent=t('Resume when you are ready.','준비되면 같은 위치에서 이어가세요.');}
  if(mode==='over'){$('overlay-title').textContent=t('Core disconnected','코어 연결 끊김');$('overlay-copy').textContent=t(`${score} eliminations · ${vulnerability}% vulnerability`,`${score}회 방어 · 취약률 ${vulnerability}%`);}
  if(mode==='cleared'){$('overlay-title').textContent=t(`Stage ${activeRun.stage} cleared`,`스테이지 ${activeRun.stage} 클리어`);$('overlay-copy').textContent=stageResultCopy();}
  $('message').textContent='';$('share-status').textContent='';updateSoundButton();updateHUD();updateLaneStates();updateFullscreenButton();requestAnimationFrame(fitConsole);
  if(typeof refreshMenu==='function')refreshMenu();
}
$('language').addEventListener('change',event=>{language=event.target.value==='ko'?'ko':'en';try{localStorage.setItem('neon-parry-language',language);}catch{}refreshLanguage();});
function openHelp(tab) {
  if (typeof renderGuide === 'function') renderGuide(tab);
  pauseGame();
  pointers.clear();
  const dialog = $('help-dialog');
  dialog.showModal();
  dialog.scrollTop = 0;
}
$('help-open').addEventListener('click', () => openHelp());
$('help-close').addEventListener('click',()=>$('help-dialog').close());
$('help-dialog').addEventListener('click',event=>{if(event.target===$('help-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
function updateFullscreenButton(){const active=!!document.fullscreenElement||$('game-shell').classList.contains('expanded');$('fullscreen').textContent=active?t('Exit full screen','전체화면 종료'):t('Full screen','전체화면');$('fullscreen').setAttribute('aria-pressed',String(active));}
function leaveFullscreen(){if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});$('game-shell').classList.remove('expanded');document.body.classList.remove('expanded');updateFullscreenButton();requestAnimationFrame(fitConsole);}
$('fullscreen').addEventListener('click',async()=>{
  const shell=$('game-shell');if(document.fullscreenElement||shell.classList.contains('expanded')){leaveFullscreen();return;}
  shell.classList.add('expanded');document.body.classList.add('expanded');updateFullscreenButton();fitConsole();
  try{if(shell.requestFullscreen)await shell.requestFullscreen();}catch{}finally{updateFullscreenButton();requestAnimationFrame(fitConsole);}
});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement){$('game-shell').classList.remove('expanded');document.body.classList.remove('expanded');}updateFullscreenButton();requestAnimationFrame(fitConsole);});
function fitConsole(){
 if($('game-view')?.hidden)return;
 const shell=$('game-shell');if(!shell)return;const portrait=matchMedia('(max-width:600px) and (orientation:portrait)').matches;
 const style=getComputedStyle(shell),width=shell.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
 const height=(visualViewport?.height||innerHeight)-shell.getBoundingClientRect().top-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
 const sidebar=document.querySelector('.sidebar'),header=document.querySelector('header');
 const available=height-header.getBoundingClientRect().height-(portrait?sidebar.getBoundingClientRect().height:0)-(portrait?110:108);
 const size=Math.floor(Math.max(150,Math.min(650,portrait?width:width-278,available)));
 shell.style.setProperty('--arena-size',size+'px');$('arena').classList.toggle('compact',size<260);
}
window.addEventListener('resize',fitConsole);window.visualViewport?.addEventListener('resize',fitConsole);
new ResizeObserver(()=>requestAnimationFrame(fitConsole)).observe(document.querySelector('.sidebar'));
refreshLanguage();

