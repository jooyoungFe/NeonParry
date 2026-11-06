'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../frontend/js/duel-engine.js');
const { createHarness } = require('./game-harness.cjs');
const match = (startAt = 0) => E.createMatch({ players: ['a', 'b'], startAt });
const attack = (m, id, dir, at) => E.input(m, id, { type: 'attack', dir }, at);
const guard = (m, id, dir, at) => E.input(m, id, { type: 'guard', dir }, at);
const player = (m, id) => m.players.find(p => p.id === id);
const lastEvent = (m, type) => m.events.filter(event => event.type === type).at(-1);
const settled = at => at + E.RULES.travelMs + E.RULES.guardWindowMs + 1;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('same engine runs as a browser global without CommonJS', () => {
  const sandbox = {};
  for (const file of ['duel-boss.js', 'duel-engine.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js', file), 'utf8'), sandbox);
  }
  assert.equal(typeof sandbox.NeonDuelEngine.createMatch, 'function');
  assert.equal(sandbox.NeonDuelEngine.RULES.vulnerabilityMax, 100);
});

test('duel timing and empty guard damage stay aligned with the original game', () => {
  const game = createHarness({ 'neon-parry-sound': 'off' });
  const original = game.plain('({guardWindowMs:RUN_DIFFICULTIES.easy.guard,perfectWindowMs:RUN_DIFFICULTIES.easy.perfect,guardCooldownMs:RUN_DIFFICULTIES.easy.cooldown,travelMs:TYPES.virus.travel,arrivalGapMs:MIN_ARRIVAL_GAP,emptyGuardDamage:MISINPUT_DAMAGE})');
  assert.deepEqual(original, { guardWindowMs: 360, perfectWindowMs: 100, guardCooldownMs: 300, travelMs: 2200, arrivalGapMs: 520, emptyGuardDamage: 4 });
  for (const [key, value] of Object.entries(original)) assert.equal(E.RULES[key], value, key);
});

test('countdown blocks input and recharge; balanced defense has no time limit', () => {
  const m = match(10_000);
  assert.equal(attack(m, 'a', 'up', 0).reason, 'countdown');
  assert.equal(E.snapshot(m, 9_999).status, 'countdown');
  assert.equal(player(m, 'a').energy, 2);
  assert.equal(E.snapshot(m, 10_000).status, 'running');
  assert.equal(player(m, 'a').energy, 2);
  const afterAnHour = E.snapshot(m, 3_610_000);
  assert.equal(afterAnHour.status, 'running');
  assert.equal(afterAnHour.winnerId, null);
  assert.equal(afterAnHour.players[0].energy, 3);
  assert.equal(afterAnHour.players[0].vulnerability, 0);
});

test('successive unguarded hits do 15,20,25 damage and finish a dominant match in five hits', () => {
  const m = match();
  const damages = [];
  for (let n = 0; n < 5; n++) {
    const at = n * settled(0);
    assert.equal(attack(m, 'a', 'up', at).ok, true);
    E.advance(m, settled(at));
    damages.push(lastEvent(m, 'hit').damage);
  }
  assert.deepEqual(damages, [15, 20, 25, 25, 25]);
  assert.equal(player(m, 'b').vulnerability, 100);
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, 'a');
  assert.equal(m.attacks.length, 0);
  assert.equal(attack(m, 'a', 'up', 20_000).reason, 'finished');
});

test('any successful defense breaks the attacker streak without healing the defender', () => {
  const m = match();
  attack(m, 'a', 'up', 0);
  E.advance(m, settled(0));
  assert.equal(player(m, 'a').streak, 1);
  attack(m, 'a', 'left', 3_000);
  const result = guard(m, 'b', 'left', 5_000);
  assert.equal(result.guarded, true);
  assert.equal(result.perfect, false);
  assert.equal(player(m, 'a').streak, 0);
  assert.equal(player(m, 'b').vulnerability, 15);
  attack(m, 'a', 'right', 6_000);
  E.advance(m, settled(6_000));
  assert.equal(lastEvent(m, 'hit').damage, 15);
  assert.equal(player(m, 'b').vulnerability, 30);
});

test('normal guards accept both window boundaries, but reject just outside them', () => {
  for (const offset of [-360, 360]) {
    const m = match();
    attack(m, 'a', 'down', 0);
    E.advance(m, E.RULES.travelMs + offset);
    const result = guard(m, 'b', 'down', E.RULES.travelMs + offset);
    assert.equal(result.guarded, true, `offset ${offset}`);
    assert.equal(result.perfect, false);
    E.advance(m, settled(0));
    assert.equal(player(m, 'b').vulnerability, 0);
  }
  const early = match();
  attack(early, 'a', 'down', 0);
  assert.equal(guard(early, 'b', 'down', E.RULES.travelMs - E.RULES.guardWindowMs - 1).guarded, false);
  E.advance(early, settled(0));
  assert.equal(player(early, 'b').vulnerability, 15);
  const late = match();
  attack(late, 'a', 'down', 0);
  assert.equal(guard(late, 'b', 'down', settled(0)).guarded, false);
  assert.equal(player(late, 'b').vulnerability, 15);
});

test('perfect window rewards half an energy, normal guards do not', () => {
  for (const offset of [-100, 100, -101, 101]) {
    const m = match();
    attack(m, 'a', 'up', 0);
    attack(m, 'b', 'down', 0);
    const at = E.RULES.travelMs + offset;
    const result = guard(m, 'b', 'up', at);
    assert.equal(result.guarded, true);
    const perfect = Math.abs(offset) <= 100;
    assert.equal(result.perfect, perfect);
    close(player(m, 'b').energy, 1 + at / 1_800 + (perfect ? 0.5 : 0));
    assert.equal(lastEvent(m, 'guard').perfect, perfect);
  }
});

