(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NeonDuelBoss = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIRECTIONS = ['up', 'right', 'down', 'left'];
  const ATTEMPTS = { domain: 5, destroy: 4 };
  const REACTION_TIME = [0, 6000, 1800, 2000, 2200, 2400];
  const START_RADIUS = 205, TARGET_RADIUS = 104, CORE_RADIUS = 35;
  const PRESS_COOLDOWN = 90, PERFECT_WINDOW = 100;
  const PREVIEW_INTERVAL = 190, PREVIEW_DURATION = 300;
  const validTime = at => typeof at === 'number' && Number.isFinite(at);

  function createFight({ kind, seed, startAt } = {}) {
    if (kind !== 'domain' && kind !== 'destroy') throw new TypeError('Unknown duel boss.');
    if (!validTime(startAt)) throw new TypeError('Boss startAt must be a finite timestamp.');
    const randomSeed = Array.from(String(seed ?? 0)).reduce((hash, char) =>
      Math.imul(hash ^ char.codePointAt(0), 16777619), 2166136261) >>> 0;
    return {
      kind, phase: 'warning', phaseAt: startAt, phaseUntil: startAt + 1750,
      remaining: ATTEMPTS[kind], total: ATTEMPTS[kind], result: null,
      attacks: [], sequence: [], sequenceIndex: 0, preview: [], depth: 0,
      origin: null, nextDir: null, lastContact: null,
      randomSeed, nextAttackId: 1, lastDir: null, lastPress: {}
    };
  }

  function random(fight) {
    fight.randomSeed = (Math.imul(fight.randomSeed, 1664525) + 1013904223) >>> 0;
    return fight.randomSeed / 2 ** 32;
  }

  function direction(fight, exclude) {
    const choices = DIRECTIONS.filter(dir => dir !== exclude);
    return choices[Math.floor(random(fight) * choices.length)];
  }

  function setPhase(fight, phase, at, duration = null) {
    fight.phase = phase;
    fight.phaseAt = at;
    fight.phaseUntil = duration === null ? null : at + duration;
  }

  function destroyTravel(fight) {
    return 1500 - (ATTEMPTS.destroy - fight.remaining) * 200;
  }

  function addAttack(fight, dir, launchedAt, travel) {
    fight.attacks.push({
      id: `boss-${fight.nextAttackId++}`, dir, launchedAt,
      impactAt: launchedAt + travel, depth: fight.depth
    });
  }

  function startRound(fight, at, dir = direction(fight, fight.lastDir)) {
    fight.lastDir = dir;
    fight.nextDir = null;
    fight.depth = 0;
    fight.lastPress = {};
    fight.origin = null;
    fight.sequence = [];
    fight.sequenceIndex = 0;
    setPhase(fight, 'active', at);
    addAttack(fight, dir, at, fight.kind === 'domain' ? 1350 : destroyTravel(fight));
  }

  function startReaction(fight, dir, at) {
    const targets = DIRECTIONS.filter(target => target !== dir);
    const sequence = Array.from({ length: fight.remaining === 1 ? 3 : 1 }, () => targets).flat();
    for (let i = sequence.length - 1; i > 0; i--) {
      const j = Math.floor(random(fight) * (i + 1));
      [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
    }
    fight.origin = dir;
    fight.sequence = sequence;
    fight.sequenceIndex = 0;
    setPhase(fight, 'reaction', at, REACTION_TIME[fight.remaining]);
  }

  function previewWave(fight, at) {
    fight.depth++;
    let previous = fight.lastContact.dir;
    fight.preview = Array.from({ length: 2 ** fight.depth }, () => {
      previous = direction(fight, previous);
      return previous;
    });
    setPhase(fight, 'telegraph', at, fight.preview.length * PREVIEW_INTERVAL + 160);
  }

  function launchWave(fight, at) {
    const travel = destroyTravel(fight) * (fight.depth === 1 ? 0.62 : 0.48);
    const gap = 220 - (ATTEMPTS.destroy - fight.remaining) * 20;
    fight.preview.forEach((dir, index) => addAttack(fight, dir, at + index * gap, travel));
    fight.preview = [];
    fight.lastPress = {};
    setPhase(fight, 'active', at);
  }

  function clearRound(fight, at, effects) {
    fight.remaining--;
    const domain = fight.kind === 'domain';
    effects.push({ type: 'repair', at, amount: domain ? 5 : 20 });
    if (fight.remaining === 0) {
      fight.result = 'cleared';
      setPhase(fight, 'finisher', at, 1150);
    } else {
      fight.nextDir = direction(fight, fight.lastDir);
      setPhase(fight, 'rebound', at, domain ? 550 : 600);
    }
  }

  function coreAt(attack) {
    const travel = attack.impactAt - attack.launchedAt;
    return attack.impactAt + travel * (TARGET_RADIUS - CORE_RADIUS) / (START_RADIUS - TARGET_RADIUS);
  }

  function grace(ms) {
    return validTime(ms) ? Math.max(0, Math.min(120, ms)) : 0;
  }

  function nextAt(fight, guardGraceMs = 0) {
    if (fight.phase === 'active') return coreAt(fight.attacks[0]);
    if (fight.phase === 'reaction') return fight.phaseUntil + grace(guardGraceMs);
    return fight.phaseUntil ?? Infinity;
  }

  function escapeDomain(fight, at, effects, dir, attackId) {
    fight.attacks = [];
    fight.result = 'escaped';
    setPhase(fight, 'failed', at, 1000);
    effects.push({ type: 'damage', at, amount: fight.remaining * 20, dir, attackId, reason: 'domain_escape' });
  }

  function advance(fight, at, guardGraceMs = 0) {
    const effects = [];
    if (!validTime(at)) return effects;
    let due;
    while ((due = nextAt(fight, guardGraceMs)) <= at) {
      switch (fight.phase) {
        case 'warning':
        case 'retry':
          startRound(fight, due);
          break;
        case 'rebound':
          startRound(fight, due, fight.nextDir);
          break;
        case 'reaction':
          escapeDomain(fight, due, effects, fight.sequence[fight.sequenceIndex]);
          break;
        case 'telegraph':
          launchWave(fight, due);
          break;
        case 'active': {
          const { dir, depth, id } = fight.attacks[0];
          if (fight.kind === 'domain') {
            escapeDomain(fight, due, effects, dir, id);
          } else {
            fight.attacks = [];
            const amount = Math.round(275 * fight.remaining * (0.5 ** depth)) / 10;
            setPhase(fight, 'retry', due, 950);
            effects.push({ type: 'damage', at: due, amount, dir, attackId: id, depth, reason: 'fragment_missed' });
          }
          break;
        }
        case 'finisher':
        case 'failed':
          setPhase(fight, 'done', due);
          break;
      }
    }
    return effects;
  }

  function recordGuard(fight, effects, at, dir, radius, attackId, perfect, heavy) {
    fight.lastContact = { dir, radius };
    effects.push({ type: 'guard', at, dir, radius, attackId, perfect, heavy });
  }

  function miss(effects, at, dir, reason) {
    effects.push({ type: 'miss', at, dir, reason, amount: 4 });
    return { ok: true, effects };
  }

  function guard(fight, dir, at, guardAt = at, guardGraceMs = 0) {
    if (!validTime(at) || !validTime(guardAt) || !DIRECTIONS.includes(dir)) {
      return { ok: false, reason: 'invalid_guard', effects: [] };
    }
    const effects = advance(fight, at, guardGraceMs);
    guardAt = Math.max(at - grace(guardGraceMs), Math.min(at, guardAt));
    if ((fight.phase !== 'active' && fight.phase !== 'reaction') || guardAt < fight.phaseAt ||
        (fight.phase === 'reaction' && guardAt >= fight.phaseUntil)) {
      return { ok: false, reason: 'boss_inactive', effects };
    }
    if (at - (fight.lastPress[dir] ?? -Infinity) < PRESS_COOLDOWN) {
      return { ok: false, reason: 'guard_cooldown', effects };
    }
    fight.lastPress[dir] = at;

    if (fight.phase === 'reaction') {
      if (fight.sequence[fight.sequenceIndex] !== dir) return miss(effects, at, dir, 'wrong_sequence');
      fight.sequenceIndex++;
      recordGuard(fight, effects, at, dir, TARGET_RADIUS, `domain-${dir}`, true, true);
      if (fight.sequenceIndex === fight.sequence.length) clearRound(fight, at, effects);
      return { ok: true, effects };
    }

    let attack = null, closest = Infinity;
    for (const candidate of fight.attacks) {
      if (candidate.dir !== dir || guardAt < candidate.launchedAt) continue;
      const distance = Math.abs(guardAt - candidate.impactAt);
      const window = candidate.depth ? 160 : 360;
      if (distance <= window && distance < closest) {
        attack = candidate;
        closest = distance;
      }
    }
    if (!attack) return miss(effects, at, dir, 'empty_guard');
    fight.attacks.splice(fight.attacks.indexOf(attack), 1);
    const progress = (guardAt - attack.launchedAt) / (attack.impactAt - attack.launchedAt);
    const radius = START_RADIUS - (START_RADIUS - TARGET_RADIUS) * progress;
    recordGuard(fight, effects, at, dir, radius, attack.id, closest <= PERFECT_WINDOW, false);
    if (fight.kind === 'domain') startReaction(fight, dir, at);
    else if (fight.attacks.length === 0) {
      if (fight.depth < 2) previewWave(fight, at);
      else clearRound(fight, at, effects);
    }
    return { ok: true, effects };
  }

  function snapshot(fight) {
    const {
      kind, phase, phaseAt, phaseUntil, remaining, total, result, depth,
      origin, nextDir, lastContact, attacks, sequence, sequenceIndex, preview
    } = fight;
    return {
      kind, phase, phaseAt, phaseUntil, remaining, total, result, depth,
      origin, nextDir, lastContact: lastContact && { ...lastContact },
      attacks: attacks.map(attack => ({ ...attack })),
      sequence: [...sequence], sequenceIndex, preview: [...preview],
      previewInterval: PREVIEW_INTERVAL, previewDuration: PREVIEW_DURATION
    };
  }

  return Object.freeze({ createFight, nextAt, advance, guard, snapshot });
});
