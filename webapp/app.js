// ============================================================
// TELEGRAM WEB APP SDK
// ============================================================
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const tgUser = tg.initDataUnsafe?.user || {
    first_name: 'Гость', last_name: '', username: '', id: 0,
};

const INIT_DATA = tg.initData || '';

// ============================================================
// СОСТОЯНИЕ
// ============================================================
const state = {
    tab: 'schedule',
    loading: false,
    error: null,
    user: tgUser,
    schedule: null,
    week: null,
    weekOffset: 0,
    tasks: [],
    tasksStats: { active: 0, done: 0 },
    tasksView: 'active', // active | done
    notes: [],
    profile: null,
    vip: null,
    scholarship: null,
    quote: null,
    referral: null,
    groups: null,
    aiMessages: [], // [{role, text}]
    aiPending: false,
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
    return '<div class="loading">Загрузка...</div>';
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
        ai: 'AI Помощник',
        vip: 'VIP',
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
            case 'profile': html = renderProfile(); break;
        }
    }

    content.innerHTML = html;

    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });

    // Подключаем обработчики, которые рендерятся динамически
    attachHandlers();
}

// ============================================================
// РАСПИСАНИЕ
// ============================================================
function renderSchedule() {
    const s = state.schedule;
    if (!s) return renderEmpty('Нет данных о расписании');
    if (s.error) return renderEmpty(s.message || 'Выбери группу в разделе «Профиль»');

    const header = s.dayName ? `${s.dayName}, ${s.date}` : s.date || '';
    let html = `<div class="day-header">${escapeHtml(header)}</div>`;

    if (s.group) {
        html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(s.group)}${
            s.subgroup ? ` · подгруппа ${escapeHtml(s.subgroup)}` : ''
        }</div>`;
    }

    if (!s.lessons || s.lessons.length === 0) {
        html += renderEmpty('Занятий нет');
    } else {
        for (const les of s.lessons) {
            const timeRange = les.timeEnd ? `${les.time} – ${les.timeEnd}` : les.time;
            const details = [];
            if (les.teacher) details.push(escapeHtml(les.teacher));
            if (les.auditorium) details.push(`ауд. ${escapeHtml(les.auditorium)}`);

            html += `
                <div class="lesson">
                    <div class="lesson-time">${escapeHtml(timeRange)}</div>
                    <div class="lesson-body">
                        <div class="lesson-subject">${escapeHtml(les.subject)}${
                            les.type ? ` <span style="color:var(--text-secondary);font-weight:400">(${escapeHtml(les.type)})</span>` : ''
                        }</div>
                        ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
                        ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
                    </div>
                </div>
            `;
        }
    }

    html += `
        <div class="actions-row">
            <button class="btn btn-secondary" data-action="week-prev">← Прошлая</button>
            <button class="btn btn-secondary" data-action="week-today">Сегодня</button>
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
        html += `
            <button class="btn" data-action="task-add-open" style="width:100%;margin-bottom:12px">+ Добавить задачу</button>
        `;
    }

    if (!tasks || tasks.length === 0) {
        html += renderEmpty(state.tasksView === 'active' ? 'Нет активных задач' : 'Нет выполненных задач');
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
    let html = `
        <button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">+ Добавить заметку</button>
    `;

    if (!state.notes || state.notes.length === 0) {
        html += renderEmpty('Нет заметок');
        return html;
    }

    for (const n of state.notes) {
        html += `
            <div class="card">
                <div class="card-title">${escapeHtml(n.subject)}</div>
                <div class="card-subtitle">${escapeHtml(n.text)}</div>
                <div class="actions-row">
                    <button class="btn btn-secondary" data-action="note-edit-open" data-id="${n.id}" data-subject="${escapeHtml(n.subject)}" data-text="${escapeHtml(n.text)}">Изменить</button>
                    <button class="btn btn-secondary" data-action="note-delete" data-id="${n.id}">Удалить</button>
                </div>
            </div>
        `;
    }
    return html;
}

