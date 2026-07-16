// Self-check za GPS glajenje v geo.js. Zagon: node tests/test_gpsfilter.mjs
import { smoothPosition, smoothHeading, GPS_FILTER } from '../js/geo.js';
import assert from 'node:assert';

const base = { lat: 46.0, lng: 14.5 };
const kx = 111320 * Math.cos(base.lat * Math.PI / 180);
const east = (m) => ({ lat: base.lat, lng: base.lng + m / kx });

// slaba natančnost → zavržemo
assert.equal(smoothPosition(base, { ...east(2), accuracyM: 50, spdKmh: 5 }), null);

// prvi fix brez prejšnjega → prevzamemo
let r = smoothPosition(null, { ...east(2), accuracyM: 3, spdKmh: 5 });
assert.ok(Math.abs((r.lng - base.lng) * kx - 2) < 0.01);

// mirovanje: šum 1 m pri 0 km/h ne premakne pozicije
r = smoothPosition(base, { ...east(1), accuracyM: 3, spdKmh: 0 });
assert.ok(r.frozen);
assert.equal(r.lng, base.lng);

// počasna vožnja: močno glajenje (alphaSlow delež novega)
r = smoothPosition(base, { ...east(2), accuracyM: 3, spdKmh: 2 });
const movedSlow = (r.lng - base.lng) * kx;
assert.ok(movedSlow > 0.3 && movedSlow < 1.2, `slow move ${movedSlow}`);

// hitra vožnja: sledi skoraj surovemu fixu
r = smoothPosition(base, { ...east(2), accuracyM: 3, spdKmh: 20 });
const movedFast = (r.lng - base.lng) * kx;
assert.ok(movedFast > 1.3, `fast move ${movedFast}`);

// heading: krožno glajenje čez 0° (350° -> 10° ne sme iti čez 180)
let hs = smoothHeading(null, 350);
hs = smoothHeading(hs.state, 10);
assert.ok(hs.headingDeg > 340 || hs.headingDeg < 20, `heading ${hs.headingDeg}`);

// konvergenca glajenja: po več fixih na isti točki pridemo tja
let pos = { ...base };
for (let i = 0; i < 20; i++){
  const rr = smoothPosition(pos, { ...east(3), accuracyM: 3, spdKmh: 6 });
  pos = { lat: rr.lat, lng: rr.lng };
}
assert.ok(Math.abs((pos.lng - east(3).lng) * kx) < 0.2, 'konvergenca');

console.log('test_gpsfilter.mjs: vsi testi OK');
