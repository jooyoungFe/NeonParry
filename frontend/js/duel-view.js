'use strict';

// A temporary owner of the original game's view. Duel never copies the arena,
// fighter, enemy art or effects: these are the same actors used by single play.
(() => {
  const layerIds = ['enemies', 'effects', 'foreground-fx', 'phishing-links', 'boss-entities', 'lane-states'];
  const textIds = ['overlay-symbol', 'overlay-title', 'overlay-copy', 'skill-name', 'skill-key', 'skill-status', 'action', 'run-label', 'score-label', 'score', 'best', 'vulnerability-value', 'message', 'share-status'];
  const stateIds = ['overlay', 'skill-choices', 'skill', 'skill-meter', 'skill-fill', 'share', 'next-stage', 'stage-progress', 'boss-hud', 'boss-banner', 'reaction-meter', 'vulnerability', 'vulnerability-fill', 'state-light', 'arena', 'decoy-panel', 'decoy-folder', 'folder-capacity', 'camera', 'world', 'core', 'game-view', 'main-menu', 'menu-open', 'game-shell', 'guard-band', 'guard-outer', 'guard-inner', 'guard-pose'];
  const arrow = { up: '↑', right: '→', down: '↓', left: '←' };
  let saved = null, actors = new Map(), lastEventId = 0, guards = 0, roundStart = null, stance = 'guard';
  const tr = (en, ko) => t(en, ko);
  const children = node => Array.from(node.childNodes || node.children);
  function attributes(node) {
    return typeof node.attributes[Symbol.iterator] === 'function'
      ? Array.from(node.attributes, attribute => [attribute.name, attribute.value])
      : Object.entries(node.attributes);
  }
  function captureNode(node, content = false) {
    const style = typeof node.style.cssText === 'string' ? node.style.cssText : Object.assign({}, node.style);
    return { node, attrs: attributes(node), hidden: node.hidden, disabled: node.disabled, style,
      content: content ? { nodes: children(node), text: node.textContent } : null };
  }
  function restoreNode(entry) {
    const { node } = entry;
    for (const [name] of attributes(node)) node.removeAttribute(name);
    for (const [name, value] of entry.attrs) node.setAttribute(name, value);
    node.hidden = entry.hidden;
    if (typeof entry.disabled === 'boolean') node.disabled = entry.disabled;
    if (typeof entry.style === 'string') node.style.cssText = entry.style;
    else {
      for (const key of Object.keys(node.style)) if (typeof node.style[key] !== 'function') delete node.style[key];
      Object.assign(node.style, entry.style);
    }
    if (entry.content) {
      if (entry.content.nodes.length) node.replaceChildren(...entry.content.nodes);
      else node.textContent = entry.content.text;
    }
  }
  function bestLabel() { return $('best').parentNode.querySelector('small'); }

  function mount() {
    if (saved) return;
    pauseGame();
    const nodes = [...new Set([...stateIds, ...textIds].map(id => $(id)).filter(Boolean))];
    nodes.push(...$('fighter').querySelectorAll('*'), $('fighter'), ...document.querySelectorAll('[data-unlock]'), ...document.querySelectorAll('[data-dir]'), document.querySelector('.legend'), bestLabel());
    saved = {
      globals: { mode, score, vulnerability, enemies, effects, clock, fxClock, bossFight, nextBossAt, cameraZoom, lastFrame, frame, nextSpawn, lastInput, messageUntil, coreFlashUntil, recoveryUntil, previousDirection, poseUntil, flashUntil, damagedUntil, shake, charge, proxyArmed, decoyCapacity, arrivalSlots, nextWorm, lockedUntil, proxyUntil, pointers, vaccineSlowAt, GUARD_WINDOW, PERFECT_WINDOW, COOLDOWN },
      nodes: nodes.filter(Boolean).map(node => captureNode(node, textIds.includes(node.id) || node === bestLabel())),
      layers: layerIds.map(id => ({ node: $(id), children: children($(id)) }))
    };
    cancelAnimationFrame(frame); silenceSound();
    for (const layer of saved.layers) layer.node.replaceChildren();
    mode = 'duel'; score = 0; vulnerability = 0; clock = 0; fxClock = 0;
    enemies = []; effects = []; bossFight = null; cameraZoom = 1; lastFrame = null; frame = 0;
    nextSpawn = Infinity; lastInput = {}; messageUntil = 0; coreFlashUntil = 0; recoveryUntil = 0;
    previousDirection = null; poseUntil = 0; flashUntil = 0; damagedUntil = 0;
    shake = { at: 0, until: 0, power: 0 }; charge = 0; proxyArmed = false; decoyCapacity = 0;
    arrivalSlots = []; nextWorm = Infinity; lockedUntil = {}; proxyUntil = {}; pointers = new Map(); vaccineSlowAt = -Infinity;
    GUARD_WINDOW = RUN_DIFFICULTIES.easy.guard; PERFECT_WINDOW = RUN_DIFFICULTIES.easy.perfect; COOLDOWN = RUN_DIFFICULTIES.easy.cooldown;
    actors = new Map(); lastEventId = 0; guards = 0; roundStart = null;
    $('camera').removeAttribute('transform'); $('world').removeAttribute('transform'); resetPose();
    $('core').style.opacity = '1'; $('arena').dataset.state = 'running'; $('arena').dataset.armed = 'false';
    $('game-shell').dataset.runMode = 'duel'; $('state-light').dataset.mode = 'running';
    for (const id of ['overlay', 'skill-choices', 'share', 'next-stage', 'stage-progress', 'boss-hud', 'boss-banner', 'reaction-meter', 'decoy-panel']) $(id).hidden = true;
    $('decoy-folder').setAttribute('visibility', 'hidden');
    for (const item of document.querySelectorAll('[data-unlock]')) item.hidden = true;
    document.querySelector('.legend').hidden = false;
    $('skill').disabled = false; $('skill-meter').setAttribute('aria-valuemax', 3);
    $('skill-meter').setAttribute('aria-label', tr('Attack energy', '공격 에너지'));
    $('skill-key').textContent = tr('Space: switch · Shift + direction: attack', 'Space: 전환 · Shift + 방향: 공격');
    $('score-label').textContent = tr('Defenses', '방어');
    $('message').textContent = ''; $('share-status').textContent = '';
    updateGuardZone(TYPES.virus.travel); updateLaneStates(); setStance('guard');
    $('main-menu').hidden = true; $('game-view').hidden = false; $('menu-open').hidden = false;
    requestAnimationFrame(fitConsole);
  }

  function unmount() {
    if (!saved) return;
    silenceSound();
    const prior = saved; saved = null;
    for (const layer of prior.layers) layer.node.replaceChildren(...layer.children);
    ({ mode, score, vulnerability, enemies, effects, clock, fxClock, bossFight, nextBossAt, cameraZoom, lastFrame, frame, nextSpawn, lastInput, messageUntil, coreFlashUntil, recoveryUntil, previousDirection, poseUntil, flashUntil, damagedUntil, shake, charge, proxyArmed, decoyCapacity, arrivalSlots, nextWorm, lockedUntil, proxyUntil, pointers, vaccineSlowAt, GUARD_WINDOW, PERFECT_WINDOW, COOLDOWN } = prior.globals);
    updateHUD();
    for (const entry of prior.nodes) restoreNode(entry);
    actors.clear(); lastEventId = 0; guards = 0; roundStart = null;
  }

  function setMessage(text, color = 'var(--green)') {
    if (!saved) return;
    $('message').textContent = text; $('message').style.color = color; messageUntil = clock + 1200;
  }
  function banner(symbol, title, copy) {
    if (!saved) return;
    $('overlay-symbol').textContent = symbol; $('overlay-title').textContent = title; $('overlay-copy').textContent = copy;
    $('skill-choices').hidden = true; $('overlay').hidden = false;
  }
  function hideBanner() { if (saved) $('overlay').hidden = true; }
  function setStance(value) {
    stance = value === 'attack' ? 'attack' : 'guard';
    if (!saved) return;
    $('skill-name').textContent = stance === 'attack' ? tr('Attack selected', '공격 선택') : tr('Defense selected', '수비 선택');
    $('skill').setAttribute('aria-label', tr('Switch attack or defense', '공격·수비 전환'));
    $('skill').setAttribute('aria-pressed', String(stance === 'attack'));
    $('arena').dataset.stance = stance;
  }
  function clearRound() {
    for (const actor of [...enemies]) removeEnemy(actor);
    for (const effect of effects) effect.node.remove();
    effects = []; actors.clear(); lastEventId = 0; guards = 0;
    poseUntil = 0; flashUntil = 0; damagedUntil = 0; coreFlashUntil = 0;
    shake = { at: 0, until: 0, power: 0 }; resetPose();
  }
  function render(state, ownId, at, options = {}) {
    if (!saved || !state) return;
    if (roundStart !== state.startAt) { clearRound(); roundStart = state.startAt; }
    clock = at; fxClock = at;
    const mine = state.players.find(player => player.id === ownId);
    const opponent = state.players.find(player => player.id !== ownId);
    if (!mine || !opponent) return;
    const incoming = state.attacks.filter(attack => attack.to === ownId);
    for (const attack of incoming) {
      let actor = actors.get(attack.attackId);
      if (!actor) {
        // Arrival reservation delays spawning, exactly as scheduleRegular does;
        // the Virus itself always keeps the original 2200ms travel speed.
        actor = spawnEnemy(attack.dir, attack.impactAt - TYPES.virus.travel, TYPES.virus.travel, 'virus', { arrival: attack.impactAt, duelVisual: true });
        actors.set(attack.attackId, actor);
      } else renderEnemy(actor);
    }
    for (const event of state.events || []) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      if (at - event.at > 1500) continue;
      const own = event.playerId === ownId;
      if (event.type === 'guard' && own) {
        const actor = actors.get(event.attackId);
        if (actor) renderEnemy(actor);
        shatterEnemy(actor || { dir: event.dir, kind: 'virus', radius: TARGET_RADIUS }, event.perfect);
        strikePose(event.dir, event.perfect); addEffect(event.dir, event.perfect ? 'perfect' : 'guard');
        shakeCamera(event.perfect ? 2.4 : 1.4); playSound(event.perfect ? 'perfect' : 'guard'); guards++;
        setMessage(event.perfect ? tr('Perfect / +½ attack energy', '정밀 패링 / 공격 에너지 +½') : tr('Guarded / rival pressure reset', '방어 / 상대 연속 적중 초기화'));
      } else if (event.type === 'attack' && own) {
        strikePose(event.dir, false); addEffect(event.dir, 'guard'); playSound('guard');
        setMessage(tr('Attack sent ', '공격 전송 ') + arrow[event.dir]);
      } else if (event.type === 'miss' && own) {
        addEffect(event.dir, 'miss'); playSound('miss'); setMessage(tr('Empty guard', '헛방어'), 'var(--pink)');
      } else if (event.type === 'hit') {
        if (own) { damageFeedback(true); coreFlashUntil = clock + 300; playSound('damage'); }
        setMessage((own ? tr('Core hit / +', '코어 피격 / +') : tr('Attack hit / +', '공격 적중 / +')) + event.damage + '%p', 'var(--pink)');
      } else if (event.type === 'finish') playSound(state.winnerId === ownId ? 'perfect' : 'gameover');
    }
    const pending = new Set(incoming.map(attack => attack.attackId));
    for (const [id, actor] of actors) if (!pending.has(id)) { removeEnemy(actor); actors.delete(id); }
    vulnerability = mine.vulnerability; score = guards;
    $('vulnerability-value').textContent = mine.vulnerability + '%';
    $('vulnerability-fill').style.width = Math.min(100, mine.vulnerability) + '%';
    $('vulnerability').setAttribute('aria-valuenow', mine.vulnerability);
    $('vulnerability').setAttribute('aria-valuetext', mine.vulnerability + '%');
    $('score').textContent = guards; $('score-label').textContent = tr('Defenses', '방어');
    bestLabel().textContent = options.opponentName || tr('Opponent', '상대'); $('best').textContent = opponent.vulnerability + '%';
    $('run-label').textContent = tr('Duel', '듀얼') + (options.connection ? ' · ' + options.connection : '');
    const energy = Math.max(0, Math.min(3, options.energy === undefined ? mine.energy : options.energy));
    $('skill-fill').style.width = energy / 3 * 100 + '%';
    $('skill-meter').setAttribute('aria-valuenow', energy.toFixed(2));
    $('skill').dataset.ready = String(energy >= 1);
    $('skill-status').textContent = tr('Attack energy ', '공격 에너지 ') + energy.toFixed(1) + ' / 3';
    if (options.stance) setStance(options.stance);
    updateEffects(); updateLaneStates(); $('core').style.opacity = clock < coreFlashUntil ? '.4' : '1';
    if (messageUntil && clock > messageUntil) { $('message').textContent = ''; messageUntil = 0; }
  }
  window.NeonDuelView = Object.freeze({ mount, render, unmount, setMessage, banner, hideBanner, setStance, isMounted: () => !!saved });
})();
