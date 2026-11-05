'use strict';

// Duel borrows the original interactive arena. The opponent has a read-only
// SVG scene driven by the same match state and drawing helpers.
(() => {
  const layerIds = ['enemies', 'effects', 'foreground-fx', 'phishing-links', 'boss-entities', 'lane-states'];
  const textIds = ['overlay-symbol', 'overlay-title', 'overlay-copy', 'skill-name', 'skill-key', 'skill-status', 'action', 'run-label', 'score-label', 'score', 'best', 'vulnerability-value', 'message', 'share-status'];
  const stateIds = ['overlay', 'skill-choices', 'skill', 'skill-meter', 'skill-fill', 'share', 'next-stage', 'stage-progress', 'boss-hud', 'boss-banner', 'reaction-meter', 'vulnerability', 'vulnerability-fill', 'state-light', 'arena', 'decoy-panel', 'decoy-folder', 'folder-capacity', 'camera', 'world', 'core', 'game-view', 'main-menu', 'menu-open', 'game-shell', 'guard-band', 'guard-outer', 'guard-inner', 'guard-pose'];
  const arrow = { up: '↑', right: '→', down: '↓', left: '←' };
  let saved = null, actors = new Map(), rivalScene = null, lastEventId = 0, guards = 0, roundStart = null, stance = 'guard';
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

  function mountRivalScene() {
    const panel = $('duel-opponent'), arena = $('duel-opponent-arena');
    const name = $('duel-opponent-name'), value = $('duel-opponent-vulnerability');
    const art = $('arena').querySelector('svg').cloneNode(true);
    const parts = new Map();
    for (const part of art.querySelectorAll('[id]')) {
      parts.set(part.id, part);
      part.removeAttribute('id');
    }
    const node = id => parts.get(id);
    for (const id of ['decoy-folder', 'boss-entities', 'phishing-links', 'lane-states']) node(id).remove();
    const threats = new Map(), particles = [];
    let at = 0, posedUntil = 0, flashedUntil = 0, hitUntil = 0;
    function schedule(effect, duration, draw, foreground = false) {
      node(foreground ? 'foreground-fx' : 'effects').append(effect);
      particles.push({ node: effect, at, duration, draw }); draw(0);
    }
    function reset() {
      node('enemies').replaceChildren();
      node('effects').replaceChildren();
      node('foreground-fx').replaceChildren();
      threats.clear(); particles.length = 0;
      posedUntil = 0; flashedUntil = 0; hitUntil = 0;
      resetPose(node); node('core').style.opacity = '1';
      arena.removeAttribute('data-damaged');
      value.textContent = '0%';
    }
    reset();
    $('duel-self-name').textContent = tr('You', '나');
    name.textContent = tr('Opponent', '상대');
    arena.replaceChildren(art);
    panel.hidden = false;
    return {
      prepare(attacks, player, time, label) {
        at = time;
        if (name.textContent !== label) name.textContent = label;
        const percent = player.vulnerability + '%';
        if (value.textContent !== percent) value.textContent = percent;
        const pending = new Set();
        for (const attack of attacks) {
          if (attack.to !== player.id) continue;
          pending.add(attack.attackId);
          let actor = threats.get(attack.attackId);
          if (!actor) {
            const travel = TYPES.virus.travel;
            actor = createEnemyActor(attack.dir, attack.impactAt - travel, travel, 'virus', { arrival: attack.impactAt });
            node('enemies').append(actor.node);
            threats.set(attack.attackId, actor);
          }
          paintEnemy(actor, at);
        }
        return pending;
      },
      play(event) {
        if (event.type === 'hit') {
          hitUntil = at + 280;
          glitchAt(240, 240, 39, 'damage', schedule);
        } else if (event.type === 'guard' || event.type === 'attack') {
          if (event.type === 'guard') {
            const actor = threats.get(event.attackId);
            const radius = actor ? enemyPosition(actor, event.at).radius : TARGET_RADIUS;
            shatterEnemy({ dir: event.dir, kind: 'virus', radius }, event.perfect, schedule);
          }
          paintStrikePose(event.dir, event.perfect, node, schedule);
          addEffect(event.dir, event.perfect ? 'perfect' : 'guard', schedule);
          posedUntil = at + 170; flashedUntil = at + 65;
        } else if (event.type === 'miss') addEffect(event.dir, 'miss', schedule);
      },
      finishFrame(pending) {
        for (const [id, actor] of threats) if (!pending.has(id)) { actor.node.remove(); threats.delete(id); }
        paintTimedEffects(particles, at);
        if (at >= posedUntil && node('fighter').dataset.pose !== 'idle') resetPose(node);
        if (at >= flashedUntil || reducedMotion.matches) node('fighter').dataset.flash = 'false';
        const damaged = at < hitUntil;
        node('core').style.opacity = damaged ? '.4' : '1';
        arena.dataset.damaged = String(damaged);
      },
      reset,
      unmount() {
        panel.hidden = true;
        arena.replaceChildren();
        arena.removeAttribute('data-damaged');
      }
    };
  }

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
    rivalScene = mountRivalScene();
    $('main-menu').hidden = true; $('game-view').hidden = false; $('menu-open').hidden = false;
    requestAnimationFrame(fitConsole);
  }

  function unmount() {
    if (!saved) return;
    silenceSound();
    rivalScene.unmount(); rivalScene = null;
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
    rivalScene.reset();
  }
  function render(state, ownId, at, options = {}) {
    if (!saved || !state) return;
    if (roundStart !== state.startAt) { clearRound(); roundStart = state.startAt; }
    clock = at; fxClock = at;
    const mine = state.players.find(player => player.id === ownId);
    const opponent = state.players.find(player => player.id !== ownId);
    if (!mine || !opponent) return;
    const opponentName = options.opponentName || tr('Opponent', '상대');
    const rivalPending = rivalScene.prepare(state.attacks, opponent, at, opponentName);
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
      if (event.playerId === opponent.id) rivalScene.play(event);
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
    rivalScene.finishFrame(rivalPending);
    vulnerability = mine.vulnerability; score = guards;
    $('vulnerability-value').textContent = mine.vulnerability + '%';
    $('vulnerability-fill').style.width = Math.min(100, mine.vulnerability) + '%';
    $('vulnerability').setAttribute('aria-valuenow', mine.vulnerability);
    $('vulnerability').setAttribute('aria-valuetext', mine.vulnerability + '%');
    $('score').textContent = guards; $('score-label').textContent = tr('Defenses', '방어');
    bestLabel().textContent = opponentName; $('best').textContent = opponent.vulnerability + '%';
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
