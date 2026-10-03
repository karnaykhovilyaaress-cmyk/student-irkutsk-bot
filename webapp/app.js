const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

try { if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen(); } catch (e) {}
try { if (typeof tg.lockOrientation === 'function') tg.lockOrientation('portrait'); } catch (e) {}
try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch (e) {}

const tgUser = tg.initDataUnsafe?.user || { first_name: 'Гость', last_name: '', username: '', id: 0 };
const INIT_DATA = tg.initData || '';

setTimeout(() => {
    const sp = document.getElementById('splash');
    const app = document.getElementById('app');
    if (sp) sp.classList.add('hide');
    if (app) app.style.display = '';
    setTimeout(() => { if (sp) sp.remove(); }, 600);
}, 1200);

const state = {
    tab: 'schedule', loading: false, error: null, user: tgUser, isAdmin: false,
    schedule: null, weekDays: null, weekOffset: 0, scheduleViewMode: 'today', scheduleDay: 'today',
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
};

async function apiGet(path, params = {}) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('initData', INIT_DATA);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString());
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${r.status}`);
    }
    return await r.json();
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

// ============================================================
//          SVG / ИКОНКИ
// ============================================================

function studentAvatarSvg() {
    return `<img src="assets/student.webp" alt="Студент" class="profile-avatar-img"
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
        <path d="M55 145 Q75 132 100 132 Q125 132 145 145" stroke="#00E5D0" stroke-width="1.2" fill="none" opacity="0.55"/>
        <rect x="85" y="115" width="30" height="28" fill="url(#fbSkin)"/>
        <ellipse cx="100" cy="88" rx="42" ry="50" fill="url(#fbSkin)"/>
        <path d="M58 62 Q60 30 100 24 Q140 30 142 62 Q138 48 128 42 Q100 34 72 42 Q62 48 58 62 Z" fill="#3a2418"/>
        <path d="M60 78 Q70 74 82 76" stroke="#0a0808" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M140 78 Q130 74 118 76" stroke="#0a0808" stroke-width="3" fill="none" stroke-linecap="round"/>
        <ellipse cx="82" cy="88" rx="9" ry="6" fill="#0a0d16"/>
        <ellipse cx="118" cy="88" rx="9" ry="6" fill="#0a0d16"/>
        <circle cx="82" cy="88" r="14" fill="url(#fbEye)"/>
        <circle cx="118" cy="88" r="14" fill="url(#fbEye)"/>
        <circle cx="82" cy="88" r="3" fill="#fff"/>
        <circle cx="118" cy="88" r="3" fill="#fff"/>
        <path d="M100 92 Q104 106 98 112 Q101 114 106 112" stroke="#a87a58" stroke-width="1.6" fill="none"/>
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
function gameCoverSvg(gameId) {
    return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="gcf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0E1424"/><stop offset="100%" stop-color="#1E88E5"/>
        </linearGradient></defs>
        <rect width="120" height="120" fill="url(#gcf)"/>
        <rect x="76" y="20" width="16" height="34" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
        <rect x="76" y="66" width="16" height="34" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
        <rect x="30" y="20" width="16" height="26" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
        <rect x="30" y="58" width="16" height="42" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
        <circle cx="55" cy="60" r="9" fill="#00E5D0"/>
        <circle cx="58" cy="57" r="2" fill="#070B14"/>
    </svg>`;
}

// ============================================================
//                        RENDER
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
    else if (state.newAchToast) modalHtml = renderNewAchToast();

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
//                         ПРОФИЛЬ
// ============================================================

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
    const xpIn = w?.xp_in_level || 0;
    const xpNext = w?.xp_to_next || 500;
    const xpPct = Math.min(100, Math.round((xpIn / xpNext) * 100));

    html += `<div class="profile-hero">
        <div class="profile-name-hero">
            <span class="profile-name-main">${escapeHtml(displayName)}</span>
            <button class="profile-edit-btn" data-action="name-open" title="Изменить имя">✏️</button>
        </div>
        <div class="profile-tag-id">${escapeHtml(playerTag)}</div>
        <div class="profile-avatar-wrap">${studentAvatarSvg()}</div>
        <div class="profile-level-block" data-action="level-info-open">
            <div class="profile-level-num">${lvl}<small>LVL</small></div>
            <div class="profile-level-title">${escapeHtml(w?.level_title || 'Первокурсник')}</div>
            <div class="profile-level-hint">Как получать XP?</div>
        </div>
        <div class="xp-bar-wrap">
            <div class="xp-bar"><div class="xp-fill" style="width:${xpPct}%"></div></div>
            <div class="xp-text">${xpIn} / ${xpNext} XP</div>
        </div>
        <div class="currency-row">
            <div class="currency-card soft">
                <div class="currency-icon">${softIconSvg()}</div>
                <div class="currency-value">${w?.soft || 0}</div>
                <div class="currency-label">Стипух</div>
            </div>
            <div class="currency-card hard">
                <div class="currency-icon">${hardIconSvg()}</div>
                <div class="currency-value">${w?.hard || 0}</div>
                <div class="currency-label">Автоматов</div>
            </div>
        </div>
        <div class="streak-row"><span class="fire">🔥</span> Стрик: ${p.streak || 0} ${p.streak === 1 ? 'день' : 'дн.'}</div>
    </div>`;

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
function actionAchOpen(achId) { haptic('light'); state.achModal = achId; render(); }
function actionModalClose() {
    haptic('light');
    state.nameEditor = false;
    state.chestModal = null;
    state.achModal = null;
    state.levelInfoModal = false;
    state.premiumModal = null;
    state.newAchToast = null;
    render();
}

// ============================================================
//                        ИГРЫ — СПИСОК
// ============================================================

function renderGames() {
    const games = state.gamesList || [];
    if (games.length === 0) return renderLoading();

    let html = `<div class="banner">
        <div class="banner-title">Зарабатывай Стипухи и Автоматы</div>
        <div class="banner-sub">Играй → получай валюту → меняй на ники и премиум-сундуки</div>
    </div>`;

    html += `<div class="games-catalog">`;
    for (const g of games) {
        html += `<button class="game-catalog-card" data-action="game-open" data-game="${escapeHtml(g.id)}">
            <div class="game-cover">${gameCoverSvg(g.id)}</div>
            <div class="game-body">
                <div>
                    <div class="game-name">${escapeHtml(g.name)}</div>
                    <div class="game-desc">${escapeHtml(g.desc)}</div>
                </div>
                <div class="game-best-line">
                    <span>Рекорд: <strong>${g.best || 0}</strong></span>
                    <span>Игр: <strong>${g.plays || 0}</strong></span>
                </div>
                <div class="game-play-btn">Играть</div>
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
//   СТАРТОВЫЙ ЭКРАН + ОБУЧЕНИЕ + САМ ЭКРАН ИГРЫ
// ============================================================

const GAME_META = {
    flappy: {
        icon: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="fsi" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#00E5D0"/><stop offset="100%" stop-color="#1E88E5"/>
            </linearGradient></defs>
            <circle cx="60" cy="60" r="52" fill="none" stroke="url(#fsi)" stroke-width="3" opacity="0.4"/>
            <rect x="78" y="20" width="14" height="30" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
            <rect x="78" y="72" width="14" height="28" rx="4" fill="#0E1424" stroke="#00E5D0" stroke-width="2"/>
            <circle cx="45" cy="60" r="10" fill="#00E5D0">
                <animate attributeName="r" values="10;12;10" dur="1.4s" repeatCount="indefinite"/>
            </circle>
            <circle cx="48" cy="56" r="2" fill="#070B14"/>
        </svg>`,
        title: 'До пары<br>успеть',
        tagline: 'Пролетай между столбцами расписания,<br>не задень границы',
        tutorialIcon: '👆',
        tutorialTitle: 'Как играть',
        tutorialText: 'Тапай по экрану — студент <strong>прыгает</strong>. Пролетай между парами и набирай очки. Заденешь столбец — конец.',
        tutorialHint: 'Тапни, чтобы начать',
    },
};

function renderGameStartOverlay(gid) {
    const meta = GAME_META[gid] || GAME_META.flappy;
    const g = state.gamesList.find(x => x.id === gid);
    const best = g?.best || 0;
    return `<div class="game-start-overlay" id="game-start-overlay">
        <div class="game-start-icon">${meta.icon}</div>
        <div class="game-start-title">${meta.title}</div>
        <div class="game-start-tagline">${meta.tagline}</div>
        <div class="game-start-best">🏆 Рекорд: <strong>${best}</strong></div>
        <button class="game-start-btn" id="game-start-btn">Играть</button>
        <div class="game-start-hint">Как играть — покажем дальше</div>
    </div>`;
}

function renderGameTutorialOverlay(gid) {
    const meta = GAME_META[gid] || GAME_META.flappy;
    return `<div class="tutorial-overlay hide" id="game-tutorial-overlay">
        <div class="tutorial-arrow">${meta.tutorialIcon}</div>
        <div class="tutorial-title">${meta.tutorialTitle}</div>
        <div class="tutorial-text">${meta.tutorialText}</div>
        <div class="tutorial-tap-hint">${meta.tutorialHint}</div>
    </div>`;
}

function renderGameScreen() {
    const gid = state.currentGame;
    const g = state.gamesList.find(x => x.id === gid);
    const best = g?.best || 0;

    return `<div class="game-wrap" id="game-wrap">
        <div class="game-hud">
            <div class="game-hud-score" id="game-score">0</div>
            <div class="game-hud-best">Рекорд: ${best}</div>
        </div>
        <canvas id="game-canvas" class="game-canvas"></canvas>
        ${renderGameStartOverlay(gid)}
        ${renderGameTutorialOverlay(gid)}
        <button class="game-exit" data-action="game-exit" title="Выйти">✕</button>
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
    state.currentGame = gameId;
    state.gameView = 'playing';
    state.gamePhase = 'start';
    state.gameResult = null;
    state.gameInstance = null;
    render();
}
function actionGameExit() {
    haptic('light');
    if (state.gameInstance) state.gameInstance.running = false;
    state.gameInstance = null;
    state.gameView = null;
    state.gameResult = null;
    state.currentGame = null;
    state.gamePhase = 'start';
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

// Утилита: показать обучение → старт игры
function showTutorialThenStart(startFn) {
    const startOv = document.getElementById('game-start-overlay');
    const tutOv = document.getElementById('game-tutorial-overlay');
    let tutorialDone = false;

    function onAnyTap(e) {
        if (e.target && e.target.id === 'game-start-btn') return;
        if (!tutorialDone) {
            tutorialDone = true;
            if (startOv) startOv.classList.add('hide');
            if (tutOv) tutOv.classList.remove('hide');
            haptic('light');
            return;
        }
        if (tutOv) tutOv.classList.add('hide');
        document.removeEventListener('pointerdown', onAnyTap);
        startFn();
    }

    const startBtn = document.getElementById('game-start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!tutorialDone) {
                tutorialDone = true;
                if (startOv) startOv.classList.add('hide');
                if (tutOv) tutOv.classList.remove('hide');
                haptic('light');
                return;
            }
            if (tutOv) tutOv.classList.add('hide');
            document.removeEventListener('pointerdown', onAnyTap);
            startFn();
        });
    }

    document.addEventListener('pointerdown', onAnyTap);
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter') {
            onAnyTap({ target: { id: '' } });
        }
    });
}

