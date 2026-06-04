/**
 * 브이월드 지오코더 프록시 (주소 -> 좌표)
 *
 * 호출 예: /api/geocode?address=청주시 상당구 ...
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const address = url.searchParams.get('address');
  if (!address) {
    return json({ error: 'address 파라미터 필요' }, 400);
  }

  const VWORLD_KEY = env.VWORLD_KEY;
  if (!VWORLD_KEY) {
    return json({ error: 'VWORLD_KEY 환경변수가 설정되지 않았습니다' }, 500);
  }

  // 도로명/지번 둘 다 시도
  for (const type of ['ROAD', 'PARCEL']) {
    const params = new URLSearchParams({
      service: 'address',
      request: 'getCoord',
      version: '2.0',
      crs: 'EPSG:4326',
      address: address,
      refine: 'true',
      simple: 'false',
      format: 'json',
      type: type,
      key: VWORLD_KEY,
    });
    const apiUrl = `https://api.vworld.kr/req/address?${params}`;
    try {
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (data?.response?.status === 'OK') {
        return json(data);
      }
    } catch (err) {
      // 다음 타입 시도
    }
  }

  return json({ error: '주소를 찾을 수 없습니다' }, 404);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
