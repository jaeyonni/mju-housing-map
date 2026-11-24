# 명지대학교 자연캠퍼스 자취 입지 건물 추천 웹 지도 (`mju-housing-map`)

경기도 용인시 처인구 **역북동·남동 주거용 건물 1,910동**을 대상으로, 7개 GIS 입지 요소의 가중치를 실시간으로 조절해 나에게 맞는 최적 자취 건물을 탐색할 수 있는 **정적 웹 GIS 애플리케이션**입니다. (GIS 오전반 3조 최종 통합 데이터 기반)

---

## 주요 기능

- **실시간 7요소 가중 중첩 (Client-side Weighted Overlay)**
  - `가격`, `통학`, `편의`, `소음`, `경사`, `연식`, `치안` 7개 슬라이더를 움직이면 브라우저에서 1,910개 건물의 종합 점수와 추천 순위가 지연 없이 즉시 재계산됩니다.
  - **설문·시나리오 프리셋**: `전체(70명 보정)`, `남성 설문(n=40)`, `여성 설문(n=30)`, `가성비·통학`, `안심·편의`, `신축·저소음` 원클릭 전환을 지원합니다.
- **고성능 Canvas 벡터 지도 & 겹침 방지 라벨**
  - 건물 폴리곤 1,910동과 4단계 거리 반경(`직선 0.8km / 1.6km / 2.4km / 3.2km`), `명지대 정문` 기준점을 커스텀 HiDPI Canvas로 렌더링합니다.
  - `총점(Viridis)` vs `환산월세(싼 곳이 진하게)` 색상 모드 및 건물 위 텍스트(`없음 / 점수 / 월세 / 둘 다`) 전환 시 화면 겹침을 자동 회피합니다.
- **다중 필터 & 건물 상세 리포트**
  - 행정동(`역북동` / `남동`), 주거 유형(`원룸/다가구`, `빌라/다세대`, `오피스텔`, `아파트`), 도로 평균 환산월세 예산 상한, 건물명/도로명 검색을 동시에 조합할 수 있습니다.
  - 건물을 클릭하면 7개 요소별 점수(1~5점) 막대 그래프, 준공연도·층수·경사도·정문 직선거리 및 네이버/카카오 지도 검색 링크를 확인할 수 있습니다.
- **일반지도 기본 배경 & 보조 GIS 레이어**
  - 별도 API 키가 필요 없는 **OpenStreetMap 일반지도**를 기본 배경으로 사용하며, 우상단 도구바에서 `생활권(7개 권역)`, `경전철·주요시설`, `도로별 평균 시세(47개 도로)`를 켜고 끌 수 있습니다.

---

## 폴더 구조

```text
mju-housing-map/
├── index.html                 # 메인 진입점 (GitHub Pages 호환 상대경로)
├── .nojekyll                   # GitHub Pages Jekyll 비활성화
├── .gitignore
├── css/
│   └── style.css              # 라이트 카토그래피 테마 및 반응형 드로어 UI
├── js/
│   ├── app.js                 # 상태 관리, 7요소 가중 계산, 필터, 상세 패널
│   ├── mapRenderer.js         # Leaflet + HiDPI Canvas 건물 렌더러 & 히트 테스트
│   └── colorScale.js          # Viridis·역방향 월세 컬러 램프 및 포맷터
├── data/
│   ├── buildings.json         # 주거용 건물 1,910동 (WGS84 폴리곤 + 7개 점수 + 메타)
│   ├── context.json           # 행정동 경계, 수계, 도로 중심선, 배경 건물, 경전철·시설
│   ├── micro_zones.geojson    # 7개 세부 생활권 통계 폴리곤
│   ├── roads_rent.geojson     # 실거래 기반 47개 도로 평균 환산월세
│   ├── weights_presets.json   # 설문·페르소나 가중치 프리셋
│   └── manifest.json          # 데이터셋 메타데이터
└── scripts/
    └── build_site_data.py     # 통합 GIS 산출물에서 data/ 재생성용 스크립트
```

---

## 로컬에서 미리보기

정적 `fetch('./data/...')`를 사용하므로 `file://`로 직접 열지 말고 간단한 로컬 HTTP 서버로 실행해야 합니다.

```bash
cd mju-housing-map
python -m http.server 8000
```

브라우저에서 `http://localhost:8000`으로 접속하면 바로 확인할 수 있습니다.

---

## GitHub 레포지토리 업로드 및 GitHub Pages 배포 방법

별도 빌드(`npm run build` 등) 없이 **저장소 루트를 그대로 GitHub Pages로 배포**할 수 있습니다.

1. GitHub에서 새 저장소(예: `mju-housing-map`)를 생성합니다.
2. 로컬 폴더에서 Git 초기화 후 푸시합니다:
   ```bash
   cd E:\jae\gis\mju-housing-map
   git init -b main
   git add .
   git commit -m "Initial commit: MJU housing suitability interactive web map"
   git remote add origin https://github.com/<아이디>/mju-housing-map.git
   git push -u origin main
   ```
3. GitHub 저장소의 **Settings → Pages** 메뉴로 이동합니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로 두고, Branch를 `main` / `/ (root)`로 선택한 뒤 **Save**를 누릅니다.
5. 1~2분 뒤 `https://<아이디>.github.io/mju-housing-map/` 주소에서 팀원들과 바로 공유해 사용할 수 있습니다.
