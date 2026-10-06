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
    games: null, gamesLoaded: false,
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

function popEmoji(char) {
    const el = document.createElement('div');
    el.textContent = char;
    el.style.cssText = 'position:fixed;top:50%;left:50%;font-size:56px;transform:translate(-50%,-50%);animation:pop 0.6s ease-out;z-index:99999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
}

function render() {
    const content = document.getElementById('content');
    const title = document.getElementById('page-title');
    const appEl = document.getElementById('app');
    const navEl = document.getElementById('bottom-nav');

    const titles = { schedule: 'Расписание', tasks: 'Задачи', notes: 'Заметки', games: 'Игры', ai: 'AI', admin: 'Админ', profile: 'Профиль' };

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

    // Подгрузить кошелёк на профиле
    if (state.tab === 'profile' && !state.loading && !state.pickerMode && !state.notifyEditor) {
        loadWalletIntoProfile();
    }
}

/* ============================================================
   USER BAR
   ============================================================ */
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

/* ============================================================
   SCHEDULE
   ============================================================ */
function renderLesson(les) {
    const timeRange = les.timeEnd ? `${les.time} – ${les.timeEnd}` : les.time;
    const details = [];
    if (les.teacher) details.push(escapeHtml(les.teacher));
    if (les.auditorium) details.push(`ауд. ${escapeHtml(les.auditorium)}`);

    const att = les.attendance || '';
    const date = les.date || '';
    const subj = les.subject || '';
    const time = les.time || '';

    return `
        <div class="lesson">
            <div class="lesson-time">${escapeHtml(timeRange)}</div>
            <div class="lesson-body">
                <div class="lesson-subject">${escapeHtml(les.subject)}${les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''}</div>
                ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
                ${date ? `
                <div class="lesson-att">
                    <button class="lesson-att-btn ${att === 'was' ? 'active-was' : ''}"
                        data-action="att-set" data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}"
                        data-subject="${escapeHtml(subj)}" data-status="was">Был</button>
                    <button class="lesson-att-btn ${att === 'missed' ? 'active-missed' : ''}"
                        data-action="att-set" data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}"
                        data-subject="${escapeHtml(subj)}" data-status="missed">Пропустил</button>
                    <button class="lesson-att-btn ${att === 'sick' ? 'active-sick' : ''}"
                        data-action="att-set" data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}"
                        data-subject="${escapeHtml(subj)}" data-status="sick">Болел</button>
                </div>` : ''}
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

/* ============================================================
   PICKER
   ============================================================ */
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

/* ============================================================
   NOTIFY EDITOR
   ============================================================ */
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

/* ============================================================
   TASKS
   ============================================================ */
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

/* ============================================================
   NOTES
   ============================================================ */
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

/* ============================================================
   GAMES (меню игр)
   ============================================================ */
function renderGames() {
    let html = `<div class="banner">
        <div class="banner-title">Игры STUDENT IRK</div>
        <div class="banner-sub">Flappy, морской бой и другие — зарабатывай Софт и Автоматы</div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">До пары успеть</div>
        <div class="card-subtitle">Flappy-игра. Пролетай между парами, ставь рекорды.</div>
        <div class="actions-row">
            <button class="btn" data-action="open-flappy">ИГРАТЬ</button>
            <button class="btn btn-secondary" data-action="open-flappy-records">РЕКОРДЫ</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Морской бой</div>
        <div class="card-subtitle">PvP с друзьями по коду или игра с ботом. Ставки: 10 / 50 / 100 / 500 Софт.</div>
        <div class="actions-row">
            <button class="btn" data-action="open-bs">ОТКРЫТЬ</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Другие игры</div>
        <div class="card-subtitle">В разработке: сессия-микс, дедлайн-раш, ниндзя-стипуха, охота за автоматом, космо-сессия.</div>
    </div>`;

    return html;
}

/* ============================================================
   AI
   ============================================================ */
function renderAI() {
    let html = '';
    if (state.aiMessages.length === 0) {
        html += `<div class="banner"><div class="banner-title">AI Помощник</div><div class="banner-sub">Задай вопрос по учёбе или прикрепи фото с задачей — AI разберётся.</div></div>`;
    } else {
        for (const m of state.aiMessages) {
            if (m.role === 'user') {
                if (m.photo) {
                    html += `<div class="card" style="background:var(--cyan);color:#0A0E0F;padding:10px">
                        <img src="${m.photo}" style="width:100%;border-radius:12px;display:block;margin-bottom:8px" alt="фото">
                        <div style="font-weight:600">${escapeHtml(m.text || '')}</div>
                    </div>`;
                } else {
                    html += `<div class="card" style="background:var(--cyan);color:#0A0E0F"><div style="font-weight:600">${escapeHtml(m.text)}</div></div>`;
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

/* ============================================================
   ADMIN
   ============================================================ */
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

/* ============================================================
   PROFILE
   ============================================================ */
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
    </div>`;

    // Кошелёк / XP / Уровень — заполняется после рендера
    html += `<div class="card" id="wallet-card">
        <div class="card-title">Уровень и кошелёк</div>
        <div class="card-subtitle" id="wallet-loading">Загрузка...</div>
        <div id="wallet-body" style="display:none"></div>
        <div class="actions-row" style="margin-top:10px">
            <button class="btn btn-secondary" data-action="open-levels">УРОВНИ</button>
            <button class="btn btn-secondary" data-action="open-leaderboard">ТОП</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Сундуки</div>
        <div class="card-subtitle">Обычный — раз в 24 часа. Премиум — 10 Автоматов.</div>
        <div class="actions-row">
            <button class="btn" data-action="chest-open">🎁 ОТКРЫТЬ</button>
            <button class="btn btn-secondary" data-action="premium-chest-open">💎 ПРЕМИУМ</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Обменник</div>
        <div class="card-subtitle">100 Стипух (Софт) = 1 Автомат (Хард)</div>
        <div class="actions-row">
            <button class="btn" data-action="exchange">ОБМЕНЯТЬ</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Достижения</div>
        <div class="card-subtitle">12 достижений за активность</div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="show-achievements">ПОСМОТРЕТЬ</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Профиль</div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="set-name">Сменить ник</button>
            <button class="btn btn-secondary" data-action="set-avatar">Аватар</button>
        </div>
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
        <div class="card-title">Уведомления</div>
        <div class="card-subtitle">Расписание: ${escapeHtml(notifyLabel)}</div>
        <div class="card-subtitle">За N минут до пары: ${p?.notify_before_min ? p.notify_before_min + ' мин' : 'выкл'}</div>
        <div class="actions-row">
            <button class="btn" data-action="notify-open">${notifyOn ? 'Изменить' : 'Включить'}</button>
            <button class="btn btn-secondary" data-action="notify-before">За N минут</button>
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
        <div class="card-title">Экспорт и обращения</div>
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="export-pdf">Скачать PDF</button>
            <button class="btn btn-secondary" data-action="show-my-feedback">Мои обращения</button>
        </div>
    </div>`;

    html += `<div class="card">
        <div class="card-title">Обратная связь</div>
        <textarea class="input" id="feedback-text" placeholder="Сообщение админу..." rows="3"></textarea>
        <button class="btn" data-action="feedback-send">Отправить</button>
    </div>`;

    return html;
}

