/* ============================================
   건축물 세대수 집계기
   - OpenLayers 기반 지도
   - 브이월드 WFS로 건물 폴리곤 로딩
   - 건축HUB API로 세대수 조회
============================================ */

// ===== 설정 =====
const CONFIG = {
  // 브이월드 WFS 도로명주소건물 레이어
  // (만약 작동 안 하면 'lp_pa_cbnd_bubun' 등 다른 이름 시도)
  BUILDING_LAYER: 'lt_c_spbd',
  // 초기 위치: 청주시 중심
  INITIAL_CENTER: [127.4890, 36.6357],
  INITIAL_ZOOM: 15,
  // 건물 폴리곤 로딩 최소 줌 레벨
  MIN_LOAD_ZOOM: 15,
  // WFS 한번에 가져올 최대 건물 수
  MAX_FEATURES: 500,
};

// ===== 전역 상태 =====
const state = {
  selectedFeatures: new Map(),  // mgmBldrgstPk -> { feature, info }
  loading: new Set(),
};

// ===== OpenLayers 지도 초기화 =====
const VWORLD_BASE = '/api/wmts?layer=Base&z={z}&y={y}&x={x}';

const baseLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: VWORLD_BASE,
    attributions: '© <a href="https://www.vworld.kr/">VWorld</a>',
    crossOrigin: 'anonymous',
  }),
});

// 건물 폴리곤 벡터 소스 (수동 갱신)
const buildingSource = new ol.source.Vector();

// 스타일: 일반 / 호버 / 선택
const defaultStyle = new ol.style.Style({
  fill: new ol.style.Fill({ color: 'rgba(45, 65, 95, 0.18)' }),
  stroke: new ol.style.Stroke({ color: '#2d415f', width: 1 }),
});

const hoverStyle = new ol.style.Style({
  fill: new ol.style.Fill({ color: 'rgba(255, 107, 26, 0.25)' }),
  stroke: new ol.style.Stroke({ color: '#ff6b1a', width: 1.5 }),
});

const selectedStyle = new ol.style.Style({
  fill: new ol.style.Fill({ color: 'rgba(255, 107, 26, 0.55)' }),
  stroke: new ol.style.Stroke({ color: '#ff6b1a', width: 2.5 }),
});

const buildingLayer = new ol.layer.Vector({
  source: buildingSource,
  style: (feature) => {
    const id = getFeatureId(feature);
    if (state.selectedFeatures.has(id)) return selectedStyle;
    return defaultStyle;
  },
});

const map = new ol.Map({
  target: 'map',
  layers: [baseLayer, buildingLayer],
  view: new ol.View({
    center: ol.proj.fromLonLat(CONFIG.INITIAL_CENTER),
    zoom: CONFIG.INITIAL_ZOOM,
    minZoom: 8,
    maxZoom: 19,
  }),
  controls: ol.control.defaults.defaults({
    attributionOptions: { collapsible: false },
  }),
});

// ===== 유틸: feature ID 추출 =====
function getFeatureId(feature) {
  // 건물관리번호를 키로 사용
  return feature.get('mgmBldrgstPk') ||
         feature.get('bldMgtNo') ||
         feature.get('bld_mgt_no') ||
         feature.get('mngBldrgstPk') ||
         feature.getId() ||
         JSON.stringify(feature.getGeometry().getExtent());
}

// ===== 건물관리번호 파싱 =====
// 예: "43111-1-00010001" or "4311100000-1-00010001-XX..." 형태
function parseBldMgtNo(mgtNo) {
  if (!mgtNo) return null;
  // 숫자만 추출 (대시 등 제거)
  const clean = String(mgtNo).replace(/[^0-9]/g, '');
  if (clean.length < 19) return null;

  return {
    sigunguCd: clean.substring(0, 5),
    bjdongCd: clean.substring(5, 10),
    platGbCd: clean.substring(10, 11),
    bun: clean.substring(11, 15),
    ji: clean.substring(15, 19),
  };
}

