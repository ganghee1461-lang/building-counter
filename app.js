/* ============================================
   건축물 세대수 집계기 v3
   - PNU 기준 중복 제거
   - 전체 0이면 일반용 1호 처리
============================================ */

const CONFIG = {
  BUILDING_LAYER: 'lt_c_spbd',
  INITIAL_CENTER: [127.4890, 36.6357],
  INITIAL_ZOOM: 15,
  MIN_LOAD_ZOOM: 15,
  MAX_FEATURES: 500,
};

const state = {
  selectedFeatures: new Map(), // key: PNU
  loading: new Set(),
};

// ===== 지도 초기화 =====
const baseLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: '/api/wmts?layer=Base&z={z}&y={y}&x={x}',
    attributions: '© <a href="https://www.vworld.kr/">VWorld</a>',
    crossOrigin: 'anonymous',
  }),
});

const buildingSource = new ol.source.Vector();
window.buildingSource = buildingSource;

const defaultStyle  = new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(45,65,95,0.18)' }), stroke: new ol.style.Stroke({ color: '#2d415f', width: 1 }) });
const hoverStyle    = new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(255,107,26,0.25)' }), stroke: new ol.style.Stroke({ color: '#ff6b1a', width: 1.5 }) });
const selectedStyle = new ol.style.Style({ fill: new ol.style.Fill({ color: 'rgba(255,107,26,0.55)' }), stroke: new ol.style.Stroke({ color: '#ff6b1a', width: 2.5 }) });

const buildingLayer = new ol.layer.Vector({
  source: buildingSource,
  style: (f) => {
    const pnu = f.get('pnu');
    return state.selectedFeatures.has(pnu) ? selectedStyle : defaultStyle;
  },
});

const map = new ol.Map({
  target: 'map',
  layers: [baseLayer, buildingLayer],
  view: new ol.View({
    center: ol.proj.fromLonLat(CONFIG.INITIAL_CENTER),
    zoom: CONFIG.INITIAL_ZOOM,
    minZoom: 8, maxZoom: 19,
  }),
  controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: false } }),
});
window.map = map;

// ===== 유틸 =====
function getSelectionKey(f) {
  return f.get('pnu') || f.get('pk') || f.getId();
}

function getBuildingName(f) {
  return f.get('buld_nm') || f.get('buld_nm_dc') || '(건물명 없음)';
}

function getBuildingAddress(f) {
  return [f.get('sido'), f.get('sigungu'), f.get('gu'), f.get('rd_nm'), f.get('buld_no')]
    .filter(Boolean).join(' ') || '주소 정보 없음';
}

// ===== PNU 파싱 =====
function parsePnu(pnu) {
  if (!pnu) return null;
  const c = String(pnu).replace(/[^0-9]/g, '');
  if (c.length < 19) return null;
  return {
    sigunguCd: c.substring(0, 5),
    bjdongCd:  c.substring(5, 10),
    platGbCd:  c.substring(10, 11) === '2' ? '1' : '0',
    bun:       c.substring(11, 15),
    ji:        c.substring(15, 19),
  };
}

// ===== 계량기 수 계산 =====
function calcMeters(item) {
  const cd   = String(item.mainPurpsCd || '').padStart(5, '0');
  const nm   = String(item.mainPurpsCdNm || '');
  const hhld = parseInt(item.hhldCnt  || 0, 10);
  const ho   = parseInt(item.hoCnt    || 0, 10);
  const fmly = parseInt(item.fmlyCnt  || 0, 10);

  if (['01000','01001','01002'].includes(cd)) {
    return { type: 'single', label: '단독주택', meters: fmly > 0 ? fmly : hhld > 0 ? hhld : 0 };
  }
  const isOneroom = ['01003','02003','02004'].includes(cd) ||
    ['고시원','다중생활','기숙사','노인복지','노인요양'].some(k => nm.includes(k));
  if (isOneroom) {
    const cnt = fmly > 0 ? fmly : hhld > 0 ? hhld : ho;
    return { type: 'oneroom', label: '원룸', meters: cnt };
  }
  if (['02000','02001','02002'].includes(cd)) {
    return { type: 'apartment', label: '공동주택', meters: hhld > 0 ? hhld : ho };
  }
  return { type: 'commercial', label: '일반용', meters: ho };
}

