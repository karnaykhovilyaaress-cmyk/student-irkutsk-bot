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
    profile: null, scholarship: null, groups: null,
    scholarshipEditor: false, scholarshipEditorId: null,
    scholarshipEditorSubject: '', scholarshipEditorGrade: 0,
    scholarshipEditorIsAuto: false, scholarshipEditorSemester: '',
    scholarshipAvailable: [], scholarshipFilter: 'all', scholarshipSemesterFilter: 'all',
    pickerMode: null, pickerInstitute: null, pickerCourse: null, pickerSearch: '',
    notifyEditor: false, notifyEditorType: 'today', notifyEditorHour: 8, notifyEditorMinute: 0,
    aiMessages: [], aiPending: false, aiPendingPhoto: null, aiHistoryLoaded: false,
    adminStats: null, adminFeedback: [], adminMonitor: null, adminBusy: false,
    gameView: null, gameInfo: null, gameResult: null, gameInstance: null,
    myFeedback: [], myFeedbackLoaded: false, myFeedbackExpanded: false,
    exportPending: false,
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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (month >= 8) return `Осень ${year}`;
    if (month === 0) return `Осень ${year - 1}`;
    return `Весна ${year}`;
}

function render() {
    const content = document.getElementById('content');
    const title = document.getElementById('page-title');
    const appEl = document.getElementById('app');
    const navEl = document.getElementById('bottom-nav');

    const titles = { schedule: 'Расписание', tasks: 'Задачи', notes: 'Заметки', games: 'Игры', ai: 'AI', admin: 'Админ', profile: 'Профиль' };

    if (state.gameView === 'playing') {
        appEl?.classList.add('picker-open');
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderGameScreen();
        attachHandlers();
        requestAnimationFrame(() => initGame());
        return;
    }
    if (state.gameView === 'result') {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = 'Результат';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderGameResult();
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

    content.innerHTML = html;
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        const isAdmin = btn.dataset.tab === 'admin';
        btn.style.display = (isAdmin && !state.isAdmin) ? 'none' : '';
        btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
    attachHandlers();
    if (state.tab === 'schedule') attachScheduleSwipe();
}

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
    const initials = ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() || '?';
    const name = u.first_name || 'Гость';
    const metaParts = [];
    if (p?.group) metaParts.push(p.group + (p.subgroup ? ` · ${p.subgroup}` : ''));
    if (u.username) metaParts.push('@' + u.username);
    const meta = metaParts.join(' · ') || 'профиль не заполнен';
    const tasks = p?.tasks_active ?? 0;
    return `
        <div class="user-bar" data-action="go-profile">
            <div class="user-bar-avatar">${escapeHtml(initials)}</div>
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
    const attCls = att || '';

    return `
        <div class="lesson">
            <div class="lesson-time">${escapeHtml(timeRange)}</div>
            <div class="lesson-body">
                <div class="lesson-subject">${escapeHtml(les.subject)}${les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''}</div>
                ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
            </div>
            <button class="lesson-status ${attCls}"
                    data-action="lesson-status"
                    data-date="${escapeHtml(les.date || '')}"
                    data-time="${escapeHtml(les.time || '')}"
                    data-subject="${escapeHtml(les.subject || '')}"
                    data-status="${att}"
                    title="Отметить посещаемость">${attLabel}</button>
        </div>
    `;
}

function renderDaySwitch() {
    return `
        <div class="day-switch">
            <button data-action="day-today" class="${state.scheduleDay === 'today' ? 'active' : ''}">Сегодня</button>
            <button data-action="day-tomorrow" class="${state.scheduleDay === 'tomorrow' ? 'active' : ''}">Завтра</button>
        </div>
    `;
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
    try {
        const r = await apiGet('/api/week', { offset: 0 });
        state.weekDays = r;
        return true;
    } catch (e) { return false; }
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
    let html = `<div class="picker-header">
        <button class="picker-back" data-action="picker-back">←</button>
        <div class="picker-title">Выбери институт</div>
    </div>`;
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
    html += `</div>`;
    return html;
}
function renderCoursePicker() {
    const inst = state.pickerInstitute;
    const courses = getCoursesForInstitute(inst);
    let html = `<div class="picker-header">
        <button class="picker-back" data-action="picker-back">←</button>
        <div class="picker-title">${escapeHtml(inst)} · Курс</div>
    </div>`;
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
    html += `</div>`;
    return html;
}
function renderGroupPicker() {
    const inst = state.pickerInstitute;
    const course = state.pickerCourse;
    const allGroups = (state.groups && state.groups[inst]) || [];
    const groups = allGroups.filter(g => getCourseFromGroup(g.name) === course);
    let html = `<div class="picker-header">
        <button class="picker-back" data-action="picker-back">←</button>
        <div class="picker-title">${escapeHtml(inst)} · ${course} курс</div>
    </div>
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
    html += `</div>`;
    return html;
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
    return `
        <div class="picker-header">
            <button class="picker-back" data-action="notify-back">←</button>
            <div class="picker-title">Уведомления</div>
        </div>
        <div class="card">
            <div class="card-title">Когда напоминать</div>
            <div class="tab-buttons" style="margin-bottom:12px">
                <button data-action="notify-set-type" data-value="today" class="${cur === 'today' ? 'active' : ''}">Сегодня</button>
                <button data-action="notify-set-type" data-value="tomorrow" class="${cur === 'tomorrow' ? 'active' : ''}">Завтра</button>
            </div>
            <div class="card-subtitle">
                ${cur === 'today' ? 'Расписание на сегодня. Время — до 10:00.' : 'Расписание на завтра. Время — любое.'}
            </div>
        </div>
        <div class="card">
            <div class="card-title">Во сколько</div>
            <div class="card-subtitle">Время по Иркутску</div>
            <input type="time" id="notify-time-input" class="input" value="${timeVal}">
        </div>
        <div class="actions-row" style="margin-top:16px">
            <button class="btn" data-action="notify-save" style="flex:1">Сохранить</button>
            <button class="btn btn-secondary" data-action="notify-off" style="flex:1">Выключить</button>
        </div>
    `;
}