test('legacy Classic misses recover per direction without self-damage', () => {
  const m = match();
  attack(m, 'a', 'up', 0);
  assert.equal(guard(m, 'b', 'left', 2_000).guarded, false);
  assert.equal(guard(m, 'b', 'left', 2_299).reason, 'cooldown');
  assert.equal(guard(m, 'b', 'up', 2_299).guarded, true);
  assert.equal(guard(m, 'b', 'up', 2_299).reason, 'cooldown');
  assert.equal(guard(m, 'b', 'right', 2_299).guarded, false);
  assert.equal(player(m, 'b').vulnerability, 0);
  assert.equal(guard(m, 'b', 'left', 2_300).guarded, false);
  assert.equal(player(m, 'b').vulnerability, 0);
  assert.equal(guard(m, 'a', 'left', 2_300).guarded, false);
  assert.equal(player(m, 'a').vulnerability, 0);
  assert.equal(lastEvent(m, 'miss').damage, undefined);
});

test('duel perfect guards keep existing vulnerability instead of applying solo healing', () => {
  const m = match();
  player(m, 'b').vulnerability = 40;
  attack(m, 'a', 'up', 0);
  assert.equal(guard(m, 'b', 'up', E.RULES.travelMs).perfect, true);
  assert.equal(player(m, 'b').vulnerability, 40);
});

test('energy limits attacks, recharges continuously, caps at three and starts at two', () => {
  const m = match();
  assert.equal(attack(m, 'a', 'up', 0).ok, true);
  assert.equal(attack(m, 'a', 'up', 349).reason, 'cooldown');
  assert.equal(attack(m, 'a', 'right', 350).ok, true);
  assert.equal(attack(m, 'a', 'left', 700).reason, 'energy');
  close(player(m, 'a').energy, 700 / 1_800);
  assert.equal(attack(m, 'a', 'left', 1_800).ok, true);
  E.advance(m, 10_000);
  assert.equal(player(m, 'a').energy, 3);
  assert.equal(player(m, 'b').energy, 3);
});

test('burst attacks are spaced across every lane and every arrival is guardable', () => {
  const m = match();
  player(m, 'a').energy = E.RULES.energyMax;
  for (const [i, dir] of ['up', 'right', 'down'].entries()) {
    assert.equal(attack(m, 'a', dir, i * 350).ok, true);
  }
  assert.deepEqual(m.attacks.map(a => a.impactAt), [2_200, 2_720, 3_240]);
  for (const shot of [...m.attacks]) {
    assert.ok(shot.impactAt - shot.launchedAt >= E.RULES.travelMs);
    assert.equal(guard(m, 'b', shot.dir, shot.impactAt).guarded, true);
  }
  E.advance(m, 4_000);
  assert.equal(player(m, 'b').vulnerability, 0);
  assert.equal(m.attacks.length, 0);
});

test('overlapping original guard windows select the earlier same-lane shot first', () => {
  const m = match();
  attack(m, 'a', 'up', 0);
  attack(m, 'a', 'up', E.RULES.attackCooldownMs);
  const [first, second] = [...m.attacks];
  assert.equal(second.impactAt - first.impactAt, E.RULES.arrivalGapMs);
  const firstGuardAt = first.impactAt + 280;
  assert.equal(guard(m, 'b', 'up', firstGuardAt).attackId, first.attackId);
  assert.equal(guard(m, 'b', 'up', firstGuardAt + E.RULES.guardCooldownMs).attackId, second.attackId);
  E.advance(m, settled(E.RULES.attackCooldownMs + E.RULES.arrivalGapMs));
  assert.equal(player(m, 'b').vulnerability, 0);
});

test('an opponent cannot reset the attack cooldown by changing lanes', () => {
  const m = match();
  attack(m, 'a', 'up', 0);
  assert.equal(attack(m, 'a', 'down', 1).reason, 'cooldown');
  assert.equal(m.attacks.length, 1);
});

test('same-time lethal hits produce a draw, including after a long server tick', () => {
  const m = match();
  player(m, 'a').vulnerability = 90;
  player(m, 'b').vulnerability = 90;
  attack(m, 'a', 'up', 0);
  attack(m, 'b', 'right', 0);
  E.advance(m, 10_000);
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, null);
  assert.equal(m.finishReason, 'draw');
  assert.equal(m.finishedAt, settled(0));
  assert.equal(player(m, 'a').vulnerability, 100);
  assert.equal(player(m, 'b').vulnerability, 100);
  assert.equal(m.events.filter(event => event.type === 'hit').length, 2);
  close(player(m, 'a').energy, 1 + settled(0) / 1_800);
});

test('earlier lethal hit finishes before later incoming damage is applied', () => {
  const m = match();
  player(m, 'a').vulnerability = 90;
  player(m, 'b').vulnerability = 90;
  attack(m, 'a', 'up', 0);
  attack(m, 'b', 'right', 1);
  E.advance(m, 10_000);
  assert.equal(m.winnerId, 'a');
  assert.equal(player(m, 'a').vulnerability, 90);
});

test('invalid inputs and duplicate sequences cannot create attacks or spend energy', () => {
  const m = match();
  assert.equal(attack(m, 'unknown', 'up', 0).reason, 'invalid_player');
  assert.equal(attack(m, 'a', '__proto__', 0).reason, 'invalid_direction');
  assert.equal(E.input(m, 'a', { type: 'win', dir: 'up' }, 0).reason, 'invalid_input');
  assert.equal(E.input(m, 'a', { type: 'attack', dir: 'up', seq: -1 }, 0).reason, 'invalid_input');
  assert.equal(E.input(m, 'a', { type: 'attack', dir: 'up', seq: 4 }, 0).ok, true);
  assert.equal(E.input(m, 'a', { type: 'attack', dir: 'left', seq: 4 }, 350).reason, 'duplicate');
  assert.equal(m.attacks.length, 1);
  close(player(m, 'a').energy, 1 + 350 / 1_800);
});

test('snapshots are serializable copies, events stay bounded, and time never rewinds', () => {
  const m = match();
  for (let n = 0; n < 100; n++) guard(m, 'a', 'up', n * E.RULES.guardCooldownMs);
  const before = m.now;
  const state = E.snapshot(m, 0);
  assert.equal(state.now, before);
  assert.equal(state.events.length, E.RULES.maxEvents);
  assert.doesNotThrow(() => JSON.stringify(state));
  state.players[0].vulnerability = 100;
  state.events[0].type = 'changed';
  state.rules.energyMax = 999;
  assert.equal(player(m, 'a').vulnerability, 0);
  assert.notEqual(m.events[0].type, 'changed');
  assert.equal(E.RULES.energyMax, 3);
});

