'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Boss = require('../frontend/js/duel-boss.js');

const start = kind => Boss.createFight({ kind, seed: 'shared', startAt: 60_000 });
const state = fight => Boss.snapshot(fight);
const advanceNext = (fight, grace) => Boss.advance(fight, Boss.nextAt(fight, grace), grace);
const guardAttack = (fight, attack, offset = 0) => Boss.guard(fight, attack.dir, attack.impactAt + offset);

test('Fake Domain keeps four three-input rounds and one nine-input round with the original deadlines', () => {
  const fight = start('domain');
  assert.equal(state(fight).phase, 'warning');
  assert.equal(Boss.nextAt(fight), 61_750);
  assert.deepEqual(Boss.advance(fight, 61_749), []);
  const reactionDurations = [2400, 2200, 2000, 1800, 6000];
  let previousDir;
  for (const [index, duration] of reactionDurations.entries()) {
    assert.deepEqual(advanceNext(fight), []);
    const active = state(fight);
    const [fake] = active.attacks;
    assert.equal(active.phase, 'active');
    assert.equal(active.remaining, 5 - index);
    assert.equal(fake.impactAt - fake.launchedAt, 1350);
    assert.notEqual(fake.dir, previousDir);
    previousDir = fake.dir;

    const { effects } = guardAttack(fight, fake, -360);
    assert.deepEqual(effects.map(effect => [effect.type, effect.attackId, effect.perfect, effect.heavy]),
      [['guard', fake.id, false, false]]);
    const reaction = state(fight);
    assert.equal(reaction.phase, 'reaction');
    assert.equal(reaction.phaseUntil - reaction.phaseAt, duration);
    assert.equal(reaction.origin, fake.dir);
    assert.equal(reaction.sequence.length, index === 4 ? 9 : 3);
    assert.equal(new Set(reaction.sequence).size, 3);
    assert.ok(!reaction.sequence.includes(fake.dir));
    for (const dir of new Set(reaction.sequence)) {
      assert.equal(reaction.sequence.filter(target => target === dir).length, index === 4 ? 3 : 1);
    }
    const wrong = Boss.guard(fight, fake.dir, reaction.phaseAt + 100);
    assert.deepEqual(wrong.effects.map(effect => [effect.type, effect.reason, effect.amount]), [['miss', 'wrong_sequence', 4]]);
    assert.equal(state(fight).sequenceIndex, 0);
    assert.equal(Boss.guard(fight, fake.dir, reaction.phaseAt + 150).reason, 'guard_cooldown');
    for (const [step, dir] of reaction.sequence.entries()) {
      const result = Boss.guard(fight, dir, reaction.phaseAt + 120 * (step + 1));
      assert.equal(result.ok, true);
      assert.equal(result.effects[0].heavy, true);
      assert.equal(result.effects[0].radius, 104);
      assert.equal(state(fight).sequenceIndex, step + 1);
      const last = step === reaction.sequence.length - 1;
      assert.deepEqual(result.effects.slice(1).map(effect => [effect.type, effect.amount]), last ? [['repair', 5]] : []);
    }
    const completed = state(fight);
    assert.equal(completed.phase, index === 4 ? 'finisher' : 'rebound');
    assert.equal(completed.phaseUntil - completed.phaseAt, index === 4 ? 1150 : 550);
  }
  advanceNext(fight);
  assert.equal(state(fight).phase, 'done');
  assert.equal(state(fight).result, 'cleared');
  assert.equal(Boss.nextAt(fight), Infinity);
});

test('Fake Domain misses at the core or reaction deadline and allows a compensated timely reaction', () => {
  const hit = start('domain');
  advanceNext(hit);
  const [fake] = state(hit).attacks;
  const coreAt = fake.impactAt + 1350 * 69 / 101;
  assert.equal(Boss.nextAt(hit), coreAt);
  assert.deepEqual(Boss.advance(hit, coreAt - 1), []);
  assert.deepEqual(advanceNext(hit).map(effect => [effect.type, effect.amount, effect.reason]),
    [['damage', 100, 'domain_escape']]);
  assert.equal(Boss.nextAt(hit), coreAt + 1000);
  advanceNext(hit);
  assert.equal(state(hit).result, 'escaped');

  const timely = start('domain');
  const expired = start('domain');
  for (const fight of [timely, expired]) {
    advanceNext(fight);
    assert.deepEqual(state(fight).attacks, [fake]);
    guardAttack(fight, fake);
    const { sequence, phaseAt } = state(fight);
    for (const [i, dir] of sequence.slice(0, 2).entries()) Boss.guard(fight, dir, phaseAt + 120 * (i + 1));
  }
  const { phaseUntil, sequence } = state(timely);
  assert.equal(Boss.nextAt(timely, 120), phaseUntil + 120);
  assert.deepEqual(Boss.advance(timely, phaseUntil + 60, 120), []);
  const result = Boss.guard(timely, sequence[2], phaseUntil + 60, phaseUntil - 1, 120);
  assert.equal(result.ok, true);
  assert.equal(state(timely).phase, 'rebound');
  assert.equal(Boss.guard(expired, sequence[2], phaseUntil + 60, phaseUntil, 120).reason, 'boss_inactive');
  assert.equal(advanceNext(expired, 120)[0].amount, 100);
  assert.equal(state(expired).phase, 'failed');
});

