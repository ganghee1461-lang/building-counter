# 건축물 세대수 집계기

지도에서 건물을 드래그/클릭으로 선택하면 **세대수·호수·가구수**를 자동으로 집계해주는 웹 도구.
브이월드 도로명주소건물 WFS + 국토교통부 건축HUB API 사용.

## ✨ 기능

- **SHIFT + 드래그** → 영역 내 건물 한번에 선택
- **CTRL + 클릭** → 개별 건물 추가/제외
- **클릭** → 단일 건물 선택
- 선택된 건물의 세대수/호수/가구수 자동 조회
- 합계 표시 + **CSV 내보내기**
- 주소 검색으로 지도 이동

## 📦 배포 (GitHub + Cloudflare Pages)

### 1. GitHub 저장소에 푸시

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<본인계정>/building-counter.git
git push -u origin main
```

### 2. Cloudflare Pages 연동

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. GitHub 저장소 선택
3. 빌드 설정:
   - **Framework preset**: `None`
   - **Build command**: (비워둠)
   - **Build output directory**: `/`
4. **Deploy** 클릭

### 3. 환경변수 설정 (필수)

배포 후 Pages 프로젝트 → **Settings** → **Environment variables** → **Add variable**

| 이름 | 값 |
|------|-----|
| `VWORLD_KEY` | 브이월드 API 키 |
| `DATA_GO_KR_KEY` | 공공데이터포털 서비스키 (Decoding 형태) |

**Production**과 **Preview** 둘 다 추가하세요.

변수 추가 후 **재배포** 필요 (Deployments → 최신 배포 → ⋯ → Retry deployment).

### 4. 브이월드 도메인 등록

브이월드 API 키는 도메인 제한이 있어요:
[브이월드 마이페이지](https://www.vworld.kr/dev/v4dv_myapikey_s001.do) → 본인 키 → **사용 도메인 추가**
- Cloudflare Pages 도메인 (예: `building-counter.pages.dev`)
- 커스텀 도메인 쓰면 그것도

## 🛠 로컬 개발

Cloudflare Pages Functions를 로컬에서 테스트하려면 `wrangler` 필요:

```bash
npm install -g wrangler

# 환경변수 파일 만들기
cat > .dev.vars << EOF
VWORLD_KEY=여기에_브이월드키
DATA_GO_KR_KEY=여기에_공공데이터키
EOF

# 로컬 서버 실행
wrangler pages dev .
```

`http://localhost:8788` 에서 확인.

## 🧩 파일 구조

```
.
├── index.html              메인 UI
├── app.js                  OpenLayers + 선택 로직
├── style.css               스타일
├── functions/api/
│   ├── wfs.js              브이월드 WFS 프록시 (건물 폴리곤)
│   ├── wmts.js             브이월드 배경지도 타일 프록시
│   ├── geocode.js          주소 검색 프록시
│   └── bldg.js             건축HUB API 프록시 (세대수)
├── .gitignore
└── README.md
```

## ⚙️ 동작 원리

```
[지도 이동/줌] 
  → /api/wmts 로 배경지도 타일
  → "이 영역 건물 불러오기" 클릭 시 /api/wfs 로 건물 폴리곤 GeoJSON

[건물 선택]
  → feature.mgmBldrgstPk (건물관리번호 19자리) 파싱
  → sigunguCd, bjdongCd, platGbCd, bun, ji 추출
  → /api/bldg 로 건축HUB API 호출 (표제부 → 없으면 총괄표제부)
  → hhldCnt(세대), hoCnt(호), fmlyCnt(가구) 수집

[합계 표시 + CSV 내보내기]
```

## ⚠️ 알려진 제약

- **줌 15 이하**: 데이터가 너무 많아 건물 폴리곤 로딩 안 함
- **신축/멸실 건물**: WFS와 건축물대장 시점 차이로 일부 누락 가능
- **무허가 건물**: 건축물대장 자체가 없음 → "건축물대장 미등록" 표시
- **WFS 레이어 이름**: 만약 `lt_c_spbd` 로 안 되면 `app.js`의 `CONFIG.BUILDING_LAYER` 값 다른 걸로 시도 (예: `LT_C_SPBD`, `lp_pa_cbnd_bubun`)
- **요청 한도**: 브이월드/공공데이터 모두 일일 호출 제한 있음 (브이월드 4만건/일 기본)

## 📝 라이선스

자체 사용 용도. 공공 API 약관 준수.
