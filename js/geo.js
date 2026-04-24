// Enostavni geodetski izračuni — za delo na ravni nekaj km je plane approximation dovolj natančna.

const EARTH_R = 6371008.8; // m

export function metersToDegreesLat(m){ return m / 111320; }
export function metersToDegreesLng(m, lat){
  return m / (111320 * Math.cos(lat * Math.PI / 180));
}

// Haversine razdalja v metrih
export function haversine(a, b){
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat/2)**2 +
    Math.cos(a.lat*toRad) * Math.cos(b.lat*toRad) * Math.sin(dLng/2)**2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// Smer od a do b v stopinjah (0 = sever, 90 = vzhod)
export function bearing(a, b){
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

// Izračuna 4 vogale traka širine widthM med točkama from -> to.
// Vrne polje [[lat,lng], ...] ali null, če je segment prekratek.
export function createStrip(from, to, widthM){
  const lat1 = from.lat, lng1 = from.lng;
  const lat2 = to.lat,   lng2 = to.lng;
  const avgLat = (lat1 + lat2) / 2;
  const dx = (lng2 - lng1) * 111320 * Math.cos(avgLat * Math.PI / 180);
  const dy = (lat2 - lat1) * 111320;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 0.15) return null;
  const px = -dy / len, py = dx / len;
  const half = widthM / 2;
  const offLng = metersToDegreesLng(px * half, avgLat);
  const offLat = metersToDegreesLat(py * half);
  return [
    [lat1 + offLat, lng1 + offLng],
    [lat1 - offLat, lng1 - offLng],
    [lat2 - offLat, lng2 - offLng],
    [lat2 + offLat, lng2 + offLng]
  ];
}

// Ploščina poligona v m² (shoelace na ravni približek)
export function polygonAreaM2(coords){
  // coords: [[lng,lat], ...] — GeoJSON stil (lng prvi!)
  if (coords.length < 3) return 0;
  const lat0 = coords[0][1] * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0);
  const my = 111320;
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++){
    const x1 = coords[i][0] * mx;
    const y1 = coords[i][1] * my;
    const x2 = coords[i+1][0] * mx;
    const y2 = coords[i+1][1] * my;
    sum += (x1 * y2 - x2 * y1);
  }
  return Math.abs(sum) / 2;
}

// Ploščina GeoJSON Polygon/MultiPolygon v ha
export function featureHa(feat){
  if (!feat || !feat.geometry) return 0;
  const g = feat.geometry;
  let m2 = 0;
  if (g.type === 'Polygon'){
    m2 = polygonAreaM2(g.coordinates[0]);
    // minus luknje
    for (let i = 1; i < g.coordinates.length; i++){
      m2 -= polygonAreaM2(g.coordinates[i]);
    }
  } else if (g.type === 'MultiPolygon'){
    for (const poly of g.coordinates){
      m2 += polygonAreaM2(poly[0]);
      for (let i = 1; i < poly.length; i++){
        m2 -= polygonAreaM2(poly[i]);
      }
    }
  }
  return m2 / 10000;
}

// Point-in-polygon (ray casting). Polygon je [[lng,lat], ...] — GeoJSON-style.
export function pointInRing(pt, ring){
  // pt: {lat, lng}
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > pt.lat) !== (yj > pt.lat)) &&
      (pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInFeature(pt, feat){
  if (!feat || !feat.geometry) return false;
  const g = feat.geometry;
  const check = (poly) => {
    if (!pointInRing(pt, poly[0])) return false;
    for (let i = 1; i < poly.length; i++){
      if (pointInRing(pt, poly[i])) return false; // v luknji
    }
    return true;
  };
  if (g.type === 'Polygon') return check(g.coordinates);
  if (g.type === 'MultiPolygon'){
    for (const poly of g.coordinates){ if (check(poly)) return true; }
    return false;
  }
  return false;
}

// Bounding box GeoJSON
export function bboxOfFeature(feat){
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number'){
      const [lng, lat] = coords;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    } else {
      coords.forEach(walk);
    }
  };
  if (feat.geometry) walk(feat.geometry.coordinates);
  return [[minLat, minLng], [maxLat, maxLng]];
}

// Centroid feature-a (približen, iz bbox)
export function centroidOfFeature(feat){
  const [[la, lo], [La, Lo]] = bboxOfFeature(feat);
  return { lat: (la + La) / 2, lng: (lo + Lo) / 2 };
}

// Formatiraj razdaljo
export function formatDistance(m){
  if (m < 1000) return m.toFixed(0) + ' m';
  return (m / 1000).toFixed(2) + ' km';
}

// Formatiraj trajanje
export function formatDuration(ms){
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}