test('forfeit handles countdown and running matches through the shared finish path', () => {
  for (const startAt of [0, 3_000]) {
    const m = match(startAt);
    assert.equal(E.forfeit(m, 'unknown', 0).reason, 'invalid_player');
    assert.deepEqual(E.forfeit(m, 'a', 0), { ok: true, winnerId: 'b' });
    assert.equal(m.status, 'finished');
    assert.equal(m.finishReason, 'forfeit');
    assert.equal(lastEvent(m, 'finish').winnerId, 'b');
    assert.equal(E.forfeit(m, 'a', 0).reason, 'finished');
  }
});

const clash = (players = ['a', 'b'], options = {}) => E.createMatch({ mode: 'clash', players, ...options });
const fasterTravel = (base, boost) => Math.round(base * 100 / (100 + boost));
const firstUpgrade = E.RULES.firstUpgradeMs;
const choose = (m, id, choiceId, at = firstUpgrade, offerId = 'offer-1') =>
  E.input(m, id, { type: 'upgrade', offerId, choiceId }, at);

function offerUpgrade(m, id, kind, at = firstUpgrade) {
  E.advance(m, at - 1);
  const recipient = player(m, id);
  const saved = { ...recipient.upgrades };
  for (const other of Object.keys(saved)) {
    if (other !== kind) recipient.upgrades[other] = other === 'mutation' ? 50 : 100;
  }
  E.advance(m, at);
  Object.assign(recipient.upgrades, saved);
  return recipient.offer.choices.find(choice => choice.kind === kind);
}

test('Clash damages only the player whose accepted guard misses', () => {
  const m = clash();
  const { impactAt } = attack(m, 'a', 'up', 0);
  const defend = (dir, at, seq) => E.input(m, 'b', { type: 'guard', dir, seq }, at);
  assert.equal(player(m, 'a').vulnerability, 0);

  const early = impactAt - E.RULES.guardWindowMs - 1;
  assert.deepEqual(defend('up', early, 2), { ok: true, guarded: false, perfect: false });
  assert.equal(player(m, 'b').vulnerability, 4);
  assert.equal(defend('left', impactAt, 3).guarded, false);
  assert.equal(defend('down', impactAt, 3).reason, 'duplicate');
  assert.equal(defend('right', impactAt, 2).reason, 'duplicate');
  assert.equal(defend('left', impactAt + 1, 4).reason, 'cooldown');
  assert.equal(defend('up', impactAt + 1, 5).perfect, true);
  assert.equal(attack(m, 'b', 'down', impactAt + 1).ok, true);

  assert.equal(player(m, 'a').vulnerability, 0);
  assert.equal(player(m, 'b').vulnerability, 8);
  assert.deepEqual(m.events.filter(event => event.type === 'miss').map(({ playerId, dir, damage, vulnerability }) => ({ playerId, dir, damage, vulnerability })), [
    { playerId: 'b', dir: 'up', damage: 4, vulnerability: 4 },
    { playerId: 'b', dir: 'left', damage: 4, vulnerability: 8 }
  ]);
});

test('a lethal empty guard eliminates its player and the last survivor wins', () => {
  const m = clash(['a', 'b', 'c', 'd']);
  assert.equal(attack(m, 'a', 'up', 0).ok, true);
  assert.equal(attack(m, 'b', 'down', 0).ok, true);
  player(m, 'b').vulnerability = 96;
  assert.equal(guard(m, 'b', 'left', 0).guarded, false);
  assert.deepEqual(m.events.slice(-2).map(event => event.type), ['miss', 'eliminate']);
  assert.equal(lastEvent(m, 'miss').vulnerability, 100);
  assert.equal(lastEvent(m, 'eliminate').playerId, 'b');
  assert.equal(m.status, 'running');
  assert.equal(m.players.filter(p => !p.eliminated).length, 3);
  assert.equal(m.attacks.length, 0);
  assert.equal(player(m, 'a').targetId, 'c');
  assert.equal(guard(m, 'b', 'right', 1).reason, 'eliminated');

  assert.equal(E.forfeit(m, 'd', 10).ok, true);
  player(m, 'c').vulnerability = 98;
  assert.equal(guard(m, 'c', 'left', 20).guarded, false);
  const result = E.snapshot(m, 20);
  assert.equal(result.status, 'finished');
  assert.equal(result.finishedAt, 20);
  assert.equal(result.finishReason, 'vulnerability');
  assert.equal(result.winnerId, 'a');
  assert.equal(player(m, 'c').vulnerability, 100);
  assert.deepEqual(m.events.slice(-3).map(event => event.type), ['miss', 'eliminate', 'finish']);
});

test('eight idle Clash players see no automatic rival attacks before the first boss', () => {
  const roster = Array.from({ length: 8 }, (_, index) => `p${index}`);
  assert.throws(() => E.createMatch({ players: roster }), /two distinct/);
  assert.throws(() => clash([...roster, 'p8']), /2–8 distinct/);
  assert.throws(() => clash(['a', 'b', 'a']), /2–8 distinct/);
  assert.throws(() => clash(['a', , 'c']), /2–8 distinct/);
  const startAt = 3_000;
  const m = clash(roster, { startAt, seed: 'example' });
  assert.equal(E.snapshot(m, startAt - 1).status, 'countdown');
  const now = startAt + E.RULES.bossIntervalMs - 1;
  const idle = E.snapshot(m, now);
  assert.equal(idle.mode, 'clash');
  assert.equal(idle.status, 'running');
  assert.equal(idle.endsAt, undefined);
  assert.equal(idle.finishedAt, null);
  assert.equal(idle.speedPercent, 120);
  assert.equal(idle.rechargeRate, 1.75);
  assert.equal(idle.attacks.length, 0);
  assert.equal(idle.players.every(p => p.vulnerability === 0 && !p.eliminated), true);
  assert.equal(idle.players.every(p => p.offer.id === 'offer-1'), true);
  assert.deepEqual(idle.events.map(event => [event.type, event.playerId, event.offerId]),
    roster.map(id => ['upgrade_offer', id, 'offer-1']));
  assert.equal(attack(m, roster[0], 'up', now).impactAt, now + 1000);
});

