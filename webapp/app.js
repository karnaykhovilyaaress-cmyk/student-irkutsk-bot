// ============================================================
// TELEGRAM WEB APP SDK — ПОЛНОЭКРАННЫЙ РЕЖИМ
// ============================================================
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

try { if (typeof tg.requestFullscreen === 'function') tg.requestFullscreen(); } catch (e) {}
try { if (typeof tg.lockOrientation === 'function') tg.lockOrientation('portrait'); } catch (e) {}
try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch (e) {}

const tgUser = tg.initDataUnsafe?.user || {
    first_name: 'Гость', last_name: '', username: '', id: 0,
};

const INIT_DATA = tg.initData || '';

// ============================================================
// СПЛЭШ
// ============================================================
setTimeout(() => {
    const sp = document.getElementById('splash');
    const app = document.getElementById('app');
    if (sp) sp.classList.add('hide');
    if (app) app.style.display = '';
    setTimeout(() => { if (sp) sp.remove(); }, 600);
}, 1200);

// ============================================================
// СОСТОЯНИЕ
// ============================================================
const state = {
    tab: 'schedule',
    loading: false,
    error: null,
    user: tgUser,
    isAdmin: false,

    schedule: null,
    weekDays: null,
    weekOffset: 0,
    scheduleViewMode: 'today',

    tasks: [],
    tasksStats: { active: 0, done: 0 },
    tasksView: 'active',

    notes: [],

    profile: null,
    vip: null,
    scholarship: null,
    referral: null,
    groups: null,

    aiMessages: [],
    aiPending: false,

    adminStats: null,
    adminFeedback: [],
    adminVips: [],
    adminMonitor: null,
    adminBusy: false,
};

// ============================================================
// API
// ============================================================
async function apiGet(path, params = {}) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('initData', INIT_DATA);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }
    const r = await fetch(url.toString());
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
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
        throw new Error(err.error || `HTTP ${r.status}`);
    }
    return await r.json();
}

// ============================================================
// УТИЛИТЫ
// ============================================================
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderEmpty(text) {
    return `<div class="empty">${escapeHtml(text)}</div>`;
}

function renderLoading() {
    return `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
    `;
}

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

