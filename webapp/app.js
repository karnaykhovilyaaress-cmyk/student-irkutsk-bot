const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();
try { tg.requestFullscreen?.(); } catch(e){}
try { tg.lockOrientation?.('portrait'); } catch(e){}
try { tg.disableVerticalSwipes?.(); } catch(e){}
try { tg.enableClosingConfirmation?.(); } catch(e){}

const tgUser = tg.initDataUnsafe?.user || { first_name:'Гость', last_name:'', username:'', id:0 };
const INIT_DATA = tg.initData || '';

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
  notes:[], notesSubjects:[],
  profile:null, scholarship:null, groups:null,
  pickerMode:null, pickerInstitute:null, pickerCourse:null, pickerSearch:'',
  notifyEditor:false, notifyEditorType:'today', notifyEditorHour:8, notifyEditorMinute:0,
  aiMessages:[], aiPending:false, aiPendingPhoto:null,
  adminStats:null, adminFeedback:[], adminMonitor:null, adminBusy:false,
  achData:null, chestStatus:null, chestTimer:null,
  avatarGender:'male',
};

const IMG_CACHE = {};
function preloadImages() {
  const urls = [
    '/assets/head_1.webp', '/assets/head_2.webp',
    '/assets/ic_shift.webp', '/assets/ic_nova.webp',
    '/assets/capsule.webp', '/assets/relic.webp', '/assets/artifact.webp', '/assets/core.webp',
  ];
  urls.forEach(u => { const i = new Image(); i.src = u; IMG_CACHE[u] = i; });
}
preloadImages();

function icon(id, size=16, cls='') {
  return `<svg width="${size}" height="${size}" class="${cls}"><use href="#${id}"/></svg>`;
}
function icShift(size=18) { return `<img class="coin" style="width:${size}px;height:${size}px" src="/assets/ic_shift.webp" alt="">`; }
function icNova(size=18)  { return `<img class="coin" style="width:${size}px;height:${size}px" src="/assets/ic_nova.webp"  alt="">`; }
function icXp(size=16)    { return icon('ic-xp', size); }
function avatarImg(gender) {
  const g = (gender === 'female') ? 'head_2.webp' : 'head_1.webp';
  return `/assets/${g}`;
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{2764}\u{2705}\u{274C}\u{2757}\u{2728}\u{1F4A5}\u{1F525}\u{1F4E6}\u{1F48E}\u{1F3C6}\u{1F389}\u{1F381}\u{1F4B0}\u{1F4B8}\u{1F4B5}]/gu;
function stripEmoji(s){ return (s||'').replace(EMOJI_RE,'').replace(/\s+/g,' ').trim(); }

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
function popIcon(id){
  const el = document.createElement('div');
  el.innerHTML = `<svg width="72" height="72"><use href="#${id}"/></svg>`;
  el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);animation:pop .6s ease-out;z-index:99999;pointer-events:none';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 600);
}

