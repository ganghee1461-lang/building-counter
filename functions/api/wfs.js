export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
 
  const bbox = url.searchParams.get('bbox');
  const typename = url.searchParams.get('typename') || 'lt_c_spbd';
  const maxFeatures = url.searchParams.get('maxFeatures') || '500';
 
  if (!bbox) return json({ error: 'bbox 파라미터 필요' }, 400);
 
  const VWORLD_KEY = env.VWORLD_KEY;
  if (!VWORLD_KEY) return json({ error: 'VWORLD_KEY 없음' }, 500);
 
  const [minY, minX, maxY, maxX] = bbox.split(',').map(Number);
 
  // URL 문자열 직접 조립 (URLSearchParams 인코딩 문제 방지)
  const vworldUrl = `https://api.vworld.kr/req/wfs?key=${VWORLD_KEY}&service=WFS&version=2.0.0&request=GetFeature&typename=${typename}&bbox=${minX},${minY},${maxX},${maxY},EPSG:4326&maxFeatures=${maxFeatures}&output=application/json&srsname=EPSG:4326`;
 
  try {
    const res = await fetch(vworldUrl);
    const text = await res.text();
 
    if (!text || text.trim() === '') return json({ error: '빈 응답' }, 502);
 
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return json({ error: 'JSON 파싱 실패', raw: text.substring(0, 500) }, 502);
    }
 
    return json(data);
  } catch (err) {
    return json({ error: `fetch 실패: ${err.message}` }, 500);
  }
}
 
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
