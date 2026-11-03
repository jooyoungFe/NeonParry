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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/duel-engine.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.NeonDuelEngine.createMatch, 'function');
  assert.equal(sandbox.NeonDuelEngine.RULES.vulnerabilityMax, 100);
});

test('duel timing stays aligned with the original easy game and Virus travel', () => {
  const game = createHarness({ 'neon-parry-sound': 'off' });
  const original = game.plain('({guardWindowMs:RUN_DIFFICULTIES.easy.guard,perfectWindowMs:RUN_DIFFICULTIES.easy.perfect,guardCooldownMs:RUN_DIFFICULTIES.easy.cooldown,travelMs:TYPES.virus.travel,arrivalGapMs:MIN_ARRIVAL_GAP})');
  assert.deepEqual(original, { guardWindowMs: 360, perfectWindowMs: 100, guardCooldownMs: 300, travelMs: 2200, arrivalGapMs: 520 });
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

test('misses recover per direction, allowing another lane immediately without self-damage', () => {
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
