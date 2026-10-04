const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

try { if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen(); } catch (e) {}
try { if (typeof tg.lockOrientation === 'function') tg.lockOrientation('portrait'); } catch (e) {}
try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch (e) {}

// ============================================================
//   Патч нативных диалогов (Telegram WebView блокирует их)
// ============================================================
(function patchNativeAlerts() {
    try {
        const _origAlert = window.alert;
        window.alert = function(msg) {
            try {
                if (tg && typeof tg.showAlert === 'function') {
                    tg.showAlert(String(msg == null ? '' : msg));
                    return;
                }
            } catch (e) {}
            try { _origAlert.call(window, msg); } catch (e) { console.warn('[alert]', msg); }
        };
    } catch (e) {}
})();

function tgConfirm(msg) {
    return new Promise((resolve) => {
        try {
            if (tg && typeof tg.showConfirm === 'function') {
                tg.showConfirm(String(msg), (ok) => resolve(!!ok));
                return;
            }
        } catch (e) {}
        try { resolve(window.confirm(String(msg))); } catch (e) { resolve(true); }
    });
}

const tgUser = tg.initDataUnsafe?.user || { first_name: 'Гость', last_name: '', username: '', id: 0 };
const INIT_DATA = tg.initData || '';

setTimeout(() => {
    const sp = document.getElementById('splash');
    const app = document.getElementById('app');
    if (sp) sp.classList.add('hide');
    if (app) app.style.display = '';
    setTimeout(() => { if (sp) sp.remove(); }, 600);
}, 1200);

const AVATARS = [
    { idx: 0, path: 'assets/student.webp' },
    { idx: 1, path: 'assets/avatar-1.webp' },
];
function avatarPathByIdx(idx) {
    const found = AVATARS.find(a => a.idx === idx);
    return found ? found.path : AVATARS[0].path;
}

const BS_STORAGE_KEY = 'bs_active_game_id';
const BS_STORAGE_IS_BOT = 'bs_active_is_bot';

const state = {
    tab: 'schedule', loading: false, error: null, user: tgUser, isAdmin: false,
    schedule: null, weekDays: null, nextWeekDays: null, weekOffset: 0, scheduleViewMode: 'today', scheduleDay: 'today',
    tasks: [], tasksStats: { active: 0, done: 0 }, tasksView: 'active',
    taskEditor: false, taskEditorId: null, taskEditorText: '', taskEditorDate: '', taskEditorTime: '', taskEditorPriority: 2,
    notes: [],
    noteEditor: false, noteEditorId: null, noteEditorSubject: '', noteEditorText: '',
    profile: null, wallet: null, chest: null, achievements: [], achievementsLoaded: false,
    chestTimer: null,
    nameEditor: false, nameEditorValue: '',
    chestModal: null,
    achModal: null,
    levelInfoModal: false,
    currencyInfoModal: false,
    premiumModal: null,
    newAchToast: null,
    scholarship: null, groups: null,
    scholarshipEditor: false, scholarshipEditorId: null,
    scholarshipEditorSubject: '', scholarshipEditorGrade: 0,
    scholarshipEditorIsAuto: false, scholarshipEditorSemester: '',
    scholarshipAvailable: [], scholarshipFilter: 'all', scholarshipSemesterFilter: 'all',
    pickerMode: null, pickerInstitute: null, pickerCourse: null, pickerSearch: '',
    notifyEditor: false, notifyEditorType: 'today', notifyEditorHour: 8, notifyEditorMinute: 0,
    aiMessages: [], aiPending: false, aiPendingPhoto: null, aiHistoryLoaded: false,
    adminStats: null, adminFeedback: [], adminMonitor: null, adminBusy: false,
    gamesList: [], gameView: null, currentGame: null, gameResult: null, gameInstance: null,
    walletLeaderboard: [],
    myFeedback: [], myFeedbackLoaded: false, myFeedbackExpanded: false,
    exportPending: false,
    gamePhase: 'start',
    tutorialShown: {},

    exchangeOpen: false,
    exchangeAmount: 100,

    bsScreen: 'lobby',
    bsBet: 50,
    bsMyField: null,
    bsEnemyField: null,
    bsMyShips: [],
    bsEnemyShips: [],
    bsShipsToPlace: [],
    bsPlacingIdx: 0,
    bsPlacingRot: 'h',
    bsTurn: 'me',
    bsEnemyName: 'Бот',
    bsIsBot: false,
    bsLog: [],
    bsResult: null,
    bsGameId: null,
    bsCode: null,
    bsWaiting: false,
    bsBotBusy: false,
    bsPollTimer: null,
    bsJoinModal: false,
    bsJoinCode: '',
    _bsTapLock: false,
    _bsConfirmLock: false,
    _bsBotStarting: false,
};

async function apiGet(path, params = {}) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('initData', INIT_DATA);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const r = await fetch(url.toString(), { signal: controller.signal });
        clearTimeout(timer);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.message || err.error || `HTTP ${r.status}`);
        }
        return await r.json();
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}
async function apiPost(path, body = {}) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: INIT_DATA, ...body }),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const e = new Error(err.message || err.error || `HTTP ${r.status}`);
        e.code = err.error;
        throw e;
    }
    return await r.json();
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function renderEmpty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }
function renderLoading() { return `<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>`; }
function priorityLabel(p) {
    if (p === 3) return '<span class="priority priority-high">Высокий</span>';
    if (p === 2) return '<span class="priority priority-medium">Средний</span>';
    return '<span class="priority priority-low">Низкий</span>';
}
function haptic(type = 'light') {
    try {
        if (type === 'light') tg.HapticFeedback?.impactOccurred('light');
        else if (type === 'medium') tg.HapticFeedback?.impactOccurred('medium');
        else if (type === 'success') tg.HapticFeedback?.notificationOccurred('success');
        else if (type === 'error') tg.HapticFeedback?.notificationOccurred('error');
    } catch (e) {}
}
function formatNotifyTime(hh, mm) { return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
function displayToISO(display) {
    if (!display) return '';
    const parts = String(display).split('.');
    if (parts.length !== 3) return '';
    const [dd, mm, yyyy] = parts;
    if (dd.length !== 2 || mm.length !== 2 || yyyy.length !== 4) return '';
    return `${yyyy}-${mm}-${dd}`;
}
function isoToDisplay(iso) {
    if (!iso) return '';
    const parts = String(iso).split('-');
    if (parts.length !== 3) return '';
    const [yyyy, mm, dd] = parts;
    return `${dd}.${mm}.${yyyy}`;
}
function currentSemester() {
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
    if (month >= 8) return `Осень ${year}`;
    if (month === 0) return `Осень ${year - 1}`;
    return `Весна ${year}`;
}
function popEmoji(char) {
    const el = document.createElement('div');
    el.textContent = char;
    el.style.cssText = 'position:fixed;top:50%;left:50%;font-size:56px;transform:translate(-50%,-50%);animation:pop 0.6s ease-out;z-index:99999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
}
function formatNumber(n) {
    return Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
}

// ============================================================
//   Сохранение сессии морского боя
// ============================================================
function bsSaveSession() {
    try {
        if (state.bsGameId && !state.bsIsBot) {
            localStorage.setItem(BS_STORAGE_KEY, state.bsGameId);
            localStorage.setItem(BS_STORAGE_IS_BOT, '0');
        } else {
            localStorage.removeItem(BS_STORAGE_KEY);
            localStorage.removeItem(BS_STORAGE_IS_BOT);
        }
    } catch (e) {}
}
function bsClearSession() {
    try {
        localStorage.removeItem(BS_STORAGE_KEY);
        localStorage.removeItem(BS_STORAGE_IS_BOT);
    } catch (e) {}
}

// ============================================================
//                       МУЗЫКА
// ============================================================

function isMusicMuted() { return localStorage.getItem('flappy_muted') === '1'; }
function startGameMusic() {
    if (isMusicMuted()) return;
    const el = document.getElementById('game-music');
    if (!el) return;
    el.volume = 0.4;
    el.play().catch(() => {});
}
function stopGameMusic() {
    const el = document.getElementById('game-music');
    if (!el) return;
    try { el.pause(); el.currentTime = 0; } catch (e) {}
}
function toggleMusicMute() {
    const nowMuted = !isMusicMuted();
    try { localStorage.setItem('flappy_muted', nowMuted ? '1' : '0'); } catch (e) {}
    if (nowMuted) stopGameMusic();
    else if (state.gameView === 'playing' && state.gameInstance && state.gameInstance.started) startGameMusic();
    const btn = document.getElementById('game-mute-btn');
    if (btn) btn.textContent = nowMuted ? '🔇' : '🔊';
    haptic('light');
}

// ============================================================
//   СПРАЙТ ГЕРОЯ
// ============================================================

let heroSprite = null;
let heroSpriteReady = false;

(function loadHeroSprite() {
    const img = new Image();
    img.onload = () => {
        try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            try {
                const imgData = g.getImageData(0, 0, c.width, c.height);
                const d = imgData.data;
                let transparentCount = 0;
                const totalPixels = d.length / 4;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] === 0) { transparentCount++; continue; }
                    if (d[i] >= 240 && d[i + 1] >= 240 && d[i + 2] >= 240) {
                        d[i + 3] = 0;
                        transparentCount++;
                    }
                }
                if (transparentCount > totalPixels * 0.75) {
                    heroSprite = img; heroSpriteReady = true; return;
                }
                g.putImageData(imgData, 0, 0);
                heroSprite = c; heroSpriteReady = true;
            } catch (err) {
                heroSprite = img; heroSpriteReady = true;
            }
        } catch (e) {
            heroSprite = img; heroSpriteReady = true;
        }
    };
    img.onerror = () => { heroSprite = null; heroSpriteReady = false; };
    img.src = 'assets/hero.webp';
})();

// ============================================================
//          SVG / ИКОНКИ
// ============================================================

function studentAvatarSvg() {
    const idx = state.wallet?.avatar_idx || 0;
    const path = avatarPathByIdx(idx);
    return `<img src="${path}" alt="Аватар" class="profile-avatar-img"
        onerror="this.outerHTML = studentAvatarFallback();">`;
}
function studentAvatarFallback() {
    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="fbGlow" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stop-color="#00E5D0" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#00E5D0" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="fbSkin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#eec096"/><stop offset="100%" stop-color="#c99568"/>
            </linearGradient>
            <linearGradient id="fbHood" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#1b2540"/><stop offset="100%" stop-color="#060a12"/>
            </linearGradient>
            <radialGradient id="fbEye" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#fff"/>
                <stop offset="40%" stop-color="#7CFFEE"/>
                <stop offset="100%" stop-color="#00E5D0" stop-opacity="0"/>
            </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="98" fill="url(#fbGlow)"/>
        <path d="M20 200 Q20 155 55 145 Q75 152 100 152 Q125 152 145 145 Q180 155 180 200 Z" fill="url(#fbHood)"/>
        <rect x="85" y="115" width="30" height="28" fill="url(#fbSkin)"/>
        <ellipse cx="100" cy="88" rx="42" ry="50" fill="url(#fbSkin)"/>
        <path d="M58 62 Q60 30 100 24 Q140 30 142 62 Q138 48 128 42 Q100 34 72 42 Q62 48 58 62 Z" fill="#3a2418"/>
        <ellipse cx="82" cy="88" rx="9" ry="6" fill="#0a0d16"/>
        <ellipse cx="118" cy="88" rx="9" ry="6" fill="#0a0d16"/>
        <circle cx="82" cy="88" r="14" fill="url(#fbEye)"/>
        <circle cx="118" cy="88" r="14" fill="url(#fbEye)"/>
        <circle cx="82" cy="88" r="3" fill="#fff"/>
        <circle cx="118" cy="88" r="3" fill="#fff"/>
        <path d="M88 120 Q100 127 112 120" stroke="#5c2a1c" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </svg>`;
}
function softIconSvg() {
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="sfi" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#7CFFEE"/><stop offset="55%" stop-color="#00E5D0"/><stop offset="100%" stop-color="#0A9B8E"/>
        </radialGradient></defs>
        <circle cx="32" cy="32" r="26" fill="url(#sfi)" stroke="#00B8A8" stroke-width="2"/>
        <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>
        <text x="32" y="38" font-family="Manrope, sans-serif" font-size="22" font-weight="900" fill="#070B14" text-anchor="middle">₽</text>
    </svg>`;
}
function hardIconSvg() {
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="hri" cx="40%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#FFEE9C"/><stop offset="55%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/>
        </radialGradient></defs>
        <circle cx="32" cy="32" r="26" fill="url(#hri)" stroke="#8A6508" stroke-width="2"/>
        <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.4"/>
        <text x="32" y="41" font-family="Manrope, sans-serif" font-size="26" font-weight="900" fill="#3D2600" text-anchor="middle">A</text>
    </svg>`;
}
function chestSvg() {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="chg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#B8860B"/>
            </linearGradient>
            <linearGradient id="chg2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#FFEE9C"/><stop offset="100%" stop-color="#FFD700"/>
            </linearGradient>
        </defs>
        <rect x="14" y="44" width="72" height="40" rx="6" fill="url(#chg)" stroke="#8A6508" stroke-width="1.5"/>
        <path d="M14 48 Q14 22 50 22 Q86 22 86 48 L86 52 L14 52 Z" fill="url(#chg2)" stroke="#8A6508" stroke-width="1.5"/>
        <rect x="14" y="42" width="72" height="6" fill="#8A6508"/>
        <rect x="44" y="38" width="12" height="20" rx="2" fill="#FFEE9C" stroke="#8A6508" stroke-width="1"/>
        <circle cx="50" cy="48" r="2.5" fill="#B8860B"/>
    </svg>`;
}
function anchorIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="5" r="3"></circle>
        <line x1="12" y1="22" x2="12" y2="8"></line>
        <path d="M5 12H2a10 10 0 0 0 20 0h-3"></path>
    </svg>`;
}
function targetIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="6"></circle>
        <circle cx="12" cy="12" r="2"></circle>
    </svg>`;
}
function robotIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="2"></rect>
        <circle cx="9" cy="13" r="1"></circle>
        <circle cx="15" cy="13" r="1"></circle>
        <line x1="9" y1="17" x2="15" y2="17"></line>
        <line x1="12" y1="4" x2="12" y2="8"></line>
        <circle cx="12" cy="3" r="1"></circle>
    </svg>`;
}
function keyIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
    </svg>`;
}
function usersIconSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>`;
}

// ============================================================
//                       RENDER
// ============================================================

function render() {
    const content = document.getElementById('content');
    const title = document.getElementById('page-title');
    const appEl = document.getElementById('app');
    const navEl = document.getElementById('bottom-nav');

    const titles = { schedule: 'Расписание', tasks: 'Задачи', notes: 'Заметки', games: 'Игры', ai: 'AI', admin: 'Админ', profile: 'Профиль' };

    if (state.gameView === 'result') {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = 'Результат';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderGameResult();
        attachHandlers();
        return;
    }
    if (state.gameView === 'playing') {
        appEl?.classList.add('picker-open');
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderGameScreen();
        attachHandlers();
        requestAnimationFrame(() => initGame());
        return;
    }

    if (state.gameView === 'battleship') {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = 'Морской бой';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderBattleship();
        attachHandlers();
        return;
    }

    if (state.taskEditor) {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = state.taskEditorId ? 'Изменить задачу' : 'Новая задача';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderTaskEditor();
        attachHandlers();
        return;
    }
    if (state.noteEditor) {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = state.noteEditorId ? 'Изменить заметку' : 'Новая заметка';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderNoteEditor();
        attachHandlers();
        return;
    }
    if (state.notifyEditor) {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = 'Уведомления';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderNotifyEditor();
        attachHandlers();
        return;
    }
    if (state.scholarshipEditor) {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = state.scholarshipEditorId ? 'Изменить оценку' : 'Новая оценка';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderScholarshipEditor();
        attachHandlers();
        return;
    }
    if (state.pickerMode) {
        appEl?.classList.add('picker-open');
        if (title) {
            if (state.pickerMode === 'institute') title.textContent = 'Институт';
            else if (state.pickerMode === 'course') title.textContent = 'Курс';
            else title.textContent = 'Группа';
        }
        if (navEl) navEl.style.display = 'none';
        let html = '';
        if (state.pickerMode === 'institute') html = renderInstitutePicker();
        else if (state.pickerMode === 'course') html = renderCoursePicker();
        else html = renderGroupPicker();
        content.innerHTML = html;
        attachHandlers();
        if (state.pickerMode === 'group') pickerAttachSearch();
        return;
    }

    let modalHtml = '';
    if (state.nameEditor) modalHtml = renderNameEditorModal();
    else if (state.chestModal) modalHtml = renderChestModal();
    else if (state.premiumModal) modalHtml = renderPremiumModal();
    else if (state.achModal) modalHtml = renderAchModal();
    else if (state.levelInfoModal) modalHtml = renderLevelInfoModal();
    else if (state.currencyInfoModal) modalHtml = renderCurrencyInfoModal();
    else if (state.newAchToast) modalHtml = renderNewAchToast();
    else if (state.exchangeOpen) modalHtml = renderExchangeModal();
    else if (state.bsJoinModal) modalHtml = renderBSJoinModal();

    appEl?.classList.remove('picker-open');
    if (navEl) navEl.style.display = '';

    title.textContent = titles[state.tab] || 'Студент';

    let html = '';
    if (state.loading) html = renderLoading();
    else if (state.error) html = `<div class="empty">Ошибка: ${escapeHtml(state.error)}</div>`;
    else {
        switch (state.tab) {
            case 'schedule': html = renderSchedule(); break;
            case 'tasks': html = renderTasks(); break;
            case 'notes': html = renderNotes(); break;
            case 'games': html = renderGames(); break;
            case 'ai': html = renderAI(); break;
            case 'admin': html = renderAdmin(); break;
            case 'profile': html = renderProfile(); break;
        }
    }

    content.innerHTML = html + modalHtml;
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        const isAdmin = btn.dataset.tab === 'admin';
        btn.style.display = (isAdmin && !state.isAdmin) ? 'none' : '';
        btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
    attachHandlers();
    if (state.tab === 'schedule') attachScheduleSwipe();
    syncChestTimer();
}

// ============================================================
//              ТАЙМЕР «ХАЛЯВА ДНЯ»
// ============================================================

function stopChestTimer() {
    if (state.chestTimer) { clearInterval(state.chestTimer); state.chestTimer = null; }
}
function syncChestTimer() {
    if (state.tab !== 'profile') { stopChestTimer(); return; }
    if (!state.chest || state.chest.can_open) { stopChestTimer(); return; }
    if (!state.chest.next_at) { stopChestTimer(); return; }
    if (!state.chestTimer) state.chestTimer = setInterval(updateChestTimer, 1000);
    updateChestTimer();
}
async function updateChestTimer() {
    if (!state.chest || state.chest.can_open || !state.chest.next_at) { stopChestTimer(); return; }
    const next = new Date(state.chest.next_at);
    const diff = next.getTime() - Date.now();
    if (diff <= 0) {
        try { state.chest = await apiGet('/api/chest/status'); } catch (e) {}
        stopChestTimer(); render(); return;
    }
    const hh = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const mm = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const ss = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    const el = document.getElementById('chest-timer');
    if (el) el.textContent = `${hh}:${mm}:${ss}`;
}

// ============================================================
//                       ПРОФИЛЬ
// ============================================================

function renderBalanceCard() {
    const w = state.wallet || {};
    const lvl = w.level || 1;
    const xpIn = w.xp_in_level || 0;
    const xpNext = w.xp_to_next || 500;
    const xpPct = Math.min(100, Math.round((xpIn / xpNext) * 100));
    return `<div class="balance-card">
        <div class="balance-header">
            <div class="balance-title">Баланс</div>
            <div class="balance-level-tag">LVL ${lvl}</div>
        </div>
        <div class="balance-grid">
            <div class="balance-tile soft">
                <div class="balance-tile-icon">${softIconSvg()}</div>
                <div class="balance-tile-value">${formatNumber(w.soft || 0)}</div>
                <div class="balance-tile-label">Стипух</div>
            </div>
            <div class="balance-tile hard">
                <div class="balance-tile-icon">${hardIconSvg()}</div>
                <div class="balance-tile-value">${formatNumber(w.hard || 0)}</div>
                <div class="balance-tile-label">Автоматов</div>
            </div>
        </div>
        <div class="balance-xp-row">
            <div class="balance-xp-bar"><div class="balance-xp-fill" style="width:${xpPct}%"></div></div>
            <div class="balance-xp-text">${xpIn} / ${xpNext} XP</div>
        </div>
        <div class="balance-actions">
            <button class="btn btn-secondary" data-action="exchange-open" style="width:100%">Обменять</button>
            <button class="btn btn-secondary" data-action="currency-info-open" style="width:100%">Где взять валюту</button>
        </div>
    </div>`;
}

function renderProfile() {
    const p = state.profile;
    const w = state.wallet;
    const u = state.user;
    const ach = state.achievements || [];
    const achGot = ach.filter(a => a.unlocked).length;
    if (!p) return renderLoading();

    const displayName = (p.display_name && p.display_name !== 'PLAYER') ? p.display_name : (u.first_name || 'Студент');
    const playerTag = p.player_tag || `PLAYER-${String(u.id).slice(-6).toUpperCase()}`;

    let html = '';
    const lvl = w?.level || 1;

    html += `<div class="profile-hero">
        <div class="profile-name-hero">
            <span class="profile-name-main">${escapeHtml(displayName)}</span>
            <button class="profile-edit-btn" data-action="name-open" title="Изменить имя">✏️</button>
        </div>
        <div class="profile-tag-id">${escapeHtml(playerTag)}</div>
        <div class="profile-avatar-wrap">${studentAvatarSvg()}</div>
        <div class="avatar-change-row">
            <button class="avatar-change-btn" data-action="avatar-toggle">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span>Сменить аватар</span>
            </button>
        </div>
        <div class="profile-level-block" data-action="level-info-open">
            <div class="profile-level-num">${lvl}<small>LVL</small></div>
            <div class="profile-level-title">${escapeHtml(w?.level_title || 'Первокурсник')}</div>
            <div class="profile-level-hint">Как получать XP?</div>
        </div>
        <div class="streak-row"><span class="fire">🔥</span> Стрик: ${p.streak || 0} ${p.streak === 1 ? 'день' : 'дн.'}</div>
    </div>`;

    html += renderBalanceCard();

    const chestReady = state.chest?.can_open !== false;
    html += `<div class="chest-card">
        <div class="chest-svg">${chestSvg()}</div>
        <div class="chest-title">Халява дня</div>
        <div class="chest-sub">${chestReady ? '🎁 Готово к открытию' : '🎁 Сегодняшняя халява уже получена'}</div>
        ${chestReady ? '' : `<div class="chest-timer" id="chest-timer">--:--:--</div>`}
        <button class="chest-btn" data-action="chest-open" ${chestReady ? '' : 'disabled'}>
            ${chestReady ? 'Открыть' : 'Уже открыто'}
        </button>
    </div>`;

    const hardHave = w?.hard || 0;
    const canPremium = hardHave >= 10;
    html += `<div class="premium-chest-card">
        <div class="premium-chest-crown">👑</div>
        <div class="premium-chest-title">Премиум сундук</div>
        <div class="premium-chest-sub">Стоимость: <strong>10 Автоматов</strong> · у тебя: ${hardHave}</div>
        <div class="premium-chest-preview">
            <div class="premium-chest-item">💰 500 Стипух · ⚡ 1000 XP</div>
            <div class="premium-chest-item">🎁 Бонус: 3 / 5 / 10 / 25 Автоматов</div>
        </div>
        <button class="premium-chest-btn" data-action="premium-open" ${canPremium ? '' : 'disabled'}>
            ${canPremium ? 'Открыть за 10 Автоматов' : 'Нужно 10 Автоматов'}
        </button>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Достижения: ${achGot} / ${ach.length || 8}</div>
        <div class="ach-grid">
            ${ach.length === 0 ? '<div class="card-subtitle">Загрузка...</div>' : ach.map(a => `
                <div class="ach-item ${a.unlocked ? 'unlocked' : ''}" data-action="ach-open" data-id="${escapeHtml(a.id)}">
                    <div class="ach-emoji">${a.icon}</div>
                    <div class="ach-name">${escapeHtml(a.name)}</div>
                </div>
            `).join('')}
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Статистика</div>
        <div class="card-subtitle">Активных задач: ${p.tasks_active ?? 0}</div>
        <div class="card-subtitle">Выполнено: ${p.tasks_done ?? 0}</div>
        <div class="card-subtitle">Заметок: ${p.notes_count ?? 0}</div>
        <div class="card-subtitle">Оценок: ${p.grades_count ?? 0}</div>
    </div>`;

    const attTotal = p.attendance_total || 0;
    html += `<div class="card"><div class="card-title">Посещаемость</div>`;
    if (attTotal === 0) html += `<div class="card-subtitle">Отмечай пары в расписании — здесь появится статистика.</div>`;
    else {
        html += `<div class="att-stat-row"><span class="att-stat-label">Всего отмечено</span><span class="att-stat-value">${attTotal}</span></div>`;
        html += `<div class="att-stat-row"><span class="att-stat-label">Посещено</span><span class="att-stat-value green">${p.attendance_was || 0}</span></div>`;
        html += `<div class="att-stat-row"><span class="att-stat-label">Пропущено</span><span class="att-stat-value red">${p.attendance_missed || 0}</span></div>`;
        html += `<div class="att-stat-row"><span class="att-stat-label">По болезни</span><span class="att-stat-value yellow">${p.attendance_sick || 0}</span></div>`;
    }
    html += `</div>`;

    html += `<div class="card">
        <div class="card-title">Моя группа</div>
        <div class="card-subtitle">${p?.group ? escapeHtml(p.group) : 'не выбрана'}</div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="choose-group">${p?.group ? 'Изменить' : 'Выбрать группу'}</button>
            ${p?.group ? `<button class="btn btn-secondary" data-action="forget-group">Забыть</button>` : ''}
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Подгруппа</div>
        <div class="card-subtitle">${p?.subgroup ? 'Подгруппа ' + p.subgroup : 'не выбрана'}</div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="set-subgroup" data-value="0">—</button>
            <button class="btn btn-secondary" data-action="set-subgroup" data-value="1">1</button>
            <button class="btn btn-secondary" data-action="set-subgroup" data-value="2">2</button>
        </div>
    </div>`;

    const notifyOn = !!p?.notify_type;
    const notifyLabel = notifyOn ? `${p.notify_type === 'today' ? 'Сегодня' : 'Завтра'} в ${formatNotifyTime(p.notify_hour, p.notify_minute)}` : 'выключены';
    html += `<div class="card">
        <div class="card-title">Уведомления о расписании</div>
        <div class="card-subtitle">Сейчас: ${escapeHtml(notifyLabel)}</div>
        <div class="actions-row"><button class="btn" data-action="notify-open">${notifyOn ? 'Изменить' : 'Включить'}</button></div>
        <label class="checkbox-row">
            <input type="checkbox" id="notify-changes" ${p?.notify_changes ? 'checked' : ''}>
            <span>Следить за изменениями в расписании</span>
        </label>
        <div class="card-subtitle" style="margin-top:14px">Напомнить за N минут до пары</div>
        <div class="nbf-buttons">
            ${[0, 10, 15, 30].map(m => `
                <button class="nbf-btn ${(p?.notify_before_min || 0) === m ? 'active' : ''}"
                        data-action="notify-set-before" data-value="${m}">${m === 0 ? 'Выкл' : m + ' мин'}</button>
            `).join('')}
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Цитата дня</div>
        <div class="card-subtitle">${p?.daily_subscribed ? 'Подписан — приходит в 10:00' : 'Не подписан'}</div>
        <div class="actions-row">
            ${p?.daily_subscribed
                ? `<button class="btn btn-secondary" data-action="quote-subscribe" data-value="0">Отписаться</button>`
                : `<button class="btn" data-action="quote-subscribe" data-value="1">Подписаться</button>`}
        </div>
    </div>`;

    html += renderScholarshipCard();
    html += renderMyFeedbackCard();

    html += `<div class="card">
        <div class="card-title">Обратная связь</div>
        <textarea class="input" id="feedback-text" placeholder="Сообщение админу..." rows="3"></textarea>
        <button class="btn" data-action="feedback-send">Отправить</button>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Экспорт данных</div>
        <div class="export-hint">PDF-файл со всеми данными: задачи, заметки, оценки, посещаемость.</div>
        <button class="btn btn-secondary" data-action="export-data" style="width:100%" ${state.exportPending ? 'disabled' : ''}>${state.exportPending ? 'Готовлю PDF...' : 'Скачать PDF'}</button>
    </div>`;

    return html;
}

// ============================================================
//           МОДАЛКА «ГДЕ ВЗЯТЬ ВАЛЮТУ»
// ============================================================

function renderCurrencyInfoModal() {
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-modal-title">Откуда взять валюту</div>
            <div class="info-modal-sub">Все способы получать Стипухи и Автоматы</div>

            <div class="currency-info-section">
                <div class="currency-info-section-title soft">${softIconSvg()} Стипухи</div>
                <div class="currency-info-row"><span class="currency-info-row-label">Добавить задачу</span><span class="currency-info-row-value soft">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Выполнить задачу</span><span class="currency-info-row-value soft">+5</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Новая заметка</span><span class="currency-info-row-value soft">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Добавить оценку</span><span class="currency-info-row-value soft">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Отметить посещение</span><span class="currency-info-row-value soft">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Вопрос AI</span><span class="currency-info-row-value soft">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">AI с фото</span><span class="currency-info-row-value soft">+2</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Игра «До пары успеть»</span><span class="currency-info-row-value soft">+1–30</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Халява дня</span><span class="currency-info-row-value soft">+10–30</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Премиум-сундук</span><span class="currency-info-row-value soft">+500</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Победа в морском бою</span><span class="currency-info-row-value soft">×2 ставки</span></div>
            </div>

            <div class="currency-info-section">
                <div class="currency-info-section-title hard">${hardIconSvg()} Автоматы</div>
                <div class="currency-info-row"><span class="currency-info-row-label">Халява дня (редкий дроп)</span><span class="currency-info-row-value hard">+1 – 5</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Премиум-сундук (за 10 А)</span><span class="currency-info-row-value hard">+3 – 25</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Рекорд в игре</span><span class="currency-info-row-value hard">+1</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Новый рекорд в игре</span><span class="currency-info-row-value hard">+5</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Достижения</span><span class="currency-info-row-value hard">+1 – 10</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Обменник (курс 100:1)</span><span class="currency-info-row-value hard">∞</span></div>
            </div>

            <div class="currency-info-exchange">
                <span>100 Стипух</span>
                <span class="arrow">→</span>
                <span class="value-gold">1 Автомат</span>
            </div>

            <div class="currency-info-section">
                <div class="currency-info-section-title spend">Куда потратить</div>
                <div class="currency-info-row"><span class="currency-info-row-label">Премиум-сундук</span><span class="currency-info-row-value hard">10 А</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Смена ника (если нет бесплатной)</span><span class="currency-info-row-value hard">5 А</span></div>
                <div class="currency-info-row"><span class="currency-info-row-label">Ставка в морском бою</span><span class="currency-info-row-value soft">10–500 С</span></div>
            </div>

            <div class="actions-row" style="justify-content:center;margin-top:10px">
                <button class="btn" data-action="modal-close">Понятно</button>
            </div>
        </div>
    </div>`;
}

