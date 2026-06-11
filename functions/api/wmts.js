/**
 * 브이월드 배경지도 타일 프록시
 * - WMTS 타일 요청을 키 노출 없이 처리
 *
 * 호출 예: /api/wmts?layer=Base&z=15&y=12&x=27
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const layer = url.searchParams.get('layer') || 'Base';  // Base, Satellite, Hybrid, gray, midnight
  const z = url.searchParams.get('z');
  const y = url.searchParams.get('y');
  const x = url.searchParams.get('x');

  if (!z || !y || !x) {
    return new Response('z, y, x 파라미터 필요', { status: 400 });
  }

  const VWORLD_KEY = env.VWORLD_KEY;
  if (!VWORLD_KEY) {
    return new Response('VWORLD_KEY 환경변수가 설정되지 않았습니다', { status: 500 });
  }

  const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/${z}/${y}/${x}.png`;

  try {
    const res = await fetch(tileUrl, {
      cf: { httpVersion: '1' },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://building-counter.pages.dev/',
        'Connection': 'keep-alive',
      },
    });
    if (!res.ok) {
      return new Response(`타일 요청 실패 (${res.status})`, { status: res.status });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(`타일 요청 실패: ${err.message}`, { status: 500 });
  }
}
