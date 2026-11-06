'use strict';

let menuScreen = 'home';

const MENU_SKILLS = {
  vaccine: {
    name: ['Vaccine', '백신'],
    description: ['Recover 29 vulnerability points and stop the field for 0.3s, then accelerate over 0.9s.', '취약률을 29 회복하고 필드를 0.3초 정지한 뒤 0.9초간 재가속합니다.'],
    control: ['Space / ability button / lane swipe', 'Space / 능력 버튼 / 라인 스와이프']
  },
  proxy: {
    name: ['Proxy', '프록시'],
    description: ['Clear one lane and block new enemies there for 6 seconds, including dormant worms and either side of phishing.', '한 방향의 적을 지우고 6초 동안 새 적을 막습니다. 대기 웜·양쪽 피싱도 제거합니다.'],
    control: ['Shift + direction / ability button, then direction / lane swipe', 'Shift + 방향 / 능력 버튼 누른 뒤 방향 / 라인 스와이프']
  },
  decoy: {
    name: ['Decoy', '미끼폴더'],
    description: ['Create a shield that absorbs 50 damage.', '피해를 50까지 막는 보호막을 만듭니다.'],
    control: ['Space / ability button / lane swipe', 'Space / 능력 버튼 / 라인 스와이프']
  }
};

function menuText(pair) { return pair[language === 'ko' ? 1 : 0]; }
function menuDifficultyName(id) { return difficultyName(id); }
function menuModeName(value) { return value==='rush'?t('Boss rush','보스 러쉬'):value === 'stage' ? t('Stages', '스테이지 모드') : t('Endless', '무한 모드'); }
function menuStageGoal(stage) {
  const count = stageTarget(stage);
  return stage === 5
    ? t(`${count} eliminations + boss`, `${count}회 방어 + 보스`)
    : t(`${count} eliminations`, `${count}회 방어`);
}