// ===== WFS로 건물 폴리곤 가져오기 =====
async function loadBuildings() {
  const view = map.getView();
  const zoom = view.getZoom();

  if (zoom < CONFIG.MIN_LOAD_ZOOM) {
    showToast(`줌 레벨 ${CONFIG.MIN_LOAD_ZOOM} 이상에서 건물이 표시됩니다 (현재: ${zoom.toFixed(1)})`, 'warn');
    return;
  }

  const extent = view.calculateExtent(map.getSize());
  // EPSG:3857 → EPSG:4326
  const bbox4326 = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
  const [minX, minY, maxX, maxY] = bbox4326;

  setLoading(true, '건물 폴리곤 조회 중...');

  try {
    const url = `/api/wfs?bbox=${minY},${minX},${maxY},${maxX}&typename=${CONFIG.BUILDING_LAYER}&maxFeatures=${CONFIG.MAX_FEATURES}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`WFS 응답 오류 (${res.status})`);

    const geojson = await res.json();
    if (!geojson.features || geojson.features.length === 0) {
      showToast('해당 영역에 건물 데이터가 없습니다', 'warn');
      buildingSource.clear();
      setStatus(`건물 0건`);
      return;
    }

    // GeoJSON → OpenLayers Feature
    buildingSource.clear();
    const reader = new ol.format.GeoJSON();
    const features = reader.readFeatures(geojson, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    buildingSource.addFeatures(features);

    setStatus(`건물 ${features.length}건 표시 중`);

    // 선택 상태 복원 (이미 선택된 건물 다시 표시)
    rerenderSelections();
  } catch (err) {
    console.error(err);
    showToast(`건물 조회 실패: ${err.message}`, 'error');
    setStatus('조회 실패');
  } finally {
    setLoading(false);
  }
}

// ===== 건축HUB API로 세대수 조회 =====
async function fetchBuildingInfo(feature) {
  const mgtNo = feature.get('mgmBldrgstPk') ||
                feature.get('bldMgtNo') ||
                feature.get('bld_mgt_no') ||
                feature.get('mngBldrgstPk');

  const parsed = parseBldMgtNo(mgtNo);
  if (!parsed) {
    return { error: '건물관리번호 파싱 실패' };
  }

  try {
    // 1) 표제부 먼저 (동별 정보)
    const params = new URLSearchParams({
      ...parsed,
      endpoint: 'getBrTitleInfo',
    });
    const res = await fetch(`/api/bldg?${params}`);
    if (!res.ok) throw new Error(`API 응답 오류 (${res.status})`);

    const data = await res.json();
    const items = extractItems(data);

    if (items.length === 0) {
      // 2) 표제부 없으면 총괄표제부 시도
      const params2 = new URLSearchParams({
        ...parsed,
        endpoint: 'getBrRecapTitleInfo',
      });
      const res2 = await fetch(`/api/bldg?${params2}`);
      const data2 = await res2.json();
      const items2 = extractItems(data2);
      if (items2.length === 0) {
        return { error: '건축물대장 미등록' };
      }
      return summarizeItems(items2);
    }

    return summarizeItems(items);
  } catch (err) {
    console.error(err);
    return { error: err.message };
  }
}

function extractItems(data) {
  // 공공데이터 응답 구조: response.body.items.item
  const body = data?.response?.body;
  if (!body || body.totalCount == 0 || !body.items) return [];
  const item = body.items.item;
  return Array.isArray(item) ? item : [item];
}

function summarizeItems(items) {
  let hhld = 0, ho = 0, fmly = 0;
  const names = [];
  const addrs = [];

  for (const it of items) {
    hhld += parseInt(it.hhldCnt || 0, 10);
    ho += parseInt(it.hoCnt || 0, 10);
    fmly += parseInt(it.fmlyCnt || 0, 10);
    if (it.bldNm) names.push(it.bldNm);
    if (it.newPlatPlc) addrs.push(it.newPlatPlc);
    else if (it.platPlc) addrs.push(it.platPlc);
  }

  return {
    name: [...new Set(names)].join(', ') || '건물',
    address: [...new Set(addrs)][0] || '',
    hhld, ho, fmly,
    dongCount: items.length,
  };
}

// ===== 선택 처리 =====
function toggleSelection(feature) {
  const id = getFeatureId(feature);
  if (state.selectedFeatures.has(id)) {
    state.selectedFeatures.delete(id);
  } else {
    state.selectedFeatures.set(id, { feature, info: null });
    // 비동기로 세대수 조회
    queueLookup(id, feature);
  }
  buildingLayer.changed();
  renderList();
  updateSummary();
}

function selectMany(features) {
  for (const f of features) {
    const id = getFeatureId(f);
    if (!state.selectedFeatures.has(id)) {
      state.selectedFeatures.set(id, { feature: f, info: null });
      queueLookup(id, f);
    }
  }
  buildingLayer.changed();
  renderList();
  updateSummary();
}

function clearSelection() {
  state.selectedFeatures.clear();
  buildingLayer.changed();
  renderList();
  updateSummary();
}

function rerenderSelections() {
  // 지도 갱신 후 selectedFeatures의 feature 참조 업데이트
  const currentFeatures = buildingSource.getFeatures();
  const byId = new Map();
  for (const f of currentFeatures) {
    byId.set(getFeatureId(f), f);
  }
  for (const [id, entry] of state.selectedFeatures) {
    if (byId.has(id)) entry.feature = byId.get(id);
  }
  buildingLayer.changed();
}

// ===== API 호출 큐 (동시 호출 제한) =====
const lookupQueue = [];
let activeLookups = 0;
const MAX_CONCURRENT = 4;

function queueLookup(id, feature) {
  lookupQueue.push({ id, feature });
  processQueue();
}

async function processQueue() {
  while (lookupQueue.length > 0 && activeLookups < MAX_CONCURRENT) {
    const { id, feature } = lookupQueue.shift();
    if (!state.selectedFeatures.has(id)) continue;
    activeLookups++;
    state.loading.add(id);
    renderList();

    fetchBuildingInfo(feature).then((info) => {
      activeLookups--;
      state.loading.delete(id);
      if (state.selectedFeatures.has(id)) {
        state.selectedFeatures.get(id).info = info;
      }
      renderList();
      updateSummary();
      processQueue();
    });
  }
}

// ===== UI 렌더링 =====
function renderList() {
  const ul = document.getElementById('selectionList');
  const empty = document.getElementById('emptyState');
  const listCount = document.getElementById('listCount');
  ul.innerHTML = '';

  const entries = Array.from(state.selectedFeatures.entries());
  listCount.textContent = entries.length;

  if (entries.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  for (const [id, { feature, info }] of entries) {
    const li = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'item-head';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = info?.name || feature.get('bldNm') || feature.get('buld_nm') || '(건물명 없음)';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-remove';
    removeBtn.textContent = '✕';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      state.selectedFeatures.delete(id);
      buildingLayer.changed();
      renderList();
      updateSummary();
    };
    head.appendChild(name);
    head.appendChild(removeBtn);
    li.appendChild(head);

    const addr = document.createElement('div');
    addr.className = 'item-addr';
    addr.textContent = info?.address ||
                      feature.get('newPlatPlc') ||
                      feature.get('road_addr') ||
                      feature.get('platPlc') ||
                      '주소 정보 없음';
    li.appendChild(addr);

    if (state.loading.has(id)) {
      const loading = document.createElement('div');
      loading.className = 'item-loading';
      loading.textContent = '⟳ 건축물대장 조회 중...';
      li.appendChild(loading);
    } else if (info?.error) {
      li.classList.add('error');
      const err = document.createElement('div');
      err.className = 'item-error';
      err.textContent = `⚠ ${info.error}`;
      li.appendChild(err);
    } else if (info) {
      const stats = document.createElement('div');
      stats.className = 'item-stats';
      stats.innerHTML = `
        <span>세대 <strong>${info.hhld}</strong></span>
        <span>호 <strong>${info.ho}</strong></span>
        <span>가구 <strong>${info.fmly}</strong></span>
        ${info.dongCount > 1 ? `<span>(${info.dongCount}개동)</span>` : ''}
      `;
      li.appendChild(stats);
    }

    // 클릭하면 해당 건물로 지도 이동
    li.onclick = () => {
      const ext = feature.getGeometry().getExtent();
      map.getView().fit(ext, { duration: 400, maxZoom: 18, padding: [50, 50, 50, 50] });
    };

    ul.appendChild(li);
  }
}

function updateSummary() {
  let totalHhld = 0, totalHo = 0, totalFmly = 0;
  for (const [, { info }] of state.selectedFeatures) {
    if (info && !info.error) {
      totalHhld += info.hhld;
      totalHo += info.ho;
      totalFmly += info.fmly;
    }
  }
  document.getElementById('sumCount').textContent = state.selectedFeatures.size.toLocaleString();
  document.getElementById('sumHhld').textContent = totalHhld.toLocaleString();
  document.getElementById('sumHo').textContent = totalHo.toLocaleString();
  document.getElementById('sumFmly').textContent = totalFmly.toLocaleString();
}

// ===== 상호작용: 드래그 박스 / 클릭 =====

// SHIFT+드래그 박스 선택
const dragBox = new ol.interaction.DragBox({
  condition: ol.events.condition.shiftKeyOnly,
  className: 'ol-dragbox',
});

dragBox.on('boxend', () => {
  const extent = dragBox.getGeometry().getExtent();
  const candidates = [];
  buildingSource.forEachFeatureIntersectingExtent(extent, (f) => {
    candidates.push(f);
  });
  if (candidates.length === 0) {
    showToast('영역 내 건물이 없습니다', 'warn');
    return;
  }
  selectMany(candidates);
  showToast(`${candidates.length}개 건물 선택됨`);
});

map.addInteraction(dragBox);

// 일반 클릭 / CTRL+클릭
map.on('singleclick', (evt) => {
  const isCtrl = ol.events.condition.platformModifierKeyOnly(evt);
  let hit = null;
  map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
    if (layer === buildingLayer) {
      hit = f;
      return true;
    }
  });
  if (!hit) return;

  if (isCtrl) {
    toggleSelection(hit);
  } else {
    // 단일 선택: 기존 비우고 이거만
    state.selectedFeatures.clear();
    toggleSelection(hit);
  }
});

// 호버 효과
let hovered = null;
map.on('pointermove', (evt) => {
  if (evt.dragging) return;
  const pixel = map.getEventPixel(evt.originalEvent);
  const f = map.forEachFeatureAtPixel(pixel, (feat, layer) => {
    return layer === buildingLayer ? feat : null;
  });
  map.getTargetElement().style.cursor = f ? 'pointer' : '';

  if (hovered !== f) {
    if (hovered) hovered.setStyle(undefined);
    if (f && !state.selectedFeatures.has(getFeatureId(f))) {
      f.setStyle(hoverStyle);
    }
    hovered = f;
  }
});

// ===== UI 이벤트 =====
document.getElementById('clearBtn').onclick = clearSelection;
document.getElementById('reloadBtn').onclick = loadBuildings;
document.getElementById('exportBtn').onclick = exportCSV;

document.getElementById('searchBtn').onclick = searchAddress;
document.getElementById('searchInput').onkeydown = (e) => {
  if (e.key === 'Enter') searchAddress();
};

async function searchAddress() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  setLoading(true, '주소 검색 중...');
  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error('검색 실패');
    const data = await res.json();
    const point = data?.response?.result?.point;
    if (!point) throw new Error('주소를 찾을 수 없습니다');
    const coord = ol.proj.fromLonLat([parseFloat(point.x), parseFloat(point.y)]);
    map.getView().animate({ center: coord, zoom: 17, duration: 600 });
    setTimeout(loadBuildings, 700);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

function exportCSV() {
  if (state.selectedFeatures.size === 0) {
    showToast('선택된 건물이 없습니다', 'warn');
    return;
  }
  const rows = [['번호', '건물명', '주소', '세대수', '호수', '가구수', '동개수']];
  let i = 1;
  for (const [, { info, feature }] of state.selectedFeatures) {
    rows.push([
      i++,
      info?.name || feature.get('bldNm') || '',
      info?.address || feature.get('newPlatPlc') || '',
      info?.hhld ?? '',
      info?.ho ?? '',
      info?.fmly ?? '',
      info?.dongCount ?? '',
    ]);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `건물세대수_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV 다운로드 완료');
}

// ===== 헬퍼: 토스트 / 로딩 =====
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.className = 'toast';
  }, 3000);
}

function setLoading(on, msg) {
  document.getElementById('loadIndicator').hidden = !on;
  if (msg) setStatus(msg);
}

function setStatus(msg) {
  document.getElementById('statusMsg').textContent = msg;
}

// ===== 초기 로딩 =====
setStatus('지도 로딩 완료. 줌인 후 "이 영역 건물 불러오기" 클릭');