test('clash targets persist across attack overrides and retarget when a rival leaves', () => {
  const m = clash(['a', 'b', 'c']);
  assert.equal(E.snapshot(m, 0).players[0].targetId, 'b');
  assert.equal(E.input(m, 'a', { type: 'target', targetId: 'a' }, 0).reason, 'invalid_target');
  assert.deepEqual(E.input(m, 'a', { type: 'target', targetId: 'c' }, 0), { ok: true, targetId: 'c' });
  assert.equal(lastEvent(m, 'target').targetId, 'c');
  const override = E.input(m, 'a', { type: 'attack', dir: 'down', targetId: 'b' }, 0);
  const direct = attack(m, 'a', 'right', E.RULES.attackCooldownMs);
  assert.equal(m.attacks.find(shot => shot.attackId === override.attackId).to, 'b');
  assert.equal(m.attacks.find(shot => shot.attackId === direct.attackId).to, 'c');
  assert.equal(player(m, 'a').targetId, 'c');
  assert.equal(attack(m, 'c', 'left', 400).ok, true);
  assert.deepEqual(E.forfeit(m, 'c', 410), { ok: true, winnerId: null });
  assert.equal(m.status, 'running');
  assert.equal(lastEvent(m, 'eliminate').playerId, 'c');
  assert.equal(player(m, 'a').targetId, 'b');
  assert.equal(player(m, 'c').eliminated, true);
  assert.equal(m.attacks.some(shot => shot.from === 'c' || shot.to === 'c'), false);
  assert.equal(attack(m, 'c', 'left', 420).reason, 'eliminated');

  assert.equal(guard(m, 'b', 'down', override.impactAt).guarded, true);
  player(m, 'b').vulnerability = 99;
  assert.equal(attack(m, 'a', 'up', override.impactAt).ok, true);
  const result = E.snapshot(m, 10_000);
  assert.equal(result.status, 'finished');
  assert.equal(result.winnerId, 'a');
  assert.equal(result.players[0].targetId, null);
  assert.equal(result.players[1].eliminated, true);
  assert.equal(lastEvent(m, 'eliminate').reason, 'vulnerability');
});

test('faster Clash Virus flights preserve attack cooldowns, energy, and relative guard timing', () => {
  const m = clash();
  const travel = fasterTravel(2200, 15);
  assert.equal(attack(m, 'a', 'up', 0).impactAt, travel);
  assert.equal(attack(m, 'a', 'right', 349).reason, 'cooldown');
  assert.equal(attack(m, 'a', 'right', 350).impactAt, travel + 520);
  assert.equal(attack(m, 'a', 'left', 700).reason, 'energy');
  close(player(m, 'a').energy, 700 * 1.25 / 1800);
  assert.ok(m.attacks.every(shot => shot.impactAt - shot.launchedAt === travel && shot.kind === 'virus' && shot.source === 'manual'));
  const early = travel - 360;
  assert.equal(guard(m, 'b', 'up', early).guarded, true);
  assert.equal(guard(m, 'b', 'up', early + 299).reason, 'cooldown');
  assert.equal(guard(m, 'b', 'right', travel + 520 + 100).perfect, true);
  assert.equal(m.attacks.length, 0);
});

test('unupgraded clash retains classic damage and per-defender arrival spacing with multiple attackers', () => {
  const m = clash(['a', 'b', 'c', 'd']);
  const shots = ['a', 'c', 'd'].map(id => E.input(m, id, { type: 'attack', dir: 'up', targetId: 'b' }, 0));
  assert.deepEqual(shots.map(shot => shot.impactAt), [1913, 2433, 2953]);
  assert.deepEqual(m.attacks.map(shot => shot.launchedAt), [0, 520, 1040]);
  assert.ok(m.events.every(event => event.at === 0));

  const duel = clash();
  const damages = [];
  for (let n = 0; n < 5; n++) {
    const at = n * settled(0);
    assert.equal(attack(duel, 'a', 'up', at).ok, true);
    E.advance(duel, settled(at));
    damages.push(lastEvent(duel, 'hit').damage);
  }
  assert.deepEqual(damages, [15, 20, 25, 25, 25]);
  assert.equal(duel.winnerId, 'a');
  assert.equal(duel.finishReason, 'vulnerability');
});

test('Clash pace rises quickly at first, reaches 150% late, and preserves earlier shots in flight', () => {
  const startAt = 2000;
  const m = clash(['a', 'b', 'c'], { startAt });
  m.nextBossAt = Infinity; // Isolate ordinary duel timing from boss intermissions.
  assert.equal(E.snapshot(m, startAt - 1).speedPercent, 0);
  assert.equal(E.snapshot(m, startAt).speedPercent, 15);
  const old = attack(m, 'a', 'up', startAt + 3500);
  assert.equal(old.impactAt - startAt - 3500, fasterTravel(2200, 15));
  assert.equal(E.snapshot(m, startAt + 3999).speedPercent, 15);
  assert.equal(E.snapshot(m, startAt + 4000).speedPercent, 30);
  const next = attack(m, 'b', 'up', startAt + 4000);
  assert.equal(next.impactAt - startAt - 4000, fasterTravel(2200, 30));
  assert.equal(m.attacks.find(shot => shot.attackId === old.attackId).impactAt, old.impactAt);
  for (const [elapsed, speed] of [[8000, 45], [12000, 60], [16000, 75], [27999, 75], [28000, 90], [40000, 105], [52000, 120], [64000, 135], [75999, 135], [76000, 150], [120000, 150]]) {
    assert.equal(E.snapshot(m, startAt + elapsed).speedPercent, speed);
  }
  assert.equal(attack(m, 'a', 'up', startAt + 120_000).impactAt, startAt + 120_000 + 880);
});