function refreshMenu() {
  refreshPatchNotes();renderAchievements();
  const selection = runSelection;$('menu-board').dataset.mode=selection.mode;
  const titles = {
    home: 'NEON PARRY',
    mode: t('Mode', '모드'),
    difficulty: t('Difficulty', '난이도'),
    stage: t('Stage', '스테이지'),
    ability: t('Ability', '능력'),
    achievements:t('Achievements','도전과제'),
    settings: t('Settings', '설정')
  };
  for (const panel of document.querySelectorAll('[data-menu-screen]')) {
    panel.hidden = panel.dataset.menuScreen !== menuScreen;
  }
  $('menu-board').dataset.screen = menuScreen;
  $('menu-title').textContent = titles[menuScreen];
  $('menu-back').hidden = menuScreen === 'home';
  $('menu-back').textContent = t('← Back', '← 뒤로');
  $('menu-play').textContent = 'Play';
  $('help-open').textContent = 'Help';
  $('menu-settings').textContent = t('Settings','설정');$('achievements-open').textContent=t('Achievements','도전과제');
  $('menu-open').textContent = t('Menu', '메뉴');
  $('settings-language-label').textContent = t('Language', '언어');
  $('settings-sound-label').textContent = t('Sound', '소리');
  $('settings-display-label').textContent = t('Display', '화면');

  const context = $('menu-context');
  context.hidden = menuScreen !== 'stage' && menuScreen !== 'ability';
  context.textContent = context.hidden ? '' : `${menuModeName(selection.mode)} · ${menuDifficultyName(selection.difficulty)}${menuScreen === 'ability' && selection.mode === 'stage' ? ` · ${t('Stage', '스테이지')} ${selection.stage}` : ''}`;

  for (const button of document.querySelectorAll('[data-menu-mode]')) {
    const id = button.dataset.menuMode;
    button.querySelector('strong').textContent = menuModeName(id);
    button.setAttribute('aria-pressed', String(id === selection.mode));
  }
  for (const button of document.querySelectorAll('[data-menu-difficulty]')) {
    const id = button.dataset.menuDifficulty;
    button.querySelector('strong').textContent = menuDifficultyName(id);
    button.setAttribute('aria-pressed', String(id === selection.difficulty));
  }
  const clearedCount = [1, 2, 3, 4, 5].filter(stage => stageRecords[`${selection.difficulty}:${stage}`]?.cleared).length;
  if ($('stage-count')) $('stage-count').textContent = t(`${clearedCount} / 5 cleared`, `${clearedCount} / 5 클리어`);
  for (const button of document.querySelectorAll('[data-menu-stage]')) {
    const stage = Number(button.dataset.menuStage);
    const cleared = !!stageRecords[`${selection.difficulty}:${stage}`]?.cleared;
    button.setAttribute('aria-pressed', String(stage === selection.stage));
    button.classList.toggle('is-cleared', cleared);
    button.querySelector('.stage-state').textContent = cleared ? '✓' : stage === 5 ? t('Boss', '보스') : t(String(stageTarget(stage)), `${stageTarget(stage)}회`);
    button.setAttribute('aria-label', `${t('Stage', '스테이지')} ${stage} · ${menuStageGoal(stage)}${cleared ? t(' · cleared', ' · 클리어') : ''}`);
  }

  const draftSkill = selection.skill || selectedSkill;
  for (const button of document.querySelectorAll('[data-menu-skill]')) {
    const id = button.dataset.menuSkill;
    button.hidden=selection.mode==='rush'&&id==='proxy';
    button.setAttribute('aria-pressed', String(id === draftSkill));
    button.querySelector('.ability-name').textContent = menuText(MENU_SKILLS[id].name);
  }
  $('ability-description').textContent = menuText(MENU_SKILLS[draftSkill].description);
  $('ability-cost').textContent = selection.mode==='rush'?t('One use per 5-second rest; no skills during combat.','5초 휴식마다 1회 사용 · 전투 중 사용 불가'):t(`Charge: ${SKILLS[draftSkill].cost} eliminations`, `${SKILLS[draftSkill].cost}회 처치 시 충전`);
  $('ability-control').textContent = menuText(MENU_SKILLS[draftSkill].control);

  const recordNode = $('menu-record');
  if (recordNode) {
    let record = '';
    if (selection.mode === 'stage') {
      const best = stageRecords[`${selection.difficulty}:${selection.stage}`];
      if (best?.cleared) record = t(`Cleared · best ${best.bestVulnerability}% vulnerability`, `클리어 · 최저 취약률 ${best.bestVulnerability}%`);
      else if (best?.bestScore > 0) record = t(`Best: ${best.bestScore} eliminations`, `최고 기록: ${best.bestScore}회 방어`);
    } else if(selection.mode==='rush'&&rushRecords[selection.difficulty]>0){record=t(`Best: ${rushRecords[selection.difficulty]} bosses`, `최고 기록: 보스 ${rushRecords[selection.difficulty]}회`);
    } else if (selection.mode!=='rush'&&endlessRecords[selection.difficulty] > 0) {
      record = t(`Best: ${endlessRecords[selection.difficulty]} eliminations`, `최고 기록: ${endlessRecords[selection.difficulty]}회 방어`);
    }
    recordNode.textContent = record;
    recordNode.hidden = !record || (menuScreen !== 'stage' && menuScreen !== 'ability');
  }

  const paused = mode === 'paused' && !!activeRun;
  $('menu-resume-panel').hidden = !paused || menuScreen !== 'home';
  $('menu-resume').textContent = t('Resume', '이어하기');
  $('menu-resume-copy').textContent = paused
    ? `${menuModeName(activeRun.mode)} · ${menuDifficultyName(activeRun.difficulty)}${activeRun.mode === 'stage' ? ` · ${t('Stage', '스테이지')} ${activeRun.stage}` : ''} · ${t(`${score} eliminations`, `${score}회 방어`)}`
    : '';
  $('menu-start').textContent = paused ? t('New game', '새 게임') : t('Start', '시작');
  $('menu-start-note').hidden = !paused;
  $('menu-start-note').textContent = paused ? t('Replaces the paused game.', '진행 중인 게임이 초기화됩니다.') : '';
}

