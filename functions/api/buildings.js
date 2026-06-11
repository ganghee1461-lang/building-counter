/**
 * R2에 저장된 시군구별 건물 GeoJSON에서 bbox 필터링하여 반환
 */

const R2_BASE = 'https://pub-614d984f8d84461fa89f30d93db8d6cf.r2.dev';

// 시군구별 대략적 경계 [minLng, minLat, maxLng, maxLat]
const SIG_BOUNDS = {
  '43111': [127.40, 36.55, 127.65, 36.80],
  '43112': [127.35, 36.50, 127.60, 36.75],
  '43113': [127.35, 36.55, 127.65, 36.85],
  '43114': [127.45, 36.65, 127.75, 37.00],
  '43130': [127.60, 36.85, 128.10, 37.20],
  '43150': [128.05, 36.95, 128.55, 37.25],
  '43720': [127.55, 36.25, 127.95, 36.65],
  '43730': [127.40, 36.15, 127.80, 36.55],
  '43740': [127.45, 35.95, 127.90, 36.35],
  '43745': [127.55, 36.75, 127.75, 36.95],
};

function bboxOverlap(a, b) {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function featureInBbox(feature, bbox) {
  const geom = feature.geometry;
  if (!geom) return false;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1);
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) return true;
    }
  }
  return false;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const bboxParam = url.searchParams.get('bbox');
  if (!bboxParam) return respond({ error: 'bbox 파라미터 필요' }, 400);

  // app.js 형식: minLat,minLng,maxLat,maxLng
  const [minLat, minLng, maxLat, maxLng] = bboxParam.split(',').map(Number);
  const bbox = [minLng, minLat, maxLng, maxLat];

  const sigCodes = Object.keys(SIG_BOUNDS).filter(code =>
    bboxOverlap(SIG_BOUNDS[code], bbox)
  );

  if (sigCodes.length === 0) {
    return respond({ type: 'FeatureCollection', features: [] });
  }

  const results = await Promise.all(
    sigCodes.map(async code => {
      try {
        const res = await fetch(`${R2_BASE}/${code}.json`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.features || []).filter(f => featureInBbox(f, bbox));
      } catch {
        return [];
      }
    })
  );

  const features = results.flat();
  return respond({ type: 'FeatureCollection', features });
}

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
