const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
try { tg.requestFullscreen?.(); } catch(e){}
try { tg.lockOrientation?.('portrait'); } catch(e){}
try { tg.disableVerticalSwipes?.(); } catch(e){}
try { tg.enableClosingConfirmation?.(); } catch(e){}

const tgUser = tg.initDataUnsafe?.user || { first_name:'Гость', last_name:'', username:'', id:0 };
const INIT_DATA = tg.initData || '';

function applyColorScheme() {
  const scheme = tg.colorScheme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', scheme === 'dark' ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', scheme === 'dark' ? '#0F1418' : '#3EE6D2');
}
applyColorScheme();
try { tg.onEvent('themeChanged', applyColorScheme); } catch(e){}
try {
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!tg.colorScheme) applyColorScheme();
    });
  }
} catch(e){}

setTimeout(() => {
  const sp = document.getElementById('splash');
  const app = document.getElementById('app');
  if (sp) sp.classList.add('hide');
  if (app) app.style.display = '';
  setTimeout(() => { if (sp) sp.remove(); }, 600);
}, 3700);

const state = {
  tab:'schedule', loading:false, error:null, user:tgUser, isAdmin:false,
  schedule:null, weekDays:null, weekOffset:0, scheduleViewMode:'today', scheduleDay:'today',
  tasks:[], tasksStats:{active:0,done:0}, tasksView:'active',
  tasksSearch:'', tasksSort:'due', tasksTag:'', tasksTags:[], tasksStatsFull:{total_done:0, streak:0},
  tasksDebtsCount:0,
  notes:[], notesSubjects:[], notesSearch:'', notesTag:'', notesTags:[],
  profile:null, scholarship:null, groups:null,
  pickerMode:null, pickerInstitute:null, pickerCourse:null, pickerSearch:'',
  notifyEditor:false, notifyEditorType:'today', notifyEditorHour:8, notifyEditorMinute:0,
  aiMessages:[], aiPending:false, aiPendingPhoto:null,
  adminStats:null, adminFeedback:[], adminMonitor:null,
  schFilterSemester:'',
  presentForm:{ topic:'', info:'', wishes:'', slides:10, style:'random',
                author:'', group:'', teacher:'', year:'' },
  presentBuilding:false,
  weather:null, weatherLine:'',
  attendanceSemester:null,
};

function icon(id, size=16, cls='') {
  return `<svg width="${size}" height="${size}" class="${cls}"><use href="#${id}"/></svg>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function haptic(t='light') {
  try {
    if (t==='light') tg.HapticFeedback?.impactOccurred('light');
    else if (t==='medium') tg.HapticFeedback?.impactOccurred('medium');
    else if (t==='success') tg.HapticFeedback?.notificationOccurred('success');
    else if (t==='error') tg.HapticFeedback?.notificationOccurred('error');
  } catch(e){}
}
function hideKeyboard(){
  try { document.activeElement?.blur?.(); } catch(e){}
  try { window.Telegram?.WebApp?.hideKeyboard?.(); } catch(e){}
}

async function apiGet(path, params={}) {
  const url = new URL(path, location.origin);
  url.searchParams.set('initData', INIT_DATA);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) {
    const err = await r.json().catch(()=>({}));
    throw new Error(err.message || err.error || `HTTP ${r.status}`);
  }
  return r.json();
}
async function apiPost(path, body={}) {
  const r = await fetch(path, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({initData:INIT_DATA, ...body})
  });
  if (!r.ok) {
    const err = await r.json().catch(()=>({}));
    const e = new Error(err.message || err.error || `HTTP ${r.status}`);
    e.code = err.error;
    e.data = err;
    throw e;
  }
  return r.json();
}

function toast(text, type='info') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = String(text || '').trim();
  wrap.appendChild(el);
  setTimeout(()=>{
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    setTimeout(()=>el.remove(), 300);
  }, 2400);
}
function modalOpen({title, body, actions}) {
  const m = document.getElementById('modal');
  document.getElementById('modalTitle').innerHTML = title;
  document.getElementById('modalBody').innerHTML = body;
  const acts = document.getElementById('modalActions');
  acts.innerHTML = '';
  (actions||[]).forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.style || '');
    b.innerHTML = a.label;
    b.onclick = () => {
      if (!a.keepOpen) modalClose();
      a.onClick && a.onClick();
    };
    acts.appendChild(b);
  });
  m.style.display = 'flex';
  m.querySelector('.modal-backdrop').onclick = modalClose;
}
function modalClose() { document.getElementById('modal').style.display = 'none'; }
function modalConfirm(title, text, onYes, yesLabel='ПОДТВЕРДИТЬ') {
  modalOpen({
    title, body: text,
    actions: [
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:yesLabel, style:'btn-red', onClick:onYes}
    ]
  });
}

function nowIrkutsk() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}
function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function findDayByDate(days, dateStr) {
  if (!days) return null;
  for (const d of days) if (d.date === dateStr) return d;
  return null;
}
function renderMarkdownLight(text) {
  if (!text) return '';
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<i>$2</i>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

function findNextLesson(lessons) {
  if (!lessons || !lessons.length) return null;
  const now = nowIrkutsk();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const les of lessons) {
    const t = (les.time || '').split(':');
    if (t.length !== 2) continue;
    const m = parseInt(t[0],10) * 60 + parseInt(t[1],10);
    if (isNaN(m)) continue;
    if (m + 90 >= nowMin) return { les, minutesLeft: m - nowMin };
  }
  return null;
}

/* ═════ НАВИГАЦИЯ: перерисовка кнопок с учётом isAdmin ═════ */
function renderNav() {
  document.querySelectorAll('.nav-btn').forEach(b => {
    const isAdmin = b.dataset.tab === 'admin';
    b.style.display = (isAdmin && !state.isAdmin) ? 'none' : '';
    b.classList.toggle('active', b.dataset.tab === state.tab);
  });
}

function render() {
  const content = document.getElementById('content');
  const title = document.getElementById('page-title');
  const appEl = document.getElementById('app');
  const navEl = document.getElementById('bottom-nav');
  const titles = {schedule:'Расписание', tasks:'Задачи', notes:'Заметки',
    ai:'AI', admin:'Админ', profile:'Профиль'};

  if (state.notifyEditor) {
    appEl?.classList.add('picker-open');
    document.body.classList.add('picker-open');
    title.textContent = 'Уведомления';
    navEl.style.display = 'none';
    content.innerHTML = renderNotifyEditor();
    attachHandlers();
    setTimeout(notifyAttachInputHandlers, 30);
    return;
  }
  if (state.pickerMode) {
    appEl?.classList.add('picker-open');
    document.body.classList.add('picker-open');
    title.textContent = state.pickerMode === 'institute' ? 'Институт'
      : state.pickerMode === 'course' ? 'Курс' : 'Группа';
    navEl.style.display = 'none';
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
  document.body.classList.remove('picker-open');
  navEl.style.display = '';

  title.textContent = titles[state.tab] || 'Студент';

  let html = '';
  if (state.loading) html = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  else if (state.error) html = `<div class="empty">Ошибка: ${escapeHtml(state.error)}</div>`;
  else {
    switch(state.tab) {
      case 'schedule': html = renderSchedule(); break;
      case 'tasks': html = renderTasks(); break;
      case 'notes': html = renderNotes(); break;
      case 'ai': html = renderAI(); break;
      case 'admin': html = renderAdmin(); break;
      case 'profile': html = renderProfile(); break;
    }
  }
  content.innerHTML = html;
  renderNav();
  attachHandlers();
  if (state.tab === 'schedule' && !state.loading) attachSwipe();
}

function renderWeatherWidget() {
  if (!state.weatherLine) return '';
  return `<div class="weather-widget">${escapeHtml(state.weatherLine)}</div>`;
}

function renderNextLessonWidget() {
  const s = state.schedule;
  if (!s || !s.lessons || !s.lessons.length) return '';
  const nx = findNextLesson(s.lessons);
  if (!nx) return '';
  const les = nx.les;
  const minLeft = nx.minutesLeft;
  let timeStr = '';
  if (minLeft > 0) {
    const h = Math.floor(minLeft / 60);
    const m = minLeft % 60;
    if (h > 0) timeStr = `через ${h} ч ${m} мин`;
    else timeStr = `через ${m} мин`;
  } else if (minLeft > -90) {
    timeStr = 'сейчас';
  }
  const aud = les.auditorium ? ` · ауд. ${escapeHtml(les.auditorium)}` : '';
  return `<div class="next-lesson-widget">
    <div class="nlw-label">Следующая пара · ${escapeHtml(timeStr)}</div>
    <div class="nlw-subject">${escapeHtml(les.subject)}</div>
    <div class="nlw-meta">${escapeHtml(les.time)}${aud}</div>
  </div>`;
}

function renderLesson(les) {
  const timeRange = les.timeEnd ? `${les.time} – ${les.timeEnd}` : les.time;
  const details = [];
  if (les.teacher) details.push(escapeHtml(les.teacher));
  if (les.auditorium) details.push(`ауд. ${escapeHtml(les.auditorium)}`);
  const att = les.attendance || '';
  const date = les.date || '';
  const subj = les.subject || '';
  const time = les.time || '';
  return `<div class="lesson">
    <div class="lesson-time">${escapeHtml(timeRange)}</div>
    <div class="lesson-body">
      <div class="lesson-subject">${escapeHtml(les.subject)}${les.type ? ` <span style="color:var(--text-2);font-weight:400">(${escapeHtml(les.type)})</span>` : ''}</div>
      ${details.length ? `<div class="lesson-details">${details.join(' · ')}</div>` : ''}
      ${les.subgroup ? `<div class="lesson-group">подгруппа ${escapeHtml(les.subgroup)}</div>` : ''}
      ${date ? `<div class="att-row">
        <button class="att-circle ${att==='was'?'on-was':''}" data-att="was"
          data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}" data-subject="${escapeHtml(subj)}"
          title="Был">${icon('ic-was',18)}</button>
        <button class="att-circle ${att==='missed'?'on-missed':''}" data-att="missed"
          data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}" data-subject="${escapeHtml(subj)}"
          title="Пропустил">${icon('ic-missed',18)}</button>
        <button class="att-circle ${att==='sick'?'on-sick':''}" data-att="sick"
          data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}" data-subject="${escapeHtml(subj)}"
          title="Болел">${icon('ic-sick',18)}</button>
        <button class="att-circle ${att==='excused'?'on-excused':''}" data-att="excused"
          data-date="${escapeHtml(date)}" data-time="${escapeHtml(time)}" data-subject="${escapeHtml(subj)}"
          title="Уважительная">${icon('ic-excused',18)}</button>
        <button class="att-help" data-action="att-help">${icon('ic-help',20)}</button>
      </div>` : ''}
    </div>
  </div>`;
}
function renderDaySwitch() {
  return `<div class="day-switch">
    <button data-action="day-today" class="${state.scheduleDay==='today'?'active':''}">Сегодня</button>
    <button data-action="day-tomorrow" class="${state.scheduleDay==='tomorrow'?'active':''}">Завтра</button>
  </div>`;
}
function renderDayCard(day, label) {
  let html = `<div class="day-header">${escapeHtml(label)}${day.name ? ' · ' + escapeHtml(day.name) : ''}${day.date ? ', ' + escapeHtml(day.date) : ''}</div>`;
  const p = state.profile;
  if (p?.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(p.group)}${p.subgroup?` · подгруппа ${escapeHtml(p.subgroup)}`:''}</div>`;
  if (!day.lessons?.length) html += '<div class="empty">Занятий нет</div>';
  else for (const les of day.lessons) html += renderLesson(les);
  return html;
}
function renderSchedule() {
  const s = state.schedule;
  if (s?.error === 'no_group' || (state.profile && !state.profile.group)) {
    return `${renderWeatherWidget()}<div class="card">
      <div class="card-title">Как начать</div>
      <div class="card-subtitle">1. Открой профиль и нажми «Выбрать группу»</div>
      <div class="card-subtitle">2. Укажи институт, курс и группу</div>
      <div class="card-subtitle">3. Вернись — расписание появится</div>
      <div class="actions-row"><button class="btn" data-action="go-profile">Выбрать группу</button></div>
    </div>`;
  }
  let html = renderWeatherWidget();
  html += renderNextLessonWidget();
  html += renderDaySwitch();
  html += `<div class="swipe-wrap"><div class="swipe-pane" id="swipePane">`;
  if (state.scheduleViewMode === 'week' && state.weekDays) html += renderWeekView();
  else if (state.scheduleDay === 'tomorrow') html += renderTomorrowBlock();
  else if (state.scheduleDay === 'today') html += renderTodayBlock();
  html += `</div></div>`;
  html += `<div class="actions-row" style="margin-top:16px">
    <button class="btn btn-secondary" data-action="week-prev">${icon('ic-chevron-left',16)} Прошлая</button>
    <button class="btn btn-secondary" data-action="week-current">Текущая</button>
    <button class="btn btn-secondary" data-action="week-next">Следующая ${icon('ic-chevron-right',16)}</button>
  </div>`;
  html += `<div class="actions-row" style="margin-top:8px">
    <button class="btn btn-secondary" data-action="export-ics" style="flex:1">В календарь (.ics)</button>
  </div>`;
  return html;
}