function setMenuScreen(name) {
  if (!['home', 'mode', 'difficulty', 'stage', 'ability', 'settings','achievements'].includes(name)) return;
  menuScreen = name;
  refreshMenu();
  $('menu-title').setAttribute('tabindex', '-1');
  $('menu-title').focus({preventScroll: true});
  window.scrollTo?.(0, 0);
}

function menuBack() {
  const previous = {
    mode: 'home',
    difficulty: 'mode',
    stage: 'difficulty',
    ability: runSelection.mode === 'stage' ? 'stage' : 'difficulty',
    achievements:'home',
    settings: 'home'
  };
  if (previous[menuScreen]) setMenuScreen(previous[menuScreen]);
}

function showGameView() {
  $('main-menu').hidden = true;
  $('game-view').hidden = false;
  $('menu-open').hidden = false;
  window.scrollTo?.(0, 0);
  requestAnimationFrame(fitConsole);
}

function showMenuView() {
  $('game-view').hidden = true;
  $('main-menu').hidden = false;
  $('menu-open').hidden = true;
  setMenuScreen('home');
}

$('menu-play').addEventListener('click', () => setMenuScreen('mode'));
$('achievements-open').addEventListener('click',()=>setMenuScreen('achievements'));
$('menu-settings').addEventListener('click', () => setMenuScreen('settings'));
$('menu-back').addEventListener('click', menuBack);
for (const button of document.querySelectorAll('[data-menu-mode]')) {
  button.addEventListener('click', () => {
    runSelection.mode = button.dataset.menuMode;
    if(runSelection.mode==='rush'&&runSelection.skill==='proxy')runSelection.skill='vaccine';
    setMenuScreen('difficulty');
  });
}
for (const button of document.querySelectorAll('[data-menu-difficulty]')) {
  button.addEventListener('click', () => {
    runSelection.difficulty = button.dataset.menuDifficulty;
    setMenuScreen(runSelection.mode === 'stage' ? 'stage' : 'ability');
  });
}
for (const button of document.querySelectorAll('[data-menu-stage]')) {
  button.addEventListener('click', () => {
    runSelection.stage = Number(button.dataset.menuStage);
    setMenuScreen('ability');
  });
}
for (const button of document.querySelectorAll('[data-menu-skill]')) {
  button.addEventListener('click', () => {
    runSelection.skill = button.dataset.menuSkill;
    if (mode !== 'running' && mode !== 'paused') selectSkill(runSelection.skill);
    refreshMenu();
  });
}
$('menu-open').addEventListener('click', returnToMenu);
$('menu-start').addEventListener('click', launchRun);
$('menu-resume').addEventListener('click', continueRun);
document.addEventListener('keydown', event => {
  if ($('main-menu').hidden || ($('help-dialog').open||$('patch-dialog').open) || event.code !== 'Escape' || event.repeat) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable]')) return;
  if (document.fullscreenElement || $('game-shell').classList.contains('expanded')) {
    event.preventDefault();
    leaveFullscreen();
    return;
  }
  if (menuScreen !== 'home') {
    event.preventDefault();
    menuBack();
  }
});
showMenuView();

