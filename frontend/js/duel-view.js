'use strict';

// Duel borrows the original interactive arena. Each opponent's read-only SVG
// scene uses the same match state and drawing helpers.
(() => {
  const layerIds = ['enemies', 'effects', 'foreground-fx', 'phishing-links', 'boss-entities', 'lane-states'];
  const textIds = ['overlay-symbol', 'overlay-title', 'overlay-copy', 'skill-name', 'skill-key', 'skill-status', 'action', 'run-label', 'score-label', 'score', 'best', 'vulnerability-value', 'message', 'share-status'];
  const stateIds = ['overlay', 'skill-choices', 'skill', 'skill-meter', 'skill-fill', 'share', 'next-stage', 'stage-progress', 'boss-hud', 'boss-banner', 'reaction-meter', 'vulnerability', 'vulnerability-fill', 'state-light', 'arena', 'decoy-panel', 'decoy-folder', 'folder-capacity', 'camera', 'world', 'core', 'game-view', 'main-menu', 'menu-open', 'game-shell', 'guard-band', 'guard-outer', 'guard-inner', 'guard-pose'];
  const arrow = { up: '↑', right: '→', down: '↓', left: '←' };
  const upgradeLabels = {
    mutation: ['Extra virus chance', '추가 바이러스 확률'],
    attack_speed: ['Shot speed', '공격 속도'],
    recharge: ['Recharge speed', '충전 속도'],
    repair: ['Repair', '코어 수리'],
    perfect_energy: ['Perfect energy', '정밀 패링 에너지']
  };
  let saved = null, actors = new Map(), lastEventId = 0, guards = 0, roundStart = null, stance = 'guard';
  let config, artTemplate, rivals = new Map(), pendingTarget, prediction, eliminated;
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

  function attackKind(kind) { return Object.prototype.hasOwnProperty.call(TYPES, kind) ? kind : 'virus'; }
  function createAttackActor(attack, clash) {
    const kind = attackKind(attack.kind);
    // A queued attack in classic Duel retains the original fixed travel time.
    const travel = clash && Number.isFinite(attack.launchedAt) && attack.impactAt > attack.launchedAt
      ? attack.impactAt - attack.launchedAt : TYPES[kind].travel;
    const deceptive = kind === 'phishing' && arrow[attack.decoyDir] && Number.isFinite(attack.revealAt);
    return createEnemyActor(deceptive ? attack.decoyDir : attack.dir, attack.impactAt - travel, travel, kind, {
      arrival: attack.impactAt, trueDir: attack.dir, revealAt: deceptive ? attack.revealAt : -Infinity
    });
  }
  function paintAttack(actor, at) {
    const decoy = actor.dir;
    actor.revealed = at >= actor.revealAt;
    if (actor.revealed) actor.dir = actor.trueDir;
    paintEnemy(actor, at);
    actor.dir = decoy;
  }
  function breakAttack(actor, event, schedule) {
    const radius = actor ? enemyPosition(actor, event.at).radius : TARGET_RADIUS;
    shatterEnemy({ dir: event.dir, kind: actor?.kind || attackKind(event.kind), radius }, event.perfect, schedule);
  }

  function mountRivalScene(arena, name, value, tile) {
    const art = artTemplate.cloneNode(true);
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
    arena.replaceChildren(art);
    return {
      prepare(attacks, player, time, label, selected, targeting, clash) {
        at = time;
        if (name.textContent !== label) name.textContent = label;
        const percent = player.eliminated ? tr('Out', '탈락') : player.vulnerability + '%';
        if (value.textContent !== percent) value.textContent = percent;
        const out = String(!!player.eliminated);
        if (arena.dataset.eliminated !== out) arena.setAttribute('data-eliminated', out);
        if (tile) {
          if (tile.dataset.eliminated !== out) tile.setAttribute('data-eliminated', out);
          if (config.onTarget) {
            if (tile.getAttribute('aria-pressed') !== String(selected)) tile.setAttribute('aria-pressed', String(selected));
            const disabled = !!player.eliminated || !targeting;
            if (tile.disabled !== disabled) tile.disabled = disabled;
          }
        }
        const pending = new Set();
        for (const attack of attacks) {
          if (attack.to !== player.id) continue;
          pending.add(attack.attackId);
          let actor = threats.get(attack.attackId);
          if (!actor) {
            actor = createAttackActor(attack, clash);
            node('enemies').append(actor.node);
            threats.set(attack.attackId, actor);
          }
          paintAttack(actor, at);
        }
        return pending;
      },
      play(event) {
        if (event.type === 'hit') {
          hitUntil = at + 280;
          glitchAt(240, 240, 39, 'damage', schedule);
        } else if (event.type === 'cancel') {
          breakAttack(threats.get(event.attackId), event, schedule);
        } else if (event.type === 'guard' || (event.type === 'attack' && !['counter', 'mutation'].includes(event.source))) {
          if (event.type === 'guard') breakAttack(threats.get(event.attackId), event, schedule);
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
      reset
    };
  }

  function makeTile(playerId) {
    const tile = document.createElement(config.onTarget ? 'button' : 'div');
    tile.className = 'duel-opponent-tile';
    if (config.onTarget) {
      tile.setAttribute('type', 'button');
      tile.setAttribute('data-duel-target', playerId);
      tile.setAttribute('aria-pressed', 'false');
      tile.addEventListener('click', () => { if (!tile.disabled) config?.onTarget?.(playerId); });
    }
    const heading = document.createElement('span');
    const name = document.createElement('span');
    const value = document.createElement('span');
    const arena = document.createElement('span');
    heading.className = 'duel-tile-heading';
    name.className = 'duel-tile-name';
    value.className = 'duel-tile-value';
    arena.className = 'arena';
    arena.setAttribute('aria-hidden', 'true');
    heading.append(name, value);
    tile.append(heading, arena);
    $('duel-opponent-tiles').append(tile);
    return mountRivalScene(arena, name, value, tile);
  }
  function clearRivals() {
    $('duel-opponent-arena').replaceChildren();
    $('duel-opponent-arena').removeAttribute('data-damaged');
    $('duel-opponent-arena').removeAttribute('data-eliminated');
    $('duel-opponent-tiles').replaceChildren();
    rivals.clear();
  }
  function buildRivals(opponents) {
    clearRivals();
    const multiple = opponents.length > 1;
    $('duel-single-opponent').hidden = multiple;
    $('duel-opponent-group').hidden = !multiple;
    $('duel-opponent').setAttribute('aria-labelledby', multiple ? 'duel-opponents-label' : 'duel-opponent-name');
    $('duel-opponent').hidden = false;
    $('duel-opponent-tiles').setAttribute('data-dense', String(opponents.length >= 5));
    const shell = $('game-shell');
    if (multiple) shell.setAttribute('data-duel-group', '');
    else shell.removeAttribute('data-duel-group');
    for (const id of opponents) {
      rivals.set(id, multiple ? makeTile(id) : mountRivalScene(
        $('duel-opponent-arena'), $('duel-opponent-name'), $('duel-opponent-vulnerability')
      ));
    }
  }

  function mount(options = {}) {
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
    pendingTarget = null; prediction = null; eliminated = false;
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
    config = {
      onTarget: options.onTarget,
      onUpgrade: options.onUpgrade,
      names: new Map((options.players || []).map(player => typeof player === 'string' ? [player, ''] : [player.id, player.name]))
    };
    $('duel-self-name').textContent = tr('You', '나');
    $('duel-opponent-name').textContent = tr('Opponent', '상대');
    $('duel-combo-label').textContent = tr('Combo', '콤보');
    artTemplate = $('arena').querySelector('svg').cloneNode(true);
    const opponents = [...config.names.keys()].filter(id => id !== options.selfId);
    buildRivals(opponents.length ? opponents : [null]);
    $('main-menu').hidden = true; $('game-view').hidden = false; $('menu-open').hidden = false;
    requestAnimationFrame(fitConsole);
  }

  function unmount() {
    if (!saved) return;
    silenceSound();
    clearRivals();
    $('duel-opponent').hidden = true;
    $('duel-opponent').setAttribute('aria-labelledby', 'duel-opponent-name');
    $('duel-single-opponent').hidden = false; $('duel-opponent-group').hidden = true;
    $('duel-combo').hidden = true; $('duel-latency').hidden = true;
    $('duel-speed').hidden = true;
    renderUpgrade(null);
    config = null; artTemplate = null; pendingTarget = null; prediction = null; eliminated = false;
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
  function predictGuard(dir) {
    if (!saved || eliminated || !Object.prototype.hasOwnProperty.call(arrow, dir)) return;
    prediction = { dir, at: clock };
    strikePose(dir, false);
  }
  function setLatency(ms) {
    if (!saved) return;
    const readout = $('duel-latency');
    readout.hidden = !Number.isFinite(ms) || ms < 0;
    if (!readout.hidden) readout.textContent = tr('RTT ', '왕복 ') + Math.round(ms) + ' ms';
  }
  function setTarget(id) {
    if (!saved || eliminated || !rivals.has(id)) return;
    pendingTarget = { id, until: clock + 1200 };
  }
  function upgradeText({ kind, value }) {
    const label = tr(...(upgradeLabels[kind] || ['Upgrade', '업그레이드']));
    const sign = kind === 'repair' ? '−' : '+';
    const unit = kind === 'repair' || kind === 'mutation' ? '%p' : '%';
    return [label, sign + value + unit];
  }
  function renderUpgrade(offer) {
    const panel = $('duel-upgrades');
    const buttons = $('duel-upgrade-choices');
    if (!offer?.choices?.length || !config?.onUpgrade) {
      if (!panel.hidden) {
        panel.hidden = true;
        panel.removeAttribute('data-duel-offer');
        buttons.replaceChildren();
      }
      return;
    }
    const offerId = String(offer.id);
    const newOffer = panel.getAttribute('data-duel-offer') !== offerId;
    const label = tr('Choose 1 upgrade', '업그레이드 1개 선택');
    if (!newOffer && $('duel-upgrades-label').textContent === label) return;
    panel.setAttribute('data-duel-offer', offerId);
    $('duel-upgrades-label').textContent = label;
    buttons.replaceChildren(...offer.choices.map((choice, index) => {
      const button = document.createElement('button');
      const key = document.createElement('kbd');
      const name = document.createElement('span');
      const amount = document.createElement('span');
      button.className = 'duel-upgrade-choice';
      button.setAttribute('type', 'button');
      button.setAttribute('data-duel-upgrade', choice.id);
      button.setAttribute('aria-keyshortcuts', String(index + 1));
      key.setAttribute('aria-hidden', 'true');
      key.textContent = index + 1;
      amount.className = 'duel-upgrade-amount';
      const [choiceName, choiceAmount] = upgradeText(choice);
      name.textContent = choiceName;
      amount.textContent = choiceAmount;
      button.append(key, name, amount);
      button.addEventListener('click', () => {
        if (!panel.hidden && panel.getAttribute('data-duel-offer') === offerId) config?.onUpgrade?.(offer.id, choice.id);
      });
      return button;
    }));
    panel.hidden = false;
    if (newOffer) setMessage(label);
  }
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
    pendingTarget = null; prediction = null;
    renderUpgrade(null);
    poseUntil = 0; flashUntil = 0; damagedUntil = 0; coreFlashUntil = 0;
    shake = { at: 0, until: 0, power: 0 }; resetPose();
    for (const scene of rivals.values()) scene.reset();
  }
  function render(state, ownId, at, options = {}) {
    if (!saved || !state) return;
    if (roundStart !== state.startAt) { clearRound(); roundStart = state.startAt; }
    clock = at; fxClock = at;
    const mine = state.players.find(player => player.id === ownId);
    const opponents = state.players.filter(player => player.id !== ownId);
    if (!mine || !opponents.length) return;
    const clash = state.mode === 'clash';
    eliminated = !!mine.eliminated;
    const selfName = eliminated && state.status !== 'finished' ? tr('Spectating', '관전 중') : tr('You', '나');
    if ($('duel-self-name').textContent !== selfName) $('duel-self-name').textContent = selfName;
    if ($('arena').dataset.duelEliminated !== String(eliminated)) $('arena').setAttribute('data-duel-eliminated', String(eliminated));
    if (rivals.size !== opponents.length || opponents.some(player => !rivals.has(player.id))) {
      buildRivals(opponents.map(player => player.id));
    }
    if (pendingTarget && (eliminated || pendingTarget.id === mine.targetId || at >= pendingTarget.until ||
      !opponents.some(player => player.id === pendingTarget.id && !player.eliminated))) pendingTarget = null;
    const targetId = pendingTarget?.id ?? mine.targetId;
    const targeting = !!config.onTarget && !eliminated && state.status === 'running';
    const groupLabel = targeting ? tr('Choose target', '공격 대상') : tr('Opponents', '상대');
    if ($('duel-opponents-label').textContent !== groupLabel) $('duel-opponents-label').textContent = groupLabel;
    const opponentLabel = (player, i) => (opponents.length === 1 ? options.opponentName : '') ||
      player.name || config.names.get(player.id) || tr('Opponent', '상대') + (opponents.length > 1 ? ' ' + (i + 1) : '');
    const rivalPending = opponents.map((player, i) => {
      const scene = rivals.get(player.id);
      return [scene, scene.prepare(state.attacks, player, at, opponentLabel(player, i), player.id === targetId && !player.eliminated, targeting, clash)];
    });
    const incoming = state.attacks.filter(attack => attack.to === ownId);
    for (const attack of incoming) {
      let actor = actors.get(attack.attackId);
      if (!actor) {
        actor = createAttackActor(attack, clash);
        $('enemies').append(actor.node);
        enemies.push(actor);
        actors.set(attack.attackId, actor);
      }
      paintAttack(actor, at);
    }
    for (const event of state.events || []) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      if (at - event.at > 1500) continue;
      const own = event.playerId === ownId;
      rivals.get(event.playerId)?.play(event);
      if (event.type === 'guard' && own) {
        breakAttack(actors.get(event.attackId), event);
        const confirmsPrediction = prediction?.dir === event.dir && Math.abs(event.at - prediction.at) <= 350;
        if (!confirmsPrediction || fxClock >= poseUntil) strikePose(event.dir, event.perfect);
        if (confirmsPrediction) prediction = null;
        addEffect(event.dir, event.perfect ? 'perfect' : 'guard');
        shakeCamera(event.perfect ? 2.4 : 1.4); playSound(event.perfect ? 'perfect' : 'guard'); guards++;
        if (clash) setMessage(event.perfect ? tr('Perfect', '정밀 패링') : tr('Guarded', '방어'));
        else setMessage(event.perfect ? tr('Perfect / +½ attack energy', '정밀 패링 / 공격 에너지 +½') :
          tr('Guarded / rival pressure reset', '방어 / 상대 연속 적중 초기화'));
      } else if (event.type === 'attack' && own) {
        if (event.source === 'counter') {
          if (event.kind !== 'echo') setMessage(tr('Combo / counter sent', '콤보 / 반격'));
        } else if (event.source === 'mutation') {
          setMessage(tr('Extra virus', '추가 바이러스'));
        }
        else {
          strikePose(event.dir, false); addEffect(event.dir, 'guard'); playSound('guard');
          setMessage(tr('Attack sent ', '공격 전송 ') + arrow[event.dir]);
        }
      } else if (event.type === 'cancel' && own) {
        breakAttack(actors.get(event.attackId), event);
        setMessage(tr('Combo / attack canceled', '콤보 / 공격 차단'));
      } else if (event.type === 'upgrade' && own) {
        setMessage(tr('Upgrade · ', '업그레이드 · ') + upgradeText(event).join(' '));
      } else if (event.type === 'miss' && own) {
        addEffect(event.dir, 'miss'); playSound('miss'); setMessage(tr('Empty guard', '헛방어'), 'var(--pink)');
      } else if (event.type === 'hit') {
        if (own) { damageFeedback(true); coreFlashUntil = clock + 300; playSound('damage'); }
        if (!clash || own || event.from === ownId) {
          setMessage((own ? tr('Core hit / +', '코어 피격 / +') : tr('Attack hit / +', '공격 적중 / +')) + event.damage + '%p', 'var(--pink)');
        }
      } else if (event.type === 'finish') playSound(state.winnerId === ownId ? 'perfect' : 'gameover');
    }
    const pending = new Set(incoming.map(attack => attack.attackId));
    for (const [id, actor] of actors) if (!pending.has(id)) { removeEnemy(actor); actors.delete(id); }
    for (const [scene, pending] of rivalPending) scene.finishFrame(pending);
    vulnerability = mine.vulnerability; score = guards;
    $('vulnerability-value').textContent = mine.vulnerability + '%';
    $('vulnerability-fill').style.width = Math.min(100, mine.vulnerability) + '%';
    $('vulnerability').setAttribute('aria-valuenow', mine.vulnerability);
    $('vulnerability').setAttribute('aria-valuetext', mine.vulnerability + '%');
    $('score').textContent = guards; $('score-label').textContent = tr('Defenses', '방어');
    bestLabel().textContent = opponentLabel(opponents[0], 0); $('best').textContent = opponents[0].vulnerability + '%';
    $('run-label').textContent = (clash ? tr('Clash', '난투') : tr('Duel', '듀얼')) + (options.connection ? ' · ' + options.connection : '');
    $('duel-combo').hidden = !clash;
    if (clash) $('duel-combo-value').textContent = (mine.combo ?? 0) + ' / ' + (state.rules?.comboThreshold ?? 3);
    const speed = (state.speedPercent ?? 0) + (mine.upgrades?.attack_speed ?? 0);
    const speedReadout = $('duel-speed');
    speedReadout.hidden = !clash || speed <= 0;
    if (!speedReadout.hidden) {
      const speedText = tr('Shot speed +', '공격 속도 +') + speed + '%';
      if (speedReadout.textContent !== speedText) speedReadout.textContent = speedText;
    }
    renderUpgrade(clash && state.status === 'running' && !eliminated ? mine.offer : null);
    const energy = Math.max(0, Math.min(3, options.energy === undefined ? mine.energy : options.energy));
    $('skill-fill').style.width = energy / 3 * 100 + '%';
    $('skill-meter').setAttribute('aria-valuenow', energy.toFixed(2));
    $('skill').dataset.ready = String(energy >= 1);
    $('skill-status').textContent = tr('Attack energy ', '공격 에너지 ') + energy.toFixed(1) + ' / 3';
    if (options.stance) setStance(options.stance);
    updateEffects(); updateLaneStates(); $('core').style.opacity = clock < coreFlashUntil ? '.4' : '1';
    if (messageUntil && clock > messageUntil) { $('message').textContent = ''; messageUntil = 0; }
  }
  window.NeonDuelView = Object.freeze({
    mount, render, unmount, setMessage, banner, hideBanner, setStance, predictGuard, setLatency, setTarget,
    isMounted: () => !!saved
  });
})();
