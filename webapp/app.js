// ============================================================
// TELEGRAM WEB APP
// ============================================================
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Данные пользователя из Telegram
const tgUser = tg.initDataUnsafe?.user || {
    first_name: 'Гость',
    last_name: '',
    username: '',
    id: 0,
};

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
    profile: {
        group: null,
        subgroup: 0,
        isVip: false,
        vipUntil: null,
    },
};

// ============================================================
// API (пока заглушка — потом заменим на реальный бэкенд)
// ============================================================
const API = {
    async fetchSchedule() {
        // TODO: заменить на реальный запрос к твоему бэкенду
        // return fetch('/api/schedule').then(r => r.json());
        return getMockSchedule();
    },

    async fetchTasks() {
        // return fetch('/api/tasks').then(r => r.json());
        return getMockTasks();
    },

    async fetchNotes() {
        // return fetch('/api/notes').then(r => r.json());
        return getMockNotes();
    },

    async fetchProfile() {
        // return fetch('/api/profile').then(r => r.json());
        return getMockProfile();
    },
};

// ============================================================
// МОК-ДАННЫЕ (пока нет API)
// ============================================================
function getMockSchedule() {
    return {
        date: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        dayName: new Date().toLocaleDateString('ru-RU', { weekday: 'long' }),
        lessons: [
            {
                time: '08:15',
                timeEnd: '09:45',
                subject: 'Математический анализ',
                type: 'Лекция',
                teacher: 'Иванов И.И.',
                auditorium: 'А-315',
                subgroup: '',
            },
            {
                time: '10:00',
                timeEnd: '11:30',
                subject: 'Физика',
                type: 'Практика',
                teacher: 'Петров П.П.',
                auditorium: 'Б-210',
                subgroup: '1',
            },
            {
                time: '12:00',
                timeEnd: '13:30',
                subject: 'Программирование',
                type: 'Лабораторная',
                teacher: 'Сидоров С.С.',
                auditorium: 'В-105',
                subgroup: '2',
            },
            {
                time: '14:00',
                timeEnd: '15:30',
                subject: 'История',
                type: 'Семинар',
                teacher: 'Кузнецова А.А.',
                auditorium: 'Г-401',
                subgroup: '',
            },
        ],
    };
}

function getMockTasks() {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    const yesterday = new Date(now.getTime() - 86400000);

    return [
        {
            id: 1,
            text: 'Сдать лабу по физике',
            due: tomorrow.toLocaleDateString('ru-RU'),
            dueTime: '18:00',
            priority: 2, // высокий
            overdue: false,
        },
        {
            id: 2,
            text: 'Подготовиться к коллоквиуму по матану',
            due: tomorrow.toLocaleDateString('ru-RU'),
            dueTime: '',
            priority: 1,
            overdue: false,
        },
        {
            id: 3,
            text: 'Курсовая по программированию — глава 2',
            due: yesterday.toLocaleDateString('ru-RU'),
            dueTime: '',
            priority: 2,
            overdue: true,
        },
        {
            id: 4,
            text: 'Купить учебник по истории',
            due: '',
            dueTime: '',
            priority: 0,
            overdue: false,
        },
    ];
}

function getMockNotes() {
    return [
        { id: 1, subject: 'Матан', text: 'Пределы, производные, интегралы. Формулы на стр. 45.' },
        { id: 2, subject: 'Физика', text: 'Лаба №3 — измерение ускорения свободного падения.' },
        { id: 3, subject: 'Программирование', text: 'Сдать до 25.10. Тема: сортировки.' },
    ];
}

function getMockProfile() {
    return {
        group: 'ИСТб-26-1',
        subgroup: 0,
        isVip: false,
        vipUntil: null,
    };
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

// ============================================================
// РЕНДЕР: РАСПИСАНИЕ
// ============================================================
function renderSchedule() {
    const s = state.schedule;
    if (!s) return renderEmpty('Нет данных о расписании');

    let html = `<div class="day-header">${escapeHtml(s.dayName)}, ${escapeHtml(s.date)}</div>`;

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
// РЕНДЕР: ЗАДАЧИ
// ============================================================
function priorityLabel(p) {
    if (p === 2) return '<span class="priority priority-high">Высокий</span>';
    if (p === 1) return '<span class="priority priority-medium">Средний</span>';
    return '<span class="priority priority-low">Низкий</span>';
}

function renderTasks() {
    if (!state.tasks || state.tasks.length === 0) {
        return renderEmpty('Нет активных задач');
    }

    let html = '';
    for (const t of state.tasks) {
        const dueParts = [];
        if (t.due) {
            dueParts.push(t.dueTime ? `${t.due} ${t.dueTime}` : t.due);
        }
        const dueClass = t.overdue ? 'overdue' : '';
        const dueStr = dueParts.length
            ? `<span class="${dueClass}">до ${escapeHtml(dueParts[0])}${t.overdue ? ' — просрочено' : ''}</span>`
            : '';

        html += `
            <div class="card">
                <div class="card-title">${escapeHtml(t.text)}</div>
                <div class="card-meta">
                    ${priorityLabel(t.priority)}
                    ${dueStr}
                </div>
            </div>
        `;
    }
    return html;
}

// ============================================================
// РЕНДЕР: ЗАМЕТКИ
// ============================================================
function renderNotes() {
    if (!state.notes || state.notes.length === 0) {
        return renderEmpty('Нет заметок');
    }

    let html = '';
    for (const n of state.notes) {
        html += `
            <div class="card">
                <div class="card-title">${escapeHtml(n.subject)}</div>
                <div class="card-subtitle">${escapeHtml(n.text)}</div>
            </div>
        `;
    }
    return html;
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
    if (p.group) {
        metaParts.push(p.group + (p.subgroup ? ` (подгр. ${p.subgroup})` : ''));
    }
    if (u.username) metaParts.push('@' + u.username);

    return `
        <div class="profile-header">
            <div class="profile-avatar">${escapeHtml(initials)}</div>
            <div class="profile-name">${escapeHtml(fullName)}</div>
            ${metaParts.length ? `<div class="profile-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
            ${p.isVip ? '<div class="badge">VIP</div>' : ''}
        </div>
    `;
}

// ============================================================
// ЗАГРУЗКА ДАННЫХ ПОД ТЕКУЩУЮ ВКЛАДКУ
// ============================================================
async function loadTabData(tab) {
    state.loading = true;

    try {
        if (tab === 'schedule' && !state.schedule) {
            state.schedule = await API.fetchSchedule();
        } else if (tab === 'tasks' && state.tasks.length === 0) {
            state.tasks = await API.fetchTasks();
        } else if (tab === 'notes' && state.notes.length === 0) {
            state.notes = await API.fetchNotes();
        } else if (tab === 'profile' && !state.profile.group) {
            state.profile = await API.fetchProfile();
        }
    } catch (e) {
        console.error('Ошибка загрузки:', e);
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
        render();
        await loadTabData(tab);
    });
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
    state.schedule = null;
    state.tasks = [];
    state.notes = [];
    state.profile = { group: null, subgroup: 0, isVip: false, vipUntil: null };
    await loadTabData(state.tab);
    tg.HapticFeedback?.impactOccurred('light');
});

// ============================================================
// СТАРТ
// ============================================================
(async function init() {
    await loadTabData(state.tab);
})();