async function loadWalletIntoProfile() {
    const box = document.getElementById('wallet-body');
    const loading = document.getElementById('wallet-loading');
    if (!box) return;
    try {
        const w = await apiGet('/api/wallet');
        const wallet = w.wallet || {};
        const xp = wallet.xp || 0;
        const lv = calcLevelInfo(xp);
        const total = lv.inLevel + lv.toNext;
        const pct = total ? (lv.inLevel / total) * 100 : 0;
        box.innerHTML = `
            <div style="font-family:'Anton',sans-serif;font-style:italic;font-size:24px;color:var(--text);margin-bottom:6px;">
                ${lv.level} LVL · ${levelTitleByLevel(lv.level)}
            </div>
            <div class="levels-xpbar" style="margin:10px 0;">
                <div class="levels-xpbar-fill" style="width:${pct}%"></div>
                <span class="levels-xpbar-cur">${lv.inLevel}XP</span>
                <span class="levels-xpbar-next">${total}XP</span>
            </div>
            <div style="display:flex;gap:18px;margin-top:12px;font-weight:800;font-size:15px;">
                <div>❄ <span style="color:var(--cyan-dark)">${wallet.soft || 0}</span></div>
                <div>🔥 <span style="color:var(--accent-yellow)">${wallet.hard || 0}</span></div>
            </div>
        `;
        if (loading) loading.style.display = 'none';
        box.style.display = '';
    } catch (e) {
        if (loading) loading.textContent = 'Не удалось загрузить';
    }
}

/* ============================================================
   LOADERS
   ============================================================ */
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
        else if (tab === 'games') await loadProfile();
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

/* ============================================================
   LEVELS HELPER
   ============================================================ */
function calcLevelInfo(xp) {
    let lvl = 1, left = xp || 0;
    while (lvl <= 30) {
        const need = lvl * 500;
        if (left < need) return { level: lvl, inLevel: left, toNext: need - left };
        left -= need; lvl++;
    }
    return { level: 30, inLevel: left, toNext: 500 };
}
function levelTitleByLevel(lvl) {
    if (lvl <= 5)  return 'Первокурсник';
    if (lvl <= 10) return 'Второкурсник';
    if (lvl <= 15) return 'Третьекурсник';
    if (lvl <= 20) return 'Старшекурсник';
    if (lvl <= 25) return 'Магистрант';
    if (lvl <= 29) return 'Аспирант';
    return 'Легенда ИРНИТУ';
}
function levelRewardByLevel(lvl) {
    if (lvl <= 5)  return '+10 🔥';
    if (lvl <= 10) return '+25 🔥';
    if (lvl <= 20) return '+50 🔥';
    return '+100 🔥';
}

