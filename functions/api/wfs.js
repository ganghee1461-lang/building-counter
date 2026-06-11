/**
 * 브이월드 WFS 프록시 - 도로명주소건물 폴리곤
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const bbox = url.searchParams.get('bbox');
  const typename = url.searchParams.get('typename') || 'lt_c_spbd';
  const maxFeatures = url.searchParams.get('maxFeatures') || '500';

  if (!bbox) return json({ error: 'bbox 파라미터 필요' }, 400);

  const VWORLD_KEY = env.VWORLD_KEY;
  if (!VWORLD_KEY) return json({ error: 'VWORLD_KEY 환경변수 없음' }, 500);

  // bbox 파싱: minY,minX,maxY,maxX (위도,경도 순)
  const [minY, minX, maxY, maxX] = bbox.split(',').map(Number);

  // WFS 요청 URL
  const params = new URLSearchParams({
    key: VWORLD_KEY,
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typename: typename,
    bbox: `${minX},${minY},${maxX},${maxY},EPSG:4326`,
    maxFeatures: maxFeatures,
    output: 'application/json',
    srsname: 'EPSG:4326',
  });

  const vworldUrl = `https://api.vworld.kr/req/wfs?${params}`;

  try {
    const res = await fetch(vworldUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      // Cloudflare Workers에서 외부 요청 시 타임아웃 설정
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `WFS 오류 (${res.status})`, raw: errText.substring(0, 300) }, 502);
    }

    const text = await res.text();

    if (!text || text.trim() === '') {
      return json({ error: '빈 응답' }, 502);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // XML 오류 응답 가능성
      return json({ error: 'JSON 파싱 실패', raw: text.substring(0, 300) }, 502);
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
