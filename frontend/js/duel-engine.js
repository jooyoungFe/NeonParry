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
    maxEvents: 32
  });
  const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const validTime = time => typeof time === 'number' && Number.isFinite(time);

  function createMatch(options) {
    const { players, startAt = 0, seed = null } = options || {};
    if (!Array.isArray(players) || players.length !== 2 ||
        players.some(id => typeof id !== 'string' || id.length === 0) ||
        players[0] === players[1]) {
      throw new TypeError('A duel needs two distinct player IDs.');
    }
    if (!validTime(startAt)) throw new TypeError('startAt must be a finite timestamp.');
    return {
      startAt,
      seed,
      now: null,
      status: 'countdown',
      winnerId: null,
      finishedAt: null,
      finishReason: null,
      players: players.map(id => ({
        id,
        vulnerability: 0,
        energy: RULES.energyStart,
        streak: 0,
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
    if (match.events.length > RULES.maxEvents) {
      match.events.splice(0, match.events.length - RULES.maxEvents);
    }
    return entry;
  }

  function rechargeTo(match, time) {
    const from = Math.max(match.now, match.startAt);
    if (time > from && match.status !== 'finished') {
      const recharge = (time - from) / RULES.energyRechargeMs;
      for (const player of match.players) {
        player.energy = Math.min(RULES.energyMax, player.energy + recharge);
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
    event(match, 'finish', at, { winnerId, reason });
  }

  // The extra millisecond makes the original +/-360ms window inclusive for
  // integer server timestamps, independent of whether the tick or input ran first.
  const settlesAt = attack => attack.impactAt + RULES.guardWindowMs + 1;

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

    // Resolve chronologically even after a delayed tick. Both sides' attacks at
    // the same arrival time form one batch, allowing a fair simultaneous draw.
    while (match.attacks.length) {
      let nextAt = Infinity;
      for (const attack of match.attacks) nextAt = Math.min(nextAt, settlesAt(attack));
      if (nextAt > target) break;
      rechargeTo(match, nextAt);
      const due = match.attacks.filter(attack => settlesAt(attack) === nextAt);
      match.attacks = match.attacks.filter(attack => settlesAt(attack) !== nextAt);
      for (const attack of due) {
        const attacker = match.players.find(player => player.id === attack.from);
        const defender = match.players.find(player => player.id === attack.to);
        const damage = Math.min(RULES.damageMax, RULES.damageBase + attacker.streak * RULES.damageStep);
        attacker.streak += 1;
        defender.vulnerability = Math.min(RULES.vulnerabilityMax, defender.vulnerability + damage);
        event(match, 'hit', nextAt, {
          playerId: defender.id,
          from: attacker.id,
          attackId: attack.attackId,
          dir: attack.dir,
          damage,
          vulnerability: defender.vulnerability
        });
      }
      const defeated = match.players.filter(player => player.vulnerability >= RULES.vulnerabilityMax);
      if (defeated.length) {
        const winner = defeated.length === 2 ? null : match.players.find(player => player.id !== defeated[0].id).id;
        finish(match, nextAt, winner, defeated.length === 2 ? 'draw' : 'vulnerability');
        break;
      }
    }
    if (match.status === 'finished') match.now = target;
    else rechargeTo(match, target);
    return match;
  }

  function input(match, playerId, command, now) {
    if (!validTime(now)) return { ok: false, reason: 'invalid_time' };
    advance(match, now);
    if (match.status !== 'running') return { ok: false, reason: match.status };
    const player = match.players.find(candidate => candidate.id === playerId);
    if (!player) return { ok: false, reason: 'invalid_player' };
    if (!command || (command.type !== 'attack' && command.type !== 'guard')) {
      return { ok: false, reason: 'invalid_input' };
    }
    if (!DIRECTIONS.includes(command.dir)) return { ok: false, reason: 'invalid_direction' };
    if (own(command, 'seq')) {
      if (!Number.isSafeInteger(command.seq) || command.seq < 0) return { ok: false, reason: 'invalid_input' };
      if (command.seq <= player.lastSeq) return { ok: false, reason: 'duplicate' };
      player.lastSeq = command.seq;
    }
    const at = match.now;
    if (command.type === 'attack') {
      if (at - player.lastAttackAt < RULES.attackCooldownMs) return { ok: false, reason: 'cooldown' };
      if (player.energy + 1e-9 < RULES.attackCost) return { ok: false, reason: 'energy' };
      const opponent = match.players.find(candidate => candidate.id !== playerId);
      if (match.attacks.filter(attack => attack.to === opponent.id).length >= RULES.maxPendingPerPlayer) {
        return { ok: false, reason: 'queue_full' };
      }
      const impactAt = Math.max(at + RULES.travelMs, opponent.lastArrivalAt + RULES.arrivalGapMs);
      const attack = {
        attackId: match.nextAttackId++,
        from: playerId,
        to: opponent.id,
        dir: command.dir,
        launchedAt: at,
        impactAt,
        state: 'pending'
      };
      player.energy = Math.max(0, player.energy - RULES.attackCost);
      player.lastAttackAt = at;
      opponent.lastArrivalAt = impactAt;
      match.attacks.push(attack);
      event(match, 'attack', at, { playerId, attackId: attack.attackId, to: opponent.id, dir: command.dir, impactAt });
      return { ok: true, attackId: attack.attackId, impactAt };
    }

    // Preserve the original game's independent recovery for each direction.
    if (at - player.lastGuardAt[command.dir] < RULES.guardCooldownMs) return { ok: false, reason: 'cooldown' };
    player.lastGuardAt[command.dir] = at;
    const candidates = match.attacks.filter(attack => attack.to === playerId && attack.dir === command.dir &&
      Math.abs(attack.impactAt - at) <= RULES.guardWindowMs);
    // Original parry() takes the first eligible enemy. Wider guard windows can
    // overlap, so guard the earlier arrival before a later shot in the same lane.
    candidates.sort((a, b) => a.impactAt - b.impactAt || a.attackId - b.attackId);
    const attack = candidates[0];
    if (!attack) {
      event(match, 'miss', at, { playerId, dir: command.dir });
      return { ok: true, guarded: false, perfect: false };
    }
    const perfect = Math.abs(attack.impactAt - at) <= RULES.perfectWindowMs;
    match.attacks = match.attacks.filter(candidate => candidate.attackId !== attack.attackId);
    const attacker = match.players.find(candidate => candidate.id === attack.from);
    attacker.streak = 0;
    if (perfect) player.energy = Math.min(RULES.energyMax, player.energy + RULES.perfectEnergy);
    event(match, 'guard', at, { playerId, attackId: attack.attackId, from: attacker.id, dir: command.dir, perfect });
    return { ok: true, guarded: true, perfect, attackId: attack.attackId };
  }

  function forfeit(match, playerId, now) {
    if (!validTime(now)) return { ok: false, reason: 'invalid_time' };
    advance(match, now);
    if (match.status === 'finished') return { ok: false, reason: 'finished' };
    if (!match.players.some(player => player.id === playerId)) return { ok: false, reason: 'invalid_player' };
    const winnerId = match.players.find(player => player.id !== playerId).id;
    finish(match, match.now, winnerId, 'forfeit');
    return { ok: true, winnerId };
  }

  function snapshot(match, now) {
    advance(match, now);
    return {
      now: match.now,
      startAt: match.startAt,
      status: match.status,
      winnerId: match.winnerId,
      finishedAt: match.finishedAt,
      finishReason: match.finishReason,
      rules: Object.assign({}, RULES),
      players: match.players.map(player => ({
        id: player.id,
        vulnerability: player.vulnerability,
        energy: player.energy,
        streak: player.streak
      })),
      attacks: match.attacks.map(attack => Object.assign({}, attack)),
      events: match.events.map(entry => Object.assign({}, entry))
    };
  }

  return Object.freeze({ RULES, DIRECTIONS, createMatch, advance, input, forfeit, snapshot });
});