function toast(text, type='info') {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = stripEmoji(text);
  wrap.appendChild(el);
  setTimeout(()=>{
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    setTimeout(()=>el.remove(), 300);
  }, 2200);
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
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2,'0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2,'0');
  const s = String(total % 60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function render() {
  const content = document.getElementById('content');
  const title = document.getElementById('page-title');
  const appEl = document.getElementById('app');
  const navEl = document.getElementById('bottom-nav');
  const titles = {schedule:'Расписание', tasks:'Задачи', notes:'Заметки', games:'Игры',
    ai:'AI', admin:'Админ', profile:'Профиль'};

  /* 🎨 Устанавливаем класс фона в зависимости от вкладки */
  if (appEl) {
    appEl.classList.remove('bg-schedule','bg-tasks','bg-notes','bg-games','bg-ai','bg-admin','bg-profile');
    appEl.classList.add('bg-' + (state.tab || 'schedule'));
  }

  if (state.notifyEditor) {
    appEl?.classList.add('picker-open');
    title.textContent = 'Уведомления';
    navEl.style.display = 'none';
    content.innerHTML = renderNotifyEditor();
    attachHandlers();
    return;
  }
  if (state.pickerMode) {
    appEl?.classList.add('picker-open');
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
      case 'games': html = renderGames(); break;
      case 'ai': html = renderAI(); break;
      case 'admin': html = renderAdmin(); break;
      case 'profile': html = renderProfile(); break;
    }
  }
  content.innerHTML = html;
  document.querySelectorAll('.nav-btn').forEach(b => {
    const isAdmin = b.dataset.tab === 'admin';
    b.style.display = (isAdmin && !state.isAdmin) ? 'none' : '';
    b.classList.toggle('active', b.dataset.tab === state.tab);
  });
  attachHandlers();
  if (state.tab === 'profile' && !state.loading) loadWalletIntoProfile();
  if (state.tab === 'schedule' && !state.loading) attachSwipe();
}

function renderUserBar() {
  const u = state.user;
  const p = state.profile;
  const gender = p?.avatar_gender || state.avatarGender || 'male';
  const wallet = p?.wallet || {};
  const displayName = wallet.custom_name
    || [u.first_name, u.last_name].filter(Boolean).join(' ')
    || 'Гость';
  const metaParts = [];
  if (p?.group) metaParts.push(p.group + (p.subgroup ? ` · ${p.subgroup}` : ''));
  if (u.username && !wallet.custom_name) metaParts.push('@' + u.username);
  return `<div class="user-bar" data-action="go-profile">
    <div class="user-bar-avatar">
      <img src="${avatarImg(gender)}" alt="">
    </div>
    <div class="user-bar-info">
      <div class="user-bar-name">${escapeHtml(displayName)}</div>
      <div class="user-bar-meta">${escapeHtml(metaParts.join(' · ')||'профиль не заполнен')}</div>
    </div>
    <div class="user-bar-badges">
      <div class="user-badge">${icon('ic-task',16)} <span>${p?.tasks_active ?? 0}</span></div>
    </div>
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
    return renderUserBar() + `<div class="card">
      <div class="card-title">Как начать</div>
      <div class="card-subtitle">1. Профиль и «Выбрать группу»</div>
      <div class="card-subtitle">2. Укажи институт, курс и группу</div>
      <div class="card-subtitle">3. Вернись — расписание появится</div>
      <div class="actions-row"><button class="btn" data-action="go-profile">Выбрать группу</button></div>
    </div>`;
  }
  let html = renderUserBar() + renderDaySwitch();
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
function renderNotifyEditor() {
  const cur = state.notifyEditorType;
  const hh = state.notifyEditorHour;
  const mm = state.notifyEditorMinute;
  const timeVal = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  return `
    <div class="picker-header">
      <button class="picker-back" data-action="notify-back">${icon('ic-chevron-left',20)}</button>
      <div class="picker-title">Уведомления</div>
    </div>
    <div class="card">
      <div class="card-title">Когда напоминать</div>
      <div class="tab-buttons" style="margin-bottom:12px">
        <button data-action="notify-set-type" data-value="today" class="${cur==='today'?'active':''}">Сегодня</button>
        <button data-action="notify-set-type" data-value="tomorrow" class="${cur==='tomorrow'?'active':''}">Завтра</button>
      </div>
      <div class="card-subtitle">${cur==='today' ? 'Расписание на сегодня. До 10:00.' : 'Расписание на завтра. Любое время.'}</div>
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

function renderTasks() {
  const tasks = state.tasks;
  const stats = state.tasksStats;
  let html = `<div class="tab-buttons">
    <button data-action="tasks-show-active" class="${state.tasksView==='active'?'active':''}">Активные (${stats.active})</button>
    <button data-action="tasks-show-done" class="${state.tasksView==='done'?'active':''}">Выполненные (${stats.done})</button>
  </div>`;
  if (state.tasksView === 'active') html += `<button class="btn" data-action="task-add-open" style="width:100%;margin-bottom:12px">${icon('ic-plus',18)} Добавить задачу</button>`;
  if (!tasks?.length) {
    html += state.tasksView === 'active'
      ? '<div class="empty">Задач нет. Добавь первую!</div>'
      : '<div class="empty">Нет выполненных</div>';
    return html;
  }
  const prioMap = {1: {cls:'low', label:'Низкий'}, 2: {cls:'medium', label:'Средний'}, 3: {cls:'high', label:'Высокий'}};
  for (const t of tasks) {
    const p = prioMap[t.priority] || prioMap[2];
    const dueStr = t.due_date
      ? `<span class="${t.overdue?'overdue':''}">до ${escapeHtml(t.due_date)}${t.due_time?' '+escapeHtml(t.due_time):''}${t.overdue?' — просрочено':''}</span>`
      : '<span style="color:var(--text-2)">без срока</span>';
    html += `<div class="card task-card prio-${p.cls}">
      <div class="card-title">${escapeHtml(t.text)}</div>
      <div class="card-meta">
        <span class="task-prio-badge ${p.cls}">${p.label}</span>
        ${dueStr}
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

function renderNotes() {
  let html = `<button class="btn" data-action="note-add-open" style="width:100%;margin-bottom:12px">${icon('ic-plus',18)} Добавить заметку</button>`;
  if (!state.notes?.length) {
    html += '<div class="empty">Заметок нет.</div>';
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

function renderGames() {
  return `<div class="games-list">
    <div class="game-card">
      <div class="game-card-title">${icon('ic-game-flappy',28)} ДО ПАРЫ УСПЕТЬ</div>
      <div class="game-card-sub">Пролетай между парами, собирай бонусы, ставь рекорды.</div>
      <div class="actions-row">
        <button class="btn" data-action="open-flappy">ИГРАТЬ</button>
        <button class="btn btn-secondary" data-action="open-flappy-records">РЕКОРДЫ</button>
      </div>
    </div>
    <div class="game-card">
      <div class="game-card-title">${icon('ic-game-bs',28)} МОРСКОЙ БОЙ</div>
      <div class="game-card-sub">PvP по коду или с ботом. Ставки: 10 / 50 / 100 / 500 Шифт.</div>
      <div class="actions-row">
        <button class="btn" data-action="open-bs">ОТКРЫТЬ</button>
      </div>
    </div>
  </div>`;
}

function renderAI() {
  let html = '';
  if (!state.aiMessages.length) {
    html += `<div class="card">
      <div class="card-title">AI Помощник</div>
      <div class="card-subtitle">Задай вопрос или прикрепи фото с задачей.</div>
    </div>`;
  } else {
    for (const m of state.aiMessages) {
      const txt = stripEmoji(m.text);
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
        html += `<div class="card"><div style="white-space:pre-wrap">${escapeHtml(txt)}</div></div>`;
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
  return html;
}

function renderAdmin() {
  if (!state.isAdmin) return '<div class="empty">Доступ только для админа</div>';
  let html = '';
  if (state.adminStats) {
    html += `<div class="card">
      <div class="card-title">Статистика</div>
      <div class="card-subtitle">Пользователей: ${state.adminStats.total_users}</div>
      <div class="card-subtitle">Обращений: ${state.adminStats.pending_feedback}</div>
    </div>`;
  } else html += '<div class="skeleton-card"></div>';
  html += `<div class="card">
    <div class="card-title">Мониторинг ИРНИТУ</div>
    ${state.adminMonitor
      ? (state.adminMonitor.ok
          ? `<div class="card-subtitle" style="color:var(--green)">Отвечает (HTTP ${state.adminMonitor.status})</div>`
          : `<div class="card-subtitle overdue">Не отвечает</div>`)
      : '<div class="card-subtitle">Не проверено</div>'}
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

function levelTitleByLevel(lvl) {
  if (lvl <= 5) return 'Первокурсник';
  if (lvl <= 10) return 'Второкурсник';
  if (lvl <= 15) return 'Третьекурсник';
  if (lvl <= 20) return 'Старшекурсник';
  if (lvl <= 25) return 'Магистрант';
  if (lvl <= 29) return 'Аспирант';
  return 'Легенда ИРНИТУ';
}
function calcLevelInfo(xp) {
  let lvl = 1, left = xp || 0;
  while (lvl <= 30) {
    const need = lvl * 500;
    if (left < need) return {level: lvl, inLevel: left, toNext: need - left};
    left -= need; lvl++;
  }
  return {level: 30, inLevel: left, toNext: 500};
}

async function loadSchedule() {
  try { state.schedule = await apiGet('/api/schedule'); }
  catch (e) { state.schedule = {error:'load_error', message:e.message}; }
}
async function loadTasks() {
  try {
    const doneParam = state.tasksView === 'done' ? '1' : '0';
    const r = await apiGet('/api/tasks', {done: doneParam});
    state.tasks = r.tasks || [];
    state.tasksStats = {active: r.active || 0, done: r.done || 0};
  } catch (e) { state.tasks = []; }
}
async function loadNotes() {
  try {
    const r = await apiGet('/api/notes');
    state.notes = r.notes || [];
    const subs = new Set(state.notes.map(n => n.subject));
    state.notesSubjects = Array.from(subs);
  } catch (e) { state.notes = []; }
}
async function loadProfile() {
  try {
    state.profile = await apiGet('/api/me');
    state.isAdmin = !!state.profile.is_admin;
    if (state.profile.avatar_gender) state.avatarGender = state.profile.avatar_gender;
  } catch (e) { state.profile = {error:e.message}; }
}
async function loadScholarship() {
  try { state.scholarship = await apiGet('/api/scholarship'); }
  catch (e) { state.scholarship = null; }
}
async function loadGroups(force=false) {
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
      ensureWeekLoaded().catch(()=>{});
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

async function ensureWeekLoaded() {
  if (state.weekDays?.days?.length) return true;
  try { state.weekDays = await apiGet('/api/week', {offset:0}); return true; }
  catch(e){ return false; }
}
async function loadWeekAndRender() {
  try {
    const r = await apiGet('/api/week', {offset: state.weekOffset});
    state.weekDays = r;
    state.scheduleViewMode = 'week';
    render();
  } catch (e) { toast('Ошибка загрузки', 'error'); }
}
async function loadTodayAndRender() {
  state.scheduleViewMode = 'today';
  state.weekOffset = 0;
  state.weekDays = null;
  state.scheduleDay = 'today';
  await loadSchedule();
  render();
}

function levelRewardByLevel(lvl) {
  if (lvl <= 5) return `+100 ${icShift(14)} · +1 ${icNova(14)}`;
  if (lvl <= 10) return `+250 ${icShift(14)} · +3 ${icNova(14)}`;
  if (lvl <= 20) return `+600 ${icShift(14)} · +8 ${icNova(14)}`;
  return `+1500 ${icShift(14)} · +25 ${icNova(14)}`;
}
async function openLevels() {
  const screen = document.getElementById('screen-levels');
  if (!screen) return;
  screen.style.display = 'block';
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('levelsBack').onclick = closeLevels;
  const w = await apiGet('/api/wallet').catch(()=>null);
  if (!w) return;
  const wallet = w.wallet || {};
  const xp = wallet.xp || 0;
  const lv = calcLevelInfo(xp);
  document.getElementById('levelsCurrent').textContent = lv.level;
  document.getElementById('levelsLeft').textContent = lv.toNext + 'XP';
  document.getElementById('levelsSoft').textContent = wallet.shift ?? wallet.soft ?? 0;
  document.getElementById('levelsHard').textContent = wallet.nova ?? wallet.hard ?? 0;
  const total = lv.inLevel + lv.toNext;
  const pct = total ? (lv.inLevel / total) * 100 : 0;
  document.getElementById('levelsXpFill').style.width = pct + '%';
  document.getElementById('levelsXpCur').textContent = lv.inLevel + 'XP';
  document.getElementById('levelsXpNext').textContent = total + 'XP';
  const claimed = await apiGet('/api/level-rewards').catch(()=>({claimed:[]}));
  const claimedSet = new Set(claimed.claimed || []);
  const list = document.getElementById('levelsList');
  let html = '';
  for (let i = 1; i <= 30; i++) {
    const need = i * 500;
    const canClaim = lv.level >= i;
    const isClaimed = claimedSet.has(i);
    const cls = isClaimed ? 'done' : (i === lv.level ? 'current' : (i < lv.level ? 'done' : 'locked'));
    const btnLabel = isClaimed ? 'ПОЛУЧЕНО' : (canClaim ? 'ЗАБРАТЬ' : 'ЗАКРЫТО');
    const disabled = !canClaim || isClaimed;
    html += `<div class="levels-row ${cls}">
      <div class="levels-row-left">
        <div class="levels-row-name">УРОВЕНЬ ${i}</div>
        <div class="levels-row-sub">от ${need.toLocaleString('ru-RU')}XP · ${levelTitleByLevel(i)}</div>
        <div class="levels-row-reward">${levelRewardByLevel(i)}</div>
      </div>
      <button class="levels-row-btn" data-level="${i}" ${disabled?'disabled':''}>${btnLabel}</button>
    </div>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('button[data-level]').forEach(btn => {
    btn.onclick = async () => {
      const lvl = parseInt(btn.dataset.level, 10);
      try {
        const r = await apiPost('/api/level-reward-claim', {level: lvl});
        haptic('success'); popIcon('ic-gift');
        const rw = r.reward || {};
        toast(`+${rw.shift||0} Шифт · +${rw.nova||0} Нова`, 'success');
        closeLevels(); openLevels();
      } catch (e) {
        if (e.code === 'already') toast('Уже получено', 'error');
        else if (e.code === 'locked') toast('Уровень не достигнут', 'error');
        else toast(e.message, 'error');
      }
    };
  });
}
function closeLevels() {
  document.getElementById('screen-levels').style.display = 'none';
  document.getElementById('bottom-nav').style.display = '';
  if (state && state.tab === 'profile') loadTabData('profile');
}
async function openLeaderboard() {
  try {
    const d = await apiGet('/api/wallet/leaderboard');
    const rows = d.items.map(it => `<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--divider)">
      <span style="font-family:'Anton',sans-serif;font-style:italic;color:var(--cyan-dark);min-width:28px;font-size:18px">${it.rank}</span>
      <span style="flex:1;font-weight:600${it.is_me?';color:var(--cyan-dark)':''}">${escapeHtml(it.display)}${it.is_me?' (ты)':''}</span>
      <span style="font-family:'Anton',sans-serif;font-style:italic;display:flex;align-items:center;gap:4px">${it.xp} ${icXp(14)}</span>
    </div>`).join('');
    modalOpen({title:'ТОП ИГРОКОВ', body: rows || '<div class="empty">Пока нет игроков</div>',
      actions:[{label:'ЗАКРЫТЬ', style:'btn-secondary'}]});
  } catch (e) { toast('Ошибка', 'error'); }
}


function renderProfile() {
  const p = state.profile;
  const u = state.user;
  const wallet = p?.wallet || {};
  const displayName = wallet.custom_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Гость';
  const level = wallet.level || 1;
  const title = levelTitleByLevel(level);
  const xp = wallet.xp || 0;
  const lv = calcLevelInfo(xp);
  const total = lv.inLevel + lv.toNext;
  const pct = total ? (lv.inLevel / total) * 100 : 0;
  const gender = state.avatarGender || p?.avatar_gender || 'male';

  const metaParts = [];
  if (p?.group) metaParts.push(p.group + (p.subgroup ? ` · подгр. ${p.subgroup}` : ''));
  if (u.username && !wallet.custom_name) metaParts.push('@' + u.username);

  let html = `<div class="profile-hero">
    <img class="profile-hero-head" src="${avatarImg(gender)}" alt="">
    <div class="avatar-switch-wrap">
      <div class="avatar-switch">
        <button class="${gender==='male'?'active':''}" data-action="set-gender" data-value="male">♂ Он</button>
        <button class="${gender==='female'?'active':''}" data-action="set-gender" data-value="female">♀ Она</button>
      </div>
    </div>
    <div class="profile-hero-name">
      <span class="profile-hero-name-text">${escapeHtml(displayName)}</span>
      <button class="profile-name-edit" data-action="set-name" title="Изменить имя">
        ${icon('ic-pencil',16)}
      </button>
    </div>
    <div class="profile-hero-level">
      <span class="profile-hero-level-num">${level} LVL</span>
      <span class="profile-hero-level-dot">·</span>
      <span class="profile-hero-level-title">${escapeHtml(title)}</span>
    </div>
    ${metaParts.length ? `<div class="profile-hero-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
    <div class="profile-hero-xpbar">
      <div class="profile-hero-xpbar-fill" style="width:${pct}%"></div>
      <span class="profile-hero-xpbar-cur">${lv.inLevel} XP</span>
      <span class="profile-hero-xpbar-next">${total} XP</span>
    </div>
    <div class="profile-hero-wallet">
      <div class="profile-hero-wallet-item">
        <div class="profile-hero-wallet-icon"><img src="/assets/ic_shift.webp" alt=""></div>
        <div class="profile-hero-wallet-body">
          <div class="profile-hero-wallet-value">${wallet.shift ?? wallet.soft ?? 0}</div>
          <div class="profile-hero-wallet-label">Шифт</div>
        </div>
      </div>
      <div class="profile-hero-wallet-item">
        <div class="profile-hero-wallet-icon"><img src="/assets/ic_nova.webp" alt=""></div>
        <div class="profile-hero-wallet-body">
          <div class="profile-hero-wallet-value">${wallet.nova ?? wallet.hard ?? 0}</div>
          <div class="profile-hero-wallet-label">Нова</div>
        </div>
      </div>
    </div>
    <div class="profile-hero-actions">
      <button class="btn btn-secondary" data-action="open-levels">${icon('ic-gift',14)} УРОВНИ</button>
      <button class="btn btn-secondary" data-action="open-leaderboard">${icon('ic-trophy',14)} ТОП</button>
      <button class="btn btn-secondary" data-action="exchange">${icon('ic-exchange',14)} ОБМЕН</button>
    </div>
  </div>`;

  const achCanClaim = state.achData?.can_claim_count || 0;
  const achGot = state.achData?.got || 0;
  const achTotal = state.achData?.total || 0;

  html += `<div class="section-title">Кейсы</div>`;
  html += `<div class="chests-grid chests-grid-img">
    ${renderChestTile('capsule', 'Капсула', 'Бесплатно')}
    ${renderChestTile('relic', 'Реликт', '50 Шифт')}
    ${renderChestTile('artifact', 'Артефакт', '15 Нова')}
    ${renderChestTile('core', 'Ядро', '80 Нова')}
  </div>`;

  html += `<div class="section-title">Достижения</div>`;
  html += `<div class="card">
    <div class="ach-mini-row">
      <div class="ach-mini-num">${achGot}<span class="ach-mini-of">/${achTotal || 12}</span></div>
      <div class="ach-mini-label">разблокировано</div>
      ${achCanClaim > 0 ? `<button class="btn btn-gold" data-action="show-achievements" style="margin-left:auto">${icon('ic-gift',14)} ЗАБРАТЬ ${achCanClaim}</button>` : ''}
    </div>
    ${achCanClaim === 0 ? `<div class="actions-row"><button class="btn btn-secondary" data-action="show-achievements" style="width:100%">ПОСМОТРЕТЬ ВСЕ</button></div>` : ''}
  </div>`;

  html += `<div class="section-title">Учёба</div>`;
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

  html += `<div class="card"><div class="card-title">Стипендия</div>`;
  if (state.scholarship) {
    const s = state.scholarship;
    html += `<div class="card-subtitle">Текущая: ${s.amount != null ? escapeHtml(s.amount) + ' руб./мес' : 'не указана'}</div>`;
    html += `<div class="card-subtitle">Оценок: ${s.grades.length}</div>`;
    if (s.grades.length) html += `<div class="card-subtitle">Средний балл: ${s.avg}</div>`;
    if (s.forecast) html += `<div class="card-subtitle">${escapeHtml(stripEmoji(s.forecast))}</div>`;
  }
  html += `<div class="actions-row">
    <button class="btn btn-secondary" data-action="sch-set-amount">Сумма</button>
    <button class="btn btn-secondary" data-action="sch-add-grade">Оценка</button>
    <button class="btn btn-secondary" data-action="sch-clear">Очистить</button>
  </div></div>`;

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
      ${p?.daily_subscribed
        ? `<button class="btn btn-secondary" data-action="quote-subscribe" data-value="0">Отписаться</button>`
        : `<button class="btn" data-action="quote-subscribe" data-value="1">Подписаться</button>`}
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

function renderChestTile(id, name, sub) {
  const status = state.chestStatus || {};
  const canOpen = id !== 'capsule' || status.can_open !== false;
  const timer = id === 'capsule' && status.next_at
    ? `<div class="chest-timer" data-chest-timer="${escapeHtml(status.next_at)}">--:--:--</div>`
    : '';
  return `<div class="chest-card chest-card-img ${canOpen?'':'locked'}" data-action="chest-modal" data-id="${id}">
    ${timer}
    <div class="chest-img-wrap">
      <img class="chest-img" src="/assets/${id}.webp" alt="${escapeHtml(name)}" loading="lazy">
    </div>
    <div class="chest-name">${escapeHtml(name)}</div>
    <div class="chest-sub">${escapeHtml(sub)}</div>
  </div>`;
}
function startChestTimer() {
  if (state.chestTimer) clearInterval(state.chestTimer);
  const update = () => {
    document.querySelectorAll('[data-chest-timer]').forEach(el => {
      const iso = el.getAttribute('data-chest-timer');
      const target = new Date(iso).getTime();
      const left = target - Date.now();
      el.textContent = left <= 0 ? 'ГОТОВО' : fmtCountdown(left);
    });
  };
  update();
  state.chestTimer = setInterval(update, 1000);
}
async function loadWalletIntoProfile() {
  try {
    const [w, ach, chest] = await Promise.all([
      apiGet('/api/wallet'),
      apiGet('/api/achievements').catch(() => null),
      apiGet('/api/chest/status').catch(() => null),
    ]);
    state.chestStatus = chest;
    if (w.wallet && state.profile) state.profile.wallet = w.wallet;
    if (ach) state.achData = ach;
    startChestTimer();
  } catch (e) {}
}

const Flappy = {
  canvas:null, ctx:null, raf:null, running:false,
  score:0, best:0, top:[],
  bird:{x:0,y:0,vy:0,r:14,rot:0},
  pipes:[], bonuses:[], frame:0,
  gravity:0.45, jump:-7.5, speed:2.6, gap:150, pipeW:62,
  spawnEvery:88, width:0, height:0, groundH:100,
  resizeBound:false, lastT:0, shieldUntil:0, slowUntil:0, bonusesCollected:0,
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
  document.getElementById('screen-flappy').style.display = 'none';
  flappyStop();
  document.getElementById('bottom-nav').style.display = '';
  if (state.tab === 'games') loadTabData('games');
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
    const f = (d.games||[]).find(g => g.id === 'flappy');
    Flappy.best = f ? (f.best||0) : 0;
    document.getElementById('flappyBestTop').textContent = Flappy.best;
    Flappy.top = (d.tops && d.tops.flappy) || [];
  } catch(e){}
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
  Flappy.ctx.setTransform(dpr,0,0,dpr,0,0);
  Flappy.groundH = Math.max(80, Flappy.height * 0.14);
  flappyReset();
}
function flappyReset() {
  Flappy.bird.x = Flappy.width * 0.3;
  Flappy.bird.y = Flappy.height * 0.45;
  Flappy.bird.vy = 0; Flappy.bird.rot = 0;
  Flappy.pipes = []; Flappy.bonuses = []; Flappy.frame = 0; Flappy.score = 0;
  Flappy.bonusesCollected = 0; Flappy.shieldUntil = 0; Flappy.slowUntil = 0;
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
  const now = performance.now();
  const slowed = now < Flappy.slowUntil;
  const effSpeed = slowed ? Flappy.speed * 0.5 : Flappy.speed;
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
    Flappy.pipes.push({x: Flappy.width+10, top: topH, gap: Flappy.gap, passed: false});
    if (Math.random() < 0.3) {
      const bx = Flappy.width + 10 + Flappy.pipeW + 60;
      const by = 80 + Math.random() * (Flappy.height - Flappy.groundH - 160);
      const types = ['shift','shift','shield','slow'];
      Flappy.bonuses.push({x: bx, y: by, type: types[Math.floor(Math.random()*types.length)], taken:false});
    }
  }
  for (const p of Flappy.pipes) p.x -= effSpeed * dt;
  Flappy.pipes = Flappy.pipes.filter(p => p.x + Flappy.pipeW > -20);
  for (const bo of Flappy.bonuses) bo.x -= effSpeed * dt;
  Flappy.bonuses = Flappy.bonuses.filter(b => b.x > -40 && !b.taken);
  const shielded = now < Flappy.shieldUntil;
  for (const p of Flappy.pipes) {
    if (b.x + b.r > p.x && b.x - b.r < p.x + Flappy.pipeW) {
      if (b.y - b.r < p.top || b.y + b.r > p.top + p.gap) {
        if (shielded) { Flappy.shieldUntil = 0; continue; }
        flappyGameOver(); return;
      }
    }
    if (!p.passed && p.x + Flappy.pipeW < b.x - b.r) {
      p.passed = true;
      Flappy.score++;
      document.getElementById('flappyScore').textContent = Flappy.score;
      haptic('light');
    }
  }
  for (const bo of Flappy.bonuses) {
    if (bo.taken) continue;
    const dist = Math.hypot(bo.x - b.x, bo.y - b.y);
    if (dist < b.r + 16) {
      bo.taken = true;
      Flappy.bonusesCollected++;
      if (bo.type === 'shift') { Flappy.score += 2; haptic('success'); }
      if (bo.type === 'shield') { Flappy.shieldUntil = now + 3000; haptic('success'); }
      if (bo.type === 'slow') { Flappy.slowUntil = now + 3000; haptic('success'); }
    }
  }
}
function flappyDraw() {
  const ctx = Flappy.ctx;
  const W = Flappy.width, H = Flappy.height, GH = Flappy.groundH;
  const sky = ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#B8F4FF'); sky.addColorStop(0.6,'#7FE9FF'); sky.addColorStop(1,'#3EE6D2');
  ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const bw = 70;
  for (let i=0; i<6; i++) {
    ctx.fillRect(i*(bw+40)+10, H*0.15, bw, 6);
    ctx.fillRect(i*(bw+40)+10, H*0.25, bw, 6);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold ' + Math.round(W*0.12) + 'px Anton, sans-serif';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.35;
  ctx.fillText('STUDENT', W/2, H*0.28);
  ctx.fillText('IRK', W/2, H*0.38);
  ctx.globalAlpha = 1;
  for (const p of Flappy.pipes) {
    flappyDrawPipe(p.x, 0, Flappy.pipeW, p.top, true);
    flappyDrawPipe(p.x, p.top+p.gap, Flappy.pipeW, H-GH-p.top-p.gap, false);
  }
  for (const bo of Flappy.bonuses) {
    if (bo.taken) continue;
    ctx.save(); ctx.translate(bo.x, bo.y);
    if (bo.type === 'shift') {
      ctx.fillStyle = '#3EE6D2';
      ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(14,0); ctx.lineTo(0,14); ctx.lineTo(-14,0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0A0E0F'; ctx.font = 'bold 11px Anton'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S', 0, 1);
    } else if (bo.type === 'shield') {
      ctx.fillStyle = '#22A06B';
      ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 14px Anton'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', 0, 1);
    } else {
      ctx.fillStyle = '#FFA42B';
      ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#0A0E0F'; ctx.font = 'bold 14px Anton'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('~', 0, 1);
    }
    ctx.restore();
  }
  ctx.fillStyle = '#0A0E0F'; ctx.fillRect(0, H-GH, W, GH);
  ctx.fillStyle = '#1FB8A6'; ctx.fillRect(0, H-GH, W, 6);
  const b = Flappy.bird;
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
  const g = ctx.createRadialGradient(0,-4,2,0,0,b.r+6);
  g.addColorStop(0,'#7FE9FF'); g.addColorStop(1,'#1FB8A6');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,b.r,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#3EE6D2';
  ctx.beginPath();
  ctx.moveTo(-b.r,0); ctx.lineTo(-b.r-14,-6); ctx.lineTo(-b.r-10,0); ctx.lineTo(-b.r-14,6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#0A0E0F'; ctx.beginPath(); ctx.arc(4,-3,2.6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#FFA42B';
  ctx.beginPath(); ctx.moveTo(b.r-2,-2); ctx.lineTo(b.r+8,2); ctx.lineTo(b.r-2,6); ctx.closePath(); ctx.fill();
  if (performance.now() < Flappy.shieldUntil) {
    ctx.strokeStyle = 'rgba(34,160,107,.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0,0,b.r+8,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}
function flappyDrawPipe(x,y,w,h,isTop) {
  const ctx = Flappy.ctx;
  const grad = ctx.createLinearGradient(x,0,x+w,0);
  grad.addColorStop(0,'#1FB8A6'); grad.addColorStop(0.5,'#3EE6D2'); grad.addColorStop(1,'#1FB8A6');
  ctx.fillStyle = grad; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = '#0E6A63'; ctx.lineWidth = 3; ctx.strokeRect(x,y,w,h);
  const capH = 18;
  const capY = isTop ? y+h-capH : y;
  ctx.fillStyle = '#0E6A63'; ctx.fillRect(x-4, capY, w+8, capH);
  ctx.strokeStyle = '#0A0E0F'; ctx.strokeRect(x-4, capY, w+8, capH);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x+6, y, 6, h);
}
function flappyGameOver() {
  flappyStop();
  haptic('error');
  const score = Flappy.score;
  const bonusShift = Flappy.bonusesCollected;
  if (score > 0 || bonusShift > 0) {
    apiPost('/api/game/submit', {game_id:'flappy', score, bonus_shift: bonusShift})
      .then(r => {
        Flappy.best = r.best || Math.max(Flappy.best, score);
        document.getElementById('flappyBestTop').textContent = Flappy.best;
        Flappy.top = r.top || Flappy.top;
        if (r.is_record) popIcon('ic-trophy');
      })
      .catch(()=>{});
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
    sub.textContent = 'S — очки, + — щит, ~ — замедление';
    scoreEl.innerHTML = '';
    startBtn.textContent = 'ИГРАТЬ';
    startBtn.onclick = flappyStart;
    recordsBtn.style.display = '';
  } else if (mode === 'gameover') {
    title.textContent = 'ИГРА ОКОНЧЕНА';
    const isRecord = score >= Flappy.best && score > 0;
    sub.textContent = isRecord ? 'Новый рекорд!' : 'Попробуй ещё раз';
    scoreEl.innerHTML = `Очки: <b>${score}</b> · Рекорд: <b>${Flappy.best}</b> · Бонусов: <b>${Flappy.bonusesCollected}</b>`;
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
    if (!top.length) list.innerHTML = '<div class="flappy-records-row">Пока нет рекордов</div>';
    else list.innerHTML = top.map(t => `
      <div class="flappy-records-row ${t.is_me?'is-me':''}">
        <span class="flappy-records-rank">${t.rank}</span>
        <span class="flappy-records-name">${escapeHtml(t.display)}</span>
        <span class="flappy-records-score">${t.score}</span>
      </div>`).join('');
    overlay.querySelector('.flappy-card').appendChild(list);
  }
}
function flappyHideOverlay() { document.getElementById('flappyOverlay').classList.add('hidden'); }
function flappyShowRecords() { flappyShowOverlay('records'); }


const CHEST_DROP_ICONS = {
  shift:     '/assets/ic_shift.webp',
  nova:      '/assets/ic_nova.webp',
  xp:        '/assets/ic_xp.webp',
  default:   '/assets/ic_shift.webp',
};
const CHEST_FAKE_POOL = {
  capsule:  [
    {type:'shift', amount:15,  rar:'common', label:'+15'},
    {type:'shift', amount:30,  rar:'common', label:'+30'},
    {type:'xp',    amount:80,  rar:'common', label:'+80 XP'},
    {type:'shift', amount:40,  rar:'rare',   label:'+40'},
    {type:'xp',    amount:140, rar:'rare',   label:'+140 XP'},
    {type:'nova',  amount:1,   rar:'rare',   label:'+1 Нова'},
    {type:'shift', amount:100, rar:'legend', label:'+100'},
  ],
  relic:    [
    {type:'shift', amount:60,  rar:'common', label:'+60'},
    {type:'shift', amount:90,  rar:'common', label:'+90'},
    {type:'xp',    amount:250, rar:'rare',   label:'+250 XP'},
    {type:'shift', amount:150, rar:'rare',   label:'+150'},
    {type:'nova',  amount:2,   rar:'epic',   label:'+2 Нова'},
    {type:'xp',    amount:500, rar:'epic',   label:'+500 XP'},
    {type:'nova',  amount:10,  rar:'legend', label:'+10 Нова'},
  ],
  artifact: [
    {type:'shift', amount:500, rar:'rare',   label:'+500'},
    {type:'xp',    amount:1000,rar:'rare',   label:'+1000 XP'},
    {type:'nova',  amount:5,   rar:'epic',   label:'+5 Нова'},
    {type:'nova',  amount:12,  rar:'epic',   label:'+12 Нова'},
    {type:'nova',  amount:15,  rar:'legend', label:'+15 Нова'},
    {type:'nova',  amount:50,  rar:'legend', label:'+50 Нова'},
  ],
  core:     [
    {type:'shift', amount:2000,rar:'epic',   label:'+2000'},
    {type:'xp',    amount:5000,rar:'epic',   label:'+5000 XP'},
    {type:'nova',  amount:30,  rar:'epic',   label:'+30 Нова'},
    {type:'nova',  amount:45,  rar:'legend', label:'+45 Нова'},
    {type:'nova',  amount:60,  rar:'legend', label:'+60 Нова'},
    {type:'nova',  amount:200, rar:'legend', label:'+200 Нова'},
  ],
};
function _chestIconFor(drop) {
  if (!drop) return CHEST_DROP_ICONS.default;
  return CHEST_DROP_ICONS[drop.type] || CHEST_DROP_ICONS.default;
}
function _randomFakeCell(chestId) {
  const pool = CHEST_FAKE_POOL[chestId] || CHEST_FAKE_POOL.capsule;
  return pool[Math.floor(Math.random() * pool.length)];
}
function _buildRouletteStrip(chestId, winDrop) {
  const N = 40, WIN_POS = 32;
  const cells = [];
  for (let i = 0; i < N; i++) {
    if (i === WIN_POS) {
      cells.push({
        type: winDrop.type,
        amount: winDrop.amount,
        rar: 'legend',
        label: winDrop.label || _fmtDropLabel(winDrop),
        isWin: true,
      });
    } else {
      const fake = _randomFakeCell(chestId);
      cells.push({...fake, isWin:false});
    }
  }
  return { cells, winPos: WIN_POS };
}
function _fmtDropLabel(drop) {
  if (drop.type === 'xp') return `+${drop.amount} XP`;
  if (drop.type === 'shift') return `+${drop.amount}`;
  if (drop.type === 'nova') return `+${drop.amount} Нова`;
  return `+${drop.amount}`;
}
function _coinIconByType(t) {
  if (t === 'shift') return '/assets/ic_shift.webp';
  if (t === 'nova')  return '/assets/ic_nova.webp';
  return '/assets/ic_xp.webp';
}
let _rouletteRoot = null;
function openChestRoulette(chestId, onDone) {
  if (!_rouletteRoot) {
    _rouletteRoot = document.createElement('div');
    _rouletteRoot.id = 'chestRoulette';
    document.body.appendChild(_rouletteRoot);
  }
  const meta = (typeof CHEST_META !== 'undefined' && CHEST_META[chestId]) || {name: chestId};
  _rouletteRoot.innerHTML = `
    <div class="roulette-wrap">
      <button class="roulette-close" id="rouletteClose"><svg width="16" height="16"><use href="#ic-close"/></svg></button>
      <div class="roulette-title">${meta.name.toUpperCase()}</div>
      <div class="roulette-viewport" id="rouletteViewport">
        <div class="roulette-strip" id="rouletteStrip"></div>
        <div class="roulette-pointer"></div>
        <div class="roulette-flash" id="rouletteFlash"></div>
      </div>
      <div class="roulette-win" id="rouletteWin"></div>
    </div>
  `;
  _rouletteRoot.classList.add('on');
  document.getElementById('rouletteClose').onclick = () => {
    _rouletteRoot.classList.remove('on');
  };
  const initData = (window.Telegram?.WebApp?.initData) || '';
  fetch('/api/chest/open', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({initData, type: chestId}),
  }).then(r => r.json().then(j => ({ok:r.ok, status:r.status, data:j})))
    .then(({ok, status, data}) => {
      if (!ok) {
        const msg = data.message || ({
          already_opened: 'Кейс уже открыт',
          not_enough_shift: 'Недостаточно Шифт',
          not_enough_nova: 'Недостаточно Нова',
        }[data.error] || 'Ошибка');
        _showRouletteError(msg);
        if (typeof onDone === 'function') onDone({ok:false, error:data.error});
        return;
      }
      _runRoulette(chestId, data.reward, data.wallet, () => {
        if (typeof onDone === 'function') onDone({ok:true, reward:data.reward, wallet:data.wallet});
      });
    })
    .catch(err => {
      _showRouletteError(err.message || 'Сеть недоступна');
      if (typeof onDone === 'function') onDone({ok:false, error:'network'});
    });
}
function _showRouletteError(msg) {
  const win = document.getElementById('rouletteWin');
  if (win) {
    win.classList.add('on');
    win.innerHTML = `<div class="roulette-win-label" style="color:#E23A3A">ОШИБКА</div>
      <div class="roulette-win-sub">${(msg||'').replace(/[<>&]/g,'')}</div>`;
  }
  setTimeout(() => {
    if (_rouletteRoot) _rouletteRoot.classList.remove('on');
  }, 1800);
}
function _runRoulette(chestId, winDrop, wallet, done) {
  const { cells, winPos } = _buildRouletteStrip(chestId, winDrop);
  const strip = document.getElementById('rouletteStrip');
  const viewport = document.getElementById('rouletteViewport');
  const win = document.getElementById('rouletteWin');
  const flash = document.getElementById('rouletteFlash');
  win.classList.remove('on');
  win.innerHTML = '';
  strip.innerHTML = cells.map((c, i) => `
    <div class="roulette-cell rar-${c.rar||'common'}" data-idx="${i}">
      <img class="rc-icon" src="${_coinIconByType(c.type)}" alt="">
      <div class="rc-label">${c.label}</div>
    </div>
  `).join('');
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  requestAnimationFrame(() => {
    const cellW = 132 + 12;
    const viewportW = viewport.clientWidth;
    const cellCenter = winPos * cellW + 132 / 2;
    const offset = cellCenter - viewportW / 2;
    const duration = 4200;
    strip.style.transition = `transform ${duration}ms cubic-bezier(.15,.85,.25,1)`;
    strip.style.transform = `translateX(-${offset}px)`;
    setTimeout(() => {
      flash.classList.add('on');
      if (window.Telegram?.WebApp?.HapticFeedback) {
        try { window.Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } catch(e){}
      }
      setTimeout(() => flash.classList.remove('on'), 300);
      const label = winDrop.label || _fmtDropLabel(winDrop);
      win.innerHTML = `
        <img class="roulette-win-icon" src="${_coinIconByType(winDrop.type)}" alt="">
        <div class="roulette-win-label">${label}</div>
        <div class="roulette-win-sub">${(wallet && (wallet.shift != null)) ? `Баланс: ${wallet.shift} Шифт · ${wallet.nova} Нова` : ''}</div>
      `;
      win.classList.add('on');
      const closeTimer = setTimeout(() => {
        _rouletteRoot.classList.remove('on');
        if (typeof done === 'function') done();
      }, 3200);
      _rouletteRoot.onclick = (e) => {
        if (e.target === _rouletteRoot || e.target.closest('.roulette-close')) {
          clearTimeout(closeTimer);
          _rouletteRoot.classList.remove('on');
          if (typeof done === 'function') done();
        }
      };
    }, duration + 80);
  });
}
