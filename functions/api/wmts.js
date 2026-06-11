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

  // domain 파라미터 포함 (브이월드 백엔드 호출 인증 정책)
  const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/${z}/${y}/${x}.png?domain=building-counter.pages.dev`;

  try {
    const res = await fetch(tileUrl);

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
