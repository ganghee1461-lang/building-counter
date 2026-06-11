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

  const vworldUrl = `https://api.vworld.kr/req/wfs?key=${VWORLD_KEY}&domain=building-counter.pages.dev&service=WFS&version=2.0.0&request=GetFeature&typename=${typename}&bbox=${bbox}&maxFeatures=${maxFeatures}&output=application/json&srsname=EPSG:4326`;

  try {
    const res = await fetch(vworldUrl, {
      // HTTP/1.1 강제 (vworld가 h2 업그레이드 요청 거부하는 것 방지)
      cf: { httpVersion: '1' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://building-counter.pages.dev/',
        'Connection': 'keep-alive',
      },
    });

    const text = await res.text();

    if (!text || text.trim() === '') {
      return json({ error: `빈 응답 (status: ${res.status})` }, 502);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return json({
        error: 'WFS 응답 파싱 실패',
        httpStatus: res.status,
        preview: text.slice(0, 500),
      }, 502);
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