// ============================================================
//           МОДАЛКА ВВОДА КОДА ДЛЯ PVP
// ============================================================

function renderBSJoinModal() {
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-modal-title">Введи код игры</div>
            <div class="info-modal-sub">6 цифр от друга</div>
            <input class="modal-input" id="bs-join-code-input" maxlength="6" inputmode="numeric"
                   pattern="[0-9]*" value="${escapeHtml(state.bsJoinCode || '')}"
                   placeholder="000000" autofocus>
            <div class="card-subtitle" style="text-align:center;margin-bottom:16px">
                Ставка: <strong style="color:var(--neon)">${state.bsBet}</strong> Стипух
            </div>
            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="bs-join-submit">Войти</button>
                <button class="btn btn-secondary" data-action="modal-close">Отмена</button>
            </div>
        </div>
    </div>`;
}

// ============================================================
//                     ОБМЕННИК ВАЛЮТЫ
// ============================================================

const EXCHANGE_RATE = 100;

function renderExchangeModal() {
    const w = state.wallet || {};
    const soft = w.soft || 0;
    const amount = Math.max(0, Math.min(state.exchangeAmount || 0, soft));
    const hard = Math.floor(amount / EXCHANGE_RATE);
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-modal-title">Обмен валюты</div>
            <div class="info-modal-sub">Обменяй Стипухи на Автоматы</div>

            <div class="exchange-rate-badge">
                <span>${EXCHANGE_RATE} Стипух</span>
                <span class="rate-arrow">→</span>
                <span class="rate-value">1 Автомат</span>
            </div>

            <div class="exchange-input-wrap">
                <input class="exchange-input" id="exchange-amount-input" type="number" min="0" step="100"
                       value="${state.exchangeAmount}" inputmode="numeric"
                       placeholder="0">
                <div class="exchange-input-suffix">Стипух</div>
            </div>

            <div class="exchange-quick-buttons">
                <button class="exchange-quick-btn" data-action="exchange-quick" data-value="0.25">25%</button>
                <button class="exchange-quick-btn" data-action="exchange-quick" data-value="0.5">50%</button>
                <button class="exchange-quick-btn" data-action="exchange-quick" data-value="0.75">75%</button>
                <button class="exchange-quick-btn" data-action="exchange-quick" data-value="1">MAX</button>
            </div>

            <div class="exchange-preview">
                <div class="exchange-preview-label">Получишь</div>
                <div class="exchange-preview-value">${hard}<span class="suffix">Автоматов</span></div>
            </div>

            <div class="exchange-balance-hint">
                Доступно: <strong>${formatNumber(soft)}</strong> Стипух
            </div>

            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="exchange-submit" ${hard > 0 ? '' : 'disabled'}>Обменять</button>
                <button class="btn btn-secondary" data-action="modal-close">Отмена</button>
            </div>
        </div>
    </div>`;
}

function actionExchangeOpen() {
    haptic('light');
    state.exchangeAmount = EXCHANGE_RATE;
    state.exchangeOpen = true;
    render();
}

function actionExchangeQuick(ratio) {
    haptic('light');
    const soft = state.wallet?.soft || 0;
    let amt = Math.floor(soft * ratio);
    amt = Math.floor(amt / EXCHANGE_RATE) * EXCHANGE_RATE;
    state.exchangeAmount = Math.max(0, amt);
    render();
}

async function actionExchangeSubmit() {
    const w = state.wallet || {};
    const soft = w.soft || 0;
    const amount = Math.max(0, Math.min(Math.floor(state.exchangeAmount || 0), soft));
    const hard = Math.floor(amount / EXCHANGE_RATE);
    if (hard <= 0) { haptic('error'); alert('Слишком маленькая сумма для обмена'); return; }
    try {
        const r = await apiPost('/api/exchange-soft-to-hard', { amount });
        haptic('success');
        popEmoji('💱');
        if (r.wallet) state.wallet = r.wallet;
        state.exchangeOpen = false;
        await loadProfile();
        render();
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось обменять'));
    }
}

// ============================================================
//                       МОДАЛКИ
// ============================================================

