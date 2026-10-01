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
    notes: [],
    profile: null, scholarship: null, groups: null,
    pickerMode: null, pickerInstitute: null, pickerCourse: null, pickerSearch: '',
    notifyEditor: false, notifyEditorType: 'today', notifyEditorHour: 8, notifyEditorMinute: 0,
    aiMessages: [], aiPending: false,
    adminStats: null, adminFeedback: [], adminMonitor: null, adminBusy: false,
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
    if (p === 2) return '<span class="priority priority-high">Высокий</span>';
    if (p === 1) return '<span class="priority priority-medium">Средний</span>';
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

function render() {
    const content = document.getElementById('content');
    const title = document.getElementById('page-title');
    const appEl = document.getElementById('app');
    const navEl = document.getElementById('bottom-nav');

    const titles = { schedule: 'Расписание', tasks: 'Задачи', notes: 'Заметки', ai: 'AI', admin: 'Админ', profile: 'Профиль' };

    if (state.notifyEditor) {
        appEl?.classList.add('picker-open');
        if (title) title.textContent = 'Уведомления';
        if (navEl) navEl.style.display = 'none';
        content.innerHTML = renderNotifyEditor();
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
    return `
        <div class="lesson">
            <div class="lesson-time">${escapeHtml(timeRange)}</div>
            <div class="lesson-body">
                <div class="lesson-subject">${escapeHtml(les.subject)}${les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''}</div>
                ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
            </div>
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
    else {
        for (const g of filtered) {
            const selected = state.profile?.group === g.name;
            html += `<button class="picker-item ${selected ? 'selected' : ''}" data-action="picker-choose-group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">
                <div class="picker-group-item"><span>${escapeHtml(g.name)}</span></div>
                ${selected ? '<span class="picker-item-arrow">✓</span>' : '<span class="picker-item-arrow">›</span>'}
            </button>`;
        }
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
        else {
            for (const g of filtered) {
                const selected = state.profile?.group === g.name;
                html += `<button class="picker-item ${selected ? 'selected' : ''}" data-action="picker-choose-group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">
                    <div class="picker-group-item"><span>${escapeHtml(g.name)}</span></div>
                    ${selected ? '<span class="picker-item-arrow">✓</span>' : '<span class="picker-item-arrow">›</span>'}
                </button>`;
            }
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
            html += `<div class="banner"><div class="banner-title">Задач нет</div><div class="banner-sub">Нажми «+ Добавить задачу». Срок: 25.12.2025 или 25.12.2025 14:30. Приоритет: 0 / 1 / 2.</div></div>`;
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

function renderAI() {
    let html = '';
    if (state.aiMessages.length === 0) {
        html += `<div class="banner"><div class="banner-title">AI Помощник</div><div class="banner-sub">Задай вопрос по учёбе или прикрепи фото с задачей — AI разберётся.</div></div>`;
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
    html += `<div style="margin-top:12px">
        <textarea class="input" id="ai-input" placeholder="Напиши вопрос или прикрепи фото..." rows="3" ${state.aiPending ? 'disabled' : ''}></textarea>
        <button class="btn" data-action="ai-send" style="width:100%" ${state.aiPending ? 'disabled' : ''}>Отправить</button>
        <button class="btn btn-secondary" data-action="ai-photo-open" style="width:100%;margin-top:6px" ${state.aiPending ? 'disabled' : ''}>Прикрепить фото</button>
        <button class="btn btn-secondary" data-action="ai-clear" style="width:100%;margin-top:6px">Очистить</button>
        <input type="file" id="ai-photo-input" accept="image/*" style="display:none">
    </div>`;
    return html;
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

    html += `<div class="card"><div class="card-title">Стипендия</div>`;
    if (state.scholarship) {
        const s = state.scholarship;
        html += `<div class="card-subtitle">Текущая: ${s.amount !== null ? escapeHtml(s.amount) + ' ₽/мес' : 'не указана'}</div>`;
        html += `<div class="card-subtitle">Оценок: ${s.grades.length}</div>`;
        if (s.grades.length) html += `<div class="card-subtitle">Средний балл: ${s.avg}</div>`;
        if (s.forecast) html += `<div class="card-subtitle">${escapeHtml(s.forecast)}</div>`;
    }
    if (state.scholarship && state.scholarship.grades.length > 0) {
        for (const g of state.scholarship.grades) {
            html += `<div class="grade-row"><span>${escapeHtml(g.subject)}</span><span class="grade-value">${g.grade}</span></div>`;
        }
    }
    html += `<div class="actions-row">
        <button class="btn btn-secondary" data-action="sch-set-amount-open">Сумма</button>
        <button class="btn btn-secondary" data-action="sch-add-grade-open">Добавить оценку</button>
        <button class="btn btn-secondary" data-action="sch-clear">Очистить</button>
    </div></div>`;

    html += `<div class="card">
        <div class="card-title">Обратная связь</div>
        <textarea class="input" id="feedback-text" placeholder="Сообщение админу..." rows="3"></textarea>
        <button class="btn" data-action="feedback-send">Отправить</button>
    </div>`;
    return html;
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
    try { state.scholarship = await apiGet('/api/scholarship'); }
    catch (e) { state.scholarship = null; }
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

async function loadTabData(tab) {
    state.loading = true;
    state.error = null;
    state.notifyEditor = false;
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
        else if (tab === 'ai') await loadProfile();
        else if (tab === 'admin') {
            await loadProfile();
            if (state.isAdmin) await Promise.all([loadAdminStats(), loadAdminFeedback()]);
        } else if (tab === 'profile') {
            await loadProfile();
            await loadScholarship();
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
    state.weekOffset = 0;
    state.weekDays = null;
    state.scheduleDay = 'today';
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
        await loadProfile();
        await loadSchedule();
        render();
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
    try { await apiPost('/api/feedback', { text }); el.value = ''; haptic('success'); alert('Отправлено'); }
    catch (e) { alert('Ошибка: ' + e.message); }
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
async function actionTaskAdd() {
    const text = prompt('Текст задачи:');
    if (!text) return;
    const due = prompt('Срок (ДД.ММ.ГГГГ или ДД.ММ.ГГГГ ЧЧ:ММ, можно пусто):') || '';
    let due_date = null, due_time = null;
    if (due.trim()) { const parts = due.trim().split(' '); due_date = parts[0]; if (parts[1]) due_time = parts[1]; }
    const priorityStr = prompt('Приоритет (0=низкий, 1=средний, 2=высокий):', '1');
    const priority = parseInt(priorityStr) || 1;
    try { await apiPost('/api/task-add', { text, due_date, due_time, priority }); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionTaskEdit(id) {
    const newText = prompt('Новый текст задачи:');
    if (!newText) return;
    try { await apiPost('/api/task-update', { id, text: newText }); haptic('success'); await loadTasks(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionNoteDelete(id) {
    if (!confirm('Удалить заметку?')) return;
    try { await apiPost('/api/note-delete', { id }); haptic('success'); await loadNotes(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionNoteAdd() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const text = prompt('Текст заметки:');
    if (!text) return;
    try { await apiPost('/api/note-save', { subject, text }); haptic('success'); await loadNotes(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionNoteEdit(id) {
    const text = prompt('Новый текст заметки:');
    if (!text) return;
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    try { await apiPost('/api/note-save', { subject: note.subject, text }); haptic('success'); await loadNotes(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionScholarshipSetAmount() {
    const amount = prompt('Сумма стипендии (₽/мес, 0 если не получаешь):');
    if (amount === null) return;
    try { await apiPost('/api/scholarship-set-amount', { amount: parseInt(amount) || 0 }); haptic('success'); await loadScholarship(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionScholarshipAddGrade() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const gradeStr = prompt('Оценка (2, 3, 4 или 5):');
    const grade = parseInt(gradeStr);
    if (![2, 3, 4, 5].includes(grade)) { alert('Нужно 2, 3, 4 или 5'); return; }
    try { await apiPost('/api/scholarship-add-grade', { subject, grade }); haptic('success'); await loadScholarship(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionScholarshipClear() {
    if (!confirm('Очистить все оценки?')) return;
    try { await apiPost('/api/scholarship-clear'); haptic('success'); await loadScholarship(); render(); }
    catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAISend() {
    const el = document.getElementById('ai-input');
    if (!el) return;
    const question = (el.value || '').trim();
    if (!question) return;
    state.aiMessages.push({ role: 'user', text: question });
    state.aiPending = true;
    el.value = '';
    render();
    try {
        const r = await apiPost('/api/ai', { question });
        state.aiMessages.push({ role: 'assistant', text: r.answer || 'Нет ответа' });
        haptic('success');
    } catch (e) {
        state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + e.message });
        haptic('error');
    } finally { state.aiPending = false; render(); }
}
function actionAIClear() { state.aiMessages = []; render(); }

function actionAIPhotoOpen() {
    haptic('light');
    const input = document.getElementById('ai-photo-input');
    if (input) input.click();
}

function actionAIPhotoSelected(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
        alert('Фото слишком большое (макс 8 МБ)');
        return;
    }
    if (!file.type.startsWith('image/')) {
        alert('Нужно изображение');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const maxSide = 1600;
            let w = img.width;
            let h = img.height;
            if (w > maxSide || h > maxSide) {
                if (w > h) {
                    h = Math.round(h * maxSide / w);
                    w = maxSide;
                } else {
                    w = Math.round(w * maxSide / h);
                    h = maxSide;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            sendAIPhoto(jpegDataUrl);
        };
        img.onerror = () => {
            alert('Не удалось прочитать изображение');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function sendAIPhoto(dataUrl) {
    const questionEl = document.getElementById('ai-input');
    const question = questionEl ? questionEl.value.trim() : '';

    state.aiMessages.push({
        role: 'user',
        text: question || 'Что на фото?',
        photo: dataUrl,
    });
    if (questionEl) questionEl.value = '';
    state.aiPending = true;
    render();

    try {
        const r = await apiPost('/api/ai-photo', {
            photo: dataUrl,
            question: question,
        });
        state.aiMessages.push({ role: 'assistant', text: r.answer || 'Нет ответа' });
        haptic('success');
    } catch (err) {
        state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + err.message });
        haptic('error');
    } finally {
        state.aiPending = false;
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
        await loadAdminFeedback();
        await loadAdminStats();
        render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAdminFbPostpone(fid) {
    try {
        await apiPost('/api/admin/feedback-postpone', { id: fid });
        haptic('success');
        await loadAdminFeedback();
        await loadAdminStats();
        render();
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
                haptic('error');
                alert('Ошибка: ' + err.message);
                e.target.checked = !val;
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
}

function handleAction(el) {
    const a = el.dataset.action;
    if (a === 'set-subgroup') actionSetSubgroup(parseInt(el.dataset.value));
    else if (a === 'quote-subscribe') actionQuoteSubscribe(parseInt(el.dataset.value));
    else if (a === 'feedback-send') actionFeedbackSend();
    else if (a === 'task-done') actionTaskDone(parseInt(el.dataset.id));
    else if (a === 'task-delete') actionTaskDelete(parseInt(el.dataset.id));
    else if (a === 'task-add-open') actionTaskAdd();
    else if (a === 'task-edit-open') actionTaskEdit(parseInt(el.dataset.id));
    else if (a === 'tasks-clear') actionTasksClear();
    else if (a === 'tasks-show-active') { state.tasksView = 'active'; loadTasks().then(render); }
    else if (a === 'tasks-show-done') { state.tasksView = 'done'; loadTasks().then(render); }
    else if (a === 'note-add-open') actionNoteAdd();
    else if (a === 'note-edit-open') actionNoteEdit(parseInt(el.dataset.id));
    else if (a === 'note-delete') actionNoteDelete(parseInt(el.dataset.id));
    else if (a === 'sch-set-amount-open') actionScholarshipSetAmount();
    else if (a === 'sch-add-grade-open') actionScholarshipAddGrade();
    else if (a === 'sch-clear') actionScholarshipClear();
    else if (a === 'ai-send') actionAISend();
    else if (a === 'ai-clear') actionAIClear();
    else if (a === 'ai-photo-open') actionAIPhotoOpen();
    else if (a === 'choose-group') actionChooseGroup();
    else if (a === 'forget-group') actionForgetGroup();
    else if (a === 'copy-my-id') actionCopyMyId();
    else if (a === 'picker-back') actionPickerBack();
    else if (a === 'picker-choose-institute') actionPickerChooseInstitute(el.dataset.value);
    else if (a === 'picker-choose-course') actionPickerChooseCourse(el.dataset.value);
    else if (a === 'picker-choose-group') actionPickerChooseGroup(el.dataset.id, el.dataset.name);
    else if (a === 'notify-open') actionOpenNotifyEditor();
    else if (a === 'notify-back') actionNotifyBack();
    else if (a === 'notify-set-type') actionNotifySetType(el.dataset.value);
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