// ============================================================
// AI ПОМОЩНИК
// ============================================================
function renderAI() {
    const p = state.profile;
    if (!p || !p.is_vip) {
        return renderEmpty('AI Помощник доступен только VIP-пользователям');
    }

    let html = '';
    if (state.aiMessages.length === 0) {
        html += renderEmpty('Задай вопрос — AI ответит');
    } else {
        for (const m of state.aiMessages) {
            if (m.role === 'user') {
                html += `<div class="card" style="background:var(--button);color:var(--button-text)"><div>${escapeHtml(m.text)}</div></div>`;
            } else {
                html += `<div class="card"><div style="white-space:pre-wrap">${escapeHtml(m.text)}</div></div>`;
            }
        }
    }
    if (state.aiPending) {
        html += renderLoading();
    }
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
            <div class="card">
                <div class="card-title">VIP активен</div>
                <div class="card-subtitle">До: ${escapeHtml(v.expiry ? v.expiry.slice(0, 10) : '')}</div>
                <div class="card-subtitle">Осталось: ${v.days_left} дней</div>
            </div>
        `;
    } else {
        html += `
            <div class="card">
                <div class="card-title">VIP-подписка</div>
                <div class="card-subtitle">Что даёт:</div>
                <div class="card-subtitle">— Расширенная статистика по расписанию</div>
                <div class="card-subtitle">— Раздел «Стипендия»</div>
                <div class="card-subtitle">— AI Помощник</div>
                <div class="card-subtitle">— AI по фото</div>
                <div class="card-subtitle" style="margin-top:8px">Тарифы:</div>
                <div class="card-subtitle">— 30 дней — 149 руб</div>
                <div class="card-subtitle">— 90 дней — 349 руб</div>
                <div class="card-subtitle">— Навсегда — 599 руб</div>
            </div>
        `;
    }

    // Стипендия (только для VIP)
    if (v && v.is_vip && state.scholarship) {
        const s = state.scholarship;
        html += `
            <div class="card">
                <div class="card-title">Стипендия</div>
                <div class="card-subtitle">Текущая: ${s.amount !== null ? escapeHtml(s.amount) + ' руб/мес' : 'не указана'}</div>
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
                <button class="btn btn-secondary" data-action="sch-set-amount-open">Сумма стипендии</button>
                <button class="btn btn-secondary" data-action="sch-add-grade-open">Добавить оценку</button>
                <button class="btn btn-secondary" data-action="sch-clear">Очистить оценки</button>
            </div>
        `;
    }

    html += `
        <div class="actions-row">
            <button class="btn" data-action="vip-buy">Купить / продлить</button>
        </div>
    `;

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
            <div class="card-title">Моя группа</div>
            <div class="card-subtitle">${p?.group ? escapeHtml(p.group) : 'не выбрана'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="choose-group">${p?.group ? 'Изменить' : 'Выбрать группу'}</button>
                ${p?.group ? `<button class="btn btn-secondary" data-action="forget-group">Забыть</button>` : ''}
            </div>
        </div>
    `;

    // Подгруппа
    html += `
        <div class="card">
            <div class="card-title">Подгруппа</div>
            <div class="card-subtitle">${p?.subgroup ? 'Подгруппа ' + p.subgroup : 'не выбрана'}</div>
            <div class="actions-row">
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="0">Не выбрана</button>
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="1">1</button>
                <button class="btn btn-secondary" data-action="set-subgroup" data-value="2">2</button>
            </div>
        </div>
    `;

    // Уведомления
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

    // Цитата дня
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

    // Рефералка
    if (state.referral) {
        const r = state.referral;
        html += `
            <div class="card">
                <div class="card-title">Пригласи друга</div>
                <div class="card-subtitle">За каждого друга: +${r.referral_days} дней VIP</div>
                <div class="card-subtitle">Пришло по ссылке: ${r.total}</div>
                <div class="card-subtitle">Засчитано: ${r.rewarded}</div>
                <div class="card-subtitle">Заработано дней: ${r.days}</div>
                <div style="margin-top:8px;word-break:break-all;font-size:13px;color:var(--text-secondary)">${escapeHtml(r.link)}</div>
                <div class="actions-row">
                    <button class="btn btn-secondary" data-action="copy-referral">Скопировать ссылку</button>
                </div>
            </div>
        `;
    }

    // Обратная связь
    html += `
        <div class="card">
            <div class="card-title">Обратная связь</div>
            <textarea class="input" id="feedback-text" placeholder="Напиши сообщение админу..." rows="3"></textarea>
            <button class="btn" data-action="feedback-send">Отправить</button>
        </div>
    `;

    return html;
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ
// ============================================================
async function loadSchedule() {
    try {
        state.schedule = await apiGet('/api/schedule');
    } catch (e) {
        state.schedule = { error: 'load_error', message: e.message };
    }
}

async function loadTasks() {
    try {
        const doneParam = state.tasksView === 'done' ? '1' : '0';
        const r = await apiGet('/api/tasks', { done: doneParam });
        state.tasks = r.tasks || [];
        state.tasksStats = { active: r.active || 0, done: r.done || 0 };
    } catch (e) {
        state.tasks = [];
    }
}

async function loadNotes() {
    try {
        const r = await apiGet('/api/notes');
        state.notes = r.notes || [];
    } catch (e) {
        state.notes = [];
    }
}

async function loadProfile() {
    try {
        state.profile = await apiGet('/api/me');
    } catch (e) {
        state.profile = { error: e.message };
    }
}

async function loadVIP() {
    try {
        state.vip = await apiGet('/api/vip');
    } catch (e) {
        state.vip = { is_vip: false };
    }
}

async function loadScholarship() {
    if (!state.vip?.is_vip) {
        state.scholarship = null;
        return;
    }
    try {
        state.scholarship = await apiGet('/api/scholarship');
    } catch (e) {
        state.scholarship = null;
    }
}

async function loadReferral() {
    try {
        state.referral = await apiGet('/api/referral');
    } catch (e) {
        state.referral = null;
    }
}

async function loadGroups() {
    if (state.groups) return;
    try {
        const r = await apiGet('/api/groups');
        state.groups = r.groups;
    } catch (e) {
        state.groups = {};
    }
}

async function loadTabData(tab) {
    state.loading = true;
    state.error = null;
    render();

    try {
        if (tab === 'schedule') {
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
async function actionSetSubgroup(value) {
    try {
        await apiPost('/api/set-subgroup', { subgroup: value });
        state.profile.subgroup = value;
        haptic('success');
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionNotifySet(hour) {
    try {
        await apiPost('/api/notify-set', { hour: hour, minute: 0, changes: state.profile?.notify_changes });
        state.profile.notify_time = hour >= 0 ? `${String(hour).padStart(2, '0')}:00` : null;
        haptic('success');
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
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
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionQuoteSubscribe(value) {
    try {
        await apiPost('/api/quote-subscribe', { subscribe: value === 1 });
        if (state.profile) state.profile.daily_subscribed = value === 1;
        haptic('success');
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionFeedbackSend() {
    const el = document.getElementById('feedback-text');
    if (!el) return;
    const text = (el.value || '').trim();
    if (!text) return;
    try {
        await apiPost('/api/feedback', { text: text });
        el.value = '';
        haptic('success');
        alert('Отправлено');
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionTaskDone(id) {
    try {
        await apiPost('/api/task-update', { id: id, done: true });
        haptic('success');
        await loadTasks();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionTaskDelete(id) {
    if (!confirm('Удалить задачу?')) return;
    try {
        await apiPost('/api/task-delete', { id: id });
        haptic('success');
        await loadTasks();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionTasksClear() {
    if (!confirm('Очистить все выполненные?')) return;
    try {
        await apiPost('/api/task-clear');
        haptic('success');
        await loadTasks();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
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
        await apiPost('/api/task-add', {
            text: text, due_date: due_date, due_time: due_time, priority: priority,
        });
        haptic('success');
        await loadTasks();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionTaskEdit(id) {
    const newText = prompt('Новый текст задачи:');
    if (!newText) return;
    try {
        await apiPost('/api/task-update', { id: id, text: newText });
        haptic('success');
        await loadTasks();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionNoteDelete(id) {
    if (!confirm('Удалить заметку?')) return;
    try {
        await apiPost('/api/note-delete', { id: id });
        haptic('success');
        await loadNotes();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionNoteAdd() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const text = prompt('Текст заметки:');
    if (!text) return;
    try {
        await apiPost('/api/note-save', { subject: subject, text: text });
        haptic('success');
        await loadNotes();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionNoteEdit(id) {
    const text = prompt('Новый текст заметки:');
    if (!text) return;
    // Нам нужен subject — найдём в state.notes
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    try {
        await apiPost('/api/note-save', { subject: note.subject, text: text });
        haptic('success');
        await loadNotes();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionScholarshipSetAmount() {
    const amount = prompt('Сумма стипендии (руб/мес, 0 если не получаешь):');
    if (amount === null) return;
    try {
        await apiPost('/api/scholarship-set-amount', { amount: parseInt(amount) || 0 });
        haptic('success');
        await loadScholarship();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionScholarshipAddGrade() {
    const subject = prompt('Название предмета:');
    if (!subject) return;
    const gradeStr = prompt('Оценка (2, 3, 4 или 5):');
    const grade = parseInt(gradeStr);
    if (![2, 3, 4, 5].includes(grade)) {
        alert('Нужно 2, 3, 4 или 5');
        return;
    }
    try {
        await apiPost('/api/scholarship-add-grade', { subject: subject, grade: grade });
        haptic('success');
        await loadScholarship();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionScholarshipClear() {
    if (!confirm('Очистить все оценки?')) return;
    try {
        await apiPost('/api/scholarship-clear');
        haptic('success');
        await loadScholarship();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
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
        const r = await apiPost('/api/ai', { question: question });
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
    if (!instStr || !state.groups[instStr]) {
        alert('Институт не найден');
        return;
    }
    const groups = state.groups[instStr];
    const groupList = groups.map(g => `${g.name} (id ${g.id})`).join('\n');
    const groupStr = prompt('Группа (одно из):\n' + groupList);
    if (!groupStr) return;
    let selected = null;
    for (const g of groups) {
        if (groupStr.includes(g.id) || groupStr.includes(g.name)) {
            selected = g;
            break;
        }
    }
    if (!selected) {
        alert('Группа не найдена');
        return;
    }
    try {
        await apiPost('/api/set-group', {
            group_id: selected.id,
            group_name: selected.name,
            subgroup: state.profile?.subgroup || 0,
        });
        haptic('success');
        await loadProfile();
        await loadSchedule();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

async function actionForgetGroup() {
    if (!confirm('Забыть группу?')) return;
    try {
        await apiPost('/api/set-group', { group_id: '', group_name: '', subgroup: 0 });
        // очищаем группу
        state.profile.group = null;
        state.profile.group_id = null;
        haptic('success');
        await loadProfile();
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}

function actionCopyReferral() {
    if (!state.referral) return;
    try {
        navigator.clipboard.writeText(state.referral.link);
        haptic('success');
        alert('Ссылка скопирована');
    } catch (e) {
        alert('Не удалось скопировать');
    }
}

function actionVipBuy() {
    tg.openTelegramLink('https://t.me/ilyaech');
}

// ============================================================
// ПОДКЛЮЧЕНИЕ ОБРАБОТЧИКОВ
// ============================================================
function attachHandlers() {
    document.querySelectorAll('[data-action]').forEach((el) => {
        el.addEventListener('click', () => handleAction(el));
    });

    const notifyCb = document.getElementById('notify-changes');
    if (notifyCb) {
        notifyCb.addEventListener('change', actionNotifyChangesToggle);
    }
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
    else if (a === 'vip-buy') actionVipBuy();
    else if (a === 'week-prev') { state.weekOffset -= 1; loadWeekAndRender(); }
    else if (a === 'week-next') { state.weekOffset += 1; loadWeekAndRender(); }
    else if (a === 'week-today') { state.weekOffset = 0; loadWeekAndRender(); }
}

async function loadWeekAndRender() {
    try {
        const r = await apiGet('/api/week', { offset: state.weekOffset });
        if (r.days && r.days.length > 0) {
            // Показываем первый день недели как «сегодня» — или все дни
            // Для простоты: соберём расписание на первый день с занятиями
            const day = r.days[0];
            state.schedule = {
                date: day.date,
                dayName: day.name,
                group: r.group,
                subgroup: r.subgroup,
                lessons: day.lessons,
            };
        }
        render();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
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
    await loadTabData(state.tab);
});

// ============================================================
// СТАРТ
// ============================================================
(async function init() {
    await loadTabData(state.tab);
})();
