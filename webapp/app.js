// ============================================================
// TELEGRAM WEB APP
// ============================================================
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const tgUser = tg.initDataUnsafe?.user || {
    first_name: 'Гость',
    last_name: '',
    username: '',
    id: 0,
};

// initData нужен для запросов к API
const INIT_DATA = tg.initData || '';

// ============================================================
// СОСТОЯНИЕ
// ============================================================
const state = {
    tab: 'schedule',
    loading: false,
    user: tgUser,
    schedule: null,
    tasks: [],
    notes: [],
    profile: null,
    error: null,
};

// ============================================================
// API
// ============================================================
async function apiFetch(path) {
    const url = `${path}?initData=${encodeURIComponent(INIT_DATA)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

const API = {
    async fetchSchedule() {
        return await apiFetch('/api/schedule');
    },
    async fetchProfile() {
        return await apiFetch('/api/me');
    },
};

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

// ============================================================
// РЕНДЕР: РАСПИСАНИЕ
// ============================================================
function renderSchedule() {
    const s = state.schedule;
    if (!s) return renderEmpty('Нет данных о расписании');
    if (s.error) return renderEmpty(s.message || 'Ошибка загрузки');

    const header = s.dayName ? `${s.dayName}, ${s.date}` : s.date || '';
    let html = `<div class="day-header">${escapeHtml(header)}</div>`;

    if (s.group) {
        html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(s.group)}${
            s.subgroup ? ` · подгруппа ${escapeHtml(s.subgroup)}` : ''
        }</div>`;
    }

    if (!s.lessons || s.lessons.length === 0) {
        html += renderEmpty('Занятий нет');
        return html;
    }

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
    return html;
}

// ============================================================
// РЕНДЕР: ЗАГЛУШКИ ДЛЯ ОСТАЛЬНЫХ ВКЛАДОК
// ============================================================
function renderTasks() {
    return renderEmpty('Раздел задач скоро появится');
}
function renderNotes() {
    return renderEmpty('Раздел заметок скоро появится');
}

// ============================================================
// РЕНДЕР: ПРОФИЛЬ
// ============================================================
function renderProfile() {
    const p = state.profile;
    const u = state.user;
    const initials = (
        (u.first_name?.[0] || '') + (u.last_name?.[0] || '')
    ).toUpperCase() || '?';
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Гость';

    const metaParts = [];
    if (p?.group) {
        metaParts.push(p.group + (p.subgroup ? ` (подгр. ${p.subgroup})` : ''));
    }
    if (u.username) metaParts.push('@' + u.username);

    let statsHtml = '';
    if (p) {
        statsHtml = `
            <div class="card" style="margin-top:20px;width:100%;max-width:400px">
                <div class="card-title">Статистика</div>
                <div class="card-subtitle">Активных задач: ${escapeHtml(p.tasks_active ?? 0)}</div>
                <div class="card-subtitle">Выполнено: ${escapeHtml(p.tasks_done ?? 0)}</div>
                <div class="card-subtitle">Заметок: ${escapeHtml(p.notes_count ?? 0)}</div>
            </div>
        `;
    }

    return `
        <div class="profile-header">
            <div class="profile-avatar">${escapeHtml(initials)}</div>
            <div class="profile-name">${escapeHtml(fullName)}</div>
            ${metaParts.length ? `<div class="profile-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
            ${p?.is_vip ? '<div class="badge">VIP</div>' : ''}
        </div>
        ${statsHtml}
    `;
}

// ============================================================
// ЗАГРУЗКА
// ============================================================
async function loadTabData(tab) {
    state.loading = true;
    state.error = null;
    render();

    try {
        if (tab === 'schedule') {
            state.schedule = await API.fetchSchedule();
        } else if (tab === 'profile') {
            state.profile = await API.fetchProfile();
        }
    } catch (e) {
        console.error('Ошибка загрузки:', e);
        state.error = e.message;
    }

    state.loading = false;
    render();
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
        profile: 'Профиль',
    };
    title.textContent = titles[state.tab] || 'Студент';

    let html = '';
    if (state.loading) {
        html = '<div class="loading">Загрузка...</div>';
    } else if (state.error) {
        html = renderEmpty('Ошибка: ' + state.error);
    } else if (state.tab === 'schedule') {
        html = renderSchedule();
    } else if (state.tab === 'tasks') {
        html = renderTasks();
    } else if (state.tab === 'notes') {
        html = renderNotes();
    } else if (state.tab === 'profile') {
        html = renderProfile();
    }

    content.innerHTML = html;

    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });
}

// ============================================================
// СОБЫТИЯ
// ============================================================
document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        if (state.tab === tab) return;
        state.tab = tab;
        await loadTabData(tab);
        tg.HapticFeedback?.impactOccurred('light');
    });
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
    state.schedule = null;
    state.profile = null;
    await loadTabData(state.tab);
    tg.HapticFeedback?.impactOccurred('light');
});

// ============================================================
// СТАРТ
// ============================================================
(async function init() {
    await loadTabData(state.tab);
})();
