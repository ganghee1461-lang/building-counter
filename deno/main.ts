const VWORLD_KEY = Deno.env.get("VWORLD_KEY") ?? "";
const DATA_GO_KR_KEY = Deno.env.get("DATA_GO_KR_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ALLOWED_ENDPOINTS = new Set([
  "getBrTitleInfo",
  "getBrRecapTitleInfo",
  "getBrBasisOulnInfo",
  "getBrFlrOulnInfo",
  "getBrExposInfo",
  "getBrExposPubuseAreaInfo",
]);

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === "/api/wmts") return handleWmts(url);
  if (url.pathname === "/api/wfs")  return handleWfs(url);
  if (url.pathname === "/api/bldg") return handleBldg(url);
  if (url.pathname === "/api/geocode") return handleGeocode(url);
  if (url.pathname === "/api/test") return handleTest(url);

  return new Response("Not found", { status: 404 });
});

// ===== WMTS =====
async function handleWmts(url: URL): Promise<Response> {
  const layer = url.searchParams.get("layer") ?? "Base";
  const z = url.searchParams.get("z");
  const y = url.searchParams.get("y");
  const x = url.searchParams.get("x");

  if (!z || !y || !x) return text("z, y, x 파라미터 필요", 400);
  if (!VWORLD_KEY) return text("VWORLD_KEY 환경변수 없음", 500);

  const tileUrl = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/${z}/${y}/${x}.png`;
  try {
    const res = await fetch(tileUrl, { headers: vworldHeaders() });
    if (!res.ok) return text(`타일 요청 실패 (${res.status})`, res.status);
    return new Response(res.body, {
      headers: {
        ...CORS,
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return text(`타일 요청 실패: ${(err as Error).message}`, 500);
  }
}

// ===== WFS =====
async function handleWfs(url: URL): Promise<Response> {
  const bbox = url.searchParams.get("bbox");
  const typename = url.searchParams.get("typename") ?? "lt_c_spbd";
  const maxFeatures = url.searchParams.get("maxFeatures") ?? "500";

  if (!bbox) return json({ error: "bbox 파라미터 필요" }, 400);
  if (!VWORLD_KEY) return json({ error: "VWORLD_KEY 환경변수 없음" }, 500);

  const vworldUrl = `https://api.vworld.kr/req/wfs?key=${VWORLD_KEY}&domain=building-counter.ganghee1461-lang.deno.net&service=WFS&version=2.0.0&request=GetFeature&typename=${typename}&bbox=${bbox}&maxFeatures=${maxFeatures}&output=application/json&srsname=EPSG:4326`;

  try {
    const res = await fetch(vworldUrl, { headers: vworldHeaders() });
    const body = await res.text();
    try {
      const data = JSON.parse(body);
      return json(data);
    } catch {
      return json({ error: "WFS 응답 파싱 실패", httpStatus: res.status, preview: body.slice(0, 500) }, 502);
    }
  } catch (err) {
    return json({ error: `WFS 요청 실패: ${(err as Error).message}` }, 500);
  }
}

// ===== 건축HUB =====
async function handleBldg(url: URL): Promise<Response> {
  const endpoint = url.searchParams.get("endpoint") ?? "getBrTitleInfo";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return json({ error: `허용되지 않은 endpoint: ${endpoint}` }, 400);
  }

  const sigunguCd = url.searchParams.get("sigunguCd");
  const bjdongCd  = url.searchParams.get("bjdongCd");
  const platGbCd  = url.searchParams.get("platGbCd") ?? "0";
  const bun       = url.searchParams.get("bun");
  const ji        = url.searchParams.get("ji");

  if (!sigunguCd || !bjdongCd || !bun || !ji) {
    return json({ error: "필수 파라미터: sigunguCd, bjdongCd, bun, ji" }, 400);
  }
  if (!DATA_GO_KR_KEY) return json({ error: "DATA_GO_KR_KEY 환경변수 없음" }, 500);

  const qs = [
    `serviceKey=${DATA_GO_KR_KEY}`,
    `sigunguCd=${sigunguCd}`,
    `bjdongCd=${bjdongCd}`,
    `platGbCd=${platGbCd}`,
    `bun=${bun}`,
    `ji=${ji}`,
    `_type=json`,
    `numOfRows=100`,
    `pageNo=1`,
  ].join("&");

  const apiUrl = `https://apis.data.go.kr/1613000/BldRgstHubService/${endpoint}?${qs}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `외부 API 오류 (${res.status})`, raw: errText.slice(0, 300) }, 502);
    }

    const body = await res.text();
    if (!body || body.trim() === "") return json({ error: "빈 응답" }, 502);
    if (body.trim().startsWith("<")) {
      return json({ error: "XML 오류 응답 (서비스키 또는 파라미터 문제)", raw: body.slice(0, 300) }, 502);
    }

    try {
      return json(JSON.parse(body));
    } catch {
      return json({ error: "응답 파싱 실패", raw: body.slice(0, 300) }, 502);
    }
  } catch (err) {
    return json({ error: `fetch 실패: ${(err as Error).message}` }, 500);
  }
}

// ===== 지오코더 =====
async function handleGeocode(url: URL): Promise<Response> {
  const address = url.searchParams.get("address");
  if (!address) return json({ error: "address 파라미터 필요" }, 400);
  if (!VWORLD_KEY) return json({ error: "VWORLD_KEY 환경변수 없음" }, 500);

  for (const type of ["ROAD", "PARCEL"]) {
    const params = new URLSearchParams({
      service: "address", request: "getCoord", version: "2.0",
      crs: "EPSG:4326", address, refine: "true", simple: "false",
      format: "json", type, key: VWORLD_KEY,
    });
    try {
      const res = await fetch(`https://api.vworld.kr/req/address?${params}`, { headers: vworldHeaders() });
      const data = await res.json();
      if (data?.response?.status === "OK") return json(data);
    } catch { /* 다음 타입 시도 */ }
  }

  return json({ error: "주소를 찾을 수 없습니다" }, 404);
}

// ===== 진단 =====
async function handleTest(url: URL): Promise<Response> {
  const target = url.searchParams.get("target") ?? "httpbin";
  const results: Record<string, unknown> = {};

  if (target === "httpbin" || target === "all") {
    results.httpbin = await probe("https://httpbin.org/get", { "User-Agent": "DenoWorker/diagnostic" });
  }
  if (target === "vworld" || target === "all") {
    const vworldUrl = `https://api.vworld.kr/req/wfs?key=${VWORLD_KEY}&domain=building-counter.ganghee1461-lang.deno.net&service=WFS&version=2.0.0&request=GetCapabilities`;
    results.vworld = await probe(vworldUrl, vworldHeaders());
  }

  return json(results);
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const start = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - start, bodyPreview: body.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: (err as Error).message, ms: Date.now() - start };
  }
}

// ===== 헬퍼 =====
function vworldHeaders(): Record<string, string> {
  return {
    Referer: "https://building-counter.ganghee1461-lang.deno.net/",
    Origin:  "https://building-counter.ganghee1461-lang.deno.net",
    "User-Agent": "Mozilla/5.0 (compatible; DenoWorker)",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(msg: string, status = 200): Response {
  return new Response(msg, { status, headers: CORS });
}
