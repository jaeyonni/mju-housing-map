import { getScoreColor, getRentColor, getRoadRentColor } from './colorScale.js?v=4';

const MJU_GATE = [37.22677, 127.18804];
const RADIUS_METERS = [800, 1600, 2400, 3200];

const ZONE_PALETTE = [
  '#e0f2fe',
  '#dcfce7',
  '#fef9c3',
  '#f3e8ff',
  '#ffe4e6',
  '#ffedd5',
  '#e2e8f0',
];

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function boxesOverlap(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR, fillColor, strokeColor) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i += 1) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();
}

function destinationLatLon(lat, lon, distM, bearingDeg) {
  const R = 6371000.0;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const d = distM / R;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

class HousingCanvasLayer extends L.Layer {
  constructor(renderer) {
    super();
    this.renderer = renderer;
    this.canvas = null;
    this._padX = 0;
    this._padY = 0;
    this._drawnZoom = null;
    this._drawnTopLeftLatLng = null;
  }

  onAdd(map) {
    this._map = map;
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated housing-canvas-layer');
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.transformOrigin = '0 0';
    const pane = map.getPane('overlayPane');
    pane.appendChild(this.canvas);

    map.on('zoomanim', this._onZoomAnim, this);
    map.on('zoom', this._onZoom, this);
    map.on('move', this._onMove, this);
    map.on('moveend zoomend viewreset resize', this._reset, this);
    this._reset();
  }

  onRemove(map) {
    map.off('zoomanim', this._onZoomAnim, this);
    map.off('zoom', this._onZoom, this);
    map.off('move', this._onMove, this);
    map.off('moveend zoomend viewreset resize', this._reset, this);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this._map = null;
  }

  _updateTransform(center, zoom) {
    if (!this._map || !this.canvas || !this._drawnTopLeftLatLng || this._drawnZoom == null) return;
    const scale = this._map.getZoomScale(zoom, this._drawnZoom);
    const offset = this._map._latLngToNewLayerPoint(this._drawnTopLeftLatLng, zoom, center);
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  _onZoomAnim(e) {
    this._updateTransform(e.center, e.zoom);
  }

  _onZoom() {
    if (!this._map) return;
    this._updateTransform(this._map.getCenter(), this._map.getZoom());
  }

  _onMove() {
    if (!this._map || !this.canvas || this._drawnZoom == null || !this._drawnTopLeftLatLng) return;
    if (this._map._animatingZoom) return;
    const curZoom = this._map.getZoom();
    if (curZoom !== this._drawnZoom) {
      this._updateTransform(this._map.getCenter(), curZoom);
      return;
    }
    // 오버스캔 여유폭(35%)의 78% 이상 드래그했을 때만 재렌더링, 그 안에서는 GPU 패닝 유지
    const curTopLeft = this._map.containerPointToLayerPoint([0, 0]);
    const drawnOrigin = this._map.latLngToLayerPoint(this._drawnTopLeftLatLng);
    const driftX = Math.abs(curTopLeft.x - this._padX - drawnOrigin.x);
    const driftY = Math.abs(curTopLeft.y - this._padY - drawnOrigin.y);
    if (driftX > this._padX * 0.78 || driftY > this._padY * 0.78) {
      this._reset();
    }
  }

  _reset() {
    if (!this._map || !this.canvas) return;
    const size = this._map.getSize();
    const padX = Math.round(size.x * 0.35);
    const padY = Math.round(size.y * 0.35);
    const canvasW = Math.max(1, size.x + padX * 2);
    const canvasH = Math.max(1, size.y + padY * 2);

    this._padX = padX;
    this._padY = padY;
    this._drawnZoom = this._map.getZoom();
    this._drawnTopLeftLatLng = this._map.containerPointToLatLng([-padX, -padY]);

    const topLeft = this._map.containerPointToLayerPoint([-padX, -padY]);
    L.DomUtil.setTransform(this.canvas, topLeft, 1);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== canvasW * dpr || this.canvas.height !== canvasH * dpr) {
      this.canvas.width = canvasW * dpr;
      this.canvas.height = canvasH * dpr;
      this.canvas.style.width = `${canvasW}px`;
      this.canvas.style.height = `${canvasH}px`;
    }
    this.redraw();
  }

  redraw() {
    if (!this._map || !this.canvas) return;
    if (this._drawnZoom == null || this._drawnZoom !== this._map.getZoom()) {
      this._reset();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this._map.getSize();
    const canvasW = Math.max(1, size.x + this._padX * 2);
    const canvasH = Math.max(1, size.y + this._padY * 2);
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.translate(this._padX, this._padY);
    this.renderer.drawFrame(ctx, size.x, size.y, this._padX, this._padY);
    ctx.restore();
  }
}

export class MapRenderer {
  constructor(containerId, handlers = {}) {
    this.handlers = handlers;
    this.allBuildings = [];
    this.candidateSet = new Set();
    this.sortedCandidates = [];
    this.rankMap = new Map();
    this.scoreMin = 1.0;
    this.scoreMax = 4.6;
    this.rentMin = 35.0;
    this.rentMax = 95.0;

    this.state = {
      colorMode: 'score',
      labelMode: 'both',
      showCampusRadius: true,
      showZones: false,
      showRail: false,
      showRoadsRent: false,
      selectedId: null,
      hoveredId: null,
    };

    this.context = null;
    this.microZones = null;
    this.roadsRent = null;
    this.hitCache = [];

    this.map = L.map(containerId, {
      center: [37.2325, 127.1915],
      zoom: 13.75,
      minZoom: 12,
      maxZoom: 19,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90,
      zoomControl: false,
      attributionControl: true,
    });

    this.map.attributionControl.setPrefix('');

    this.osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    });
    this.osmLayer.addTo(this.map);

    this.canvasLayer = new HousingCanvasLayer(this);
    this.canvasLayer.addTo(this.map);

    this._bindMapEvents();
  }

  _bindMapEvents() {
    this.map.on('mousemove', (ev) => {
      const hit = this._hitTest(ev.containerPoint);
      const nextHover = hit ? hit.id : null;
      this.map.getContainer().style.cursor = hit ? 'pointer' : '';
      if (this.state.hoveredId !== nextHover) {
        this.state.hoveredId = nextHover;
        this.canvasLayer.redraw();
      }
      if (this.handlers.onHover) {
        this.handlers.onHover(hit, ev.containerPoint);
      }
    });

    this.map.on('mouseout', () => {
      if (this.state.hoveredId !== null) {
        this.state.hoveredId = null;
        this.canvasLayer.redraw();
      }
      if (this.handlers.onHover) {
        this.handlers.onHover(null, null);
      }
    });

    this.map.on('click', (ev) => {
      const hit = this._hitTest(ev.containerPoint);
      if (this.handlers.onSelect) {
        this.handlers.onSelect(hit ? hit.id : null);
      }
    });
  }

  setStaticData({ buildings, context, microZones, roadsRent }) {
    this.allBuildings = buildings;
    this.context = context;
    this.microZones = microZones;
    this.roadsRent = roadsRent;
    this.fitHomeBounds(false);
    this.canvasLayer.redraw();
  }

  fitHomeBounds(animate = true) {
    // 2개 행정동 및 3.2km 반경이 균형 있게 보이는 초기 프레임
    const bounds = L.latLngBounds([37.211, 127.168], [37.257, 127.224]);
    this.map.fitBounds(bounds, { padding: [18, 18], animate });
  }

  zoomIn() {
    this.map.zoomIn(0.75);
  }

  zoomOut() {
    this.map.zoomOut(0.75);
  }

  focusBuilding(building) {
    if (!building) return;
    const targetZoom = Math.max(this.map.getZoom(), 16.5);
    this.map.flyTo([building.c[1], building.c[0]], targetZoom, { duration: 0.45 });
  }

  updateViewState(patch) {
    Object.assign(this.state, patch);
    this.canvasLayer.redraw();
  }

  updateData({ candidates, scoreMin, scoreMax, rentMin, rentMax }) {
    this.sortedCandidates = candidates;
    this.candidateSet = new Set(candidates.map((b) => b.id));
    this.rankMap = new Map();
    candidates.forEach((b, idx) => this.rankMap.set(b.id, idx + 1));
    this.scoreMin = scoreMin;
    this.scoreMax = scoreMax;
    this.rentMin = rentMin;
    this.rentMax = rentMax;
    this.canvasLayer.redraw();
  }

  _toPt(lon, lat) {
    return this.map.latLngToContainerPoint([lat, lon]);
  }

  _drawRingPath(ctx, ring) {
    if (!ring || ring.length < 3) return false;
    let first = true;
    for (let i = 0; i < ring.length; i += 1) {
      const pt = this._toPt(ring[i][0], ring[i][1]);
      if (first) {
        ctx.moveTo(pt.x, pt.y);
        first = false;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.closePath();
    return true;
  }

  _drawGeoFeaturePoly(ctx, geom) {
    const type = geom.type;
    const coords = geom.coordinates;
    if (type === 'Polygon') {
      coords.forEach((ring) => this._drawRingPath(ctx, ring));
    } else if (type === 'MultiPolygon') {
      coords.forEach((poly) => poly.forEach((ring) => this._drawRingPath(ctx, ring)));
    }
  }

  drawFrame(ctx, viewW, viewH, padX = 0, padY = 0) {
    if (!this.context) return;
    const zoom = this.map.getZoom();
    const bds = this.map.getBounds().pad(0.45);
    const minLon = bds.getWest();
    const maxLon = bds.getEast();
    const minLat = bds.getSouth();
    const maxLat = bds.getNorth();

    const inView = (lon, lat) =>
      lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;

    // 1. 선택 레이어: 7개 생활권
    if (this.state.showZones && this.microZones) {
      ctx.save();
      this.microZones.features.forEach((ft, idx) => {
        ctx.beginPath();
        this._drawGeoFeaturePoly(ctx, ft.geometry);
        ctx.fillStyle = ZONE_PALETTE[idx % ZONE_PALETTE.length];
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#475569';
        ctx.stroke();
      });
      ctx.restore();
    }

    // 2. 선택 레이어: 도로 전월세 실거래가 47개 도로
    if (this.state.showRoadsRent && this.roadsRent) {
      ctx.save();
      ctx.lineCap = 'round';
      for (const ft of this.roadsRent.features) {
        const prp = ft.properties;
        const g = ft.geometry;
        const segs = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
        ctx.beginPath();
        for (const seg of segs) {
          for (let i = 0; i < seg.length; i += 1) {
            const pt = this._toPt(seg[i][0], seg[i][1]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
        }
        ctx.lineWidth = zoom >= 15 ? 4.4 : 2.8;
        ctx.globalAlpha = 0.78;
        ctx.strokeStyle = getRoadRentColor(prp.conv);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 행정동 경계 (역북동·남동 점선)
    if (this.context.admin) {
      ctx.save();
      ctx.beginPath();
      for (const ft of this.context.admin.features) {
        this._drawGeoFeaturePoly(ctx, ft.geometry);
      }
      ctx.lineWidth = 1.35;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#475569';
      ctx.stroke();
      ctx.restore();
    }

    // 4. 필터에서 제외된 주거 건물 (위치 맥락 유지용 연회색)
    ctx.save();
    ctx.beginPath();
    for (const b of this.allBuildings) {
      if (this.candidateSet.has(b.id)) continue;
      if (!inView(b.c[0], b.c[1])) continue;
      for (const ring of b.p) {
        this._drawRingPath(ctx, ring);
      }
    }
    ctx.fillStyle = 'rgba(148, 163, 184, 0.32)';
    ctx.fill();
    ctx.restore();

    // 5. 후보 주거 건물 폴리곤 (점수 오름차순으로 그려 고득점 건물이 위에 선명히 표시)
    const drawOrder = [...this.sortedCandidates].reverse();
    this.hitCache = [];
    const useScoreColor = this.state.colorMode === 'score';
    const tinyOutlineW = zoom < 14.8 ? 1.0 : 0.75;

    for (const b of drawOrder) {
      if (!inView(b.c[0], b.c[1])) continue;
      const color = useScoreColor
        ? getScoreColor(b.currentScore, this.scoreMin, this.scoreMax)
        : getRentColor(b.pr, this.rentMin, this.rentMax);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const screenRings = [];

      ctx.beginPath();
      for (const ring of b.p) {
        if (ring.length < 3) continue;
        const sRing = [];
        for (let i = 0; i < ring.length; i += 1) {
          const pt = this._toPt(ring[i][0], ring[i][1]);
          sRing.push([pt.x, pt.y]);
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        screenRings.push(sRing);
      }

      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = tinyOutlineW;
      ctx.strokeStyle = zoom >= 15.5 ? 'rgba(15, 23, 42, 0.22)' : color;
      ctx.stroke();

      const cpt = this._toPt(b.c[0], b.c[1]);
      this.hitCache.push({
        building: b,
        cx: cpt.x,
        cy: cpt.y,
        minX,
        minY,
        maxX,
        maxY,
        rings: screenRings,
      });
    }

    // 7. 상위 3위 원형 하이라이트 & 호버/선택 테두리 (레퍼런스 링 연출 반영)
    ctx.save();
    for (let i = 0; i < Math.min(3, this.sortedCandidates.length); i += 1) {
      const b = this.sortedCandidates[i];
      if (!inView(b.c[0], b.c[1])) continue;
      const pt = this._toPt(b.c[0], b.c[1]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, i === 0 ? 11 : 9, 0, Math.PI * 2);
      ctx.lineWidth = i === 0 ? 1.5 : 1.1;
      ctx.strokeStyle = i === 0 ? 'rgba(17, 24, 39, 0.75)' : 'rgba(55, 65, 81, 0.45)';
      ctx.stroke();
    }
    ctx.restore();

    const highlightBuilding = (id, lineWidth, strokeColor, drawHalo) => {
      if (!id) return;
      const found = this.allBuildings.find((x) => x.id === id);
      if (!found) return;
      ctx.save();
      ctx.beginPath();
      for (const ring of found.p) {
        this._drawRingPath(ctx, ring);
      }
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
      if (drawHalo) {
        const pt = this._toPt(found.c[0], found.c[1]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#dc2626';
        ctx.stroke();
      }
      ctx.restore();
    };

    if (this.state.hoveredId && this.state.hoveredId !== this.state.selectedId) {
      highlightBuilding(this.state.hoveredId, 2.0, '#111827', false);
    }
    if (this.state.selectedId) {
      highlightBuilding(this.state.selectedId, 2.6, '#dc2626', true);
    }

    // 8. 선택 레이어: 용인경전철 & 주요 시설
    if (this.state.showRail && this.context.rail_and_landmarks) {
      ctx.save();
      for (const ft of this.context.rail_and_landmarks.features) {
        const prp = ft.properties;
        const g = ft.geometry;
        if (g.type === 'LineString') {
          ctx.beginPath();
          g.coordinates.forEach((c, idx) => {
            const pt = this._toPt(c[0], c[1]);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.lineWidth = 2.6;
          ctx.setLineDash([7, 4]);
          ctx.strokeStyle = '#15803d';
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (g.type === 'Point') {
          const pt = this._toPt(g.coordinates[0], g.coordinates[1]);
          if (prp.kind === 'rail_station') {
            ctx.fillStyle = '#15803d';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.fillRect(pt.x - 5, pt.y - 5, 10, 10);
            ctx.strokeRect(pt.x - 5, pt.y - 5, 10, 10);
            ctx.font = '700 11px Pretendard, sans-serif';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.strokeText(prp.name, pt.x + 8, pt.y + 4);
            ctx.fillStyle = '#14532d';
            ctx.fillText(prp.name, pt.x + 8, pt.y + 4);
          } else if (prp.lm_id !== 'LM01') {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = prp.cat === '대학' ? '#7c3aed' : '#2563eb';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            if (zoom >= 13.5) {
              const shortNm = prp.name.replace(/\s*\([^)]*\)/, '');
              ctx.font = '600 10.5px Pretendard, sans-serif';
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.strokeText(shortNm, pt.x + 7, pt.y + 3.5);
              ctx.fillStyle = '#1e293b';
              ctx.fillText(shortNm, pt.x + 7, pt.y + 3.5);
            }
          }
        }
      }
      ctx.restore();
    }

    // 9. 생활권 라벨 (생활권 레이어 켠 경우)
    if (this.state.showZones && this.microZones) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 11px Pretendard, sans-serif';
      for (const ft of this.microZones.features) {
        const ring = ft.geometry.type === 'Polygon' ? ft.geometry.coordinates[0] : ft.geometry.coordinates[0][0];
        let slon = 0;
        let slat = 0;
        for (const c of ring) {
          slon += c[0];
          slat += c[1];
        }
        const pt = this._toPt(slon / ring.length, slat / ring.length);
        const txt = ft.properties.ZONE_SHORT;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeText(txt, pt.x, pt.y);
        ctx.fillStyle = '#1e293b';
        ctx.fillText(txt, pt.x, pt.y);
      }
      ctx.restore();
    }

    // 10. 건물 위 글자 (충돌 회피 그리디 배치)
    if (this.state.labelMode !== 'none') {
      this._drawSmartLabels(ctx, viewW, viewH, zoom, inView, padX, padY);
    }

    // 11. 명지대 정문 빨간 별 + 0.8/1.6/2.4/3.2km 동심원 반경
    if (this.state.showCampusRadius) {
      this._drawCampusCircles(ctx);
    }
  }

  _drawSmartLabels(ctx, viewW, viewH, zoom, inView, bufPadX = 0, bufPadY = 0) {
    const mode = this.state.labelMode;
    const placedBoxes = [];

    // 줌 레벨별 간격 조절: 초기 화면에서는 ~50개 핵심 대표 건물, 확대 시 촘촘하게
    const padX = zoom >= 16.5 ? 4 : zoom >= 15 ? 8 : 13;
    const padY = zoom >= 16.5 ? 2 : zoom >= 15 ? 4 : 6;
    const maxLabels = zoom >= 16.5 ? 420 : zoom >= 15 ? 200 : 100;

    // 명지대 정문 주변 라벨 겹침 회피를 위해 정문 좌표 주변에 작은 예약 박스 확보
    if (this.state.showCampusRadius) {
      const gpt = this._toPt(MJU_GATE[1], MJU_GATE[0]);
      placedBoxes.push({ x1: gpt.x - 36, y1: gpt.y - 14, x2: gpt.x + 48, y2: gpt.y + 24 });
    }

    // 선택된 건물이 가장 우선순위를 가지도록 정렬
    const labelQueue = [...this.sortedCandidates];
    if (this.state.selectedId) {
      const selIdx = labelQueue.findIndex((b) => b.id === this.state.selectedId);
      if (selIdx > 0) {
        const [sel] = labelQueue.splice(selIdx, 1);
        labelQueue.unshift(sel);
      }
    }

    ctx.save();
    ctx.font = zoom >= 15.5 ? '600 11px Pretendard, sans-serif' : '600 10.5px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let count = 0;
    for (const b of labelQueue) {
      if (count >= maxLabels) break;
      if (!inView(b.c[0], b.c[1])) continue;
      const pt = this._toPt(b.c[0], b.c[1]);
      if (
        pt.x < -bufPadX + 28 ||
        pt.x > viewW + bufPadX - 28 ||
        pt.y < -bufPadY + 18 ||
        pt.y > viewH + bufPadY - 18
      ) {
        continue;
      }

      const scoreTxt = b.currentScore.toFixed(1);
      const rentTxt = b.pr != null ? `${Math.round(b.pr)}만` : '';
      let text = '';
      if (mode === 'score') text = scoreTxt;
      else if (mode === 'rent') text = rentTxt || '미수집';
      else text = rentTxt ? `${scoreTxt} · ${rentTxt}` : scoreTxt;

      const metrics = ctx.measureText(text);
      const tw = metrics.width;
      const th = 12;
      const box = {
        x1: pt.x - tw / 2 - padX,
        y1: pt.y - th / 2 - padY,
        x2: pt.x + tw / 2 + padX,
        y2: pt.y + th / 2 + padY,
      };

      let collides = false;
      for (let i = 0; i < placedBoxes.length; i += 1) {
        if (boxesOverlap(box, placedBoxes[i])) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      placedBoxes.push(box);
      count += 1;

      const isSel = b.id === this.state.selectedId;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeText(text, pt.x, pt.y);
      ctx.fillStyle = isSel ? '#b91c1c' : '#111827';
      ctx.fillText(text, pt.x, pt.y);
    }
    ctx.restore();
  }

  _drawCampusCircles(ctx) {
    const centerPt = this._toPt(MJU_GATE[1], MJU_GATE[0]);

    ctx.save();
    for (const rMeters of RADIUS_METERS) {
      const eastEdge = destinationLatLon(MJU_GATE[0], MJU_GATE[1], rMeters, 90);
      const edgePt = this._toPt(eastEdge[1], eastEdge[0]);
      const pxRadius = Math.abs(edgePt.x - centerPt.x);

      ctx.beginPath();
      ctx.arc(centerPt.x, centerPt.y, pxRadius, 0, Math.PI * 2);
      ctx.lineWidth = 1.05;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#4b5563';
      ctx.stroke();

      // 우상단(약 45도) 직선거리 라벨
      const labelPos = destinationLatLon(MJU_GATE[0], MJU_GATE[1], rMeters, 46);
      const lpt = this._toPt(labelPos[1], labelPos[0]);
      const labelTxt = `직선 ${(rMeters / 1000).toFixed(1)}km`;

      ctx.save();
      ctx.setLineDash([]);
      ctx.font = '500 10.5px Pretendard, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeText(labelTxt, lpt.x + 3, lpt.y);
      ctx.fillStyle = '#4b5563';
      ctx.fillText(labelTxt, lpt.x + 3, lpt.y);
      ctx.restore();
    }

    // 명지대 정문 빨간 별 + 라벨
    ctx.setLineDash([]);
    drawStar(ctx, centerPt.x, centerPt.y, 5, 8.5, 3.8, '#dc2626', '#ffffff');

    ctx.font = '700 12px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.strokeText('명지대 정문', centerPt.x + 9, centerPt.y + 4);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('명지대 정문', centerPt.x + 9, centerPt.y + 4);
    ctx.restore();
  }

  _hitTest(containerPt) {
    const x = containerPt.x;
    const y = containerPt.y;

    // 위에서(고득점) 아래 순으로 폴리곤 내부 판정
    for (let i = this.hitCache.length - 1; i >= 0; i -= 1) {
      const item = this.hitCache[i];
      if (x < item.minX - 2 || x > item.maxX + 2 || y < item.minY - 2 || y > item.maxY + 2) {
        continue;
      }
      for (const ring of item.rings) {
        if (pointInRing(x, y, ring)) {
          return item.building;
        }
      }
    }

    // 축소 상태에서 작은 건물을 클릭하기 쉽도록 반경 7px 이내 최근접 중심 허용
    let best = null;
    let bestDist2 = 49; // 7px^2
    for (let i = this.hitCache.length - 1; i >= 0; i -= 1) {
      const item = this.hitCache[i];
      const dx = x - item.cx;
      const dy = y - item.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist2) {
        bestDist2 = d2;
        best = item.building;
      }
    }
    return best;
  }
}
