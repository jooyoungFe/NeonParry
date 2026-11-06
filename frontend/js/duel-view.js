'use strict';

// Duel borrows the original interactive arena. Each opponent's read-only SVG
// scene uses the same match state and drawing helpers.
(() => {
  const layerIds = ['enemies', 'effects', 'foreground-fx', 'phishing-links', 'boss-entities', 'lane-states'];
  const textIds = ['overlay-symbol', 'overlay-title', 'overlay-copy', 'skill-name', 'skill-key', 'skill-status', 'action', 'run-label', 'score-label', 'score', 'best', 'vulnerability-value', 'message', 'share-status', 'boss-name', 'boss-pips', 'boss-banner-tag', 'boss-banner-title', 'boss-banner-copy'];
  const stateIds = ['overlay', 'skill-choices', 'skill', 'skill-meter', 'skill-fill', 'share', 'next-stage', 'stage-progress', 'boss-hud', 'boss-banner', 'reaction-meter', 'reaction-fill', 'vulnerability', 'vulnerability-fill', 'state-light', 'arena', 'decoy-panel', 'decoy-folder', 'folder-capacity', 'camera', 'world', 'core', 'game-view', 'main-menu', 'menu-open', 'game-shell', 'guard-band', 'guard-outer', 'guard-inner', 'guard-pose'];
  const arrow = { up: '↑', right: '→', down: '↓', left: '←' };
  let saved = null, actors = new Map(), lastEventId = 0, guards = 0, roundStart = null, stance = 'guard';
  let config, artTemplate, rivals = new Map(), pendingTarget, prediction, eliminated, localBoss;
  let nextBossSceneId = 0;
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
  function mountAttackActor(attack, upgradesEnabled, node) {
    const kind = attackKind(attack.kind);
    // Legacy snapshots report command time. Upgrade-enabled rooms report when
    // the attack appears so queued shots retain their full travel speed.
    const travel = upgradesEnabled && Number.isFinite(attack.launchedAt) && attack.impactAt > attack.launchedAt
      ? attack.impactAt - attack.launchedAt : TYPES[kind].travel;
    const deceptive = kind === 'phishing' && arrow[attack.decoyDir] && Number.isFinite(attack.revealAt);
    const actor = createEnemyActor(deceptive ? attack.decoyDir : attack.dir, attack.impactAt - travel, travel, kind, {
      arrival: attack.impactAt, trueDir: attack.dir, revealAt: deceptive ? attack.revealAt : -Infinity, duelVisual: true
    });
    node('enemies').append(actor.node);
    if (deceptive) {
      actor.mirror = actor.node.cloneNode(true);
      actor.mirror.setAttribute('data-role', 'phishing-body');
      actor.mirror.setAttribute('opacity', '.5');
      actor.mirror.firstElementChild.setAttribute('stroke-dasharray', '2 3');
      actor.link = svg('path', { class: 'phishing-link', visibility: 'hidden' });
      node('phishing-links').append(actor.link);
      node('enemies').append(actor.mirror);
    }
    return actor;
  }
  function paintAttack(actor, attack, at, audible = false) {
    if (actor.kind === 'worm') {
      const dormant = attack.state === 'dormant';
      actor.state = dormant ? 'dormant' : 'moving';
      actor.remaining = attack.remaining ?? 0;
      actor.startRadius = dormant ? 157 : START_RADIUS;
      actor.arrival = attack.impactAt ?? Infinity;
      actor.at = Number.isFinite(attack.launchedAt) ? attack.launchedAt : actor.arrival - actor.travel;
      if (actor.arrival > actor.at && Number.isFinite(actor.arrival)) actor.travel = actor.arrival - actor.at;
      const [dx, dy] = DIRECTIONS[actor.dir];
      actor.hop = Number.isFinite(attack.hopAt) && at >= attack.hopAt && at < actor.at
        ? { at: attack.hopAt, until: actor.at, x: 240 + dx * 157, y: 240 + dy * 157 } : null;
    }
    const { visible, ready } = paintEnemy(actor, at);
    if (!actor.mirror) return;
    const revealed = visible && at >= actor.revealAt;
    if (revealed && !actor.revealed && audible) playSound('reveal');
    actor.revealed = revealed;
    const [dx, dy] = DIRECTIONS[actor.trueDir];
    const x = 240 + dx * actor.radius, y = 240 + dy * actor.radius;
    actor.mirror.setAttribute('transform', `translate(${x} ${y})`);
    actor.mirror.setAttribute('visibility', revealed ? 'visible' : 'hidden');
    actor.mirror.firstElementChild.setAttribute('stroke-width', ready ? 2.5 : 1.25);
    actor.mirror.firstElementChild.setAttribute('stroke', ready ? '#ffe2c7' : TYPES.phishing.color);
    actor.mirror.children[1].setAttribute('transform', actor.fill.getAttribute('transform'));
    actor.link.setAttribute('visibility', revealed ? 'visible' : 'hidden');
    actor.link.setAttribute('d', `M${actor.x} ${actor.y}L${x} ${y}`);
    actor.outline.setAttribute('stroke-width', 1.25);
    actor.outline.setAttribute('stroke', TYPES.phishing.color);
    if (revealed) actor.outline.setAttribute('stroke-dasharray', '1 4');
  }
  function breakAttack(actor, event, schedule) {
    const radius = event.radius ?? (actor ? enemyPosition(actor, event.at).radius : TARGET_RADIUS);
    const kind = event.source === 'boss' ? (event.kind === 'destroy' ? 'ddos' : 'trojan') : actor?.kind || attackKind(event.kind);
    shatterEnemy({ dir: event.dir, kind, radius }, strongGuard(event), schedule);
  }
  function strongGuard(event) { return event.source === 'boss' ? event.heavy : event.perfect; }
  function manualAttack(event) { return event.type === 'attack' && (!event.source || event.source === 'manual'); }
  function hasMissPenalty(event) { return Number.isFinite(event.damage) && event.damage > 0; }

  function lanePosition(dir, radius) {
    const [dx, dy] = DIRECTIONS[dir];
    return [240 + dx * radius, 240 + dy * radius];
  }
  function bossAttackArt(kind, attack) {
    const color = BOSS_TYPES[kind].color;
    const r = kind === 'domain' ? 20 : [23, 17, 12][attack.depth];
    const node = svg('g', { class: 'boss-node', 'data-boss-attack': attack.id });
    const outline = svg('path', { d: `M${-r} ${-r*.55}L0 ${-r}L${r} ${-r*.55}V${r*.55}L0 ${r}L${-r} ${r*.55}Z`, fill: '#202820', stroke: color });
    const fill = svg('path', { d: `M${-r+3} 0L0 ${-r+3}L${r-3} 0L0 ${r-3}Z`, fill: color });
    const label = svg('text', { x: 0, y: -r - 9, class: 'boss-attack-label' });
    label.textContent = kind === 'domain' ? '//' : ['1', '½', '¼'][attack.depth];
    node.append(outline, fill, label);
    return { node, paint(at, window) {
      const progress = Math.max(0, (at - attack.launchedAt) / (attack.impactAt - attack.launchedAt));
      const [x, y] = lanePosition(attack.dir, 205 - (205 - TARGET_RADIUS) * progress);
      node.setAttribute('visibility', at >= attack.launchedAt ? 'visible' : 'hidden');
      node.setAttribute('transform', `translate(${x} ${y})`);
      fill.setAttribute('transform', `scale(${Math.sqrt(Math.min(1, progress))})`);
      outline.setAttribute('stroke-width', Math.abs(at - attack.impactAt) <= (attack.depth ? 160 : window) ? 2.5 : 1.5);
    } };
  }
  function domainArt(dir) {
    const [x, y] = lanePosition(dir, TARGET_RADIUS);
    const node = svg('g', { transform: `translate(${x} ${y})`, 'data-domain-dir': dir });
    const label = svg('text', { class: 'domain-number', y: 5 });
    const queue = svg('text', { class: 'domain-queue', y: 35 });
    node.append(
      svg('path', { class: 'boss-main', d: 'M-17 -9L0 -19L17 -9V9L0 19L-17 9Z' }),
      svg('path', { class: 'boss-main-cross', d: 'M-25 -13V-25H-13 M13 -25H25V-13 M25 13V25H13 M-13 25H-25V13 M-8 0H8 M0 -8V8' }),
      label, queue
    );
    return { node, paint(fight) {
      const numbers = [];
      fight.sequence.forEach((lane, i) => { if (lane === dir && i >= fight.sequenceIndex) numbers.push(i + 1); });
      node.setAttribute('visibility', numbers.length ? 'visible' : 'hidden');
      node.setAttribute('data-next', String(fight.sequence[fight.sequenceIndex] === dir));
      label.textContent = numbers[0] ?? '';
      queue.textContent = numbers.slice(1).join(' · ');
    } };
  }
  function destroyPreviewArt(dir, index, sceneId) {
    const id = `duel-preview-${sceneId}-${index}`;
    const node = svg('g', { 'data-preview': index, transform: `rotate(${ROTATION[dir]} 240 240)` });
    const defs = svg('defs', {});
    const gradient = svg('linearGradient', { id, x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
    for (const [offset, opacity] of [['0%', .95], ['32%', .55], ['100%', 0]]) {
      gradient.append(svg('stop', { offset, 'stop-color': BOSS_TYPES.destroy.color, 'stop-opacity': opacity }));
    }
    defs.append(gradient);
    const number = svg('text', { x: 240, y: 52, class: 'boss-attack-label', transform: `rotate(${-ROTATION[dir]} 240 52)` });
    number.textContent = index + 1;
    node.append(defs, svg('path', { d: 'M200 0H280L260 88Q240 124 220 88Z', fill: `url(#${id})` }),
      svg('rect', { x: 207, y: 1, width: 66, height: 3, fill: '#f4c9df' }), number);
    return { node, paint(fight, at) {
      const age = at - fight.phaseAt - index * fight.previewInterval;
      const duration = fight.previewDuration ?? 300;
      const opacity = age >= 0 && age < duration ? (reducedMotion.matches ? .65 : (1 - age / duration) ** 2) : 0;
      node.setAttribute('opacity', opacity);
    } };
  }
  function reboundArt(fight) {
    const [x, y] = lanePosition(fight.lastContact.dir, fight.lastContact.radius);
    const [nextX, nextY] = lanePosition(fight.nextDir, 180);
    const node = svg('path', { d: 'M-12 0L0 -12L12 0L0 12Z', fill: BOSS_TYPES[fight.kind].color });
    return { node, paint(fight, at) {
      const t = Math.min(1, Math.max(0, (at - fight.phaseAt) / (fight.phaseUntil - fight.phaseAt)));
      const u = 1 - t;
      node.setAttribute('transform', `translate(${u*u*x+2*u*t*240+t*t*nextX} ${u*u*y+2*u*t*240+t*t*nextY}) rotate(${t*220})`);
      node.setAttribute('opacity', 1 - t * .3);
    } };
  }
  function finisherArt(fight) {
    const [x, y] = lanePosition(fight.lastContact.dir, fight.lastContact.radius);
    const node = svg('g', { transform: `translate(${x} ${y})` });
    const halves = ['M0 -35L-32 -18V18L0 35Z', 'M0 -35L32 -18V18L0 35Z'].map(d =>
      svg('path', { d, fill: BOSS_TYPES[fight.kind].color, stroke: '#f1ffe9', 'stroke-width': 1.5 })
    );
    const slash = svg('path', { d: 'M-75 60L80 -65 M-40 74L65 -45', stroke: '#f4ffe9', 'stroke-width': 4, fill: 'none' });
    const wave = svg('circle', { cx: 0, cy: 0, r: 24, stroke: '#c5edb2', 'stroke-width': 1, fill: 'none' });
    node.append(...halves, slash, wave);
    return { node, paint(fight, at) {
      const t = Math.min(1, Math.max(0, (at - fight.phaseAt) / 1000));
      node.setAttribute('opacity', 1 - t);
      slash.setAttribute('opacity', Math.max(0, 1 - t * 2.5));
      if (!reducedMotion.matches) {
        halves.forEach((half, i) => half.setAttribute('transform', `translate(${(i ? 1 : -1)*t*90} ${-t*22}) rotate(${(i ? -1 : 1)*t*350})`));
        wave.setAttribute('r', 24 + t * 145);
      }
    } };
  }
  function createBossScene(node, arena) {
    const layer = node('boss-entities');
    const sceneId = ++nextBossSceneId;
    const attacks = new Map();
    let phase = '', phaseArt = [];
    function reset() {
      phase = ''; phaseArt = []; attacks.clear(); layer.replaceChildren();
      arena.removeAttribute('data-boss-phase');
      node('camera').removeAttribute('transform');
    }
    return { reset, render(fight, at, guardWindow) {
      if (!fight) { if (phase) reset(); return; }
      const key = [fight.kind, fight.phase, fight.phaseAt].join(':');
      if (phase !== key) {
        reset();
        phase = key;
        arena.setAttribute('data-boss-phase', fight.phase);
        if (fight.phase === 'reaction') phaseArt = [...new Set(fight.sequence)].map(domainArt);
        if (fight.phase === 'telegraph') phaseArt = fight.preview.map((dir, i) => destroyPreviewArt(dir, i, sceneId));
        if (fight.phase === 'rebound' && fight.lastContact && fight.nextDir) phaseArt = [reboundArt(fight)];
        if (fight.phase === 'finisher' && fight.lastContact) phaseArt = [finisherArt(fight)];
        for (const art of phaseArt) layer.append(art.node);
      }
      for (const art of phaseArt) art.paint(fight, at);
      if (!reducedMotion.matches && (fight.phase === 'reaction' || fight.phase === 'finisher')) {
        const amount = fight.phase === 'reaction' ? .11 : .16;
        const zoom = 1 + amount * Math.min(1, Math.max(0, (at - fight.phaseAt) / 130));
        node('camera').setAttribute('transform', `translate(240 240) scale(${zoom}) translate(-240 -240)`);
      }
      const pending = new Set();
      for (const attack of fight.attacks || []) {
        pending.add(attack.id);
        let art = attacks.get(attack.id);
        if (!art) {
          art = bossAttackArt(fight.kind, attack);
          layer.append(art.node); attacks.set(attack.id, art);
        }
        art.paint(at, guardWindow);
      }
      for (const [id, art] of attacks) {
        if (!pending.has(id)) { art.node.remove(); attacks.delete(id); }
      }
    } };
  }
  function paintBossHUD(fight, at) {
    $('boss-hud').hidden = !fight;
    const meter = $('reaction-meter');
    const banner = $('boss-banner');
    meter.hidden = fight?.phase !== 'reaction';
    banner.hidden = !['warning', 'finisher', 'failed'].includes(fight?.phase);
    if (!fight) return;
    const definition = BOSS_TYPES[fight.kind];
    if ($('boss-name').textContent !== definition.name) $('boss-name').textContent = definition.name;
    const pips = $('boss-pips');
    const progress = fight.remaining + '/' + fight.total;
    if (pips.getAttribute('data-duel-progress') !== progress) {
      pips.replaceChildren();
      pips.setAttribute('data-duel-progress', progress);
      pips.style.setProperty('--boss-color', definition.color);
      for (let i = 0; i < fight.total; i++) {
        const pip = document.createElement('i');
        if (i < fight.remaining) pip.className = 'live';
        pips.append(pip);
      }
    }
    const label = tr('Attempts remaining ', '남은 단계 ') + progress;
    if (pips.getAttribute('aria-label') !== label) pips.setAttribute('aria-label', label);
    if (!banner.hidden) {
      const warning = fight.phase === 'warning', won = fight.phase === 'finisher';
      banner.setAttribute('data-result', won ? 'win' : '');
      $('boss-banner-tag').textContent = warning ? '/// INTRUSION' : won ? '/// CONNECTION SEVERED' : '-- SIGNAL LOST --';
      $('boss-banner-title').textContent = warning ? definition.name : won
        ? tr('Intrusion blocked', '침입 차단') : tr('Domain escaped', '도메인 이탈');
      $('boss-banner-copy').textContent = warning ? definition.hint : '';
    }
    if (!meter.hidden) {
      const remaining = Math.max(0, Math.min(1, (fight.phaseUntil - at) / (fight.phaseUntil - fight.phaseAt)));
      $('reaction-fill').style.width = (remaining * 100) + '%';
      meter.setAttribute('aria-valuenow', Math.round(remaining * 100));
    }
  }

  function mountRivalScene(arena, name, value, tile) {
    const art = artTemplate.cloneNode(true);
    const parts = new Map();
    for (const part of art.querySelectorAll('[id]')) {
      parts.set(part.id, part);
      part.removeAttribute('id');
    }
    const node = id => parts.get(id);
    for (const id of ['decoy-folder', 'lane-states']) node(id).remove();
    const boss = createBossScene(node, arena);
    const threats = new Map(), particles = [];
    let at = 0, posedUntil = 0, flashedUntil = 0, hitUntil = 0, penaltyUntil = 0;
    function schedule(effect, duration, draw, foreground = false) {
      node(foreground ? 'foreground-fx' : 'effects').append(effect);
      particles.push({ node: effect, at, duration, draw }); draw(0);
    }
    function reset() {
      node('enemies').replaceChildren();
      node('effects').replaceChildren();
      node('foreground-fx').replaceChildren();
      node('phishing-links').replaceChildren();
      boss.reset();
      threats.clear(); particles.length = 0;
      posedUntil = 0; flashedUntil = 0; hitUntil = 0; penaltyUntil = 0;
      resetPose(node); node('core').style.opacity = '1';
      arena.removeAttribute('data-damaged');
      value.removeAttribute('data-penalty');
      value.textContent = '0%';
    }
    reset();
    arena.replaceChildren(art);
    return {
      prepare(attacks, player, time, label, selected, targeting, upgradesEnabled) {
        at = time;
        boss.render(player.boss, at, GUARD_WINDOW);
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
            actor = mountAttackActor(attack, upgradesEnabled, node);
            threats.set(attack.attackId, actor);
          }
          paintAttack(actor, attack, at);
        }
        return pending;
      },
      play(event) {
        if (event.type === 'hit') {
          hitUntil = at + 280;
          glitchAt(240, 240, 39, 'damage', schedule);
        } else if (event.type === 'worm_charge') {
          const [x, y] = lanePosition(event.dir, 157);
          glitchAt(x, y, 25, 'reveal', schedule);
        } else if (event.type === 'guard' || manualAttack(event)) {
          if (event.type === 'guard') breakAttack(threats.get(event.attackId), event, schedule);
          const strong = strongGuard(event);
          paintStrikePose(event.dir, strong, node, schedule);
          addEffect(event.dir, strong ? 'perfect' : 'guard', schedule);
          posedUntil = at + 170; flashedUntil = at + 65;
        } else if (event.type === 'miss') {
          addEffect(event.dir, 'miss', schedule);
          if (hasMissPenalty(event)) penaltyUntil = at + 240;
        }
      },
      finishFrame(pending) {
        for (const [id, actor] of threats) if (!pending.has(id)) {
          actor.node.remove(); actor.mirror?.remove(); actor.link?.remove(); threats.delete(id);
        }
        paintTimedEffects(particles, at);
        if (at >= posedUntil && node('fighter').dataset.pose !== 'idle') resetPose(node);
        if (at >= flashedUntil || reducedMotion.matches) node('fighter').dataset.flash = 'false';
        const damaged = at < hitUntil;
        const penalized = String(at < penaltyUntil);
        if (value.dataset.penalty !== penalized) value.setAttribute('data-penalty', penalized);
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
    if (options.upgradesEnabled) $('game-shell').setAttribute('data-duel-upgrades', '');
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
    localBoss = createBossScene($, $('arena'));
    localBoss.reset();
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
    localBoss.reset(); localBoss = null;
    $('game-shell').removeAttribute('data-duel-group');
    $('game-shell').removeAttribute('data-duel-upgrades');
    $('duel-opponent').hidden = true;
    $('duel-opponent').setAttribute('aria-labelledby', 'duel-opponent-name');
    $('duel-single-opponent').hidden = false; $('duel-opponent-group').hidden = true;
    $('duel-latency').hidden = true;
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
      const [choiceName, choiceAmount] = duelUpgradeText(choice);
      name.textContent = choiceName;
      amount.textContent = choiceAmount;
      button.append(key, name, amount);
      button.addEventListener('click', () => {
        if (!panel.hidden && panel.getAttribute('data-duel-offer') === offerId) config?.onUpgrade?.(offer.id, choice.id);
      });
      return button;
    }));
    panel.hidden = false;
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
    poseUntil = 0; flashUntil = 0; damagedUntil = 0; coreFlashUntil = 0; recoveryUntil = 0;
    shake = { at: 0, until: 0, power: 0 }; resetPose();
    localBoss.reset();
    for (const scene of rivals.values()) scene.reset();
  }
  function showHealing(amount) {
    recoveryUntil = clock + 700;
    setMessage(tr('Recovery −', '회복 −') + amount + '%p');
  }
  function render(state, ownId, at, options = {}) {
    if (!saved || !state) return;
    if (roundStart !== state.startAt) { clearRound(); roundStart = state.startAt; }
    clock = at; fxClock = at;
    const mine = state.players.find(player => player.id === ownId);
    const opponents = state.players.filter(player => player.id !== ownId);
    if (!mine || !opponents.length) return;
    const upgradesEnabled = state.mode === 'clash';
    const shell = $('game-shell');
    if (upgradesEnabled && shell.getAttribute('data-duel-upgrades') === null) shell.setAttribute('data-duel-upgrades', '');
    else if (!upgradesEnabled && shell.getAttribute('data-duel-upgrades') !== null) shell.removeAttribute('data-duel-upgrades');
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
    const targeting = !!config.onTarget && !eliminated && !state.boss && state.status === 'running';
    const groupLabel = targeting ? tr('Choose target', '공격 대상') : tr('Opponents', '상대');
    if ($('duel-opponents-label').textContent !== groupLabel) $('duel-opponents-label').textContent = groupLabel;
    const opponentLabel = (player, i) => (opponents.length === 1 ? options.opponentName : '') ||
      player.name || config.names.get(player.id) || tr('Opponent', '상대') + (opponents.length > 1 ? ' ' + (i + 1) : '');
    const rivalPending = opponents.map((player, i) => {
      const scene = rivals.get(player.id);
      return [scene, scene.prepare(state.attacks, player, at, opponentLabel(player, i), player.id === targetId && !player.eliminated, targeting, upgradesEnabled)];
    });
    localBoss.render(mine.boss, at, GUARD_WINDOW);
    paintBossHUD(mine.boss, at);
    const incoming = state.attacks.filter(attack => attack.to === ownId);
    for (const attack of incoming) {
      let actor = actors.get(attack.attackId);
      if (!actor) {
        actor = mountAttackActor(attack, upgradesEnabled, $);
        enemies.push(actor);
        actors.set(attack.attackId, actor);
      }
      paintAttack(actor, attack, at, true);
    }
    for (const event of state.events || []) {
      if (event.id <= lastEventId) continue;
      lastEventId = event.id;
      if (at - event.at > 1500) continue;
      const own = event.playerId === ownId;
      const bossAction = event.source === 'boss';
      rivals.get(event.playerId)?.play(event);
      if (event.type === 'guard' && own) {
        breakAttack(actors.get(event.attackId), event);
        const strong = strongGuard(event);
        const confirmsPrediction = prediction?.dir === event.dir && Math.abs(event.at - prediction.at) <= 350;
        if (!confirmsPrediction || fxClock >= poseUntil) strikePose(event.dir, strong);
        if (confirmsPrediction) prediction = null;
        addEffect(event.dir, strong ? 'perfect' : 'guard');
        shakeCamera(strong ? 2.4 : 1.4); playSound(bossAction ? 'boss-hit' : strong ? 'perfect' : 'guard'); guards++;
        if (event.healing > 0) showHealing(event.healing);
        else if (bossAction) setMessage(tr('Boss parry', '보스 패링'));
        else {
          const perfectText = mine.upgrades?.perfect_energy > 0 || mine.upgrades?.guard_energy > 0
            ? tr('Perfect', '정밀 패링') : tr('Perfect / +½ attack energy', '정밀 패링 / 공격 에너지 +½');
          setMessage(event.perfect ? perfectText : tr('Guarded / rival pressure reset', '방어 / 상대 연속 적중 초기화'));
        }
      } else if (own && manualAttack(event)) {
        strikePose(event.dir, false); addEffect(event.dir, 'guard'); playSound('guard');
        setMessage(tr('Attack sent ', '공격 전송 ') + arrow[event.dir]);
      } else if (event.type === 'attack' && own && event.source === 'mutation') {
        setMessage(tr('Extra virus', '추가 바이러스'));
      } else if (event.type === 'worm_charge' && own) {
        const [x, y] = lanePosition(event.dir, 157);
        glitchAt(x, y, 25, 'reveal');
        playSound('reveal');
        setMessage(tr('Worm charging', '웜 돌진 대기'), TYPES.worm.color);
      } else if (event.type === 'upgrade' && own) {
        setMessage(tr('Upgrade · ', '업그레이드 · ') + duelUpgradeText(event).join(' '));
      } else if (event.type === 'boss_start') {
        if (!eliminated) playSound('boss-warning');
      } else if (event.type === 'boss_phase' && own) {
        const sound = { reaction: 'boss-freeze', telegraph: 'reveal', retry: 'boss-fail', failed: 'boss-fail', finisher: 'boss-finish' }[event.phase];
        if (sound) playSound(sound);
      } else if (event.type === 'boss_repair' && own && event.healing > 0) {
        showHealing(event.healing);
      } else if (event.type === 'miss' && own) {
        addEffect(event.dir, 'miss'); playSound('miss');
        const penalized = hasMissPenalty(event);
        if (penalized) damageFeedback();
        const penalty = penalized ? ' / +' + event.damage + '%p' : '';
        const label = event.reason === 'wrong_sequence' ? tr('Wrong sequence', '순서 오류') : tr('Empty guard', '헛방어');
        setMessage(label + penalty, 'var(--pink)');
      } else if (event.type === 'hit') {
        if (own) { damageFeedback(true); coreFlashUntil = clock + 300; playSound('damage'); }
        if (own || event.from === ownId) {
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
    $('vulnerability-fill').dataset.recovering = String(clock < recoveryUntil);
    $('vulnerability').setAttribute('aria-valuenow', mine.vulnerability);
    $('vulnerability').setAttribute('aria-valuetext', mine.vulnerability + '%');
    $('score').textContent = guards; $('score-label').textContent = tr('Defenses', '방어');
    bestLabel().textContent = opponentLabel(opponents[0], 0); $('best').textContent = opponents[0].vulnerability + '%';
    $('run-label').textContent = tr('Duel', '듀얼') + (options.connection ? ' · ' + options.connection : '');
    const speed = (state.speedPercent ?? 0) + (mine.upgrades?.attack_speed ?? 0);
    const speedReadout = $('duel-speed');
    speedReadout.hidden = !Number.isFinite(state.speedPercent) && speed <= 0;
    if (!speedReadout.hidden) {
      const speedText = tr('Shot speed +', '공격 속도 +') + speed + '%';
      if (speedReadout.textContent !== speedText) speedReadout.textContent = speedText;
    }
    renderUpgrade(upgradesEnabled && state.status === 'running' && !eliminated && !state.boss ? mine.offer : null);
    const energy = Math.max(0, Math.min(3, options.energy === undefined ? mine.energy : options.energy));
    $('skill-fill').style.width = energy / 3 * 100 + '%';
    $('skill-meter').setAttribute('aria-valuenow', energy.toFixed(2));
    const bossLocked = !!state.boss;
    const attackCost = mine.attackCost ?? 1;
    $('skill').disabled = bossLocked || eliminated;
    $('skill').dataset.ready = String(!bossLocked && !eliminated && energy + 1e-9 >= attackCost);
    const skillHint = bossLocked ? tr('Boss round · parry only', '보스전 · 패링만 가능')
      : tr('Space: switch · Shift + direction: attack', 'Space: 전환 · Shift + 방향: 공격');
    if ($('skill-key').textContent !== skillHint) $('skill-key').textContent = skillHint;
    const discounted = !bossLocked && attackCost < 1;
    const energyText = tr('Attack energy ', '공격 에너지 ') + energy.toFixed(discounted ? 2 : 1) + ' / 3';
    $('skill-status').textContent = discounted
      ? energyText + tr(' · ' + attackCost.toFixed(2) + '/shot', ' · 공격당 ' + attackCost.toFixed(2))
      : energyText;
    if (options.stance) setStance(options.stance);
    updateEffects(); updateLaneStates(); $('core').style.opacity = clock < coreFlashUntil ? '.4' : '1';
    if (messageUntil && clock > messageUntil) { $('message').textContent = ''; messageUntil = 0; }
  }
  window.NeonDuelView = Object.freeze({
    mount, render, unmount, setMessage, banner, hideBanner, setStance, predictGuard, setLatency, setTarget,
    isMounted: () => !!saved
  });
})();