function renderNameEditorModal() {
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="modal-title">Изменить имя</div>
            <div class="modal-sub">Максимум 24 символа.</div>
            <input class="modal-input" id="name-editor-input" maxlength="24" value="${escapeHtml(state.nameEditorValue || '')}" placeholder="Твоё имя" autofocus>
            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="name-save">Сохранить</button>
                <button class="btn btn-secondary" data-action="modal-close">Отмена</button>
            </div>
        </div>
    </div>`;
}
function renderChestModal() {
    const r = state.chestModal;
    if (!r) return '';
    const emojiMap = { soft: '💰', xp: '⚡', hard: '🏅', free_name: '✏️' };
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="reward-reveal">
                <div class="reward-icon">${emojiMap[r.type] || '🎁'}</div>
                <div class="reward-label">${escapeHtml(r.label || '')}</div>
                <div class="reward-desc">${r.type === 'soft' ? 'Стипухи зачислены' : r.type === 'xp' ? 'Опыт добавлен' : r.type === 'hard' ? 'Автомат твой!' : 'Смена ника бесплатно'}</div>
            </div>
            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="modal-close">Круто!</button>
            </div>
        </div>
    </div>`;
}
function renderPremiumModal() {
    const r = state.premiumModal;
    if (!r) return '';
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="reward-reveal" style="padding-top:14px">
                <div class="reward-icon">👑</div>
                <div class="reward-premium-label">ПРЕМИУМ СУНДУК</div>
            </div>
            <div class="reward-premium-list">
                <div class="reward-premium-row"><span>💰 Стипухи</span><span class="val">+${r.soft || 0}</span></div>
                <div class="reward-premium-row"><span>⚡ Опыт</span><span class="val">+${r.xp || 0} XP</span></div>
                <div class="reward-premium-row"><span>🏅 Бонус</span><span class="val gold">${escapeHtml(r.bonus_label || '—')}</span></div>
            </div>
            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="modal-close">Круто!</button>
            </div>
        </div>
    </div>`;
}
function renderNewAchToast() {
    const list = state.newAchToast || [];
    if (list.length === 0) return '';
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-modal-title">🎉 Новое достижение!</div>
            <div class="info-modal-sub">${list.length > 1 ? `Открыто сразу ${list.length}:` : 'Ты только что получил:'}</div>
            <div class="ach-toast-list">
                ${list.map(a => `
                    <div class="ach-toast-item">
                        <div class="ach-toast-icon">${a.icon}</div>
                        <div class="ach-toast-body">
                            <div class="ach-toast-name">${escapeHtml(a.name)}</div>
                            <div class="ach-toast-reward">${escapeHtml(a.rewardText)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="actions-row" style="justify-content:center">
                <button class="btn" data-action="modal-close">Отлично!</button>
            </div>
        </div>
    </div>`;
}
function renderLevelInfoModal() {
    const w = state.wallet || {};
    const lvl = w.level || 1;
    const xpIn = w.xp_in_level || 0;
    const xpNext = w.xp_to_next || 500;
    const xpPct = Math.min(100, Math.round((xpIn / xpNext) * 100));
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-modal-title">Уровни и опыт</div>
            <div class="info-modal-sub">Как растёт уровень и за что дают XP</div>
            <div class="info-current">
                <div class="info-current-lvl">${lvl}<small>LVL</small></div>
                <div class="info-current-info">
                    <div class="info-current-name">${escapeHtml(w.level_title || 'Первокурсник')}</div>
                    <div class="info-current-xp">${xpIn} / ${xpNext} XP</div>
                </div>
            </div>
            <div class="info-xp-bar"><div class="info-xp-fill" style="width:${xpPct}%"></div></div>
            <div class="info-section">
                <div class="info-section-title">За что дают опыт</div>
                <div class="info-row"><span class="info-row-label">Задача добавлена</span><span class="info-row-value">+5 XP</span></div>
                <div class="info-row"><span class="info-row-label">Задача выполнена</span><span class="info-row-value">+20 XP</span></div>
                <div class="info-row"><span class="info-row-label">Заметка</span><span class="info-row-value">+3 XP</span></div>
                <div class="info-row"><span class="info-row-label">Оценка в стипендию</span><span class="info-row-value">+5 XP</span></div>
                <div class="info-row"><span class="info-row-label">Отметка посещаемости</span><span class="info-row-value">+3 XP</span></div>
                <div class="info-row"><span class="info-row-label">Вопрос AI</span><span class="info-row-value">+2 XP</span></div>
                <div class="info-row"><span class="info-row-label">AI с фото</span><span class="info-row-value">+5 XP</span></div>
                <div class="info-row"><span class="info-row-label">Игра: 1 очко</span><span class="info-row-value">+2 XP</span></div>
            </div>
            <div class="info-section">
                <div class="info-section-title">Формула уровня</div>
                <div class="info-row"><span class="info-row-label">1 → 2 уровень</span><span class="info-row-value muted">500 XP</span></div>
                <div class="info-row"><span class="info-row-label">2 → 3 уровень</span><span class="info-row-value muted">1000 XP</span></div>
                <div class="info-row"><span class="info-row-label">N → N+1 уровень</span><span class="info-row-value">N × 500 XP</span></div>
                <div class="info-row"><span class="info-row-label">Максимум</span><span class="info-row-value gold">30 LVL</span></div>
            </div>
            <div class="info-section">
                <div class="info-section-title">Титулы</div>
                <div class="info-row"><span class="info-row-label">1–5</span><span class="info-row-value muted">Первокурсник</span></div>
                <div class="info-row"><span class="info-row-label">6–10</span><span class="info-row-value muted">Второкурсник</span></div>
                <div class="info-row"><span class="info-row-label">11–15</span><span class="info-row-value muted">Третьекурсник</span></div>
                <div class="info-row"><span class="info-row-label">16–20</span><span class="info-row-value muted">Старшекурсник</span></div>
                <div class="info-row"><span class="info-row-label">21–25</span><span class="info-row-value muted">Магистрант</span></div>
                <div class="info-row"><span class="info-row-label">26–29</span><span class="info-row-value muted">Аспирант</span></div>
                <div class="info-row"><span class="info-row-label">30</span><span class="info-row-value gold">Легенда ИРНИТУ</span></div>
            </div>
            <div class="actions-row" style="justify-content:center;margin-top:20px">
                <button class="btn" data-action="modal-close">Понятно</button>
            </div>
        </div>
    </div>`;
}
function renderAchModal() {
    const achId = state.achModal;
    if (!achId) return '';
    const item = (state.achievements || []).find(a => a.id === achId);
    if (!item) return '';
    const status = item.unlocked
        ? '<span class="info-ach-badge unlocked">Получено</span>'
        : '<span class="info-ach-badge locked">Ещё не открыто</span>';
    return `<div class="modal-backdrop" data-action="modal-close">
        <div class="modal-box" onclick="event.stopPropagation()">
            <div class="info-ach-hero">
                <div class="info-ach-icon ${item.unlocked ? '' : 'locked'}">${item.icon}</div>
                <div class="info-ach-name">${escapeHtml(item.name)}</div>
                ${status}
            </div>
            <div class="info-ach-desc">${escapeHtml(item.desc)}</div>
            ${item.reward && (item.reward.xp || item.reward.soft || item.reward.hard) ? `
                <div class="info-section" style="margin-top:14px">
                    <div class="info-section-title">Награда за достижение</div>
                    ${item.reward.xp ? `<div class="info-row"><span class="info-row-label">⚡ Опыт</span><span class="info-row-value">+${item.reward.xp} XP</span></div>` : ''}
                    ${item.reward.soft ? `<div class="info-row"><span class="info-row-label">💰 Стипухи</span><span class="info-row-value">+${item.reward.soft}</span></div>` : ''}
                    ${item.reward.hard ? `<div class="info-row"><span class="info-row-label">🏅 Автоматы</span><span class="info-row-value gold">+${item.reward.hard}</span></div>` : ''}
                </div>
            ` : ''}
            ${item.unlocked ? '' : `<div class="info-ach-hint">Продолжай пользоваться приложением — достижение откроется автоматически.</div>`}
            <div class="actions-row" style="justify-content:center;margin-top:18px">
                <button class="btn" data-action="modal-close">Закрыть</button>
            </div>
        </div>
    </div>`;
}
function showNewAchievements(newIds) {
    if (!newIds || newIds.length === 0) return;
    const achList = state.achievements || [];
    const items = [];
    for (const id of newIds) {
        const meta = achList.find(a => a.id === id);
        if (!meta) continue;
        const rw = meta.reward || {};
        const parts = [];
        if (rw.xp) parts.push(`+${rw.xp} XP`);
        if (rw.soft) parts.push(`+${rw.soft} 💰`);
        if (rw.hard) parts.push(`+${rw.hard} 🏅`);
        items.push({ name: meta.name, icon: meta.icon, rewardText: parts.length ? `Награда: ${parts.join(' · ')}` : 'Без награды' });
    }
    if (items.length === 0) return;
    state.newAchToast = items;
    haptic('success');
    popEmoji('🏆');
}
function actionNameOpen() {
    haptic('light');
    const cur = state.profile?.display_name || '';
    state.nameEditorValue = cur && cur !== 'PLAYER' ? cur : '';
    state.nameEditor = true; render();
}
async function actionNameSave() {
    const el = document.getElementById('name-editor-input');
    if (!el) return;
    const name = (el.value || '').trim();
    if (!name) { alert('Введи имя'); return; }
    try {
        const r = await apiPost('/api/set-name', { name });
        state.wallet = r.wallet;
        if (state.profile) state.profile.display_name = name;
        haptic('success');
        state.nameEditor = false;
        popEmoji('✏️');
        render();
    } catch (e) { haptic('error'); alert(e.message || 'Ошибка'); }
}
async function actionAvatarToggle() {
    haptic('light');
    const curIdx = state.wallet?.avatar_idx || 0;
    const nextIdx = curIdx === 0 ? 1 : 0;
    try {
        const r = await apiPost('/api/set-avatar', { idx: nextIdx });
        if (r.wallet) state.wallet = r.wallet;
        else if (state.wallet) state.wallet.avatar_idx = nextIdx;
        haptic('success');
        render();
    } catch (e) {
        haptic('error');
        alert(e.message || 'Не удалось сменить аватар');
    }
}
async function actionChestOpen() {
    try {
        const r = await apiPost('/api/chest/open');
        state.wallet = r.wallet;
        state.chestModal = r.reward;
        haptic('success'); popEmoji('🎁');
        await loadChestStatus(); render();
    } catch (e) { haptic('error'); alert(e.message || 'Сундук уже открыт'); }
}
async function actionPremiumOpen() {
    haptic('light');
    try {
        const r = await apiPost('/api/premium-chest/open');
        state.wallet = r.wallet;
        state.premiumModal = r.reward;
        haptic('success'); popEmoji('👑');
        await loadAchievements(); render();
    } catch (e) { haptic('error'); alert(e.message || 'Не хватает автоматов'); }
}
function actionLevelInfoOpen() { haptic('light'); state.levelInfoModal = true; render(); }
function actionCurrencyInfoOpen() { haptic('light'); state.currencyInfoModal = true; render(); }
function actionAchOpen(achId) { haptic('light'); state.achModal = achId; render(); }
function actionModalClose() {
    haptic('light');
    state.nameEditor = false;
    state.chestModal = null;
    state.achModal = null;
    state.levelInfoModal = false;
    state.currencyInfoModal = false;
    state.premiumModal = null;
    state.newAchToast = null;
    state.exchangeOpen = false;
    state.bsJoinModal = false;
    state.bsJoinCode = '';
    render();
}

// ============================================================
//                       ИГРЫ (каталог)
// ============================================================

function renderGames() {
    const catalog = [
        { id: 'flappy', name: 'До пары успеть', asset: 'assets/game-start.webp' },
        { id: 'battleship', name: 'Морской бой', asset: 'assets/game-battleship.webp' },
    ];

    let html = `<div class="games-catalog">`;
    for (const g of catalog) {
        html += `<button class="game-catalog-card" data-action="game-open" data-game="${escapeHtml(g.id)}">
            <div class="game-catalog-cover">
                <img src="${g.asset}" alt="${escapeHtml(g.name)}"
                     onerror="this.style.display='none'">
            </div>
        </button>`;
    }
    html += `</div>`;

    if (state.walletLeaderboard && state.walletLeaderboard.length > 0) {
        html += `<div class="card" style="margin-top:12px"><div class="card-title">Топ по опыту</div>`;
        for (const item of state.walletLeaderboard) {
            const cls = item.is_me ? 'game-top-me' : '';
            html += `<div class="grade-row ${cls}">
                <span>${item.rank}. ${escapeHtml(item.display)} <span style="color:var(--text-2);font-weight:600;font-size:12px">· LVL ${item.level}</span></span>
                <span class="grade-value">${item.xp} XP</span>
            </div>`;
        }
        html += `</div>`;
    }
    return html;
}

// ============================================================
//                       FLAPPY
// ============================================================

function renderGameTutorialOverlay() {
    return `<div class="tutorial-overlay hide" id="game-tutorial-overlay">
        <div class="tutorial-arrow">👆</div>
        <div class="tutorial-title">Как играть</div>
        <div class="tutorial-text">Тапай по экрану — студент <strong>прыгает</strong>. Пролетай между столбцами и набирай очки. Заденешь столбец — конец.</div>
        <div class="tutorial-tap-hint">Тапни, чтобы начать</div>
    </div>`;
}
function renderGameScreen() {
    const gid = state.currentGame;
    const g = state.gamesList.find(x => x.id === gid);
    const best = g?.best || 0;
    const muteIcon = isMusicMuted() ? '🔇' : '🔊';
    return `<div class="game-wrap" id="game-wrap">
        <div class="game-hud">
            <div class="game-hud-score" id="game-score">0</div>
            <div class="game-hud-best">Рекорд: ${best}</div>
        </div>
        <canvas id="game-canvas" class="game-canvas"></canvas>
        ${renderGameTutorialOverlay()}
        <button class="game-exit" data-action="game-exit" title="Выйти">✕</button>
        <button class="game-mute" id="game-mute-btn" data-action="music-toggle" title="Звук">${muteIcon}</button>
    </div>`;
}
function renderGameResult() {
    const r = state.gameResult;
    if (!r) return renderEmpty('Нет данных');
    let html = `<div class="game-result-wrap">
        <div class="game-result-score-block">
            <div class="game-result-label">Результат</div>
            <div class="game-result-score">${r.score}</div>
            ${r.is_record ? '<div class="game-result-record">НОВЫЙ РЕКОРД</div>' : ''}
        </div>
        <div class="game-result-best">Лучший результат: ${r.best}</div>
        <div class="card" style="background:var(--grad-neon-soft);border-color:rgba(0,229,208,0.3)">
            <div class="card-title">Награда</div>
            <div class="card-subtitle">+${r.soft_reward || 0} Стипух · +${r.xp_reward || 0} XP ${r.hard_reward ? '· +' + r.hard_reward + ' Автоматов' : ''}</div>
        </div>`;
    if (r.top && r.top.length > 0) {
        html += `<div class="card"><div class="card-title">Топ игроков</div>`;
        for (const item of r.top) {
            const cls = item.is_me ? 'game-top-me' : '';
            html += `<div class="grade-row ${cls}"><span>${item.rank}. ${escapeHtml(item.display)}</span><span class="grade-value">${item.score}</span></div>`;
        }
        html += `</div>`;
    }
    html += `<div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="game-play-again" style="flex:1">Ещё раз</button>
        <button class="btn btn-secondary" data-action="game-exit" style="flex:1">К играм</button>
    </div></div>`;
    return html;
}
function actionGameOpen(gameId) {
    haptic('light');
    if (gameId === 'battleship') {
        state.gameView = 'battleship';
        state.bsScreen = 'lobby';
        state.bsResult = null;
        state.bsLog = [];
        state.bsCode = null;
        state.bsGameId = null;
        state.bsIsBot = false;
        render();
        return;
    }
    state.currentGame = gameId;
    state.gameView = 'playing';
    state.gamePhase = 'start';
    state.gameResult = null;
    state.gameInstance = null;
    render();
}
function actionGameExit() {
    haptic('light');
    stopGameMusic();
    if (state.bsPollTimer) { clearInterval(state.bsPollTimer); state.bsPollTimer = null; }
    if (state.gameInstance) state.gameInstance.running = false;
    state.gameInstance = null;
    state.gameView = null;
    state.gameResult = null;
    state.currentGame = null;
    state.gamePhase = 'start';
    state.bsScreen = 'lobby';
    state.bsResult = null;
    render();
}
function actionGamePlayAgain() {
    haptic('light');
    state.gameView = 'playing';
    state.gamePhase = 'start';
    state.gameResult = null;
    state.gameInstance = null;
    render();
}
async function submitGameScore(gameId, score) {
    try {
        const r = await apiPost('/api/game/submit', { game_id: gameId, score });
        state.gameResult = {
            score, best: r.best, is_record: r.is_record,
            soft_reward: r.soft_reward, xp_reward: r.xp_reward, hard_reward: r.hard_reward,
            top: r.top || []
        };
        if (state.wallet) state.wallet = r.wallet;
        const g = state.gamesList.find(x => x.id === gameId);
        if (g) { g.best = r.best; g.plays = r.plays; }
    } catch (e) {
        state.gameResult = { score, best: score, is_record: false, soft_reward: 0, xp_reward: 0, hard_reward: 0, top: [] };
    }
    state.gameInstance = null;
    state.gameView = 'result';
    render();
}
function initGame() {
    if (state.currentGame === 'flappy') initFlappy();
}
function showTutorialThenStart(startFn) {
    const tutOv = document.getElementById('game-tutorial-overlay');
    const tutShown = localStorage.getItem('flappy_tutorial_shown') === '1';
    let started = false;
    function doStart() {
        if (started) return;
        started = true;
        if (tutOv) tutOv.classList.add('hide');
        document.removeEventListener('pointerdown', onTap);
        document.removeEventListener('keydown', onKey);
        startFn();
    }
    function onTap(e) {
        if (e.target && e.target.dataset && (e.target.dataset.action === 'game-exit' || e.target.dataset.action === 'music-toggle')) return;
        if (!tutShown) {
            try { localStorage.setItem('flappy_tutorial_shown', '1'); } catch (er) {}
        }
        doStart();
    }
    function onKey(e) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter') {
            onTap({ target: { dataset: {} } });
        }
    }
    if (!tutShown && tutOv) {
        tutOv.classList.remove('hide');
        haptic('light');
    }
    document.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', onKey);
}

function initFlappy() {
    if (state.gameInstance) return;
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(100, Math.floor(rect.width));
    const H = Math.max(100, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const starCanvas = document.createElement('canvas');
    starCanvas.width = Math.floor(W * dpr);
    starCanvas.height = Math.floor(H * dpr);
    const starCtx = starCanvas.getContext('2d');
    starCtx.scale(dpr, dpr);
    {
        const bg = starCtx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#050813');
        bg.addColorStop(0.5, '#08101f');
        bg.addColorStop(1, '#0b1524');
        starCtx.fillStyle = bg;
        starCtx.fillRect(0, 0, W, H);
        const glow = starCtx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
        glow.addColorStop(0, 'rgba(139,92,246,0.10)');
        glow.addColorStop(1, 'rgba(139,92,246,0)');
        starCtx.fillStyle = glow;
        starCtx.fillRect(0, 0, W, H);
        const starCount = Math.floor((W * H) / 3500);
        for (let i = 0; i < starCount; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const r = Math.random();
            let size, alpha;
            if (r < 0.72) { size = 0.8; alpha = 0.25 + Math.random() * 0.30; }
            else if (r < 0.95) { size = 1.3; alpha = 0.55 + Math.random() * 0.35; }
            else { size = 2.0; alpha = 0.85 + Math.random() * 0.15; }
            starCtx.fillStyle = `rgba(220,235,255,${alpha})`;
            starCtx.beginPath();
            starCtx.arc(x, y, size, 0, Math.PI * 2);
            starCtx.fill();
        }
    }

    const PLAYER_R = 15;
    const HERO_SIZE = 88;
    const GAP = 160;
    const MIN_GAP = 132;
    const COL_W = 62;
    const SPAWN_INTERVAL = 120;
    const MIN_SPAWN_INTERVAL = 95;
    const COL_FILL = 'rgba(139, 92, 246, 0.88)';
    const COL_STROKE = '#C084FC';
    const COL_LINE = 'rgba(255,255,255,0.16)';

    const game = {
        W, H,
        running: true, over: false, started: false,
        score: 0, frame: 0,
        player: { x: W * 0.28, y: H * 0.5, r: PLAYER_R, vy: 0 },
        obstacles: [],
        spawnTimer: 0,
        spawnInterval: SPAWN_INTERVAL,
        minSpawnInterval: MIN_SPAWN_INTERVAL,
        gravity: 0.55,
        jumpForce: -8.0,
        maxFallSpeed: 10.5,
        speed: 3.4,
        maxSpeed: 7.0,
        gap: GAP,
        minGap: MIN_GAP,
        lastTime: 0,
    };
    state.gameInstance = game;

    function doJump() {
        if (game.over || !game.running) return;
        game.player.vy = game.jumpForce;
    }
    let startedFromTutorial = false;
    showTutorialThenStart(() => {
        startedFromTutorial = true;
        game.started = true;
        haptic('medium');
        game.player.vy = game.jumpForce;
        startGameMusic();
    });
    function onPointer(e) {
        e.preventDefault();
        if (!startedFromTutorial) return;
        doJump();
    }
    function onKey(e) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
            e.preventDefault();
            if (!startedFromTutorial) return;
            doJump();
        }
    }
    canvas.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    function cleanup() {
        canvas.removeEventListener('pointerdown', onPointer);
        document.removeEventListener('keydown', onKey);
    }
    function endGame() {
        if (game.over) return;
        game.over = true; game.running = false;
        cleanup();
        haptic('error');
        stopGameMusic();
        submitGameScore('flappy', game.score);
    }
    function drawColumn(x, y, w, h) {
        if (h <= 0) return;
        ctx.fillStyle = COL_FILL;
        roundRect(ctx, x, y, w, h, 8);
        ctx.fill();
        ctx.strokeStyle = COL_STROKE;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = COL_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let ly = y + 22; ly < y + h - 6; ly += 28) {
            ctx.moveTo(x + 6, ly);
            ctx.lineTo(x + w - 6, ly);
        }
        ctx.stroke();
    }
    function drawPlayer() {
        const p = game.player;
        if (heroSpriteReady && heroSprite) {
            const img = heroSprite;
            const naturalW = img.naturalWidth || img.width || 1;
            const naturalH = img.naturalHeight || img.height || 1;
            const ratio = naturalW / naturalH;
            let w = HERO_SIZE;
            let h = HERO_SIZE;
            if (ratio > 1) h = HERO_SIZE / ratio;
            else if (ratio < 1) w = HERO_SIZE * ratio;
            ctx.drawImage(img, p.x - w / 2, p.y - h / 2, w, h);
        } else {
            ctx.fillStyle = 'rgba(0,229,208,0.25)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r + 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#00E5D0';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#070B14';
            ctx.beginPath();
            ctx.arc(p.x + 4, p.y - 3, 2.5, 0, Math.PI * 2);
            ctx.arc(p.x + 10, p.y - 3, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    function draw() {
        ctx.drawImage(starCanvas, 0, 0, starCanvas.width, starCanvas.height, 0, 0, W, H);
        for (let i = 0; i < game.obstacles.length; i++) {
            const o = game.obstacles[i];
            drawColumn(o.x, 0, o.w, o.gapY);
            drawColumn(o.x, o.gapY + o.gapH, o.w, H - o.gapY - o.gapH);
        }
        drawPlayer();
    }
    function updateDifficulty() {
        const s = game.score;
        game.speed = Math.min(game.maxSpeed, 3.4 + Math.floor(s / 6) * 0.20);
        game.spawnInterval = Math.max(game.minSpawnInterval, SPAWN_INTERVAL - Math.floor(s / 4) * 2);
        game.gap = Math.max(game.minGap, GAP - Math.floor(s / 8) * 2);
    }
    function loop(timestamp) {
        if (state.gameInstance !== game || !game.running) return;
        requestAnimationFrame(loop);
        if (!game.lastTime) game.lastTime = timestamp;
        let dt = (timestamp - game.lastTime) / 16.6667;
        game.lastTime = timestamp;
        if (dt > 3) dt = 3;
        if (dt <= 0) return;
        if (game.started) {
            game.player.vy += game.gravity * dt;
            if (game.player.vy > game.maxFallSpeed) game.player.vy = game.maxFallSpeed;
            game.player.y += game.player.vy * dt;
        }
        if (game.player.y - game.player.r < 0) {
            game.player.y = game.player.r;
            game.player.vy = 0;
        }
        if (game.player.y + game.player.r > H) {
            game.player.y = H - game.player.r;
            endGame();
            return;
        }
        game.spawnTimer += dt;
        if (game.started && game.spawnTimer >= game.spawnInterval) {
            game.spawnTimer = 0;
            const minGapY = 40;
            const maxGapY = H - game.gap - 40;
            const gapY = Math.random() * Math.max(1, maxGapY - minGapY) + minGapY;
            game.obstacles.push({ x: W + 20, w: COL_W, gapY, gapH: game.gap, passed: false });
        }
        const px = game.player.x, py = game.player.y, pr = game.player.r;
        for (let i = game.obstacles.length - 1; i >= 0; i--) {
            const o = game.obstacles[i];
            if (game.started) o.x -= game.speed * dt;
            if (px + pr > o.x && px - pr < o.x + o.w) {
                if (py - pr < o.gapY || py + pr > o.gapY + o.gapH) {
                    endGame();
                    return;
                }
            }
            if (!o.passed && o.x + o.w < px) {
                o.passed = true;
                game.score++;
                haptic('light');
                updateScore(game.score);
                updateDifficulty();
            }
            if (o.x + o.w < -80) game.obstacles.splice(i, 1);
        }
        draw();
        game.frame++;
    }
    draw();
    requestAnimationFrame(loop);
}

function roundRect(ctx, x, y, w, h, r) {
    if (h < 2 * r) r = h / 2;
    if (w < 2 * r) r = w / 2;
    if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function updateScore(val) {
    const el = document.getElementById('game-score');
    if (el) el.textContent = String(val);
}

// ============================================================
//              МОРСКОЙ БОЙ — МОДЕЛЬ
// ============================================================

function bsEmptyField() {
    return Array.from({ length: 10 }, () => new Array(10).fill(0));
}

function bsShipList() {
    return [
        { size: 4, count: 1 },
        { size: 3, count: 2 },
        { size: 2, count: 3 },
        { size: 1, count: 4 },
    ];
}

function bsFlattenShipsToPlace() {
    const list = [];
    for (const s of bsShipList()) {
        for (let i = 0; i < s.count; i++) list.push(s.size);
    }
    return list;
}

function bsCanPlace(field, x, y, size, rot) {
    const cells = [];
    for (let i = 0; i < size; i++) {
        const cx = rot === 'h' ? x + i : x;
        const cy = rot === 'v' ? y + i : y;
        if (cx < 0 || cx > 9 || cy < 0 || cy > 9) return null;
        if (field[cy][cx] !== 0) return null;
        cells.push([cx, cy]);
    }
    for (const [cx, cy] of cells) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
                if (field[ny][nx] === 1) return null;
            }
        }
    }
    return cells;
}