// ============================================================
//         ИГРА: ДО ПАРЫ УСПЕТЬ (оптимизированная + сложнее)
// ============================================================

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

    const GROUND_H = 40;

    // ============ PRE-RENDER: небо + звёзды + дальний город ============
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = Math.floor(W * dpr);
    bgCanvas.height = Math.floor(H * dpr);
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.scale(dpr, dpr);
    {
        const sky = bgCtx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#060d1c');
        sky.addColorStop(0.5, '#0b1730');
        sky.addColorStop(1, '#14203f');
        bgCtx.fillStyle = sky;
        bgCtx.fillRect(0, 0, W, H);

        for (let i = 0; i < 30; i++) {
            const sx = (i * 197) % W;
            const sy = (i * 71) % (H * 0.5);
            const alpha = 0.20 + ((i * 13) % 5) * 0.10;
            bgCtx.fillStyle = `rgba(180,220,255,${alpha})`;
            bgCtx.fillRect(sx, sy, 1.5, 1.5);
        }

        bgCtx.fillStyle = '#0a1526';
        for (let i = 0; i <= Math.ceil(W / 80); i++) {
            const bx = i * 80;
            const bh = 60 + ((i * 37) % 5) * 12;
            bgCtx.fillRect(bx, H - 80 - bh, 60, bh);
        }
    }

    // ============ PRE-RENDER: ближний город (скроллящийся тайл) ============
    const TILE_W = 100;
    const nearTile = document.createElement('canvas');
    nearTile.width = Math.floor(TILE_W * dpr);
    nearTile.height = Math.floor(H * dpr);
    const nearCtx = nearTile.getContext('2d');
    nearCtx.scale(dpr, dpr);
    {
        const baseY = H - GROUND_H - 80;
        nearCtx.fillStyle = '#05090f';
        nearCtx.fillRect(0, baseY, 74, 80);
        nearCtx.fillStyle = 'rgba(0,229,208,0.28)';
        for (let wy = baseY + 12; wy < H - GROUND_H - 8; wy += 14) {
            for (let wx = 8; wx < 68; wx += 14) {
                if ((wx + wy) % 3 === 0) nearCtx.fillRect(wx, wy, 5, 7);
            }
        }
    }

    // ============ PRE-RENDER: земля ============
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = Math.floor(W * dpr);
    groundCanvas.height = Math.floor(GROUND_H * dpr);
    const groundCtx = groundCanvas.getContext('2d');
    groundCtx.scale(dpr, dpr);
    {
        const g = groundCtx.createLinearGradient(0, 0, 0, GROUND_H);
        g.addColorStop(0, '#0a1226');
        g.addColorStop(1, '#03060d');
        groundCtx.fillStyle = g;
        groundCtx.fillRect(0, 0, W, GROUND_H);
        groundCtx.strokeStyle = 'rgba(0,229,208,0.8)';
        groundCtx.lineWidth = 2;
        groundCtx.beginPath();
        groundCtx.moveTo(0, 1);
        groundCtx.lineTo(W, 1);
        groundCtx.stroke();
    }

    // ============ STATE (сложнее чем было) ============
    const initialGap = Math.max(170, Math.min(220, H * 0.32));
    const minGap = Math.max(130, Math.min(165, H * 0.24));

    const game = {
        W, H, GROUND_H,
        running: true, over: false, started: false,
        score: 0, frame: 0,
        player: { x: W * 0.28, y: H * 0.5, r: 14, vy: 0 },
        obstacles: [],
        spawnTimer: 0,
        spawnInterval: 105,
        minSpawnInterval: 60,
        gravity: 0.58,
        jumpForce: -8.2,
        maxFallSpeed: 10.5,
        speed: 3.0,
        maxSpeed: 7.0,
        gap: initialGap,
        minGap: minGap,
        lastFrameTime: 0,
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
        submitGameScore('flappy', game.score);
    }

    // ============ DRAW (быстрые операции) ============
    function drawNearCity() {
        const offset = (game.frame * game.speed * 0.5) % TILE_W;
        const tiles = Math.ceil(W / TILE_W) + 1;
        for (let i = 0; i < tiles; i++) {
            ctx.drawImage(nearTile, 0, 0, nearTile.width, nearTile.height,
                          i * TILE_W - offset, 0, TILE_W, H);
        }
    }

    function drawGround() {
        ctx.drawImage(groundCanvas, 0, 0, groundCanvas.width, groundCanvas.height,
                      0, H - GROUND_H, W, GROUND_H);
        const offset = (game.frame * game.speed * 0.8) % 20;
        ctx.fillStyle = 'rgba(0,229,208,0.22)';
        for (let x = -offset; x < W; x += 20) {
            ctx.fillRect(x, H - GROUND_H + 8, 10, 2);
        }
    }

    function drawBlock(x, y, w, h) {
        if (h <= 0 || w <= 0) return;
        ctx.fillStyle = 'rgba(0, 180, 170, 0.85)';
        roundRect(ctx, x, y, w, h, 10);
        ctx.fill();
        ctx.strokeStyle = '#00E5D0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let ly = y + 24; ly < y + h - 6; ly += 30) {
            ctx.moveTo(x + 5, ly);
            ctx.lineTo(x + w - 5, ly);
        }
        ctx.stroke();
    }

    function drawPlayer() {
        const p = game.player;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + p.r + 6, p.r * 1.05, p.r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,229,208,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#070B14';
        ctx.strokeStyle = '#00E5D0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#00E5D0';
        ctx.beginPath();
        ctx.arc(p.x + 4, p.y - 4, 3, 0, Math.PI * 2);
        ctx.arc(p.x + 10, p.y - 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#00E5D0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x + 6, p.y + 2, 4, 0.1 * Math.PI, 0.9 * Math.PI);
        ctx.stroke();
    }

    function draw() {
        ctx.drawImage(bgCanvas, 0, 0, bgCanvas.width, bgCanvas.height, 0, 0, W, H);
        drawNearCity();
        for (let i = 0; i < game.obstacles.length; i++) {
            const o = game.obstacles[i];
            drawBlock(o.x, 0, o.w, o.gapY);
            drawBlock(o.x, o.gapY + o.gapH, o.w, H - GROUND_H - o.gapY - o.gapH);
        }
        drawGround();
        drawPlayer();
    }

    function updateDifficulty() {
        const s = game.score;
        game.speed = Math.min(game.maxSpeed, 3.0 + Math.floor(s / 8) * 0.22);
        game.spawnInterval = Math.max(game.minSpawnInterval, 105 - Math.floor(s / 4) * 2);
        game.gap = Math.max(game.minGap, initialGap - Math.floor(s / 6) * 3);
    }

    function loop(timestamp) {
        if (state.gameInstance !== game || !game.running) return;
        requestAnimationFrame(loop);

        // Кап 60 FPS (скип на 120Hz-экранах)
        if (game.lastFrameTime && timestamp - game.lastFrameTime < 15) return;
        game.lastFrameTime = timestamp;

        if (game.started) {
            game.player.vy += game.gravity;
            if (game.player.vy > game.maxFallSpeed) game.player.vy = game.maxFallSpeed;
            game.player.y += game.player.vy;
        }
        if (game.player.y - game.player.r < 0) {
            game.player.y = game.player.r;
            game.player.vy = 0;
        }
        if (game.player.y + game.player.r > H - GROUND_H) {
            game.player.y = H - GROUND_H - game.player.r;
            endGame();
            return;
        }

        game.spawnTimer++;
        if (game.started && game.spawnTimer >= game.spawnInterval) {
            game.spawnTimer = 0;
            const minGapY = 55;
            const maxGapY = H - GROUND_H - game.gap - 55;
            const gapY = Math.random() * Math.max(1, maxGapY - minGapY) + minGapY;
            game.obstacles.push({ x: W + 30, w: 58, gapY, gapH: game.gap, passed: false });
        }

        const px = game.player.x, py = game.player.y, pr = game.player.r;
        for (let i = game.obstacles.length - 1; i >= 0; i--) {
            const o = game.obstacles[i];
            if (game.started) o.x -= game.speed;
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

// ============================================================
//                 УТИЛИТЫ CANVAS / API ИГР
// ============================================================

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
//                     РАСПИСАНИЕ
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
    return `
        <div class="user-bar" data-action="go-profile">
            <div class="user-bar-avatar">
                <img src="assets/student.webp" alt="" onerror="this.outerHTML='${escapeHtml(firstLetter)}'">
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
function getTomorrowData() {
    const wd = state.weekDays;
    if (!wd || !wd.days || wd.days.length === 0) return null;
    const today = new Date();
    const jsDay = today.getDay();
    const todayIdx = jsDay === 0 ? 6 : jsDay - 1;
    const tomorrowIdx = (todayIdx + 1) % 7;
    if (wd.days.length >= 7) return wd.days[tomorrowIdx] || null;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const yyyy = tomorrow.getFullYear();
    const tomorrowStr = `${dd}.${mm}.${yyyy}`;
    for (const d of wd.days) if (d.date === tomorrowStr) return d;
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
//         ПИКЕРЫ ГРУПП / УВЕДОМЛЕНИЯ / ЗАДАЧИ / ЗАМЕТКИ
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
}

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
    if (!confirm('Удалить задачу?')) return;
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
    if (!confirm('Удалить задачу?')) return;
    try { await apiPost('/api/task-delete', { id }); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionTasksClear() {
    if (!confirm('Очистить все выполненные?')) return;
    try { await apiPost('/api/task-clear'); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
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
    if (!confirm('Удалить заметку?')) return;
    try {
        await apiPost('/api/note-delete', { id: state.noteEditorId });
        haptic('success');
        state.noteEditor = false; state.noteEditorId = null;
        await loadNotes(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionNoteDelete(id) {
    if (!confirm('Удалить заметку?')) return;
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
function actionAIClear() {
    if (!confirm('Очистить историю чата?')) return;
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
    if (!confirm('Удалить эту оценку?')) return;
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
    if (!confirm(msg)) return;
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
    if (!confirm('Забыть группу?')) return;
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
    if (!confirm('Отправить всем пользователям?')) return;
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
    state.premiumModal = null;
    state.newAchToast = null;
    render();
    try {
        if (tab === 'schedule') {
            state.scheduleViewMode = 'today';
            state.weekOffset = 0;
            state.scheduleDay = 'today';
            state.weekDays = null;
            await loadProfile();
            await loadSchedule();
            ensureWeekLoaded().catch(() => {});
        } else if (tab === 'tasks') await loadTasks();
        else if (tab === 'notes') await loadNotes();
        else if (tab === 'games') {
            await loadProfile();
            await loadGames();
            await loadWalletLeaderboard();
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
    state.weekOffset = 0; state.weekDays = null; state.scheduleDay = 'today';
    await loadSchedule(); render();
}
function actionDayToday() { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; haptic('light'); render(); }
async function actionDayTomorrow() {
    state.scheduleDay = 'tomorrow'; state.scheduleViewMode = 'today'; haptic('light');
    if (!state.weekDays) { render(); await ensureWeekLoaded(); }
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
        el.addEventListener('click', (e) => {
            if (el.classList.contains('modal-backdrop') && e.target !== el) return;
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
}

function handleAction(el) {
    const a = el.dataset.action;
    const v = el.dataset.value;

    if (a === 'name-open') actionNameOpen();
    else if (a === 'level-info-open') actionLevelInfoOpen();
    else if (a === 'ach-open') actionAchOpen(el.dataset.id);
    else if (a === 'premium-open') actionPremiumOpen();
    else if (a === 'name-save') actionNameSave();
    else if (a === 'chest-open') actionChestOpen();
    else if (a === 'modal-close') actionModalClose();
    else if (a === 'game-open') actionGameOpen(el.dataset.game);
    else if (a === 'game-exit') actionGameExit();
    else if (a === 'game-play-again') actionGamePlayAgain();
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
    else if (a === 'week-prev') { state.weekOffset -= 1; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-next') { state.weekOffset += 1; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-current') { state.weekOffset = 0; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
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
