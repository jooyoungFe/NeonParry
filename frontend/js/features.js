'use strict';

// Progress is local to this browser/app origin. No gameplay bonuses are granted.
function storeCollection(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function discover(category,id){
  const key=`${category}:${id}`;if(discoveries[key]===true)return;
  discoveries[key]=true;storeCollection('neon-parry-discoveries',discoveries);
}
function achievementDefinitions(){
  const entries=[];
  for(const id of Object.keys(RUN_DIFFICULTIES)){
    const name=difficultyName(id);
    entries.push({id:`clear:${id}`,name:t(`${name} cleared`,`${name} 클리어`),description:t('Clear Stage 5 on this difficulty.','해당 난이도 스테이지 5의 보스를 처치하고 클리어하세요.')});
    entries.push({id:`arrows:${id}`,name:t(`Only Arrow · ${name}`,`온리 에로우 · ${name}`),description:t('Clear Stage 5 without using any skill during that run.','해당 난이도 스테이지 5에서 스킬을 한 번도 사용하지 않고 클리어하세요.')});
    entries.push({id:`perfect:${id}`,name:t(`Only Perfect · ${name}`,`온리 퍼펙트 · ${name}`),description:t('Clear Stage 5 using only perfect kills. Proxy kills and non-perfect boss approach/fragment parries disqualify the run; numbered Domain reactions count when correctly ordered.','해당 난이도 스테이지 5에서 정밀 패링으로만 제거해 클리어하세요. 프록시 처치와 비정밀 보스 접근·분열체 패링은 제외됩니다. 도메인 숫자 반응은 올바른 순서로 입력하면 인정됩니다.')});
    entries.push({id:`psycho:${id}`,name:t(`Cyber Psycho · ${name}`,`사이버 사이코 · ${name}`),description:t('Reach 1,000 points in Endless on this difficulty.','해당 난이도 무한 모드에서 1,000점을 달성하세요.')});
  }
  entries.push({id:'first-meeting',name:t('First Encounter','첫만남'),description:t('Defeat the boss at 100 points in Endless.','무한 모드에서 100점 보스를 처음 처치하세요.')});
  entries.push({id:'rush-20',name:t('Boss Conqueror','보스 공략'),description:t('Defeat 20 bosses in one Boss Rush run.','한 번의 보스 러쉬에서 보스 20회를 처치하세요.')});
  return entries;
}
let achievementUntil=0,achievementToastTimer=null;
function awardAchievement(id){
  if(achievements[id]===true)return;
  achievements[id]=true;storeCollection('neon-parry-achievements',achievements);
  const entry=achievementDefinitions().find(e=>e.id===id);if(!entry)return;
  $('achievement-toast').textContent=t('Achievement / ','도전과제 / ')+entry.name;$('achievement-toast').hidden=false;achievementUntil=fxClock+4500;
  clearTimeout(achievementToastTimer);achievementToastTimer=setTimeout(()=>{$('achievement-toast').hidden=true;},4500);achievementToastTimer?.unref?.();
}
function checkScoreAchievements(){
  if(activeRun?.mode==='endless'&&score>=1000)awardAchievement(`psycho:${activeRun.difficulty}`);
  if(isRush()&&score>=20)awardAchievement('rush-20');
}
function checkStageAchievements(){
  if(activeRun?.mode!=='stage'||activeRun.stage!==5||!activeRun.bossDefeated)return;
  const difficulty=activeRun.difficulty;awardAchievement(`clear:${difficulty}`);
  if(activeRun.stats?.skillsUsed===0)awardAchievement(`arrows:${difficulty}`);
  if(activeRun.stats?.nonPerfectKills===0)awardAchievement(`perfect:${difficulty}`);
}
function renderAchievements(){
  const entries=achievementDefinitions(),count=entries.filter(e=>achievements[e.id]===true).length;
  $('achievement-count').textContent=t(`${count} / ${entries.length} unlocked · titles only`,`${count} / ${entries.length} 달성 · 보상 없는 성취 기록`);
  $('achievement-list').replaceChildren();
  for(const entry of entries){
    const card=document.createElement('article');card.className='achievement-card';const unlocked=achievements[entry.id]===true;
    const title=document.createElement('h3');title.textContent=(unlocked?'✓ ':'— ')+entry.name;
    const description=document.createElement('p');description.textContent=entry.description;card.dataset.unlocked=String(unlocked);card.append(title,description);$('achievement-list').append(card);
  }
}

let guideTab='controls';
const ENEMY_GUIDE={
  virus:{name:['Virus','바이러스'],copy:['Diamond-shaped basic threat. Hit: 14 points. Parry at the timing ring; perfect heals 4.','마름모 기본 적. 피격 14%p. 판정선에서 패링하며 정밀 패링은 4%p 회복합니다.']},
  ddos:{name:['DDoS','DDoS'],copy:['Circular threat with the same speed as Virus. Hit: 24 points.','원형 적. 바이러스와 속도는 같지만 피격 시 24%p 피해를 줍니다.']},
  trojan:{name:['Trojan','트로이'],copy:['Hidden on a host until it escapes. Parry the host and it hops to another lane: parry again or take 34 damage. A missed host instead triggers an 8-point follow-up.','숙주 안에 숨어 있어 처음에는 구분할 수 없습니다. 숙주를 패링하면 다른 라인으로 탈출하며 다시 막지 못하면 34%p 피해. 숙주를 놓치면 8%p 추가 침투를 합니다.']},
  worm:{name:['Computer Worm','컴퓨터 웜'],copy:['Waits mid-lane with a counter. Eliminations in its lane lower the counter; at zero it accelerates toward the core. Hit: 30. Perfect: heal 20.','라인 중간에서 카운트와 함께 대기합니다. 같은 라인 처치로 카운트가 줄고 0이면 돌진합니다. 피격 30%p, 정밀 패링 시 20%p 회복.']},
  ransom:{name:['Ransomware','랜섬웨어'],copy:['Fast lock-shaped threat. Hit: 8 and a 1.2s lane lock. Decoy absorption prevents the lock and heals 10.','빠른 자물쇠 모양 적. 피격 8%p와 해당 라인 1.2초 잠금. 미끼폴더로 흡수하면 잠금을 막고 10%p 회복합니다.']},
  phishing:{name:['Phishing','피싱'],copy:['The visible shape is a decoy. Near the parry window, a faint real target and link appear opposite. Parry the real target. Miss: 40. Proxy can clear either side.','처음 보이는 것은 미끼입니다. 방어 범위에서 반대편에 희미한 본체와 연결선이 나타납니다. 본체를 패링하세요. 실패 40%p. 프록시는 어느 쪽 라인에서도 제거합니다.']}
};
const BOSS_GUIDE={
  domain:['Hit the fake, then follow 1–3 across the other three lanes. Final round: 1–9 with three numbers per lane. Wrong order adds 4 but preserves progress. Five cycles; each heals 5. Easy deadlines: 2.4 / 2.2 / 2.0 / 1.8 / 6.0 seconds. Timeout: 20 × attempts remaining.','가짜를 패링하고 나머지 세 라인의 1→3을 순서대로 누릅니다. 마지막은 라인당 3개씩 배정된 1→9. 오입력 +4%p이며 진행 유지. 총 5회, 성공마다 5%p 회복. 쉬움 제한시간 2.4/2.2/2.0/1.8/6.0초. 시간 초과 피해는 남은 시도횟수×20%p.'],
  destroy:['Watch pink lane-end lights preview spawn order, then parry 1 → 2 → 4 fragments. Four successful cycles. Each heals 20. Miss: 27.5 × attempts remaining × 0.5^split depth; retry that cycle.','분홍색 라인 끝 빛으로 순서를 예고한 뒤 1→2→4 분열체를 패링합니다. 총 4회 성공해야 처치하며 성공마다 20%p 회복. 실패 피해는 27.5×남은 시도횟수×0.5^분열 단계이며 해당 사이클을 재시도합니다.']
};
function guideIcon(category,id,locked){
  const icon=svg('svg',{viewBox:category==='skill'?'0 0 32 32':'-40 -40 80 80','aria-hidden':'true'}),color=locked?'#070a08':category==='enemy'?TYPES[id].color:category==='boss'?BOSS_TYPES[id].color:'#b7eaaa';
  if(category==='skill'){
    const path={vaccine:'M16 3L27 8V17L16 29L5 17V8Z M16 10V22 M10 16H22',proxy:'M3 7H21L29 16L21 25H3V7Z M9 11H19V21H9Z',decoy:'M3 8H12L16 12H29V27H3Z M8 18H24'}[id];icon.append(svg('path',{d:path,fill:'none',stroke:color,'stroke-width':1.3}));
  }else{
    icon.append(svg('path',{d:category==='enemy'?shapePath(id):'M-17 -9L0 -19L17 -9V9L0 19L-17 9Z',fill:locked?color:'#202820',stroke:color,'stroke-width':1.5,transform:'scale(1.6)'}));
    if(!locked&&category==='boss'){const text=svg('text',{y:5,'text-anchor':'middle',fill:color,'font-size':17});text.textContent=id==='domain'?'//':'½';icon.append(text);}
    if(!locked&&id==='worm'){const text=svg('text',{y:-20,'text-anchor':'middle',fill:color,'font-size':14});text.textContent='2';icon.append(text);}
  }
  if(locked){const text=svg('text',{y:7,'text-anchor':'middle',fill:'#8c978d','font-size':22});text.textContent='?';icon.append(text);}
  return icon;
}
function guideCard(category,id,name,copy,condition){
  const locked=category!=='skill'&&discoveries[`${category}:${id}`]!==true;
  const card=document.createElement('article');card.className='guide-card';card.dataset.locked=String(locked);
  const art=document.createElement('div');art.className='guide-art';art.append(guideIcon(category,id,locked));
  const text=document.createElement('div'),title=document.createElement('h3'),description=document.createElement('p');
  title.textContent=locked?'?':name;description.textContent=locked?t('Locked · encounter this threat in a run. ','잠김 · 게임에서 직접 발견하세요. ')+condition:copy;
  text.append(title,description);card.append(art,text);return card;
}
const DUEL_UPGRADE_COPY = {
  mutation: [
    ['Extra virus', '추가 바이러스'],
    ['When you attack, you have a chance to send one extra enemy of a random type.', '공격할 때 확률에 따라 다른 종류의 바이러스를 하나 더 보냅니다.']
  ],
  attack_speed: [
    ['Shot speed', '공격 속도'],
    ['New shots reach the opponent sooner.', '새로 쏘는 바이러스가 상대에게 더 빨리 도착합니다.']
  ],
  recharge: [
    ['Recharge', '충전 속도'],
    ['Attack energy refills faster over time.', '공격 에너지가 자동으로 차는 속도가 빨라집니다.']
  ],
  repair: [
    ['Repair', '코어 수리'],
    ['Lowers your vulnerability immediately. You can pick it again later.', '고르는 즉시 취약률이 내려갑니다. 나중에 다시 골라 회복할 수 있습니다.']
  ],
  perfect_energy: [
    ['Perfect energy', '패링 충전'],
    ['Increases the usual half bar of energy from a perfect parry.', '정밀 패링으로 받는 기본 에너지(0.5칸)가 늘어납니다.']
  ],
  attack_power: [
    ['Attack damage', '공격 피해'],
    ['Your shots deal more damage when they hit.', '내 공격이 맞았을 때 상대가 받는 피해가 늘어납니다.']
  ],
  guard_energy: [
    ['Guard charge', '방어 충전'],
    ['Every successful parry adds energy. +10% grants 0.10 extra energy, on top of any perfect parry bonus.', '패링에 성공할 때마다 에너지를 더 얻습니다. +10%면 0.1칸이 차고, 정밀 패링 보너스와 함께 적용됩니다.']
  ],
  perfect_repair: [
    ['Parry repair', '패링 수리'],
    ['A perfect parry has a chance to lower your vulnerability by 4 percentage points.', '정밀 패링에 성공하면 확률에 따라 취약률이 4%p 내려갑니다.']
  ],
  attack_discount: [
    ['Attack efficiency', '공격 효율'],
    ['Shots cost less energy. At +100%, a shot costs half a bar.', '공격에 드는 에너지가 줄어듭니다. +100%면 한 번 쏠 때 반 칸을 씁니다.']
  ],
  damage_resistance: [
    ['Core armor', '코어 장갑'],
    ['Reduces damage from opposing shots. At +100%, incoming damage is about half.', '상대 공격에 맞았을 때 받는 피해가 줄어듭니다. +100%면 피해가 절반 정도로 줄어듭니다.']
  ],
  miss_resistance: [
    ['Empty guard damage', '헛방어 피해'],
    ['Reduces the duel’s usual 4-point penalty for parrying an empty lane. At −100%, the penalty is zero.', '헛방어로 오르는 취약률(기본 4%p)이 줄어듭니다. −100%면 헛방어 피해가 0이 됩니다.']
  ]
};

function duelUpgradeText({ kind, value }) {
  const name = t(...(DUEL_UPGRADE_COPY[kind]?.[0] ?? ['Upgrade', '업그레이드']));
  const sign = kind === 'repair' || kind === 'miss_resistance' ? '−' : '+';
  const unit = ['repair', 'mutation', 'perfect_repair'].includes(kind) ? '%p' : '%';
  return [name, sign + value + unit];
}

function renderDuelGuide(panel) {
  const { RULES, UPGRADE_CATALOG } = window.NeonDuelEngine;
  const title = document.createElement('h3');
  const timing = document.createElement('p');
  const limits = document.createElement('p');
  const list = document.createElement('dl');
  const first = RULES.firstUpgradeMs / 1000;
  const next = RULES.upgradeIntervalMs / 1000;
  const virusCap = UPGRADE_CATALOG.mutation.cap;
  title.textContent = t('Duel upgrades', '듀얼 능력');
  timing.textContent = t(
    `Your first choices appear after ${first} seconds. Pick one with 1–3 or tap a card. New choices appear ${next} seconds after each pick. Each player gets their own choices, and picks pause during boss rounds.`,
    `첫 능력은 대전 ${first}초 뒤에 나옵니다. 1~3번 키나 터치로 하나를 고르면 ${next}초 뒤에 다음 선택지가 나옵니다. 선택지는 각자 다르게 뽑히고, 보스전 중에는 선택이 멈춥니다.`
  );
  limits.textContent = t(
    `Extra virus chance stacks up to ${virusCap}%. Other lasting upgrades stack up to ${RULES.upgradeCap}%. Maxed upgrades stop appearing.`,
    `추가 바이러스 확률은 최대 ${virusCap}%, 나머지 누적 능력은 최대 ${RULES.upgradeCap}%까지 중첩됩니다. 최대치에 닿은 능력은 선택지에서 빠집니다.`
  );
  list.className = 'duel-guide-upgrades';
  for (const [kind, { min, max }] of Object.entries(UPGRADE_CATALOG)) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const amount = document.createElement('span');
    const description = document.createElement('dd');
    const [name, range] = duelUpgradeText({ kind, value: `${min}–${max}` });
    term.textContent = name;
    amount.textContent = range;
    term.append(amount);
    description.textContent = t(...DUEL_UPGRADE_COPY[kind][1]);
    row.append(term, description);
    list.append(row);
  }
  panel.append(title, timing, limits, list);
}

