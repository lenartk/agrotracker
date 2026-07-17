// Self-check geometrije priključka. Zagon: node tests/test_geometry.mjs
import { createStrip, offsetBack, trailedFollow } from '../js/geo.js';
import assert from 'node:assert';

const A = { lat: 46.0, lng: 14.5 };
const B = { lat: 46.0 + 10 / 111320, lng: 14.5 }; // 10 m proti severu
const kx = 111320 * Math.cos(46.0 * Math.PI / 180);

// simetričen trak 6 m: robova na ±3 m
let q = createStrip(A, B, 6, 0);
let xs = q.map(p => (p[1] - 14.5) * kx);
assert.ok(Math.abs(Math.min(...xs) + 3) < 0.02 && Math.abs(Math.max(...xs) - 3) < 0.02, 'simetrija');

// asimetričen: 1.5 m levo (zahod pri vožnji na sever), 4.5 m desno
// latOff = (extL - extR)/2 = -1.5; width = 6
q = createStrip(A, B, 6, -1.5);
xs = q.map(p => (p[1] - 14.5) * kx);
assert.ok(Math.abs(Math.min(...xs) + 1.5) < 0.02, `levo ${Math.min(...xs)}`);
assert.ok(Math.abs(Math.max(...xs) - 4.5) < 0.02, `desno ${Math.max(...xs)}`);

// offsetBack: 5 m nazaj pri vožnji na sever = 5 m juga
const ob = offsetBack(B, 0, 5);
assert.ok(Math.abs((B.lat - ob.lat) * 111320 - 5) < 0.02, 'offsetBack');

// trailedFollow: priključek na 4 m za vlečno točko; po premiku vlečne točke
// naprej ostane na razdalji 4 m
let st = trailedFollow(null, A, 4);
st = trailedFollow(st, B, 4); // hitch se premakne 10 m naprej
const d = Math.hypot((st.lat - B.lat) * 111320, (st.lng - B.lng) * kx);
assert.ok(Math.abs(d - 4) < 0.05, `tractrix razdalja ${d}`);

// bočna korekcija pivota (implementPos): antena 1 m LEVO od osi pri vožnji na
// sever → os je 1 m vzhodno; offsetBack(pt, heading+90, -antLat) mora dati +1 m E
const lp = offsetBack(B, 0 + 90, -1);
assert.ok(Math.abs((lp.lng - B.lng) * kx - 1) < 0.02, `pivot lat korekcija ${(lp.lng - B.lng) * kx}`);
assert.ok(Math.abs((lp.lat - B.lat) * 111320) < 0.01, 'pivot korekcija ne sme premakniti naprej/nazaj');

console.log('test_geometry.mjs: vsi testi OK');
