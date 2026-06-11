/**
 * 클라이언트에 vworld 키 전달 (WMTS/WFS 브라우저 직접 호출용)
 */
export async function onRequestGet(context) {
  const { env } = context;
  return new Response(JSON.stringify({ vworldKey: env.VWORLD_KEY || '' }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