// ============================================================
// ГЛАВНЫЙ РЕНДЕР
// ============================================================
function render() {
    const content = document.getElementById('content');
    const title = document.getElementById('page-title');

    const titles = {
        schedule: 'Расписание',
        tasks: 'Задачи',
        notes: 'Заметки',
        ai: 'AI',
        vip: 'VIP',
        admin: 'Админ',
        profile: 'Профиль',
    };
    title.textContent = titles[state.tab] || 'Студент';

    let html = '';
    if (state.loading) {
        html = renderLoading();
    } else if (state.error) {
        html = `<div class="empty">Ошибка: ${escapeHtml(state.error)}</div>`;
    } else {
        switch (state.tab) {
            case 'schedule': html = renderSchedule(); break;
            case 'tasks': html = renderTasks(); break;
            case 'notes': html = renderNotes(); break;
            case 'ai': html = renderAI(); break;
            case 'vip': html = renderVIP(); break;
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

// ============================================================
// USER BAR
// ============================================================
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

// ============================================================
// РАСПИСАНИЕ
// ============================================================
function renderLesson(les) {
    const timeRange = les.timeEnd ? `${les.time} – ${les.timeEnd}` : les.time;
    const details = [];
    if (les.teacher) details.push(escapeHtml(les.teacher));
    if (les.auditorium) details.push(`ауд. ${escapeHtml(les.auditorium)}`);

    return `
        <div class="lesson">
            <div class="lesson-time">${escapeHtml(timeRange)}</div>
            <div class="lesson-body">
                <div class="lesson-subject">${escapeHtml(les.subject)}${
                    les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''
                }</div>
                ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
            </div>
        </div>
    `;
}

function renderWeekView() {
    const wd = state.weekDays;
    if (!wd || !wd.days || wd.days.length === 0) {
        return renderEmpty('Не удалось загрузить расписание на неделю');
    }

    let title;
    if (state.weekOffset === 0) title = 'Текущая неделя';
    else if (state.weekOffset > 0) title = `Неделя +${state.weekOffset}`;
    else title = `Неделя ${state.weekOffset}`;

    let html = renderUserBar();
    html += `<div class="day-header">${escapeHtml(title)}</div>`;
    if (wd.group) {
        html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(wd.group)}${
            wd.subgroup ? ` · подгруппа ${escapeHtml(wd.subgroup)}` : ''
        }</div>`;
    }

    for (const day of wd.days) {
        html += `<div class="day-header" style="margin-top:16px">${escapeHtml(day.name || day.date)}</div>`;
        if (!day.lessons || day.lessons.length === 0) {
            html += `<div class="card-subtitle" style="padding:8px 0">Занятий нет</div>`;
        } else {
            for (const les of day.lessons) {
                html += renderLesson(les);
            }
        }
    }

    html += `
        <div class="actions-row" style="margin-top:16px">
            <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
            <button class="btn btn-secondary" data-action="week-today">Сегодня</button>
            <button class="btn btn-secondary" data-action="week-next">Следующая →</button>
        </div>
    `;

    return html;
}

function renderSchedule() {
    if (state.scheduleViewMode === 'week' && state.weekDays) {
        return renderWeekView();
    }

    const s = state.schedule;
    let html = renderUserBar();

    if (!s) return html + renderEmpty('Нет данных о расписании');

    if (s.error === 'no_group' || (state.profile && !state.profile.group)) {
        html += `
            <div class="banner">
                <div class="banner-title">Как начать</div>
                <div class="banner-sub">1. Профиль → «Выбрать группу»<br>2. Укажи институт и группу<br>3. Вернись — расписание появится</div>
                <button class="banner-btn" data-action="go-profile">Выбрать группу</button>
            </div>
        `;
        return html;
    }

    if (s.error) return html + renderEmpty(s.message || 'Ошибка загрузки');

    const header = s.dayName ? `${s.dayName}, ${s.date}` : s.date || '';
    html += `<div class="day-header">${escapeHtml(header)}</div>`;

    if (s.group) {
        html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(s.group)}${
            s.subgroup ? ` · подгруппа ${escapeHtml(s.subgroup)}` : ''
        }</div>`;
    }

    if (!s.lessons || s.lessons.length === 0) {
        html += renderEmpty('Занятий нет');
    } else {
        for (const les of s.lessons) {
            html += renderLesson(les);
        }
    }

    html += `
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
            <button class="btn btn-secondary" data-action="week-current">Текущая неделя</button>
            <button class="btn btn-secondary" data-action="week-next">Следующая →</button>
        </div>
    `;

    return html;
}

// ============================================================
// ЗАДАЧИ
// ============================================================
function renderTasks() {
    const tasks = state.tasks;
    const stats = state.tasksStats;

    let html = `
        <div class="tab-buttons">
            <button data-action="tasks-show-active" class="${state.tasksView === 'active' ? 'active' : ''}">Активные (${stats.active})</button>
            <button data-action="tasks-show-done" class="${state.tasksView === 'done' ? 'active' : ''}">Выполненные (${stats.done})</button>
        </div>
    `;

    if (state.tasksView === 'active') {
        html += `<button class="btn" data-action="task-add-open" style="width:100%;margin-bottom:12px">+ Добавить задачу</button>`;
    }

    if (!tasks || tasks.length === 0) {
        if (state.tasksView === 'active') {
            html += `
                <div class="banner">
                    <div class="banner-title">Задач нет</div>
                    <div class="banner-sub">Нажми «+ Добавить задачу». Срок: 25.12.2025 или 25.12.2025 14:30. Приоритет: 0 / 1 / 2.</div>
                </div>
            `;
        } else {
            html += renderEmpty('Нет выполненных задач');
        }
        return html;
    }

    for (const t of tasks) {
        const dueStr = t.due_date
            ? `<span class="${t.overdue ? 'overdue' : ''}">до ${escapeHtml(t.due_date)}${t.due_time ? ' ' + escapeHtml(t.due_time) : ''}${t.overdue ? ' — просрочено' : ''}</span>`
            : '';
        html += `
            <div class="card">
                <div class="card-title">${escapeHtml(t.text)}</div>
                <div class="card-meta">
                    ${priorityLabel(t.priority)}
                    ${dueStr}
                </div>
                <div class="actions-row">
                    ${!t.done ? `<button class="btn btn-secondary" data-action="task-done" data-id="${t.id}">Готово</button>` : ''}
                    <button class="btn btn-secondary" data-action="task-edit-open" data-id="${t.id}">Изменить</button>
                    <button class="btn btn-secondary" data-action="task-delete" data-id="${t.id}">Удалить</button>
                </div>
            </div>
        `;
    }

    if (state.tasksView === 'done' && tasks.length > 0) {
        html += `<button class="btn btn-secondary" data-action="tasks-clear" style="width:100%;margin-top:8px">Очистить выполненные</button>`;
    }

    return html;
}

// ============================================================
// ЗАМЕТКИ
// ============================================================
function renderNotes() {
    let html = `<button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">+ Добавить заметку</button>`;

    if (!state.notes || state.notes.length === 0) {
        html += `
            <div class="banner">
                <div class="banner-title">Заметки</div>
                <div class="banner-sub">Короткие записи по предметам. Название предмета — ключ: одинаковые названия перезаписываются.</div>
            </div>
        `;
        return html;
    }

    for (const n of state.notes) {
        html += `
            <div class="card">
                <div class="card-title">${escapeHtml(n.subject)}</div>
                <div class="card-subtitle">${escapeHtml(n.text)}</div>
                <div class="actions-row">
                    <button class="btn btn-secondary" data-action="note-edit-open" data-id="${n.id}">Изменить</button>
                    <button class="btn btn-secondary" data-action="note-delete" data-id="${n.id}">Удалить</button>
                </div>
            </div>
        `;
    }
    return html;
}

// ============================================================
// AI
// ============================================================
function renderAI() {
    const p = state.profile;
    if (!p || !p.is_vip) {
        return `
            <div class="banner">
                <div class="banner-title">AI Помощник</div>
                <div class="banner-sub">Доступен VIP. Отвечает на вопросы по учёбе, помогает с формулами и конспектами.</div>
                <button class="banner-btn" data-action="go-vip">Что такое VIP?</button>
            </div>
        `;
    }

    let html = '';
    if (state.aiMessages.length === 0) {
        html += `
            <div class="banner">
                <div class="banner-title">Задай вопрос</div>
                <div class="banner-sub">Например: «Объясни интеграл по частям»</div>
            </div>
        `;
    } else {
        for (const m of state.aiMessages) {
            if (m.role === 'user') {
                html += `<div class="card" style="background:var(--neon);color:#070B14"><div style="font-weight:600">${escapeHtml(m.text)}</div></div>`;
            } else {
                html += `<div class="card"><div style="white-space:pre-wrap">${escapeHtml(m.text)}</div></div>`;
            }
        }
    }
    if (state.aiPending) html += renderLoading();
    html += `
        <div style="margin-top:12px">
            <textarea class="input" id="ai-input" placeholder="Напиши вопрос..." rows="3" ${state.aiPending ? 'disabled' : ''}></textarea>
            <button class="btn" data-action="ai-send" style="width:100%" ${state.aiPending ? 'disabled' : ''}>Отправить</button>
            <button class="btn btn-secondary" data-action="ai-clear" style="width:100%;margin-top:6px">Очистить</button>
        </div>
    `;
    return html;
}

// ============================================================
// VIP
// ============================================================
function renderVIP() {
    const v = state.vip;
    let html = '';

    if (v && v.is_vip) {
        html += `
            <div class="banner">
                <div class="banner-title">VIP активен</div>
                <div class="banner-sub">До: ${escapeHtml(v.expiry ? v.expiry.slice(0, 10) : '')}<br>Осталось: ${v.days_left} дней</div>
            </div>
        `;
    } else {
        html += `
            <div class="banner">
                <div class="banner-title">VIP-подписка</div>
                <div class="banner-sub">
                    • Расширенная статистика<br>
                    • Раздел «Стипендия»<br>
                    • AI Помощник<br><br>
                    30 дней — 149 ₽ · 90 дней — 349 ₽ · Навсегда — 599 ₽<br><br>
                    Для покупки: @ilyaech
                </div>
            </div>
        `;
    }

    if (v && v.is_vip && state.scholarship) {
        const s = state.scholarship;
        html += `
            <div class="card">
                <div class="card-title">Стипендия</div>
                <div class="card-subtitle">Текущая: ${s.amount !== null ? escapeHtml(s.amount) + ' ₽/мес' : 'не указана'}</div>
                <div class="card-subtitle">Оценок: ${s.grades.length}</div>
                ${s.grades.length ? `<div class="card-subtitle">Средний балл: ${s.avg}</div>` : ''}
            </div>
        `;
        if (s.grades.length > 0) {
            html += `<div class="card"><div class="card-title">Оценки</div>`;
            for (const g of s.grades) {
                html += `
                    <div class="grade-row">
                        <span>${escapeHtml(g.subject)}</span>
                        <span class="grade-value">${g.grade}</span>
                    </div>
                `;
            }
            html += `</div>`;
        }
        if (s.forecast) {
            html += `<div class="card"><div class="card-subtitle">${escapeHtml(s.forecast)}</div></div>`;
        }
        html += `
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="sch-set-amount-open">Сумма</button>
                <button class="btn btn-secondary" data-action="sch-add-grade-open">Оценка</button>
                <button class="btn btn-secondary" data-action="sch-clear">Очистить</button>
            </div>
        `;
    }

    html += `<div class="actions-row"><button class="btn" data-action="vip-buy">Написать админу</button></div>`;
    return html;
}

// ============================================================
// АДМИН
// ============================================================
function renderAdmin() {
    if (!state.isAdmin) {
        return renderEmpty('Доступ только для администратора');
    }

    let html = '';

    if (state.adminStats) {
        const s = state.adminStats;
        html += `
            <div class="banner">
                <div class="banner-title">Статистика</div>
                <div class="banner-sub">
                    Пользователей: ${s.total_users}<br>
                    Активных VIP: ${s.vip_count}<br>
                    Обращений в ожидании: ${s.pending_feedback}
                </div>
            </div>
        `;
    } else {
        html += renderLoading();
    }

    html += `
        <div class="card">
            <div class="card-title">Мониторинг ИРНИТУ</div>
            ${state.adminMonitor
                ? (state.adminMonitor.ok
                    ? `<div class="card-subtitle" style="color:var(--accent-green)">Сайт отвечает (HTTP ${state.adminMonitor.status})</div>`
                    : `<div class="card-subtitle overdue">Сайт не отвечает${state.adminMonitor.error ? ': ' + escapeHtml(state.adminMonitor.error) : ''}</div>`)
                : `<div class="card-subtitle">Не проверено</div>`}
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="admin-monitor">Проверить</button>
            </div>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Рассылка</div>
            <div class="card-subtitle">Уйдёт всем пользователям бота.</div>
            <textarea class="input" id="admin-broadcast-text" placeholder="Текст..." rows="3"></textarea>
            <button class="btn" data-action="admin-broadcast">Отправить всем</button>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Выдать VIP</div>
            <div class="card-subtitle">user_id и срок в днях (30 / 90 / 365).</div>
            <input class="input" id="admin-vip-uid" placeholder="user_id" type="number">
            <input class="input" id="admin-vip-days" placeholder="дней" type="number" value="30">
            <div class="actions-row">
                <button class="btn" data-action="admin-give-vip">Выдать</button>
            </div>
        </div>
    `;

    if (state.adminVips && state.adminVips.length > 0) {
        html += `<div class="card"><div class="card-title">Активные VIP</div>`;
        for (const v of state.adminVips) {
            html += `
                <div class="grade-row">
                    <span>${v.user_id}</span>
                    <span class="card-subtitle">до ${escapeHtml(v.expiry)} (${v.days} дн.)</span>
                    <button class="btn btn-secondary" data-action="admin-revoke-vip" data-id="${v.user_id}">Снять</button>
                </div>
            `;
        }
        html += `</div>`;
    }

    if (state.adminFeedback && state.adminFeedback.length > 0) {
        html += `<div class="card"><div class="card-title">Обращения (${state.adminFeedback.length})</div>`;
        for (const f of state.adminFeedback) {
            html += `
                <div style="border-bottom:1px solid var(--divider);padding:10px 0">
                    <div class="card-subtitle">#${f.id} | ${escapeHtml(f.username || f.user_id)}${f.status === 'postponed' ? ' [отложено]' : ''}</div>
                    <div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(f.text)}</div>
                    <div class="actions-row">
                        <button class="btn btn-secondary" data-action="admin-fb-reply" data-id="${f.id}">Ответить</button>
                        <button class="btn btn-secondary" data-action="admin-fb-postpone" data-id="${f.id}">Отложить</button>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
    } else {
        html += `<div class="card"><div class="card-subtitle">Обращений в ожидании нет.</div></div>`;
    }

    return html;
}

// ============================================================
// ПРОФИЛЬ
// ============================================================
function renderProfile() {
    const p = state.profile;
    const u = state.user;
    const initials = ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() || '?';
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Гость';

    const metaParts = [];
    if (p?.group) metaParts.push(p.group + (p.subgroup ? ` (подгр. ${p.subgroup})` : ''));
    if (u.username) metaParts.push('@' + u.username);

    let html = `
        <div class="profile-header">
            <div class="profile-avatar">${escapeHtml(initials)}</div>
            <div class="profile-name">${escapeHtml(fullName)}</div>
            ${metaParts.length ? `<div class="profile-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
            ${p?.is_vip ? '<div class="badge">VIP</div>' : ''}
            ${p?.is_admin ? '<div class="badge" style="background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff">ADMIN</div>' : ''}
        </div>
    `;

    if (p) {
        html += `
            <div class="card">
                <div class="card-title">Статистика</div>
                <div class="card-subtitle">Активных задач: ${p.tasks_active ?? 0}</div>
                <div class="card-subtitle">Выполнено: ${p.tasks_done ?? 0}</div>
                <div class="card-subtitle">Заметок: ${p.notes_count ?? 0}</div>
                <div class="card-subtitle">Оценок: ${p.grades_count ?? 0}</div>
            </div>
        `;
    }

    html += `
        <div class="card">
            <div class="card-title">Мой ID</div>
            <div class="card-subtitle">${escapeHtml(String(u.id || '—'))}</div>
            <div class="card-subtitle">Нужен для выдачи VIP — сообщи админу.</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="copy-my-id">Скопировать ID</button>
            </div>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Моя группа</div>
            <div class="card-subtitle">${p?.group ? escapeHtml(p.group) : 'не выбрана'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="choose-group">${p?.group ? 'Изменить' : 'Выбрать группу'}</button>
                ${p?.group ? `<button class="btn btn-secondary" data-action="forget-group">Забыть</button>` : ''}
            </div>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Подгруппа</div>
            <div class="card-subtitle">${p?.subgroup ? 'Подгруппа ' + p.subgroup : 'не выбрана'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="0">—</button>
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="1">1</button>
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="2">2</button>
            </div>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Уведомления</div>
            <div class="card-subtitle">Сейчас: ${p?.notify_time || 'выключены'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="notify-set" data-h="7">7:00</button>
                <button class="btn btn-secondary" data-action="notify-set" data-h="8">8:00</button>
                <button class="btn btn-secondary" data-action="notify-set" data-h="19">19:00</button>
                <button class="btn btn-secondary" data-action="notify-set" data-h="20">20:00</button>
                <button class="btn btn-secondary" data-action="notify-set" data-h="-1">Выкл</button>
            </div>
            <label class="checkbox-row">
                <input type="checkbox" id="notify-changes" ${p?.notify_changes ? 'checked' : ''}>
                <span>Следить за изменениями</span>
            </label>
        </div>
    `;

    html += `
        <div class="card">
            <div class="card-title">Цитата дня</div>
            <div class="card-subtitle">${p?.daily_subscribed ? 'Подписан' : 'Не подписан'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="quote-subscribe" data-value="1">Подписаться</button>
                <button class="btn btn-secondary" data-action="quote-subscribe" data-value="0">Отписаться</button>
            </div>
        </div>
    `;

    if (state.referral) {
        const r = state.referral;
        html += `
            <div class="card">
                <div class="card-title">Пригласи друга</div>
                <div class="card-subtitle">+${r.referral_days} дней VIP за друга</div>
                <div class="card-subtitle">Пришло: ${r.total} · Засчитано: ${r.rewarded} · Дней: ${r.days}</div>
                <div style="margin-top:8px;word-break:break-all;font-size:13px;color:var(--text-2)">${escapeHtml(r.link)}</div>
                <div class="actions-row">
                    <button class="btn btn-secondary" data-action="copy-referral">Скопировать ссылку</button>
                </div>
            </div>
        `;
    }

    html += `
        <div class="card">
            <div class="card-title">Обратная связь</div>
            <textarea class="input" id="feedback-text" placeholder="Сообщение админу..." rows="3"></textarea>
            <button class="btn" data-action="feedback-send">Отправить</button>
        </div>
    `;

    return html;
}

// ============================================================
// ЗАГРУЗКА
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
    try {
        const r = await apiGet('/api/notes');
        state.notes = r.notes || [];
    } catch (e) { state.notes = []; }
}

async function loadProfile() {
    try {
        state.profile = await apiGet('/api/me');
        state.isAdmin = !!state.profile.is_admin;
    } catch (e) { state.profile = { error: e.message }; }
}

async function loadVIP() {
    try { state.vip = await apiGet('/api/vip'); }
    catch (e) { state.vip = { is_vip: false }; }
}

async function loadScholarship() {
    if (!state.vip?.is_vip) { state.scholarship = null; return; }
    try { state.scholarship = await apiGet('/api/scholarship'); }
    catch (e) { state.scholarship = null; }
}

async function loadReferral() {
    try { state.referral = await apiGet('/api/referral'); }
    catch (e) { state.referral = null; }
}

async function loadGroups() {
    if (state.groups) return;
    try {
        const r = await apiGet('/api/groups');
        state.groups = r.groups;
    } catch (e) { state.groups = {}; }
}

async function loadAdminStats() {
    try { state.adminStats = await apiGet('/api/admin/stats'); }
    catch (e) { state.adminStats = null; }
}

async function loadAdminFeedback() {
    try {
        const r = await apiGet('/api/admin/feedback-list');
        state.adminFeedback = r.items || [];
    } catch (e) { state.adminFeedback = []; }
}

async function loadAdminVips() {
    try {
        const r = await apiGet('/api/admin/vip-list');
        state.adminVips = r.items || [];
    } catch (e) { state.adminVips = []; }
}

async function loadTabData(tab) {
    state.loading = true;
    state.error = null;
    render();

    try {
        if (tab === 'schedule') {
            state.scheduleViewMode = 'today';
            state.weekOffset = 0;
            state.weekDays = null;
            await loadProfile();
            await loadSchedule();
        } else if (tab === 'tasks') {
            await loadTasks();
        } else if (tab === 'notes') {
            await loadNotes();
        } else if (tab === 'ai') {
            await loadProfile();
        } else if (tab === 'vip') {
            await loadProfile();
            await loadVIP();
            await loadScholarship();
        } else if (tab === 'admin') {
            await loadProfile();
            if (state.isAdmin) {
                await Promise.all([
                    loadAdminStats(),
                    loadAdminFeedback(),
                    loadAdminVips(),
                ]);
            }
        } else if (tab === 'profile') {
            await loadProfile();
            await loadReferral();
        }
    } catch (e) {
        console.error(e);
        state.error = e.message;
    }
    state.loading = false;
    render();
}

// ============================================================
// ДЕЙСТВИЯ
// ============================================================
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
    await loadSchedule();
    render();
}

async function actionSetSubgroup(value) {
    try {
        await apiPost('/api/set-subgroup', { subgroup: value });
        if (state.profile) state.profile.subgroup = value;
        haptic('success'); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionNotifySet(hour) {
    try {
        await apiPost('/api/notify-set', { hour, minute: 0, changes: state.profile?.notify_changes });
        if (state.profile) state.profile.notify_time = hour >= 0 ? `${String(hour).padStart(2, '0')}:00` : null;
        haptic('success'); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionNotifyChangesToggle() {
    const cb = document.getElementById('notify-changes');
    if (!cb) return;
    try {
        await apiPost('/api/notify-set', {
            hour: state.profile?.notify_time ? parseInt(state.profile.notify_time.split(':')[0]) : -1,
            minute: 0,
            changes: cb.checked,
        });
        if (state.profile) state.profile.notify_changes = cb.checked;
        haptic('success');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionQuoteSubscribe(value) {
    try {
        await apiPost('/api/quote-subscribe', { subscribe: value === 1 });
        if (state.profile) state.profile.daily_subscribed = value === 1;
        haptic('success'); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionFeedbackSend() {
    const el = document.getElementById('feedback-text');
    if (!el) return;
    const text = (el.value || '').trim();
    if (!text) return;
    try {
        await apiPost('/api/feedback', { text });
        el.value = '';
        haptic('success'); alert('Отправлено');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionTaskDone(id) {
    try {
        await apiPost('/api/task-update', { id, done: true });
        haptic('success');
        popEmoji('✅');
        await loadTasks(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
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
    try {
        await apiPost('/api/task-delete', { id });
        haptic('success'); await loadTasks(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionTasksClear() {
    if (!confirm('Очистить все выполненные?')) return;
    try {
        await apiPost('/api/task-clear');
        haptic('success'); await loadTasks(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionTaskAdd() {
    const text = prompt('Текст задачи:');
    if (!text) return;
    const due = prompt('Срок (ДД.ММ.ГГГГ или ДД.ММ.ГГГГ ЧЧ:ММ, можно пусто):') || '';
    let due_date = null, due_time = null;
    if (due.trim()) {
        const parts = due.trim().split(' ');
        due_date = parts[0];
        if (parts[1]) due_time = parts[1];
    }
    const priorityStr = prompt('Приоритет (0=низкий, 1=средний, 2=высокий):', '1');
    const priority = parseInt(priorityStr) || 1;
    try {
        await apiPost('/api/task-add', { text, due_date, due_time, priority });
        haptic('success'); await loadTasks(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionTaskEdit(id) {
    const newText = prompt('Новый текст задачи:');
    if (!newText) return;
    try {
        await apiPost('/api/task-update', { id, text: newText });
        haptic('success'); await loadTasks(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionNoteDelete(id) {
    if (!confirm('Удалить заметку?')) return;
    try {
        await apiPost('/api/note-delete', { id });
        haptic('success'); await loadNotes(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionNoteAdd() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const text = prompt('Текст заметки:');
    if (!text) return;
    try {
        await apiPost('/api/note-save', { subject, text });
        haptic('success'); await loadNotes(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionNoteEdit(id) {
    const text = prompt('Новый текст заметки:');
    if (!text) return;
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    try {
        await apiPost('/api/note-save', { subject: note.subject, text });
        haptic('success'); await loadNotes(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionScholarshipSetAmount() {
    const amount = prompt('Сумма стипендии (₽/мес, 0 если не получаешь):');
    if (amount === null) return;
    try {
        await apiPost('/api/scholarship-set-amount', { amount: parseInt(amount) || 0 });
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionScholarshipAddGrade() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const gradeStr = prompt('Оценка (2, 3, 4 или 5):');
    const grade = parseInt(gradeStr);
    if (![2, 3, 4, 5].includes(grade)) { alert('Нужно 2, 3, 4 или 5'); return; }
    try {
        await apiPost('/api/scholarship-add-grade', { subject, grade });
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionScholarshipClear() {
    if (!confirm('Очистить все оценки?')) return;
    try {
        await apiPost('/api/scholarship-clear');
        haptic('success'); await loadScholarship(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
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
    } finally {
        state.aiPending = false;
        render();
    }
}

function actionAIClear() {
    state.aiMessages = [];
    render();
}

async function actionChooseGroup() {
    await loadGroups();
    if (!state.groups || Object.keys(state.groups).length === 0) {
        alert('Не удалось загрузить список групп');
        return;
    }
    const institutes = Object.keys(state.groups);
    const instStr = prompt('Институт (одно из):\n' + institutes.join('\n'));
    if (!instStr || !state.groups[instStr]) { alert('Институт не найден'); return; }
    const groups = state.groups[instStr];
    const groupList = groups.map(g => `${g.name}`).join('\n');
    const groupStr = prompt('Группа (одно из):\n' + groupList);
    if (!groupStr) return;
    let selected = null;
    for (const g of groups) {
        if (groupStr.includes(g.name)) { selected = g; break; }
    }
    if (!selected) { alert('Группа не найдена'); return; }
    try {
        await apiPost('/api/set-group', {
            group_id: selected.id,
            group_name: selected.name,
            subgroup: state.profile?.subgroup || 0,
        });
        haptic('success');
        await loadProfile(); await loadSchedule(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionForgetGroup() {
    if (!confirm('Забыть группу?')) return;
    try {
        await apiPost('/api/set-group', { group_id: '', group_name: '', subgroup: 0 });
        if (state.profile) { state.profile.group = null; state.profile.group_id = null; }
        haptic('success'); await loadProfile(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

function actionCopyReferral() {
    if (!state.referral) return;
    try {
        navigator.clipboard.writeText(state.referral.link);
        haptic('success'); alert('Ссылка скопирована');
    } catch (e) { alert('Не удалось скопировать'); }
}

function actionCopyMyId() {
    const id = String(state.user?.id || '');
    if (!id) return;
    try {
        navigator.clipboard.writeText(id);
        haptic('success');
        alert('ID скопирован: ' + id);
    } catch (e) {
        alert('Твой ID: ' + id);
    }
}

function actionVipBuy() {
    tg.openTelegramLink('https://t.me/ilyaech');
}

// ============================================================
// АДМИН-ДЕЙСТВИЯ
// ============================================================
async function actionAdminMonitor() {
    state.adminBusy = true;
    try { state.adminMonitor = await apiGet('/api/admin/monitor'); }
    catch (e) { state.adminMonitor = { ok: false, status: 0, error: e.message }; }
    state.adminBusy = false;
    render();
}

async function actionAdminBroadcast() {
    const el = document.getElementById('admin-broadcast-text');
    if (!el) return;
    const text = (el.value || '').trim();
    if (!text) { alert('Пустое сообщение'); return; }
    if (!confirm('Отправить всем пользователям?')) return;
    try {
        await apiPost('/api/admin/broadcast', { text });
        el.value = '';
        haptic('success'); alert('Рассылка запущена');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionAdminGiveVip() {
    const uidEl = document.getElementById('admin-vip-uid');
    const daysEl = document.getElementById('admin-vip-days');
    if (!uidEl || !daysEl) return;
    const user_id = parseInt(uidEl.value);
    const days = parseInt(daysEl.value);
    if (!user_id || !days || days <= 0) { alert('Заполни user_id и дни'); return; }
    try {
        const r = await apiPost('/api/admin/give-vip', { user_id, days });
        haptic('success'); alert(`VIP выдан до ${r.expiry}`);
        uidEl.value = '';
        await loadAdminVips();
        render();
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function actionAdminRevokeVip(uid) {
    if (!confirm(`Снять VIP с ${uid}?`)) return;
    try {
        await apiPost('/api/admin/revoke-vip', { user_id: uid });
        haptic('success');
        await loadAdminVips(); render();
    } catch (e) { alert('Ошибка: ' + e.message); }
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

// ============================================================
// ОБРАБОТЧИКИ
// ============================================================
function attachHandlers() {
    document.querySelectorAll('[data-action]').forEach((el) => {
        el.addEventListener('click', () => handleAction(el));
    });

    const notifyCb = document.getElementById('notify-changes');
    if (notifyCb) notifyCb.addEventListener('change', actionNotifyChangesToggle);
}

function handleAction(el) {
    const a = el.dataset.action;
    if (a === 'set-subgroup') actionSetSubgroup(parseInt(el.dataset.value));
    else if (a === 'notify-set') actionNotifySet(parseInt(el.dataset.h));
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
    else if (a === 'choose-group') actionChooseGroup();
    else if (a === 'forget-group') actionForgetGroup();
    else if (a === 'copy-referral') actionCopyReferral();
    else if (a === 'copy-my-id') actionCopyMyId();
    else if (a === 'vip-buy') actionVipBuy();
    else if (a === 'go-profile') { state.tab = 'profile'; loadTabData('profile'); }
    else if (a === 'go-vip') { state.tab = 'vip'; loadTabData('vip'); }
    else if (a === 'week-prev') { state.weekOffset -= 1; loadWeekAndRender(); }
    else if (a === 'week-next') { state.weekOffset += 1; loadWeekAndRender(); }
    else if (a === 'week-current') { state.weekOffset = 0; loadWeekAndRender(); }
    else if (a === 'week-today') { loadTodayAndRender(); }
    else if (a === 'admin-monitor') actionAdminMonitor();
    else if (a === 'admin-broadcast') actionAdminBroadcast();
    else if (a === 'admin-give-vip') actionAdminGiveVip();
    else if (a === 'admin-revoke-vip') actionAdminRevokeVip(parseInt(el.dataset.id));
    else if (a === 'admin-fb-reply') actionAdminFbReply(parseInt(el.dataset.id));
    else if (a === 'admin-fb-postpone') actionAdminFbPostpone(parseInt(el.dataset.id));
}

// ============================================================
// НИЖНЯЯ НАВИГАЦИЯ
// ============================================================
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
    if (state.tab === 'schedule' && state.scheduleViewMode === 'week') {
        await loadWeekAndRender();
    } else {
        await loadTabData(state.tab);
    }
});

// ============================================================
// СТАРТ
// ============================================================
(async function init() {
    await loadTabData(state.tab);
})();
