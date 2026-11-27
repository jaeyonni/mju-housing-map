import {
  formatBuildingMeta,
  formatDistance,
  getBuildingDisplayName,
  getFactorBarColor,
  LEGEND_GRADIENTS,
} from './colorScale.js?v=17';
import { CommentsController } from './comments.js?v=17';
import { MapRenderer } from './mapRenderer.js?v=17';

// 레퍼런스 사이드바 슬라이더 순서와 원본 factors 배열(s[0..6]) 매핑
// s 순서: [0:가격, 1:통학, 2:경사도, 3:치안, 4:생활편의, 5:주거소음, 6:건물연식]
const SLIDER_ORDER = [
  { idx: 0, key: 'price', label: '가격' },
  { idx: 1, key: 'commute', label: '통학' },
  { idx: 4, key: 'amenity', label: '편의' },
  { idx: 5, key: 'noise', label: '소음' },
  { idx: 2, key: 'slope', label: '경사' },
  { idx: 6, key: 'age', label: '연식' },
  { idx: 3, key: 'safety', label: '치안' },
];

class HousingApp {
  constructor() {
    this.buildings = [];
    this.presetsData = null;
    this.sortedCandidates = [];
    this.rankById = new Map();

    this.state = {
      presetKey: 'total',
      isCustomWeight: false,
      rawWeights: [17.55, 15.51, 13.18, 13.18, 13.76, 13.59, 13.24],
      normWeights: [0.17551, 0.155102, 0.131778, 0.131778, 0.137609, 0.13586, 0.132362],
      colorMode: 'score',
      labelMode: 'both',
      showCampusRadius: true,
      dong: 'all',
      cat: 'jachwi',
      budgetMax: 101,
      searchQuery: '',
      rankLimit: 15,
      selectedId: null,
      scoreMin: 1.0,
      scoreMax: 4.6,
      rentMin: 35.0,
      rentMax: 95.0,
    };

    this.dom = this._collectDom();
    this.renderer = new MapRenderer('map', {
      onHover: (b, pt) => this._handleHover(b, pt),
      onSelect: (id) => this.selectBuilding(id, false),
    });
    this.comments = new CommentsController({
      getBuildings: () => this.buildings,
      getSelectedBuilding: () =>
        this.state.selectedId
          ? this.buildings.find((b) => b.id === this.state.selectedId) || null
          : null,
      onSelectBuildingFromComment: (id) => this.focusBuildingFromComment(id),
      onOpenPanel: (open) => this._setCommentsPanel(open),
      onCommentsUpdated: (list) => {
        if (this.dom.commentsCountBadge) {
          this.dom.commentsCountBadge.textContent = String(list.length);
        }
        if (this.state.selectedId && !this.dom.detailCard.hidden) {
          this.comments.renderBuildingCommentsPreview(
            this.dom.detailCommentsList,
            this.dom.detailCommentsCount,
            this.dom.detailAllCommentsBtn,
            this.state.selectedId
          );
        }
      },
    });
  }

