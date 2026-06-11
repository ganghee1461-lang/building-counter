/**
 * Cloudflare Workers 외부 요청 가능 여부 진단 엔드포인트
 * 사용: /api/test  또는  /api/test?target=vworld
 *
 * target 파라미터:
 *   httpbin  - httpbin.org/get (기본, Workers 일반 외부 요청 확인)
 *   vworld   - api.vworld.kr WFS 헬스체크
 *   all      - 둘 다 테스트
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('target') || 'httpbin';

  const results = {};

  if (target === 'httpbin' || target === 'all') {
    results.httpbin = await probe('https://httpbin.org/get', {
      headers: { 'User-Agent': 'CloudflareWorker/diagnostic' },
    });
  }

  if (target === 'vworld' || target === 'all') {
    const key = env.VWORLD_KEY || '(no-key)';
    const vworldUrl =
      `https://api.vworld.kr/req/wfs?key=${key}` +
      `&domain=building-counter.pages.dev` +
      `&service=WFS&version=2.0.0&request=GetCapabilities`;
    results.vworld = await probe(vworldUrl, {
      headers: {
        Referer: 'https://building-counter.pages.dev/',
        Origin:  'https://building-counter.pages.dev',
      },
    });
  }

  if (target === 'ip' || target === 'all') {
    const key = env.VWORLD_KEY || '(no-key)';
    // vworld 서버 IP 직접 호출 (도메인 차단 우회 시도)
    results.vworld_ip = await probe(
      `https://211.188.33.95/req/wfs?key=${key}&domain=building-counter.pages.dev&service=WFS&version=2.0.0&request=GetCapabilities`,
      { Host: 'api.vworld.kr' }
    );
  }

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function probe(url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return {
      ok:     res.ok,
      status: res.status,
      ms:     Date.now() - start,
      headers,
      bodyPreview: body.slice(0, 300),
    };
  } catch (err) {
    return {
      ok:    false,
      error: err.message,
      ms:    Date.now() - start,
    };
  }
}
