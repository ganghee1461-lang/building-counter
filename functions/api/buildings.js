/**
 * R2 시군구 건물 GeoJSON 프록시
 * - JSON 파싱 없이 스트리밍만 함 (클라이언트에서 bbox 필터링)
 * - ?sig=43111 형식으로 시군구 코드 지정
 */

const R2_BASE = 'https://pub-614d984f8d84461fa89f30d93db8d6cf.r2.dev';

const VALID_SIGS = ['43111','43112','43113','43114','43130','43150','43720','43730','43740','43745','43750','43760','43770','43800'];

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sig = url.searchParams.get('sig');

  if (!sig || !VALID_SIGS.includes(sig)) {
    return new Response(JSON.stringify({ error: 'sig 파라미터 필요 (예: ?sig=43111)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const res = await fetch(`${R2_BASE}/${sig}.json`);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: '데이터 없음' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
