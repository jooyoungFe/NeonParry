(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NeonDuelEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
    travelMs: 2200,
    arrivalGapMs: 520,
    guardWindowMs: 360,
    perfectWindowMs: 100,
    maxPendingPerPlayer: 12,
    maxEvents: 32,
    clashMaxPlayers: 8,
    clashMaxEvents: 96,
    waveDelayMs: 3500,
    waveIntervalMs: 3600,
    comboThreshold: 3,
    firstUpgradeMs: 8000,
    upgradeIntervalMs: 13000,
    speedStepMs: 1600,
    maxSpeedPercent: 25,
    maxGuardCompensationMs: 120
  });
  const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
  const WAVE_ORDER = ['virus', 'trojan', 'worm', 'ransom', 'phishing', 'ddos'];
  const MUTATIONS = ['trojan', 'worm', 'ransom', 'phishing', 'ddos'];
  const UPGRADE_CHOICES = {
    mutation: { min: 14, max: 24, cap: 60 },
    attack_speed: { min: 12, max: 22, cap: 45 },
    recharge: { min: 14, max: 24, cap: 100 },
    repair: { min: 14, max: 24 },
    perfect_energy: { min: 20, max: 40, cap: 100 }
  };
  const THREATS = {
    virus: { travelMs: RULES.travelMs, damage: 12 },
    trojan: { travelMs: 1800, damage: 16 },
    worm: { travelMs: 900, damage: 15 },
    ransom: { travelMs: 1250, damage: 24 },
    phishing: { travelMs: 1900, damage: 20 },
    ddos: { travelMs: 2200, damage: 18 },
    echo: { travelMs: 700, damage: 8 }
  };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const validTime = time => typeof time === 'number' && Number.isFinite(time);
  const opposite = dir => DIRECTIONS[(DIRECTIONS.indexOf(dir) + 2) % DIRECTIONS.length];
  const compensation = ms => validTime(ms) ? Math.max(0, Math.min(ms, RULES.maxGuardCompensationMs)) : 0;
  const findPlayer = (match, id) => match.players.find(player => player.id === id);
  const isRival = (player, candidate) => candidate && candidate !== player && !candidate.eliminated;
  const seedRandom = seed => Array.from(String(seed ?? 0)).reduce((hash, char) =>
    Math.imul(hash ^ char.codePointAt(0), 16777619), 2166136261) >>> 0;
  const speedPercentAt = (match, at) => Math.min(RULES.maxSpeedPercent, Math.max(0, Math.floor((at - match.startAt) / RULES.speedStepMs)));
  const travelAt = (match, kind, at, boost = 0) => Math.round(THREATS[kind].travelMs * 100 / (100 + speedPercentAt(match, at) + boost));

  function random(match, key) {
    match[key] = (Math.imul(match[key], 1664525) + 1013904223) >>> 0;
    return match[key] / 2 ** 32;
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
      waveIndex: 0,
      waveRandom: randomSeed,
      previousWaveDir: null,
      offerIndex: 0,
      offerRandom: randomSeed ^ 0x9e3779b9,
      mutationRandom: randomSeed ^ 0x85ebca6b,
      now: null,
      status: 'countdown',
      winnerId: null,
      finishedAt: null,
      finishReason: null,
      players: players.map((id, index) => ({
        id,
        vulnerability: 0,
        energy: RULES.energyStart,
        streak: 0,
        combo: 0,
        eliminated: false,
        targetId: players[(index + 1) % players.length],
        offer: null,
        upgrades: { mutation: 0, attack_speed: 0, recharge: 0, perfect_energy: 0 },
        lastAttackAt: -Infinity,
        lastGuardAt: Object.fromEntries(DIRECTIONS.map(dir => [dir, -Infinity])),
        lastArrivalAt: -Infinity,
        lastSeq: -1
      })),
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
    const from = Math.max(match.now, match.startAt);
    if (time > from && match.status !== 'finished') {
      const recharge = (time - from) / RULES.energyRechargeMs;
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
    for (const player of match.players) player.offer = null;
    event(match, 'finish', at, { winnerId, reason });
  }

  function eliminate(match, players, at, reason) {
    for (const player of players) {
      player.eliminated = true;
      player.combo = 0;
      player.targetId = null;
      player.offer = null;
      if (match.mode === 'clash') event(match, 'eliminate', at, { playerId: player.id, reason });
    }
    const survivors = match.players.filter(player => !player.eliminated);
    const eliminatedIds = new Set(players.map(player => player.id));
    for (const player of survivors) {
      if (eliminatedIds.has(player.targetId)) player.targetId = defaultTarget(match, player)?.id ?? null;
    }
    if (survivors.length <= 1) {
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

  function launch(match, from, to, dir, at, impactAt, kind, source, launchedAt = at) {
    // Reserved Clash arrivals can wait offscreen without slowing the flight.
    const attack = { attackId: match.nextAttackId++, from, to, dir, launchedAt, impactAt, state: 'pending', kind, source };
    if (kind === 'phishing') {
      attack.decoyDir = opposite(dir);
      attack.revealAt = impactAt - RULES.guardWindowMs;
    }
    match.attacks.push(attack);
    event(match, 'attack', at, { playerId: from, attackId: attack.attackId, to, dir, impactAt, kind, source });
    return attack;
  }

  const waveImpactAt = (match, index) => match.startAt + RULES.waveDelayMs + RULES.travelMs + index * RULES.waveIntervalMs;
  const waveKind = index => WAVE_ORDER[index % WAVE_ORDER.length];

  function waveLaunchAt(match) {
    const impactAt = waveImpactAt(match, match.waveIndex);
    const kind = waveKind(match.waveIndex);
    let launchAt = impactAt - THREATS[kind].travelMs;
    // Keep shared impact slots fixed while faster waves launch a little later.
    for (;;) {
      const adjusted = impactAt - travelAt(match, kind, launchAt);
      if (adjusted === launchAt) return launchAt;
      launchAt = adjusted;
    }
  }

  function launchWave(match, at) {
    const index = match.waveIndex++;
    const kind = waveKind(index);
    const dirs = DIRECTIONS.filter(dir => dir !== match.previousWaveDir);
    const dir = dirs[Math.floor(random(match, 'waveRandom') * dirs.length)];
    match.previousWaveDir = dir;
    const impactAt = waveImpactAt(match, index);
    for (const player of match.players) {
      if (!player.eliminated) launch(match, null, player.id, dir, at, impactAt, kind, 'wave');
    }
  }

  const nextOfferAt = match => match.startAt + RULES.firstUpgradeMs + match.offerIndex * RULES.upgradeIntervalMs;

  function offerUpgrades(match, at) {
    const id = `offer-${++match.offerIndex}`;
    const options = Object.entries(UPGRADE_CHOICES);
    const choices = Array.from({ length: 3 }, () => {
      const [[kind, { min, max }]] = options.splice(Math.floor(random(match, 'offerRandom') * options.length), 1);
      return { id: kind, kind, value: min + Math.floor(random(match, 'offerRandom') * (max - min + 1)) };
    });
    const eligible = match.players.filter(player => !player.eliminated && !player.offer);
    for (const player of eligible) player.offer = { id, choices };
    if (eligible.length) event(match, 'upgrade_offer', at, { offerId: id });
  }

  function reserveClashArrival(match, playerId, earliest) {
    let impactAt = earliest;
    const gap = RULES.arrivalGapMs;
    const firstWave = waveImpactAt(match, 0);
    const incoming = match.attacks.filter(attack => attack.to === playerId);
    // Reserve the neutral schedule before filling the gaps with player attacks.
    for (;;) {
      const nearestWave = firstWave + Math.max(0, Math.round((impactAt - firstWave) / RULES.waveIntervalMs)) * RULES.waveIntervalMs;
      if (Math.abs(nearestWave - impactAt) < gap) {
        impactAt = nearestWave + gap;
        continue;
      }
      const conflict = incoming.find(attack => Math.abs(attack.impactAt - impactAt) < gap);
      if (!conflict) return impactAt;
      impactAt = conflict.impactAt + gap;
    }
  }

  // The extra millisecond makes the original +/-360ms window inclusive for
  // integer server timestamps, independent of whether the tick or input ran first.
  const settlesAt = (match, attack) => attack.impactAt + RULES.guardWindowMs + 1 + match.guardGraceMs;

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
      const waveAt = match.mode === 'clash' ? waveLaunchAt(match) : Infinity;
      const offerAt = match.mode === 'clash' ? nextOfferAt(match) : Infinity;
      let nextHitAt = Infinity;
      for (const attack of match.attacks) nextHitAt = Math.min(nextHitAt, settlesAt(match, attack));
      const nextAt = Math.min(waveAt, offerAt, nextHitAt);
      if (nextAt > target) break;
      rechargeTo(match, nextAt);
      if (nextAt < nextHitAt) {
        if (offerAt === nextAt) offerUpgrades(match, nextAt);
        else launchWave(match, nextAt);
        continue;
      }
      const due = match.attacks.filter(attack => settlesAt(match, attack) === nextAt);
      match.attacks = match.attacks.filter(attack => settlesAt(match, attack) !== nextAt);
      for (const attack of due) {
        const attacker = findPlayer(match, attack.from);
        const defender = findPlayer(match, attack.to);
        const scoresStreak = attacker && attack.kind !== 'echo';
        const damage = scoresStreak ? Math.min(RULES.damageMax, RULES.damageBase + attacker.streak * RULES.damageStep) : THREATS[attack.kind].damage;
        if (scoresStreak) attacker.streak += 1;
        defender.vulnerability = Math.min(RULES.vulnerabilityMax, defender.vulnerability + damage);
        defender.combo = 0;
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
      const defeated = match.players.filter(player => !player.eliminated && player.vulnerability >= RULES.vulnerabilityMax);
      if (defeated.length) eliminate(match, defeated, nextAt, 'vulnerability');
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
    if (kind === 'repair') {
      value = Math.min(player.vulnerability, choice.value);
      player.vulnerability -= value;
    } else {
      value = Math.min(UPGRADE_CHOICES[kind].cap - player.upgrades[kind], choice.value);
      player.upgrades[kind] += value;
    }
    event(match, 'upgrade', at, { playerId: player.id, offerId: offer.id, choiceId: choice.id, kind, value });
    return { ok: true, kind, value };
  }

  function maybeMutate(match, player, primary, at) {
    const chance = player.upgrades.mutation;
    if (!chance || !hasRoomForAttack(match, primary.to) || random(match, 'mutationRandom') * 100 >= chance) return null;
    const kind = MUTATIONS[Math.floor(random(match, 'mutationRandom') * MUTATIONS.length)];
    const travel = travelAt(match, kind, at, player.upgrades.attack_speed);
    const earliest = Math.max(primary.impactAt + RULES.arrivalGapMs, at + travel);
    const impactAt = reserveClashArrival(match, primary.to, earliest);
    return launch(match, player.id, primary.to, primary.dir, at, impactAt, kind, 'mutation', impactAt - travel);
  }

  function applyCombo(match, player, guarded, at, perfect) {
    player.combo += perfect ? 2 : 1;
    if (player.combo < RULES.comboThreshold) return;
    player.combo -= RULES.comboThreshold;
    const incoming = match.attacks.filter(attack => attack.from !== null && attack.to === player.id && attack.impactAt >= at);
    incoming.sort((a, b) => a.impactAt - b.impactAt || a.attackId - b.attackId);
    const canceled = incoming[0];
    if (canceled) {
      match.attacks = match.attacks.filter(attack => attack !== canceled);
      event(match, 'cancel', at, { playerId: player.id, from: canceled.from, attackId: canceled.attackId, dir: canceled.dir, kind: canceled.kind });
    } else if (hasRoomForAttack(match, player.targetId)) {
      const kind = guarded.kind === 'echo' ? 'virus' : guarded.kind;
      const travel = travelAt(match, kind, at, player.upgrades.attack_speed);
      const impactAt = reserveClashArrival(match, player.targetId, at + travel);
      launch(match, player.id, player.targetId, guarded.dir, at, impactAt, kind, 'counter', impactAt - travel);
    }
  }

  function input(match, playerId, command, now, options) {
    if (!validTime(now)) return { ok: false, reason: 'invalid_time' };
    advance(match, now);
    if (match.status !== 'running') return { ok: false, reason: match.status };
    const player = findPlayer(match, playerId);
    if (!player) return { ok: false, reason: 'invalid_player' };
    if (player.eliminated) return { ok: false, reason: 'eliminated' };
    const selectingTarget = match.mode === 'clash' && command?.type === 'target';
    const selectingUpgrade = match.mode === 'clash' && command?.type === 'upgrade';
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
      if (player.energy + 1e-9 < RULES.attackCost) return { ok: false, reason: 'energy' };
      const override = findPlayer(match, command.targetId);
      const opponent = isRival(player, override) ? override : findPlayer(match, player.targetId);
      if (!hasRoomForAttack(match, opponent.id)) return { ok: false, reason: 'queue_full' };
      const travel = match.mode === 'clash' ? travelAt(match, 'virus', at, player.upgrades.attack_speed) : RULES.travelMs;
      const earliest = at + travel;
      const impactAt = match.mode === 'clash' ? reserveClashArrival(match, opponent.id, earliest) :
        Math.max(earliest, opponent.lastArrivalAt + RULES.arrivalGapMs);
      player.energy = Math.max(0, player.energy - RULES.attackCost);
      player.lastAttackAt = at;
      opponent.lastArrivalAt = impactAt;
      const launchedAt = match.mode === 'clash' ? impactAt - travel : at;
      const attack = launch(match, playerId, opponent.id, command.dir, at, impactAt, 'virus', 'manual', launchedAt);
      const mutation = match.mode === 'clash' ? maybeMutate(match, player, attack, at) : null;
      if (mutation) return { ok: true, attackId: attack.attackId, impactAt, mutationAttackId: mutation.attackId };
      return { ok: true, attackId: attack.attackId, impactAt };
    }

    // Preserve the original game's independent recovery for each direction.
    if (at - player.lastGuardAt[command.dir] < RULES.guardCooldownMs) return { ok: false, reason: 'cooldown' };
    player.lastGuardAt[command.dir] = at;
    // Only trusted host timing affects the accuracy check. Cooldown and all
    // state changes use receipt time and can never be moved back by the sender.
    const guardAt = Math.max(match.startAt, at - compensation(options?.guardDelayMs));
    const candidates = match.attacks.filter(attack => attack.to === playerId && attack.dir === command.dir &&
      attack.launchedAt <= guardAt && (attack.revealAt === undefined || attack.revealAt <= guardAt) &&
      Math.abs(attack.impactAt - guardAt) <= RULES.guardWindowMs);
    // Original parry() takes the first eligible enemy. Wider guard windows can
    // overlap, so guard the earlier arrival before a later shot in the same lane.
    candidates.sort((a, b) => a.impactAt - b.impactAt || a.attackId - b.attackId);
    const attack = candidates[0];
    if (!attack) {
      player.combo = 0;
      event(match, 'miss', at, { playerId, dir: command.dir });
      return { ok: true, guarded: false, perfect: false };
    }
    const perfect = Math.abs(attack.impactAt - guardAt) <= RULES.perfectWindowMs;
    match.attacks = match.attacks.filter(candidate => candidate.attackId !== attack.attackId);
    const attacker = findPlayer(match, attack.from);
    if (attacker) attacker.streak = 0;
    if (perfect) player.energy = Math.min(RULES.energyMax, player.energy + RULES.perfectEnergy * (1 + player.upgrades.perfect_energy / 100));
    event(match, 'guard', at, { playerId, attackId: attack.attackId, from: attack.from, dir: command.dir, kind: attack.kind, perfect });
    if (match.mode === 'clash') {
      if (attack.kind === 'trojan') {
        const travel = travelAt(match, 'echo', at, attacker?.upgrades.attack_speed);
        const earliest = Math.max(at + travel, attack.impactAt + RULES.arrivalGapMs);
        const impactAt = reserveClashArrival(match, playerId, earliest);
        launch(match, attack.from, playerId, opposite(attack.dir), at, impactAt, 'echo', attack.source, impactAt - travel);
      }
      applyCombo(match, player, attack, at, perfect);
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
    return { ok: true, winnerId: match.winnerId };
  }

  function snapshot(match, now) {
    advance(match, now);
    const isClash = match.mode === 'clash';
    return {
      now: match.now,
      mode: match.mode,
      startAt: match.startAt,
      status: match.status,
      winnerId: match.winnerId,
      finishedAt: match.finishedAt,
      finishReason: match.finishReason,
      ...(isClash && { speedPercent: speedPercentAt(match, match.finishedAt ?? match.now) }),
      rules: Object.assign({}, RULES),
      players: match.players.map(player => ({
        id: player.id,
        vulnerability: player.vulnerability,
        energy: player.energy,
        streak: player.streak,
        combo: player.combo,
        eliminated: player.eliminated,
        targetId: player.targetId,
        ...(isClash && {
          offer: player.offer && { id: player.offer.id, choices: player.offer.choices.map(choice => ({ ...choice })) },
          upgrades: { ...player.upgrades }
        })
      })),
      attacks: match.attacks.map(attack => Object.assign({}, attack)),
      events: match.events.map(entry => Object.assign({}, entry))
    };
  }

  return Object.freeze({ RULES, DIRECTIONS, createMatch, advance, input, forfeit, snapshot });
});