function renderTodayBlock() {
  const s = state.schedule;
  if (!s) return '<div class="empty">Нет данных о расписании</div>';
  if (s.error) return `<div class="empty">${escapeHtml(s.message||'Ошибка загрузки')}</div>`;
  const header = s.dayName ? `${s.dayName}, ${s.date}` : s.date || '';
  let html = `<div class="day-header">${escapeHtml(header)}</div>`;
  if (s.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(s.group)}${s.subgroup?` · подгруппа ${escapeHtml(s.subgroup)}`:''}</div>`;
  if (!s.lessons?.length) html += '<div class="empty">Занятий нет</div>';
  else for (const les of s.lessons) html += renderLesson(les);
  return html;
}
function renderTomorrowBlock() {
  const wd = state.weekDays;
  const tomorrow = addDays(nowIrkutsk(), 1);
  const tomorrowStr = fmtDate(tomorrow);
  if (!wd?.days?.length) return '<div class="skeleton-card"></div>';
  let day = findDayByDate(wd.days, tomorrowStr);
  if (!day) return `<div class="empty">Расписание на завтра (${tomorrowStr}) пока недоступно.</div>`;
  return renderDayCard(day, 'Завтра');
}
function renderWeekView() {
  const wd = state.weekDays;
  if (!wd?.days?.length) return '<div class="empty">Не удалось загрузить</div>';
  let title;
  if (state.weekOffset === 0) title = 'Текущая неделя';
  else if (state.weekOffset > 0) title = `Неделя +${state.weekOffset}`;
  else title = `Неделя ${state.weekOffset}`;
  let html = `<div class="day-header">${escapeHtml(title)}</div>`;
  if (wd.group) html += `<div class="lesson-group" style="margin-bottom:8px">Группа: ${escapeHtml(wd.group)}${wd.subgroup?` · подгруппа ${escapeHtml(wd.subgroup)}`:''}</div>`;
  for (const day of wd.days) {
    html += `<div class="day-header" style="margin-top:16px">${escapeHtml(day.name || day.date)}${day.date ? ' · ' + escapeHtml(day.date) : ''}</div>`;
    if (!day.lessons?.length) html += '<div class="card-subtitle" style="padding:8px 0">Занятий нет</div>';
    else for (const les of day.lessons) html += renderLesson(les);
  }
  return html;
}
function attachSwipe() {
  const wrap = document.querySelector('.swipe-wrap');
  const pane = document.getElementById('swipePane');
  if (!wrap || !pane) return;
  let startX = 0, startY = 0, dx = 0, active = false, locked = false;
  wrap.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    dx = 0; active = true; locked = false;
    pane.style.transition = 'none';
  }, {passive:true});
  wrap.addEventListener('touchmove', (e) => {
    if (!active) return;
    const t = e.touches[0];
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;
    if (!locked) {
      if (Math.abs(ddx) > Math.abs(ddy) + 6) locked = true;
      else if (Math.abs(ddy) > 8) { active = false; return; }
    }
    if (locked) {
      dx = ddx;
      pane.style.transform = `translateX(${dx * 0.45}px)`;
    }
  }, {passive:true});
  wrap.addEventListener('touchend', () => {
    if (!active) return;
    active = false;
    pane.style.transition = '';
    pane.style.transform = '';
    if (dx < -70 && state.scheduleDay === 'today') { haptic('light'); actionDayTomorrow(); }
    else if (dx > 70 && state.scheduleDay === 'tomorrow') { haptic('light'); actionDayToday(); }
    dx = 0;
  });
}

function getCourseFromGroup(name) {
  const m = String(name).match(/-(\d{2})-/);
  if (!m) return null;
  const map = {26:1, 25:2, 24:3, 23:4, 22:5, 21:6};
  return map[parseInt(m[1],10)] || null;
}
function getCoursesForInstitute(inst) {
  const groups = (state.groups && state.groups[inst]) || [];
  const set = new Set();
  for (const g of groups) { const c = getCourseFromGroup(g.name); if (c) set.add(c); }
  return Array.from(set).sort((a,b)=>a-b);
}
function renderInstitutePicker() {
  const groups = state.groups || {};
  const institutes = Object.keys(groups);
  let html = `<div class="picker-header">
    <button class="picker-back" data-action="picker-back">${icon('ic-chevron-left',20)}</button>
    <div class="picker-title">Выбери институт</div>
  </div>`;
  if (!institutes.length) { html += '<div class="picker-empty">Список не загружен</div>'; return html; }
  html += '<div class="picker-list">';
  for (const inst of institutes) {
    const count = groups[inst]?.length || 0;
    const selected = state.profile?.group && groups[inst]?.some(g => g.name === state.profile.group);
    html += `<button class="picker-item ${selected?'selected':''}" data-action="picker-choose-institute" data-value="${escapeHtml(inst)}">
      <div class="picker-group-item"><span>${escapeHtml(inst)}</span><span class="picker-item-sub">${count} групп</span></div>
      <span class="picker-item-arrow">${icon('ic-chevron-right',18)}</span>
    </button>`;
  }
  html += '</div>';
  return html;
}
function renderCoursePicker() {
  const inst = state.pickerInstitute;
  const courses = getCoursesForInstitute(inst);
  let html = `<div class="picker-header">
    <button class="picker-back" data-action="picker-back">${icon('ic-chevron-left',20)}</button>
    <div class="picker-title">${escapeHtml(inst)} · Курс</div>
  </div>`;
  if (!courses.length) { html += '<div class="picker-empty">Нет курсов</div>'; return html; }
  const groups = (state.groups && state.groups[inst]) || [];
  html += '<div class="picker-list">';
  for (const c of courses) {
    const count = groups.filter(g => getCourseFromGroup(g.name) === c).length;
    html += `<button class="picker-item" data-action="picker-choose-course" data-value="${c}">
      <div class="picker-group-item"><span>${c} курс</span><span class="picker-item-sub">${count} групп</span></div>
      <span class="picker-item-arrow">${icon('ic-chevron-right',18)}</span>
    </button>`;
  }
  html += '</div>';
  return html;
}
function renderGroupPicker() {
  const inst = state.pickerInstitute;
  const course = state.pickerCourse;
  const allGroups = (state.groups && state.groups[inst]) || [];
  const groups = allGroups.filter(g => getCourseFromGroup(g.name) === course);
  let html = `<div class="picker-header">
    <button class="picker-back" data-action="picker-back">${icon('ic-chevron-left',20)}</button>
    <div class="picker-title">${escapeHtml(inst)} · ${course} курс</div>
  </div>
  <input class="picker-search" id="picker-search" placeholder="Поиск группы..." value="${escapeHtml(state.pickerSearch)}" autocomplete="off">
  <div class="picker-list" id="picker-list">`;
  const q = (state.pickerSearch||'').trim().toLowerCase();
  const filtered = groups.filter(g => !q || g.name.toLowerCase().includes(q));
  if (!filtered.length) html += '<div class="picker-empty">Ничего не найдено</div>';
  else for (const g of filtered) {
    const selected = state.profile?.group === g.name;
    html += `<button class="picker-item ${selected?'selected':''}" data-action="picker-choose-group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">
      <div class="picker-group-item"><span>${escapeHtml(g.name)}</span></div>
      <span class="picker-item-arrow">${selected?icon('ic-check',18):icon('ic-chevron-right',18)}</span>
    </button>`;
  }
  html += '</div>';
  return html;
}
function pickerAttachSearch() {
  const input = document.getElementById('picker-search');
  if (!input) return;
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(e){}
  input.addEventListener('input', (e) => {
    state.pickerSearch = e.target.value;
    render();
    setTimeout(() => {
      const inp = document.getElementById('picker-search');
      if (inp) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch(_){} }
    }, 0);
  });
}

/* Уведомления */
function renderNotifyEditor() {
  const cur = state.notifyEditorType;
  const hhStr = String(state.notifyEditorHour).padStart(2,'0');
  const mmStr = String(state.notifyEditorMinute).padStart(2,'0');
  const isToday = cur === 'today';
  const capText = isToday ? 'макс. 10:00' : '00:00 - 23:59';
  const capClass = isToday ? 'time-cap warn' : 'time-cap';
  return `
    <div class="picker-header">
      <button class="picker-back" data-action="notify-back">${icon('ic-chevron-left',20)}</button>
      <div class="picker-title">Уведомления</div>
    </div>
    <div class="card">
      <div class="card-title">Когда напоминать</div>
      <div class="tab-buttons" style="margin-bottom:12px">
        <button data-action="notify-set-type" data-value="today" class="${isToday?'active':''}">Сегодня</button>
        <button data-action="notify-set-type" data-value="tomorrow" class="${!isToday?'active':''}">Завтра</button>
      </div>
      <div class="card-subtitle">${isToday ? 'Расписание на сегодня. Время — не позже 10:00 утра.' : 'Расписание на завтра. Любое время от 00:00 до 23:59.'}</div>
    </div>
    <div class="card">
      <div class="card-title" style="justify-content:space-between"><span>Во сколько</span><span class="${capClass}">${capText}</span></div>
      <div class="card-subtitle">Время по Иркутску</div>
      <div class="time-input-row">
        <div class="time-field">
          <label>Часы</label>
          <input class="input time-input" id="notify-hour-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${hhStr}" autocomplete="off">
        </div>
        <div class="time-sep">:</div>
        <div class="time-field">
          <label>Минуты</label>
          <input class="input time-input" id="notify-minute-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${mmStr}" autocomplete="off">
        </div>
      </div>
      <div class="time-done-row">
        <button class="time-done-btn" data-action="notify-hide-kb">ГОТОВО</button>
      </div>
      <div class="time-hint" id="notify-hint"></div>
      <div class="time-quick-row">
        <button class="choice" data-action="notify-quick" data-h="7" data-m="0">07:00</button>
        <button class="choice" data-action="notify-quick" data-h="8" data-m="0">08:00</button>
        <button class="choice" data-action="notify-quick" data-h="9" data-m="0">09:00</button>
        <button class="choice" data-action="notify-quick" data-h="10" data-m="0">10:00</button>
      </div>
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
  const ntype = p?.notify_type || 'today';
  state.notifyEditorType = ntype;
  let h = (p?.notify_hour != null && p.notify_hour >= 0) ? p.notify_hour : 8;
  let m = (p?.notify_minute != null && p.notify_minute >= 0) ? p.notify_minute : 0;
  if (ntype === 'today' && (h > 10 || (h === 10 && m > 0))) { h = 8; m = 0; }
  h = Math.max(0, Math.min(23, h));
  m = Math.max(0, Math.min(59, m));
  state.notifyEditorHour = h;
  state.notifyEditorMinute = m;
  state.notifyEditor = true;
  render();
}
function actionNotifySetType(ntype) {
  haptic('light');
  state.notifyEditorType = ntype;
  if (ntype === 'today') {
    if (state.notifyEditorHour > 10 || (state.notifyEditorHour === 10 && state.notifyEditorMinute > 0)) {
      state.notifyEditorHour = 8; state.notifyEditorMinute = 0;
    }
  }
  render();
}
function notifyAttachInputHandlers() {
  const hourInput = document.getElementById('notify-hour-input');
  const minuteInput = document.getElementById('notify-minute-input');
  const hintEl = document.getElementById('notify-hint');
  if (!hourInput || !minuteInput) return;

  const showHint = (text, type) => {
    if (!hintEl) return;
    hintEl.textContent = text || '';
    hintEl.className = 'time-hint' + (type ? ' ' + type : '');
  };
  const setError = (input, on) => {
    if (!input) return;
    if (on) {
      input.classList.add('input-error');
      input.style.animation = 'none';
      void input.offsetWidth;
      input.style.animation = '';
    } else input.classList.remove('input-error');
  };
  const validate = () => {
    const type = state.notifyEditorType;
    const hStr = hourInput.value.replace(/\D/g, '');
    const mStr = minuteInput.value.replace(/\D/g, '');
    const h = hStr === '' ? NaN : parseInt(hStr, 10);
    const m = mStr === '' ? NaN : parseInt(mStr, 10);
    let errH = null, errM = null;
    if (!isNaN(h)) {
      if (h < 0 || h > 23) errH = 'Часы — от 0 до 23';
      else if (type === 'today' && h > 10) errH = 'Для «Сегодня» часы — не позже 10';
    }
    if (!isNaN(m)) { if (m < 0 || m > 59) errM = 'Минуты — от 0 до 59'; }
    if (!errH && !errM && !isNaN(h) && !isNaN(m) && type === 'today' && (h > 10 || (h === 10 && m > 0))) {
      errH = 'Для «Сегодня» время — не позже 10:00';
    }
    setError(hourInput, !!errH);
    setError(minuteInput, !!errM);
    if (errH && errM) showHint(errH + ' · ' + errM, 'warn');
    else if (errH) showHint(errH, 'warn');
    else if (errM) showHint(errM, 'warn');
    else if (!isNaN(h) && !isNaN(m)) showHint(type === 'today' ? 'Можно сохранить: время до 10:00' : 'Можно сохранить: любое время', 'ok');
    else showHint('');
  };
  const setupField = (input) => {
    input.oninput = null; input.onkeydown = null; input.onblur = null; input.onfocus = null;
    input.onfocus = () => { try { input.select(); } catch(e){} };
    input.oninput = (e) => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 2) v = v.slice(0, 2);
      e.target.value = v;
      validate();
    };
    input.onblur = () => {
      let v = input.value.replace(/\D/g, '');
      if (v === '') v = '0';
      let n = parseInt(v, 10); if (isNaN(n)) n = 0;
      const isHour = input.id === 'notify-hour-input';
      const maxV = isHour ? 23 : 59;
      if (n < 0) n = 0; if (n > maxV) n = maxV;
      input.value = String(n).padStart(2, '0');
      if (isHour) state.notifyEditorHour = n; else state.notifyEditorMinute = n;
      validate();
    };
    input.onkeydown = (e) => {
      const allowed = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'];
      if (allowed.includes(e.key)) return;
      if (!/^\d$/.test(e.key)) e.preventDefault();
    };
  };
  setupField(hourInput); setupField(minuteInput); validate();
}
async function actionNotifySave() {
  const hourInput = document.getElementById('notify-hour-input');
  const minuteInput = document.getElementById('notify-minute-input');
  const hintEl = document.getElementById('notify-hint');
  if (!hourInput || !minuteInput) return;
  const setError = (input, on) => {
    if (!input) return;
    if (on) { input.classList.add('input-error'); input.style.animation = 'none'; void input.offsetWidth; input.style.animation = ''; }
    else input.classList.remove('input-error');
  };
  const showHint = (text, type) => { if (!hintEl) return; hintEl.textContent = text || ''; hintEl.className = 'time-hint' + (type ? ' ' + type : ''); };
  const hStr = hourInput.value.replace(/\D/g, '');
  const mStr = minuteInput.value.replace(/\D/g, '');
  const hh = hStr === '' ? NaN : parseInt(hStr, 10);
  const mm = mStr === '' ? NaN : parseInt(mStr, 10);
  setError(hourInput, false); setError(minuteInput, false);
  if (isNaN(hh)) { setError(hourInput, true); haptic('error'); showHint('Введи часы (0-23)', 'warn'); toast('Введи часы числом', 'error'); hourInput.focus(); return; }
  if (isNaN(mm)) { setError(minuteInput, true); haptic('error'); showHint('Введи минуты (0-59)', 'warn'); toast('Введи минуты числом', 'error'); minuteInput.focus(); return; }
  if (hh < 0 || hh > 23) { setError(hourInput, true); haptic('error'); showHint('Часы — от 0 до 23', 'warn'); toast('Часы могут быть от 0 до 23', 'error'); hourInput.focus(); return; }
  if (mm < 0 || mm > 59) { setError(minuteInput, true); haptic('error'); showHint('Минуты — от 0 до 59', 'warn'); toast('Минуты могут быть от 0 до 59', 'error'); minuteInput.focus(); return; }
  if (state.notifyEditorType === 'today' && (hh > 10 || (hh === 10 && mm > 0))) {
    setError(hourInput, true); haptic('error'); showHint('Для «Сегодня» время не позже 10:00', 'warn'); toast('На сегодня нельзя ставить позже 10:00', 'error'); hourInput.focus(); return;
  }
  try {
    await apiPost('/api/notify-set', {type: state.notifyEditorType, hour: hh, minute: mm});
    hideKeyboard();
    state.notifyEditor = false;
    document.body.classList.remove('picker-open');
    haptic('success'); toast('Сохранено', 'success');
    await loadProfile(); render();
  } catch (e) {
    if (e.code === 'today_limit') { haptic('error'); setError(hourInput, true); showHint('Для «Сегодня» время не позже 10:00', 'warn'); toast('На сегодня нельзя ставить позже 10:00', 'error'); }
    else toast(e.message, 'error');
  }
}
function actionNotifyQuick(h, m) {
  if (state.notifyEditorType === 'today' && (h > 10 || (h === 10 && m > 0))) { haptic('error'); toast('Для «Сегодня» — не позже 10:00', 'error'); return; }
  const hourInput = document.getElementById('notify-hour-input');
  const minuteInput = document.getElementById('notify-minute-input');
  if (hourInput) hourInput.value = String(h).padStart(2, '0');
  if (minuteInput) minuteInput.value = String(m).padStart(2, '0');
  state.notifyEditorHour = h; state.notifyEditorMinute = m;
  haptic('light'); hideKeyboard();
  if (typeof notifyAttachInputHandlers === 'function') notifyAttachInputHandlers();
}
function actionNotifyHideKb(){ hideKeyboard(); haptic('light'); }
async function actionNotifyOff() {
  try {
    await apiPost('/api/notify-set', {type: null});
    hideKeyboard();
    state.notifyEditor = false;
    document.body.classList.remove('picker-open');
    haptic('success'); toast('Уведомления выключены');
    await loadProfile(); render();
  } catch (e) { toast(e.message, 'error'); }
}
function actionNotifyBack() { hideKeyboard(); state.notifyEditor = false; document.body.classList.remove('picker-open'); render(); }