test('Clash recharge grows in twenty-second steps and lets players sustain a faster late burst', () => {
  const startAt = 3000;
  const m = clash(['a', 'b'], { startAt });
  m.nextBossAt = Infinity; // Isolate ordinary duel timing from boss intermissions.
  assert.equal(E.snapshot(m, startAt - 1).rechargeRate, 1);
  for (const [elapsed, rate] of [[0, 1.25], [19999, 1.25], [20000, 1.5], [40000, 1.75], [60000, 2], [80000, 2.25], [100000, 2.5], [120000, 2.5]]) {
    assert.equal(E.snapshot(m, startAt + elapsed).rechargeRate, rate);
  }
  const startBurst = startAt + 120_000;
  for (let shot = 0; shot < 4; shot++) assert.equal(attack(m, 'a', 'up', startBurst + shot * 350).ok, true);
  assert.deepEqual(m.attacks.map(shot => shot.impactAt), [880, 1400, 1920, 2440].map(at => startBurst + at));
  assert.equal(attack(m, 'a', 'up', startBurst + 1400).reason, 'energy');
});

test('projected and authoritative recharge agree across a pace boundary and stack with a selected upgrade', () => {
  const startAt = 1250.5;
  const m = clash(['a', 'b'], { startAt });
  const offerAt = startAt + firstUpgrade;
  const recharge = offerUpgrade(m, 'a', 'recharge', offerAt);
  const { value } = choose(m, 'a', recharge.id, offerAt);
  assert.ok(value > 0);
  const from = startAt + 19600;
  const to = startAt + 20400;
  assert.equal(attack(m, 'a', 'up', from).ok, true);
  assert.equal(attack(m, 'b', 'right', from).ok, true);
  const snapshot = E.snapshot(m, from);
  const expected = (400 * 1.25 + 400 * 1.5) / E.RULES.energyRechargeMs;
  close(E.baseEnergyGain(snapshot, from, to), expected);
  close(E.baseEnergyGain(snapshot, startAt - 400, startAt + 400), 400 * 1.25 / E.RULES.energyRechargeMs);
  close(E.baseEnergyGain(snapshot, startAt + 19600, startAt + 40400), (400 * 1.25 + 20_000 * 1.5 + 400 * 1.75) / E.RULES.energyRechargeMs);
  close(E.baseEnergyGain({ mode: 'classic', startAt }, from, to), 800 / E.RULES.energyRechargeMs);
  assert.equal(E.baseEnergyGain(snapshot, to, from), 0);
  E.advance(m, to);
  close(player(m, 'a').energy, 2 + expected * (1 + value / 100));
  close(player(m, 'b').energy, 2 + expected);
});

test('attacks and compensated guards still work past five minutes, and a later knockout ends the match', () => {
  const m = clash(['a', 'b'], { guardGraceMs: 120 });
  m.nextBossAt = Infinity; // Isolate ordinary duel timing from boss intermissions.
  const oldLimit = 300_000;
  const inbound = attack(m, 'b', 'up', oldLimit - 400);
  assert.equal(E.snapshot(m, oldLimit).status, 'running');
  assert.equal(E.input(m, 'a', { type: 'guard', dir: 'up' }, inbound.impactAt + 440, { guardDelayMs: 120 }).guarded, true);
  player(m, 'b').vulnerability = 90;
  const knockout = attack(m, 'a', 'down', oldLimit + 1000);
  const settleAt = knockout.impactAt + E.RULES.guardWindowMs + 121;
  const result = E.snapshot(m, settleAt);
  assert.equal(result.winnerId, 'a');
  assert.equal(result.finishedAt, settleAt);
  assert.equal(result.finishReason, 'vulnerability');
});

test('trusted guard delay and optional settlement grace are capped, and command-supplied timing is ignored', () => {
  const guardAt = E.RULES.travelMs + E.RULES.guardWindowMs + 120;
  const online = () => E.createMatch({ players: ['a', 'b'], guardGraceMs: 1000 });
  const m = online();
  attack(m, 'a', 'up', 0);
  assert.equal(E.input(m, 'b', { type: 'guard', dir: 'up' }, guardAt, { guardDelayMs: 1000 }).guarded, true);
  assert.equal(lastEvent(m, 'guard').at, guardAt);
  assert.equal(guard(m, 'b', 'up', guardAt + E.RULES.guardCooldownMs - 1).reason, 'cooldown');

  const untrusted = online();
  attack(untrusted, 'a', 'up', 0);
  assert.equal(E.input(untrusted, 'b', { type: 'guard', dir: 'up', guardDelayMs: 120 }, guardAt).guarded, false);
  assert.equal(player(untrusted, 'b').vulnerability, 0);
  E.advance(untrusted, guardAt + 1);
  assert.equal(player(untrusted, 'b').vulnerability, 15);

  const late = online();
  attack(late, 'a', 'up', 0);
  assert.equal(E.input(late, 'b', { type: 'guard', dir: 'up' }, guardAt + 1, { guardDelayMs: 1000 }).guarded, false);
  assert.equal(player(late, 'b').vulnerability, 15);

  const offline = match();
  attack(offline, 'a', 'up', 0);
  assert.equal(E.input(offline, 'b', { type: 'guard', dir: 'up' }, guardAt, { guardDelayMs: 120 }).guarded, false);
  assert.equal(player(offline, 'b').vulnerability, 15);
});

test('trusted latency can restore perfect timing without retroactively guarding a new launch', () => {
  const m = match();
  attack(m, 'a', 'up', 0);
  const receipt = E.RULES.travelMs + 160;
  assert.equal(E.input(m, 'b', { type: 'guard', dir: 'up' }, receipt, { guardDelayMs: 60 }).perfect, true);
  assert.equal(lastEvent(m, 'guard').at, receipt);

  const recent = match(1000);
  attack(recent, 'a', 'up', 2000);
  // Model a short-travel shot to exercise the launch check independently of
  // the normal travel speeds, which all exceed the maximum compensation.
  recent.attacks[0].impactAt = 2060;
  assert.equal(E.input(recent, 'b', { type: 'guard', dir: 'up' }, 2050, { guardDelayMs: 120 }).guarded, false);
});