function bsPlaceShip(field, x, y, size, rot) {
    const cells = bsCanPlace(field, x, y, size, rot);
    if (!cells) return null;
    for (const [cx, cy] of cells) field[cy][cx] = 1;
    return cells;
}

function bsAutoPlace(field, ships = null) {
    const list = ships || bsFlattenShipsToPlace();
    const placed = [];
    for (const size of list) {
        let tries = 0;
        while (tries < 200) {
            tries++;
            const rot = Math.random() < 0.5 ? 'h' : 'v';
            const x = Math.floor(Math.random() * 10);
            const y = Math.floor(Math.random() * 10);
            const cells = bsCanPlace(field, x, y, size, rot);
            if (cells) {
                for (const [cx, cy] of cells) field[cy][cx] = 1;
                placed.push({ size, cells, hits: 0, sunk: false });
                break;
            }
        }
    }
    return placed;
}

// ============================================================
//              МОРСКОЙ БОЙ — РЕНДЕР
// ============================================================

function renderBattleship() {
    const s = state.bsScreen;
    if (s === 'lobby') return renderBSLobby();
    if (s === 'placing') return renderBSPlacing();
    if (s === 'waiting') return renderBSWaiting();
    if (s === 'battle') return renderBSBattle();
    if (s === 'result') return renderBSResult();
    return renderBSLobby();
}

function renderBSLobby() {
    const w = state.wallet || {};
    const bet = state.bsBet;
    const canPlay = (w.soft || 0) >= bet;
    return `<div class="bs-wrap">
        <div class="bs-hero">
            <div class="bs-hero-title">Морской бой</div>
            <div class="bs-hero-sub">Сразись за Стипухи</div>
        </div>

        <div class="card">
            <div class="card-title">Ставка</div>
            <div class="card-subtitle">Победитель забирает весь банк (×2 от ставки)</div>
            <div class="bs-bet-row">
                ${[10, 50, 100, 500].map(v => `
                    <button class="bs-bet-btn ${bet === v ? 'active' : ''}" data-action="bs-bet" data-value="${v}">${v}</button>
                `).join('')}
            </div>
            <div class="card-subtitle" style="margin-top:10px">У тебя: <strong style="color:var(--neon)">${formatNumber(w.soft || 0)}</strong> Стипух</div>
        </div>

        <div class="bs-menu-grid">
            <button class="bs-menu-btn primary" data-action="bs-play-bot" ${canPlay ? '' : 'disabled'}>
                <div class="bs-menu-icon">${robotIconSvg()}</div>
                <div class="bs-menu-label">Играть с ботом</div>
                <div class="bs-menu-sub">Умный ИИ · ставка работает</div>
            </button>
            <button class="bs-menu-btn primary" data-action="bs-create-room" ${canPlay ? '' : 'disabled'}>
                <div class="bs-menu-icon">${keyIconSvg()}</div>
                <div class="bs-menu-label">Создать игру</div>
                <div class="bs-menu-sub">Получить код для друга</div>
            </button>
            <button class="bs-menu-btn" data-action="bs-join-room" ${canPlay ? '' : 'disabled'}>
                <div class="bs-menu-icon">${targetIconSvg()}</div>
                <div class="bs-menu-label">Ввести код</div>
                <div class="bs-menu-sub">Присоединиться к другу</div>
            </button>
            <button class="bs-menu-btn" data-action="bs-find-match" ${canPlay ? '' : 'disabled'}>
                <div class="bs-menu-icon">${usersIconSvg()}</div>
                <div class="bs-menu-label">Найти соперника</div>
                <div class="bs-menu-sub">Случайный игрок</div>
            </button>
        </div>

        <div class="actions-row" style="margin-top:12px">
            <button class="btn btn-secondary" data-action="game-exit" style="width:100%">← К играм</button>
        </div>
    </div>`;
}

function renderBSPlacing() {
    const field = state.bsMyField || bsEmptyField();
    const list = state.bsShipsToPlace;
    const idx = state.bsPlacingIdx;
    const nextSize = idx < list.length ? list[idx] : null;
    const rot = state.bsPlacingRot;

    let previewHtml = '';
    if (nextSize) {
        previewHtml = `<div class="bs-placing-preview">
            <div class="bs-placing-preview-label">Ставим <strong>${nextSize}-палубный</strong></div>
            <div class="bs-placing-ship ${rot === 'v' ? 'vertical' : ''}">
                ${Array.from({ length: nextSize }).map(() => '<div class="bs-placing-ship-cell"></div>').join('')}
            </div>
        </div>`;
    } else {
        previewHtml = `<div class="bs-placing-preview">
            <div class="bs-placing-preview-label">Все корабли расставлены — жми «Готов»</div>
        </div>`;
    }

    return `<div class="bs-wrap">
        <div class="bs-hero">
            <div class="bs-hero-title">Расстановка</div>
            <div class="bs-hero-sub">Ставка: ${state.bsBet} Стипух · ${nextSize ? `осталось ${list.length - idx}` : 'всё готово'}</div>
        </div>

        ${previewHtml}

        <div class="bs-board-section">
            <div class="bs-board-header">
                <div class="bs-board-label active">Твой флот</div>
                <div class="bs-board-counters">
                    <span class="alive">Поставлено: ${idx}/${list.length}</span>
                </div>
            </div>
            ${renderBSBoard(field, 'my', false, true)}
        </div>

        <div class="actions-row" style="margin-top:14px">
            <button class="btn btn-secondary" data-action="bs-rotate" style="flex:1">${rot === 'h' ? 'Горизонт. →' : 'Вертик. ↓'}</button>
            <button class="btn btn-secondary" data-action="bs-auto-place" style="flex:1">Авто</button>
            <button class="btn btn-secondary" data-action="bs-clear-place" style="flex:1">Сброс</button>
        </div>
        <div class="actions-row">
            <button class="btn" data-action="bs-confirm-place" style="width:100%" ${nextSize ? 'disabled' : ''}>Готов к бою</button>
        </div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="bs-back-lobby" style="width:100%">Отмена</button>
        </div>
    </div>`;
}

function renderBSWaiting() {
    return `<div class="bs-wrap">
        <div class="bs-queue-card">
            <div class="bs-queue-spinner"></div>
            <div class="bs-queue-title">Ожидание соперника</div>
            <div class="bs-queue-sub">Отправь код другу, чтобы он присоединился</div>
            <div class="bs-code-display">
                <div class="bs-code-value">${escapeHtml(state.bsCode || '------')}</div>
                <button class="bs-code-copy" data-action="bs-copy-code">Копировать</button>
            </div>
            <div class="card-subtitle" style="margin-top:14px">
                Ставка: <strong style="color:var(--neon)">${state.bsBet}</strong> Стипух
            </div>
            <div class="card-subtitle" style="margin-top:6px">Как только друг введёт код — игра начнётся автоматически.</div>
        </div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="bs-cancel-room" style="width:100%">Отменить</button>
        </div>
    </div>`;
}

function renderBSBattle() {
    const my = state.bsMyField;
    const enemy = state.bsEnemyField;
    const myTurn = state.bsTurn === 'me';
    const log = state.bsLog || [];
    const myShipsAlive = countAliveShips(my, state.bsMyShips);
    const enemyShipsAlive = state.bsIsBot ? countAliveShips(enemy, state.bsEnemyShips) : null;

    return `<div class="bs-wrap">
        <div class="bs-turn-banner ${myTurn ? 'my-turn' : 'enemy-turn'}">
            <span class="bs-turn-dot"></span>
            ${myTurn ? 'Твой ход' : 'Ход соперника'}
        </div>

        <div class="bs-board-section">
            <div class="bs-board-header">
                <div class="bs-board-label">Флот врага · ${escapeHtml(state.bsEnemyName || 'Соперник')}</div>
                <div class="bs-board-counters">
                    ${enemyShipsAlive !== null ? `<span class="alive">Живых: ${enemyShipsAlive}</span>` : `<span>Стреляй по клеткам</span>`}
                </div>
            </div>
            ${renderBSBoard(enemy, 'enemy', myTurn, false)}
        </div>

        <div class="bs-board-section">
            <div class="bs-board-header">
                <div class="bs-board-label">Твой флот</div>
                <div class="bs-board-counters">
                    <span class="alive">Живых: ${myShipsAlive}</span>
                </div>
            </div>
            ${renderBSBoard(my, 'my', false, false)}
        </div>

        ${log.length > 0 ? `<div class="bs-log">${log.slice(-6).map(l => `<div class="bs-log-entry ${l.type}">${escapeHtml(l.text)}</div>`).join('')}</div>` : ''}

        <div class="actions-row" style="margin-top:14px">
            <button class="btn btn-secondary" data-action="bs-surrender" style="width:100%">Сдаться</button>
        </div>
    </div>`;
}

function renderBSResult() {
    const r = state.bsResult;
    if (!r) return renderEmpty('Нет данных');
    const emoji = r.outcome === 'win' ? '🏆' : r.outcome === 'lose' ? '💀' : '🤝';
    const title = r.outcome === 'win' ? 'Победа!' : r.outcome === 'lose' ? 'Поражение' : 'Ничья';
    const titleCls = r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : 'draw';
    let sub = '';
    if (r.outcome === 'win') sub = r.reward ? `Чистая прибыль: ${formatNumber(r.reward)} Стипух` : 'Победа!';
    else if (r.outcome === 'lose') sub = r.loss ? `Потеряно: ${formatNumber(r.loss)} Стипух` : 'Поражение';
    else sub = 'Ставки возвращены';
    return `<div class="bs-wrap">
        <div class="bs-result">
            <div class="bs-result-emoji">${emoji}</div>
            <div class="bs-result-title ${titleCls}">${title}</div>
            <div class="bs-result-sub">${escapeHtml(sub)}</div>
        </div>
        <div class="actions-row">
            <button class="btn" data-action="bs-play-again" style="flex:1">Ещё раз</button>
            <button class="btn btn-secondary" data-action="bs-back-lobby" style="flex:1">В лобби</button>
        </div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="game-exit" style="width:100%">← К играм</button>
        </div>
    </div>`;
}

function renderBSBoard(field, mode, isMyTurn, isPlacing) {
    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];

    let html = `<div class="bs-board">`;
    html += `<div class="bs-coord"></div>`;
    for (let x = 1; x <= 10; x++) html += `<div class="bs-coord">${x}</div>`;

    for (let y = 0; y < 10; y++) {
        html += `<div class="bs-coord">${letters[y]}</div>`;
        for (let x = 0; x < 10; x++) {
            const v = field[y][x];
            let cls = 'bs-cell';
            let data = `data-bs-x="${x}" data-bs-y="${y}"`;

            if (mode === 'my') {
                if (v === 0) cls += '';
                else if (v === 1) cls += ' ship';
                else if (v === 2) cls += ' ship hit';
                else if (v === 3) cls += ' miss';
                else if (v === 4) cls += ' ship sunk';
                if (isPlacing) {
                    data += ` data-action="bs-place-cell"`;
                } else {
                    cls += ' locked';
                }
            } else {
                if (v === 0) cls += ' enemy-empty';
                else if (v === 2) cls += ' enemy-hit';
                else if (v === 3) cls += ' enemy-miss';
                else if (v === 4) cls += ' enemy-sunk';
                if (isMyTurn && v === 0) {
                    cls += ' turn-active';
                    data += ` data-action="bs-fire-cell"`;
                } else {
                    cls += ' locked';
                }
            }

            let inner = '';
            if (mode === 'my' && (v === 2 || v === 4)) {
                inner = '<span class="bs-x">✕</span>';
            }

            html += `<div class="${cls}" ${data}>${inner}</div>`;
        }
    }
    html += `</div>`;
    return html;
}

function countAliveShips(field, ships) {
    if (!ships || ships.length === 0) return 0;
    let alive = 0;
    for (const s of ships) {
        let sunk = true;
        for (const [x, y] of s.cells) {
            if (field[y][x] !== 4) { sunk = false; break; }
        }
        if (!sunk) alive++;
    }
    return alive;
}

// ============================================================
//              МОРСКОЙ БОЙ — ДЕЙСТВИЯ
// ============================================================

function actionBSBet(value) {
    haptic('light');
    state.bsBet = value;
    render();
}

function bsClearPoll() {
    if (state.bsPollTimer) { clearInterval(state.bsPollTimer); state.bsPollTimer = null; }
}

async function actionBSPlayBot() {
    if (state._bsBotStarting) return;
    haptic('light');
    if ((state.wallet?.soft || 0) < state.bsBet) {
        alert('Недостаточно Стипух для ставки');
        return;
    }
    state._bsBotStarting = true;
    try {
        const r = await apiPost('/api/bs/bot-start', { bet: state.bsBet });
        if (r.wallet) state.wallet = r.wallet;
    } catch (e) {
        state._bsBotStarting = false;
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось начать игру'));
        return;
    }
    state._bsBotStarting = false;
    state.bsIsBot = true;
    state.bsEnemyName = 'Бот';
    state.bsGameId = null;
    state.bsCode = null;
    state.bsMyField = bsEmptyField();
    state.bsEnemyField = bsEmptyField();
    state.bsMyShips = [];
    state.bsEnemyShips = [];
    state.bsShipsToPlace = bsFlattenShipsToPlace();
    state.bsPlacingIdx = 0;
    state.bsPlacingRot = 'h';
    state.bsLog = [];
    state.bsTurn = 'me';
    state.bsResult = null;
    state.bsBotBusy = false;
    state._bsConfirmLock = false;
    state.bsScreen = 'placing';
    bsSaveSession();
    render();
}

async function actionBSCreateRoom() {
    haptic('light');
    if ((state.wallet?.soft || 0) < state.bsBet) {
        alert('Недостаточно Стипух для ставки');
        return;
    }
    try {
        const r = await apiPost('/api/bs/create', { bet: state.bsBet });
        state.bsIsBot = false;
        state.bsGameId = r.game_id;
        state.bsCode = r.code;
        state.bsEnemyName = 'Ожидание...';
        state.bsMyField = bsEmptyField();
        state.bsEnemyField = bsEmptyField();
        state.bsMyShips = [];
        state.bsEnemyShips = [];
        state.bsShipsToPlace = bsFlattenShipsToPlace();
        state.bsPlacingIdx = 0;
        state.bsPlacingRot = 'h';
        state.bsLog = [];
        state.bsTurn = 'me';
        state.bsResult = null;
        state.bsBotBusy = false;
        state._bsConfirmLock = false;
        state.bsScreen = 'placing';
        if (r.wallet) state.wallet = r.wallet;
        bsSaveSession();
        render();
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось создать игру'));
    }
}

function actionBSJoinRoom() {
    haptic('light');
    if ((state.wallet?.soft || 0) < state.bsBet) {
        alert('Недостаточно Стипух для ставки');
        return;
    }
    state.bsJoinCode = '';
    state.bsJoinModal = true;
    render();
}

async function actionBSJoinSubmit() {
    const el = document.getElementById('bs-join-code-input');
    const code = ((el?.value || state.bsJoinCode) || '').trim();
    if (!/^\d{6}$/.test(code)) {
        alert('Код должен содержать 6 цифр');
        return;
    }
    haptic('light');
    try {
        const r = await apiPost('/api/bs/join', { code, bet: state.bsBet });
        state.bsJoinModal = false;
        state.bsIsBot = false;
        state.bsGameId = r.game_id;
        state.bsCode = code;
        state.bsEnemyName = r.opponent_name || 'Соперник';
        state.bsMyField = bsEmptyField();
        state.bsEnemyField = bsEmptyField();
        state.bsMyShips = [];
        state.bsEnemyShips = [];
        state.bsShipsToPlace = bsFlattenShipsToPlace();
        state.bsPlacingIdx = 0;
        state.bsPlacingRot = 'h';
        state.bsLog = [];
        state.bsTurn = 'me';
        state.bsResult = null;
        state.bsBotBusy = false;
        state._bsConfirmLock = false;
        state.bsScreen = 'placing';
        if (r.wallet) state.wallet = r.wallet;
        bsSaveSession();
        render();
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось присоединиться'));
    }
}

async function actionBSFindMatch() {
    haptic('light');
    if ((state.wallet?.soft || 0) < state.bsBet) {
        alert('Недостаточно Стипух для ставки');
        return;
    }
    try {
        const r = await apiPost('/api/bs/find', { bet: state.bsBet });
        state.bsIsBot = false;
        state.bsGameId = r.game_id;
        state.bsCode = r.code || null;
        state.bsEnemyName = r.status === 'matched' ? (r.opponent_name || 'Соперник') : 'Поиск...';
        state.bsMyField = bsEmptyField();
        state.bsEnemyField = bsEmptyField();
        state.bsMyShips = [];
        state.bsEnemyShips = [];
        state.bsShipsToPlace = bsFlattenShipsToPlace();
        state.bsPlacingIdx = 0;
        state.bsPlacingRot = 'h';
        state.bsLog = [];
        state.bsTurn = 'me';
        state.bsResult = null;
        state.bsBotBusy = false;
        state._bsConfirmLock = false;
        state.bsScreen = 'placing';
        if (r.wallet) state.wallet = r.wallet;
        bsSaveSession();
        render();
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось найти соперника'));
    }
}

function actionBSPlaceCell(el) {
    if (!state.bsMyField) return;
    const x = parseInt(el.dataset.bsX);
    const y = parseInt(el.dataset.bsY);
    const idx = state.bsPlacingIdx;
    const list = state.bsShipsToPlace;
    if (idx >= list.length) return;
    const size = list[idx];
    const field = state.bsMyField;
    const cells = bsPlaceShip(field, x, y, size, state.bsPlacingRot);
    if (!cells) {
        haptic('error');
        return;
    }
    haptic('light');
    state.bsMyShips.push({ size, cells, hits: 0, sunk: false });
    state.bsPlacingIdx++;
    render();
}

function actionBSRotate() {
    haptic('light');
    state.bsPlacingRot = state.bsPlacingRot === 'h' ? 'v' : 'h';
    render();
}

function actionBSAutoPlace() {
    haptic('light');
    const field = bsEmptyField();
    const ships = bsAutoPlace(field);
    state.bsMyField = field;
    state.bsMyShips = ships;
    state.bsPlacingIdx = state.bsShipsToPlace.length;
    render();
}

function actionBSClearPlace() {
    haptic('light');
    state.bsMyField = bsEmptyField();
    state.bsMyShips = [];
    state.bsPlacingIdx = 0;
    render();
}

async function actionBSConfirmPlace() {
    if (state._bsConfirmLock) return;
    if (state.bsPlacingIdx < state.bsShipsToPlace.length) {
        alert('Расставь все корабли');
        return;
    }
    state._bsConfirmLock = true;
    haptic('success');

    if (state.bsIsBot) {
        const enemyDisplayField = bsEmptyField();
        const enemyLogicShips = bsAutoPlace(bsEmptyField());
        state.bsEnemyField = enemyDisplayField;
        state.bsEnemyShips = enemyLogicShips;
        state.bsEnemyName = 'Бот';
        state.bsTurn = 'me';
        state.bsLog = [{ type: '', text: 'Бой начался. Твой ход.' }];
        state.bsBotBusy = false;
        state.bsScreen = 'battle';
        state._bsConfirmLock = false;
        render();
        return;
    }

    try {
        const shipsData = state.bsMyShips.map(s => ({ size: s.size, cells: s.cells }));
        const r = await apiPost('/api/bs/ready', { game_id: state.bsGameId, ships: shipsData });
        if (r.status === 'waiting') {
            state.bsScreen = 'waiting';
            state._bsConfirmLock = false;
            render();
            startBSPolling();
        } else if (r.status === 'playing') {
            state.bsEnemyField = bsEmptyField();
            state.bsEnemyShips = [];
            state.bsTurn = r.your_turn ? 'me' : 'enemy';
            state.bsLog = [{ type: '', text: 'Бой начался.' }];
            state.bsScreen = 'battle';
            state._bsConfirmLock = false;
            render();
            startBSPolling();
            if (state.bsTurn === 'enemy') pollBSGame();
        }
    } catch (e) {
        state._bsConfirmLock = false;
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось отправить расстановку'));
    }
}

