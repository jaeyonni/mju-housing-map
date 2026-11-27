import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  addDoc,
  collection,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { getBuildingDisplayName } from './colorScale.js?v=20';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD5Eak_-pbVftfHKcprL3iy0s9hGOIt9hE',
  authDomain: 'mju-housing-map.firebaseapp.com',
  projectId: 'mju-housing-map',
  storageBucket: 'mju-housing-map.firebasestorage.app',
  messagingSenderId: '665269167421',
  appId: '1:665269167421:web:14d079f93b0ad999ad5154',
};

const NICKNAME_STORAGE_KEY = 'mju_comment_nickname';
const COOLDOWN_MS = 5000;

function formatCommentTime(ts) {
  if (!ts) return '방금 전';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return '방금 전';

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hh}:${mm}`;
}

export class CommentsController {
  constructor(options) {
    this.getBuildings = options.getBuildings;
    this.getSelectedBuilding = options.getSelectedBuilding;
    this.onSelectBuildingFromComment = options.onSelectBuildingFromComment;
    this.onOpenPanel = options.onOpenPanel;
    this.onCommentsUpdated = options.onCommentsUpdated;

    this.db = null;
    this.unsubscribe = null;
    this.comments = [];
    this.isLoaded = false;
    this.loadError = '';

    this.filterTab = 'all'; // 'all' | 'building' | 'free'
    this.filterBuildingId = null;
    this.filterBuildingLabel = '';
    this.mentionedBuilding = null; // { id, name, dong }
    this.lastSubmittedAt = 0;
    this.isSubmitting = false;

    this.dom = this._collectDom();
    this._bindEvents();
    this._restoreNickname();
    this._syncCharCount();
  }

  _collectDom() {
    return {
      panel: document.getElementById('comments-panel'),
      closeBtn: document.getElementById('comments-close-btn'),
      totalCount: document.getElementById('comments-total-count'),
      filterTabs: document.querySelectorAll('[data-comment-filter]'),
      buildingFilterBanner: document.getElementById('comments-building-filter'),
      buildingFilterName: document.getElementById('comments-building-filter-name'),
      buildingFilterClear: document.getElementById('comments-building-filter-clear'),
      form: document.getElementById('comment-form'),
      nicknameInput: document.getElementById('comment-nickname'),
      mentionInput: document.getElementById('comment-mention-input'),
      mentionUseSelectedBtn: document.getElementById('comment-mention-current-btn'),
      mentionDropdown: document.getElementById('comment-mention-dropdown'),
      mentionChipWrap: document.getElementById('comment-mention-chip-wrap'),
      mentionChipLabel: document.getElementById('comment-mention-chip-label'),
      mentionChipClear: document.getElementById('comment-mention-chip-clear'),
      contentInput: document.getElementById('comment-content'),
      charCount: document.getElementById('comment-char-count'),
      submitBtn: document.getElementById('comment-submit-btn'),
      formStatus: document.getElementById('comment-form-status'),
      listState: document.getElementById('comments-list-state'),
      list: document.getElementById('comments-list'),
    };
  }

  _bindEvents() {
    this.dom.closeBtn?.addEventListener('click', () => {
      if (typeof this.onOpenPanel === 'function') this.onOpenPanel(false);
    });

    this.dom.filterTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filterTab = btn.dataset.commentFilter || 'all';
        this.filterBuildingId = null;
        this.filterBuildingLabel = '';
        this._syncFilterUi();
        this._renderList();
      });
    });

    this.dom.buildingFilterClear?.addEventListener('click', () => {
      this.filterBuildingId = null;
      this.filterBuildingLabel = '';
      this._syncFilterUi();
      this._renderList();
    });

    this.dom.mentionInput?.addEventListener('input', () => {
      this._updateMentionDropdown();
    });

    this.dom.mentionInput?.addEventListener('focus', () => {
      if (this.dom.mentionInput.value.trim()) {
        this._updateMentionDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!this.dom.mentionDropdown || this.dom.mentionDropdown.hidden) return;
      if (
        e.target !== this.dom.mentionInput &&
        !this.dom.mentionDropdown.contains(e.target)
      ) {
        this.dom.mentionDropdown.hidden = true;
      }
    });

    this.dom.mentionUseSelectedBtn?.addEventListener('click', () => {
      const selected = this.getSelectedBuilding?.();
      if (!selected) {
        this._setFormStatus('지도에서 먼저 건물을 클릭하거나 아래에서 검색해 주세요.', 'error');
        return;
      }
      this.setMentionedBuilding(selected);
      this._setFormStatus('', '');
    });

    this.dom.mentionChipClear?.addEventListener('click', () => {
      this.clearMentionedBuilding();
    });

    this.dom.contentInput?.addEventListener('input', () => {
      this._syncCharCount();
    });

    this.dom.form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit();
    });
  }

  _restoreNickname() {
    try {
      const saved = localStorage.getItem(NICKNAME_STORAGE_KEY);
      if (saved && this.dom.nicknameInput) {
        this.dom.nicknameInput.value = saved;
      }
    } catch {
      // ignore storage errors
    }
  }

  _syncCharCount() {
    if (!this.dom.contentInput || !this.dom.charCount) return;
    const len = this.dom.contentInput.value.length;
    this.dom.charCount.textContent = `${len} / 500`;
  }

  _setFormStatus(msg, type = '') {
    const el = this.dom.formStatus;
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'comment-form-status';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = `comment-form-status ${type ? `is-${type}` : ''}`.trim();
  }

  init() {
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      this.db = getFirestore(app);
      const q = query(
        collection(this.db, 'comments'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );

      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          this.isLoaded = true;
          this.loadError = '';
          this.comments = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          this._renderList();
          if (typeof this.onCommentsUpdated === 'function') {
            this.onCommentsUpdated(this.comments);
          }
        },
        (err) => {
          console.error('Firestore onSnapshot error:', err);
          this.isLoaded = true;
          this.loadError =
            err?.code === 'permission-denied'
              ? 'Firestore 읽기 권한이 없습니다. 콘솔 보안 규칙을 확인해 주세요.'
              : '실시간 댓글 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
          this._renderList();
          if (typeof this.onCommentsUpdated === 'function') {
            this.onCommentsUpdated(this.comments);
          }
        }
      );
    } catch (err) {
      console.error('Firebase init error:', err);
      this.isLoaded = true;
      this.loadError = '댓글 기능을 초기화하지 못했습니다.';
      this._renderList();
    }
  }

  syncSelectedBuildingShortcut() {
    if (!this.dom.mentionUseSelectedBtn) return;
    const selected = this.getSelectedBuilding?.();
    if (selected) {
      const name = getBuildingDisplayName(selected);
      this.dom.mentionUseSelectedBtn.textContent = `선택 건물 첨부 (${name})`;
      this.dom.mentionUseSelectedBtn.disabled = false;
      this.dom.mentionUseSelectedBtn.title = `${name} 언급하기`;
    } else {
      this.dom.mentionUseSelectedBtn.textContent = '선택 건물 첨부';
      this.dom.mentionUseSelectedBtn.disabled = true;
      this.dom.mentionUseSelectedBtn.title = '지도에서 건물을 선택하면 바로 첨부할 수 있습니다';
    }
  }

  setMentionedBuilding(building) {
    if (!building) {
      this.clearMentionedBuilding();
      return;
    }
    const displayName = getBuildingDisplayName(building).slice(0, 80);
    const dong = (building.d || '').slice(0, 20);
    this.mentionedBuilding = {
      id: String(building.id).slice(0, 60),
      name: displayName,
      dong: dong || null,
    };
    if (this.dom.mentionChipWrap && this.dom.mentionChipLabel) {
      this.dom.mentionChipLabel.textContent = dong ? `${displayName} · ${dong}` : displayName;
      this.dom.mentionChipWrap.hidden = false;
    }
    if (this.dom.mentionInput) {
      this.dom.mentionInput.value = '';
    }
    if (this.dom.mentionDropdown) {
      this.dom.mentionDropdown.hidden = true;
    }
  }

  clearMentionedBuilding() {
    this.mentionedBuilding = null;
    if (this.dom.mentionChipWrap) {
      this.dom.mentionChipWrap.hidden = true;
    }
    if (this.dom.mentionChipLabel) {
      this.dom.mentionChipLabel.textContent = '';
    }
  }

  _updateMentionDropdown() {
    const dropdown = this.dom.mentionDropdown;
    if (!dropdown) return;
    const raw = this.dom.mentionInput?.value.trim().toLowerCase() || '';
    if (!raw) {
      dropdown.hidden = true;
      dropdown.innerHTML = '';
      return;
    }

    const buildings = this.getBuildings?.() || [];
    const ranked = [];
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      const name = getBuildingDisplayName(b);
      const nmLower = (b.nm || '').trim().toLowerCase();
      const rdLower = (b.rd || '').trim().toLowerCase();
      const dispLower = name.toLowerCase();
      const dongLower = (b.d || '').toLowerCase();
      const znLower = (b.zn || '').toLowerCase();

      let tier = 99;
      if (nmLower === raw) tier = 0;
      else if (nmLower.startsWith(raw)) tier = 1;
      else if (nmLower.includes(raw)) tier = 2;
      else if (rdLower.startsWith(raw)) tier = 3;
      else if (rdLower.includes(raw) || dispLower.includes(raw)) tier = 4;
      else if (dongLower.includes(raw) || znLower.includes(raw)) tier = 5;

      if (tier < 99) {
        ranked.push({ b, name, tier });
      }
    }

    ranked.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const sa = a.b.currentScore ?? -1;
      const sb = b.b.currentScore ?? -1;
      if (Math.abs(sb - sa) > 1e-6) return sb - sa;
      const actA = a.b.ps === '실측' ? 1 : 0;
      const actB = b.b.ps === '실측' ? 1 : 0;
      if (actA !== actB) return actB - actA;
      return a.name.localeCompare(b.name, 'ko');
    });

    const matches = ranked.slice(0, 8).map((item) => item.b);

    dropdown.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mention-dropdown-empty';
      empty.textContent = '일치하는 건물이 없습니다.';
      dropdown.appendChild(empty);
      dropdown.hidden = false;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const b of matches) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mention-option';

      const title = document.createElement('span');
      title.className = 'mention-option-title';
      title.textContent = getBuildingDisplayName(b);

      const meta = document.createElement('span');
      meta.className = 'mention-option-meta';
      const metaParts = [b.d];
      if (b.rd && b.rd !== b.nm) metaParts.push(b.rd);
      if (b.cat) metaParts.push(b.cat);
      meta.textContent = metaParts.join(' · ');

      btn.append(title, meta);
      btn.addEventListener('click', () => {
        this.setMentionedBuilding(b);
      });
      frag.appendChild(btn);
    }
    dropdown.appendChild(frag);
    dropdown.hidden = false;
  }

  async _handleSubmit() {
    if (this.isSubmitting) return;
    if (!this.db) {
      this._setFormStatus('댓글 서버가 아직 준비되지 않았습니다.', 'error');
      return;
    }

    const now = Date.now();
    if (now - this.lastSubmittedAt < COOLDOWN_MS) {
      const remain = Math.ceil((COOLDOWN_MS - (now - this.lastSubmittedAt)) / 1000);
      this._setFormStatus(`잠시 후(${remain}초 뒤) 다시 등록해 주세요.`, 'error');
      return;
    }

    const nickname = (this.dom.nicknameInput?.value || '').trim();
    const content = (this.dom.contentInput?.value || '').trim();

    if (!nickname || nickname.length > 20) {
      this._setFormStatus('닉네임은 1~20자 이내로 입력해 주세요.', 'error');
      this.dom.nicknameInput?.focus();
      return;
    }
    if (!content || content.length > 500) {
      this._setFormStatus('내용은 1~500자 이내로 입력해 주세요.', 'error');
      this.dom.contentInput?.focus();
      return;
    }

    const payload = {
      nickname,
      content,
      buildingId: this.mentionedBuilding ? this.mentionedBuilding.id : null,
      buildingName: this.mentionedBuilding ? this.mentionedBuilding.name : null,
      buildingDong: this.mentionedBuilding ? this.mentionedBuilding.dong : null,
      createdAt: serverTimestamp(),
    };

    this.isSubmitting = true;
    if (this.dom.submitBtn) {
      this.dom.submitBtn.disabled = true;
      this.dom.submitBtn.textContent = '등록 중...';
    }
    this._setFormStatus('', '');

    try {
      await addDoc(collection(this.db, 'comments'), payload);
      this.lastSubmittedAt = Date.now();
      try {
        localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
      } catch {
        // ignore storage errors
      }
      if (this.dom.contentInput) {
        this.dom.contentInput.value = '';
      }
      if (!this.filterBuildingId) {
        this.clearMentionedBuilding();
      }
      this._syncCharCount();
      this._setFormStatus('댓글이 등록되었습니다.', 'success');
    } catch (err) {
      console.error('Firestore addDoc error:', err);
      const msg =
        err?.code === 'permission-denied'
          ? '등록 권한이 거부되었습니다. 닉네임(20자)·내용(500자) 제한을 확인해 주세요.'
          : '등록 중 오류가 발생했습니다. 네트워크를 확인해 주세요.';
      this._setFormStatus(msg, 'error');
    } finally {
      this.isSubmitting = false;
      if (this.dom.submitBtn) {
        this.dom.submitBtn.disabled = false;
        this.dom.submitBtn.textContent = '등록';
      }
    }
  }

  _syncFilterUi() {
    this.dom.filterTabs.forEach((btn) => {
      const match = !this.filterBuildingId && btn.dataset.commentFilter === this.filterTab;
      btn.classList.toggle('active', match);
    });
    if (this.dom.buildingFilterBanner && this.dom.buildingFilterName) {
      if (this.filterBuildingId) {
        this.dom.buildingFilterName.textContent = `${this.filterBuildingLabel} 언급 후기만 보는 중`;
        this.dom.buildingFilterBanner.hidden = false;
      } else {
        this.dom.buildingFilterBanner.hidden = true;
      }
    }
  }

  _getFilteredComments() {
    if (this.filterBuildingId) {
      return this.comments.filter((c) => c.buildingId === this.filterBuildingId);
    }
    if (this.filterTab === 'building') {
      return this.comments.filter((c) => Boolean(c.buildingId));
    }
    if (this.filterTab === 'free') {
      return this.comments.filter((c) => !c.buildingId);
    }
    return this.comments;
  }

  _createCommentCard(comment) {
    const item = document.createElement('li');
    item.className = 'comment-item';

    const head = document.createElement('div');
    head.className = 'comment-item-head';

    const nick = document.createElement('span');
    nick.className = 'comment-nick';
    nick.textContent = comment.nickname || '익명';

    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = formatCommentTime(comment.createdAt);

    head.append(nick, time);
    item.appendChild(head);

    if (comment.buildingId && comment.buildingName) {
      const bldgBtn = document.createElement('button');
      bldgBtn.type = 'button';
      bldgBtn.className = 'comment-bldg-chip';
      bldgBtn.title = '지도에서 이 건물로 이동하고 상세 정보 보기';

      const pin = document.createElement('span');
      pin.className = 'comment-bldg-pin';
      pin.textContent = '📍';

      const label = document.createElement('span');
      label.className = 'comment-bldg-name';
      label.textContent = comment.buildingDong
        ? `${comment.buildingName} · ${comment.buildingDong}`
        : comment.buildingName;

      const arrow = document.createElement('span');
      arrow.className = 'comment-bldg-arrow';
      arrow.textContent = '지도 보기 →';

      bldgBtn.append(pin, label, arrow);
      bldgBtn.addEventListener('click', () => {
        if (typeof this.onSelectBuildingFromComment === 'function') {
          this.onSelectBuildingFromComment(comment.buildingId);
        }
      });
      item.appendChild(bldgBtn);
    }

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = comment.content || '';
    item.appendChild(body);

    return item;
  }

  _renderList() {
    if (this.dom.totalCount) {
      this.dom.totalCount.textContent = `${this.comments.length}건`;
    }
    this._syncFilterUi();

    const listEl = this.dom.list;
    const stateEl = this.dom.listState;
    if (!listEl || !stateEl) return;

    if (!this.isLoaded) {
      listEl.innerHTML = '';
      stateEl.hidden = false;
      stateEl.textContent = '실시간 댓글을 불러오는 중...';
      stateEl.className = 'comments-list-state';
      return;
    }

    if (this.loadError) {
      listEl.innerHTML = '';
      stateEl.hidden = false;
      stateEl.textContent = this.loadError;
      stateEl.className = 'comments-list-state is-error';
      return;
    }

    const filtered = this._getFilteredComments();
    if (filtered.length === 0) {
      listEl.innerHTML = '';
      stateEl.hidden = false;
      stateEl.className = 'comments-list-state';
      stateEl.textContent = this.filterBuildingId
        ? '아직 이 건물을 언급한 후기가 없습니다. 첫 후기를 남겨보세요!'
        : '아직 등록된 댓글이 없습니다. 첫 번째 후기를 남겨보세요!';
      return;
    }

    stateEl.hidden = true;
    const frag = document.createDocumentFragment();
    for (const comment of filtered) {
      frag.appendChild(this._createCommentCard(comment));
    }
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  renderBuildingCommentsPreview(containerEl, countEl, allBtnEl, buildingId) {
    if (!containerEl || !countEl) return;
    const matched = this.comments.filter((c) => c.buildingId === buildingId);
    countEl.textContent = String(matched.length);
    containerEl.innerHTML = '';

    if (allBtnEl) {
      allBtnEl.hidden = matched.length <= 3;
    }

    if (matched.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'detail-comments-empty';
      empty.textContent = this.loadError
        ? '댓글 서버에 연결되지 않았습니다.'
        : '아직 이 건물을 언급한 후기가 없습니다.';
      containerEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const c of matched.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'detail-comment-mini';

      const top = document.createElement('div');
      top.className = 'detail-comment-mini-head';

      const nick = document.createElement('span');
      nick.className = 'detail-comment-mini-nick';
      nick.textContent = c.nickname || '익명';

      const time = document.createElement('span');
      time.className = 'detail-comment-mini-time';
      time.textContent = formatCommentTime(c.createdAt);

      top.append(nick, time);

      const text = document.createElement('p');
      text.className = 'detail-comment-mini-text';
      text.textContent = c.content || '';

      row.append(top, text);
      frag.appendChild(row);
    }
    containerEl.appendChild(frag);
  }

  openForBuilding(building, focusInput = true) {
    this.filterBuildingId = null;
    this.filterBuildingLabel = '';
    this.filterTab = 'all';
    if (building) {
      this.setMentionedBuilding(building);
    }
    this.syncSelectedBuildingShortcut();
    this._renderList();
    if (typeof this.onOpenPanel === 'function') {
      this.onOpenPanel(true);
    }
    if (focusInput) {
      setTimeout(() => this.dom.contentInput?.focus(), 60);
    }
  }

  openFilteredByBuilding(building) {
    if (!building) return;
    this.filterBuildingId = building.id;
    this.filterBuildingLabel = getBuildingDisplayName(building);
    this.setMentionedBuilding(building);
    this.syncSelectedBuildingShortcut();
    this._renderList();
    if (typeof this.onOpenPanel === 'function') {
      this.onOpenPanel(true);
    }
  }

  getTotalCount() {
    return this.comments.length;
  }
}