async function openLevels() {
    const screen = document.getElementById('screen-levels');
    if (!screen) return;
    screen.style.display = 'block';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('levelsBack').onclick = closeLevels;

    const w = await apiGet('/api/wallet').catch(() => null);
    if (!w) return;
    const wallet = w.wallet || {};
    const xp = wallet.xp || 0;
    const lv = calcLevelInfo(xp);

    document.getElementById('levelsCurrent').textContent = lv.level;
    document.getElementById('levelsLeft').textContent = lv.toNext + 'XP';
    document.getElementById('levelsSoft').textContent = wallet.soft || 0;
    document.getElementById('levelsHard').textContent = wallet.hard || 0;

    const total = lv.inLevel + lv.toNext;
    const pct = total ? (lv.inLevel / total) * 100 : 0;
    document.getElementById('levelsXpFill').style.width = pct + '%';
    document.getElementById('levelsXpCur').textContent = lv.inLevel + 'XP';
    document.getElementById('levelsXpNext').textContent = total + 'XP';

    const list = document.getElementById('levelsList');
    let html = '';
    for (let i = 1; i <= 30; i++) {
        const need = i * 500;
        const cls = i < lv.level ? 'done' : (i === lv.level ? 'current' : 'locked');
        const btn = i < lv.level ? 'ПОЛУЧЕНО' : (i === lv.level ? 'СОБРАТЬ' : 'ЗАКРЫТО');
        html += `
            <div class="levels-row ${cls}">
                <div class="levels-row-left">
                    <div class="levels-row-name">УРОВЕНЬ ${i}</div>
                    <div class="levels-row-sub">от ${need.toLocaleString('ru-RU')}XP · ${levelTitleByLevel(i)}</div>
                    <div class="levels-row-reward">${levelRewardByLevel(i)}</div>
                </div>
                <button class="levels-row-btn" disabled>${btn}</button>
            </div>`;
    }
    list.innerHTML = html;
}
function closeLevels() {
    document.getElementById('screen-levels').style.display = 'none';
    document.getElementById('bottom-nav').style.display = '';
    if (state && state.tab === 'profile') loadTabData('profile');
}

async function openLeaderboard() {
    try {
        const d = await apiGet('/api/wallet/leaderboard');
        const lines = d.items.map(it => `${it.rank}. ${it.display} — ${it.xp} XP`).join('\n');
        alert('ТОП игроков:\n\n' + lines);
    } catch (e) { alert('Ошибка: ' + e.message); }
}

/* ============================================================
   FLAPPY
   ============================================================ */
const Flappy = {
    canvas: null, ctx: null,
    raf: null, running: false,
    score: 0, best: 0, top: [],
    bird: { x: 0, y: 0, vy: 0, r: 14, rot: 0 },
    pipes: [],
    frame: 0,
    gravity: 0.45, jump: -7.5,
    speed: 2.6, gap: 150, pipeW: 62,
    spawnEvery: 88,
    width: 0, height: 0, groundH: 100,
    resizeBound: false,
    lastT: 0,
};

async function openFlappy(recordsOnly) {
    const screen = document.getElementById('screen-flappy');
    if (!screen) return;
    screen.style.display = 'block';
    document.getElementById('bottom-nav').style.display = 'none';
    if (!Flappy.resizeBound) {
        Flappy.resizeBound = true;
        window.addEventListener('resize', flappyResize);
    }
    await flappyInit();
    flappyShowOverlay(recordsOnly ? 'records' : 'start');
}
function closeFlappy() {
    const screen = document.getElementById('screen-flappy');
    if (!screen) return;
    flappyStop();
    screen.style.display = 'none';
    document.getElementById('bottom-nav').style.display = '';
    if (state && state.tab === 'games') loadTabData('games');
}

async function flappyInit() {
    Flappy.canvas = document.getElementById('flappyCanvas');
    Flappy.ctx = Flappy.canvas.getContext('2d');
    flappyResize();

    Flappy.canvas.removeEventListener('pointerdown', flappyPointer);
    Flappy.canvas.addEventListener('pointerdown', flappyPointer);

    document.getElementById('flappyClose').onclick = closeFlappy;
    document.getElementById('flappyStartBtn').onclick = flappyStart;
    document.getElementById('flappyRecordsBtn').onclick = flappyShowRecords;

    try {
        const d = await apiGet('/api/game/info');
        const f = (d.games || []).find(g => g.id === 'flappy');
        Flappy.best = f ? (f.best || 0) : 0;
        document.getElementById('flappyBestTop').textContent = Flappy.best;
        Flappy.top = (d.tops && d.tops.flappy) || [];
    } catch (e) {}
}

function flappyResize() {
    const c = Flappy.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    Flappy.width = window.innerWidth;
    Flappy.height = window.innerHeight;
    c.width = Flappy.width * dpr;
    c.height = Flappy.height * dpr;
    c.style.width = Flappy.width + 'px';
    c.style.height = Flappy.height + 'px';
    Flappy.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Flappy.groundH = Math.max(80, Flappy.height * 0.14);
    flappyReset();
}

function flappyReset() {
    Flappy.bird.x = Flappy.width * 0.3;
    Flappy.bird.y = Flappy.height * 0.45;
    Flappy.bird.vy = 0;
    Flappy.bird.rot = 0;
    Flappy.pipes = [];
    Flappy.frame = 0;
    Flappy.score = 0;
    const el = document.getElementById('flappyScore');
    if (el) el.textContent = '0';
}

function flappyStart() {
    flappyReset();
    flappyHideOverlay();
    Flappy.running = true;
    Flappy.lastT = performance.now();
    Flappy.raf = requestAnimationFrame(flappyLoop);
}

function flappyStop() {
    Flappy.running = false;
    if (Flappy.raf) cancelAnimationFrame(Flappy.raf);
    Flappy.raf = null;
}