// ===== 건축HUB API 조회 =====
async function fetchBuildingInfo(feature) {
  const pnu    = feature.get('pnu');
  const parsed = parsePnu(pnu);
  if (!parsed) return { error: `PNU 파싱 실패: ${pnu}` };

  try {
    let params = new URLSearchParams({ ...parsed, endpoint: 'getBrTitleInfo' });
    let res    = await fetch(`/api/bldg?${params}`);
    if (!res.ok) throw new Error(`API 오류 (${res.status})`);
    let data   = await res.json();
    let items  = extractItems(data);

    if (items.length === 0) {
      params = new URLSearchParams({ ...parsed, endpoint: 'getBrRecapTitleInfo' });
      res    = await fetch(`/api/bldg?${params}`);
      data   = await res.json();
      items  = extractItems(data);
      if (items.length === 0) return { error: '건축물대장 미등록' };
    }

    return buildResult(items, feature);
  } catch (err) {
    return { error: err.message };
  }
}

function extractItems(data) {
  const body = data?.response?.body;
  if (!body || body.totalCount == 0 || !body.items) return [];
  const item = body.items.item;
  return Array.isArray(item) ? item : [item];
}

function buildResult(items, feature) {
  const groups = {};
  for (const it of items) {
    const { type, label, meters } = calcMeters(it);
    if (!groups[type]) groups[type] = { type, label, meters: 0 };
    groups[type].meters += meters;
  }

  let breakdown = Object.values(groups);
  let totalMeters = breakdown.reduce((s, g) => s + g.meters, 0);

  if (totalMeters === 0) {
    breakdown = [{ type: 'commercial', label: '일반용', meters: 1 }];
    totalMeters = 1;
  }

  const names  = [...new Set(items.map(it => it.bldNm).filter(Boolean))];
  const addrs  = [...new Set(items.map(it => it.newPlatPlc || it.platPlc).filter(Boolean))];

  return {
    name:        names.join(', ') || getBuildingName(feature),
    address:     addrs[0]         || getBuildingAddress(feature),
    totalMeters,
    breakdown,
    hhld: items.reduce((s, it) => s + parseInt(it.hhldCnt || 0, 10), 0),
    ho:   items.reduce((s, it) => s + parseInt(it.hoCnt   || 0, 10), 0),
    fmly: items.reduce((s, it) => s + parseInt(it.fmlyCnt || 0, 10), 0),
  };
}

// ===== 선택 처리 =====
function toggleSelection(f) {
  const key = getSelectionKey(f);
  if (!key) return;

  if (state.selectedFeatures.has(key)) {
    state.selectedFeatures.delete(key);
  } else {
    state.selectedFeatures.set(key, { feature: f, info: null });
    queueLookup(key, f);
  }
  buildingLayer.changed();
  renderList();
  updateSummary();
}

function selectMany(features) {
  let added = 0;
  for (const f of features) {
    const key = getSelectionKey(f);
    if (!key || state.selectedFeatures.has(key)) continue;
    state.selectedFeatures.set(key, { feature: f, info: null });
    queueLookup(key, f);
    added++;
  }
  buildingLayer.changed();
  renderList();
  updateSummary();
  return added;
}

function clearSelection() {
  state.selectedFeatures.clear();
  buildingLayer.changed();
  renderList();
  updateSummary();
}

function rerenderSelections() {
  const byPnu = new Map();
  for (const f of buildingSource.getFeatures()) {
    const key = getSelectionKey(f);
    if (key) byPnu.set(key, f);
  }
  for (const [key, entry] of state.selectedFeatures) {
    if (byPnu.has(key)) entry.feature = byPnu.get(key);
  }
  buildingLayer.changed();
}

// ===== API 큐 =====
const lookupQueue = [];
let activeLookups = 0;
const MAX_CONCURRENT = 4;

function queueLookup(key, f) { lookupQueue.push({ key, feature: f }); processQueue(); }

async function processQueue() {
  while (lookupQueue.length > 0 && activeLookups < MAX_CONCURRENT) {
    const { key, feature } = lookupQueue.shift();
    if (!state.selectedFeatures.has(key)) continue;
    activeLookups++;
    state.loading.add(key);
    renderList();
    fetchBuildingInfo(feature).then(info => {
      activeLookups--;
      state.loading.delete(key);
      if (state.selectedFeatures.has(key)) state.selectedFeatures.get(key).info = info;
      renderList();
      updateSummary();
      processQueue();
    });
  }
}

