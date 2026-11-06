(function (root, factory) {
  'use strict';
  const commonJS = typeof module === 'object' && module.exports;
  const api = factory(commonJS ? require('./duel-boss.js') : root.NeonDuelBoss);
  if (commonJS) module.exports = api;
  if (root) root.NeonDuelEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Boss) {
  'use strict';

  // One shared ruleset for the authoritative server and offline practice.
  // All timestamps are milliseconds on the host's clock; clients never choose
  // the time of an online input. A late guard is allowed before damage settles.
  const RULES = Object.freeze({
    vulnerabilityMax: 100,
    damageBase: 15,
    damageStep: 5,
    damageMax: 25,
    energyMax: 3,
    energyStart: 2,
    energyRechargeMs: 1800,
    attackCost: 1,
    perfectEnergy: 0.5,
    attackCooldownMs: 350,
    guardCooldownMs: 300,
    emptyGuardDamage: 4,
    bossIntervalMs: 60_000,
    travelMs: 2200,
    arrivalGapMs: 520,
    guardWindowMs: 360,
    perfectWindowMs: 100,
    maxPendingPerPlayer: 12,
    maxEvents: 32,
    clashMaxPlayers: 8,
    clashMaxEvents: 96,
    paceStepMs: 4000,
    paceEarlyDurationMs: 16000,
    paceLateStepMs: 12000,
    paceStepPercent: 15,
    paceMaxPercent: 150,
    rechargeStartRate: 1.25,
    rechargeStepRate: 0.25,
    rechargeStepMs: 20000,
    rechargeMaxRate: 2.5,
    minFlightMs: 550,
    firstUpgradeMs: 8000,
    upgradeIntervalMs: 12000,
    upgradeCap: 100,
    maxGuardCompensationMs: 120
  });
  const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
  const MUTATIONS = ['trojan', 'worm', 'ransom', 'phishing', 'ddos'];
  const UPGRADE_CHOICES = {
    mutation: { min: 14, max: 24, cap: 50 },
    attack_speed: { min: 12, max: 22 },
    recharge: { min: 14, max: 24 },
    repair: { min: 14, max: 24 },
    perfect_energy: { min: 20, max: 40 },
    attack_power: { min: 8, max: 16 },
    guard_energy: { min: 8, max: 16 },
    perfect_repair: { min: 10, max: 20 },
    attack_discount: { min: 8, max: 16 },
    damage_resistance: { min: 8, max: 16 },
    miss_resistance: { min: 12, max: 24 }
  };
  const PERSISTENT_UPGRADES = Object.keys(UPGRADE_CHOICES).filter(kind => kind !== 'repair');
  const upgradeCap = kind => UPGRADE_CHOICES[kind].cap ?? RULES.upgradeCap;
  const UPGRADE_CATALOG = Object.freeze(Object.fromEntries(
    Object.entries(UPGRADE_CHOICES).map(([kind, { min, max }]) =>
      [kind, Object.freeze({ min, max, cap: kind === 'repair' ? null : upgradeCap(kind) })])
  ));
  const attackCost = player => RULES.attackCost / (1 + (player.upgrades.attack_discount ?? 0) / 100);
  const ENEMY_TRAVEL = { virus: RULES.travelMs, trojan: 1800, worm: 900, ransom: 1250, phishing: 1900, ddos: 2200, echo: 700 };
  const ECHO_DAMAGE = 8;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const roundVulnerability = value => Math.round(value * 10) / 10;
  const validTime = time => typeof time === 'number' && Number.isFinite(time);
  const opposite = dir => DIRECTIONS[(DIRECTIONS.indexOf(dir) + 2) % DIRECTIONS.length];
  const compensation = ms => validTime(ms) ? Math.max(0, Math.min(ms, RULES.maxGuardCompensationMs)) : 0;
  const findPlayer = (match, id) => match.players.find(player => player.id === id);
  const isRival = (player, candidate) => candidate && candidate !== player && !candidate.eliminated;
  const seedRandom = seed => Array.from(String(seed ?? 0)).reduce((hash, char) =>
    Math.imul(hash ^ char.codePointAt(0), 16777619), 2166136261) >>> 0;
  function speedPercentAt(match, at) {
    if (match.mode !== 'clash' || at < match.startAt) return 0;
    const elapsed = at - match.startAt;
    const earlySteps = 1 + Math.floor(Math.min(elapsed, RULES.paceEarlyDurationMs) / RULES.paceStepMs);
    const lateSteps = Math.floor(Math.max(0, elapsed - RULES.paceEarlyDurationMs) / RULES.paceLateStepMs);
    return Math.min((earlySteps + lateSteps) * RULES.paceStepPercent, RULES.paceMaxPercent);
  }

  function rechargeRateAt(match, at) {
    if (match.mode !== 'clash' || at < match.startAt) return 1;
    let rate = RULES.rechargeStartRate;
    for (let step = 1; rate < RULES.rechargeMaxRate && at >= match.startAt + step * RULES.rechargeStepMs; step++) {
      rate += RULES.rechargeStepRate;
    }
    return rate;
  }

  function baseEnergyGain(match, from, to) {
    let cursor = Math.max(from, match.startAt);
    if (!(to > cursor)) return 0;
    if (match.mode !== 'clash') return (to - cursor) / RULES.energyRechargeMs;
    let weightedMs = 0;
    let rate = RULES.rechargeStartRate;
    for (let step = 1; rate < RULES.rechargeMaxRate && cursor < to; step++, rate += RULES.rechargeStepRate) {
      const end = Math.min(to, match.startAt + step * RULES.rechargeStepMs);
      if (end <= cursor) continue;
      weightedMs += (end - cursor) * rate;
      cursor = end;
    }
    return (weightedMs + (to - cursor) * rate) / RULES.energyRechargeMs;
  }

  function travelFor(match, kind, player, at) {
    const speed = speedPercentAt(match, at) + player.upgrades.attack_speed;
    return Math.max(RULES.minFlightMs, Math.round(ENEMY_TRAVEL[kind] * 100 / (100 + speed)));
  }

  function random(state, key) {
    state[key] = (Math.imul(state[key], 1664525) + 1013904223) >>> 0;
    return state[key] / 2 ** 32;
  }

  function createMatch(options) {
    const { players, startAt = 0, seed = null, mode = 'classic', guardGraceMs = 0 } = options || {};
    if (mode !== 'classic' && mode !== 'clash') throw new TypeError('Unknown duel mode.');
    const maxPlayers = mode === 'clash' ? RULES.clashMaxPlayers : 2;
    if (!Array.isArray(players) || players.length < 2 || players.length > maxPlayers ||
        [...players].some(id => typeof id !== 'string' || id.length === 0) ||
        new Set(players).size !== players.length) {
      throw new TypeError(mode === 'classic' ? 'A duel needs two distinct player IDs.' : 'Clash needs 2–8 distinct player IDs.');
    }
    if (!validTime(startAt) || (mode === 'clash' && Math.abs(startAt) > Number.MAX_SAFE_INTEGER)) {
      throw new TypeError('startAt must be a finite timestamp in milliseconds.');
    }
    const randomSeed = mode === 'clash' ? seedRandom(seed) : 0;
    return {
      mode,
      startAt,
      seed,
      guardGraceMs: compensation(guardGraceMs),
      boss: null,
      bossNumber: 0,
      nextBossAt: mode === 'clash' ? startAt + RULES.bossIntervalMs : Infinity,
      mutationRandom: randomSeed ^ 0x85ebca6b,
      now: null,
      status: 'countdown',
      winnerId: null,
      finishedAt: null,
      finishReason: null,
      players: players.map((id, index) => {
        const playerSeed = seedRandom(JSON.stringify([randomSeed, id, index]));
        return {
          id,
          vulnerability: 0,
          energy: RULES.energyStart,
          streak: 0,
          eliminated: false,
          boss: null,
          targetId: players[(index + 1) % players.length],
          offer: null,
          offerIndex: 0,
          offerRandom: playerSeed,
          perfectRepairRandom: playerSeed ^ 0x9e3779b9,
          nextOfferAt: mode === 'clash' ? startAt + RULES.firstUpgradeMs : Infinity,
          upgrades: Object.fromEntries(PERSISTENT_UPGRADES.map(kind => [kind, 0])),
          lastAttackAt: -Infinity,
          lastGuardAt: Object.fromEntries(DIRECTIONS.map(dir => [dir, -Infinity])),
          lastArrivalAt: -Infinity,
          lastSeq: -1
        };
      }),
      attacks: [],
      events: [],
      nextAttackId: 1,
      nextEventId: 1
    };
  }

  function event(match, type, at, details) {
    const entry = Object.assign({ id: match.nextEventId++, at, type }, details);
    match.events.push(entry);
    const limit = match.mode === 'clash' ? RULES.clashMaxEvents : RULES.maxEvents;
    if (match.events.length > limit) {
      match.events.splice(0, match.events.length - limit);
    }
    return entry;
  }

  function rechargeTo(match, time) {
    const recharge = baseEnergyGain(match, match.now, time);
    if (recharge > 0 && match.status !== 'finished') {
      for (const player of match.players) {
        if (!player.eliminated) player.energy = Math.min(RULES.energyMax, player.energy + recharge * (1 + player.upgrades.recharge / 100));
      }
    }
    match.now = time;
  }

  function finish(match, at, winnerId, reason) {
    match.status = 'finished';
    match.winnerId = winnerId;
    match.finishedAt = at;
    match.finishReason = reason;
    match.attacks.length = 0;
    match.boss = null;
    for (const player of match.players) {
      player.offer = null;
      player.boss = null;
    }
    event(match, 'finish', at, { winnerId, reason });
  }

  function eliminate(match, players, at, reason) {
    for (const player of players) {
      player.eliminated = true;
      player.targetId = null;
      player.offer = null;
      player.nextOfferAt = Infinity;
      player.boss = null;
      if (match.mode === 'clash') event(match, 'eliminate', at, { playerId: player.id, reason });
    }
    const survivors = match.players.filter(player => !player.eliminated);
    const eliminatedIds = new Set(players.map(player => player.id));
    for (const player of survivors) {
      if (eliminatedIds.has(player.targetId)) player.targetId = defaultTarget(match, player)?.id ?? null;
    }
    if (!survivors.length || (survivors.length === 1 && !match.boss)) {
      finish(match, at, survivors[0]?.id ?? null, survivors.length ? reason : 'draw');
      return;
    }
    match.attacks = match.attacks.filter(attack => !eliminatedIds.has(attack.from) && !eliminatedIds.has(attack.to));
  }

  function defaultTarget(match, player) {
    const index = match.players.indexOf(player);
    const ordered = match.players.slice(index + 1).concat(match.players.slice(0, index));
    return ordered.find(candidate => !candidate.eliminated);
  }

  function launch(match, from, to, dir, at, impactAt, kind, source, launchedAt = at, traits = {}) {
    // Reserved Clash arrivals can wait offscreen without slowing the flight.
    const attack = { attackId: match.nextAttackId++, from, to, dir, launchedAt, impactAt, state: 'pending', kind, source, ...traits };
    if (kind === 'phishing') {
      attack.decoyDir = opposite(dir);
      attack.revealAt = impactAt - RULES.guardWindowMs;
    }
    match.attacks.push(attack);
    event(match, 'attack', at, { playerId: from, attackId: attack.attackId, to, dir, impactAt, kind, source });
    return attack;
  }

  function offerUpgrades(match, at) {
    for (const player of match.players) {
      if (player.nextOfferAt !== at) continue;
      const id = `offer-${++player.offerIndex}`;
      const options = Object.keys(UPGRADE_CHOICES).filter(kind => kind === 'repair' || player.upgrades[kind] < upgradeCap(kind));
      const choices = Array.from({ length: Math.min(3, options.length) }, () => {
        const [kind] = options.splice(Math.floor(random(player, 'offerRandom') * options.length), 1);
        const range = UPGRADE_CHOICES[kind];
        const max = kind === 'repair' ? range.max : Math.min(range.max, upgradeCap(kind) - player.upgrades[kind]);
        const min = Math.min(range.min, max);
        return { id: kind, kind, value: min + Math.floor(random(player, 'offerRandom') * (max - min + 1)) };
      });
      player.offer = { id, choices };
      player.nextOfferAt = Infinity;
      event(match, 'upgrade_offer', at, { playerId: player.id, offerId: id });
    }
  }

  function reserveArrival(player, earliest) {
    player.lastArrivalAt = Math.max(earliest, player.lastArrivalAt + RULES.arrivalGapMs);
    return player.lastArrivalAt;
  }

  // The extra millisecond makes the original +/-360ms window inclusive for
  // integer server timestamps, independent of whether the tick or input ran first.
  const settlesAt = (match, attack) => attack.state === 'dormant'
    ? Infinity : attack.impactAt + RULES.guardWindowMs + 1 + match.guardGraceMs;

  function startBoss(match, at) {
    const kind = match.bossNumber++ % 2 === 0 ? 'domain' : 'destroy';
    const seed = seedRandom(JSON.stringify([match.seed, match.bossNumber]));
    match.boss = { kind, startedAt: at, pausedAttacks: match.attacks };
    match.attacks = [];
    for (const player of match.players) {
      if (!player.eliminated) player.boss = Boss.createFight({ kind, seed, startAt: at });
    }
    event(match, 'boss_start', at, { kind });
  }

  function resumeAfterBoss(match, at) {
    if (!match.boss || match.status === 'finished') return;
    const survivors = match.players.filter(player => !player.eliminated);
    if (survivors.some(player => player.boss.phase !== 'done')) return;
    if (survivors.length <= 1) {
      finish(match, at, survivors[0]?.id ?? null, survivors.length ? 'vulnerability' : 'draw');
      return;
    }
    const { kind, startedAt, pausedAttacks } = match.boss;
    const elapsed = at - startedAt;
    const alive = new Set(survivors.map(player => player.id));
    match.attacks = pausedAttacks.filter(attack => alive.has(attack.from) && alive.has(attack.to));
    for (const attack of match.attacks) {
      for (const field of ['launchedAt', 'impactAt', 'revealAt', 'hopAt']) {
        if (Number.isFinite(attack[field])) attack[field] += elapsed;
      }
    }
    for (const player of survivors) {
      player.boss = null;
      player.lastArrivalAt += elapsed;
      player.nextOfferAt += elapsed;
    }
    match.boss = null;
    match.nextBossAt = at + RULES.bossIntervalMs;
    event(match, 'boss_end', at, { kind });
  }

  function nextBossTransition(match) {
    if (!match.boss) return match.nextBossAt;
    let nextAt = Infinity;
    for (const player of match.players) {
      if (player.boss) nextAt = Math.min(nextAt, Boss.nextAt(player.boss, match.guardGraceMs));
    }
    return nextAt;
  }

  function applyBossEffects(match, player, effects, at) {
    let defeated = false;
    for (const effect of effects) {
      const { type, amount, dir, attackId, perfect, radius, heavy, reason } = effect;
      const details = { playerId: player.id, source: 'boss', kind: player.boss.kind, dir, attackId, perfect, radius, heavy, reason };
      if (type === 'damage' || type === 'miss') {
        const vulnerability = roundVulnerability(player.vulnerability + amount);
        // Solo bosses allow survival at exactly 100%. The next point is lethal.
        defeated ||= vulnerability > RULES.vulnerabilityMax;
        player.vulnerability = Math.min(RULES.vulnerabilityMax, vulnerability);
        event(match, type === 'damage' ? 'hit' : 'miss', at, {
          ...details, damage: amount, vulnerability: player.vulnerability
        });
      } else if (type === 'repair') {
        const healing = Math.min(player.vulnerability, amount);
        player.vulnerability = roundVulnerability(player.vulnerability - healing);
        event(match, 'boss_repair', at, { ...details, healing });
      } else if (type === 'guard') {
        event(match, 'guard', at, details);
      }
    }
    return defeated;
  }

  function reportBossPhase(match, player, previous, at) {
    const { phase, result } = player.boss;
    if (phase === previous) return;
    if (phase === 'done') event(match, 'boss_done', at, { playerId: player.id, cleared: result === 'cleared' });
    else event(match, 'boss_phase', at, { playerId: player.id, phase });
  }

  function advanceBoss(match, at) {
    if (!match.boss) {
      startBoss(match, at);
      return;
    }
    const defeated = [];
    for (const player of match.players) {
      if (!player.boss || Boss.nextAt(player.boss, match.guardGraceMs) > at) continue;
      const phase = player.boss.phase;
      const effects = Boss.advance(player.boss, at, match.guardGraceMs);
      if (applyBossEffects(match, player, effects, at)) defeated.push(player);
      else reportBossPhase(match, player, phase, at);
    }
    if (defeated.length) eliminate(match, defeated, at, 'vulnerability');
    resumeAfterBoss(match, at);
  }

  function advance(match, now) {
    if (!validTime(now)) throw new TypeError('now must be a finite timestamp.');
    if (match.now === null) match.now = Math.min(match.startAt, now);
    const target = Math.max(now, match.now);
    if (match.status === 'finished') {
      match.now = target;
      return match;
    }
    if (target < match.startAt) {
      match.now = target;
      return match;
    }
    match.status = 'running';

    // Resolve chronologically even after a delayed tick. All hits with the
    // same settlement time form one batch before eliminating anyone.
    while (match.status === 'running') {
      let offerAt = Infinity;
      if (!match.boss) {
        for (const player of match.players) offerAt = Math.min(offerAt, player.nextOfferAt);
      }
      let nextHitAt = Infinity;
      for (const attack of match.attacks) nextHitAt = Math.min(nextHitAt, settlesAt(match, attack));
      const bossAt = nextBossTransition(match);
      const nextAt = Math.min(offerAt, nextHitAt, bossAt);
      if (nextAt > target) break;
      rechargeTo(match, nextAt);
      if (nextAt < nextHitAt) {
        if (nextAt === bossAt) advanceBoss(match, nextAt);
        else offerUpgrades(match, nextAt);
        continue;
      }
      const due = match.attacks.filter(attack => settlesAt(match, attack) === nextAt);
      match.attacks = match.attacks.filter(attack => settlesAt(match, attack) !== nextAt);
      const defeated = new Set();
      for (const attack of due) {
        const attacker = findPlayer(match, attack.from);
        const defender = findPlayer(match, attack.to);
        const scoresStreak = attack.kind !== 'echo';
        const streakDamage = Math.min(RULES.damageMax, RULES.damageBase + attacker.streak * RULES.damageStep);
        const baseDamage = attack.kind === 'worm' ? 30 : attack.kind === 'phishing' ? 40 : scoresStreak ? streakDamage : ECHO_DAMAGE;
        const power = 1 + (attacker.upgrades.attack_power ?? 0) / 100;
        const armor = 1 + (defender.upgrades.damage_resistance ?? 0) / 100;
        const damage = Math.round(baseDamage * power / armor);
        if (scoresStreak) attacker.streak += 1;
        defender.vulnerability = Math.min(RULES.vulnerabilityMax, roundVulnerability(defender.vulnerability + damage));
        if (defender.vulnerability === RULES.vulnerabilityMax) defeated.add(defender);
        event(match, 'hit', nextAt, {
          playerId: defender.id,
          from: attack.from,
          attackId: attack.attackId,
          dir: attack.dir,
          kind: attack.kind,
          damage,
          vulnerability: defender.vulnerability
        });
      }
      if (defeated.size) eliminate(match, [...defeated], nextAt, 'vulnerability');
    }
    if (match.status === 'finished') match.now = target;
    else rechargeTo(match, target);
    return match;
  }

  const hasRoomForAttack = (match, playerId) =>
    match.attacks.filter(attack => attack.to === playerId).length < RULES.maxPendingPerPlayer;

  function applyUpgrade(match, player, command, at) {
    const offer = player.offer;
    if (!offer || offer.id !== command.offerId) return { ok: false, reason: 'invalid_offer' };
    const choice = offer.choices.find(candidate => candidate.id === command.choiceId);
    if (!choice) return { ok: false, reason: 'invalid_choice' };
    const { kind } = choice;
    let value;
    player.offer = null;
    player.nextOfferAt = at + RULES.upgradeIntervalMs;
    if (kind === 'repair') {
      value = Math.min(player.vulnerability, choice.value);
      player.vulnerability = roundVulnerability(player.vulnerability - value);
    } else {
      value = Math.min(Math.max(0, upgradeCap(kind) - player.upgrades[kind]), choice.value);
      player.upgrades[kind] += value;
    }
    event(match, 'upgrade', at, { playerId: player.id, offerId: offer.id, choiceId: choice.id, kind, value });
    return { ok: true, kind, value };
  }

  function maybeMutate(match, player, opponent, primary, at) {
    const chance = Math.min(upgradeCap('mutation'), player.upgrades.mutation);
    if (!chance || !hasRoomForAttack(match, primary.to) || random(match, 'mutationRandom') * 100 >= chance) return null;
    const kind = MUTATIONS[Math.floor(random(match, 'mutationRandom') * MUTATIONS.length)];
    if (kind === 'worm') {
      const occupied = match.attacks.some(attack =>
        attack.kind === 'worm' && attack.state === 'dormant' && attack.to === primary.to && attack.dir === primary.dir);
      if (occupied) return null;
      const remaining = 2 + Math.floor(random(match, 'mutationRandom') * 2);
      return launch(match, player.id, primary.to, primary.dir, at, null, kind, 'mutation', at, {
        state: 'dormant', remaining
      });
    }
    const travel = travelFor(match, kind, player, at);
    const impactAt = reserveArrival(opponent, at + travel);
    const dir = kind === 'phishing' ? opposite(primary.dir) : primary.dir;
    return launch(match, player.id, primary.to, dir, at, impactAt, kind, 'mutation', impactAt - travel);
  }

  function tickWorms(match, defender, dir, at) {
    for (const attack of match.attacks) {
      if (attack.kind !== 'worm' || attack.state !== 'dormant' || attack.to !== defender.id || attack.dir !== dir) continue;
      attack.remaining -= 1;
      if (attack.remaining > 0) continue;
      const owner = findPlayer(match, attack.from);
      const travel = travelFor(match, 'worm', owner, at);
      attack.impactAt = reserveArrival(defender, at + 200 + travel);
      attack.launchedAt = attack.impactAt - travel;
      attack.hopAt = at;
      attack.state = 'pending';
      event(match, 'worm_charge', at, { playerId: defender.id, attackId: attack.attackId, dir });
    }
  }

  function input(match, playerId, command, now, options) {
    if (!validTime(now)) return { ok: false, reason: 'invalid_time' };
    advance(match, now);
    if (match.status !== 'running') return { ok: false, reason: match.status };
    const player = findPlayer(match, playerId);
    if (!player) return { ok: false, reason: 'invalid_player' };
    if (player.eliminated) return { ok: false, reason: 'eliminated' };
    const isClash = match.mode === 'clash';
    const selectingTarget = isClash && command?.type === 'target';
    const selectingUpgrade = isClash && command?.type === 'upgrade';
    if (!selectingTarget && !selectingUpgrade && command?.type !== 'attack' && command?.type !== 'guard') {
      return { ok: false, reason: 'invalid_input' };
    }
    if (!selectingTarget && !selectingUpgrade && !DIRECTIONS.includes(command.dir)) return { ok: false, reason: 'invalid_direction' };
    if (own(command, 'seq')) {
      if (!Number.isSafeInteger(command.seq) || command.seq < 0) return { ok: false, reason: 'invalid_input' };
      if (command.seq <= player.lastSeq) return { ok: false, reason: 'duplicate' };
      player.lastSeq = command.seq;
    }
    const at = match.now;
    const guardAt = Math.max(match.startAt, at - compensation(options?.guardDelayMs));
    if (match.boss) {
      if (command.type !== 'guard') return { ok: false, reason: 'boss_active' };
      if (player.boss.phase === 'done') return { ok: false, reason: 'boss_waiting' };
      const phase = player.boss.phase;
      const result = Boss.guard(player.boss, command.dir, at, guardAt, match.guardGraceMs);
      if (applyBossEffects(match, player, result.effects, at)) {
        eliminate(match, [player], at, 'vulnerability');
        resumeAfterBoss(match, at);
      } else reportBossPhase(match, player, phase, at);
      if (!result.ok) return { ok: false, reason: result.reason };
      const parry = result.effects.find(effect => effect.type === 'guard');
      return { ok: true, guarded: !!parry, perfect: !!parry?.perfect };
    }
    if (selectingUpgrade) return applyUpgrade(match, player, command, at);
    if (selectingTarget) {
      const target = findPlayer(match, command.targetId);
      if (!isRival(player, target)) return { ok: false, reason: 'invalid_target' };
      if (player.targetId !== target.id) {
        player.targetId = target.id;
        event(match, 'target', at, { playerId, targetId: target.id });
      }
      return { ok: true, targetId: target.id };
    }
    if (command.type === 'attack') {
      if (at - player.lastAttackAt < RULES.attackCooldownMs) return { ok: false, reason: 'cooldown' };
      const cost = attackCost(player);
      if (player.energy + 1e-9 < cost) return { ok: false, reason: 'energy' };
      const override = findPlayer(match, command.targetId);
      const opponent = isRival(player, override) ? override : findPlayer(match, player.targetId);
      if (!hasRoomForAttack(match, opponent.id)) return { ok: false, reason: 'queue_full' };
      const travel = travelFor(match, 'virus', player, at);
      const impactAt = reserveArrival(opponent, at + travel);
      player.energy = Math.max(0, player.energy - cost);
      player.lastAttackAt = at;
      const launchedAt = isClash ? impactAt - travel : at;
      const attack = launch(match, playerId, opponent.id, command.dir, at, impactAt, 'virus', 'manual', launchedAt);
      const mutation = isClash ? maybeMutate(match, player, opponent, attack, at) : null;
      if (mutation) return { ok: true, attackId: attack.attackId, impactAt, mutationAttackId: mutation.attackId };
      return { ok: true, attackId: attack.attackId, impactAt };
    }

    // Preserve the original game's independent recovery for each direction.
    if (at - player.lastGuardAt[command.dir] < RULES.guardCooldownMs) return { ok: false, reason: 'cooldown' };
    player.lastGuardAt[command.dir] = at;
    // Cooldown and state use receipt time. Only parry accuracy is compensated.
    const candidates = match.attacks.filter(attack => attack.state !== 'dormant' && attack.to === playerId && attack.dir === command.dir &&
      attack.launchedAt <= guardAt && (attack.revealAt === undefined || attack.revealAt <= guardAt) &&
      Math.abs(attack.impactAt - guardAt) <= RULES.guardWindowMs);
    // Original parry() takes the first eligible enemy. Wider guard windows can
    // overlap, so guard the earlier arrival before a later shot in the same lane.
    candidates.sort((a, b) => a.impactAt - b.impactAt || a.attackId - b.attackId);
    const attack = candidates[0];
    if (!attack) {
      const damage = isClash ? roundVulnerability(RULES.emptyGuardDamage * (1 - (player.upgrades.miss_resistance ?? 0) / 100)) : 0;
      if (damage) player.vulnerability = Math.min(RULES.vulnerabilityMax, roundVulnerability(player.vulnerability + damage));
      event(match, 'miss', at, {
        playerId,
        dir: command.dir,
        ...(isClash && { damage, vulnerability: player.vulnerability })
      });
      if (damage && player.vulnerability === RULES.vulnerabilityMax) eliminate(match, [player], at, 'vulnerability');
      return { ok: true, guarded: false, perfect: false };
    }
    const perfect = Math.abs(attack.impactAt - guardAt) <= RULES.perfectWindowMs;
    match.attacks = match.attacks.filter(candidate => candidate.attackId !== attack.attackId);
    const attacker = findPlayer(match, attack.from);
    attacker.streak = 0;
    const perfectEnergy = perfect ? RULES.perfectEnergy * (1 + player.upgrades.perfect_energy / 100) : 0;
    player.energy = Math.min(RULES.energyMax, player.energy + perfectEnergy + (player.upgrades.guard_energy ?? 0) / 100);
    const repairChance = player.upgrades.perfect_repair ?? 0;
    const repair = perfect && repairChance && random(player, 'perfectRepairRandom') * 100 < repairChance ? 4 : 0;
    const healing = Math.min(player.vulnerability, repair + (perfect && attack.kind === 'worm' ? 20 : 0));
    player.vulnerability = roundVulnerability(player.vulnerability - healing);
    event(match, 'guard', at, { playerId, attackId: attack.attackId, from: attack.from, dir: command.dir, kind: attack.kind, perfect, ...(healing && { healing }) });
    tickWorms(match, player, command.dir, at);
    if (attack.kind === 'trojan') {
      const travel = travelFor(match, 'echo', attacker, at);
      const impactAt = reserveArrival(player, at + travel);
      launch(match, attack.from, playerId, opposite(attack.dir), at, impactAt, 'echo', attack.source, impactAt - travel);
    }
    return { ok: true, guarded: true, perfect, attackId: attack.attackId };
  }

  function forfeit(match, playerId, now) {
    if (!validTime(now)) return { ok: false, reason: 'invalid_time' };
    advance(match, now);
    if (match.status === 'finished') return { ok: false, reason: 'finished' };
    const player = findPlayer(match, playerId);
    if (!player) return { ok: false, reason: 'invalid_player' };
    if (player.eliminated) return { ok: false, reason: 'eliminated' };
    eliminate(match, [player], match.now, 'forfeit');
    resumeAfterBoss(match, match.now);
    return { ok: true, winnerId: match.winnerId };
  }

  function snapshot(match, now) {
    advance(match, now);
    const isClash = match.mode === 'clash';
    const at = match.finishedAt ?? match.now;
    return {
      now: match.now,
      mode: match.mode,
      startAt: match.startAt,
      status: match.status,
      winnerId: match.winnerId,
      finishedAt: match.finishedAt,
      finishReason: match.finishReason,
      ...(isClash && {
        speedPercent: speedPercentAt(match, at),
        rechargeRate: rechargeRateAt(match, at),
        boss: match.boss && { kind: match.boss.kind, startedAt: match.boss.startedAt },
        nextBossAt: match.boss || match.status === 'finished' ? null : match.nextBossAt
      }),
      rules: Object.assign({}, RULES),
      players: match.players.map(player => ({
        id: player.id,
        vulnerability: player.vulnerability,
        energy: player.energy,
        streak: player.streak,
        eliminated: player.eliminated,
        targetId: player.targetId,
        ...(isClash && {
          attackCost: attackCost(player),
          offer: player.offer && { id: player.offer.id, choices: player.offer.choices.map(choice => ({ ...choice })) },
          upgrades: { ...player.upgrades },
          boss: player.boss && Boss.snapshot(player.boss)
        })
      })),
      attacks: match.attacks.map(attack => Object.assign({}, attack)),
      events: match.events.map(entry => Object.assign({}, entry))
    };
  }

  return Object.freeze({ RULES, DIRECTIONS, UPGRADE_CATALOG, createMatch, advance, input, forfeit, snapshot, baseEnergyGain });
});