  _collectDom() {
    return {
      sidebar: document.getElementById('sidebar'),
      mobileDrawerBtn: document.getElementById('mobile-drawer-btn'),
      mobileBackdrop: document.getElementById('mobile-backdrop'),
      sidebarCloseBtn: document.getElementById('sidebar-close-btn'),
      mobileCountPill: document.getElementById('mobile-count-pill'),
      candidateCountBadge: document.getElementById('candidate-count-badge'),
      presetNoteText: document.getElementById('preset-note-text'),
      weightResetBtn: document.getElementById('weight-reset-btn'),
      weightSliders: document.getElementById('weight-sliders'),
      budgetSlider: document.getElementById('budget-slider'),
      budgetValue: document.getElementById('budget-value'),
      searchInput: document.getElementById('search-input'),
      searchClearBtn: document.getElementById('search-clear-btn'),
      rankingHeading: document.getElementById('ranking-heading'),
      rankingSubInfo: document.getElementById('ranking-sub-info'),
      rankingList: document.getElementById('ranking-list'),
      rankingEmpty: document.getElementById('ranking-empty'),
      rankingExpandBtn: document.getElementById('ranking-expand-btn'),
      legendTitle: document.getElementById('legend-title'),
      legendBar: document.getElementById('legend-bar'),
      legendMinLabel: document.getElementById('legend-min-label'),
      legendMidLabel: document.getElementById('legend-mid-label'),
      legendMaxLabel: document.getElementById('legend-max-label'),
      hoverTooltip: document.getElementById('hover-tooltip'),
      detailCard: document.getElementById('detail-card'),
      detailCloseBtn: document.getElementById('detail-close-btn'),
      detailBadges: document.getElementById('detail-badges'),
      detailTitle: document.getElementById('detail-title'),
      detailSubtitle: document.getElementById('detail-subtitle'),
      detailRank: document.getElementById('detail-rank'),
      detailScore: document.getElementById('detail-score'),
      detailRent: document.getElementById('detail-rent'),
      detailMetaGrid: document.getElementById('detail-meta-grid'),
      detailNotice: document.getElementById('detail-notice'),
      detailFactors: document.getElementById('detail-factors'),
      detailNaverLink: document.getElementById('detail-naver-link'),
      detailKakaoLink: document.getElementById('detail-kakao-link'),
      detailCommentsCount: document.getElementById('detail-comments-count'),
      detailCommentsList: document.getElementById('detail-comments-list'),
      detailWriteCommentBtn: document.getElementById('detail-write-comment-btn'),
      detailAllCommentsBtn: document.getElementById('detail-all-comments-btn'),
      commentsPanel: document.getElementById('comments-panel'),
      toggleCommentsBtn: document.getElementById('toggle-comments-btn'),
      commentsCountBadge: document.getElementById('comments-count-badge'),
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingMessage: document.getElementById('loading-message'),
      toggleZonesBtn: document.getElementById('toggle-zones-btn'),
      toggleRailBtn: document.getElementById('toggle-rail-btn'),
      toggleRoadsBtn: document.getElementById('toggle-roads-btn'),
      zoomInBtn: document.getElementById('zoom-in-btn'),
      zoomOutBtn: document.getElementById('zoom-out-btn'),
      fitBoundsBtn: document.getElementById('fit-bounds-btn'),
    };
  }

  async init() {
    try {
      const [buildings, context, microZones, roadsRent, presetsData] = await Promise.all([
        this._fetchJson('./data/buildings.json?v=3'),
        this._fetchJson('./data/context.json?v=3'),
        this._fetchJson('./data/micro_zones.geojson?v=3'),
        this._fetchJson('./data/roads_rent.geojson?v=3'),
        this._fetchJson('./data/weights_presets.json?v=3'),
      ]);

      this.buildings = buildings;
      this.presetsData = presetsData;

      this._buildSliders();
      this._bindControls();
      this.applyPreset('total', false);

      this.renderer.setStaticData({ buildings, context, microZones, roadsRent });
      this.recompute();
      this.comments.init();

      this.dom.loadingOverlay.hidden = true;
    } catch (err) {
      console.error(err);
      this.dom.loadingMessage.innerHTML =
        '데이터를 불러오지 못했습니다.<br/>로컬에서는 <code>python -m http.server 8000</code>으로 실행해 주세요.';
    }
  }

  async _fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  _buildSliders() {
    const frag = document.createDocumentFragment();
    const factorDescMap = new Map(
      (this.presetsData?.factors || []).map((f) => [f.key, f.desc])
    );

    this.sliderInputs = {};
    this.sliderPctEls = {};

    for (const item of SLIDER_ORDER) {
      const row = document.createElement('div');
      row.className = 'slider-row';

      const lbl = document.createElement('span');
      lbl.className = 'slider-name';
      lbl.textContent = item.label;
      lbl.title = factorDescMap.get(item.key) || item.label;

      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'custom-range';
      input.min = '0';
      input.max = '50';
      input.step = '0.5';
      input.setAttribute('aria-label', `${item.label} 가중치`);

      const pct = document.createElement('span');
      pct.className = 'slider-pct';
      pct.textContent = '0.0%';

      input.addEventListener('input', () => {
        this.state.rawWeights[item.idx] = parseFloat(input.value);
        this.state.isCustomWeight = true;
        this._normalizeWeights();
        this._syncSliderDom();
        this._syncPresetButtons();
        this.recompute();
      });

      row.append(lbl, input, pct);
      frag.appendChild(row);
      this.sliderInputs[item.idx] = input;
      this.sliderPctEls[item.idx] = pct;
    }

    this.dom.weightSliders.innerHTML = '';
    this.dom.weightSliders.appendChild(frag);
  }