function renderGuide(tab = guideTab){
  if(guideTab!==tab)$('help-dialog').scrollTop=0;
  guideTab=tab;
  const root=$('help-content');root.replaceChildren();
  const tabs=document.createElement('div');tabs.className='guide-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('Guide sections','도움말 분류'));
  const entries=[['controls',t('Controls','기본 조작법')],['enemies',t('Enemies','적 도감')],['bosses',t('Bosses','보스 도감')],['skills',t('Skills','스킬 도감')],['duel',t('Duel','듀얼')]];
  for(const [id,label] of entries){
    const button=document.createElement('button');button.textContent=label;button.id='guide-tab-'+id;button.dataset.guideTab=id;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(guideTab===id));button.setAttribute('tabindex',guideTab===id?'0':'-1');button.setAttribute('aria-controls','guide-panel');
    const activate=()=>{renderGuide(id);$('guide-tab-'+id).focus();};button.addEventListener('click',activate);
    button.addEventListener('keydown',event=>{let index=entries.findIndex(e=>e[0]===guideTab);if(event.key==='ArrowRight')index=(index+1)%entries.length;else if(event.key==='ArrowLeft')index=(index+entries.length-1)%entries.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=entries.length-1;else return;event.preventDefault();renderGuide(entries[index][0]);$('guide-tab-'+guideTab).focus();});tabs.append(button);
  }
  const panel=document.createElement('div');panel.id='guide-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','guide-tab-'+guideTab);panel.setAttribute('tabindex','0');root.append(tabs,panel);
  if(guideTab==='controls'){
    panel.innerHTML=t('<h3>Parry &amp; recover</h3><p>Arrow keys / WASD, or tap the incoming quarter of the arena. Parry when the enemy lights up near the timing ring. A perfect parry heals 4 points. Empty parry: +4. Above 100% vulnerability ends the run.</p><h3>Skills &amp; pause</h3><p>Space / skill button / lane swipe: Vaccine or Decoy. Shift + direction / lane swipe: Proxy; or tap its ready button, then a lane. Escape pauses/resumes. Menus and loss of focus pause play. Swipes start in the lane and follow it toward or away from the core.</p><h3>Modes</h3><p>Endless: bosses every 100 points. Stages: 15 / 30 / 45 / 65 / 100 targets; Stage 5 also requires a boss victory. Boss Rush: bosses only, +1 point per victory and heal equal to the new score. A 5-second rest before each boss gives one use of your selected Vaccine or Decoy. Proxy is unavailable. Speed +1% and damage +1.5% per victory, multiplied by difficulty.</p><h3>Records &amp; discoveries</h3><p>Enemy and boss entries reveal only after an actual encounter. Records and achievements save locally when storage is available; browser/app origins do not share them. Achievements grant no gameplay bonuses. Enemy damage examples are for Easy; difficulty increases damage and narrows timing windows.</p>',
      '<h3>패링·회복</h3><p>방향키/WASD 또는 적이 오는 방향의 구역을 터치하세요. 판정선 근처에서 적이 밝아지면 방어 가능하며 정밀 패링은 4%p 회복합니다. 헛방어 +4%p, 취약률이 100%를 넘으면 종료됩니다.</p><h3>스킬·일시정지</h3><p>백신·미끼폴더: Space/스킬 버튼/라인 스와이프. 프록시: Shift+방향/라인 스와이프 또는 준비된 버튼을 누른 뒤 방향 터치. 스와이프는 해당 라인에서 코어 쪽 또는 바깥쪽으로 합니다. Escape로 정지·재개하며 메뉴 열기·포커스 이탈 시 자동 정지합니다.</p><h3>모드</h3><p>무한: 100점마다 보스. 스테이지: 15/30/45/65/100회 목표이며 5번은 보스 처치까지 필요합니다. 보스 러쉬: 보스만 등장하며 처치당 1점, 처치 후 새 점수만큼 취약률이 회복됩니다. 첫 보스 전과 보스 사이 5초 휴식마다 선택한 백신 또는 미끼폴더를 1회 사용할 수 있습니다. 프록시는 선택 불가. 처치당 속도 +1%, 피해 +1.5%가 난이도 배율에 추가됩니다.</p><h3>기록·발견</h3><p>적·보스 도감은 실제 조우한 항목만 공개됩니다. 기록·도전과제는 저장이 허용되는 현재 브라우저/앱에 보관되며 서로 자동 공유되지 않습니다. 도전과제의 게임상 이점은 없습니다. 피해 예시는 쉬움 기준이며 상위 난이도에서는 피해가 늘고 판정이 좁아집니다.</p>');
  }else if(guideTab==='enemies'){
    for(const [id,entry] of Object.entries(ENEMY_GUIDE))panel.append(guideCard('enemy',id,t(...entry.name),t(...entry.copy),t(`Available from ${TYPES[id].unlock} eliminations.`,`${TYPES[id].unlock}회 제거 이후 등장 가능.`)));
  }else if(guideTab==='bosses'){
    for(const [id,boss] of Object.entries(BOSS_TYPES))panel.append(guideCard('boss',id,boss.name,BOSS_GUIDE[id]?t(...BOSS_GUIDE[id]):boss.hint,t('Appears at 100-point milestones or in Boss Rush.','100점 단위 보스전 또는 보스 러쉬에서 등장.')));
  }else if(guideTab==='duel'){
    renderDuelGuide(panel);
  }else{
    const info={vaccine:['Heal 29 points. Stop 0.3s, then accelerate over 0.9s. No knockback. Cost: 20 eliminations.','취약률 29%p 회복. 0.3초 정지 후 0.9초 재가속, 넉백 없음. 충전 20회.'],proxy:['Clear one lane, including dormant worms and either side of Phishing; block spawns for 6s. No charge from Proxy kills. Cost: 16. Unavailable in Boss Rush.','한 라인 정리·6초 생성 차단. 대기 웜과 피싱 양쪽 라인 지원. 프록시 처치는 충전하지 않습니다. 충전 16회, 보스 러쉬 선택 불가.'],decoy:['50-point shield. No damage spillover on breaking. Reuse resets to 50, never stacks. Ransomware absorption heals 10 and prevents lane lock. Cost: 24.','50포인트 보호막. 파괴 공격의 초과 피해 차단. 재사용 시 50으로 초기화하며 중첩 없음. 랜섬웨어 흡수 시 10%p 회복·잠금 방지. 충전 24회.']};
    for(const [id,skill] of Object.entries(SKILLS))panel.append(guideCard('skill',id,skill.name,t(...info[id]),''));
    const note=document.createElement('p');note.textContent=t('All skills are locked during boss combat. Boss Rush grants one use during each rest; entry cancels slow/barriers but preserves Decoy.','보스 전투 중 모든 스킬 잠금. 보스 러쉬는 휴식마다 1회 사용 가능하며 보스 진입 시 둔화·장벽 해제, 미끼폴더는 유지됩니다.');panel.append(note);
  }
}
renderGuide();

// Legacy records prove ordinary clear/score titles, but cannot prove skill/perfect runs.
for(const difficulty of Object.keys(RUN_DIFFICULTIES)){
  if(stageRecords[`${difficulty}:5`]?.cleared===true)achievements[`clear:${difficulty}`]=true;
  if(Number(endlessRecords[difficulty])>=1000)achievements[`psycho:${difficulty}`]=true;
}
storeCollection('neon-parry-achievements',achievements);