/* Стипендия */
function renderScholarshipBlock() {
  const s = state.scholarship;
  if (!s) return `<div class="card"><div class="skeleton-card" style="margin:0"></div></div>`;
  const semesters = s.semesters || [];
  const activeSem = state.schFilterSemester;
  const grades = (s.grades || []).filter(g => !activeSem || (g.semester || '') === activeSem);
  const amount = s.amount;
  const amountStr = (amount != null && amount > 0) ? `${amount}` : '—';
  let c5=0,c4=0,c3=0,c2=0,sum=0;
  for (const g of grades) { if (g.grade===5) c5++; else if (g.grade===4) c4++; else if (g.grade===3) c3++; else if (g.grade===2) c2++; sum += g.grade; }
  const avg = grades.length ? (sum / grades.length) : 0;
  const avgStr = grades.length ? avg.toFixed(2) : '—';
  let forecast = ''; let forecastCls = 'ok';
  if (!grades.length) { forecast = 'Добавь оценки, чтобы увидеть прогноз стипендии.'; forecastCls = ''; }
  else if (c2 > 0 || c3 > 0) { forecast = `Есть ${c3?c3+' тройка(и)':''}${c3&&c2?' и ':''}${c2?c2+' двойка(и)':''} — на академическую не проходишь.`; forecastCls = 'bad'; }
  else if (avg >= 4.5) { forecast = 'Средний не ниже 4.5 — проходишь на академическую и можешь претендовать на повышенную.'; forecastCls = 'ok'; }
  else if (avg >= 4.0) { forecast = `Проходишь на академическую. До повышенной не хватает ${(4.5-avg).toFixed(2)} балла.`; forecastCls = 'warn'; }
  else { forecast = 'Средний ниже 4.0 — на академическую не проходишь.'; forecastCls = 'bad'; }
  const forecastIcon = forecastCls === 'ok' ? '+' : forecastCls === 'warn' ? '!' : forecastCls === 'bad' ? 'x' : 'i';

  let html = `<div class="sch-hero">
    <div class="sch-hero-title">СТИПЕНДИЯ</div>
    <div class="sch-hero-amount">${escapeHtml(amountStr)}<small>руб. / мес</small></div>
    <div class="sch-hero-sub">Предметов: ${grades.length}${semesters.length?` · ${semesters.length} семестр(а)`:''}</div>
    <div class="sch-avg-row">
      <div class="sch-avg-box"><div class="num">${avgStr}</div><div class="label">Средний балл</div></div>
      <div class="sch-avg-box"><div class="num">${c5+c4}/${grades.length||0}</div><div class="label">Хорошо и отлично</div></div>
    </div>
    <div class="sch-counts">
      <div class="sch-count g5"><div class="n">${c5}</div><div class="g">5</div></div>
      <div class="sch-count g4"><div class="n">${c4}</div><div class="g">4</div></div>
      <div class="sch-count g3"><div class="n">${c3}</div><div class="g">3</div></div>
      <div class="sch-count g2"><div class="n">${c2}</div><div class="g">2</div></div>
    </div>
  </div>`;
  html += `<div class="sch-forecast ${forecastCls}"><div class="sch-forecast-icon">${forecastIcon}</div><div>${escapeHtml(forecast)}</div></div>`;
  html += `<div class="card">
    <div class="card-title" style="justify-content:space-between"><span>Мои предметы</span></div>
    <div class="actions-row" style="margin-bottom:12px">
      <button class="btn btn-secondary" data-action="sch-set-amount" style="flex:1">${amount?'Изменить сумму':'Указать сумму'}</button>
      <button class="btn" data-action="sch-add-grade" style="flex:1">+ Оценка</button>
    </div>
    ${semesters.length ? `<div class="choice-row" style="margin-bottom:6px">
      <button class="sch-subj-chip ${!activeSem?'selected':''}" data-action="sch-sem" data-value="">Все</button>
      ${semesters.map(sm => `<button class="sch-subj-chip ${activeSem===sm?'selected':''}" data-action="sch-sem" data-value="${escapeHtml(sm)}">${escapeHtml(sm)}</button>`).join('')}
    </div>` : ''}
    ${!grades.length ? `<div class="sch-empty">Пока нет оценок. Нажми «+ Оценка».</div>` :
      grades.map(g => {
        const cls = 'g' + g.grade;
        return `<div class="sch-grade-item">
          <div class="sch-grade-badge ${cls}">${g.grade}</div>
          <div class="sch-grade-subj">${escapeHtml(g.subject)}${g.semester?`<small>${escapeHtml(g.semester)}</small>`:''}</div>
          <div class="sch-grade-actions">
            <button data-action="sch-edit-grade" data-id="${g.id}" title="Изменить">${icon('ic-pencil',16)}</button>
            <button data-action="sch-del-grade" data-id="${g.id}" title="Удалить">${icon('ic-close',16)}</button>
          </div>
        </div>`;
      }).join('')}
  </div>`;
  if (grades.length) {
    html += `<div class="card">
      <div class="card-title">Очистка</div>
      <div class="card-subtitle">Удалить оценки из выбранного семестра или все.</div>
      <div class="actions-row"><button class="btn btn-secondary" data-action="sch-clear" data-sem="${escapeHtml(activeSem||'')}" style="flex:1">${activeSem?'Очистить «'+escapeHtml(activeSem)+'»':'Очистить всё'}</button></div>
    </div>`;
  }
  return html;
}