function startBSPolling() {
    bsClearPoll();
    state.bsPollTimer = setInterval(pollBSGame, 2500);
}

async function pollBSGame() {
    if (!state.bsGameId || state.bsIsBot) return;
    if (state.bsScreen !== 'battle' && state.bsScreen !== 'waiting') return;
    try {
        const r = await apiGet('/api/bs/state', { game_id: state.bsGameId });
        if (r.status === 'finished') {
            if (!state.bsResult) handleBSFinish(r.result);
            return;
        }
        if (r.status === 'playing') {
            if (state.bsScreen === 'waiting' && r.my_ships && r.my_ships.length) {
                state.bsMyShips = r.my_ships.map(s => ({...s, hits: 0, sunk: false}));
                for (const s of state.bsMyShips) {
                    for (const [x, y] of s.cells) state.bsMyField[y][x] = 1;
                }
            }
            applyEnemyShots(r.enemy_shots || []);
            if (r.my_shots && r.my_shots.length) {
                for (const sh of r.my_shots) {
                    if (sh.x == null) continue;
                    if (sh.result === 'miss') state.bsEnemyField[sh.y][sh.x] = 3;
                    else if (sh.result === 'hit') state.bsEnemyField[sh.y][sh.x] = 2;
                    else if (sh.result === 'sunk') state.bsEnemyField[sh.y][sh.x] = 4;
                }
            }
            state.bsTurn = r.your_turn ? 'me' : 'enemy';
            if (state.bsScreen === 'waiting') {
                state.bsScreen = 'battle';
            }
            if (r.log && r.log.length) state.bsLog = r.log;
            render();
        }
    } catch (e) {}
}

function applyEnemyShots(shots) {
    if (!shots || shots.length === 0) return;
    const field = state.bsMyField;
    if (!field) return;
    for (const sh of shots) {
        const { x, y, result } = sh;
        if (x == null || y == null) continue;
        const v = field[y][x];
        if (v === 0) {
            field[y][x] = 3;
        } else if (v === 1) {
            field[y][x] = result === 'sunk' ? 4 : 2;
        } else if (v === 2) {
            if (result === 'sunk') field[y][x] = 4;
        }
    }
    recomputeShipsFromField();
}

function recomputeShipsFromField() {
    const field = state.bsMyField;
    if (!state.bsMyShips || !field) return;
    for (const s of state.bsMyShips) {
        let hits = 0;
        let sunk = true;
        for (const [x, y] of s.cells) {
            const v = field[y][x];
            if (v === 2 || v === 4) hits++;
            if (v !== 4) sunk = false;
        }
        s.hits = hits;
        s.sunk = sunk;
    }
}

function actionBSFireCell(el) {
    if (state.bsTurn !== 'me') return;
    if (state.bsBotBusy) return;
    if (state.bsScreen !== 'battle') return;
    const x = parseInt(el.dataset.bsX);
    const y = parseInt(el.dataset.bsY);
    const field = state.bsEnemyField;
    if (!field) return;
    if (field[y][x] !== 0) return;

    if (state.bsIsBot) {
        playerFireBot(x, y);
        return;
    }
    pvpFire(x, y);
}

async function pvpFire(x, y) {
    haptic('light');
    try {
        const r = await apiPost('/api/bs/fire', { game_id: state.bsGameId, x, y });
        applyFireResult(r, x, y);
        if (r.status === 'finished') {
            handleBSFinish(r.result_data);
            return;
        }
        state.bsTurn = r.your_turn ? 'me' : 'enemy';
        if (r.log) state.bsLog = r.log;
        render();
        if (state.bsTurn === 'enemy') startBSPolling();
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + (e.message || 'не удалось сделать выстрел'));
    }
}

function applyFireResult(r, x, y) {
    const field = state.bsEnemyField;
    if (!field) return;
    if (r.result === 'miss') field[y][x] = 3;
    else if (r.result === 'hit') field[y][x] = 2;
    else if (r.result === 'sunk') {
        field[y][x] = 4;
        if (r.sunk_ship) {
            for (const [sx, sy] of r.sunk_ship) field[sy][sx] = 4;
        }
    }
}

function handleBSFinish(result) {
    bsClearPoll();
    bsClearSession();
    state.bsResult = result;
    state.bsScreen = 'result';
    if (result && result.wallet) state.wallet = result.wallet;
    else loadWallet();
    loadProfile();
    render();
}

// ============================================================
//              МОРСКОЙ БОЙ — УМНЫЙ БОТ
// ============================================================

function findBotTargetSmart(field) {
    const hits = [];
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            if (field[y][x] === 2) hits.push([x, y]);
        }
    }
    if (hits.length === 0) return null;

    for (const [x, y] of hits) {
        const hasLeft = x > 0 && field[y][x-1] === 2;
        const hasRight = x < 9 && field[y][x+1] === 2;
        const hasUp = y > 0 && field[y-1][x] === 2;
        const hasDown = y < 9 && field[y+1][x] === 2;

        if (hasLeft || hasRight) {
            let minX = x, maxX = x;
            while (minX > 0 && field[y][minX-1] === 2) minX--;
            while (maxX < 9 && field[y][maxX+1] === 2) maxX++;
            if (maxX < 9 && field[y][maxX+1] === 0) return [maxX+1, y];
            if (minX > 0 && field[y][minX-1] === 0) return [minX-1, y];
        }

        if (hasUp || hasDown) {
            let minY = y, maxY = y;
            while (minY > 0 && field[minY-1][x] === 2) minY--;
            while (maxY < 9 && field[maxY+1][x] === 2) maxY++;
            if (maxY < 9 && field[maxY+1][x] === 0) return [x, maxY+1];
            if (minY > 0 && field[minY-1][x] === 0) return [x, minY-1];
        }
    }

    const dirOrder = [[1,0],[0,1],[-1,0],[0,-1]];
    for (const [x, y] of hits) {
        for (const [dx, dy] of dirOrder) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
            if (field[ny][nx] === 0) return [nx, ny];
        }
    }
    return null;
}

function findBotRandomTarget(field) {
    const chess = [];
    const any = [];
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            if (field[y][x] === 0) {
                any.push([x, y]);
                if ((x + y) % 2 === 0) chess.push([x, y]);
            }
        }
    }
    const pool = chess.length > 0 ? chess : any;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

function playerFireBot(x, y) {
    if (state.bsBotBusy) return;
    if (state.bsTurn !== 'me') return;
    const field = state.bsEnemyField;
    if (!field) return;
    if (field[y][x] !== 0) return;

    let ship = null;
    for (const s of state.bsEnemyShips) {
        for (const [sx, sy] of s.cells) {
            if (sx === x && sy === y) { ship = s; break; }
        }
        if (ship) break;
    }

    let logText = '';
    let logType = '';
    let againTurn = false;

    if (ship) {
        field[y][x] = 2;
        ship.hits++;
        if (ship.hits >= ship.size) {
            for (const [sx, sy] of ship.cells) field[sy][sx] = 4;
            markAroundSunk(field, ship);
            ship.sunk = true;
            logText = `Попадание! Корабль потоплен (${x+1},${y+1})`;
            logType = 'sunk';
            haptic('success');
        } else {
            logText = `Попадание! (${x+1},${y+1})`;
            logType = 'hit';
            haptic('medium');
        }
        againTurn = true;
    } else {
        field[y][x] = 3;
        logText = `Промах (${x+1},${y+1})`;
        logType = 'miss';
        haptic('light');
    }

    state.bsLog.push({ type: logType, text: logText });
    if (state.bsLog.length > 20) state.bsLog = state.bsLog.slice(-20);

    if (checkBSWin(field, state.bsEnemyShips)) {
        finishBotGame('win');
        return;
    }

    if (againTurn) {
        render();
    } else {
        state.bsTurn = 'enemy';
        state.bsBotBusy = true;
        render();
        setTimeout(botFire, 900);
    }
}

function botFire() {
    if (state.bsScreen !== 'battle' || state.bsTurn !== 'enemy') {
        state.bsBotBusy = false;
        return;
    }

    const myField = state.bsMyField;
    const myShips = state.bsMyShips;

    let target = findBotTargetSmart(myField);
    if (!target) target = findBotRandomTarget(myField);
    if (!target) {
        state.bsBotBusy = false;
        return;
    }

    const [x, y] = target;

    let ship = null;
    for (const s of myShips) {
        for (const [sx, sy] of s.cells) {
            if (sx === x && sy === y) { ship = s; break; }
        }
        if (ship) break;
    }

    let logText = '';
    let logType = '';
    let againTurn = false;

    if (ship) {
        myField[y][x] = 2;
        ship.hits++;
        if (ship.hits >= ship.size) {
            for (const [sx, sy] of ship.cells) myField[sy][sx] = 4;
            markAroundSunk(myField, ship);
            ship.sunk = true;
            logText = `Враг попал! Твой корабль потоплен (${x+1},${y+1})`;
            logType = 'sunk';
        } else {
            logText = `Враг попал! (${x+1},${y+1})`;
            logType = 'hit';
        }
        againTurn = true;
    } else {
        myField[y][x] = 3;
        logText = `Враг промахнулся (${x+1},${y+1})`;
        logType = 'miss';
    }

    state.bsLog.push({ type: logType, text: logText });
    if (state.bsLog.length > 20) state.bsLog = state.bsLog.slice(-20);

    if (checkBSWin(myField, myShips)) {
        finishBotGame('lose');
        return;
    }

    if (againTurn) {
        render();
        setTimeout(botFire, 900);
    } else {
        state.bsTurn = 'me';
        state.bsBotBusy = false;
        haptic('light');
        render();
    }
}

function markAroundSunk(field, ship) {
    for (const [x, y] of ship.cells) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
                if (field[ny][nx] === 0) field[ny][nx] = 3;
            }
        }
    }
}

function checkBSWin(field, ships) {
    if (!ships || ships.length === 0) return false;
    for (const s of ships) {
        let sunk = true;
        for (const [x, y] of s.cells) {
            if (field[y][x] !== 4) { sunk = false; break; }
        }
        if (!sunk) return false;
    }
    return true;
}

async function finishBotGame(outcome) {
    bsClearPoll();
    bsClearSession();
    const bet = state.bsBet;
    let reward = 0, loss = 0;
    try {
        const r = await apiPost('/api/bs/finish-bot', { outcome, bet });
        if (r.wallet) state.wallet = r.wallet;
        if (outcome === 'win') reward = r.reward || bet;
        if (outcome === 'lose') loss = r.loss || bet;
    } catch (e) {
        if (outcome === 'win') reward = bet;
        if (outcome === 'lose') loss = bet;
    }
    state.bsResult = { outcome, reward, loss };
    state.bsScreen = 'result';
    state.bsBotBusy = false;
    haptic(outcome === 'win' ? 'success' : 'error');
    await loadProfile();
    render();
}

// ============================================================
//              МОРСКОЙ БОЙ — ПРОЧИЕ
// ============================================================

function actionBSCopyCode() {
    haptic('light');
    const code = state.bsCode;
    if (!code) return;
    try {
        navigator.clipboard.writeText(code);
        tg.showAlert(`Код скопирован: ${code}`);
    } catch (e) {
        tg.showAlert(`Код: ${code}`);
    }
}

async function actionBSCancelRoom() {
    haptic('light');
    bsClearPoll();
    bsClearSession();
    if (state.bsGameId && !state.bsIsBot) {
        try { await apiPost('/api/bs/cancel', { game_id: state.bsGameId }); } catch (e) {}
        await loadWallet();
    }
    state.bsScreen = 'lobby';
    state.bsGameId = null;
    state.bsCode = null;
    render();
}

function actionBSBackLobby() {
    haptic('light');
    bsClearPoll();
    bsClearSession();
    state.bsScreen = 'lobby';
    state.bsResult = null;
    state.bsGameId = null;
    state.bsCode = null;
    state.bsLog = [];
    state.bsMyField = null;
    state.bsEnemyField = null;
    state.bsMyShips = [];
    state.bsEnemyShips = [];
    state.bsShipsToPlace = [];
    state.bsPlacingIdx = 0;
    state.bsIsBot = false;
    state.bsBotBusy = false;
    state._bsConfirmLock = false;
    render();
}

function actionBSPlayAgain() {
    haptic('light');
    if (state.bsIsBot) {
        actionBSPlayBot();
    } else {
        actionBSBackLobby();
    }
}

async function actionBSSurrender() {
    haptic('light');
    const ok = await tgConfirm('Сдаться? Ты потеряешь ставку.');
    if (!ok) return;
    bsClearPoll();
    bsClearSession();
    if (state.bsIsBot) {
        await finishBotGame('lose');
    } else {
        try {
            const r = await apiPost('/api/bs/surrender', { game_id: state.bsGameId });
            handleBSFinish(r.result || { outcome: 'lose', loss: state.bsBet });
        } catch (e) {
            handleBSFinish({ outcome: 'lose', loss: state.bsBet });
        }
    }
}

// ============================================================
//                       РАСПИСАНИЕ
// ============================================================

function attachScheduleSwipe() {
    const content = document.getElementById('content');
    if (!content || content.dataset.swipeBound === '1') return;
    content.dataset.swipeBound = '1';
    let startX = 0, startY = 0, tracking = false;
    content.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
    }, { passive: true });
    content.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
        if (state.tab !== 'schedule' || state.scheduleViewMode !== 'today') return;
        if (dx > 0) { if (state.scheduleDay === 'tomorrow') actionDayToday(); }
        else { if (state.scheduleDay === 'today') actionDayTomorrow(); }
    }, { passive: true });
}

function renderUserBar() {
    const u = state.user;
    const p = state.profile;
    const name = (p?.display_name && p.display_name !== 'PLAYER') ? p.display_name : (u.first_name || 'Гость');
    const metaParts = [];
    if (p?.group) metaParts.push(p.group + (p.subgroup ? ` · ${p.subgroup}` : ''));
    if (u.username) metaParts.push('@' + u.username);
    const meta = metaParts.join(' · ') || 'профиль не заполнен';
    const tasks = p?.tasks_active ?? 0;
    const firstLetter = (u.first_name?.[0] || '?').toUpperCase();
    const avIdx = state.wallet?.avatar_idx || 0;
    const avPath = avatarPathByIdx(avIdx);
    return `
        <div class="user-bar" data-action="go-profile">
            <div class="user-bar-avatar">
                <img src="${avPath}" alt="" onerror="this.outerHTML='${escapeHtml(firstLetter)}'">
            </div>
            <div class="user-bar-info">
                <div class="user-bar-name">${escapeHtml(name)}</div>
                <div class="user-bar-meta">${escapeHtml(meta)}</div>
            </div>
            <div class="user-bar-badges">
                <div class="user-badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 11 12 14 22 4"></polyline>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                    </svg>
                    <span>${tasks}</span>
                </div>
            </div>
        </div>
    `;
}