test('Clash offers three player-specific seeded choices after eight seconds, then waits twelve seconds after each pick', () => {
  const roster = ['a', 'b', 'c'];
  const m = clash(roster, { seed: 1 });
  assert.equal(firstUpgrade, 8000);
  assert.equal(E.RULES.upgradeIntervalMs, 12000);
  assert.equal(E.snapshot(m, firstUpgrade - 1).players[0].offer, null);
  assert.equal(choose(m, 'a', 'recharge', firstUpgrade - 1).reason, 'invalid_offer');
  const before = E.snapshot(m, firstUpgrade);
  const offer = before.players[0].offer;
  assert.equal(offer.choices.length, 3);
  assert.equal(new Set(offer.choices.map(choice => choice.kind)).size, 3);
  assert.notDeepEqual(before.players[1].offer, offer);
  assert.notDeepEqual(before.players[2].offer, before.players[1].offer);
  const replay = clash(roster, { seed: 1 });
  assert.deepEqual(E.snapshot(replay, firstUpgrade).players.map(p => p.offer), before.players.map(p => p.offer));
  assert.notDeepEqual(E.snapshot(clash(roster, { seed: 0 }), firstUpgrade).players[0].offer, offer);
  assert.equal(lastEvent(m, 'upgrade_offer').at, firstUpgrade);
  assert.equal(choose(m, 'a', 'recharge', firstUpgrade, 'wrong').reason, 'invalid_offer');
  assert.equal(choose(m, 'a', 'unknown').reason, 'invalid_choice');

  const picked = offer.choices.find(choice => choice.kind !== 'repair');
  const result = choose(m, 'a', picked.id);
  assert.deepEqual(result, { ok: true, kind: picked.kind, value: picked.value });
  assert.equal(lastEvent(m, 'upgrade').playerId, 'a');
  assert.equal(choose(m, 'a', 'attack_speed').reason, 'invalid_offer');
  const after = E.snapshot(m, firstUpgrade);
  assert.equal(after.players[0].offer, null);
  assert.equal(after.players[0].upgrades[picked.kind], result.value);
  after.players[0].upgrades[picked.kind] = 999;
  before.players[0].offer.choices[0].value = 999;
  assert.equal(player(m, 'a').upgrades[picked.kind], result.value);
  assert.notEqual(before.players[1].offer.choices[0].value, 999);
  assert.notEqual(player(m, 'b').offer.choices[0].value, 999);

  const secondAt = firstUpgrade + E.RULES.upgradeIntervalMs;
  assert.equal(E.snapshot(m, secondAt - 1).players[0].offer, null);
  const second = E.snapshot(m, secondAt);
  assert.equal(second.players[0].offer.id, 'offer-2');
  assert.equal(second.players[1].offer.id, 'offer-1');
  assert.equal(E.forfeit(m, 'c', second.now).ok, true);
  assert.equal(E.snapshot(m, second.now).players[2].offer, null);

  const delayedPick = secondAt + 1000;
  const bChoiceId = before.players[1].offer.choices[1].id;
  assert.equal(choose(replay, 'b', bChoiceId).ok, true);
  assert.equal(choose(m, 'b', bChoiceId, delayedPick).ok, true);
  const delayedSecond = delayedPick + E.RULES.upgradeIntervalMs;
  assert.equal(E.snapshot(m, delayedSecond - 1).players[1].offer, null);
  assert.deepEqual(E.snapshot(m, delayedSecond).players[1].offer, E.snapshot(replay, secondAt).players[1].offer);
  assert.deepEqual(m.events.filter(event => event.type === 'upgrade_offer' && event.offerId === 'offer-2')
    .map(({ playerId, at }) => [playerId, at]), [['a', secondAt], ['b', delayedSecond]]);
});

test('Extra Virus caps at 50% and other persistent upgrades cap at 100%', () => {
  const m = clash(['a', 'b'], { seed: 4 });
  const a = player(m, 'a');
  for (const kind of Object.keys(a.upgrades)) a.upgrades[kind] = 100;
  a.upgrades.mutation = 48;
  a.upgrades.attack_speed = 99;

  const first = E.snapshot(m, firstUpgrade).players[0].offer;
  const byKind = Object.fromEntries(first.choices.map(choice => [choice.kind, choice.value]));
  assert.deepEqual(Object.keys(byKind).sort(), ['attack_speed', 'mutation', 'repair']);
  assert.equal(byKind.mutation, 2);
  assert.equal(byKind.attack_speed, 1);
  assert.equal(choose(m, 'a', 'mutation').value, 2);
  const shot = attack(m, 'a', 'up', firstUpgrade);
  assert.equal(shot.ok, true);
  assert.equal(shot.mutationAttackId, undefined); // Seed 4's first mutation roll is above 50%.

  const secondAt = firstUpgrade + E.RULES.upgradeIntervalMs;
  const second = E.snapshot(m, secondAt).players[0];
  assert.equal(second.upgrades.mutation, 50);
  assert.deepEqual(second.offer.choices.map(choice => choice.kind).sort(), ['attack_speed', 'repair']);
  assert.equal(choose(m, 'a', 'attack_speed', secondAt, second.offer.id).value, 1);

  const thirdAt = secondAt + E.RULES.upgradeIntervalMs;
  a.vulnerability = 10;
  const third = E.snapshot(m, thirdAt).players[0];
  assert.ok(Object.entries(third.upgrades).every(([kind, value]) => value === (kind === 'mutation' ? 50 : 100)));
  assert.deepEqual(third.offer.choices.map(choice => choice.kind), ['repair']);
  assert.deepEqual(choose(m, 'a', 'repair', thirdAt, third.offer.id), { ok: true, kind: 'repair', value: 10 });
  assert.equal(E.snapshot(m, thirdAt).players[0].vulnerability, 0);
  const fourth = E.snapshot(m, thirdAt + E.RULES.upgradeIntervalMs).players[0];
  assert.deepEqual(fourth.offer.choices.map(choice => choice.kind), ['repair']);
});

test('Clash upgrades apply their offered value to the choosing player only', () => {
  for (const kind of ['attack_power', 'guard_energy', 'perfect_repair', 'attack_discount', 'damage_resistance', 'miss_resistance']) {
    const m = clash();
    const choice = offerUpgrade(m, 'a', kind);
    assert.ok(choice.value > 0);
    assert.deepEqual(choose(m, 'a', choice.id), { ok: true, kind, value: choice.value });
    const state = E.snapshot(m, firstUpgrade);
    assert.equal(state.players[0].upgrades[kind], choice.value);
    assert.equal(state.players[1].upgrades[kind], 0);
  }
});