function flappyPointer(e) {
    if (e) e.preventDefault();
    if (!Flappy.running) return;
    Flappy.bird.vy = Flappy.jump;
}

function flappyLoop(t) {
    if (!Flappy.running) return;
    const dt = Math.min(32, t - Flappy.lastT) / 16.67;
    Flappy.lastT = t;
    flappyUpdate(dt);
    flappyDraw();
    Flappy.raf = requestAnimationFrame(flappyLoop);
}

function flappyUpdate(dt) {
    const b = Flappy.bird;
    b.vy += Flappy.gravity * dt;
    b.y += b.vy * dt;
    b.rot = Math.max(-0.5, Math.min(0.7, b.vy / 12));

    if (b.y - b.r < 0) { b.y = b.r; b.vy = 0; }
    if (b.y + b.r > Flappy.height - Flappy.groundH) { flappyGameOver(); return; }

    Flappy.frame += dt;
    if (Flappy.frame >= Flappy.spawnEvery) {
        Flappy.frame = 0;
        const topMin = 60;
        const topMax = Flappy.height - Flappy.groundH - Flappy.gap - 60;
        const topH = topMin + Math.random() * Math.max(20, topMax - topMin);
        Flappy.pipes.push({ x: Flappy.width + 10, top: topH, gap: Flappy.gap, passed: false });
    }

    for (const p of Flappy.pipes) p.x -= Flappy.speed * dt;
    Flappy.pipes = Flappy.pipes.filter(p => p.x + Flappy.pipeW > -20);

    for (const p of Flappy.pipes) {
        if (b.x + b.r > p.x && b.x - b.r < p.x + Flappy.pipeW) {
            if (b.y - b.r < p.top) { flappyGameOver(); return; }
            if (b.y + b.r > p.top + p.gap) { flappyGameOver(); return; }
        }
        if (!p.passed && p.x + Flappy.pipeW < b.x - b.r) {
            p.passed = true;
            Flappy.score++;
            const sc = document.getElementById('flappyScore');
            if (sc) sc.textContent = Flappy.score;
            haptic('light');
        }
    }
}