function renderLesson(les) {
    const timeRange = les.timeEnd ? `${les.time} – ${les.timeEnd}` : les.time;
    const details = [];
    if (les.teacher) details.push(escapeHtml(les.teacher));
    if (les.auditorium) details.push(`ауд. ${escapeHtml(les.auditorium)}`);
    const att = les.attendance || '';
    const attLabel = att === 'was' ? '✓' : att === 'missed' ? '✗' : att === 'sick' ? 'Б' : '';
    return `
        <div class="lesson">
            <div class="lesson-time">${escapeHtml(timeRange)}</div>
            <div class="lesson-body">
                <div class="lesson-subject">${escapeHtml(les.subject)}${les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''}</div>
                ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
            </div>
            <button class="lesson-status ${att}"
                    data-action="lesson-status"
                    data-date="${escapeHtml(les.date || '')}"
                    data-time="${escapeHtml(les.time || '')}"
                    data-subject="${escapeHtml(les.subject || '')}"
                    data-status="${att}">${attLabel}</button>
        </div>
    `;
}
function renderDaySwitch() {
    return `<div class="day-switch">
        <button data-action="day-today" class="${state.scheduleDay === 'today' ? 'active' : ''}">Сегодня</button>
        <button data-action="day-tomorrow" class="${state.scheduleDay === 'tomorrow' ? 'active' : ''}">Завтра</button>
    </div>`;
}
function _tomorrowStrIrkutsk() {
    const nowMs = Date.now();
    const irkMs = nowMs + (8 * 3600 * 1000) + (new Date().getTimezoneOffset() * 60 * 1000);
    const tomorrowIrk = new Date(irkMs + 24 * 3600 * 1000);
    const dd = String(tomorrowIrk.getUTCDate()).padStart(2, '0');
    const mm = String(tomorrowIrk.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = tomorrowIrk.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
}
function _findDayByDate(days, dateStr) {
    if (!days) return null;
    for (const d of days) {
        if (d && d.date === dateStr) return d;
    }
    return null;
}
function getTomorrowData() {
    const target = _tomorrowStrIrkutsk();
    if (state.weekDays && state.weekDays.days) {
        const d = _findDayByDate(state.weekDays.days, target);
        if (d) return d;
    }
    if (state.nextWeekDays && state.nextWeekDays.days) {
        const d = _findDayByDate(state.nextWeekDays.days, target);
        if (d) return d;
    }
    return null;
}
async function ensureWeekLoaded() {
    if (state.weekDays && state.weekDays.days && state.weekDays.days.length > 0) return true;
    try { const r = await apiGet('/api/week', { offset: 0 }); state.weekDays = r; return true; }
    catch (e) { return false; }
}
function renderWeekView() {
    const wd = state.weekDays;
    if (!wd || !wd.days || wd.days.length === 0) return renderEmpty('Не удалось загрузить расписание на неделю');
    let title;
    if (state.weekOffset === 0) title = 'Текущая неделя';
    else if (state.weekOffset > 0) title = `Неделя +${state.weekOffset}`;
    else title = `Неделя ${state.weekOffset}`;
    let html = renderUserBar();
    html += `<div class="day-header">${escapeHtml(title)}</div>`;
    if (wd.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(wd.group)}${wd.subgroup ? ` · подгруппа ${escapeHtml(wd.subgroup)}` : ''}</div>`;
    for (const day of wd.days) {
        html += `<div class="day-header" style="margin-top:16px">${escapeHtml(day.name || day.date)}</div>`;
        if (!day.lessons || day.lessons.length === 0) html += `<div class="card-subtitle" style="padding:8px 0">Занятий нет</div>`;
        else for (const les of day.lessons) html += renderLesson(les);
    }
    html += `<div class="actions-row" style="margin-top:16px">
        <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
        <button class="btn btn-secondary" data-action="week-today">Сегодня</button>
        <button class="btn btn-secondary" data-action="week-next">Следующая →</button>
    </div>`;
    return html;
}
function renderDayCard(day, label) {
    let html = `<div class="day-header">${escapeHtml(label)}${day.name ? ' · ' + escapeHtml(day.name) : ''}${day.date ? ', ' + escapeHtml(day.date) : ''}</div>`;
    const p = state.profile;
    if (p?.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(p.group)}${p.subgroup ? ` · подгруппа ${escapeHtml(p.subgroup)}` : ''}</div>`;
    if (!day.lessons || day.lessons.length === 0) html += renderEmpty('Занятий нет');
    else for (const les of day.lessons) html += renderLesson(les);
    html += `<div class="actions-row">
        <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
        <button class="btn btn-secondary" data-action="week-current">Текущая неделя</button>
        <button class="btn btn-secondary" data-action="week-next">Следующая →</button>
    </div>`;
    return html;
}
function renderSchedule() {
    if (state.scheduleViewMode === 'week' && state.weekDays) return renderWeekView();
    const s = state.schedule;
    if (s?.error === 'no_group' || (state.profile && !state.profile.group)) {
        return renderUserBar() + `
            <div class="banner">
                <div class="banner-title">Как начать</div>
                <div class="banner-sub">1. Профиль → «Выбрать группу»<br>2. Укажи институт, курс и группу<br>3. Вернись — расписание появится</div>
                <button class="banner-btn" data-action="go-profile">Выбрать группу</button>
            </div>
        `;
    }
    let html = renderUserBar() + renderDaySwitch();
    if (state.scheduleDay === 'tomorrow') {
        if (!state.weekDays) return html + renderLoading();
        const tomorrow = getTomorrowData();
        if (!tomorrow) return html + renderEmpty('Не удалось загрузить расписание на завтра');
        return html + renderDayCard(tomorrow, 'Завтра');
    }
    if (!s) return html + renderEmpty('Нет данных о расписании');
    if (s.error) return html + renderEmpty(s.message || 'Ошибка загрузки');
    const header = s.dayName ? `${s.dayName}, ${s.date}` : s.date || '';
    html += `<div class="day-header">${escapeHtml(header)}</div>`;
    if (s.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(s.group)}${s.subgroup ? ` · подгруппа ${escapeHtml(s.subgroup)}` : ''}</div>`;
    if (!s.lessons || s.lessons.length === 0) html += renderEmpty('Занятий нет');
    else for (const les of s.lessons) html += renderLesson(les);
    html += `<div class="actions-row">
        <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
        <button class="btn btn-secondary" data-action="week-current">Текущая неделя</button>
        <button class="btn btn-secondary" data-action="week-next">Следующая →</button>
    </div>`;
    return html;
}

// ============================================================
//         ПИКЕРЫ ГРУПП
// ============================================================

function getCourseFromGroup(groupName) {
    const m = String(groupName).match(/-(\d{2})-/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const map = { 26: 1, 25: 2, 24: 3, 23: 4, 22: 5, 21: 6 };
    return map[year] || null;
}
function getCoursesForInstitute(inst) {
    const groups = (state.groups && state.groups[inst]) || [];
    const set = new Set();
    for (const g of groups) { const c = getCourseFromGroup(g.name); if (c) set.add(c); }
    return Array.from(set).sort((a, b) => a - b);
}
function renderInstitutePicker() {
    const groups = state.groups || {};
    const institutes = Object.keys(groups);
    let html = `<div class="picker-header"><button class="picker-back" data-action="picker-back">←</button><div class="picker-title">Выбери институт</div></div>`;
    if (institutes.length === 0) { html += `<div class="picker-empty">Список институтов не загружен</div>`; return html; }
    html += `<div class="picker-list">`;
    for (const inst of institutes) {
        const count = groups[inst]?.length || 0;
        const selected = state.profile?.group && groups[inst]?.some(g => g.name === state.profile.group);
        html += `<button class="picker-item ${selected ? 'selected' : ''}" data-action="picker-choose-institute" data-value="${escapeHtml(inst)}">
            <div class="picker-group-item"><span>${escapeHtml(inst)}</span><span class="picker-item-sub">${count} групп</span></div>
            <span class="picker-item-arrow">›</span>
        </button>`;
    }
    html += `</div>`; return html;
}
function renderCoursePicker() {
    const inst = state.pickerInstitute;
    const courses = getCoursesForInstitute(inst);
    let html = `<div class="picker-header"><button class="picker-back" data-action="picker-back">←</button><div class="picker-title">${escapeHtml(inst)} · Курс</div></div>`;
    if (courses.length === 0) { html += `<div class="picker-empty">Нет доступных курсов</div>`; return html; }
    const groups = (state.groups && state.groups[inst]) || [];
    html += `<div class="picker-list">`;
    for (const c of courses) {
        const count = groups.filter(g => getCourseFromGroup(g.name) === c).length;
        html += `<button class="picker-item" data-action="picker-choose-course" data-value="${c}">
            <div class="picker-group-item"><span>${c} курс</span><span class="picker-item-sub">${count} групп</span></div>
            <span class="picker-item-arrow">›</span>
        </button>`;
    }
    html += `</div>`; return html;
}
function renderGroupPicker() {
    const inst = state.pickerInstitute;
    const course = state.pickerCourse;
    const allGroups = (state.groups && state.groups[inst]) || [];
    const groups = allGroups.filter(g => getCourseFromGroup(g.name) === course);
    let html = `<div class="picker-header"><button class="picker-back" data-action="picker-back">←</button><div class="picker-title">${escapeHtml(inst)} · ${course} курс</div></div>
    <input class="picker-search" id="picker-search" placeholder="Поиск группы..." value="${escapeHtml(state.pickerSearch)}" autocomplete="off">
    <div class="picker-list" id="picker-list">`;
    const q = (state.pickerSearch || '').trim().toLowerCase();
    const filtered = groups.filter(g => !q || g.name.toLowerCase().includes(q));
    if (filtered.length === 0) html += `<div class="picker-empty">Ничего не найдено</div>`;
    else for (const g of filtered) {
        const selected = state.profile?.group === g.name;
        html += `<button class="picker-item ${selected ? 'selected' : ''}" data-action="picker-choose-group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">
            <div class="picker-group-item"><span>${escapeHtml(g.name)}</span></div>
            ${selected ? '<span class="picker-item-arrow">✓</span>' : '<span class="picker-item-arrow">›</span>'}
        </button>`;
    }
    html += `</div>`; return html;
}
function pickerAttachSearch() {
    const input = document.getElementById('picker-search');
    if (!input) return;
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    input.addEventListener('input', (e) => {
        state.pickerSearch = e.target.value;
        const inst = state.pickerInstitute;
        const course = state.pickerCourse;
        const allGroups = (state.groups && state.groups[inst]) || [];
        const groups = allGroups.filter(g => getCourseFromGroup(g.name) === course);
        const q = (state.pickerSearch || '').trim().toLowerCase();
        const filtered = groups.filter(g => !q || g.name.toLowerCase().includes(q));
        const list = document.getElementById('picker-list');
        if (!list) return;
        let html = '';
        if (filtered.length === 0) html = `<div class="picker-empty">Ничего не найдено</div>`;
        else for (const g of filtered) {
            const selected = state.profile?.group === g.name;
            html += `<button class="picker-item ${selected ? 'selected' : ''}" data-action="picker-choose-group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">
                <div class="picker-group-item"><span>${escapeHtml(g.name)}</span></div>
                ${selected ? '<span class="picker-item-arrow">✓</span>' : '<span class="picker-item-arrow">›</span>'}
            </button>`;
        }
        list.innerHTML = html;
        document.querySelectorAll('#picker-list [data-action]').forEach((el) => {
            el.addEventListener('click', () => handleAction(el));
        });
    });
}

// ============================================================
//         УВЕДОМЛЕНИЯ
// ============================================================

function renderNotifyEditor() {
    const cur = state.notifyEditorType;
    const hh = state.notifyEditorHour;
    const mm = state.notifyEditorMinute;
    const timeVal = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    return `<div class="picker-header"><button class="picker-back" data-action="notify-back">←</button><div class="picker-title">Уведомления</div></div>
    <div class="card">
        <div class="card-title">Когда напоминать</div>
        <div class="tab-buttons" style="margin-bottom:12px">
            <button data-action="notify-set-type" data-value="today" class="${cur === 'today' ? 'active' : ''}">Сегодня</button>
            <button data-action="notify-set-type" data-value="tomorrow" class="${cur === 'tomorrow' ? 'active' : ''}">Завтра</button>
        </div>
        <div class="card-subtitle">${cur === 'today' ? 'Расписание на сегодня. Время — до 10:00.' : 'Расписание на завтра. Время — любое.'}</div>
    </div>
    <div class="card">
        <div class="card-title">Во сколько</div>
        <div class="card-subtitle">Время по Иркутску</div>
        <input type="time" id="notify-time-input" class="input" value="${timeVal}">
    </div>
    <div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="notify-save" style="flex:1">Сохранить</button>
        <button class="btn btn-secondary" data-action="notify-off" style="flex:1">Выключить</button>
    </div>`;
}
function actionOpenNotifyEditor() {
    haptic('light');
    const p = state.profile;
    state.notifyEditorType = p?.notify_type || 'today';
    state.notifyEditorHour = p?.notify_hour >= 0 ? p.notify_hour : 8;
    state.notifyEditorMinute = p?.notify_minute || 0;
    state.notifyEditor = true; render();
}
function actionNotifyBack() { haptic('light'); state.notifyEditor = false; render(); }
function actionNotifySetType(ntype) {
    haptic('light');
    state.notifyEditorType = ntype;
    if (ntype === 'today' && state.notifyEditorHour > 10) { state.notifyEditorHour = 8; state.notifyEditorMinute = 0; }
    render();
}
async function actionNotifySave() {
    const input = document.getElementById('notify-time-input');
    if (!input) return;
    const val = (input.value || '').trim();
    if (!/^\d{1,2}:\d{2}$/.test(val)) { alert('Введи время в формате ЧЧ:ММ'); return; }
    const [hhStr, mmStr] = val.split(':');
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) { alert('Неверное время'); return; }
    if (state.notifyEditorType === 'today' && hh > 10) { alert('Для «Сегодня» — не позже 10:00'); return; }
    haptic('success');
    try {
        await apiPost('/api/notify-set', { type: state.notifyEditorType, hour: hh, minute: mm });
        state.notifyEditor = false;
        await loadProfile(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionNotifyOff() {
    haptic('success');
    try {
        await apiPost('/api/notify-set', { type: null });
        state.notifyEditor = false;
        await loadProfile(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionSetNotifyBefore(minutes) {
    haptic('light');
    try {
        await apiPost('/api/notify-set-before', { minutes });
        if (state.profile) state.profile.notify_before_min = minutes;
        haptic('success'); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
function actionLessonStatus(el) {
    const date = el.dataset.date || '';
    const time = el.dataset.time || '';
    const subject = el.dataset.subject || '';
    const cur = el.dataset.status || '';
    if (!date || !time || !subject) return;
    let next = '';
    if (cur === '') next = 'was';
    else if (cur === 'was') next = 'missed';
    else if (cur === 'missed') next = 'sick';
    else if (cur === 'sick') next = '';
    el.dataset.status = next;
    el.classList.remove('was', 'missed', 'sick');
    if (next) el.classList.add(next);
    el.textContent = next === 'was' ? '✓' : next === 'missed' ? '✗' : next === 'sick' ? 'Б' : '';
    haptic(next === 'was' ? 'light' : next === 'missed' ? 'error' : 'light');
    _applyAttendanceLocally(date, time, subject, next);
    apiPost('/api/attendance-set', { date, time, subject, status: next }).catch(() => {});
}
function _applyAttendanceLocally(date, time, subject, status) {
    const upd = (lessons) => {
        if (!lessons) return;
        for (const les of lessons) {
            if (les.time === time && les.subject === subject && (les.date || date) === date) {
                les.attendance = status;
            }
        }
    };
    if (state.schedule?.lessons) upd(state.schedule.lessons);
    if (state.weekDays?.days) for (const d of state.weekDays.days) if (d.date === date) upd(d.lessons);
    if (state.nextWeekDays?.days) for (const d of state.nextWeekDays.days) if (d.date === date) upd(d.lessons);
}

// ============================================================
//                        ЗАДАЧИ
// ============================================================

function renderTasks() {
    const tasks = state.tasks;
    const stats = state.tasksStats;
    let html = `<div class="tab-buttons">
        <button data-action="tasks-show-active" class="${state.tasksView === 'active' ? 'active' : ''}">Активные (${stats.active})</button>
        <button data-action="tasks-show-done" class="${state.tasksView === 'done' ? 'active' : ''}">Выполненные (${stats.done})</button>
    </div>`;
    if (state.tasksView === 'active') html += `<button class="btn" data-action="task-add-open" style="width:100%;margin-bottom:12px">+ Добавить задачу</button>`;
    if (!tasks || tasks.length === 0) {
        if (state.tasksView === 'active') html += `<div class="banner"><div class="banner-title">Задач нет</div><div class="banner-sub">Нажми «+ Добавить задачу».</div></div>`;
        else html += renderEmpty('Нет выполненных задач');
        return html;
    }
    for (const t of tasks) {
        const dueStr = t.due_date ? `<span class="${t.overdue ? 'overdue' : ''}">до ${escapeHtml(t.due_date)}${t.due_time ? ' ' + escapeHtml(t.due_time) : ''}${t.overdue ? ' — просрочено' : ''}</span>` : '';
        html += `<div class="card">
            <div class="card-title">${escapeHtml(t.text)}</div>
            <div class="card-meta">${priorityLabel(t.priority)} ${dueStr}</div>
            <div class="actions-row">
                ${!t.done ? `<button class="btn btn-secondary" data-action="task-done" data-id="${t.id}">Готово</button>` : ''}
                <button class="btn btn-secondary" data-action="task-edit-open" data-id="${t.id}">Изменить</button>
                <button class="btn btn-secondary" data-action="task-delete" data-id="${t.id}">Удалить</button>
            </div>
        </div>`;
    }
    if (state.tasksView === 'done' && tasks.length > 0) html += `<button class="btn btn-secondary" data-action="tasks-clear" style="width:100%;margin-top:8px">Очистить выполненные</button>`;
    return html;
}
function renderTaskEditor() {
    const isEdit = state.taskEditorId !== null;
    const p = state.taskEditorPriority;
    const dueIso = state.taskEditorDate;
    return `<div class="editor-header"><button class="picker-back" data-action="task-editor-back">←</button><div class="picker-title">${isEdit ? 'Изменить задачу' : 'Новая задача'}</div></div>
    <div class="card"><div class="card-title">Текст задачи</div>
        <textarea class="input" id="task-text-input" placeholder="Что нужно сделать?" rows="4">${escapeHtml(state.taskEditorText || '')}</textarea>
    </div>
    <div class="card"><div class="card-title">Срок</div>
        <div class="card-subtitle">Дата</div>
        <input type="date" id="task-date-input" class="input" value="${escapeHtml(dueIso)}">
        <div class="card-subtitle" style="margin-top:8px">Время (необязательно)</div>
        <input type="time" id="task-time-input" class="input" value="${escapeHtml(state.taskEditorTime || '')}">
        <div class="actions-row" style="margin-top:8px">
            <button class="btn btn-secondary" data-action="task-clear-date" style="flex:1">Очистить срок</button>
        </div>
    </div>
    <div class="card"><div class="card-title">Приоритет</div>
        <div class="task-priority-picker">
            <button class="task-priority-btn p-low ${p === 1 ? 'active' : ''}" data-action="task-set-priority" data-value="1">Низкий</button>
            <button class="task-priority-btn p-medium ${p === 2 ? 'active' : ''}" data-action="task-set-priority" data-value="2">Средний</button>
            <button class="task-priority-btn p-high ${p === 3 ? 'active' : ''}" data-action="task-set-priority" data-value="3">Высокий</button>
        </div>
    </div>
    <div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="task-editor-save" style="flex:1">${isEdit ? 'Сохранить' : 'Добавить'}</button>
        ${isEdit ? `<button class="btn btn-secondary" data-action="task-editor-delete" style="flex:1">Удалить</button>` : ''}
    </div>`;
}
function actionTaskAddOpen() {
    haptic('light');
    state.taskEditor = true; state.taskEditorId = null;
    state.taskEditorText = ''; state.taskEditorDate = ''; state.taskEditorTime = '';
    state.taskEditorPriority = 2; render();
}
function actionTaskEditOpen(id) {
    haptic('light');
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    state.taskEditor = true; state.taskEditorId = t.id;
    state.taskEditorText = t.text || '';
    state.taskEditorDate = displayToISO(t.due_date || '');
    state.taskEditorTime = t.due_time || '';
    state.taskEditorPriority = t.priority || 2;
    render();
}
function actionTaskEditorBack() { haptic('light'); state.taskEditor = false; state.taskEditorId = null; render(); }
function actionTaskSetPriority(p) { haptic('light'); state.taskEditorPriority = p; render(); }
function actionTaskClearDate() { haptic('light'); state.taskEditorDate = ''; state.taskEditorTime = ''; render(); }
async function actionTaskEditorSave() {
    const textEl = document.getElementById('task-text-input');
    const dateEl = document.getElementById('task-date-input');
    const timeEl = document.getElementById('task-time-input');
    const text = (textEl?.value || '').trim();
    if (!text) { alert('Введи текст задачи'); return; }
    const dateIso = dateEl?.value || '';
    const due_date = dateIso ? isoToDisplay(dateIso) : null;
    const due_time = (timeEl?.value || '').trim() || null;
    const priority = state.taskEditorPriority || 2;
    try {
        if (state.taskEditorId) {
            await apiPost('/api/task-update', { id: state.taskEditorId, text, due_date, due_time, priority, reset_due: !due_date });
        } else {
            await apiPost('/api/task-add', { text, due_date, due_time, priority });
        }
        haptic('success');
        state.taskEditor = false; state.taskEditorId = null;
        await loadTasks(); await loadWallet(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionTaskEditorDelete() {
    if (!state.taskEditorId) return;
    const ok = await tgConfirm('Удалить задачу?');
    if (!ok) return;
    try {
        await apiPost('/api/task-delete', { id: state.taskEditorId });
        haptic('success');
        state.taskEditor = false; state.taskEditorId = null;
        await loadTasks(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionTaskDone(id) {
    try {
        const r = await apiPost('/api/task-update', { id, done: true });
        haptic('success'); popEmoji('✅');
        if (r.wallet) state.wallet = r.wallet;
        await loadTasks();
        if (r.new_achievements && r.new_achievements.length > 0) {
            await loadAchievements();
            showNewAchievements(r.new_achievements);
        }
        render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionTaskDelete(id) {
    const ok = await tgConfirm('Удалить задачу?');
    if (!ok) return;
    try { await apiPost('/api/task-delete', { id }); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionTasksClear() {
    const ok = await tgConfirm('Очистить все выполненные?');
    if (!ok) return;
    try { await apiPost('/api/task-clear'); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}

// ============================================================
//                        ЗАМЕТКИ
// ============================================================

function renderNotes() {
    let html = `<button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">+ Добавить заметку</button>`;
    if (!state.notes || state.notes.length === 0) {
        html += `<div class="banner"><div class="banner-title">Заметки</div><div class="banner-sub">Короткие записи по предметам.</div></div>`;
        return html;
    }
    for (const n of state.notes) {
        html += `<div class="card">
            <div class="card-title">${escapeHtml(n.subject)}</div>
            <div class="card-subtitle">${escapeHtml(n.text)}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="note-edit-open" data-id="${n.id}">Изменить</button>
                <button class="btn btn-secondary" data-action="note-delete" data-id="${n.id}">Удалить</button>
            </div>
        </div>`;
    }
    return html;
}
function renderNoteEditor() {
    const isEdit = state.noteEditorId !== null;
    return `<div class="editor-header"><button class="picker-back" data-action="note-editor-back">←</button><div class="picker-title">${isEdit ? 'Изменить заметку' : 'Новая заметка'}</div></div>
    <div class="card"><div class="card-title">Предмет</div>
        <input class="input" id="note-subject-input" placeholder="Название предмета" value="${escapeHtml(state.noteEditorSubject || '')}" autocomplete="off">
    </div>
    <div class="card"><div class="card-title">Текст заметки</div>
        <textarea class="input note-textarea" id="note-text-input" placeholder="Что записать?" rows="8">${escapeHtml(state.noteEditorText || '')}</textarea>
    </div>
    <div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="note-editor-save" style="flex:1">${isEdit ? 'Сохранить' : 'Добавить'}</button>
        ${isEdit ? `<button class="btn btn-secondary" data-action="note-editor-delete" style="flex:1">Удалить</button>` : ''}
    </div>`;
}
function actionNoteAddOpen() {
    haptic('light');
    state.noteEditor = true; state.noteEditorId = null;
    state.noteEditorSubject = ''; state.noteEditorText = ''; render();
}
function actionNoteEditOpen(id) {
    haptic('light');
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    state.noteEditor = true; state.noteEditorId = n.id;
    state.noteEditorSubject = n.subject || '';
    state.noteEditorText = n.text || ''; render();
}
function actionNoteEditorBack() { haptic('light'); state.noteEditor = false; state.noteEditorId = null; render(); }
async function actionNoteEditorSave() {
    const subjEl = document.getElementById('note-subject-input');
    const textEl = document.getElementById('note-text-input');
    const subject = (subjEl?.value || '').trim();
    const text = (textEl?.value || '').trim();
    if (!subject) { alert('Введи название предмета'); return; }
    if (!text) { alert('Введи текст заметки'); return; }
    try {
        const r = await apiPost('/api/note-save', { subject, text });
        haptic('success');
        state.noteEditor = false; state.noteEditorId = null;
        if (r.wallet) state.wallet = r.wallet;
        await loadNotes();
        if (r.new_achievements && r.new_achievements.length > 0) {
            await loadAchievements();
            showNewAchievements(r.new_achievements);
        }
        render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionNoteEditorDelete() {
    if (!state.noteEditorId) return;
    const ok = await tgConfirm('Удалить заметку?');
    if (!ok) return;
    try {
        await apiPost('/api/note-delete', { id: state.noteEditorId });
        haptic('success');
        state.noteEditor = false; state.noteEditorId = null;
        await loadNotes(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionNoteDelete(id) {
    const ok = await tgConfirm('Удалить заметку?');
    if (!ok) return;
    try { await apiPost('/api/note-delete', { id }); haptic('success'); await loadNotes(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}

// ============================================================
//                            AI
// ============================================================

function renderAI() {
    let html = '';
    if (state.aiMessages.length === 0) {
        html += `<div class="banner"><div class="banner-title">AI Помощник</div><div class="banner-sub">Задай вопрос по учёбе или прикрепи фото.</div></div>`;
    } else {
        for (const m of state.aiMessages) {
            if (m.role === 'user') {
                if (m.photo) {
                    html += `<div class="card" style="background:var(--neon);color:#070B14;padding:10px">
                        <img src="${m.photo}" style="width:100%;border-radius:12px;display:block;margin-bottom:8px" alt="фото">
                        <div style="font-weight:600">${escapeHtml(m.text || '')}</div>
                    </div>`;
                } else {
                    html += `<div class="card" style="background:var(--neon);color:#070B14"><div style="font-weight:600">${escapeHtml(m.text)}</div></div>`;
                }
            } else {
                html += `<div class="card"><div style="white-space:pre-wrap">${escapeHtml(m.text)}</div></div>`;
            }
        }
    }
    if (state.aiPending) html += renderLoading();
    const photoPreview = state.aiPendingPhoto
        ? `<div class="ai-photo-preview"><img src="${state.aiPendingPhoto}" alt="фото"><button class="ai-photo-remove" data-action="ai-photo-cancel">✕</button></div>`
        : '';
    html += `<div style="margin-top:12px">
        ${photoPreview}
        <textarea class="input" id="ai-input" placeholder="Напиши вопрос..." rows="3" ${state.aiPending ? 'disabled' : ''}></textarea>
        <button class="btn" data-action="ai-send" style="width:100%" ${state.aiPending ? 'disabled' : ''}>Отправить</button>
        <button class="btn btn-secondary" data-action="ai-photo-open" style="width:100%;margin-top:6px" ${state.aiPending ? 'disabled' : ''}>Прикрепить фото</button>
        <button class="btn btn-secondary" data-action="ai-clear" style="width:100%;margin-top:6px">Очистить</button>
        <input type="file" id="ai-photo-input" accept="image/*" style="display:none">
    </div>`;
    return html;
}
async function actionAIClear() {
    const ok = await tgConfirm('Очистить историю чата?');
    if (!ok) return;
    haptic('light');
    state.aiMessages = []; state.aiPendingPhoto = null;
    apiPost('/api/ai/clear-history').catch(() => {});
    render();
}
function actionAIPhotoOpen() {
    haptic('light');
    const input = document.getElementById('ai-photo-input');
    if (input) input.click();
}
function actionAIPhotoCancel() { haptic('light'); state.aiPendingPhoto = null; render(); }
function actionAIPhotoSelected(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { alert('Фото слишком большое (макс 8 МБ)'); return; }
    if (!file.type.startsWith('image/')) { alert('Нужно изображение'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const maxSide = 1600;
            let w = img.width, h = img.height;
            if (w > maxSide || h > maxSide) {
                if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
                else { w = Math.round(w * maxSide / h); h = maxSide; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            state.aiPendingPhoto = canvas.toDataURL('image/jpeg', 0.85);
            haptic('light'); render();
        };
        img.onerror = () => alert('Не удалось прочитать изображение');
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
async function actionAISend() {
    const el = document.getElementById('ai-input');
    if (!el) return;
    const question = (el.value || '').trim();
    const photo = state.aiPendingPhoto;
    if (!question && !photo) return;
    if (photo) {
        state.aiMessages.push({ role: 'user', text: question || 'Что на фото?', photo });
        state.aiPendingPhoto = null; el.value = ''; state.aiPending = true; render();
        try {
            const r = await apiPost('/api/ai-photo', { photo, question });
            state.aiMessages.push({ role: 'assistant', text: r.answer || 'Нет ответа' });
            haptic('success'); await loadWallet();
        } catch (err) {
            state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + err.message });
            haptic('error');
        } finally { state.aiPending = false; render(); }
        return;
    }
    state.aiMessages.push({ role: 'user', text: question });
    el.value = ''; state.aiPending = true; render();
    try {
        const r = await apiPost('/api/ai', { question });
        state.aiMessages.push({ role: 'assistant', text: r.answer || 'Нет ответа' });
        haptic('success'); await loadWallet();
    } catch (e) {
        state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + e.message });
        haptic('error');
    } finally { state.aiPending = false; render(); }
}

// ============================================================
//                          ADMIN
// ============================================================

function renderAdmin() {
    if (!state.isAdmin) return renderEmpty('Доступ только для администратора');
    let html = '';
    if (state.adminStats) {
        const s = state.adminStats;
        html += `<div class="banner"><div class="banner-title">Статистика</div><div class="banner-sub">Пользователей: ${s.total_users}<br>Обращений в ожидании: ${s.pending_feedback}</div></div>`;
    } else html += renderLoading();
    html += `<div class="card">
        <div class="card-title">Мониторинг ИРНИТУ</div>
        ${state.adminMonitor
            ? (state.adminMonitor.ok
                ? `<div class="card-subtitle" style="color:var(--accent-green)">Сайт отвечает (HTTP ${state.adminMonitor.status})</div>`
                : `<div class="card-subtitle overdue">Сайт не отвечает${state.adminMonitor.error ? ': ' + escapeHtml(state.adminMonitor.error) : ''}</div>`)
            : `<div class="card-subtitle">Не проверено</div>`}
        <div class="actions-row"><button class="btn btn-secondary" data-action="admin-monitor">Проверить</button></div>
    </div>`;
    html += `<div class="card">
        <div class="card-title">Рассылка</div>
        <textarea class="input" id="admin-broadcast-text" placeholder="Текст..." rows="3"></textarea>
        <button class="btn" data-action="admin-broadcast">Отправить всем</button>
    </div>`;
    if (state.adminFeedback && state.adminFeedback.length > 0) {
        html += `<div class="card"><div class="card-title">Обращения (${state.adminFeedback.length})</div>`;
        for (const f of state.adminFeedback) {
            html += `<div style="border-bottom:1px solid var(--divider);padding:10px 0">
                <div class="card-subtitle">#${f.id} | ${escapeHtml(f.username || f.user_id)}${f.status === 'postponed' ? ' [отложено]' : ''}</div>
                <div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(f.text)}</div>
                <div class="actions-row">
                    <button class="btn btn-secondary" data-action="admin-fb-reply" data-id="${f.id}">Ответить</button>
                    <button class="btn btn-secondary" data-action="admin-fb-postpone" data-id="${f.id}">Отложить</button>
                </div>
            </div>`;
        }
        html += `</div>`;
    } else html += `<div class="card"><div class="card-subtitle">Обращений в ожидании нет.</div></div>`;
    return html;
}

// ============================================================
//                       СТИПЕНДИЯ
// ============================================================

function renderScholarshipCard() {
    const s = state.scholarship;
    let html = `<div class="card"><div class="card-title">Стипендия</div>`;
    if (!s) { html += `<div class="card-subtitle">Загрузка...</div></div>`; return html; }
    html += `<div class="card-subtitle">Текущая сумма: ${s.amount !== null && s.amount !== undefined ? escapeHtml(s.amount) + ' ₽/мес' : 'не указана'}</div>`;
    const semesters = s.semesters || [];
    if (semesters.length > 0) {
        html += `<div class="sem-selector">
            <button class="sem-chip ${state.scholarshipSemesterFilter === 'all' ? 'active' : ''}" data-action="sem-filter" data-value="all">Все</button>
            ${semesters.map(sem => `<button class="sem-chip ${state.scholarshipSemesterFilter === sem ? 'active' : ''}" data-action="sem-filter" data-value="${escapeHtml(sem)}">${escapeHtml(sem)}</button>`).join('')}
        </div>`;
    }
    const allGrades = s.grades || [];
    const grades = state.scholarshipSemesterFilter === 'all' ? allGrades : allGrades.filter(g => (g.semester || '') === state.scholarshipSemesterFilter);
    if (allGrades.length === 0) {
        html += `<div class="sch-empty">Оценок пока нет.</div>`;
        html += `<div class="actions-row" style="margin-top:12px">
            <button class="btn btn-secondary" data-action="sch-set-amount-open">Сумма</button>
            <button class="btn" data-action="sch-add-new" style="flex:1">+ Добавить оценку</button>
        </div></div>`;
        return html;
    }
    const cnt5 = grades.filter(g => g.grade === 5).length;
    const cnt4 = grades.filter(g => g.grade === 4).length;
    const cnt3 = grades.filter(g => g.grade === 3).length;
    const cnt2 = grades.filter(g => g.grade === 2).length;
    const cntAuto = grades.filter(g => g.is_auto).length;
    const avg = grades.length > 0 ? grades.reduce((a, g) => a + g.grade, 0) / grades.length : 0;
    html += `<div class="sch-avg-block">
        <div class="sch-avg-value">${avg.toFixed(2)}</div>
        <div class="sch-avg-label">средний балл · ${grades.length} ${pluralSubjects(grades.length)}${cntAuto > 0 ? ` · автоматов: ${cntAuto}` : ''}</div>
    </div>`;
    html += `<div class="sch-filters">
        <button class="sch-filter ${state.scholarshipFilter === 'all' ? 'active' : ''}" data-action="sch-filter" data-value="all">Все · ${grades.length}</button>
        ${cntAuto > 0 ? `<button class="sch-filter sch-filter-auto ${state.scholarshipFilter === 'auto' ? 'active' : ''}" data-action="sch-filter" data-value="auto">Автоматы · ${cntAuto}</button>` : ''}
        ${cnt5 > 0 ? `<button class="sch-filter grade-5 ${state.scholarshipFilter === '5' ? 'active' : ''}" data-action="sch-filter" data-value="5">5 · ${cnt5}</button>` : ''}
        ${cnt4 > 0 ? `<button class="sch-filter grade-4 ${state.scholarshipFilter === '4' ? 'active' : ''}" data-action="sch-filter" data-value="4">4 · ${cnt4}</button>` : ''}
        ${cnt3 > 0 ? `<button class="sch-filter grade-3 ${state.scholarshipFilter === '3' ? 'active' : ''}" data-action="sch-filter" data-value="3">3 · ${cnt3}</button>` : ''}
        ${cnt2 > 0 ? `<button class="sch-filter grade-2 ${state.scholarshipFilter === '2' ? 'active' : ''}" data-action="sch-filter" data-value="2">2 · ${cnt2}</button>` : ''}
    </div>`;
    if (state.scholarshipSemesterFilter === 'all' && s.forecast) {
        const isBad = cnt2 > 0 || cnt3 > 0 || (grades.length && avg < 4.0);
        html += `<div class="sch-forecast ${isBad ? 'bad' : 'good'}">${escapeHtml(s.forecast)}</div>`;
    }
    let filtered = grades;
    if (state.scholarshipFilter === 'auto') filtered = grades.filter(g => g.is_auto);
    else if (state.scholarshipFilter !== 'all') filtered = grades.filter(g => String(g.grade) === state.scholarshipFilter);
    html += `<div class="sch-list">`;
    if (filtered.length === 0) html += `<div class="sch-empty">Нет оценок с таким фильтром</div>`;
    else for (const g of filtered) {
        html += `<button class="sch-item" data-action="sch-edit" data-id="${g.id}">
            <div class="sch-item-subject">
                <span class="sch-item-subject-text">${escapeHtml(g.subject)}</span>
                ${g.is_auto ? '<span class="sch-auto-badge">АВТО</span>' : ''}
            </div>
            <div class="sch-item-grade grade-${g.grade}">${g.grade}</div>
            <div class="sch-item-arrow">›</div>
        </button>`;
    }
    html += `</div>`;
    html += `<div class="actions-row" style="margin-top:12px">
        <button class="btn btn-secondary" data-action="sch-set-amount-open">Сумма</button>
        <button class="btn btn-secondary" data-action="sch-clear">Очистить</button>
        <button class="btn" data-action="sch-add-new" style="flex:1">+ Оценка</button>
    </div></div>`;
    return html;
}
function pluralSubjects(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'предмет';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'предмета';
    return 'предметов';
}
function renderScholarshipEditor() {
    const isEdit = state.scholarshipEditorId !== null;
    const subject = state.scholarshipEditorSubject || '';
    const grade = state.scholarshipEditorGrade;
    const isAuto = state.scholarshipEditorIsAuto;
    const semester = state.scholarshipEditorSemester || currentSemester();
    let html = `<div class="picker-header"><button class="picker-back" data-action="sch-editor-back">←</button><div class="picker-title">${isEdit ? 'Изменить оценку' : 'Новая оценка'}</div></div>
    <div class="card">
        <div class="card-title">Предмет</div>
        <input class="input" id="sch-subject-input" list="sch-subjects-list" placeholder="Название предмета" value="${escapeHtml(subject)}" autocomplete="off">
        <datalist id="sch-subjects-list">${state.scholarshipAvailable.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}</datalist>`;
    if (state.scholarshipAvailable.length > 0) {
        const preview = state.scholarshipAvailable.slice(0, 12);
        html += `<div class="sch-hint">Из твоего расписания:</div>
            <div class="sch-subject-chips">${preview.map(s => `<button class="sch-subject-chip" data-action="sch-pick-subject" data-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`;
    }
    html += `</div>
    <div class="card"><div class="card-title">Семестр</div>
        <input class="input" id="sch-semester-input" placeholder="Например: Осень 2026" value="${escapeHtml(semester)}">
    </div>
    <div class="card"><div class="card-title">Оценка</div>
        <div class="sch-grade-picker">
            ${[2, 3, 4, 5].map(g => `<button class="sch-grade-btn grade-${g} ${grade === g ? 'active' : ''}" data-action="sch-set-grade" data-value="${g}">${g}</button>`).join('')}
        </div>
        <label class="sch-auto-toggle">
            <input type="checkbox" id="sch-auto-input" ${isAuto ? 'checked' : ''}>
            <span>Автомат — оценка выставлена без экзамена</span>
        </label>
    </div>
    <div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="sch-editor-save" style="flex:1">${isEdit ? 'Сохранить' : 'Добавить'}</button>
        ${isEdit ? `<button class="btn btn-secondary" data-action="sch-editor-delete" style="flex:1">Удалить</button>` : ''}
    </div>`;
    return html;
}
function actionScholarshipAdd() {
    haptic('light');
    state.scholarshipEditor = true; state.scholarshipEditorId = null;
    state.scholarshipEditorSubject = ''; state.scholarshipEditorGrade = 5;
    state.scholarshipEditorIsAuto = false; state.scholarshipEditorSemester = currentSemester();
    render();
}
function actionScholarshipEdit(id) {
    haptic('light');
    const g = state.scholarship?.grades.find(x => x.id === id);
    if (!g) return;
    state.scholarshipEditor = true; state.scholarshipEditorId = g.id;
    state.scholarshipEditorSubject = g.subject;
    state.scholarshipEditorGrade = g.grade;
    state.scholarshipEditorIsAuto = !!g.is_auto;
    state.scholarshipEditorSemester = g.semester || currentSemester();
    render();
}
function actionScholarshipBack() { haptic('light'); state.scholarshipEditor = false; state.scholarshipEditorId = null; render(); }
function actionScholarshipSetGrade(g) { haptic('light'); state.scholarshipEditorGrade = g; render(); }
function actionScholarshipPickSubject(s) {
    haptic('light');
    state.scholarshipEditorSubject = s;
    const input = document.getElementById('sch-subject-input');
    if (input) input.value = s;
}
async function actionScholarshipSave() {
    const subjEl = document.getElementById('sch-subject-input');
    const semEl = document.getElementById('sch-semester-input');
    const subject = (subjEl?.value || '').trim();
    const grade = state.scholarshipEditorGrade;
    const isAuto = state.scholarshipEditorIsAuto;
    const semester = (semEl?.value || '').trim() || null;
    if (!subject) { alert('Введи название предмета'); return; }
    if (![2, 3, 4, 5].includes(grade)) { alert('Выбери оценку'); return; }
    try {
        if (state.scholarshipEditorId) {
            await apiPost('/api/scholarship-update-grade', { id: state.scholarshipEditorId, subject, grade, is_auto: isAuto, semester });
        } else {
            await apiPost('/api/scholarship-add-grade', { subject, grade, is_auto: isAuto, semester });
        }
        haptic('success');
        state.scholarshipEditor = false; state.scholarshipEditorId = null;
        await loadScholarship(); await loadWallet(); await loadAchievements(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionScholarshipDeleteGrade() {
    if (!state.scholarshipEditorId) return;
    const ok = await tgConfirm('Удалить эту оценку?');
    if (!ok) return;
    try {
        await apiPost('/api/scholarship-delete-grade', { id: state.scholarshipEditorId });
        haptic('success');
        state.scholarshipEditor = false; state.scholarshipEditorId = null;
        await loadScholarship(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
function actionScholarshipFilter(f) { haptic('light'); state.scholarshipFilter = f; render(); }
function actionSemesterFilter(sem) { haptic('light'); state.scholarshipSemesterFilter = sem; state.scholarshipFilter = 'all'; render(); }
async function actionScholarshipSetAmount() {
    const amount = prompt('Сумма стипендии (₽/мес, 0 если не получаешь):');
    if (amount === null) return;
    try {
        await apiPost('/api/scholarship-set-amount', { amount: parseInt(amount) || 0 });
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionScholarshipClear() {
    const sem = state.scholarshipSemesterFilter === 'all' ? null : state.scholarshipSemesterFilter;
    const msg = sem ? `Очистить оценки за «${sem}»?` : 'Очистить ВСЕ оценки?';
    const ok = await tgConfirm(msg);
    if (!ok) return;
    try {
        await apiPost('/api/scholarship-clear', { semester: sem });
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ============================================================
//                    ОБРАТНАЯ СВЯЗЬ / ЭКСПОРТ
// ============================================================

function renderMyFeedbackCard() {
    if (!state.myFeedbackLoaded) {
        return `<div class="card"><div class="card-title">Мои обращения</div><div class="card-subtitle">Загрузка...</div></div>`;
    }
    if (!state.myFeedback || state.myFeedback.length === 0) {
        return `<div class="card"><div class="card-title">Мои обращения</div><div class="card-subtitle">Ты ещё не писал админу.</div></div>`;
    }
    const total = state.myFeedback.length;
    const previewLimit = 3;
    const showAll = state.myFeedbackExpanded;
    const items = showAll ? state.myFeedback : state.myFeedback.slice(0, previewLimit);
    let html = `<div class="card"><div class="card-title">Мои обращения <span style="color:var(--text-2);font-weight:600;font-size:13px">${total > previewLimit && !showAll ? `· показаны ${previewLimit} из ${total}` : `· ${total}`}</span></div>`;
    for (const f of items) {
        let statusLabel = 'В обработке';
        let statusCls = 'new';
        if (f.status === 'answered') { statusLabel = 'Отвечено'; statusCls = 'answered'; }
        else if (f.status === 'postponed') { statusLabel = 'Отложено'; statusCls = 'postponed'; }
        const dateStr = (f.created_at || '').slice(0, 10);
        html += `<div class="fb-item">
            <div class="fb-item-head">
                <span class="fb-date">${escapeHtml(dateStr)}</span>
                <span class="fb-status ${statusCls}">${statusLabel}</span>
            </div>
            <div class="fb-text">${escapeHtml(f.text)}</div>
            ${f.admin_reply ? `<div class="fb-reply"><div class="fb-reply-label">Ответ</div>${escapeHtml(f.admin_reply)}</div>` : ''}
        </div>`;
    }
    if (total > previewLimit && !showAll) html += `<button class="fb-show-more" data-action="fb-toggle">Показать все (${total})</button>`;
    else if (showAll && total > previewLimit) html += `<button class="fb-show-more" data-action="fb-toggle">Свернуть</button>`;
    html += `</div>`;
    return html;
}
function actionFbToggle() { haptic('light'); state.myFeedbackExpanded = !state.myFeedbackExpanded; render(); }
async function actionFeedbackSend() {
    const el = document.getElementById('feedback-text');
    if (!el) return;
    const text = (el.value || '').trim();
    if (!text) return;
    try {
        await apiPost('/api/feedback', { text });
        el.value = ''; haptic('success'); alert('Отправлено');
        state.myFeedbackLoaded = false; state.myFeedbackExpanded = false;
        await loadMyFeedback(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionExportData() {
    if (state.exportPending) return;
    state.exportPending = true; render();
    haptic('light');
    try {
        await apiPost('/api/export');
        haptic('success');
        alert('PDF отправлен в чат с ботом');
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + e.message);
    } finally {
        state.exportPending = false; render();
    }
}
async function actionForgetGroup() {
    const ok = await tgConfirm('Забыть группу?');
    if (!ok) return;
    try {
        await apiPost('/api/set-group', { group_id: '', group_name: '', subgroup: 0 });
        if (state.profile) { state.profile.group = null; state.profile.group_id = null; }
        haptic('success'); await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionSetSubgroup(value) {
    try { await apiPost('/api/set-subgroup', { subgroup: value }); if (state.profile) state.profile.subgroup = value; haptic('success'); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionQuoteSubscribe(value) {
    try { await apiPost('/api/quote-subscribe', { subscribe: value === 1 }); if (state.profile) state.profile.daily_subscribed = value === 1; haptic('success'); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAdminMonitor() {
    state.adminBusy = true;
    try { state.adminMonitor = await apiGet('/api/admin/monitor'); }
    catch (e) { state.adminMonitor = { ok: false, status: 0, error: e.message }; }
    state.adminBusy = false; render();
}
async function actionAdminBroadcast() {
    const el = document.getElementById('admin-broadcast-text');
    if (!el) return;
    const text = (el.value || '').trim();
    if (!text) { alert('Пустое сообщение'); return; }
    const ok = await tgConfirm('Отправить всем пользователям?');
    if (!ok) return;
    try { await apiPost('/api/admin/broadcast', { text }); el.value = ''; haptic('success'); alert('Рассылка запущена'); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAdminFbReply(fid) {
    const reply = prompt('Текст ответа:');
    if (!reply) return;
    try {
        await apiPost('/api/admin/feedback-reply', { id: fid, text: reply });
        haptic('success');
        await loadAdminFeedback(); await loadAdminStats(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAdminFbPostpone(fid) {
    try {
        await apiPost('/api/admin/feedback-postpone', { id: fid });
        haptic('success');
        await loadAdminFeedback(); await loadAdminStats(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// ============================================================
//                       LOADERS
// ============================================================

async function loadSchedule() {
    try { state.schedule = await apiGet('/api/schedule'); }
    catch (e) { state.schedule = { error: 'load_error', message: e.message }; }
}
async function loadTasks() {
    try {
        const doneParam = state.tasksView === 'done' ? '1' : '0';
        const r = await apiGet('/api/tasks', { done: doneParam });
        state.tasks = r.tasks || [];
        state.tasksStats = { active: r.active || 0, done: r.done || 0 };
    } catch (e) { state.tasks = []; }
}
async function loadNotes() {
    try { const r = await apiGet('/api/notes'); state.notes = r.notes || []; }
    catch (e) { state.notes = []; }
}
async function loadProfile() {
    try {
        state.profile = await apiGet('/api/me');
        state.isAdmin = !!state.profile.is_admin;
        if (state.profile.wallet) state.wallet = state.profile.wallet;
    } catch (e) { state.profile = { error: e.message }; }
}
async function loadWallet() {
    try { const r = await apiGet('/api/wallet'); state.wallet = r.wallet; }
    catch (e) {}
}
async function loadChestStatus() {
    try { state.chest = await apiGet('/api/chest/status'); }
    catch (e) { state.chest = { can_open: true }; }
}
async function loadAchievements() {
    try {
        const r = await apiGet('/api/achievements');
        state.achievements = r.items || [];
        state.achievementsLoaded = true;
    } catch (e) { state.achievements = []; state.achievementsLoaded = true; }
}
async function loadScholarship() {
    try {
        state.scholarship = await apiGet('/api/scholarship');
        state.scholarshipAvailable = state.scholarship?.available_subjects || [];
        if (state.scholarshipSemesterFilter !== 'all') {
            const list = state.scholarship?.semesters || [];
            if (!list.includes(state.scholarshipSemesterFilter)) state.scholarshipSemesterFilter = 'all';
        }
    } catch (e) { state.scholarship = null; state.scholarshipAvailable = []; }
}
async function loadGroups(force = false) {
    if (state.groups && !force) return;
    try { const r = await apiGet('/api/groups'); state.groups = r.groups; }
    catch (e) { state.groups = {}; }
}
async function loadAdminStats() {
    try { state.adminStats = await apiGet('/api/admin/stats'); }
    catch (e) { state.adminStats = null; }
}
async function loadAdminFeedback() {
    try { const r = await apiGet('/api/admin/feedback-list'); state.adminFeedback = r.items || []; }
    catch (e) { state.adminFeedback = []; }
}
async function loadGames() {
    try { const r = await apiGet('/api/game/info'); state.gamesList = r.games || []; }
    catch (e) { state.gamesList = []; }
}
async function loadWalletLeaderboard() {
    try { const r = await apiGet('/api/wallet/leaderboard'); state.walletLeaderboard = r.items || []; }
    catch (e) { state.walletLeaderboard = []; }
}
async function loadAiHistory() {
    try {
        const r = await apiGet('/api/ai/history');
        const items = r.items || [];
        state.aiMessages = items.map(it => ({ role: it.role, text: it.text, photo: null, has_photo: it.has_photo }));
        state.aiHistoryLoaded = true;
    } catch (e) { state.aiMessages = []; state.aiHistoryLoaded = true; }
}
async function loadMyFeedback() {
    try { const r = await apiGet('/api/feedback/my'); state.myFeedback = r.items || []; state.myFeedbackLoaded = true; }
    catch (e) { state.myFeedback = []; state.myFeedbackLoaded = true; }
}

async function loadTabData(tab) {
    stopChestTimer();
    bsClearPoll();
    state.loading = true;
    state.error = null;
    state.notifyEditor = false;
    state.taskEditor = false;
    state.noteEditor = false;
    state.gameView = null;
    state.gameInstance = null;
    state.nameEditor = false;
    state.chestModal = null;
    state.achModal = null;
    state.levelInfoModal = false;
    state.currencyInfoModal = false;
    state.premiumModal = null;
    state.newAchToast = null;
    state.exchangeOpen = false;
    state.bsJoinModal = false;
    state.bsScreen = 'lobby';
    state.bsResult = null;
    render();
    try {
        if (tab === 'schedule') {
            state.scheduleViewMode = 'today';
            state.weekOffset = 0;
            state.scheduleDay = 'today';
            state.weekDays = null;
            state.nextWeekDays = null;
            await loadProfile();
            await loadSchedule();
            ensureWeekLoaded().catch(() => {});
        } else if (tab === 'tasks') await loadTasks();
        else if (tab === 'notes') await loadNotes();
        else if (tab === 'games') {
            await loadProfile();
            await loadGames();
            await loadWalletLeaderboard();
            await bsTryRestoreSession();
        }
        else if (tab === 'ai') { await loadProfile(); await loadAiHistory(); }
        else if (tab === 'admin') {
            await loadProfile();
            if (state.isAdmin) await Promise.all([loadAdminStats(), loadAdminFeedback()]);
        } else if (tab === 'profile') {
            state.scholarshipFilter = 'all';
            state.scholarshipSemesterFilter = 'all';
            state.scholarshipEditor = false;
            state.scholarshipEditorId = null;
            state.myFeedbackLoaded = false;
            state.myFeedbackExpanded = false;
            state.achievements = [];
            state.achievementsLoaded = false;
            await Promise.all([loadProfile(), loadWallet(), loadChestStatus(), loadAchievements(), loadScholarship(), loadMyFeedback()]);
        }
    } catch (e) { console.error(e); state.error = e.message; }
    state.loading = false;
    render();
}

async function bsTryRestoreSession() {
    try {
        const savedId = localStorage.getItem(BS_STORAGE_KEY);
        if (!savedId) return;
        const r = await apiGet('/api/bs/state', { game_id: savedId });
        if (r.status === 'finished') {
            bsClearSession();
            return;
        }
        if (r.status === 'playing' || r.status === 'waiting' || r.status === 'placing') {
            state.bsGameId = savedId;
            state.bsIsBot = false;
            state.bsEnemyName = r.opponent_name || 'Соперник';
            state.bsMyField = bsEmptyField();
            state.bsMyShips = (r.my_ships || []).map(s => ({ size: s.size, cells: s.cells, hits: 0, sunk: false }));
            for (const s of state.bsMyShips) {
                for (const [x, y] of s.cells) state.bsMyField[y][x] = 1;
            }
            state.bsEnemyField = bsEmptyField();
            for (const sh of (r.my_shots || [])) {
                if (sh.x == null) continue;
                if (sh.result === 'miss') state.bsEnemyField[sh.y][sh.x] = 3;
                else if (sh.result === 'hit') state.bsEnemyField[sh.y][sh.x] = 2;
                else if (sh.result === 'sunk') state.bsEnemyField[sh.y][sh.x] = 4;
            }
            applyEnemyShots(r.enemy_shots || []);
            state.bsTurn = r.your_turn ? 'me' : 'enemy';
            state.bsLog = r.log || [];
            if (r.status === 'playing') {
                state.bsScreen = 'battle';
                state.gameView = 'battleship';
                startBSPolling();
                render();
            } else if (r.status === 'placing') {
                state.bsScreen = 'waiting';
                state.gameView = 'battleship';
                startBSPolling();
                render();
            } else if (r.status === 'waiting') {
                state.bsScreen = 'lobby';
                bsClearSession();
            }
        }
    } catch (e) {
        bsClearSession();
    }
}

async function loadWeekAndRender() {
    try {
        const r = await apiGet('/api/week', { offset: state.weekOffset });
        state.weekDays = r;
        state.scheduleViewMode = 'week';
        render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function loadTodayAndRender() {
    state.scheduleViewMode = 'today';
    state.weekOffset = 0; state.weekDays = null; state.nextWeekDays = null; state.scheduleDay = 'today';
    await loadSchedule(); render();
}
function actionDayToday() { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; haptic('light'); render(); }
async function actionDayTomorrow() {
    state.scheduleDay = 'tomorrow';
    state.scheduleViewMode = 'today';
    haptic('light');
    if (!state.weekDays) {
        render();
        await ensureWeekLoaded();
    }
    if (!getTomorrowData()) {
        try {
            const r = await apiGet('/api/week', { offset: 1 });
            if (r && r.days && r.days.length) {
                state.nextWeekDays = r;
            }
        } catch (e) {}
    }
    render();
}
async function actionChooseGroup() {
    haptic('light');
    await loadGroups(true);
    if (!state.groups || Object.keys(state.groups).length === 0) { alert('Не удалось загрузить список групп'); return; }
    state.pickerMode = 'institute';
    state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
    render();
}
function actionPickerBack() {
    haptic('light');
    if (state.pickerMode === 'group') { state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = ''; render(); }
    else if (state.pickerMode === 'course') { state.pickerMode = 'institute'; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; render(); }
    else { state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; render(); }
}
function actionPickerChooseInstitute(inst) { haptic('light'); state.pickerInstitute = inst; state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = ''; render(); }
function actionPickerChooseCourse(course) { haptic('light'); state.pickerCourse = parseInt(course, 10); state.pickerMode = 'group'; state.pickerSearch = ''; render(); }
async function actionPickerChooseGroup(groupId, groupName) {
    haptic('success');
    try {
        await apiPost('/api/set-group', { group_id: groupId, group_name: groupName, subgroup: state.profile?.subgroup || 0 });
        if (state.profile) state.profile.group = groupName;
        state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
        await loadProfile(); await loadSchedule(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}

// ============================================================
//                       HANDLERS
// ============================================================

function attachHandlers() {
    document.querySelectorAll('[data-action]').forEach((el) => {
        const a = el.dataset.action;
        if (a === 'bs-fire-cell' || a === 'bs-place-cell') return;

        if (el.classList.contains('modal-backdrop')) {
            el.addEventListener('click', (e) => {
                if (e.target === el) handleAction(el);
            });
        } else {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAction(el);
            });
        }
    });

    document.querySelectorAll('[data-action="bs-fire-cell"], [data-action="bs-place-cell"]').forEach((el) => {
        el.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (state._bsTapLock) return;
            state._bsTapLock = true;
            setTimeout(() => { state._bsTapLock = false; }, 180);
            handleAction(el);
        });
    });

    const notifyCb = document.getElementById('notify-changes');
    if (notifyCb) {
        notifyCb.addEventListener('change', async (e) => {
            const val = e.target.checked;
            try {
                await apiPost('/api/notify-set', { changes: val });
                if (state.profile) state.profile.notify_changes = val;
                haptic('success');
            } catch (err) {
                haptic('error'); alert('Ошибка: ' + err.message); e.target.checked = !val;
            }
        });
    }
    const aiPhotoInput = document.getElementById('ai-photo-input');
    if (aiPhotoInput) {
        aiPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) actionAIPhotoSelected(file);
            e.target.value = '';
        });
    }
    const schAutoCb = document.getElementById('sch-auto-input');
    if (schAutoCb) {
        schAutoCb.addEventListener('change', (e) => {
            state.scholarshipEditorIsAuto = e.target.checked;
            haptic('light');
        });
    }
    const schSubjInput = document.getElementById('sch-subject-input');
    if (schSubjInput) {
        schSubjInput.addEventListener('input', (e) => {
            state.scholarshipEditorSubject = e.target.value;
        });
    }
    const exchInput = document.getElementById('exchange-amount-input');
    if (exchInput) {
        exchInput.addEventListener('input', (e) => {
            let v = parseInt(e.target.value, 10);
            if (isNaN(v) || v < 0) v = 0;
            const soft = state.wallet?.soft || 0;
            if (v > soft) v = soft;
            state.exchangeAmount = v;
            const hardEl = document.querySelector('.exchange-preview-value');
            if (hardEl) {
                const hard = Math.floor(v / EXCHANGE_RATE);
                hardEl.innerHTML = `${hard}<span class="suffix">Автоматов</span>`;
            }
            const submitBtn = document.querySelector('[data-action="exchange-submit"]');
            if (submitBtn) {
                const hard = Math.floor(v / EXCHANGE_RATE);
                if (hard <= 0) submitBtn.setAttribute('disabled', '');
                else submitBtn.removeAttribute('disabled');
            }
        });
    }
    const bsJoinInput = document.getElementById('bs-join-code-input');
    if (bsJoinInput) {
        bsJoinInput.addEventListener('input', (e) => {
            state.bsJoinCode = e.target.value.replace(/\D/g, '').slice(0, 6);
            e.target.value = state.bsJoinCode;
        });
    }
}

function handleAction(el) {
    const a = el.dataset.action;
    const v = el.dataset.value;

    if (a === 'name-open') actionNameOpen();
    else if (a === 'avatar-toggle') actionAvatarToggle();
    else if (a === 'level-info-open') actionLevelInfoOpen();
    else if (a === 'currency-info-open') actionCurrencyInfoOpen();
    else if (a === 'ach-open') actionAchOpen(el.dataset.id);
    else if (a === 'premium-open') actionPremiumOpen();
    else if (a === 'name-save') actionNameSave();
    else if (a === 'chest-open') actionChestOpen();
    else if (a === 'modal-close') actionModalClose();
    else if (a === 'exchange-open') actionExchangeOpen();
    else if (a === 'exchange-quick') actionExchangeQuick(parseFloat(v));
    else if (a === 'exchange-submit') actionExchangeSubmit();
    else if (a === 'game-open') actionGameOpen(el.dataset.game);
    else if (a === 'game-exit') actionGameExit();
    else if (a === 'game-play-again') actionGamePlayAgain();
    else if (a === 'music-toggle') toggleMusicMute();
    else if (a === 'bs-bet') actionBSBet(parseInt(v, 10));
    else if (a === 'bs-play-bot') actionBSPlayBot();
    else if (a === 'bs-create-room') actionBSCreateRoom();
    else if (a === 'bs-join-room') actionBSJoinRoom();
    else if (a === 'bs-join-submit') actionBSJoinSubmit();
    else if (a === 'bs-find-match') actionBSFindMatch();
    else if (a === 'bs-place-cell') actionBSPlaceCell(el);
    else if (a === 'bs-rotate') actionBSRotate();
    else if (a === 'bs-auto-place') actionBSAutoPlace();
    else if (a === 'bs-clear-place') actionBSClearPlace();
    else if (a === 'bs-confirm-place') actionBSConfirmPlace();
    else if (a === 'bs-copy-code') actionBSCopyCode();
    else if (a === 'bs-cancel-room') actionBSCancelRoom();
    else if (a === 'bs-back-lobby') actionBSBackLobby();
    else if (a === 'bs-play-again') actionBSPlayAgain();
    else if (a === 'bs-surrender') actionBSSurrender();
    else if (a === 'bs-fire-cell') actionBSFireCell(el);
    else if (a === 'set-subgroup') actionSetSubgroup(parseInt(v));
    else if (a === 'quote-subscribe') actionQuoteSubscribe(parseInt(v));
    else if (a === 'feedback-send') actionFeedbackSend();
    else if (a === 'fb-toggle') actionFbToggle();
    else if (a === 'lesson-status') actionLessonStatus(el);
    else if (a === 'task-done') actionTaskDone(parseInt(el.dataset.id));
    else if (a === 'task-delete') actionTaskDelete(parseInt(el.dataset.id));
    else if (a === 'task-add-open') actionTaskAddOpen();
    else if (a === 'task-edit-open') actionTaskEditOpen(parseInt(el.dataset.id));
    else if (a === 'task-editor-back') actionTaskEditorBack();
    else if (a === 'task-editor-save') actionTaskEditorSave();
    else if (a === 'task-editor-delete') actionTaskEditorDelete();
    else if (a === 'task-set-priority') actionTaskSetPriority(parseInt(v));
    else if (a === 'task-clear-date') actionTaskClearDate();
    else if (a === 'tasks-clear') actionTasksClear();
    else if (a === 'tasks-show-active') { state.tasksView = 'active'; loadTasks().then(render); }
    else if (a === 'tasks-show-done') { state.tasksView = 'done'; loadTasks().then(render); }
    else if (a === 'note-add-open') actionNoteAddOpen();
    else if (a === 'note-edit-open') actionNoteEditOpen(parseInt(el.dataset.id));
    else if (a === 'note-editor-back') actionNoteEditorBack();
    else if (a === 'note-editor-save') actionNoteEditorSave();
    else if (a === 'note-editor-delete') actionNoteEditorDelete();
    else if (a === 'note-delete') actionNoteDelete(parseInt(el.dataset.id));
    else if (a === 'sch-set-amount-open') actionScholarshipSetAmount();
    else if (a === 'sch-clear') actionScholarshipClear();
    else if (a === 'sch-add-new') actionScholarshipAdd();
    else if (a === 'sch-edit') actionScholarshipEdit(parseInt(el.dataset.id));
    else if (a === 'sch-editor-back') actionScholarshipBack();
    else if (a === 'sch-editor-save') actionScholarshipSave();
    else if (a === 'sch-editor-delete') actionScholarshipDeleteGrade();
    else if (a === 'sch-set-grade') actionScholarshipSetGrade(parseInt(v, 10));
    else if (a === 'sch-pick-subject') actionScholarshipPickSubject(v);
    else if (a === 'sch-filter') actionScholarshipFilter(v);
    else if (a === 'sem-filter') actionSemesterFilter(v);
    else if (a === 'notify-set-before') actionSetNotifyBefore(parseInt(v, 10));
    else if (a === 'export-data') actionExportData();
    else if (a === 'ai-send') actionAISend();
    else if (a === 'ai-clear') actionAIClear();
    else if (a === 'ai-photo-open') actionAIPhotoOpen();
    else if (a === 'ai-photo-cancel') actionAIPhotoCancel();
    else if (a === 'choose-group') actionChooseGroup();
    else if (a === 'forget-group') actionForgetGroup();
    else if (a === 'picker-back') actionPickerBack();
    else if (a === 'picker-choose-institute') actionPickerChooseInstitute(v);
    else if (a === 'picker-choose-course') actionPickerChooseCourse(v);
    else if (a === 'picker-choose-group') actionPickerChooseGroup(el.dataset.id, el.dataset.name);
    else if (a === 'notify-open') actionOpenNotifyEditor();
    else if (a === 'notify-back') actionNotifyBack();
    else if (a === 'notify-set-type') actionNotifySetType(v);
    else if (a === 'notify-save') actionNotifySave();
    else if (a === 'notify-off') actionNotifyOff();
    else if (a === 'go-profile') { state.tab = 'profile'; loadTabData('profile'); }
    else if (a === 'week-prev') { state.weekOffset -= 1; state.nextWeekDays = null; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-next') { state.weekOffset += 1; state.nextWeekDays = null; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-current') { state.weekOffset = 0; state.nextWeekDays = null; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-today') { loadTodayAndRender(); }
    else if (a === 'day-today') actionDayToday();
    else if (a === 'day-tomorrow') actionDayTomorrow();
    else if (a === 'admin-monitor') actionAdminMonitor();
    else if (a === 'admin-broadcast') actionAdminBroadcast();
    else if (a === 'admin-fb-reply') actionAdminFbReply(parseInt(el.dataset.id));
    else if (a === 'admin-fb-postpone') actionAdminFbPostpone(parseInt(el.dataset.id));
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        if (state.tab === tab) return;
        state.tab = tab;
        haptic('light');
        await loadTabData(tab);
    });
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
    haptic('light');
    if (state.tab === 'schedule' && state.scheduleViewMode === 'week') await loadWeekAndRender();
    else await loadTabData(state.tab);
});

(async function init() {
    await loadTabData(state.tab);
})();