// ===== 용도 뱃지 =====
const TYPE_STYLE = {
  apartment:  { bg: '#1a3a6e', color: '#7ab4ff', text: '공동주택' },
  single:     { bg: '#1a4a2e', color: '#6ddb97', text: '단독주택' },
  oneroom:    { bg: '#3a2a6e', color: '#b47aff', text: '원룸'     },
  commercial: { bg: '#4a2a1a', color: '#ffaa4a', text: '일반용'   },
};

function typeBadge(type) {
  const s = TYPE_STYLE[type] || TYPE_STYLE.commercial;
  return `<span class="type-badge" style="background:${s.bg};color:${s.color}">${s.text}</span>`;
}

// ===== UI 렌더링 =====
function renderList() {
  const ul        = document.getElementById('selectionList');
  const empty     = document.getElementById('emptyState');
  const listCount = document.getElementById('listCount');
  ul.innerHTML    = '';

  const entries = Array.from(state.selectedFeatures.entries());
  listCount.textContent = entries.length;
  empty.style.display   = entries.length === 0 ? '' : 'none';

  for (const [key, { feature, info }] of entries) {
    const li = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'item-head';
    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = info?.name || getBuildingName(feature);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'item-remove';
    removeBtn.textContent = '✕';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      state.selectedFeatures.delete(key);
      buildingLayer.changed();
      renderList();
      updateSummary();
    };
    head.appendChild(nameEl);
    head.appendChild(removeBtn);
    li.appendChild(head);

    const addr = document.createElement('div');
    addr.className = 'item-addr';
    addr.textContent = info?.address || getBuildingAddress(feature);
    li.appendChild(addr);

    if (state.loading.has(key)) {
      li.insertAdjacentHTML('beforeend', `<div class="item-loading">⟳ 건축물대장 조회 중...</div>`);
    } else if (info?.error) {
      li.classList.add('error');
      li.insertAdjacentHTML('beforeend', `<div class="item-error">⚠ ${info.error}</div>`);
    } else if (info) {
      const breakdownHtml = info.breakdown.map(g =>
        `${typeBadge(g.type)} <strong>${g.meters}</strong>개`
      ).join('  ');
      li.insertAdjacentHTML('beforeend', `
        <div class="item-breakdown">${breakdownHtml}</div>
        <div class="item-total">계량기 합계 <strong>${info.totalMeters}</strong>개</div>
      `);
    }

    li.onclick = () => {
      const ext = feature.getGeometry().getExtent();
      map.getView().fit(ext, { duration: 400, maxZoom: 18, padding: [50,50,50,50] });
    };
    ul.appendChild(li);
  }
}

function updateSummary() {
  let total = 0;
  const byType = { apartment: 0, single: 0, oneroom: 0, commercial: 0 };

  for (const [, { info }] of state.selectedFeatures) {
    if (info && !info.error && info.breakdown) {
      total += info.totalMeters;
      for (const g of info.breakdown) {
        if (byType[g.type] !== undefined) byType[g.type] += g.meters;
      }
    }
  }

  document.getElementById('sumCount').textContent  = state.selectedFeatures.size.toLocaleString();
  document.getElementById('sumHhld').textContent   = total.toLocaleString();
  document.getElementById('sumApartment').textContent  = byType.apartment.toLocaleString();
  document.getElementById('sumSingle').textContent     = byType.single.toLocaleString();
  document.getElementById('sumOneroom').textContent    = byType.oneroom.toLocaleString();
  document.getElementById('sumCommercial').textContent = byType.commercial.toLocaleString();

  ['apartment','single','oneroom','commercial'].forEach(t => {
    document.getElementById(`row-${t}`).style.opacity = byType[t] === 0 ? '0.35' : '1';
  });
}

