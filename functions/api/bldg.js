/**
 * 국토교통부 건축HUB 건축물대장 API 프록시
 * - 표제부, 총괄표제부 조회 지원
 * - CORS 우회 + 서비스키 숨김
 *
 * 호출 예: /api/bldg?sigunguCd=43111&bjdongCd=...&endpoint=getBrTitleInfo
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
  const bjdongCd = url.searchParams.get('bjdongCd');
  const platGbCd = url.searchParams.get('platGbCd') || '0';
  const bun = url.searchParams.get('bun');
  const ji = url.searchParams.get('ji');

  if (!sigunguCd || !bjdongCd || !bun || !ji) {
    return json({ error: '필수 파라미터: sigunguCd, bjdongCd, bun, ji' }, 400);
  }

  const DATA_GO_KR_KEY = env.DATA_GO_KR_KEY;
  if (!DATA_GO_KR_KEY) {
    return json({ error: 'DATA_GO_KR_KEY 환경변수가 설정되지 않았습니다' }, 500);
  }

  const params = new URLSearchParams({
    serviceKey: DATA_GO_KR_KEY,
    sigunguCd,
    bjdongCd,
    platGbCd,
    bun,
    ji,
    _type: 'json',
    numOfRows: '100',
    pageNo: '1',
  });

  const apiUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/${endpoint}?${params}`;

  try {
    const res = await fetch(apiUrl);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // 공공데이터포털은 키 오류 시 XML 반환하기도 함
      return json({
        error: '응답 파싱 실패 (서비스키 오류 가능성)',
        raw: text.substring(0, 500),
      }, 502);
    }

    return json(data);
  } catch (err) {
    return json({ error: `API 요청 실패: ${err.message}` }, 500);
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