function actionOpenNotifyEditor() {
    haptic('light');
    const p = state.profile;
    state.notifyEditorType = p?.notify_type || 'today';
    state.notifyEditorHour = p?.notify_hour >= 0 ? p.notify_hour : 8;
    state.notifyEditorMinute = p?.notify_minute || 0;
    state.notifyEditor = true;
    render();
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
        await loadProfile();
        render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionNotifyOff() {
    haptic('success');
    try {
        await apiPost('/api/notify-set', { type: null });
        state.notifyEditor = false;
        await loadProfile();
        render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function actionSetNotifyBefore(minutes) {
    haptic('light');
    try {
        await apiPost('/api/notify-set-before', { minutes });
        if (state.profile) state.profile.notify_before_min = minutes;
        haptic('success');
        render();
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

    apiPost('/api/attendance-set', { date, time, subject, status: next })
        .catch(() => { haptic('error'); });
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
    if (state.weekDays?.days) {
        for (const d of state.weekDays.days) {
            if (d.date === date) upd(d.lessons);
        }
    }
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
        if (state.tasksView === 'active') {
            html += `<div class="banner"><div class="banner-title">Задач нет</div><div class="banner-sub">Нажми «+ Добавить задачу» — укажи текст, срок и приоритет.</div></div>`;
        } else html += renderEmpty('Нет выполненных задач');
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
    if (state.tasksView === 'done' && tasks.length > 0) {
        html += `<button class="btn btn-secondary" data-action="tasks-clear" style="width:100%;margin-top:8px">Очистить выполненные</button>`;
    }
    return html;
}

function renderTaskEditor() {
    const isEdit = state.taskEditorId !== null;
    const p = state.taskEditorPriority;
    const dueIso = state.taskEditorDate;
    return `
        <div class="editor-header">
            <button class="picker-back" data-action="task-editor-back">←</button>
            <div class="picker-title">${isEdit ? 'Изменить задачу' : 'Новая задача'}</div>
        </div>
        <div class="card">
            <div class="card-title">Текст задачи</div>
            <textarea class="input" id="task-text-input" placeholder="Что нужно сделать?" rows="4">${escapeHtml(state.taskEditorText || '')}</textarea>
        </div>
        <div class="card">
            <div class="card-title">Срок</div>
            <div class="card-subtitle">Дата</div>
            <input type="date" id="task-date-input" class="input" value="${escapeHtml(dueIso)}">
            <div class="card-subtitle" style="margin-top:8px">Время (необязательно)</div>
            <input type="time" id="task-time-input" class="input" value="${escapeHtml(state.taskEditorTime || '')}">
            <div class="actions-row" style="margin-top:8px">
                <button class="btn btn-secondary" data-action="task-clear-date" style="flex:1">Очистить срок</button>
            </div>
        </div>
        <div class="card">
            <div class="card-title">Приоритет</div>
            <div class="task-priority-picker">
                <button class="task-priority-btn p-low ${p === 1 ? 'active' : ''}" data-action="task-set-priority" data-value="1">Низкий</button>
                <button class="task-priority-btn p-medium ${p === 2 ? 'active' : ''}" data-action="task-set-priority" data-value="2">Средний</button>
                <button class="task-priority-btn p-high ${p === 3 ? 'active' : ''}" data-action="task-set-priority" data-value="3">Высокий</button>
            </div>
        </div>
        <div class="actions-row" style="margin-top:16px">
            <button class="btn" data-action="task-editor-save" style="flex:1">${isEdit ? 'Сохранить' : 'Добавить'}</button>
            ${isEdit ? `<button class="btn btn-secondary" data-action="task-editor-delete" style="flex:1">Удалить</button>` : ''}
        </div>
    `;
}
function actionTaskAddOpen() {
    haptic('light');
    state.taskEditor = true; state.taskEditorId = null;
    state.taskEditorText = ''; state.taskEditorDate = ''; state.taskEditorTime = '';
    state.taskEditorPriority = 2;
    render();
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
        await loadTasks(); render();
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

function renderNotes() {
    let html = `<button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">+ Добавить заметку</button>`;
    if (!state.notes || state.notes.length === 0) {
        html += `<div class="banner"><div class="banner-title">Заметки</div><div class="banner-sub">Короткие записи по предметам. Название предмета — ключ.</div></div>`;
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
    return `
        <div class="editor-header">
            <button class="picker-back" data-action="note-editor-back">←</button>
            <div class="picker-title">${isEdit ? 'Изменить заметку' : 'Новая заметка'}</div>
        </div>
        <div class="card">
            <div class="card-title">Предмет</div>
            <input class="input" id="note-subject-input" placeholder="Название предмета" value="${escapeHtml(state.noteEditorSubject || '')}" autocomplete="off">
        </div>
        <div class="card">
            <div class="card-title">Текст заметки</div>
            <textarea class="input note-textarea" id="note-text-input" placeholder="Что записать?" rows="8">${escapeHtml(state.noteEditorText || '')}</textarea>
        </div>
        <div class="actions-row" style="margin-top:16px">
            <button class="btn" data-action="note-editor-save" style="flex:1">${isEdit ? 'Сохранить' : 'Добавить'}</button>
            ${isEdit ? `<button class="btn btn-secondary" data-action="note-editor-delete" style="flex:1">Удалить</button>` : ''}
        </div>
    `;
}
function actionNoteAddOpen() {
    haptic('light');
    state.noteEditor = true; state.noteEditorId = null;
    state.noteEditorSubject = ''; state.noteEditorText = '';
    render();
}
function actionNoteEditOpen(id) {
    haptic('light');
    const n = state.notes.find(x => x.id === id);
    if (!n) return;
    state.noteEditor = true; state.noteEditorId = n.id;
    state.noteEditorSubject = n.subject || '';
    state.noteEditorText = n.text || '';
    render();
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
        await apiPost('/api/note-save', { subject, text });
        haptic('success');
        state.noteEditor = false; state.noteEditorId = null;
        await loadNotes(); render();
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

function renderGames() {
    const info = state.gameInfo;
    const best = info?.best ?? 0;
    const plays = info?.plays ?? 0;

    let html = `<div class="games-grid">`;

    html += `<div class="game-tile" data-action="game-open">
        <div class="game-tile-header">
            <div class="game-tile-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"></circle>
                    <path d="M8 12l3 3 5-6"></path>
                </svg>
            </div>
            <div style="flex:1;min-width:0">
                <div class="game-tile-title">До пары успеть</div>
                <div class="game-tile-tagline">Flappy-стиль · реакция</div>
            </div>
        </div>
        <div class="game-tile-desc">
            Пролетай между парами, не задень стены. Тапни — прыжок. Чем дальше — тем больше очков.
        </div>
        <div class="game-tile-stats">
            <div class="game-tile-stat"><div class="game-tile-stat-value">${best}</div><div class="game-tile-stat-label">Рекорд</div></div>
            <div class="game-tile-stat"><div class="game-tile-stat-value">${plays}</div><div class="game-tile-stat-label">Игр</div></div>
        </div>
        <div class="game-tile-play">Играть</div>
    </div>`;

    html += `<div class="game-tile" style="cursor:default;pointer-events:none;opacity:0.6;">
        <div class="game-tile-header">
            <div class="game-tile-icon" style="background:var(--bg-3);color:var(--text-2);box-shadow:none;">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </div>
            <div style="flex:1;min-width:0">
                <div class="game-tile-title">Скоро</div>
                <div class="game-tile-tagline">Новые игры в разработке</div>
            </div>
        </div>
        <div class="game-tile-desc">Здесь появятся новые игры. Следи за обновлениями.</div>
    </div>`;

    html += `</div>`;

    if (state.gameInfo?.top && state.gameInfo.top.length > 0) {
        html += `<div class="card" style="margin-top:12px"><div class="card-title">Топ игроков</div>`;
        for (const item of state.gameInfo.top) {
            const cls = item.is_me ? 'game-top-me' : '';
            const name = item.display || `Игрок #${String(item.user_id).slice(-4)}`;
            html += `<div class="grade-row ${cls}"><span>${item.rank}. ${escapeHtml(name)}</span><span class="grade-value">${item.score}</span></div>`;
        }
        html += `</div>`;
    }
    return html;
}

function renderGameScreen() {
    const best = state.gameInfo?.best ?? 0;
    return `
        <div class="game-wrap" id="game-wrap">
            <div class="game-hud">
                <div class="game-hud-score" id="game-score">0</div>
                <div class="game-hud-best">Рекорд: ${best}</div>
            </div>
            <canvas id="game-canvas" class="game-canvas"></canvas>
            <div class="game-hint" id="game-hint">Тапни, чтобы начать</div>
            <button class="game-exit" data-action="game-exit" title="Выйти">✕</button>
        </div>
    `;
}

function renderGameResult() {
    const r = state.gameResult;
    if (!r) return renderEmpty('Нет данных');
    let html = `<div class="game-result-wrap">
        <div class="game-result-score-block">
            <div class="game-result-label">Очки</div>
            <div class="game-result-score">${r.score}</div>
            ${r.is_record ? '<div class="game-result-record">НОВЫЙ РЕКОРД</div>' : ''}
        </div>
        <div class="game-result-best">Рекорд: ${r.best}</div>
    `;
    if (r.top && r.top.length > 0) {
        html += `<div class="card"><div class="card-title">Топ игроков</div>`;
        for (const item of r.top) {
            const cls = item.is_me ? 'game-top-me' : '';
            const name = item.display || `Игрок #${String(item.user_id).slice(-4)}`;
            html += `<div class="grade-row ${cls}"><span>${item.rank}. ${escapeHtml(name)}</span><span class="grade-value">${item.score}</span></div>`;
        }
        html += `</div>`;
    }
    html += `<div class="actions-row" style="margin-top:16px">
        <button class="btn" data-action="game-play-again" style="flex:1">Ещё раз</button>
        <button class="btn btn-secondary" data-action="game-exit" style="flex:1">В меню</button>
    </div>
    </div>`;
    return html;
}
function actionGameOpen() {
    haptic('light');
    state.gameView = 'playing'; state.gameResult = null; state.gameInstance = null;
    render();
}
function actionGameExit() {
    haptic('light');
    if (state.gameInstance) state.gameInstance.running = false;
    state.gameInstance = null; state.gameView = null; state.gameResult = null;
    render();
}
function actionGamePlayAgain() {
    haptic('light');
    state.gameView = 'playing'; state.gameResult = null; state.gameInstance = null;
    render();
}
async function submitGameScore(score) {
    try {
        const r = await apiPost('/api/game/submit', { score });
        state.gameResult = { score, best: r.best, is_record: r.is_record, top: r.top || [] };
        state.gameInfo = { best: r.best, plays: r.plays, top: r.top || [] };
    } catch (e) {
        state.gameResult = { score, best: score, is_record: false, top: [] };
    }
    state.gameInstance = null;
    state.gameView = 'result';
    render();
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
function drawBlock(ctx, x, y, w, h) {
    if (h <= 0 || w <= 0) return;
    ctx.save();
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, 'rgba(30, 136, 229, 0.35)');
    grad.addColorStop(0.5, 'rgba(0, 229, 208, 0.35)');
    grad.addColorStop(1, 'rgba(30, 136, 229, 0.35)');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#00E5D0'; ctx.lineWidth = 2;
    ctx.shadowColor = '#00E5D0'; ctx.shadowBlur = 12;
    roundRect(ctx, x, y, w, h, 10); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 229, 208, 0.85)';
    ctx.font = 'bold 11px Manrope, -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cx = x + w / 2;
    for (let ty = y + 34; ty < y + h - 16; ty += 44) ctx.fillText('ПАРА', cx, ty);
    ctx.restore();
}
function drawObstacle(ctx, o, H) {
    drawBlock(ctx, o.x, 0, o.w, o.gapY);
    drawBlock(ctx, o.x, o.gapY + o.gapH, o.w, H - o.gapY - o.gapH);
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 208, 0.55)';
    ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(o.x - 4, o.gapY); ctx.lineTo(o.x + o.w + 4, o.gapY);
    ctx.moveTo(o.x - 4, o.gapY + o.gapH); ctx.lineTo(o.x + o.w + 4, o.gapY + o.gapH);
    ctx.stroke(); ctx.restore();
}
function drawPlayer(ctx, p) {
    ctx.save();
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
    glow.addColorStop(0, 'rgba(0, 229, 208, 0.7)');
    glow.addColorStop(1, 'rgba(0, 229, 208, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00E5D0'; ctx.shadowColor = '#00E5D0'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#070B14';
    ctx.beginPath();
    ctx.arc(p.x + 5, p.y - 4, 3, 0, Math.PI * 2);
    ctx.arc(p.x + 12, p.y - 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(p.x - 4, p.y - 6, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}
function drawGame(ctx, game) {
    const W = game.W, H = game.H, frame = game.frame;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#08101f'); grad.addColorStop(0.55, '#0d1a33'); grad.addColorStop(1, '#111c3a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.fillStyle = 'rgba(180, 220, 255, 0.5)';
    for (let i = 0; i < 30; i++) {
        const sx = (((i * 173 - frame * 0.4) % (W + 40)) + (W + 40)) % (W + 40) - 20;
        const sy = (i * 97) % H;
        const sz = (i % 3) + 1;
        ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 208, 0.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
    ctx.restore();
    for (const o of game.obstacles) drawObstacle(ctx, o, H);
    drawPlayer(ctx, game.player);
}
function initGame() {
    if (state.gameInstance) return;
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(100, rect.width);
    const H = Math.max(100, rect.height);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const game = {
        W, H, running: true, over: false, started: false, score: 0, frame: 0,
        player: { x: W * 0.28, y: H * 0.45, r: 16, vy: 0 },
        obstacles: [], spawnTimer: 0, spawnInterval: 95,
        gravity: 0.55, jumpForce: -8.3, speed: 3.1,
        gap: Math.max(130, Math.min(170, H * 0.32)),
    };
    state.gameInstance = game;
    function doJump() {
        if (game.over || !game.running) return;
        game.started = true;
        const hint = document.getElementById('game-hint');
        if (hint) hint.style.display = 'none';
        game.player.vy = game.jumpForce;
    }
    function onPointer(e) { e.preventDefault(); doJump(); }
    function onKey(e) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
            e.preventDefault(); doJump();
        }
    }
    canvas.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    function cleanup() {
        canvas.removeEventListener('pointerdown', onPointer);
        document.removeEventListener('keydown', onKey);
    }
    function gameEnd() {
        if (game.over) return;
        game.over = true; game.running = false;
        cleanup();
        haptic('error');
        submitGameScore(game.score);
    }
    function loop() {
        if (state.gameInstance !== game || !game.running) return;
        if (game.started) {
            game.player.vy += game.gravity;
            if (game.player.vy > 11) game.player.vy = 11;
            game.player.y += game.player.vy;
        }
        if (game.player.y - game.player.r < 0) { game.player.y = game.player.r; game.player.vy = 0; }
        if (game.player.y + game.player.r > H) { game.player.y = H - game.player.r; gameEnd(); return; }
        game.spawnTimer++;
        if (game.started && game.spawnTimer >= game.spawnInterval) {
            game.spawnTimer = 0;
            const minGapY = 40;
            const maxGapY = H - game.gap - 40;
            const gapY = Math.random() * Math.max(1, maxGapY - minGapY) + minGapY;
            game.obstacles.push({ x: W + 40, w: 62, gapY, gapH: game.gap, passed: false });
        }
        for (let i = game.obstacles.length - 1; i >= 0; i--) {
            const o = game.obstacles[i];
            if (game.started) o.x -= game.speed;
            const px = game.player.x, py = game.player.y, pr = game.player.r;
            if (px + pr > o.x && px - pr < o.x + o.w) {
                if (py - pr < o.gapY || py + pr > o.gapY + o.gapH) { gameEnd(); return; }
            }
            if (!o.passed && o.x + o.w < px) {
                o.passed = true; game.score++;
                haptic('light');
                const scoreEl = document.getElementById('game-score');
                if (scoreEl) scoreEl.textContent = String(game.score);
            }
            if (o.x + o.w < -60) game.obstacles.splice(i, 1);
        }
        drawGame(ctx, game);
        game.frame++;
        requestAnimationFrame(loop);
    }
    drawGame(ctx, game);
    requestAnimationFrame(loop);
}

function renderAI() {
    let html = '';
    if (state.aiMessages.length === 0) {
        html += `<div class="banner"><div class="banner-title">AI Помощник</div><div class="banner-sub">Задай вопрос по учёбе или прикрепи фото и напиши, что с ним сделать.</div></div>`;
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
        ? `<div class="ai-photo-preview">
              <img src="${state.aiPendingPhoto}" alt="фото">
              <button class="ai-photo-remove" data-action="ai-photo-cancel" title="Убрать">✕</button>
           </div>`
        : '';
    html += `<div style="margin-top:12px">
        ${photoPreview}
        <textarea class="input" id="ai-input" placeholder="Напиши вопрос или что сделать с фото..." rows="3" ${state.aiPending ? 'disabled' : ''}></textarea>
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
            haptic('success');
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
        haptic('success');
    } catch (e) {
        state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + e.message });
        haptic('error');
    } finally { state.aiPending = false; render(); }
}

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
        <div class="card-subtitle">Уйдёт всем пользователям бота.</div>
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

function renderProfile() {
    const p = state.profile;
    const u = state.user;
    const initials = ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() || '?';
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Гость';
    const metaParts = [];
    if (p?.group) metaParts.push(p.group + (p.subgroup ? ` (подгр. ${p.subgroup})` : ''));
    if (u.username) metaParts.push('@' + u.username);

    let html = `<div class="profile-header">
        <div class="profile-avatar">${escapeHtml(initials)}</div>
        <div class="profile-name">${escapeHtml(fullName)}</div>
        ${metaParts.length ? `<div class="profile-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
        ${p?.is_admin ? '<div class="badge" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff">ADMIN</div>' : ''}
    </div>`;

    if (p) {
        html += `<div class="card">
            <div class="card-title">Статистика</div>
            <div class="card-subtitle">Активных задач: ${p.tasks_active ?? 0}</div>
            <div class="card-subtitle">Выполнено: ${p.tasks_done ?? 0}</div>
            <div class="card-subtitle">Заметок: ${p.notes_count ?? 0}</div>
            <div class="card-subtitle">Оценок: ${p.grades_count ?? 0}</div>
        </div>`;

        const attTotal = p.attendance_total || 0;
        html += `<div class="card">
            <div class="card-title">Посещаемость</div>`;
        if (attTotal === 0) {
            html += `<div class="card-subtitle">Отмечай пары в расписании — здесь появится статистика.</div>`;
        } else {
            html += `<div class="att-stat-row"><span class="att-stat-label">Всего отмечено</span><span class="att-stat-value">${attTotal}</span></div>`;
            html += `<div class="att-stat-row"><span class="att-stat-label">Посещено</span><span class="att-stat-value green">${p.attendance_was || 0}</span></div>`;
            html += `<div class="att-stat-row"><span class="att-stat-label">Пропущено</span><span class="att-stat-value red">${p.attendance_missed || 0}</span></div>`;
            html += `<div class="att-stat-row"><span class="att-stat-label">По болезни</span><span class="att-stat-value yellow">${p.attendance_sick || 0}</span></div>`;
        }
        html += `</div>`;
    }

    html += `<div class="card">
        <div class="card-title">Мой ID</div>
        <div class="card-subtitle">${escapeHtml(String(u.id || '—'))}</div>
        <div class="actions-row"><button class="btn btn-secondary" data-action="copy-my-id">Скопировать ID</button></div>
    </div>`;

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
        <div class="actions-row">
            <button class="btn" data-action="notify-open">${notifyOn ? 'Изменить' : 'Включить'}</button>
        </div>
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
        <div class="export-hint">PDF-файл со всеми данными: задачи, заметки, оценки, посещаемость. Бот пришлёт его в чат.</div>
        <button class="btn btn-secondary" data-action="export-data" style="width:100%" ${state.exportPending ? 'disabled' : ''}>${state.exportPending ? 'Готовлю PDF...' : 'Скачать PDF'}</button>
    </div>`;

    return html;
}

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
    if (total > previewLimit && !showAll) {
        html += `<button class="fb-show-more" data-action="fb-toggle">Показать все (${total})</button>`;
    } else if (showAll && total > previewLimit) {
        html += `<button class="fb-show-more" data-action="fb-toggle">Свернуть</button>`;
    }
    html += `</div>`;
    return html;
}
function actionFbToggle() {
    haptic('light');
    state.myFeedbackExpanded = !state.myFeedbackExpanded;
    render();
}

function renderScholarshipCard() {
    const s = state.scholarship;
    let html = `<div class="card"><div class="card-title">Стипендия</div>`;
    if (!s) { html += `<div class="card-subtitle">Загрузка...</div></div>`; return html; }
    html += `<div class="card-subtitle">Текущая сумма: ${s.amount !== null && s.amount !== undefined ? escapeHtml(s.amount) + ' ₽/мес' : 'не указана'}</div>`;

    const semesters = s.semesters || [];
    if (semesters.length > 0) {
        html += `<div class="sem-selector">
            <button class="sem-chip ${state.scholarshipSemesterFilter === 'all' ? 'active' : ''}" data-action="sem-filter" data-value="all">Все</button>
            ${semesters.map(sem => `
                <button class="sem-chip ${state.scholarshipSemesterFilter === sem ? 'active' : ''}" data-action="sem-filter" data-value="${escapeHtml(sem)}">${escapeHtml(sem)}</button>
            `).join('')}
        </div>`;
    }
    const allGrades = s.grades || [];
    const grades = state.scholarshipSemesterFilter === 'all'
        ? allGrades
        : allGrades.filter(g => (g.semester || '') === state.scholarshipSemesterFilter);

    if (allGrades.length === 0) {
        html += `<div class="sch-empty">Оценок пока нет. Добавь первую — увидишь средний балл и прогноз по стипендии.</div>`;
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
    </div>`;
    html += `</div>`;
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
    let html = `
        <div class="picker-header">
            <button class="picker-back" data-action="sch-editor-back">←</button>
            <div class="picker-title">${isEdit ? 'Изменить оценку' : 'Новая оценка'}</div>
        </div>
        <div class="card">
            <div class="card-title">Предмет</div>
            <input class="input" id="sch-subject-input" list="sch-subjects-list"
                   placeholder="Название предмета" value="${escapeHtml(subject)}"
                   autocomplete="off" autocapitalize="sentences">
            <datalist id="sch-subjects-list">
                ${state.scholarshipAvailable.map(s => `<option value="${escapeHtml(s)}"></option>`).join('')}
            </datalist>
    `;
    if (state.scholarshipAvailable.length > 0) {
        const preview = state.scholarshipAvailable.slice(0, 12);
        html += `<div class="sch-hint">Из твоего расписания:</div>
            <div class="sch-subject-chips">
                ${preview.map(s => `<button class="sch-subject-chip" data-action="sch-pick-subject" data-value="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
            </div>`;
    }
    html += `</div>`;
    html += `<div class="card">
        <div class="card-title">Семестр</div>
        <input class="input" id="sch-semester-input" placeholder="Например: Осень 2026" value="${escapeHtml(semester)}">
    </div>`;
    html += `<div class="card">
        <div class="card-title">Оценка</div>
        <div class="sch-grade-picker">
            ${[2, 3, 4, 5].map(g => `
                <button class="sch-grade-btn grade-${g} ${grade === g ? 'active' : ''}"
                        data-action="sch-set-grade" data-value="${g}">${g}</button>
            `).join('')}
        </div>
        <label class="sch-auto-toggle">
            <input type="checkbox" id="sch-auto-input" ${isAuto ? 'checked' : ''}>
            <span>Автомат — оценка выставлена без экзамена</span>
        </label>
    </div>`;
    html += `<div class="actions-row" style="margin-top:16px">
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
        await loadScholarship(); render();
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
    const msg = sem ? `Очистить оценки за «${sem}»?` : 'Очистить ВСЕ оценки (за все семестры)?';
    if (!confirm(msg)) return;
    try {
        await apiPost('/api/scholarship-clear', { semester: sem });
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

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
    } catch (e) { state.profile = { error: e.message }; }
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
async function loadGameInfo() {
    try { state.gameInfo = await apiGet('/api/game/info'); }
    catch (e) { state.gameInfo = { best: 0, plays: 0, top: [] }; }
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
    try {
        const r = await apiGet('/api/feedback/my');
        state.myFeedback = r.items || [];
        state.myFeedbackLoaded = true;
    } catch (e) { state.myFeedback = []; state.myFeedbackLoaded = true; }
}

async function loadTabData(tab) {
    state.loading = true;
    state.error = null;
    state.notifyEditor = false;
    state.taskEditor = false;
    state.noteEditor = false;
    state.gameView = null;
    state.gameInstance = null;
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
        else if (tab === 'games') { await loadProfile(); await loadGameInfo(); }
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
            await Promise.all([loadProfile(), loadScholarship(), loadMyFeedback()]);
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
    await loadSchedule();
    render();
}
async function actionDayToday() { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; haptic('light'); render(); }
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
function actionPickerChooseInstitute(inst) {
    haptic('light');
    state.pickerInstitute = inst; state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = '';
    render();
}
function actionPickerChooseCourse(course) {
    haptic('light');
    state.pickerCourse = parseInt(course, 10); state.pickerMode = 'group'; state.pickerSearch = '';
    render();
}
async function actionPickerChooseGroup(groupId, groupName) {
    haptic('success');
    try {
        await apiPost('/api/set-group', { group_id: groupId, group_name: groupName, subgroup: state.profile?.subgroup || 0 });
        if (state.profile) state.profile.group = groupName;
        state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
        await loadProfile(); await loadSchedule(); render();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}

async function actionSetSubgroup(value) {
    try { await apiPost('/api/set-subgroup', { subgroup: value }); if (state.profile) state.profile.subgroup = value; haptic('success'); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionQuoteSubscribe(value) {
    try { await apiPost('/api/quote-subscribe', { subscribe: value === 1 }); if (state.profile) state.profile.daily_subscribed = value === 1; haptic('success'); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
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
async function actionTaskDone(id) {
    try { await apiPost('/api/task-update', { id, done: true }); haptic('success'); popEmoji('✅'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
function popEmoji(char) {
    const el = document.createElement('div');
    el.textContent = char;
    el.style.cssText = 'position:fixed;top:50%;left:50%;font-size:56px;transform:translate(-50%,-50%);animation:pop 0.6s ease-out;z-index:99999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
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
async function actionNoteDelete(id) {
    if (!confirm('Удалить заметку?')) return;
    try { await apiPost('/api/note-delete', { id }); haptic('success'); await loadNotes(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionExportData() {
    if (state.exportPending) return;
    state.exportPending = true;
    render();
    haptic('light');
    try {
        await apiPost('/api/export');
        haptic('success');
        alert('PDF отправлен в чат с ботом');
    } catch (e) {
        haptic('error');
        alert('Ошибка: ' + e.message);
    } finally {
        state.exportPending = false;
        render();
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
function actionCopyMyId() {
    const id = String(state.user?.id || '');
    if (!id) return;
    try { navigator.clipboard.writeText(id); haptic('success'); alert('ID скопирован: ' + id); }
    catch (e) { alert('Твой ID: ' + id); }
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

function attachHandlers() {
    document.querySelectorAll('[data-action]').forEach((el) => {
        el.addEventListener('click', () => handleAction(el));
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

    if (a === 'set-subgroup') actionSetSubgroup(parseInt(v));
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
    else if (a === 'game-open') actionGameOpen();
    else if (a === 'game-exit') actionGameExit();
    else if (a === 'game-play-again') actionGamePlayAgain();
    else if (a === 'ai-send') actionAISend();
    else if (a === 'ai-clear') actionAIClear();
    else if (a === 'ai-photo-open') actionAIPhotoOpen();
    else if (a === 'ai-photo-cancel') actionAIPhotoCancel();
    else if (a === 'choose-group') actionChooseGroup();
    else if (a === 'forget-group') actionForgetGroup();
    else if (a === 'copy-my-id') actionCopyMyId();
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
