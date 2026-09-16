import assert from 'node:assert/strict';
import { Session } from '../js/session.js';

const operation = {
  id: 'seed', name: 'Setev', color: '#22c55e', icon: '🌱',
  valueUnit: 'kg/ha', valueLabel: 'Seme', requiresActive: true
};
const machine = { id: 'sejalnica', name: 'Sejalnica', width: 3 };
const parcel = { id: 'p1', name: 'Test', ha: 1.0 };
const s = new Session({ operation, machine, parcel, note: '' });

s.start();
const t0 = 1_700_000_000_000;
const fix = (i) => ({
  lat: 46.0 + i * 0.00001,
  lng: 14.0,
  spdKmh: 7.2,
  headingDeg: 0,
  tsMs: t0 + i * 1000,
  source: 'sim'
});

s.addFix(fix(0), true, 3, 20, null, 0, null, 22);
s.addFix(fix(1), true, 3, 20, null, 0, null, 22);
s.addFix(fix(2), true, 3, 20, null, 0, null, 22);

assert.ok(s.coveredHa > 0);
assert.ok(s.appliedAmount > 0);
assert.ok(s.targetAmount > s.appliedAmount);
assert.ok(Math.abs(s.appliedAmount / s.rateAreaHa - 20) < 1e-9);
assert.ok(Math.abs(s.targetAmount / s.targetAreaHa - 22) < 1e-9);
assert.equal(s.machineActiveMs, 2000);
assert.equal(s.stripMeta.length, s.strips.length);
assert.equal(s.stripMeta.at(-1).set, 22);
console.log('test_session_metrics: OK');
