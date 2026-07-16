// Self-check za guidance.js geometrijo. Zagon: node tests/test_guidance.mjs
import { Guidance, lineLabel } from '../js/guidance.js';
import assert from 'node:assert';

const g = new Guidance();
g.widthM = 3.0;

// A na (46.0, 14.5), B ~100 m severno → linija poteka proti severu
const A = { lat: 46.0, lng: 14.5 };
const B = { lat: 46.0 + 100 / 111320, lng: 14.5 };
g.setA(A);
assert.ok(g.setB(B), 'setB mora uspeti pri 100 m razmika');
assert.ok(g.active);
assert.ok(Math.abs(g.bearingAB() - 0) < 0.01, 'bearing mora biti ~0 (sever)');

// premalo razmika
const g2 = new Guidance();
g2.setA(A);
assert.equal(g2.setB({ lat: A.lat + 1 / 111320, lng: A.lng }), false, 'setB < 5 m mora zavrniti');

// 1 m vzhodno od A → 1 m desno od linije → zavij levo (steer < 0)
const kx = 111320 * Math.cos(A.lat * Math.PI / 180);
const eastOf = (m) => ({ lat: A.lat, lng: A.lng + m / kx });

let r = g.update(eastOf(1), 0);
assert.equal(r.lineIdx, 0);
assert.ok(Math.abs(r.steerM - (-1)) < 0.02, `steer mora biti ~-1 (levo), je ${r.steerM}`);

// 3 m vzhodno = točno na prvi liniji desno (1D), xte ~0
r = g.update(eastOf(3), 0);
assert.equal(r.lineIdx, -1);
assert.equal(lineLabel(r.lineIdx), '1D');
assert.ok(Math.abs(r.steerM) < 0.02, `na liniji mora biti steer ~0, je ${r.steerM}`);

// Obrnjena vožnja (heading jug): levo/desno se zamenja
r = g.update(eastOf(1), 180);
assert.ok(r.flipped);
assert.ok(Math.abs(r.steerM - 1) < 0.02, `obrnjen steer mora biti ~+1 (desno), je ${r.steerM}`);

// 4.4 m vzhodno → najbližja linija 1D (na 3 m), xte -1.4 → |steer| 1.4
r = g.update(eastOf(4.4), 0);
assert.equal(r.lineIdx, -1);
assert.ok(Math.abs(Math.abs(r.steerM) - 1.4) < 0.02);

// getLines: 13 linij, aktivna vmes, pravilen razmik
const lines = g.getLines(0, 6);
assert.equal(lines.length, 13);
const l0 = lines.find(l => l.idx === 0);
const l1 = lines.find(l => l.idx === -1);
const dLng = Math.abs(l1.pts[0][1] - l0.pts[0][1]) * kx;
assert.ok(Math.abs(dLng - 3.0) < 0.02, `razmik linij mora biti 3 m, je ${dLng}`);

// load/toJSON round-trip
const g3 = new Guidance();
g3.widthM = 3.0;
assert.ok(g3.load(g.toJSON()));
assert.ok(Math.abs(g3.bearingAB() - g.bearingAB()) < 0.01);

// lineLabel
assert.equal(lineLabel(0), 'AB');
assert.equal(lineLabel(2), '2L');
assert.equal(lineLabel(-3), '3D');

console.log('test_guidance.mjs: vsi testi OK');
