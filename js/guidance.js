// AB-line guidance — paralelno vodenje po vzoru AgriBus-NAVI.
// Ravna linija A→B + vzporedne linije na razmik delovne širine.
// Cross-track error (XTE) do najbližje linije, predznak upošteva smer vožnje.
//
// Vse računamo v lokalni ravninski projekciji okoli točke A (x = vzhod, y = sever, metri).
// Za polja do nekaj km je to znotraj cm natančnosti — enako kot geo.js.

export class Guidance {
  constructor(){
    this.a = null;          // {lat,lng}
    this.b = null;          // {lat,lng}
    this.widthM = 3.0;      // razmik linij = delovna širina
    this._u = null;         // enotski vektor A→B v lokalnih metrih
    this._lenAB = 0;
    this._flip = false;     // true, ko vozimo v smeri B→A (obrne levo/desno za prikaz)
  }

  get active(){ return !!(this.a && this.b); }

  setA(ll){
    this.a = { lat: ll.lat, lng: ll.lng };
    this.b = null;
    this._u = null;
    this._flip = false;
  }

  // Vrne false, če je B preblizu A (ni smiselne smeri).
  setB(ll){
    if (!this.a) return false;
    const p = this._toXY(ll);
    const len = Math.hypot(p.x, p.y);
    if (len < 5) return false;
    this.b = { lat: ll.lat, lng: ll.lng };
    this._u = { x: p.x / len, y: p.y / len };
    this._lenAB = len;
    return true;
  }

  // Naloži shranjeno linijo: {a:{lat,lng}, b:{lat,lng}}
  load(ab){
    if (!ab || !ab.a || !ab.b) return false;
    this.setA(ab.a);
    return this.setB(ab.b);
  }

  reset(){
    this.a = null;
    this.b = null;
    this._u = null;
    this._flip = false;
  }

  toJSON(){ return this.active ? { a: { ...this.a }, b: { ...this.b } } : null; }

  // Smer linije A→B v stopinjah (0 = sever)
  bearingAB(){
    if (!this._u) return null;
    return (Math.atan2(this._u.x, this._u.y) * 180 / Math.PI + 360) % 360;
  }

  _toXY(ll){
    const kx = 111320 * Math.cos(this.a.lat * Math.PI / 180);
    return { x: (ll.lng - this.a.lng) * kx, y: (ll.lat - this.a.lat) * 111320 };
  }

  _toLL(x, y){
    const kx = 111320 * Math.cos(this.a.lat * Math.PI / 180);
    return { lat: this.a.lat + y / 111320, lng: this.a.lng + x / kx };
  }

  // Glavni izračun ob vsakem GPS fixu.
  // Vrne null, če guidance ni aktiven, sicer:
  //   xteM    — odklon od aktivne linije (+ = levo od smeri A→B)
  //   steerM  — odklon za voznika (+ = zavij desno), upošteva smer vožnje
  //   lineIdx — številka aktivne linije (0 = AB, + = levo od AB v smeri A→B)
  update(ll, headingDeg){
    if (!this.active) return null;
    const p = this._toXY(ll);
    const u = this._u;
    const d = -u.y * p.x + u.x * p.y;        // pravokotna oddaljenost od AB (+ = levo)
    const k = Math.round(d / this.widthM);   // najbližja vzporedna linija
    const xte = d - k * this.widthM;

    if (headingDeg != null){
      let diff = Math.abs(headingDeg - this.bearingAB()) % 360;
      if (diff > 180) diff = 360 - diff;
      this._flip = diff > 90;
    }
    // V smeri A→B: sem levo od linije (xte>0) → zavijem desno (+).
    // V smeri B→A je svet-levo moja desna → predznak obrnemo.
    const steerM = this._flip ? -xte : xte;
    return { xteM: xte, steerM, lineIdx: k, flipped: this._flip };
  }

  // Vzporedne linije za risanje na karto: centerIdx ± n linij.
  // Vrne [{idx, pts: [[lat,lng],[lat,lng]]}]
  getLines(centerIdx = 0, n = 6){
    if (!this.active) return [];
    const u = this._u;
    const nx = -u.y, ny = u.x;               // normala, kaže levo od A→B
    const ext = Math.max(150, this._lenAB);  // linije raztegnemo čez A in B
    const t0 = -ext, t1 = this._lenAB + ext;
    const out = [];
    for (let k = centerIdx - n; k <= centerIdx + n; k++){
      const off = k * this.widthM;
      const p1 = this._toLL(t0 * u.x + off * nx, t0 * u.y + off * ny);
      const p2 = this._toLL(t1 * u.x + off * nx, t1 * u.y + off * ny);
      out.push({ idx: k, pts: [[p1.lat, p1.lng], [p2.lat, p2.lng]] });
    }
    return out;
  }
}

// Oznaka linije za prikaz: "AB", "3L", "2D"
export function lineLabel(idx){
  if (idx === 0) return 'AB';
  return Math.abs(idx) + (idx > 0 ? 'L' : 'D');
}