test('Dis-Troy keeps four 1→2→4 rounds with previews, split gaps, and 20-point repair', () => {
  const fight = start('destroy');
  for (let round = 0; round < 4; round++) {
    advanceNext(fight);
    const initial = state(fight);
    const base = 1500 - round * 200;
    assert.equal(initial.remaining, 4 - round);
    assert.equal(initial.attacks.length, 1);
    const [main] = initial.attacks;
    assert.equal(main.impactAt - main.launchedAt, base);
    guardAttack(fight, main);
    let lastDir = main.dir;

    for (const depth of [1, 2]) {
      const preview = state(fight);
      assert.equal(preview.phase, 'telegraph');
      assert.equal(preview.depth, depth);
      assert.equal(preview.preview.length, 2 ** depth);
      assert.equal(preview.previewInterval, 190);
      assert.equal(preview.previewDuration, 300);
      assert.equal(preview.phaseUntil - preview.phaseAt, 2 ** depth * 190 + 160);
      for (const dir of preview.preview) {
        assert.notEqual(dir, lastDir);
        lastDir = dir;
      }
      advanceNext(fight);
      const wave = state(fight);
      assert.deepEqual(wave.attacks.map(attack => attack.dir), preview.preview);
      for (const [index, fragment] of wave.attacks.entries()) {
        assert.equal(fragment.depth, depth);
        assert.equal(fragment.launchedAt - preview.phaseUntil, index * (220 - round * 20));
        assert.ok(Math.abs(fragment.impactAt - fragment.launchedAt - base * (depth === 1 ? 0.62 : 0.48)) < 1e-8);
        const { effects } = guardAttack(fight, fragment, 160);
        assert.equal(effects[0].attackId, fragment.id);
        const last = depth === 2 && index === wave.attacks.length - 1;
        assert.deepEqual(effects.slice(1).map(effect => [effect.type, effect.amount]), last ? [['repair', 20]] : []);
      }
    }
    const completed = state(fight);
    assert.equal(completed.phase, round === 3 ? 'finisher' : 'rebound');
    assert.equal(completed.phaseUntil - completed.phaseAt, round === 3 ? 1150 : 600);
  }
  advanceNext(fight);
  assert.equal(state(fight).result, 'cleared');
});

test('Dis-Troy retries the same pip after a missed split and charges only the original per-depth damage', () => {
  const fight = start('destroy');
  advanceNext(fight);
  const [main] = state(fight).attacks;
  guardAttack(fight, main);
  advanceNext(fight);
  const [fragment] = state(fight).attacks;
  assert.deepEqual(guardAttack(fight, fragment, -161).effects.map(effect => [effect.type, effect.amount]), [['miss', 4]]);
  assert.deepEqual(advanceNext(fight).map(effect => [effect.type, effect.amount, effect.depth, effect.attackId]),
    [['damage', 55, 1, fragment.id]]);
  const retry = state(fight);
  assert.equal(retry.phase, 'retry');
  assert.equal(retry.phaseUntil - retry.phaseAt, 950);
  assert.equal(retry.remaining, 4);
  advanceNext(fight);
  assert.equal(state(fight).attacks.length, 1);
  assert.notEqual(state(fight).attacks[0].dir, main.dir);
  assert.equal(advanceNext(fight)[0].amount, 110);
});

test('same seed and inputs make the same patterns on independent clocks', () => {
  const one = start('domain');
  const two = Boss.createFight({ kind: 'domain', seed: 'shared', startAt: 65_000 });
  advanceNext(one);
  advanceNext(two);
  assert.equal(state(one).attacks[0].dir, state(two).attacks[0].dir);
  guardAttack(one, state(one).attacks[0]);
  assert.equal(state(two).phase, 'active');
  guardAttack(two, state(two).attacks[0]);
  assert.deepEqual(state(one).sequence, state(two).sequence);
  assert.equal(state(two).phaseAt - state(one).phaseAt, 5000);
});