  _normalizeWeights() {
    const sum = this.state.rawWeights.reduce((acc, v) => acc + v, 0);
    if (sum <= 1e-6) {
      this.state.normWeights = Array(7).fill(1 / 7);
    } else {
      this.state.normWeights = this.state.rawWeights.map((v) => v / sum);
    }
  }

  _syncSliderDom() {
    for (const item of SLIDER_ORDER) {
      const raw = this.state.rawWeights[item.idx];
      const normPct = this.state.normWeights[item.idx] * 100;
      const input = this.sliderInputs[item.idx];
      input.value = String(raw);
      input.style.setProperty('--fill-pct', `${Math.min(100, (raw / 50) * 100)}%`);
      this.sliderPctEls[item.idx].textContent = `${normPct.toFixed(1)}%`;
    }
  }

  _syncPresetButtons() {
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      const match = !this.state.isCustomWeight && btn.dataset.preset === this.state.presetKey;
      btn.classList.toggle('active', match);
    });
    const PRESET_DISPLAY_NOTES = {
      total: '설문 결과값 가중치 적용',
      male: '남성 설문 가중치 적용',
      female: '여성 설문 가중치 적용',
      budget: '가성비·통학 시나리오',
      safe_conven: '안심·편의 시나리오',
      quiet_new: '신축·저소음 시나리오',
    };
    if (this.state.isCustomWeight) {
      this.dom.presetNoteText.textContent = '사용자 지정 가중치';
    } else {
      const preset = this.presetsData?.presets?.[this.state.presetKey];
      this.dom.presetNoteText.textContent =
        PRESET_DISPLAY_NOTES[this.state.presetKey] || (preset ? preset.label : '');
    }
  }

  applyPreset(presetKey, shouldRecompute = true) {
    const preset = this.presetsData?.presets?.[presetKey];
    if (!preset) return;
    this.state.presetKey = presetKey;
    this.state.isCustomWeight = false;
    this.state.rawWeights = preset.w.map((v) => Math.round(v * 1000) / 10);
    this.state.normWeights = [...preset.w];
    this._syncSliderDom();
    this._syncPresetButtons();
    if (shouldRecompute) this.recompute();
  }

  _bindControls() {
    // 프리셋 버튼
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset, true));
    });

    this.dom.weightResetBtn.addEventListener('click', () => {
      this.applyPreset(this.state.presetKey || 'total', true);
    });

    // 색상 모드
    document.querySelectorAll('[data-colormode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.colorMode = btn.dataset.colormode;
        document.querySelectorAll('[data-colormode]').forEach((el) =>
          el.classList.toggle('active', el === btn)
        );
        this.renderer.updateViewState({ colorMode: this.state.colorMode });
        this._updateLegend();
      });
    });

    // 건물 위 글자
    document.querySelectorAll('[data-labelmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.labelMode = btn.dataset.labelmode;
        document.querySelectorAll('[data-labelmode]').forEach((el) =>
          el.classList.toggle('active', el === btn)
        );
        this.renderer.updateViewState({ labelMode: this.state.labelMode });
      });
    });

    // 행정동 범위
    document.querySelectorAll('[data-dong]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.dong = btn.dataset.dong;
        document.querySelectorAll('[data-dong]').forEach((el) =>
          el.classList.toggle('active', el === btn)
        );
        this.recompute();
      });
    });

    // 건물 유형 칩
    document.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.cat = btn.dataset.cat;
        document.querySelectorAll('[data-cat]').forEach((el) =>
          el.classList.toggle('active', el === btn)
        );
        this.recompute();
      });
    });

    // 예산 슬라이더
    const syncBudgetSliderFill = () => {
      const v = Number(this.dom.budgetSlider.value);
      const min = Number(this.dom.budgetSlider.min);
      const max = Number(this.dom.budgetSlider.max);
      const pct = ((v - min) / (max - min)) * 100;
      this.dom.budgetSlider.style.setProperty('--fill-pct', `${pct}%`);
      this.dom.budgetValue.textContent = v >= 101 ? '제한 없음' : `${v}만 이하`;
    };
    syncBudgetSliderFill();
    this.dom.budgetSlider.addEventListener('input', () => {
      this.state.budgetMax = Number(this.dom.budgetSlider.value);
      syncBudgetSliderFill();
      this.recompute();
    });

    // 검색창
    this.dom.searchInput.addEventListener('input', () => {
      this.state.searchQuery = this.dom.searchInput.value.trim().toLowerCase();
      this.dom.searchClearBtn.hidden = this.state.searchQuery.length === 0;
      this.recompute();
    });
    this.dom.searchClearBtn.addEventListener('click', () => {
      this.dom.searchInput.value = '';
      this.state.searchQuery = '';
      this.dom.searchClearBtn.hidden = true;
      this.recompute();
      this.dom.searchInput.focus();
    });

    // 순위 더보기
    this.dom.rankingExpandBtn.addEventListener('click', () => {
      this.state.rankLimit = this.state.rankLimit === 15 ? 30 : 15;
      this._renderRanking();
    });

    // 우상단 지도 도구바
    this.dom.toggleZonesBtn.addEventListener('click', () => {
      const next = !this.renderer.state.showZones;
      this.dom.toggleZonesBtn.classList.toggle('active', next);
      this.renderer.updateViewState({ showZones: next });
    });

    this.dom.toggleRailBtn.addEventListener('click', () => {
      const next = !this.renderer.state.showRail;
      this.dom.toggleRailBtn.classList.toggle('active', next);
      this.renderer.updateViewState({ showRail: next });
    });

    this.dom.toggleRoadsBtn.addEventListener('click', () => {
      const next = !this.renderer.state.showRoadsRent;
      this.dom.toggleRoadsBtn.classList.toggle('active', next);
      this.renderer.updateViewState({ showRoadsRent: next });
    });

    this.dom.zoomInBtn.addEventListener('click', () => this.renderer.zoomIn());
    this.dom.zoomOutBtn.addEventListener('click', () => this.renderer.zoomOut());
    this.dom.fitBoundsBtn.addEventListener('click', () => this.renderer.fitHomeBounds(true));

    this.dom.toggleCommentsBtn?.addEventListener('click', () => {
      const next = Boolean(this.dom.commentsPanel?.hidden);
      this._setCommentsPanel(next);
    });

    this.dom.detailWriteCommentBtn?.addEventListener('click', () => {
      const b = this.buildings.find((x) => x.id === this.state.selectedId);
      if (b) this.comments.openForBuilding(b, true);
    });

    this.dom.detailAllCommentsBtn?.addEventListener('click', () => {
      const b = this.buildings.find((x) => x.id === this.state.selectedId);
      if (b) this.comments.openFilteredByBuilding(b);
    });

    // 상세 카드 닫기
    this.dom.detailCloseBtn.addEventListener('click', () => this.selectBuilding(null, false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this.dom.detailCard.hidden) this.selectBuilding(null, false);
        if (this.dom.commentsPanel && !this.dom.commentsPanel.hidden) this._setCommentsPanel(false);
        this._setMobileDrawer(false);
      }
    });

    // 모바일 드로어
    this.dom.mobileDrawerBtn.addEventListener('click', () => this._setMobileDrawer(true));
    this.dom.sidebarCloseBtn.addEventListener('click', () => this._setMobileDrawer(false));
    this.dom.mobileBackdrop.addEventListener('click', () => this._setMobileDrawer(false));
  }

  _setMobileDrawer(open) {
    this.dom.sidebar.classList.toggle('open', open);
    this.dom.mobileBackdrop.classList.toggle('open', open);
    this.dom.mobileDrawerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  _isMobileViewport() {
    return window.matchMedia('(max-width: 820px)').matches;
  }

  _setCommentsPanel(open) {
    if (!this.dom.commentsPanel) return;
    this.dom.commentsPanel.hidden = !open;
    this.dom.toggleCommentsBtn?.classList.toggle('active', open);
    this.dom.toggleCommentsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (this._isMobileViewport() && !this.dom.detailCard.hidden) {
        this.dom.detailCard.hidden = true;
      }
      this.comments.syncSelectedBuildingShortcut();
    }
  }

  focusBuildingFromComment(id) {
    const b = this.buildings.find((x) => x.id === id);
    if (!b) return;

    let filterChanged = false;
    if (this.state.dong !== 'all' && b.d !== this.state.dong) {
      this.state.dong = 'all';
      document.querySelectorAll('[data-dong]').forEach((el) =>
        el.classList.toggle('active', el.dataset.dong === 'all')
      );
      filterChanged = true;
    }

    const catMismatch =
      (this.state.cat === 'jachwi' && b.cat === '아파트') ||
      (this.state.cat !== 'jachwi' && this.state.cat !== 'all' && b.cat !== this.state.cat);
    if (catMismatch) {
      this.state.cat = b.cat === '아파트' ? 'all' : 'jachwi';
      document.querySelectorAll('[data-cat]').forEach((el) =>
        el.classList.toggle('active', el.dataset.cat === this.state.cat)
      );
      filterChanged = true;
    }

    if (this.state.budgetMax < 101 && (b.pr == null || b.pr > this.state.budgetMax)) {
      this.state.budgetMax = 101;
      this.dom.budgetSlider.value = '101';
      this.dom.budgetSlider.style.setProperty('--fill-pct', '100%');
      this.dom.budgetValue.textContent = '제한 없음';
      filterChanged = true;
    }

    if (this.state.searchQuery) {
      const hay = `${b.nm} ${b.rd} ${b.zn} ${b.d} ${b.cat}`.toLowerCase();
      if (!hay.includes(this.state.searchQuery)) {
        this.state.searchQuery = '';
        this.dom.searchInput.value = '';
        this.dom.searchClearBtn.hidden = true;
        filterChanged = true;
      }
    }

    if (filterChanged) {
      this.recompute();
    }

    if (this._isMobileViewport()) {
      this._setCommentsPanel(false);
    }
    this._setMobileDrawer(false);
    this.selectBuilding(id, true);
  }

  recompute() {
    const w = this.state.normWeights;
    const { dong, cat, budgetMax, searchQuery } = this.state;

    const candidates = [];
    for (let i = 0; i < this.buildings.length; i += 1) {
      const b = this.buildings[i];
      const s = b.s;
      b.currentScore =
        s[0] * w[0] +
        s[1] * w[1] +
        s[2] * w[2] +
        s[3] * w[3] +
        s[4] * w[4] +
        s[5] * w[5] +
        s[6] * w[6];

      if (dong !== 'all' && b.d !== dong) continue;
      if (cat === 'jachwi') {
        if (b.cat === '아파트') continue;
      } else if (cat !== 'all' && b.cat !== cat) {
        continue;
      }
      if (budgetMax < 101 && (b.pr == null || b.pr > budgetMax)) continue;
      if (searchQuery) {
        const hay = `${b.nm} ${b.rd} ${b.zn} ${b.d} ${b.cat}`.toLowerCase();
        if (!hay.includes(searchQuery)) continue;
      }
      candidates.push(b);
    }

    candidates.sort((a, b) => {
      const diff = b.currentScore - a.currentScore;
      if (Math.abs(diff) > 1e-6) return diff;
      const pa = a.pr ?? 999;
      const pb = b.pr ?? 999;
      if (pa !== pb) return pa - pb;
      return (b.yr || 0) - (a.yr || 0);
    });

    let sMin = Infinity;
    let sMax = -Infinity;
    const rents = [];
    this.rankById = new Map();

    candidates.forEach((b, idx) => {
      this.rankById.set(b.id, idx + 1);
      if (b.currentScore < sMin) sMin = b.currentScore;
      if (b.currentScore > sMax) sMax = b.currentScore;
      if (b.pr != null) rents.push(b.pr);
    });

    rents.sort((a, b) => a - b);
    const quantile = (sortedArr, q) => {
      if (sortedArr.length === 0) return null;
      const pos = (sortedArr.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (base + 1 < sortedArr.length) {
        return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
      }
      return sortedArr[base];
    };

    let rMin = 42.0;
    let rMid = 53.0;
    let rMax = 75.0;
    let clippedLow = false;
    let clippedHigh = false;
    if (rents.length > 0) {
      const trueMin = rents[0];
      const trueMax = rents[rents.length - 1];
      if (rents.length >= 20) {
        rMin = quantile(rents, 0.05);
        rMid = quantile(rents, 0.5);
        rMax = quantile(rents, 0.85);
        if (rMax - rMin < 5) {
          rMin = trueMin;
          rMax = trueMax;
        }
      } else {
        rMin = trueMin;
        rMax = trueMax;
        rMid = quantile(rents, 0.5);
      }
      clippedLow = rMin > trueMin + 0.5;
      clippedHigh = rMax < trueMax - 0.5;
    }

    this.sortedCandidates = candidates;
    this.state.scoreMin = Number.isFinite(sMin) ? sMin : 1.0;
    this.state.scoreMax = Number.isFinite(sMax) ? sMax : 4.6;
    this.state.rentMin = rMin;
    this.state.rentMid = rMid;
    this.state.rentMax = rMax;
    this.state.rentClippedLow = clippedLow;
    this.state.rentClippedHigh = clippedHigh;

    this.dom.candidateCountBadge.textContent = `후보 ${candidates.length.toLocaleString()} / ${this.buildings.length.toLocaleString()}동`;
    this.dom.mobileCountPill.textContent = String(candidates.length);

    this.renderer.updateData({
      candidates,
      scoreMin: this.state.scoreMin,
      scoreMax: this.state.scoreMax,
      rentMin: this.state.rentMin,
      rentMax: this.state.rentMax,
    });

    this._updateLegend();
    this._renderRanking();
    if (this.state.selectedId) {
      this._renderDetailCard(this.state.selectedId);
    }
  }

  _updateLegend() {
    if (this.state.colorMode === 'score') {
      this.dom.legendTitle.textContent = '총점 (낮음→높음)';
      this.dom.legendBar.style.background = LEGEND_GRADIENTS.score;
      if (this.sortedCandidates.length > 0) {
        this.dom.legendMinLabel.textContent = `낮음 (${this.state.scoreMin.toFixed(2)})`;
        this.dom.legendMidLabel.textContent = '';
        this.dom.legendMaxLabel.textContent = `높음 (${this.state.scoreMax.toFixed(2)})`;
      } else {
        this.dom.legendMinLabel.textContent = '낮음';
        this.dom.legendMidLabel.textContent = '';
        this.dom.legendMaxLabel.textContent = '높음';
      }
    } else {
      this.dom.legendTitle.textContent = '환산월세 (비쌈→저렴)';
      this.dom.legendBar.style.background = LEGEND_GRADIENTS.rent;
      const hasRent = this.sortedCandidates.some((b) => b.pr != null);
      if (hasRent) {
        const hiSuffix = this.state.rentClippedHigh ? '+' : '';
        const loSuffix = this.state.rentClippedLow ? '↓' : '';
        this.dom.legendMinLabel.textContent = `비쌈 (${Math.round(this.state.rentMax)}만${hiSuffix})`;
        this.dom.legendMidLabel.textContent = `${Math.round(this.state.rentMid)}만`;
        this.dom.legendMaxLabel.textContent = `저렴 (${Math.round(this.state.rentMin)}만${loSuffix})`;
      } else {
        this.dom.legendMinLabel.textContent = '비쌈';
        this.dom.legendMidLabel.textContent = '';
        this.dom.legendMaxLabel.textContent = '저렴';
      }
    }
  }

  _renderRanking() {
    const list = this.dom.rankingList;
    const total = this.sortedCandidates.length;
    const limit = Math.min(this.state.rankLimit, total);

    this.dom.rankingHeading.textContent = `상위 ${this.state.rankLimit}개`;
    this.dom.rankingSubInfo.textContent = total > 0 ? `총 ${total.toLocaleString()}동 중` : '결과 없음';

    if (total === 0) {
      list.innerHTML = '';
      this.dom.rankingEmpty.hidden = false;
      this.dom.rankingExpandBtn.hidden = true;
      return;
    }

    this.dom.rankingEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < limit; i += 1) {
      const b = this.sortedCandidates[i];
      const li = document.createElement('li');
      li.className = 'rank-item';
      if (i < 3) li.classList.add('top3');
      if (b.id === this.state.selectedId) li.classList.add('selected');

      const num = document.createElement('span');
      num.className = 'rank-num';
      num.textContent = String(i + 1);

      const body = document.createElement('div');
      body.className = 'rank-body';

      const title = document.createElement('div');
      title.className = 'rank-title';
      title.textContent = getBuildingDisplayName(b);

      const meta = document.createElement('div');
      meta.className = 'rank-meta';
      meta.textContent = formatBuildingMeta(b);
      if (b.ps === '실측') {
        const pill = document.createElement('span');
        pill.className = 'rank-actual-pill';
        pill.textContent = '실측';
        meta.appendChild(pill);
      }

      body.append(title, meta);

      const score = document.createElement('span');
      score.className = 'rank-score';
      score.textContent = b.currentScore.toFixed(2);

      li.append(num, body, score);
      li.addEventListener('click', () => {
        this.selectBuilding(b.id, true);
        this._setMobileDrawer(false);
      });
      frag.appendChild(li);
    }

    list.innerHTML = '';
    list.appendChild(frag);

    if (total > 15) {
      this.dom.rankingExpandBtn.hidden = false;
      this.dom.rankingExpandBtn.textContent =
        this.state.rankLimit === 15 ? `상위 30개까지 보기 (총 ${total}동)` : '상위 15개로 접기';
    } else {
      this.dom.rankingExpandBtn.hidden = true;
    }
  }

  _handleHover(building, containerPt) {
    const tip = this.dom.hoverTooltip;
    if (!building || !containerPt) {
      tip.hidden = true;
      return;
    }
    const rnk = this.rankById.get(building.id);
    const title = getBuildingDisplayName(building);
    const rentStr = building.pr != null ? `${Math.round(building.pr)}만(${building.ps})` : '시세 미수집';
    tip.innerHTML = `<strong>${title}</strong>${rnk ? `#${rnk} · ` : ''}점수 ${building.currentScore.toFixed(2)} · 월세 ${rentStr}`;
    tip.hidden = false;

    const mapRect = this.renderer.map.getContainer().getBoundingClientRect();
    const left = Math.min(containerPt.x + 14, mapRect.width - 230);
    const top = Math.max(12, containerPt.y - 36);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  selectBuilding(id, flyTo = false) {
    this.state.selectedId = id;
    this.renderer.updateViewState({ selectedId: id });

    // 사이드바 하이라이트 동기화
    this._renderRanking();

    if (!id) {
      this.dom.detailCard.hidden = true;
      return;
    }

    const building = this.buildings.find((b) => b.id === id);
    if (!building) return;

    if (this._isMobileViewport()) {
      this._setCommentsPanel(false);
    }
    if (flyTo) {
      this.renderer.focusBuilding(building);
    }
    this._renderDetailCard(id);
    this.comments.syncSelectedBuildingShortcut();
  }

  _renderDetailCard(id) {
    const b = this.buildings.find((x) => x.id === id);
    if (!b) {
      this.dom.detailCard.hidden = true;
      return;
    }

    const rnk = this.rankById.get(id);
    this.dom.detailCard.hidden = false;

    const isUncollected = b.pr == null || b.ps === '미수집';
    const psClass = b.ps === '실측' ? 'd-badge-actual' : isUncollected ? '' : 'd-badge-est';
    const psLabel =
      b.ps === '실측'
        ? `전월세 실측 (${b.pc}건)`
        : isUncollected
          ? '아파트 실거래 미수집'
          : `시세 ${b.ps || '추정'}`;
    this.dom.detailBadges.innerHTML = `
      <span class="d-badge">${b.d}</span>
      <span class="d-badge">${b.cat}</span>
      <span class="d-badge ${psClass}">${psLabel}</span>
    `;

    this.dom.detailTitle.textContent = getBuildingDisplayName(b);
    const subParts = [b.zn || b.d];
    if (b.rd) subParts.push(b.rd);
    this.dom.detailSubtitle.textContent = subParts.join(' · ');

    this.dom.detailRank.textContent = rnk ? `#${rnk} / ${this.sortedCandidates.length}` : '조건 외';
    this.dom.detailScore.textContent = `${b.currentScore.toFixed(2)}점`;
    this.dom.detailRent.textContent = b.pr != null ? `약 ${b.pr.toFixed(1)}만` : '미수집';

    this.dom.detailMetaGrid.innerHTML = `
      <div class="meta-cell"><span class="meta-k">정문 직선</span><span class="meta-v">${formatDistance(b.dist)}</span></div>
      <div class="meta-cell"><span class="meta-k">지상 층수</span><span class="meta-v">${b.fl ? `${b.fl}층` : '-'}</span></div>
      <div class="meta-cell"><span class="meta-k">준공 연도</span><span class="meta-v">${b.yr ? `${b.yr}년` : '미상'}</span></div>
      <div class="meta-cell"><span class="meta-k">지형 경사</span><span class="meta-v">${b.slp != null ? `${b.slp.toFixed(1)}°` : '-'}</span></div>
    `;

    if (isUncollected) {
      this.dom.detailNotice.hidden = false;
      this.dom.detailNotice.textContent =
        '※ 전월세 시세는 자취용(원룸·빌라·오피스텔) 실거래 기준이며 아파트는 미수집입니다.';
    } else {
      this.dom.detailNotice.hidden = true;
      this.dom.detailNotice.textContent = '';
    }

    // 7개 요소 막대
    const factorFrag = document.createDocumentFragment();
    for (const item of SLIDER_ORDER) {
      const val = b.s[item.idx];
      const wtPct = this.state.normWeights[item.idx] * 100;
      const barPct = Math.max(4, Math.min(100, (val / 5.0) * 100));

      const row = document.createElement('div');
      row.className = 'factor-bar-row';
      row.innerHTML = `
        <span class="factor-bar-label">${item.label}</span>
        <div class="factor-track"><div class="factor-fill" style="width:${barPct}%;background:${getFactorBarColor(val)}"></div></div>
        <span class="factor-score-num">${val.toFixed(1)}</span>
        <span class="factor-wt-num">${wtPct.toFixed(1)}%</span>
      `;
      factorFrag.appendChild(row);
    }
    this.dom.detailFactors.innerHTML = '';
    this.dom.detailFactors.appendChild(factorFrag);

    const queryText = encodeURIComponent(`용인시 처인구 ${b.d} ${b.nm || b.rd || ''}`.trim());
    this.dom.detailNaverLink.href = `https://map.naver.com/p/search/${queryText}`;
    this.dom.detailKakaoLink.href = `https://map.kakao.com/link/search/${queryText}`;

    this.comments.renderBuildingCommentsPreview(
      this.dom.detailCommentsList,
      this.dom.detailCommentsCount,
      this.dom.detailAllCommentsBtn,
      id
    );
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new HousingApp();
  app.init();
});