function flappyDraw() {
    const ctx = Flappy.ctx;
    const W = Flappy.width;
    const H = Flappy.height;
    const GH = Flappy.groundH;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#B8F4FF');
    sky.addColorStop(0.6, '#7FE9FF');
    sky.addColorStop(1, '#3EE6D2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const bw = 70;
    for (let i = 0; i < 6; i++) {
        ctx.fillRect(i * (bw + 40) + 10, H * 0.15, bw, 6);
        ctx.fillRect(i * (bw + 40) + 10, H * 0.25, bw, 6);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold ' + Math.round(W * 0.12) + 'px Anton, sans-serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.35;
    ctx.fillText('STUDENT', W / 2, H * 0.28);
    ctx.fillText('IRK', W / 2, H * 0.38);
    ctx.globalAlpha = 1;

    for (const p of Flappy.pipes) {
        flappyDrawPipe(p.x, 0, Flappy.pipeW, p.top, true);
        flappyDrawPipe(p.x, p.top + p.gap, Flappy.pipeW, H - GH - p.top - p.gap, false);
    }

    ctx.fillStyle = '#0A0E0F';
    ctx.fillRect(0, H - GH, W, GH);
    ctx.fillStyle = '#1FB8A6';
    ctx.fillRect(0, H - GH, W, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < W; i += 40) ctx.fillRect(i, H - GH + 20, 20, 4);

    const b = Flappy.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);

    const g = ctx.createRadialGradient(0, -4, 2, 0, 0, b.r + 6);
    g.addColorStop(0, '#7FE9FF');
    g.addColorStop(1, '#1FB8A6');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3EE6D2';
    ctx.beginPath();
    ctx.moveTo(-b.r, 0);
    ctx.lineTo(-b.r - 14, -6);
    ctx.lineTo(-b.r - 10, 0);
    ctx.lineTo(-b.r - 14, 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0A0E0F';
    ctx.beginPath();
    ctx.arc(4, -3, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFA42B';
    ctx.beginPath();
    ctx.moveTo(b.r - 2, -2);
    ctx.lineTo(b.r + 8, 2);
    ctx.lineTo(b.r - 2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function flappyDrawPipe(x, y, w, h, isTop) {
    const ctx = Flappy.ctx;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#1FB8A6');
    grad.addColorStop(0.5, '#3EE6D2');
    grad.addColorStop(1, '#1FB8A6');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = '#0E6A63';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    const capH = 18;
    const capY = isTop ? y + h - capH : y;
    ctx.fillStyle = '#0E6A63';
    ctx.fillRect(x - 4, capY, w + 8, capH);
    ctx.strokeStyle = '#0A0E0F';
    ctx.strokeRect(x - 4, capY, w + 8, capH);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 6, y, 6, h);
}

function flappyGameOver() {
    flappyStop();
    haptic('error');
    const score = Flappy.score;

    if (score > 0) {
        apiPost('/api/game/submit', { game_id: 'flappy', score })
            .then(r => {
                Flappy.best = r.best || Math.max(Flappy.best, score);
                document.getElementById('flappyBestTop').textContent = Flappy.best;
                Flappy.top = r.top || Flappy.top;
                if (r.is_record) popEmoji('🏆');
            })
            .catch(() => {});
    }
    flappyShowOverlay('gameover', score);
}

function flappyShowOverlay(mode, score) {
    const overlay = document.getElementById('flappyOverlay');
    const title = document.getElementById('flappyTitle');
    const sub = document.getElementById('flappySub');
    const scoreEl = document.getElementById('flappyOverlayScore');
    const startBtn = document.getElementById('flappyStartBtn');
    const recordsBtn = document.getElementById('flappyRecordsBtn');
    const old = overlay.querySelector('.flappy-records');
    if (old) old.remove();

    overlay.classList.remove('hidden');

    if (mode === 'start') {
        title.textContent = 'ДО ПАРЫ УСПЕТЬ';
        sub.textContent = 'Пролетай между парами, не задень границы';
        scoreEl.innerHTML = '';
        startBtn.textContent = 'ИГРАТЬ';
        startBtn.onclick = flappyStart;
        recordsBtn.style.display = '';
    } else if (mode === 'gameover') {
        title.textContent = 'ИГРА ОКОНЧЕНА';
        const isRecord = score >= Flappy.best && score > 0;
        sub.textContent = isRecord ? '🏆 Новый рекорд!' : 'Попробуй ещё раз';
        scoreEl.innerHTML = `Очки: <b>${score}</b> · Рекорд: <b>${Flappy.best}</b>`;
        startBtn.textContent = 'ЕЩЁ РАЗ';
        startBtn.onclick = flappyStart;
        recordsBtn.style.display = '';
    } else if (mode === 'records') {
        title.textContent = 'РЕКОРДЫ';
        sub.textContent = 'Топ игроков';
        scoreEl.innerHTML = '';
        startBtn.textContent = 'ИГРАТЬ';
        startBtn.onclick = flappyStart;
        recordsBtn.style.display = 'none';

        const list = document.createElement('div');
        list.className = 'flappy-records';
        const top = Flappy.top || [];
        if (!top.length) {
            list.innerHTML = '<div class="flappy-records-row">Пока нет рекордов</div>';
        } else {
            list.innerHTML = top.map(t => `
                <div class="flappy-records-row ${t.is_me ? 'is-me' : ''}">
                    <span class="flappy-records-rank">${t.rank}</span>
                    <span class="flappy-records-name">${escapeHtml(t.display)}</span>
                    <span class="flappy-records-score">${t.score}</span>
                </div>`).join('');
        }
        overlay.querySelector('.flappy-card').appendChild(list);
    }
}

function flappyHideOverlay() {
    document.getElementById('flappyOverlay').classList.add('hidden');
}
function flappyShowRecords() { flappyShowOverlay('records'); }

/* ============================================================
   МОРСКОЙ БОЙ
   ============================================================ */
const BS = {
    bet: 10,
    gameId: null,
    side: 0,
    myShips: [],
    myShots: [],
    enemyShots: [],
    status: 'lobby',
    isBot: false,
    pollTimer: null,
    botShips: [],
    botShots: [],
};

const BS_SHIPS = [
    { size: 4, count: 1 }, { size: 3, count: 2 }, { size: 2, count: 3 }, { size: 1, count: 4 }
];

function openBs() {
    const screen = document.getElementById('screen-bs');
    if (!screen) return;
    screen.style.display = 'block';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('bsBack').onclick = closeBs;
    bsRenderBets();
    document.getElementById('bsCreate').onclick = bsCreate;
    document.getElementById('bsFind').onclick = bsFind;
    document.getElementById('bsBot').onclick = bsBotStart;
    document.getElementById('bsJoin').onclick = bsJoin;
    document.getElementById('bsRandom').onclick = bsRandomShips;
    document.getElementById('bsReady').onclick = bsReady;
    document.getElementById('bsSurrender').onclick = bsSurrender;
    bsShowLobby();
}
function closeBs() {
    if (BS.pollTimer) clearInterval(BS.pollTimer);
    BS.pollTimer = null;
    BS.gameId = null;
    document.getElementById('screen-bs').style.display = 'none';
    document.getElementById('bottom-nav').style.display = '';
    if (state && state.tab === 'games') loadTabData('games');
}
function bsRenderBets() {
    const box = document.getElementById('bsBets');
    box.innerHTML = '';
    [10, 50, 100, 500].forEach(v => {
        const b = document.createElement('button');
        b.className = 'bs-bet' + (v === BS.bet ? ' active' : '');
        b.textContent = v;
        b.onclick = () => { BS.bet = v; bsRenderBets(); };
        box.appendChild(b);
    });
}
function bsShowLobby() {
    document.getElementById('bsLobby').style.display = '';
    document.getElementById('bsBoardWrap').style.display = 'none';
    BS.status = 'lobby';
    BS.isBot = false;
    BS.myShips = [];
    BS.myShots = [];
    BS.enemyShots = [];
}
function bsShowBoard() {
    document.getElementById('bsLobby').style.display = 'none';
    document.getElementById('bsBoardWrap').style.display = '';
}
async function bsCreate() {
    try {
        const r = await apiPost('/api/bs/create', { bet: BS.bet });
        BS.gameId = r.game_id;
        BS.side = 1;
        haptic('success');
        alert(`Игра создана. Код: ${r.code}\nСкинь другу`);
        bsShowBoard();
        bsRandomShips();
        bsPollStart();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function bsJoin() {
    const code = document.getElementById('bsCode').value.trim();
    if (code.length !== 6) { alert('Код — 6 цифр'); return; }
    try {
        const r = await apiPost('/api/bs/join', { code });
        BS.gameId = r.game_id;
        BS.side = 2;
        haptic('success');
        bsShowBoard();
        bsRandomShips();
        bsPollStart();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function bsFind() {
    try {
        const r = await apiPost('/api/bs/find', { bet: BS.bet });
        BS.gameId = r.game_id;
        BS.side = r.side || 1;
        haptic('success');
        if (r.status === 'matched') {
            bsShowBoard();
            bsRandomShips();
        } else {
            bsShowBoard();
            bsRandomShips();
            alert(`В очереди. Код: ${r.code}`);
        }
        bsPollStart();
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function bsBotStart() {
    try {
        await apiPost('/api/bs/bot-start', { bet: BS.bet });
        BS.isBot = true;
        BS.gameId = 'bot';
        BS.side = 1;
        haptic('success');
        bsShowBoard();
        BS.botShips = bsEmptyShips();
        BS.botShots = [];
        bsRandomShips();
        BS.status = 'placing';
        document.getElementById('bsStatus').textContent = 'Расставляй корабли и жми ГОТОВ';
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}

function bsEmptyShips() {
    const res = [];
    const sizes = [];
    BS_SHIPS.forEach(s => { for (let i = 0; i < s.count; i++) sizes.push(s.size); });
    const grid = Array.from({ length: 10 }, () => Array(10).fill(0));

    for (const size of sizes) {
        let placed = false;
        for (let t = 0; t < 500 && !placed; t++) {
            const horiz = Math.random() < 0.5;
            const x = Math.floor(Math.random() * (horiz ? 10 - size + 1 : 10));
            const y = Math.floor(Math.random() * (horiz ? 10 : 10 - size + 1));
            const cells = [];
            for (let k = 0; k < size; k++) {
                cells.push([horiz ? x + k : x, horiz ? y : y + k]);
            }
            let ok = true;
            for (const [cx, cy] of cells) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        const nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
                        if (grid[ny][nx]) ok = false;
                    }
                }
            }
            if (ok) {
                for (const [cx, cy] of cells) grid[cy][cx] = 1;
                res.push({ size, cells: cells.map(c => ({ x: c[0], y: c[1] })) });
                placed = true;
            }
        }
    }
    return res;
}
function bsRandomShips() {
    BS.myShips = bsEmptyShips();
    bsRenderMyField();
    bsRenderEnemyField();
}
function bsRenderMyField() {
    const box = document.getElementById('bsMyField');
    if (!box) return;
    box.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const c = document.createElement('div');
            c.className = 'bs-cell';
            const isShip = BS.myShips.some(s => s.cells.some(cc => cc.x === x && cc.y === y));
            const shot = BS.enemyShots.find(s => s.x === x && s.y === y);
            if (shot) {
                c.classList.add(isShip ? 'hit' : 'miss');
            } else if (isShip) {
                c.classList.add('ship');
            }
            box.appendChild(c);
        }
    }
}
function bsRenderEnemyField() {
    const box = document.getElementById('bsEnemyField');
    if (!box) return;
    box.innerHTML = '';
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const c = document.createElement('div');
            c.className = 'bs-cell';
            const shot = BS.myShots.find(s => s.x === x && s.y === y);
            if (shot) {
                if (shot.result === 'hit') c.classList.add('hit');
                else if (shot.result === 'sunk') c.classList.add('sunk');
                else c.classList.add('miss');
            } else if (BS.status === 'playing') {
                c.onclick = () => bsFire(x, y);
            }
            box.appendChild(c);
        }
    }
}
async function bsReady() {
    if (!BS.myShips.length) { alert('Сначала расставь корабли'); return; }
    if (BS.isBot) {
        BS.status = 'playing';
        bsRenderEnemyField();
        bsRenderMyField();
        document.getElementById('bsStatus').textContent = 'Твой ход';
        return;
    }
    try {
        const r = await apiPost('/api/bs/ready', { game_id: BS.gameId, ships: BS.myShips });
        haptic('success');
        if (r.status === 'playing') {
            BS.status = 'playing';
            bsRenderEnemyField();
            document.getElementById('bsStatus').textContent = r.your_turn ? 'Твой ход' : 'Ход соперника';
        } else {
            document.getElementById('bsStatus').textContent = 'Ждём соперника...';
        }
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
async function bsFire(x, y) {
    if (BS.status !== 'playing') return;

    if (BS.isBot) {
        let hitShip = null;
        for (const s of BS.botShips) {
            if (s.cells.some(c => c.x === x && c.y === y)) { hitShip = s; break; }
        }
        if (!hitShip) {
            BS.myShots.push({ x, y, result: 'miss' });
            bsRenderEnemyField();
            haptic('error');
            setTimeout(bsBotFire, 500);
            return;
        }
        const sunk = hitShip.cells.every(c =>
            BS.myShots.some(s => s.x === c.x && s.y === c.y) || (c.x === x && c.y === y));
        BS.myShots.push({ x, y, result: sunk ? 'sunk' : 'hit' });
        bsRenderEnemyField();
        haptic('success');
        const allEnemyCells = BS.botShips.flatMap(s => s.cells);
        const allHit = allEnemyCells.every(c => BS.myShots.some(s => s.x === c.x && s.y === c.y));
        if (allHit) {
            BS.status = 'finished';
            document.getElementById('bsStatus').textContent = 'Ты победил!';
            apiPost('/api/bs/finish-bot', { bet: BS.bet, outcome: 'win' }).catch(() => {});
            popEmoji('🏆');
            return;
        }
        if (!sunk) return;
        setTimeout(bsBotFire, 500);
        return;
    }

    try {
        const r = await apiPost('/api/bs/fire', { game_id: BS.gameId, x, y });
        if (r.result === 'miss') haptic('error'); else haptic('success');
        BS.myShots.push({ x, y, result: r.result });
        bsRenderEnemyField();
        document.getElementById('bsStatus').textContent = r.your_turn ? 'Твой ход' : 'Ход соперника';
        if (r.status === 'finished') {
            BS.status = 'finished';
            const res = r.result_data || {};
            if (res.outcome === 'win') { document.getElementById('bsStatus').textContent = 'Победа!'; popEmoji('🏆'); }
            else if (res.outcome === 'lose') { document.getElementById('bsStatus').textContent = 'Поражение'; }
            else { document.getElementById('bsStatus').textContent = 'Ничья'; }
        }
    } catch (e) { haptic('error'); alert('Ошибка: ' + e.message); }
}
function bsBotFire() {
    if (BS.status !== 'playing') return;
    let x, y, t = 0;
    do {
        x = Math.floor(Math.random() * 10);
        y = Math.floor(Math.random() * 10);
        t++;
    } while (BS.botShots.some(s => s.x === x && s.y === y) && t < 300);
    BS.botShots.push({ x, y });

    const isHit = BS.myShips.some(s => s.cells.some(c => c.x === x && c.y === y));
    BS.enemyShots.push({ x, y });
    bsRenderMyField();
    haptic(isHit ? 'error' : 'light');

    const allMyCells = BS.myShips.flatMap(s => s.cells);
    const allHit = allMyCells.every(c => BS.enemyShots.some(s => s.x === c.x && s.y === c.y));
    if (allHit) {
        BS.status = 'finished';
        document.getElementById('bsStatus').textContent = 'Бот победил';
        apiPost('/api/bs/finish-bot', { bet: BS.bet, outcome: 'lose' }).catch(() => {});
        return;
    }
    document.getElementById('bsStatus').textContent = 'Твой ход';
}
async function bsSurrender() {
    if (!confirm('Сдаться?')) return;
    if (BS.isBot) {
        BS.status = 'finished';
        apiPost('/api/bs/finish-bot', { bet: BS.bet, outcome: 'lose' }).catch(() => {});
        document.getElementById('bsStatus').textContent = 'Ты сдался';
        return;
    }
    try {
        await apiPost('/api/bs/surrender', { game_id: BS.gameId });
        BS.status = 'finished';
        document.getElementById('bsStatus').textContent = 'Ты сдался';
    } catch (e) { alert('Ошибка: ' + e.message); }
}
function bsPollStart() {
    if (BS.pollTimer) clearInterval(BS.pollTimer);
    BS.pollTimer = setInterval(async () => {
        if (!BS.gameId || BS.isBot) return;
        try {
            const s = await apiGet('/api/bs/state', { game_id: BS.gameId });
            if (s.status === 'playing') {
                BS.status = 'playing';
                BS.myShots = s.my_shots || [];
                BS.enemyShots = s.enemy_shots || [];
                if (s.opponent_name) document.getElementById('bsStatus').textContent = s.your_turn ? 'Твой ход' : 'Ход соперника';
                bsRenderEnemyField();
                bsRenderMyField();
            } else if (s.status === 'finished') {
                clearInterval(BS.pollTimer);
                BS.status = 'finished';
                const r = s.result || {};
                document.getElementById('bsStatus').textContent =
                    r.outcome === 'win' ? 'Победа!' : r.outcome === 'lose' ? 'Поражение' : 'Ничья';
            }
        } catch (e) {}
    }, 2000);
}

/* ============================================================
   ACTIONS
   ============================================================ */
function actionOpenNotifyEditor() {
    haptic('light');
    const p = state.profile;
    state.notifyEditorType = p?.notify_type || 'today';
    state.notifyEditorHour = (p?.notify_hour >= 0) ? p.notify_hour : 8;
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
    const hh = parseInt(hhStr, 10), mm = parseInt(mmStr, 10);
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
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            sendAIPhoto(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => alert('Не удалось прочитать изображение');
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
async function sendAIPhoto(dataUrl) {
    const questionEl = document.getElementById('ai-input');
    const question = questionEl ? questionEl.value.trim() : '';
    state.aiMessages.push({ role: 'user', text: question || 'Что на фото?', photo: dataUrl });
    if (questionEl) questionEl.value = '';
    state.aiPending = true;
    render();
    try {
        const r = await apiPost('/api/ai-photo', { photo: dataUrl, question });
        state.aiMessages.push({ role: 'assistant', text: r.answer || 'Нет ответа' });
        haptic('success');
    } catch (err) {
        state.aiMessages.push({ role: 'assistant', text: 'Ошибка: ' + err.message });
        haptic('error');
    } finally { state.aiPending = false; render(); }
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
async function actionSetName() {
    const w = await apiGet('/api/wallet').catch(() => null);
    const cur = w?.wallet?.custom_name || '';
    const name = prompt('Новый ник (до 24 символов):', cur);
    if (name === null) return;
    try {
        await apiPost('/api/set-name', { name: name.trim() });
        haptic('success'); popEmoji('✅');
        await loadProfile(); render();
    } catch (e) {
        if (e.code === 'need_hard') alert('Нужно 5 Автоматов для смены ника');
        else alert('Ошибка: ' + e.message);
    }
}
async function actionSetAvatar() {
    const idx = prompt('Индекс аватара (0–11):', '0');
    if (idx === null) return;
    try {
        await apiPost('/api/set-avatar', { idx: parseInt(idx) || 0 });
        haptic('success');
        await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionChestOpen() {
    try {
        const r = await apiPost('/api/chest/open');
        haptic('success'); popEmoji('🎁');
        alert('Награда: ' + r.reward.label);
        await loadProfile(); render();
    } catch (e) {
        if (e.code === 'already_opened') alert('Уже открыт, приходи завтра');
        else alert('Ошибка: ' + e.message);
    }
}
async function actionPremiumChestOpen() {
    if (!confirm('Открыть премиум-сундук за 10 Автоматов?')) return;
    try {
        const r = await apiPost('/api/premium-chest/open');
        haptic('success'); popEmoji('💎');
        alert('Награда: ' + r.reward.label);
        await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionExchange() {
    const amount = prompt('Сколько Стипух обменять? (кратно 100)', '100');
    if (amount === null) return;
    try {
        const r = await apiPost('/api/exchange-soft-to-hard', { amount: parseInt(amount) || 0 });
        haptic('success'); popEmoji('💱');
        alert(`Обменяно ${r.soft_spent} Стипух → ${r.hard_received} Автоматов`);
        await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionShowAchievements() {
    try {
        const d = await apiGet('/api/achievements');
        const lines = d.items.map(a => `${a.unlocked ? a.icon : '🔒'} ${a.name} — ${a.desc}`).join('\n');
        alert(`Достижения: ${d.got}/${d.total}\n\n${lines}`);
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionExportPdf() {
    try {
        await apiPost('/api/export');
        haptic('success');
        alert('PDF отправлен в Telegram');
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionShowMyFeedback() {
    try {
        const d = await apiGet('/api/feedback/my');
        if (!d.items.length) { alert('Обращений нет'); return; }
        const lines = d.items.map(f => `#${f.id} [${f.status}]\n${f.text}${f.admin_reply ? '\n→ ' + f.admin_reply : ''}`).join('\n\n---\n\n');
        alert(lines);
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionSetNotifyBefore() {
    const min = prompt('За сколько минут до пары напоминать? (0/5/10/15/20/30/60)', '15');
    if (min === null) return;
    try {
        await apiPost('/api/notify-set-before', { minutes: parseInt(min) || 0 });
        haptic('success'); alert('Сохранено');
        await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}
async function actionAttendanceSet(date, time, subject, status) {
    try {
        await apiPost('/api/attendance-set', { date, time, subject, status });
        haptic('success');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

/* ============================================================
   HANDLERS
   ============================================================ */
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
    else if (a === 'notify-before') actionSetNotifyBefore();
    else if (a === 'go-profile') { state.tab = 'profile'; loadTabData('profile'); }
    else if (a === 'week-prev') { state.weekOffset -= 1; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-next') { state.weekOffset += 1; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-current') { state.weekOffset = 0; state.scheduleViewMode = 'week'; loadWeekAndRender(); }
    else if (a === 'week-today') { loadTodayAndRender(); }
    else if (a === 'day-today') { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; haptic('light'); render(); }
    else if (a === 'day-tomorrow') {
        state.scheduleDay = 'tomorrow'; state.scheduleViewMode = 'today'; haptic('light');
        if (!state.weekDays) { render(); ensureWeekLoaded().then(render); } else render();
    }
    else if (a === 'admin-monitor') actionAdminMonitor();
    else if (a === 'admin-broadcast') actionAdminBroadcast();
    else if (a === 'admin-fb-reply') actionAdminFbReply(parseInt(el.dataset.id));
    else if (a === 'admin-fb-postpone') actionAdminFbPostpone(parseInt(el.dataset.id));
    else if (a === 'open-flappy') openFlappy(false);
    else if (a === 'open-flappy-records') openFlappy(true);
    else if (a === 'open-bs') openBs();
    else if (a === 'open-levels') openLevels();
    else if (a === 'open-leaderboard') openLeaderboard();
    else if (a === 'set-name') actionSetName();
    else if (a === 'set-avatar') actionSetAvatar();
    else if (a === 'chest-open') actionChestOpen();
    else if (a === 'premium-chest-open') actionPremiumChestOpen();
    else if (a === 'exchange') actionExchange();
    else if (a === 'show-achievements') actionShowAchievements();
    else if (a === 'export-pdf') actionExportPdf();
    else if (a === 'show-my-feedback') actionShowMyFeedback();
    else if (a === 'att-set') actionAttendanceSet(el.dataset.date, el.dataset.time, el.dataset.subject, el.dataset.status);
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

/* ============================================================
   INIT
   ============================================================ */
(async function init() {
    await loadTabData(state.tab);
})();