// ===== WFS 로딩 =====
async function loadBuildings() {
  const view = map.getView();
  const zoom = view.getZoom();
  if (zoom < CONFIG.MIN_LOAD_ZOOM) {
    showToast(`줌 ${CONFIG.MIN_LOAD_ZOOM} 이상에서 사용하세요 (현재 ${zoom.toFixed(1)})`, 'warn');
    return;
  }
  const extent = view.calculateExtent(map.getSize());
  const b = ol.proj.transformExtent(extent, 'EPSG:3857', 'EPSG:4326');
  setLoading(true, '건물 로딩 중...');
  try {
    const url = `/api/buildings?bbox=${b[1]},${b[0]},${b[3]},${b[2]}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`WFS 오류 (${res.status})`);
    const gj = await res.json();
    if (!gj.features?.length) {
      showToast('이 영역에 건물 없음', 'warn');
      buildingSource.clear();
      setStatus('건물 0건');
      return;
    }
    buildingSource.clear();
    const features = new ol.format.GeoJSON().readFeatures(gj, {
      dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857',
    });
    buildingSource.addFeatures(features);
    setStatus(`건물 ${features.length}건 표시 중`);
    rerenderSelections();
  } catch (err) {
    showToast(`건물 조회 실패: ${err.message}`, 'error');
    setStatus('조회 실패');
  } finally {
    setLoading(false);
  }
}

// ===== 상호작용 =====
const dragBox = new ol.interaction.DragBox({ condition: ol.events.condition.shiftKeyOnly });

dragBox.on('boxend', () => {
  const extent = dragBox.getGeometry().getExtent();
  const candidates = buildingSource.getFeatures().filter(f =>
    ol.extent.intersects(extent, f.getGeometry().getExtent())
  );
  if (!candidates.length) { showToast('영역 내 건물 없음', 'warn'); return; }
  const added = selectMany(candidates);
  const skipped = candidates.length - added;
  const msg = skipped > 0
    ? `${added}개 선택됨 (중복 ${skipped}개 제외)`
    : `${added}개 건물 선택됨`;
  showToast(msg);
});

map.addInteraction(dragBox);

map.on('singleclick', evt => {
  if (ol.events.condition.shiftKeyOnly(evt)) return;
  const isCtrl = ol.events.condition.platformModifierKeyOnly(evt);
  let hit = null;
  map.forEachFeatureAtPixel(evt.pixel, (f, l) => { if (l === buildingLayer) { hit = f; return true; } });
  if (!hit) return;
  if (!isCtrl) state.selectedFeatures.clear();
  toggleSelection(hit);
});

let hovered = null;
map.on('pointermove', evt => {
  if (evt.dragging) return;
  const f = map.forEachFeatureAtPixel(
    map.getEventPixel(evt.originalEvent),
    (feat, l) => l === buildingLayer ? feat : null
  );
  map.getTargetElement().style.cursor = f ? 'pointer' : '';
  if (hovered !== f) {
    if (hovered) hovered.setStyle(undefined);
    if (f) {
      const key = getSelectionKey(f);
      if (!state.selectedFeatures.has(key)) f.setStyle(hoverStyle);
    }
    hovered = f;
  }
});

// ===== UI 이벤트 =====
document.getElementById('clearBtn').onclick  = clearSelection;
document.getElementById('reloadBtn').onclick = loadBuildings;
document.getElementById('exportBtn').onclick = exportCSV;
document.getElementById('searchBtn').onclick = searchAddress;
document.getElementById('searchInput').onkeydown = e => { if (e.key === 'Enter') searchAddress(); };

async function searchAddress() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  setLoading(true, '주소 검색 중...');
  try {
    const res  = await fetch(`/api/geocode?address=${encodeURIComponent(q)}`);
    const data = await res.json();
    const pt   = data?.response?.result?.point;
    if (!pt) throw new Error('주소를 찾을 수 없습니다');
    map.getView().animate({
      center: ol.proj.fromLonLat([parseFloat(pt.x), parseFloat(pt.y)]),
      zoom: 17, duration: 600,
    });
    setTimeout(loadBuildings, 700);
  } catch (err) { showToast(err.message, 'error'); }
  finally { setLoading(false); }
}

function exportCSV() {
  if (!state.selectedFeatures.size) { showToast('선택된 건물 없음', 'warn'); return; }
  const rows = [['번호','건물명','주소','계량기합계','공동주택','단독주택','원룸','일반용']];
  let i = 1;
  for (const [, { info, feature }] of state.selectedFeatures) {
    const bd  = info?.breakdown || [];
    const get = t => (bd.find(g => g.type === t)?.meters ?? '');
    rows.push([
      i++,
      info?.name || getBuildingName(feature),
      info?.address || getBuildingAddress(feature),
      info?.totalMeters ?? '',
      get('apartment'), get('single'), get('oneroom'), get('commercial'),
    ]);
  }
  const csv  = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `계량기집계_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('CSV 다운로드 완료');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3000);
}
function setLoading(on, msg) { document.getElementById('loadIndicator').hidden = !on; if (msg) setStatus(msg); }
function setStatus(msg) { document.getElementById('statusMsg').textContent = msg; }

setStatus('지도 로딩 완료. 줌인 후 "이 영역 건물 불러오기" 클릭');