test('energy efficiency lowers the required energy and cost for the player who has it', () => {
  const m = clash();
  const a = player(m, 'a');
  a.upgrades.attack_discount = 100;
  a.energy = player(m, 'b').energy = 0.5;
  const state = E.snapshot(m, 0);
  assert.equal(state.players[0].attackCost, 0.5);
  assert.equal(state.players[1].attackCost, E.RULES.attackCost);
  assert.equal(attack(m, 'a', 'up', 0).ok, true);
  assert.equal(a.energy, 0);
  assert.equal(attack(m, 'b', 'down', 0).reason, 'energy');
});

test('core armor reduces incoming PvP damage after the attacker’s damage boost', () => {
  const m = clash();
  player(m, 'a').upgrades.attack_power = 20;
  player(m, 'b').upgrades.damage_resistance = 50;
  attack(m, 'a', 'up', 0);
  attack(m, 'b', 'down', 0);
  E.advance(m, settled(0));
  assert.equal(player(m, 'a').vulnerability, 15);
  assert.equal(player(m, 'b').vulnerability, 12);
});

test('empty guard resistance reduces only PvP miss penalties and can prevent them entirely', () => {
  const m = clash();
  const a = player(m, 'a');
  a.upgrades.miss_resistance = 33;
  a.upgrades.damage_resistance = 100;
  assert.equal(guard(m, 'a', 'up', 0).guarded, false);
  assert.equal(lastEvent(m, 'miss').damage, 2.7);
  assert.equal(a.vulnerability, 2.7);

  a.upgrades.miss_resistance = 100;
  a.vulnerability = 100;
  assert.equal(guard(m, 'a', 'right', 0).guarded, false);
  assert.equal(lastEvent(m, 'miss').damage, 0);
  assert.equal(a.eliminated, false);

  a.vulnerability = 0;
  const boss = E.snapshot(m, E.RULES.bossIntervalMs + 1750).players[0].boss;
  assert.equal(boss.kind, 'domain');
  const incoming = boss.attacks[0];
  const emptyLane = E.DIRECTIONS.find(dir => dir !== incoming.dir);
  assert.equal(guard(m, 'a', emptyLane, incoming.impactAt).guarded, false);
  assert.equal(lastEvent(m, 'miss').damage, 4);
  E.advance(m, incoming.impactAt + 2000);
  assert.equal(lastEvent(m, 'hit').damage, 100);
});

test('a seeded mutation roll can add a non-Virus behind the original attack for one energy', () => {
  for (const [seed, expected] of [[2, true], [3, false]]) {
    const m = clash(['a', 'b'], { seed });
    const mutation = offerUpgrade(m, 'a', 'mutation');
    assert.ok(choose(m, 'a', mutation.id).value > 0);
    const result = attack(m, 'a', 'down', firstUpgrade);
    const primary = m.attacks.find(shot => shot.attackId === result.attackId);
    assert.equal(primary.kind, 'virus');
    assert.equal(primary.source, 'manual');
    assert.equal(player(m, 'a').energy, 2);
    const extra = m.attacks.find(shot => shot.attackId === result.mutationAttackId);
    assert.equal(Boolean(extra), expected);
    if (expected) {
      assert.notEqual(extra.kind, 'virus');
      assert.equal(extra.source, 'mutation');
      assert.equal(extra.to, primary.to);
      assert.ok(extra.impactAt - primary.impactAt >= E.RULES.arrivalGapMs);
      const travel = { trojan: 1800, worm: 900, ransom: 1250, phishing: 1900, ddos: 2200 }[extra.kind];
      assert.ok(extra.launchedAt > firstUpgrade);
      assert.equal(extra.impactAt - extra.launchedAt, fasterTravel(travel, 45));
      assert.equal(lastEvent(m, 'attack').at, firstUpgrade);
    }
  }
});

test('selected attack speed applies to the player’s new shots without changing other attacks', () => {
  const m = clash(['a', 'b', 'c', 'd']);
  const old = E.input(m, 'a', { type: 'attack', dir: 'left', targetId: 'd' }, firstUpgrade - 400);
  const speed = offerUpgrade(m, 'a', 'attack_speed');
  const { value } = choose(m, 'a', speed.id);
  assert.ok(value > 0);
  const fast = attack(m, 'a', 'up', firstUpgrade);
  const regular = attack(m, 'b', 'right', firstUpgrade);
  assert.equal(m.attacks.find(shot => shot.attackId === old.attackId).impactAt, old.impactAt);
  assert.equal(regular.impactAt - firstUpgrade, fasterTravel(E.RULES.travelMs, 45));
  assert.equal(fast.impactAt - firstUpgrade, fasterTravel(E.RULES.travelMs, 45 + value));
  assert.ok(fast.impactAt < regular.impactAt);
  const flight = m.attacks.find(shot => shot.attackId === fast.attackId);
  assert.equal(flight.impactAt - flight.launchedAt, fasterTravel(E.RULES.travelMs, 45 + value));
});

test('clash repair reports actual vulnerability restored and perfect energy applies on the next perfect', () => {
  const repair = clash();
  assert.equal(attack(repair, 'b', 'up', 0).ok, true);
  const choice = offerUpgrade(repair, 'a', 'repair');
  const initial = E.snapshot(repair, firstUpgrade).players[0];
  assert.equal(initial.vulnerability, 15);
  const healed = Math.min(choice.value, initial.vulnerability);
  assert.equal(choose(repair, 'a', choice.id).value, healed);
  assert.equal(player(repair, 'a').vulnerability, initial.vulnerability - healed);
  assert.equal(lastEvent(repair, 'upgrade').value, healed);

  const perfect = clash();
  const perfectEnergy = offerUpgrade(perfect, 'a', 'perfect_energy');
  const { value } = choose(perfect, 'a', perfectEnergy.id);
  assert.ok(value > 0);
  const incoming = attack(perfect, 'b', 'down', firstUpgrade);
  assert.equal(attack(perfect, 'a', 'up', incoming.impactAt).ok, true);
  assert.equal(guard(perfect, 'a', 'down', incoming.impactAt).perfect, true);
  close(player(perfect, 'a').energy, 2 + E.RULES.perfectEnergy * (1 + value / 100));
});

