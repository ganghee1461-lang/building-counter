/**
 * 브이월드 WFS 프록시
 * - 도로명주소건물 폴리곤을 GeoJSON으로 반환
 * - CORS 우회 + API 키 숨김
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const bbox = url.searchParams.get('bbox');
  const typename = url.searchParams.get('typename') || 'lt_c_spbd';
  const maxFeatures = url.searchParams.get('maxFeatures') || '500';

  if (!bbox) return json({ error: 'bbox 파라미터 필요' }, 400);

  const VWORLD_KEY = env.VWORLD_KEY;
  if (!VWORLD_KEY) return json({ error: 'VWORLD_KEY 환경변수가 설정되지 않았습니다' }, 500);

  // domain 파라미터 직접 하드코딩 (URLSearchParams 인코딩 문제 방지)
  const vworldUrl = `https://api.vworld.kr/req/wfs?key=${VWORLD_KEY}&domain=building-counter.pages.dev&service=WFS&version=2.0.0&request=GetFeature&typename=${typename}&bbox=${bbox}&maxFeatures=${maxFeatures}&output=application/json&srsname=EPSG:4326`;

  try {
    const res = await fetch(vworldUrl);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return new Response(text, {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return json(data);
  } catch (err) {
    return json({ error: `WFS 요청 실패: ${err.message}` }, 500);
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
