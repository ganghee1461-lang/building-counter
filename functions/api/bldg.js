/**
 * 국토교통부 건축HUB 건축물대장 API 프록시
 */

const ALLOWED_ENDPOINTS = new Set([
  'getBrTitleInfo',
  'getBrRecapTitleInfo',
  'getBrBasisOulnInfo',
  'getBrFlrOulnInfo',
  'getBrExposInfo',
  'getBrExposPubuseAreaInfo',
]);

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const endpoint = url.searchParams.get('endpoint') || 'getBrTitleInfo';
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return json({ error: `허용되지 않은 endpoint: ${endpoint}` }, 400);
  }

  const sigunguCd = url.searchParams.get('sigunguCd');
  const bjdongCd  = url.searchParams.get('bjdongCd');
  const platGbCd  = url.searchParams.get('platGbCd') || '0';
  const bun       = url.searchParams.get('bun');
  const ji        = url.searchParams.get('ji');

  if (!sigunguCd || !bjdongCd || !bun || !ji) {
    return json({ error: '필수 파라미터: sigunguCd, bjdongCd, bun, ji' }, 400);
  }

  const DATA_GO_KR_KEY = env.DATA_GO_KR_KEY;
  if (!DATA_GO_KR_KEY) {
    return json({ error: 'DATA_GO_KR_KEY 환경변수가 설정되지 않았습니다' }, 500);
  }

  // URLSearchParams 대신 문자열 직접 조립 (이중 인코딩 방지)
  const queryString = [
    `serviceKey=${DATA_GO_KR_KEY}`,
    `sigunguCd=${sigunguCd}`,
    `bjdongCd=${bjdongCd}`,
    `platGbCd=${platGbCd}`,
    `bun=${bun}`,
    `ji=${ji}`,
    `_type=json`,
    `numOfRows=100`,
    `pageNo=1`,
  ].join('&');

  const apiUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/${endpoint}?${queryString}`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      cf: {
        // Cloudflare 캐시 우회
        cacheEverything: false,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({
        error: `외부 API 오류 (${res.status})`,
        raw: errText.substring(0, 300),
      }, 502);
    }

    const text = await res.text();

    if (!text || text.trim() === '') {
      return json({ error: '빈 응답 (외부 API 무응답)' }, 502);
    }

    // XML 오류 응답 감지
    if (text.trim().startsWith('<')) {
      return json({
        error: 'XML 오류 응답 (서비스키 또는 파라미터 문제)',
        raw: text.substring(0, 300),
      }, 502);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return json({
        error: '응답 파싱 실패',
        raw: text.substring(0, 300),
      }, 502);
    }

    return json(data);
  } catch (err) {
    return json({
      error: `fetch 실패: ${err.message}`,
      stack: err.stack?.substring(0, 200),
    }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