function renderAttendanceSemesterBlock() {
  const st = state.attendanceSemester;
  if (!st) return `<div class="card"><div class="skeleton-card" style="margin:0"></div></div>`;
  const totals = st.totals || {};
  const bySubj = st.by_subject || {};
  const subjects = Object.keys(bySubj);
  let html = `<div class="card">
    <div class="card-title">Пропуски · семестр с ${escapeHtml(st.since || '—')}</div>
    <div class="att-sem-totals">
      <div class="att-sem-box"><div class="n">${totals.total||0}</div><div class="l">Всего</div></div>
      <div class="att-sem-box ok"><div class="n">${totals.was||0}</div><div class="l">Посещено</div></div>
      <div class="att-sem-box warn"><div class="n">${totals.missed||0}</div><div class="l">Пропущено</div></div>
      <div class="att-sem-box"><div class="n">${totals.sick||0}</div><div class="l">Болезнь</div></div>
      <div class="att-sem-box"><div class="n">${totals.excused||0}</div><div class="l">Уважит.</div></div>
    </div>`;
  if (!subjects.length) {
    html += `<div class="sch-empty">Пока нет отметок в этом семестре.</div>`;
  } else {
    html += `<div class="att-sem-list">`;
    for (const subj of subjects) {
      const d = bySubj[subj];
      const total = d.total || 0;
      const was = d.was || 0;
      const missed = d.missed || 0;
      const sick = d.sick || 0;
      const excused = d.excused || 0;
      const goodMiss = sick + excused;
      const badMiss = missed;
      const pct = total ? Math.round((was / total) * 100) : 0;
      let cls = 'ok';
      if (total) {
        const skipPct = ((missed) / total) * 100;
        if (skipPct >= 40) cls = 'bad';
        else if (skipPct >= 25) cls = 'warn';
      }
      html += `<div class="att-sem-item ${cls}">
        <div class="att-sem-subj">${escapeHtml(subj)}</div>
        <div class="att-sem-meta">
          <span>Посещено: <b>${was}</b>/${total}</span>
          <span>Пропущено: <b>${badMiss}</b></span>
          <span>Уважит.: <b>${goodMiss}</b></span>
        </div>
        <div class="att-sem-bar"><div class="att-sem-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/* ЗАДАЧИ */
function renderTasks() {
  const tasks = state.tasks;
  const stats = state.tasksStats;
  const tstats = state.tasksStatsFull || {total_done:0, streak:0};
  const tags = state.tasksTags || [];
  const debts = state.tasksDebtsCount || 0;
  let html = `<div class="tab-buttons">
    <button data-action="tasks-show-active" class="${state.tasksView==='active'?'active':''}">Активные (${stats.active})</button>
    <button data-action="tasks-show-done" class="${state.tasksView==='done'?'active':''}">Выполненные (${stats.done})</button>
  </div>`;

  if (debts > 0) {
    html += `<div class="debts-banner">Долгов висит: <b>${debts}</b> — тег #долг с прошедшей датой. Переношу автоматически каждый день.</div>`;
  }

  if (state.tasksView === 'active' && tstats.total_done > 0) {
    html += `<div class="tasks-stats-row">
      <div class="tasks-stat-box">
        <div class="num">${tstats.total_done}</div>
        <div class="label">За 30 дней</div>
      </div>
      <div class="tasks-stat-box">
        <div class="num">${tstats.streak}${tstats.streak > 0 ? ' подряд' : ''}</div>
        <div class="label">Дней без пропуска</div>
      </div>
    </div>`;
  }

  if (state.tasksView === 'active') {
    html += `<button class="btn" data-action="task-add-open" style="width:100%;margin-bottom:12px">${icon('ic-plus',18)} Добавить задачу</button>`;

    html += `<div class="tasks-filter-bar">
      <input class="input tasks-search" id="tasks-search" placeholder="Поиск..." value="${escapeHtml(state.tasksSearch||'')}">
      <select class="input tasks-sort" id="tasks-sort">
        <option value="due" ${state.tasksSort==='due'?'selected':''}>По сроку</option>
        <option value="priority" ${state.tasksSort==='priority'?'selected':''}>По приоритету</option>
        <option value="created" ${state.tasksSort==='created'?'selected':''}>По дате</option>
      </select>
    </div>`;

    if (tags.length > 0) {
      html += `<div class="tasks-tags-scroll">`;
      html += `<button class="sch-subj-chip ${!state.tasksTag?'selected':''}" data-action="tasks-filter-tag" data-value="">Все</button>`;
      for (const t of tags) {
        html += `<button class="sch-subj-chip ${state.tasksTag===t?'selected':''}" data-action="tasks-filter-tag" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
      }
      html += `</div>`;
    }
  }

  if (!tasks?.length) {
    html += state.tasksView === 'active' ? '<div class="empty">Задач нет. Добавь первую.</div>' : '<div class="empty">Нет выполненных</div>';
    return html;
  }

  const prioMap = {1: {cls:'low', label:'Низкий'}, 2: {cls:'medium', label:'Средний'}, 3: {cls:'high', label:'Высокий'}};
  for (const t of tasks) {
    const p = prioMap[t.priority] || prioMap[2];
    const dueStr = t.due_date
      ? `<span class="${t.overdue?'overdue':''}">до ${escapeHtml(t.due_date)}${t.due_time?' '+escapeHtml(t.due_time):''}${t.overdue?' — просрочено':''}</span>`
      : '<span style="color:var(--text-2)">без срока</span>';
    const repeatBadge = t.repeat_rule
      ? `<span class="task-repeat-badge">${t.repeat_rule==='daily'?'ежедневно':t.repeat_rule==='weekly'?'еженедельно':'ежемесячно'}</span>`
      : '';
    const tagsArr = (t.tags||'').split().filter(x=>x);
    const tagsHtml = tagsArr.length
      ? `<div class="task-tags">${tagsArr.map(tg=>`<span class="task-tag ${tg==='#долг'?'task-tag-debt':''}">${escapeHtml(tg)}</span>`).join('')}</div>`
      : '';
    html += `<div class="card task-card prio-${p.cls}${t.is_debt?' task-is-debt':''}">
      <div class="card-title">${escapeHtml(t.text)}</div>
      ${tagsHtml}
      <div class="card-meta">
        <span class="task-prio-badge ${p.cls}">${p.label}</span>
        ${dueStr}
        ${repeatBadge}
      </div>
      <div class="actions-row">
        ${!t.done ? `<button class="btn btn-secondary" data-action="task-done" data-id="${t.id}">${icon('ic-check',14)} Готово</button>` : ''}
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

function actionTaskAdd() {
  let form = {text:'', priority:2, due:'none', customDate:'', customTime:'',
              tags:'', repeat:'none'};
  const tags = state.tasksTags || [];
  const renderBody = () => `
    <div class="label">ЧТО СДЕЛАТЬ</div>
    <input class="input" id="task-text" placeholder="Например: сдать лабу" value="${escapeHtml(form.text)}" maxlength="200">
    <div class="label">ПРИОРИТЕТ</div>
    <div class="choice-row">
      <button class="choice ${form.priority===1?'active':''}" data-prio="1">Низкий</button>
      <button class="choice ${form.priority===2?'active':''}" data-prio="2">Средний</button>
      <button class="choice ${form.priority===3?'active':''}" data-prio="3">Высокий</button>
    </div>
    <div class="label">КОГДА</div>
    <div class="choice-row">
      <button class="choice ${form.due==='none'?'active':''}" data-due="none">Без срока</button>
      <button class="choice ${form.due==='today'?'active':''}" data-due="today">Сегодня</button>
      <button class="choice ${form.due==='tomorrow'?'active':''}" data-due="tomorrow">Завтра</button>
      <button class="choice ${form.due==='custom'?'active':''}" data-due="custom">Своя дата</button>
    </div>
    ${form.due==='custom' ? `<div class="date-input-row"><input type="date" id="task-date" value="${escapeHtml(form.customDate)}"><input type="time" id="task-time" value="${escapeHtml(form.customTime)}"></div>` : ''}
    <div class="label">ТЕГИ (через пробел)</div>
    <input class="input" id="task-tags" placeholder="#учёба #важное или #долг" value="${escapeHtml(form.tags)}" maxlength="100">
    ${tags.length ? `<div class="choice-row" style="margin-top:0">${tags.slice(0,10).map(t=>`<button class="choice" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>` : ''}
    <div class="choice-row" style="margin-top:4px">
      <button class="choice" data-tag="#долг">#долг</button>
      <button class="choice" data-tag="#важное">#важное</button>
      <button class="choice" data-tag="#учёба">#учёба</button>
    </div>
    <div class="label">ПОВТОР</div>
    <div class="choice-row">
      <button class="choice ${form.repeat==='none'?'active':''}" data-rep="none">Нет</button>
      <button class="choice ${form.repeat==='daily'?'active':''}" data-rep="daily">Ежедневно</button>
      <button class="choice ${form.repeat==='weekly'?'active':''}" data-rep="weekly">Еженедельно</button>
      <button class="choice ${form.repeat==='monthly'?'active':''}" data-rep="monthly">Ежемесячно</button>
    </div>
  `;
  const attach = () => {
    const ti = document.getElementById('task-text'); if (ti) ti.oninput = (e) => form.text = e.target.value;
    const di = document.getElementById('task-date'); if (di) di.onchange = (e) => form.customDate = e.target.value;
    const ti2 = document.getElementById('task-time'); if (ti2) ti2.onchange = (e) => form.customTime = e.target.value;
    const tgi = document.getElementById('task-tags'); if (tgi) tgi.oninput = (e) => form.tags = e.target.value;
    document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => { form.due = b.dataset.due; document.getElementById('modalBody').innerHTML = renderBody(); attach(); });
    document.querySelectorAll('[data-prio]').forEach(b => b.onclick = () => { form.priority = parseInt(b.dataset.prio); document.getElementById('modalBody').innerHTML = renderBody(); attach(); });
    document.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { form.repeat = b.dataset.rep; document.getElementById('modalBody').innerHTML = renderBody(); attach(); });
    document.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { form.tags = (form.tags + ' ' + b.dataset.tag).trim(); document.getElementById('task-tags').value = form.tags; });
  };
  modalOpen({title:'НОВАЯ ЗАДАЧА', body: renderBody(), actions: [
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
      const ti = document.getElementById('task-text');
      const text = (ti?.value || form.text || '').trim();
      if (!text) { toast('Введи текст', 'error'); return; }
      let due_date = null, due_time = null; const today = nowIrkutsk();
      if (form.due === 'today') due_date = fmtDate(today);
      else if (form.due === 'tomorrow') due_date = fmtDate(addDays(today,1));
      else if (form.due === 'custom' && form.customDate) { const [y,m,d] = form.customDate.split('-'); due_date = `${d}.${m}.${y}`; if (form.customTime) due_time = form.customTime; }
      const tags = (document.getElementById('task-tags')?.value || '').trim();
      const repeat_rule = form.repeat === 'none' ? null : form.repeat;
      try {
        await apiPost('/api/task-add', {text, due_date, due_time, priority: form.priority, tags, repeat_rule});
        hideKeyboard(); haptic('success'); toast('Задача добавлена', 'success'); await loadTasks(); render();
      } catch (e) { toast(e.message, 'error'); }
    }}
  ]});
  attach();
}

function actionTaskEdit(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  let form = {text: t.text, priority: t.priority || 2, tags: t.tags || '',
              repeat: t.repeat_rule || 'none'};
  const tags = state.tasksTags || [];
  const renderBody = () => `
    <div class="label">ТЕКСТ</div>
    <input class="input" id="task-edit-text" value="${escapeHtml(form.text)}" maxlength="200">
    <div class="label">ПРИОРИТЕТ</div>
    <div class="choice-row">
      <button class="choice ${form.priority===1?'active':''}" data-prio="1">Низкий</button>
      <button class="choice ${form.priority===2?'active':''}" data-prio="2">Средний</button>
      <button class="choice ${form.priority===3?'active':''}" data-prio="3">Высокий</button>
    </div>
    <div class="label">ТЕГИ</div>
    <input class="input" id="task-edit-tags" value="${escapeHtml(form.tags)}" maxlength="100">
    ${tags.length ? `<div class="choice-row" style="margin-top:0">${tags.slice(0,10).map(tg=>`<button class="choice" data-edittag="${escapeHtml(tg)}">${escapeHtml(tg)}</button>`).join('')}</div>` : ''}
    <div class="label">ПОВТОР</div>
    <div class="choice-row">
      <button class="choice ${form.repeat==='none'?'active':''}" data-rep="none">Нет</button>
      <button class="choice ${form.repeat==='daily'?'active':''}" data-rep="daily">Ежедневно</button>
      <button class="choice ${form.repeat==='weekly'?'active':''}" data-rep="weekly">Еженедельно</button>
      <button class="choice ${form.repeat==='monthly'?'active':''}" data-rep="monthly">Ежемесячно</button>
    </div>
  `;
  const attach = () => {
    const ti = document.getElementById('task-edit-text'); if (ti) ti.oninput = (e) => form.text = e.target.value;
    const tgi = document.getElementById('task-edit-tags'); if (tgi) tgi.oninput = (e) => form.tags = e.target.value;
    document.querySelectorAll('[data-prio]').forEach(b => b.onclick = () => { form.priority = parseInt(b.dataset.prio); document.getElementById('modalBody').innerHTML = renderBody(); attach(); });
    document.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { form.repeat = b.dataset.rep; document.getElementById('modalBody').innerHTML = renderBody(); attach(); });
    document.querySelectorAll('[data-edittag]').forEach(b => b.onclick = () => { form.tags = (form.tags + ' ' + b.dataset.edittag).trim(); document.getElementById('task-edit-tags').value = form.tags; });
  };
  modalOpen({title:'ИЗМЕНИТЬ ЗАДАЧУ', body: renderBody(), actions:[
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
      const ti = document.getElementById('task-edit-text');
      const text = (ti?.value || form.text || '').trim();
      if (!text) { toast('Пустой текст', 'error'); return; }
      const tags = (document.getElementById('task-edit-tags')?.value || '').trim();
      const repeat_rule = form.repeat === 'none' ? null : form.repeat;
      try {
        await apiPost('/api/task-update', {id, text, priority: form.priority, tags, repeat_rule});
        hideKeyboard(); haptic('success'); toast('Сохранено', 'success'); await loadTasks(); render();
      } catch (e) { toast(e.message, 'error'); }
    }}
  ]});
  attach();
}

/* ЗАМЕТКИ */
function renderNotes() {
  const tags = state.notesTags || [];
  let html = `<button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">${icon('ic-plus',18)} Добавить заметку</button>`;
  html += `<div class="tasks-filter-bar">
    <input class="input tasks-search" id="notes-search" placeholder="Поиск заметок..." value="${escapeHtml(state.notesSearch||'')}">
  </div>`;
  if (tags.length > 0) {
    html += `<div class="tasks-tags-scroll">`;
    html += `<button class="sch-subj-chip ${!state.notesTag?'selected':''}" data-action="notes-filter-tag" data-value="">Все</button>`;
    for (const t of tags) {
      html += `<button class="sch-subj-chip ${state.notesTag===t?'selected':''}" data-action="notes-filter-tag" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
    }
    html += `</div>`;
  }
  if (!state.notes?.length) return html + '<div class="empty">Заметок нет.</div>';
  for (const n of state.notes) {
    const tagsArr = (n.tags||'').split().filter(x=>x);
    const tagsHtml = tagsArr.length
      ? `<div class="task-tags">${tagsArr.map(tg=>`<span class="task-tag">${escapeHtml(tg)}</span>`).join('')}</div>`
      : '';
    const pinLabel = n.pinned ? '<span class="note-pin-label">закреплено</span>' : '';
    html += `<div class="card ${n.pinned?'note-pinned':''}">
      <div class="card-title" style="justify-content:space-between">
        <span>${escapeHtml(n.subject)}</span>${pinLabel}
      </div>
      ${tagsHtml}
      <div class="card-subtitle note-text">${renderMarkdownLight(n.text)}</div>
      <div class="actions-row">
        <button class="btn btn-secondary" data-action="note-pin" data-id="${n.id}">${n.pinned?'Открепить':'Закрепить'}</button>
        <button class="btn btn-secondary" data-action="note-edit-open" data-id="${n.id}">Изменить</button>
        <button class="btn btn-secondary" data-action="note-delete" data-id="${n.id}">Удалить</button>
      </div>
    </div>`;
  }
  return html;
}

function actionNoteAdd() {
  let form = {subject:'', text:'', tags:''};
  const tags = state.notesTags || [];
  const renderBody = () => `
    <div class="label">ПРЕДМЕТ</div>
    <input class="input" id="note-subj" placeholder="Название предмета" value="${escapeHtml(form.subject)}" maxlength="100">
    ${state.notesSubjects?.length ? `<div class="choice-row" style="margin-top:4px">${state.notesSubjects.map(s => `<button class="choice" data-subj="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    <div class="label">ТЕГИ (через пробел)</div>
    <input class="input" id="note-tags" placeholder="#лекция #формулы" value="${escapeHtml(form.tags)}" maxlength="100">
    ${tags.length ? `<div class="choice-row" style="margin-top:0">${tags.slice(0,10).map(t=>`<button class="choice" data-ntag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}</div>` : ''}
    <div class="label">ТЕКСТ (можно **жирный**, *курсив*, \`код\`)</div>
    <textarea class="input" id="note-text" rows="5" maxlength="5000">${escapeHtml(form.text)}</textarea>
  `;
  const attach = () => {
    const si = document.getElementById('note-subj'); if (si) si.oninput = (e) => form.subject = e.target.value;
    const ti = document.getElementById('note-text'); if (ti) ti.oninput = (e) => form.text = e.target.value;
    const tgi = document.getElementById('note-tags'); if (tgi) tgi.oninput = (e) => form.tags = e.target.value;
    document.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => { form.subject = b.dataset.subj; document.getElementById('note-subj').value = form.subject; document.querySelectorAll('[data-subj]').forEach(x => x.classList.remove('active')); b.classList.add('active'); });
    document.querySelectorAll('[data-ntag]').forEach(b => b.onclick = () => { form.tags = (form.tags + ' ' + b.dataset.ntag).trim(); document.getElementById('note-tags').value = form.tags; });
  };
  modalOpen({title:'НОВАЯ ЗАМЕТКА', body: renderBody(), actions:[
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
      const s = (document.getElementById('note-subj')?.value || form.subject || '').trim();
      const t = (document.getElementById('note-text')?.value || form.text || '').trim();
      const tags = (document.getElementById('note-tags')?.value || '').trim();
      if (!s || !t) { toast('Заполни предмет и текст', 'error'); return; }
      try { await apiPost('/api/note-save', {subject: s, text: t, tags}); hideKeyboard(); haptic('success'); toast('Заметка сохранена', 'success'); await loadNotes(); render(); }
      catch (e) { toast(e.message, 'error'); }
    }}
  ]});
  attach();
}

function actionNoteEdit(id) {
  const n = state.notes.find(x => x.id === id); if (!n) return;
  modalOpen({title:'ИЗМЕНИТЬ ЗАМЕТКУ', body: `
    <div class="label">ПРЕДМЕТ</div>
    <input class="input" id="note-edit-subj" value="${escapeHtml(n.subject)}" maxlength="100">
    <div class="label">ТЕГИ</div>
    <input class="input" id="note-edit-tags" value="${escapeHtml(n.tags||'')}" maxlength="100">
    <div class="label">ТЕКСТ</div>
    <textarea class="input" id="note-edit-text" rows="5" maxlength="5000">${escapeHtml(n.text)}</textarea>
  `, actions:[
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
      const s = (document.getElementById('note-edit-subj')?.value || '').trim();
      const t = (document.getElementById('note-edit-text')?.value || '').trim();
      const tags = (document.getElementById('note-edit-tags')?.value || '').trim();
      if (!s || !t) { toast('Заполни предмет и текст', 'error'); return; }
      try { await apiPost('/api/note-save', {subject: s, text: t, tags}); hideKeyboard(); haptic('success'); toast('Сохранено', 'success'); await loadNotes(); render(); }
      catch (e) { toast(e.message, 'error'); }
    }}
  ]});
}

async function actionNoteDelete(id) { modalConfirm('УДАЛИТЬ ЗАМЕТКУ?', 'Восстановить нельзя.', async () => { try { await apiPost('/api/note-delete', {id}); haptic('success'); await loadNotes(); render(); } catch (e) { toast(e.message, 'error'); } }, 'УДАЛИТЬ'); }
async function actionNotePin(id) {
  try { await apiPost('/api/note-pin', {id}); haptic('success'); await loadNotes(); render(); }
  catch (e) { toast(e.message, 'error'); }
}


/* AI + Презентация */
function renderAI() {
  let html = '';
  if (!state.aiMessages.length) {
    html += `<div class="card">
      <div class="card-title">AI Помощник</div>
      <div class="card-subtitle">Задай вопрос или прикрепи фото с задачей.</div>
    </div>`;
  } else {
    for (let i = 0; i < state.aiMessages.length; i++) {
      const m = state.aiMessages[i];
      const txt = m.text || '';
      if (m.role === 'user') {
        if (m.photo) {
          html += `<div class="card" style="background:var(--cyan);color:#0A0E0F;padding:10px">
            <img src="${m.photo}" style="width:100%;border-radius:12px;display:block;margin-bottom:8px" alt="">
            <div style="font-weight:600">${escapeHtml(txt||'')}</div>
          </div>`;
        } else {
          html += `<div class="card" style="background:var(--cyan);color:#0A0E0F"><div style="font-weight:600">${escapeHtml(txt)}</div></div>`;
        }
      } else {
        html += `<div class="card ai-msg" data-ai-idx="${i}">
          <div style="white-space:pre-wrap">${escapeHtml(txt)}</div>
          <div class="actions-row" style="margin-top:8px">
            <button class="btn btn-secondary" data-action="ai-copy" data-ai-idx="${i}">${icon('ic-copy',14)} Копировать</button>
          </div>
        </div>`;
      }
    }
  }
  if (state.aiPending) html += '<div class="skeleton-card"></div>';
  const hasPhoto = !!state.aiPendingPhoto;
  html += `<div style="margin-top:12px">`;
  if (hasPhoto) {
    html += `<div style="position:relative;margin-bottom:8px">
      <img src="${state.aiPendingPhoto}" style="width:100%;border-radius:16px;display:block;max-height:200px;object-fit:cover" alt="">
      <button data-action="ai-photo-remove" style="position:absolute;top:8px;right:8px;width:32px;height:32px;border-radius:50%;background:rgba(10,14,15,.85);color:#FFF;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center">${icon('ic-close',14)}</button>
    </div>`;
  }
  html += `<textarea class="input" id="ai-input" placeholder="Напиши вопрос..." rows="3" ${state.aiPending?'disabled':''}></textarea>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn btn-secondary" data-action="ai-photo-open" ${state.aiPending?'disabled':''} style="flex:0;padding:12px 18px">${icon('ic-attach',20)}</button>
      <button class="btn" data-action="ai-send" ${state.aiPending?'disabled':''} style="flex:1">${icon('ic-send',18)} Отправить</button>
    </div>
    <button class="btn btn-secondary" data-action="ai-clear" style="width:100%;margin-top:6px">Очистить</button>
    <input type="file" id="ai-photo-input" accept="image/*" style="display:none">
  </div>`;

  html += renderPresentationForm();
  return html;
}

function renderPresentationForm() {
  const f = state.presentForm;
  const slidesOpts = [6, 10, 14, 18];
  const styleOpts = [
    ['random','Случайный'],
    ['academic','Академический'],
    ['creative','Креативный'],
    ['minimal','Минимализм'],
    ['dark','Тёмный'],
    ['magazine','Журнальный'],
    ['neon','Неон'],
  ];
  const groupName = state.profile?.group || '';
  const materialLen = (f.info || '').length;
  const materialOk = materialLen >= 40;
  return `<div class="section-title" style="margin-top:16px">Презентация</div>
  <div class="card">
    <div class="card-title">Собрать PPTX</div>
    <div class="card-subtitle">
      Бот <b>оформит только твой текст</b> в слайды. ИИ не добавляет факты, цифры, имена и источники —
      всё содержание берётся из блока «МАТЕРИАЛ».
    </div>

    <div class="label">ТЕМА *</div>
    <textarea class="input" id="present-topic" placeholder="Например: История Иркутска" rows="2">${escapeHtml(f.topic)}</textarea>

    <div class="label">МАТЕРИАЛ * — обязательно</div>
    <div class="card-subtitle" style="margin-top:0;color:${materialOk?'var(--text-2)':'var(--red)'}">
      Вставь конспект, текст параграфа, свои тезисы (минимум 40 символов).<br>
      Из этого текста будут сделаны слайды. Если чего-то нет в тексте — в презентацию не попадёт.
      <br>Символов: ${materialLen}${materialOk?'':' — пока мало'}
    </div>
    <textarea class="input" id="present-info" placeholder="Вставь сюда текст по теме — конспект, реферат, тезисы…" rows="10" style="min-height:200px">${escapeHtml(f.info)}</textarea>

    <div class="label">ПОЖЕЛАНИЯ К СТРУКТУРЕ (необязательно)</div>
    <textarea class="input" id="present-wishes" placeholder="Например: сделать акцент на практической части" rows="2">${escapeHtml(f.wishes)}</textarea>

    <div class="label">ДАННЫЕ СТУДЕНТА (для титульного)</div>
    <input class="input" id="present-author" placeholder="ФИО (Иванов И.И.)" value="${escapeHtml(f.author)}" maxlength="120">
    <input class="input" id="present-group" placeholder="Группа (например, ИС-23-1)" value="${escapeHtml(f.group || groupName)}" maxlength="40">
    <input class="input" id="present-teacher" placeholder="Преподаватель (Петров П.П.)" value="${escapeHtml(f.teacher)}" maxlength="120">
    <input class="input" id="present-year" placeholder="Год (2025)" value="${escapeHtml(f.year)}" maxlength="10">

    <div class="label">Сколько слайдов (максимум)</div>
    <div class="card-subtitle" style="margin-top:0">Бот сделает столько, сколько позволяет материал. Это — верхняя граница.</div>
    <div class="choice-row" id="present-slides">
      ${slidesOpts.map(n => `<button class="choice ${f.slides===n?'active':''}" data-slides="${n}">${n}</button>`).join('')}
    </div>
    <div class="label">Стиль оформления</div>
    <div class="choice-row" id="present-style">
      ${styleOpts.map(([k,l]) => `<button class="choice ${f.style===k?'active':''}" data-style="${k}">${l}</button>`).join('')}
    </div>
    <button class="btn" data-action="present-build" style="width:100%;margin-top:10px"
      ${state.presentBuilding?'disabled':''}>
      ${state.presentBuilding ? 'Генерация…' : (materialOk ? 'Собрать PPTX' : 'Нужен материал (мин. 40 символов)')}
    </button>
  </div>`;
}

function actionPresentBuild() {
  const topic = (document.getElementById('present-topic')?.value || '').trim();
  const info = (document.getElementById('present-info')?.value || '').trim();
  const wishes = (document.getElementById('present-wishes')?.value || '').trim();
  const author = (document.getElementById('present-author')?.value || '').trim();
  const group = (document.getElementById('present-group')?.value || '').trim();
  const teacher = (document.getElementById('present-teacher')?.value || '').trim();
  const year = (document.getElementById('present-year')?.value || '').trim();

  if (!topic) { toast('Введи тему презентации', 'error'); return; }
  if (info.length < 40) {
    toast('Вставь материал по теме (минимум 40 символов)', 'error');
    return;
  }

  const slidesEl = document.querySelector('#present-slides .choice.active');
  const slides = slidesEl ? parseInt(slidesEl.dataset.slides, 10) : 10;
  const styleEl = document.querySelector('#present-style .choice.active');
  const style = styleEl ? styleEl.dataset.style : 'random';

  state.presentForm = { topic, info, wishes, slides, style, author, group, teacher, year };
  hideKeyboard();
  modalConfirm('СОБРАТЬ ПРЕЗЕНТАЦИЮ?',
    `Тема: ${topic}\nМатериал: ${info.length} символов\nМакс. слайдов: ${slides}\nСтиль: ${style === 'random' ? 'случайный' : style}.\n\nБот оформит ТОЛЬКО твой текст. Файл придёт в чат бота через 1–3 минуты.`,
    async () => {
      try {
        state.presentBuilding = true;
        toast('Запускаю генерацию...', 'info');
        render();
        await apiPost('/api/present', { topic, slides, style, info, wishes, author, group, teacher, year });
        haptic('success');
        toast('Готово, PPTX отправлен в чат', 'success');
        state.presentBuilding = false;
        render();
      } catch (e) {
        haptic('error');
        toast(e.message || 'Ошибка генерации', 'error');
        state.presentBuilding = false;
        render();
      }
    }, 'СОБРАТЬ');
}

function renderAdmin() {
  if (!state.isAdmin) return '<div class="empty">Доступ только для админа</div>';
  let html = '';
  if (state.adminStats) {
    const ai = state.adminStats.ai_cache || {};
    html += `<div class="card">
      <div class="card-title">Статистика</div>
      <div class="card-subtitle">Пользователей: ${state.adminStats.total_users}</div>
      <div class="card-subtitle">Обращений: ${state.adminStats.pending_feedback}</div>
      <div class="card-subtitle">AI-кэш: ${ai.size||0} записей · ${ai.hits||0} попаданий</div>
      <div class="actions-row"><button class="btn btn-secondary" data-action="admin-clear-ai-cache">Очистить AI-кэш</button></div>
    </div>`;
  } else html += '<div class="skeleton-card"></div>';
  html += `<div class="card">
    <div class="card-title">Мониторинг ИРНИТУ</div>
    ${state.adminMonitor ? (state.adminMonitor.ok ? `<div class="card-subtitle" style="color:var(--green)">Отвечает (HTTP ${state.adminMonitor.status})</div>` : `<div class="card-subtitle overdue">Не отвечает</div>`) : '<div class="card-subtitle">Не проверено</div>'}
    <div class="actions-row"><button class="btn btn-secondary" data-action="admin-monitor">Проверить</button></div>
  </div>`;
  html += `<div class="card">
    <div class="card-title">Рассылка</div>
    <textarea class="input" id="admin-broadcast-text" placeholder="Текст..." rows="3"></textarea>
    <button class="btn" data-action="admin-broadcast">Отправить</button>
  </div>`;
  if (state.adminFeedback?.length > 0) {
    html += `<div class="card"><div class="card-title">Обращения (${state.adminFeedback.length})</div>`;
    for (const f of state.adminFeedback) {
      html += `<div style="border-bottom:1px solid var(--divider);padding:10px 0">
        <div class="card-subtitle">#${f.id} | ${escapeHtml(f.username || f.user_id)}${f.status==='postponed'?' [отложено]':''}</div>
        <div style="white-space:pre-wrap;margin-top:4px;color:var(--text)">${escapeHtml(f.text)}</div>
        <div class="actions-row">
          <button class="btn btn-secondary" data-action="admin-fb-reply" data-id="${f.id}">Ответить</button>
          <button class="btn btn-secondary" data-action="admin-fb-postpone" data-id="${f.id}">Отложить</button>
        </div>
      </div>`;
    }
    html += '</div>';
  } else {
    html += `<div class="card"><div class="card-subtitle">Обращений нет.</div></div>`;
  }
  return html;
}

async function loadSchedule() { try { state.schedule = await apiGet('/api/schedule'); } catch (e) { state.schedule = {error:'load_error', message:e.message}; } }
async function loadTasks() {
  try {
    const doneParam = state.tasksView === 'done' ? '1' : '0';
    const params = {done: doneParam, sort: state.tasksSort};
    if (state.tasksSearch) params.search = state.tasksSearch;
    if (state.tasksTag) params.tag = state.tasksTag;
    const r = await apiGet('/api/tasks', params);
    state.tasks = r.tasks || [];
    state.tasksStats = {active: r.active || 0, done: r.done || 0};
    state.tasksStatsFull = r.stats || {total_done:0, streak:0};
    state.tasksTags = r.tags || [];
    state.tasksDebtsCount = r.debts_count || 0;
  } catch (e) { state.tasks = []; }
}
async function loadNotes() {
  try {
    const params = {};
    if (state.notesSearch) params.search = state.notesSearch;
    if (state.notesTag) params.tag = state.notesTag;
    const r = await apiGet('/api/notes', params);
    state.notes = r.notes || [];
    state.notesTags = r.tags || [];
    const subs = new Set(state.notes.map(n => n.subject));
    state.notesSubjects = Array.from(subs);
  } catch (e) { state.notes = []; }
}
async function loadProfile() {
  try {
    state.profile = await apiGet('/api/me');
    state.isAdmin = !!state.profile.is_admin;
    // Принудительно обновляем навигацию — чтобы кнопка админа появилась сразу
    renderNav();
  } catch (e) { state.profile = {error:e.message}; }
}
async function loadScholarship() { try { state.scholarship = await apiGet('/api/scholarship'); } catch (e) { state.scholarship = null; } }
async function loadGroups(force=false) { if (state.groups && !force) return; try { const r = await apiGet('/api/groups'); state.groups = r.groups; } catch (e) { state.groups = {}; } }
async function loadAdminStats() { try { state.adminStats = await apiGet('/api/admin/stats'); } catch (e) { state.adminStats = null; } }
async function loadAdminFeedback() { try { const r = await apiGet('/api/admin/feedback-list'); state.adminFeedback = r.items || []; } catch (e) { state.adminFeedback = []; } }
async function loadWeather() {
  try {
    const r = await apiGet('/api/weather');
    state.weather = r.weather || null;
    state.weatherLine = r.line || '';
  } catch (e) { state.weather = null; state.weatherLine = ''; }
}
async function loadAttendanceSemester() {
  try {
    state.attendanceSemester = await apiGet('/api/attendance/semester');
  } catch (e) { state.attendanceSemester = null; }
}

async function loadTabData(tab) {
  state.loading = true;
  state.error = null;
  state.notifyEditor = false;
  document.body.classList.remove('picker-open');
  render();
  try {
    if (tab === 'schedule') {
      state.scheduleViewMode = 'today'; state.weekOffset = 0; state.scheduleDay = 'today'; state.weekDays = null;
      await Promise.all([loadProfile(), loadSchedule(), loadWeather().catch(()=>{})]);
      renderNav();
      ensureWeekLoaded().catch(()=>{});
    } else if (tab === 'tasks') await loadTasks();
    else if (tab === 'notes') await loadNotes();
    else if (tab === 'ai') await loadProfile();
    else if (tab === 'admin') { await loadProfile(); if (state.isAdmin) await Promise.all([loadAdminStats(), loadAdminFeedback()]); }
    else if (tab === 'profile') { await loadProfile(); await loadScholarship(); await loadAttendanceSemester(); }
  } catch (e) { console.error(e); state.error = e.message; }
  state.loading = false;
  render();
}

async function ensureWeekLoaded() { if (state.weekDays?.days?.length) return true; try { state.weekDays = await apiGet('/api/week', {offset:0}); return true; } catch(e){ return false; } }
async function loadWeekAndRender() {
  try { const r = await apiGet('/api/week', {offset: state.weekOffset}); state.weekDays = r; state.scheduleViewMode = 'week'; render(); }
  catch (e) { toast('Ошибка загрузки', 'error'); }
}
async function loadTodayAndRender() {
  state.scheduleViewMode = 'today'; state.weekOffset = 0; state.weekDays = null; state.scheduleDay = 'today';
  await loadSchedule(); render();
}

function renderProfile() {
  const p = state.profile;

  let html = `<div class="section-title">Учёба</div>`;
  html += `<div class="card">
    <div class="card-title">Моя группа</div>
    <div class="card-subtitle">${p?.group ? escapeHtml(p.group) : 'не выбрана'}</div>
    <div class="actions-row">
      <button class="btn btn-secondary" data-action="choose-group">${p?.group?'Изменить':'Выбрать'}</button>
      ${p?.group ? `<button class="btn btn-secondary" data-action="forget-group">Забыть</button>` : ''}
    </div>
  </div>`;
  html += `<div class="card">
    <div class="card-title">Подгруппа</div>
    <div class="card-subtitle">${p?.subgroup ? 'Подгруппа ' + p.subgroup : 'не выбрана'}</div>
    <div class="actions-row">
      <button class="btn btn-secondary" data-action="set-subgroup" data-value="0">ВСЕ</button>
      <button class="btn btn-secondary" data-action="set-subgroup" data-value="1">1</button>
      <button class="btn btn-secondary" data-action="set-subgroup" data-value="2">2</button>
    </div>
  </div>`;

  html += `<div class="section-title">Пропуски</div>`;
  html += renderAttendanceSemesterBlock();

  html += `<div class="section-title">Стипендия</div>`;
  html += renderScholarshipBlock();

  const notifyOn = !!p?.notify_type;
  const notifyLabel = notifyOn ? `${p.notify_type==='today'?'Сегодня':'Завтра'} в ${String(p.notify_hour).padStart(2,'0')}:${String(p.notify_minute||0).padStart(2,'0')}` : 'выключены';

  html += `<div class="section-title">Настройки</div>`;
  html += `<div class="card">
    <div class="card-title">Уведомления</div>
    <div class="card-subtitle">Расписание: ${escapeHtml(notifyLabel)}</div>
    <div class="card-subtitle">За N минут: ${p?.notify_before_min ? p.notify_before_min + ' мин' : 'выкл'}</div>
    <div class="actions-row">
      <button class="btn" data-action="notify-open">${notifyOn?'Изменить':'Включить'}</button>
      <button class="btn btn-secondary" data-action="notify-before">За N минут</button>
    </div>
    <label class="switch-row">
      <input type="checkbox" id="notify-changes" ${p?.notify_changes?'checked':''}>
      <span>Следить за изменениями расписания</span>
    </label>
  </div>`;

  html += `<div class="card">
    <div class="card-title">Цитата дня</div>
    <div class="card-subtitle">${p?.daily_subscribed ? 'Приходит каждый день в 10:00' : 'Отключена'}</div>
    <div class="actions-row">
      ${p?.daily_subscribed ? `<button class="btn btn-secondary" data-action="quote-subscribe" data-value="0">Отписаться</button>` : `<button class="btn" data-action="quote-subscribe" data-value="1">Подписаться</button>`}
    </div>
  </div>`;

  html += `<div class="section-title">Экспорт</div>`;
  html += `<div class="card">
    <div class="card-title">Календарь</div>
    <div class="card-subtitle">Скачай расписание в .ics — откроется в Google Calendar, Apple Calendar, Яндекс.Календаре. Пары добавятся автоматически.</div>
    <div class="actions-row">
      <button class="btn" data-action="export-ics-2weeks" style="flex:1">2 недели</button>
      <button class="btn btn-secondary" data-action="export-ics-4weeks" style="flex:1">4 недели</button>
    </div>
  </div>`;

  html += `<div class="section-title">Прочее</div>`;
  html += `<div class="card">
    <div class="actions-row">
      <button class="btn btn-secondary" data-action="export-pdf" style="flex:1">${icon('ic-pdf',14)} Экспорт PDF</button>
      <button class="btn btn-secondary" data-action="show-my-feedback" style="flex:1">${icon('ic-chat',14)} Обращения</button>
    </div>
  </div>`;

  html += `<div class="card">
    <div class="card-title">Обратная связь</div>
    <textarea class="input" id="feedback-text" placeholder="Сообщение админу..." rows="3"></textarea>
    <button class="btn" data-action="feedback-send" style="width:100%">Отправить</button>
  </div>`;

  return html;
}

function actionChooseGroup() { loadGroups(true).then(() => { if (!state.groups || !Object.keys(state.groups).length) { toast('Не удалось загрузить', 'error'); return; } state.pickerMode = 'institute'; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; render(); }); }
function actionPickerBack() {
  if (state.pickerMode === 'group') { state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = ''; }
  else if (state.pickerMode === 'course') { state.pickerMode = 'institute'; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; }
  else { state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; }
  render();
}
function actionPickerChooseInstitute(inst) { state.pickerInstitute = inst; state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = ''; render(); }
function actionPickerChooseCourse(course) { state.pickerCourse = parseInt(course, 10); state.pickerMode = 'group'; state.pickerSearch = ''; render(); }

/* ═════ ГЛАВНЫЙ ФИКС: проверяем, что группа реально сохранилась ═════ */
async function actionPickerChooseGroup(groupId, groupName) {
  haptic('success');
  try {
    const res = await apiPost('/api/set-group', {
      group_id: groupId,
      group_name: groupName,
      subgroup: state.profile?.subgroup || 0
    });
    // Проверка 1: бэк вернул saved=true
    if (!res || !res.saved) {
      toast('Сервер не сохранил группу. Проверь /whereami у админа.', 'error');
      return;
    }
    state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
    // Проверка 2: перечитываем профиль и сверяем группу
    await loadProfile();
    if (state.profile?.group !== groupName) {
      toast('Группа не сохранилась. Смотри /dbcheck у админа.', 'error');
      render();
      return;
    }
    await loadSchedule();
    toast('Группа обновлена', 'success');
    render();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function actionSetSubgroup(value) { try { await apiPost('/api/set-subgroup', {subgroup: value}); if (state.profile) state.profile.subgroup = value; haptic('success'); render(); } catch (e) { toast(e.message, 'error'); } }
async function actionQuoteSubscribe(value) { try { await apiPost('/api/quote-subscribe', {subscribe: value === 1}); if (state.profile) state.profile.daily_subscribed = value === 1; haptic('success'); render(); } catch (e) { toast(e.message, 'error'); } }
async function actionFeedbackSend() {
  const el = document.getElementById('feedback-text'); if (!el) return;
  const text = (el.value || '').trim();
  if (!text) { toast('Пустое сообщение', 'error'); return; }
  try { await apiPost('/api/feedback', {text}); el.value = ''; hideKeyboard(); haptic('success'); toast('Отправлено', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}
async function actionTaskDone(id) { try { await apiPost('/api/task-update', {id, done: true}); haptic('success'); toast('Готово', 'success'); await loadTasks(); render(); } catch (e) { toast(e.message, 'error'); } }
async function actionTaskDelete(id) { modalConfirm('УДАЛИТЬ ЗАДАЧУ?', 'Отменить не получится.', async () => { try { await apiPost('/api/task-delete', {id}); haptic('success'); await loadTasks(); render(); } catch (e) { toast(e.message, 'error'); } }, 'УДАЛИТЬ'); }
async function actionTasksClear() { modalConfirm('ОЧИСТИТЬ?', 'Все выполненные задачи удалятся.', async () => { try { await apiPost('/api/task-clear'); haptic('success'); await loadTasks(); render(); } catch (e) { toast(e.message, 'error'); } }, 'ОЧИСТИТЬ'); }
async function actionAISend() {
  const el = document.getElementById('ai-input');
  const question = (el?.value || '').trim();
  const hasPhoto = !!state.aiPendingPhoto;
  if (!question && !hasPhoto) { toast('Введи вопрос', 'error'); return; }
  if (hasPhoto) {
    state.aiMessages.push({role:'user', text: question || 'Что на фото?', photo: state.aiPendingPhoto});
    const photo = state.aiPendingPhoto;
    state.aiPendingPhoto = null; state.aiPending = true;
    if (el) el.value = ''; hideKeyboard(); render();
    try { const r = await apiPost('/api/ai-photo', {photo, question}); state.aiMessages.push({role:'assistant', text: r.answer || 'Нет ответа'}); haptic('success'); }
    catch (e) { state.aiMessages.push({role:'assistant', text: 'Ошибка: ' + e.message}); haptic('error'); }
    finally { state.aiPending = false; render(); }
    return;
  }
  state.aiMessages.push({role:'user', text: question}); state.aiPending = true;
  if (el) el.value = ''; hideKeyboard(); render();
  try { const r = await apiPost('/api/ai', {question}); state.aiMessages.push({role:'assistant', text: r.answer || 'Нет ответа'}); haptic('success'); }
  catch (e) { state.aiMessages.push({role:'assistant', text: 'Ошибка: ' + e.message}); haptic('error'); }
  finally { state.aiPending = false; render(); }
}
async function actionAICopy(idx) {
  const m = state.aiMessages[idx];
  if (!m || !m.text) return;
  try {
    await navigator.clipboard.writeText(m.text);
    haptic('success'); toast('Скопировано', 'success');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = m.text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Скопировано', 'success'); }
    catch (_) { toast('Не удалось скопировать', 'error'); }
    ta.remove();
  }
}
function actionAIClear() { modalConfirm('ОЧИСТИТЬ ЧАТ?', 'История удалится.', async () => { state.aiMessages = []; state.aiPendingPhoto = null; try { await apiPost('/api/ai/clear-history'); } catch(e){} render(); }, 'ОЧИСТИТЬ'); }
function actionAIPhotoOpen() { const input = document.getElementById('ai-photo-input'); if (input) input.click(); }
function actionAIPhotoRemove() { state.aiPendingPhoto = null; render(); }
function actionAIPhotoSelected(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('Фото до 8 МБ', 'error'); return; }
  if (!file.type.startsWith('image/')) { toast('Нужно изображение', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1600; let w = img.width, h = img.height;
      if (w > maxSide || h > maxSide) { if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; } else { w = Math.round(w * maxSide / h); h = maxSide; } }
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      state.aiPendingPhoto = canvas.toDataURL('image/jpeg', 0.85); render();
    };
    img.onerror = () => toast('Не удалось прочитать', 'error');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function actionForgetGroup() { modalConfirm('ЗАБЫТЬ ГРУППУ?', 'Расписание перестанет показываться.', async () => { try { await apiPost('/api/set-group', {group_id:'', group_name:'', subgroup:0}); if (state.profile) { state.profile.group = null; state.profile.group_id = null; } haptic('success'); await loadProfile(); render(); } catch (e) { toast(e.message, 'error'); } }, 'ЗАБЫТЬ'); }
async function actionAdminMonitor() { try { state.adminMonitor = await apiGet('/api/admin/monitor'); } catch (e) { state.adminMonitor = {ok:false, status:0, error:e.message}; } render(); }
function actionAdminBroadcast() {
  const el = document.getElementById('admin-broadcast-text');
  const text = (el?.value || '').trim();
  if (!text) { toast('Пустое', 'error'); return; }
  modalConfirm('ОТПРАВИТЬ ВСЕМ?', 'Уйдёт всем.', async () => {
    try { await apiPost('/api/admin/broadcast', {text}); if (el) el.value = ''; hideKeyboard(); haptic('success'); toast('Рассылка запущена', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }, 'ОТПРАВИТЬ');
}
function actionAdminFbReply(fid) {
  modalOpen({title:'ОТВЕТ', body: `<div class="label">ТЕКСТ</div><textarea class="input" id="fb-reply-text" rows="4"></textarea>`, actions:[
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'ОТПРАВИТЬ', style:'btn', onClick: async () => {
      const t = (document.getElementById('fb-reply-text')?.value || '').trim();
      if (!t) { toast('Пусто', 'error'); return; }
      try { await apiPost('/api/admin/feedback-reply', {id: fid, text: t}); hideKeyboard(); haptic('success'); toast('Отправлено', 'success'); await loadAdminFeedback(); await loadAdminStats(); render(); }
      catch (e) { toast(e.message, 'error'); }
    }}
  ]});
}
async function actionAdminFbPostpone(fid) { try { await apiPost('/api/admin/feedback-postpone', {id: fid}); haptic('success'); await loadAdminFeedback(); await loadAdminStats(); render(); } catch (e) { toast(e.message, 'error'); } }
async function actionAdminClearAiCache() {
  modalConfirm('ОЧИСТИТЬ AI-КЭШ?', 'Все сохранённые ответы ИИ удалятся.', async () => {
    try { await apiPost('/api/admin/clear-ai-cache'); haptic('success'); toast('Кэш очищен', 'success'); await loadAdminStats(); render(); }
    catch (e) { toast(e.message, 'error'); }
  }, 'ОЧИСТИТЬ');
}
function actionExportPdf() { modalConfirm('ЭКСПОРТ PDF?', 'PDF придёт в чат с ботом.', async () => { try { await apiPost('/api/export'); haptic('success'); toast('PDF отправлен в Telegram', 'success'); } catch (e) { toast(e.message, 'error'); } }, 'ЭКСПОРТ'); }
async function actionExportIcs(weeks) {
  try {
    toast('Готовлю .ics...', 'info');
    await apiPost('/api/export_ics', {weeks});
    haptic('success');
    toast('Файл отправлен в чат бота', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
async function actionShowMyFeedback() {
  try {
    const d = await apiGet('/api/feedback/my');
    if (!d.items.length) { toast('Обращений нет'); return; }
    const body = d.items.map(f => `
      <div style="border-bottom:1px solid var(--divider);padding:12px 0">
        <div style="font-size:11px;color:var(--text-2);margin-bottom:4px">#${f.id} · ${escapeHtml(f.status)}</div>
        <div style="font-weight:500;color:var(--text)">${escapeHtml(f.text)}</div>
        ${f.admin_reply ? `<div style="margin-top:6px;color:var(--cyan-dark);font-weight:600">Ответ: ${escapeHtml(f.admin_reply)}</div>` : ''}
      </div>
    `).join('');
    modalOpen({title:'МОИ ОБРАЩЕНИЯ', body, actions:[{label:'ЗАКРЫТЬ', style:'btn-secondary'}]});
  } catch (e) { toast(e.message, 'error'); }
}
function actionSetNotifyBefore() {
  modalOpen({title:'НАПОМИНАНИЕ', body: `<div class="card-subtitle">За сколько минут до пары</div><div class="choice-row">${[0,5,10,15,20,30,60].map(v => `<button class="choice" data-nb="${v}">${v===0?'Выкл':v+' мин'}</button>`).join('')}</div>`, actions:[
    {label:'ОТМЕНА', style:'btn-secondary'},
    {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
      const v = state._pendingNb || 0;
      try { await apiPost('/api/notify-set-before', {minutes: v}); haptic('success'); toast('Сохранено', 'success'); await loadProfile(); render(); }
      catch (e) { toast(e.message, 'error'); }
    }}
  ]});
  setTimeout(() => { document.querySelectorAll('[data-nb]').forEach(b => b.onclick = () => { state._pendingNb = parseInt(b.dataset.nb); document.querySelectorAll('[data-nb]').forEach(x => x.classList.remove('active')); b.classList.add('active'); }); }, 0);
}
async function actionAttendanceSet(date, time, subject, status) { try { await apiPost('/api/attendance-set', {date, time, subject, status}); haptic('success'); } catch (e) { toast(e.message, 'error'); } }
function actionAttHelp() {
  modalOpen({title:'КАК РАБОТАЕТ', body: `
    <div class="label">${icon('ic-was',18)} ПОСЕЩЕНО</div><div class="card-subtitle">Отметка о присутствии.</div>
    <div class="label">${icon('ic-missed',18)} ПРОПУЩЕНО</div><div class="card-subtitle">Пропуск без причины.</div>
    <div class="label">${icon('ic-sick',18)} БОЛЕЛ</div><div class="card-subtitle">Пропуск по болезни.</div>
    <div class="label">${icon('ic-excused',18)} УВАЖИТЕЛЬНАЯ</div><div class="card-subtitle">Уважительная причина.</div>
  `, actions:[{label:'ПОНЯТНО', style:'btn'}]});
}

function attachHandlers() {
  document.querySelectorAll('[data-action]').forEach(el => {
    if (el._bound) return;
    el._bound = true;
    el.addEventListener('click', () => handleAction(el));
  });
  document.querySelectorAll('[data-att]').forEach(el => {
    if (el._bound) return;
    el._bound = true;
    el.addEventListener('click', async () => {
      const att = el.dataset.att;
      const siblings = el.parentElement.querySelectorAll('[data-att]');
      siblings.forEach(s => s.classList.remove('on-was','on-missed','on-sick','on-excused'));
      el.classList.add('on-' + att);
      haptic('success');
      await actionAttendanceSet(el.dataset.date, el.dataset.time, el.dataset.subject, att);
    });
  });
  const notifyCb = document.getElementById('notify-changes');
  if (notifyCb && !notifyCb._boundChange) {
    notifyCb._boundChange = true;
    notifyCb.addEventListener('change', async (e) => {
      const val = e.target.checked;
      try {
        await apiPost('/api/notify-set', {changes: val});
        if (state.profile) state.profile.notify_changes = val;
        haptic('success');
      } catch (err) { haptic('error'); toast(err.message, 'error'); e.target.checked = !val; }
    });
  }
  const aiPhotoInput = document.getElementById('ai-photo-input');
  if (aiPhotoInput && !aiPhotoInput._boundChange) {
    aiPhotoInput._boundChange = true;
    aiPhotoInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) actionAIPhotoSelected(file);
      e.target.value = '';
    });
  }
  const slidesBox = document.getElementById('present-slides');
  if (slidesBox) slidesBox.querySelectorAll('.choice').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.onclick = () => {
      slidesBox.querySelectorAll('.choice').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.presentForm.slides = parseInt(b.dataset.slides, 10);
      haptic('light');
    };
  });
  const styleBox = document.getElementById('present-style');
  if (styleBox) styleBox.querySelectorAll('.choice').forEach(b => {
    if (b._bound) return; b._bound = true;
    b.onclick = () => {
      styleBox.querySelectorAll('.choice').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.presentForm.style = b.dataset.style;
      haptic('light');
    };
  });
  ['present-topic','present-info','present-wishes','present-author','present-group','present-teacher','present-year'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el._boundSave) return;
    el._boundSave = true;
    el.addEventListener('input', (e) => {
      const key = id.replace('present-','');
      const map = {topic:'topic', info:'info', wishes:'wishes', author:'author', group:'group', teacher:'teacher', year:'year'};
      if (map[key]) state.presentForm[map[key]] = e.target.value;
      if (id === 'present-info') {
        const card = e.target.closest('.card');
        const hint = card?.querySelectorAll('.card-subtitle')[1];
        if (hint) {
          const n = e.target.value.length;
          const ok = n >= 40;
          hint.innerHTML = `Вставь конспект, текст параграфа, свои тезисы (минимум 40 символов).<br>
            Из этого текста будут сделаны слайды. Если чего-то нет в тексте — в презентацию не попадёт.
            <br>Символов: ${n}${ok ? '' : ' — пока мало'}`;
          hint.style.color = ok ? '' : 'var(--red)';
        }
        const btn = document.querySelector('[data-action="present-build"]');
        if (btn && !state.presentBuilding) {
          const ok = e.target.value.length >= 40;
          btn.textContent = ok ? 'Собрать PPTX' : 'Нужен материал (мин. 40 символов)';
        }
      }
    });
  });
  const taskSearchEl = document.getElementById('tasks-search');
  if (taskSearchEl && !taskSearchEl._boundSearch) {
    taskSearchEl._boundSearch = true;
    let timer = null;
    taskSearchEl.addEventListener('input', (e) => {
      state.tasksSearch = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => loadTasks().then(render), 300);
    });
  }
  const taskSortEl = document.getElementById('tasks-sort');
  if (taskSortEl && !taskSortEl._boundSort) {
    taskSortEl._boundSort = true;
    taskSortEl.addEventListener('change', (e) => {
      state.tasksSort = e.target.value;
      loadTasks().then(render);
    });
  }
  const noteSearchEl = document.getElementById('notes-search');
  if (noteSearchEl && !noteSearchEl._boundSearch) {
    noteSearchEl._boundSearch = true;
    let timer = null;
    noteSearchEl.addEventListener('input', (e) => {
      state.notesSearch = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => loadNotes().then(render), 300);
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
  else if (a === 'tasks-filter-tag') { state.tasksTag = el.dataset.value || ''; loadTasks().then(render); }
  else if (a === 'note-add-open') actionNoteAdd();
  else if (a === 'note-edit-open') actionNoteEdit(parseInt(el.dataset.id));
  else if (a === 'note-delete') actionNoteDelete(parseInt(el.dataset.id));
  else if (a === 'note-pin') actionNotePin(parseInt(el.dataset.id));
  else if (a === 'notes-filter-tag') { state.notesTag = el.dataset.value || ''; loadNotes().then(render); }
  else if (a === 'sch-set-amount') actionScholarshipSetAmount();
  else if (a === 'sch-add-grade') actionScholarshipAddGrade();
  else if (a === 'sch-edit-grade') actionScholarshipAddGrade(parseInt(el.dataset.id,10));
  else if (a === 'sch-del-grade') actionScholarshipDeleteGrade(parseInt(el.dataset.id,10));
  else if (a === 'sch-clear') actionScholarshipClear(el.dataset.sem || '');
  else if (a === 'sch-sem') { state.schFilterSemester = el.dataset.value || ''; render(); }
  else if (a === 'ai-send') actionAISend();
  else if (a === 'ai-clear') actionAIClear();
  else if (a === 'ai-photo-open') actionAIPhotoOpen();
  else if (a === 'ai-photo-remove') actionAIPhotoRemove();
  else if (a === 'ai-copy') actionAICopy(parseInt(el.dataset.aiIdx,10));
  else if (a === 'present-build') actionPresentBuild();
  else if (a === 'choose-group') actionChooseGroup();
  else if (a === 'forget-group') actionForgetGroup();
  else if (a === 'picker-back') actionPickerBack();
  else if (a === 'picker-choose-institute') actionPickerChooseInstitute(el.dataset.value);
  else if (a === 'picker-choose-course') actionPickerChooseCourse(el.dataset.value);
  else if (a === 'picker-choose-group') actionPickerChooseGroup(el.dataset.id, el.dataset.name);
  else if (a === 'notify-open') actionOpenNotifyEditor();
  else if (a === 'notify-back') actionNotifyBack();
  else if (a === 'notify-set-type') actionNotifySetType(el.dataset.value);
  else if (a === 'notify-quick') actionNotifyQuick(parseInt(el.dataset.h,10), parseInt(el.dataset.m,10));
  else if (a === 'notify-save') actionNotifySave();
  else if (a === 'notify-off') actionNotifyOff();
  else if (a === 'notify-hide-kb') actionNotifyHideKb();
  else if (a === 'notify-before') actionSetNotifyBefore();
  else if (a === 'go-profile') { state.tab = 'profile'; loadTabData('profile'); }
  else if (a === 'week-prev') { state.weekOffset -= 1; state.scheduleViewMode = 'week'; state.scheduleDay = null; loadWeekAndRender(); }
  else if (a === 'week-next') { state.weekOffset += 1; state.scheduleViewMode = 'week'; state.scheduleDay = null; loadWeekAndRender(); }
  else if (a === 'week-current') { const now = nowIrkutsk(); state.weekOffset = (now.getDay() === 0) ? 1 : 0; state.scheduleViewMode = 'week'; state.scheduleDay = null; loadWeekAndRender(); }
  else if (a === 'week-today') { loadTodayAndRender(); }
  else if (a === 'day-today') { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; haptic('light'); render(); }
  else if (a === 'day-tomorrow') { state.scheduleDay = 'tomorrow'; state.scheduleViewMode = 'today'; haptic('light'); if (!state.weekDays) { render(); ensureWeekLoaded().then(render); } else render(); }
  else if (a === 'admin-monitor') actionAdminMonitor();
  else if (a === 'admin-broadcast') actionAdminBroadcast();
  else if (a === 'admin-fb-reply') actionAdminFbReply(parseInt(el.dataset.id));
  else if (a === 'admin-fb-postpone') actionAdminFbPostpone(parseInt(el.dataset.id));
  else if (a === 'admin-clear-ai-cache') actionAdminClearAiCache();
  else if (a === 'export-pdf') actionExportPdf();
  else if (a === 'export-ics') actionExportIcs(2);
  else if (a === 'export-ics-2weeks') actionExportIcs(2);
  else if (a === 'export-ics-4weeks') actionExportIcs(4);
  else if (a === 'show-my-feedback') actionShowMyFeedback();
  else if (a === 'att-help') actionAttHelp();
}
function actionDayToday() { state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; render(); }
function actionDayTomorrow() { state.scheduleDay = 'tomorrow'; state.scheduleViewMode = 'today'; if (!state.weekDays) { render(); ensureWeekLoaded().then(render); } else render(); }

document.querySelectorAll('.nav-btn').forEach(btn => {
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

setInterval(() => {
  if (state.tab === 'schedule' && !state.loading && !state.pickerMode && !state.notifyEditor) {
    render();
  }
}, 30000);

(async function init() {
  await loadTabData(state.tab);
})();
