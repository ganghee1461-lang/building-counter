/**
 * 브이월드 배경지도 타일 프록시
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const layer = url.searchParams.get('layer') || 'Base';
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

  // WMTS 타일 URL (키를 경로에 포함하는 방식)
  const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/${z}/${y}/${x}.png`;

  try {
    const res = await fetch(tileUrl, {
      headers: {
        'Referer': 'https://building-counter.pages.dev',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!res.ok) {
      return new Response(`타일 요청 실패 (${res.status})`, { status: res.status });
    }

    const contentType = res.headers.get('content-type') || 'image/png';

    // 이미지가 아닌 응답(오류 XML 등) 감지
    if (!contentType.includes('image')) {
      const text = await res.text();
      return new Response(`브이월드 오류: ${text.substring(0, 200)}`, { status: 502 });
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return new Response(`타일 요청 실패: ${err.message}`, { status: 500 });
  }
}