function refreshPatchNotes(){
  $('patch-open').textContent=t('Patch notes · 1.5.2','패치노트 · 1.5.2');$('patch-title').textContent=$('patch-open').textContent;$('patch-close').textContent=t('Close ×','닫기 ×');
  $('patch-content').innerHTML=t(
    '<h3>1.5.2 · Duel guide</h3><p>Open Help → Duel for all 11 upgrades, their effects, and roll ranges.</p><h3>1.5.1 · Duel upgrades</h3><p>Extra virus chance caps at 50%. Added attack efficiency, core armor, and lower empty-guard damage.</p><h3>1.5.0 · Duel bosses</h3><p>Every minute of combat, fight the same boss on your own arena. Wait for the others before the duel resumes. Upgrade choices roll separately and stack up to 100%.</p><h3>1.3.1 · Original view &amp; matchmaking</h3><p>Duel now uses the original arena, fighter, Virus and effects directly, with the original Easy timing. Added random matchmaking on the same server.</p><h3>1.3.0 · Duel</h3><p>Four-direction attacks and parries, CPU practice and friend rooms. No time limit or healing. Consecutive hits deal 15 → 20 → 25; a guard resets pressure. Perfect parries grant half an energy. Online results are decided by the server.</p><h3>1.2.0 · Separate services</h3><p>The frontend and backend now deploy independently. Existing modes still work offline; online battle rules and combat synchronization are not enabled yet.</p><h3>1.1.0 · Rush, achievements &amp; guide</h3><ul><li>Boss Rush: all registered bosses in shuffled cycles, +1 point per victory, heal equal to the new score. Speed +1% and damage +1.5% per victory. Five-second rests grant one Vaccine or Decoy use. No Proxy or regular enemies. An escaped boss grants no point and is retried after rest.</li><li>18 local achievements: difficulty clears, skill-free Stage 5 clears, perfect-only Stage 5 clears, Endless first boss / 1,000 points, and 20 Boss Rush wins. No gameplay bonuses.</li><li>Guide tabs: Controls, Enemies, Bosses, Skills, with matching silhouettes/icons. Unseen enemies/bosses stay hidden behind ? until encountered; unlock hints are shown. Discoveries persist locally.</li></ul><h3>1.0.2 · Light previews &amp; field stop</h3><ul><li>Dis-Troy: neon-pink gradient lights flash from the lane ends toward the center and fade out in spawn order before fragments appear.</li><li>Vaccine: 0.3s full field stop, then 0.9s acceleration back to normal (1.2s total). Healing remains 29 points; boss entry cancels the effect.</li></ul><h3>1.0.1 · Retained balance</h3><ul><li>Vaccine: 29-point heal, no knockback.</li><li>Proxy: 6s barrier. Clears dormant worms and phishing through either its decoy or real-target lane.</li><li>All skills locked throughout boss encounters, including entry cleanup. Entry clears Vaccine slow and Proxy barriers; existing Decoy shields remain.</li></ul><h3>Bosses</h3><ul><li>Fake Domain: numbered targets in all three other lanes. Follow 1–3; final round 1–9 with three numbers per lane. Wrong inputs add 4 points but preserve progress. Round success heals 5 points. Easy deadlines: 2.4 / 2.2 / 2.0 / 1.8 / 6.0 seconds; higher difficulties shorten these.</li><li>Dis-Troy: lanes preview split spawn order before fragments appear. Miss damage +10% (base 27.5 × remaining attempts × 0.5^depth); successful round healing 25 → 20 points.</li></ul><h3>Retry</h3><p>Choose any skill directly on the game-over or stage-clear screen, then Retry. Mode, stage and difficulty remain unchanged. The selected skill also carries to Next stage.</p>',
    '<h3>1.5.2 · 듀얼 능력 도움말</h3><p>Help → 듀얼에서 능력 11종의 효과와 수치를 볼 수 있습니다.</p><h3>1.5.1 · 듀얼 능력</h3><p>추가 바이러스 확률 상한을 50%로 낮췄습니다. 공격 효율, 코어 장갑, 헛방어 피해 감소를 추가했습니다.</p><h3>1.5.0 · 듀얼 보스전</h3><p>대전 1분마다 같은 보스가 각자 경기장에 나옵니다. 모두 끝나면 대전을 재개합니다. 능력은 각자 무작위로 나오고 100%까지 중첩됩니다.</p><h3>1.3.1 · 원본 화면·랜덤 매칭</h3><p>듀얼이 원본 경기장·캐릭터·바이러스·효과를 직접 사용하도록 수정했습니다. 원본 쉬움의 이동속도·패링 판정을 사용합니다. 같은 서버의 플레이어를 연결하는 랜덤 매칭을 추가했습니다.</p><h3>1.3.0 · 듀얼</h3><p>네 방향 공격·패링, CPU 연습과 친구방 대전을 추가했습니다. 제한시간·회복 없이 취약률 100%가 되면 패배합니다. 연속 적중 피해는 15 → 20 → 25%p, 방어 성공 시 초기화됩니다. 정밀 패링은 에너지 반 칸을 얻습니다. 온라인 판정과 승패는 서버가 결정합니다.</p><h3>1.2.0 · 프론트엔드·백엔드 분리</h3><p>화면과 서버를 독립 배포할 수 있게 분리했습니다. 기존 모드는 오프라인으로 유지되며, 온라인 전투 규칙과 실시간 전투 동기화는 아직 제공하지 않습니다.</p><h3>1.1.0 · 보스 러쉬·도전과제·도감</h3><ul><li>보스 러쉬: 등록된 모든 보스를 섞은 순환으로 진행, 처치당 1점·새 점수만큼 회복. 처치당 속도 +1%, 피해 +1.5%. 5초 휴식마다 백신·미끼폴더 1회 사용. 프록시·일반 적 없음. 도주 시 무득점이며 휴식 후 같은 보스 재도전.</li><li>도전과제 18개: 난이도 클리어, 스킬 없이 스테이지 5 클리어, 정밀 패링만으로 스테이지 5 클리어, 무한 첫 보스·1,000점, 보스 러쉬 20회. 게임상 이점 없음.</li><li>기본 조작법·적 도감·보스 도감·스킬 도감 탭과 생김새 표시. 미발견 적·보스는 검은 실루엣과 ?로 숨기고 조건 안내. 발견 기록은 로컬 저장.</li></ul><h3>1.0.2 · 빛 예고·필드 정지</h3><ul><li>디스-트로이: 라인 끝에서 중심 쪽으로 옅어지는 네온핑크 그라데이션 빛이 생성 순서대로 번쩍인 뒤 페이드아웃됩니다.</li><li>백신: 필드 전체가 0.3초 정지한 뒤 0.9초간 정상 속도로 재가속합니다(총 1.2초). 회복 29%p 유지, 보스 진입 시 효과 해제.</li></ul><h3>1.0.1 · 유지된 밸런스</h3><ul><li>백신: 회복 24→29%p, 넉백 삭제.</li><li>프록시: 장벽 5→6초. 대기 웜 및 피싱의 미끼·본체 어느 쪽 라인에서도 제거할 수 있습니다.</li><li>보스 진입 정리부터 종료까지 모든 스킬 잠금. 진입 시 백신 둔화·프록시 장벽 제거, 미끼폴더 보호막 유지.</li></ul><h3>보스</h3><ul><li>페이크 도메인: 나머지 세 라인의 숫자 1→3 순서로 패링. 마지막은 라인당 3개씩 배정된 숫자 1→9. 오입력은 취약률 +4%p이며 진행 유지, 성공마다 −5%p. 쉬움 제한시간은 2.4 / 2.2 / 2.0 / 1.8 / 6.0초이며 상위 난이도에서는 짧아집니다.</li><li>디스-트로이: 분열 생성 전에 라인이 생성 순서대로 빛납니다. 실패 피해 +10%(기본 27.5×남은 시도횟수×0.5^단계), 패턴 성공 회복 25→20%p.</li></ul><h3>재도전</h3><p>게임 종료·스테이지 클리어 화면에서 스킬을 바로 고르고 재도전하세요. 모드·난이도·스테이지는 유지됩니다. 다음 스테이지에도 선택한 스킬이 적용됩니다.</p>');
}
$('patch-open').addEventListener('click',()=>{pauseGame();pointers.clear();refreshPatchNotes();$('patch-dialog').showModal();});
$('patch-close').addEventListener('click',()=>$('patch-dialog').close());