test('a Trojan from mutation creates an opposite-lane echo when parried', () => {
  const m = clash(['a', 'b'], { seed: 317 });
  player(m, 'a').upgrades.mutation = 20;
  const primary = attack(m, 'a', 'left', firstUpgrade);
  const trojan = m.attacks.find(shot => shot.attackId === primary.mutationAttackId);
  assert.equal(trojan.kind, 'trojan');
  assert.equal(guard(m, 'b', 'left', primary.impactAt).guarded, true);
  assert.equal(guard(m, 'b', 'left', trojan.impactAt).guarded, true);
  assert.equal(lastEvent(m, 'guard').kind, 'trojan');
  assert.equal(m.attacks.length, 1);
  const [echo] = m.attacks;
  assert.equal(echo.kind, 'echo');
  assert.equal(echo.dir, 'right');
  assert.equal(echo.from, 'a');
  assert.equal(echo.impactAt - echo.launchedAt, 550);
});

test('Phishing from mutation reveals the true guard lane opposite its decoy', () => {
  const m = clash(['a', 'b'], { seed: 148 });
  player(m, 'a').upgrades.mutation = 20;
  const primary = attack(m, 'a', 'left', firstUpgrade);
  const phishing = m.attacks.find(shot => shot.attackId === primary.mutationAttackId);
  assert.equal(phishing.kind, 'phishing');
  assert.equal(phishing.decoyDir, 'left');
  assert.equal(phishing.dir, 'right');
  assert.equal(phishing.revealAt, phishing.impactAt - E.RULES.guardWindowMs);
  assert.equal(guard(m, 'b', 'left', primary.impactAt - E.RULES.guardWindowMs).guarded, true);
  assert.equal(guard(m, 'b', 'right', phishing.revealAt - 1).guarded, false);
  assert.equal(guard(m, 'b', 'left', phishing.revealAt).guarded, false);
  assert.equal(guard(m, 'b', 'right', phishing.revealAt - 1 + E.RULES.guardCooldownMs).guarded, true);
  assert.equal(lastEvent(m, 'guard').kind, 'phishing');
});

test('a summoned blue Worm waits for same-lane parries, then charges and heals on a perfect', () => {
  const m = clash(['a', 'b'], { seed: 8 });
  player(m, 'a').upgrades.mutation = 50;
  let shot = attack(m, 'a', 'up', 0);
  const worm = m.attacks.find(attack => attack.attackId === shot.mutationAttackId);
  assert.equal(worm.kind, 'worm');
  assert.equal(worm.state, 'dormant');
  assert.equal(worm.impactAt, null);
  assert.ok([2, 3].includes(worm.remaining));
  player(m, 'a').upgrades.mutation = 0;

  guard(m, 'b', 'right', 100);
  const remaining = worm.remaining;
  const other = attack(m, 'a', 'left', 350);
  assert.equal(guard(m, 'b', 'up', shot.impactAt).guarded, true);
  assert.equal(worm.remaining, remaining - 1);
  assert.equal(guard(m, 'b', 'left', other.impactAt).guarded, true);
  assert.equal(worm.remaining, remaining - 1);
  let at = other.impactAt;
  while (worm.remaining > 0) {
    shot = attack(m, 'a', 'up', at);
    assert.equal(shot.ok, true);
    at = shot.impactAt;
    assert.equal(guard(m, 'b', 'up', at).guarded, true);
  }
  assert.equal(worm.state, 'pending');
  assert.equal(worm.hopAt, at);
  assert.ok(worm.launchedAt >= at + 200);
  player(m, 'b').vulnerability = 39;
  assert.equal(guard(m, 'b', 'up', worm.impactAt).perfect, true);
  assert.equal(player(m, 'b').vulnerability, 19);
});

test('duel pauses shots for identical bosses and resumes together after the slower player', () => {
  const m = clash(['a', 'b'], { seed: 66 });
  const bossStart = E.RULES.bossIntervalMs;
  const sent = attack(m, 'a', 'right', bossStart - 300);
  const opening = E.snapshot(m, bossStart);
  assert.equal(opening.boss.kind, 'domain');
  assert.deepEqual(opening.players[0].boss, opening.players[1].boss);
  assert.equal(opening.attacks.length, 0);
  assert.equal(attack(m, 'b', 'right', bossStart).reason, 'boss_active');
  assert.equal(E.input(m, 'a', { type: 'upgrade', offerId: 'offer-1', choiceId: 'repair' }, bossStart).reason, 'boss_active');

  let sawWaiting = false;
  for (let at = bossStart + 1750; at <= bossStart + 30000; at += 20) {
    E.advance(m, at);
    if (!m.boss) break;
    for (const [i, id] of ['a', 'b'].entries()) {
      const fight = player(m, id).boss;
      if (fight.phase === 'active' && at >= fight.attacks[0].impactAt + i * 160) {
        assert.equal(guard(m, id, fight.attacks[0].dir, at).guarded, true);
      } else if (fight.phase === 'reaction' && at >= fight.phaseAt + (fight.sequenceIndex + 1) * (i ? 350 : 120)) {
        assert.equal(guard(m, id, fight.sequence[fight.sequenceIndex], at).guarded, true);
      }
    }
    if (!sawWaiting && player(m, 'a').boss.phase === 'done' && player(m, 'b').boss.phase !== 'done') {
      sawWaiting = true;
      assert.equal(guard(m, 'a', 'up', at).reason, 'boss_waiting');
      assert.equal(attack(m, 'a', 'up', at).reason, 'boss_active');
      assert.equal(m.attacks.length, 0);
    }
  }
  assert.ok(sawWaiting);
  assert.equal(m.boss, null);
  const resume = lastEvent(m, 'boss_end').at;
  assert.equal(m.attacks.find(attack => attack.attackId === sent.attackId).impactAt, sent.impactAt + resume - bossStart);
  assert.equal(attack(m, 'b', 'down', resume).ok, true);
  const second = E.snapshot(m, resume + E.RULES.bossIntervalMs);
  assert.equal(second.boss.kind, 'destroy');
  assert.deepEqual(second.players[0].boss, second.players[1].boss);
});
