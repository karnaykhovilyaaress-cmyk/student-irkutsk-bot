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

  /* 🎨 Класс фона вкладки — на #app и на body */
  const _tab = state.tab || 'schedule';
  const _bgClasses = ['bg-schedule','bg-tasks','bg-notes','bg-games','bg-ai','bg-admin','bg-profile'];
  if (appEl) {
    appEl.classList.remove(..._bgClasses);
    appEl.classList.add('bg-' + _tab);
  }
  document.body.classList.remove(..._bgClasses);
  document.body.classList.add('bg-' + _tab);

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
    <div class="picker-header" style="padding-top:calc(var(--safe-top) + 12px)">
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
    /* Обновляем ТОЛЬКО числа, не перерисовывая картинки кейсов и аватар */
    if (state.tab === 'profile') updateProfileValuesOnly();
  } catch (e) {}
}

function updateProfileValuesOnly() {
  const p = state.profile;
  if (!p) return;
  const wallet = p.wallet || {};
  /* Балансы валют в профиле */
  const walletValues = document.querySelectorAll('.profile-hero-wallet-value');
  if (walletValues.length >= 2) {
    walletValues[0].textContent = wallet.shift ?? wallet.soft ?? 0;
    walletValues[1].textContent = wallet.nova ?? wallet.hard ?? 0;
  }
  /* XP-полоса */
  const xp = wallet.xp || 0;
  const lv = calcLevelInfo(xp);
  const total = lv.inLevel + lv.toNext;
  const pct = total ? (lv.inLevel / total) * 100 : 0;
  const fill = document.querySelector('.profile-hero-xpbar-fill');
  if (fill) fill.style.width = pct + '%';
  const cur = document.querySelector('.profile-hero-xpbar-cur');
  if (cur) cur.textContent = lv.inLevel + ' XP';
  const next = document.querySelector('.profile-hero-xpbar-next');
  if (next) next.textContent = total + ' XP';
  const lvlNum = document.querySelector('.profile-hero-level-num');
  if (lvlNum) lvlNum.textContent = lv.level + ' LVL';
  const lvlTitle = document.querySelector('.profile-hero-level-title');
  if (lvlTitle) lvlTitle.textContent = levelTitleByLevel(lv.level);
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


const BS = {
  bet:10, gameId:null, side:0,
  myShips:[], myShots:[], enemyShots:[],
  status:'lobby', isBot:false, pollTimer:null,
  botShips:[], botShots:[],
};
const BS_SHIPS = [{size:4,count:1},{size:3,count:2},{size:2,count:3},{size:1,count:4}];
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
  document.querySelectorAll('.bs-board-tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.bs-board-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const mine = t.dataset.bsTab === 'mine';
      document.getElementById('bsMyField').style.display = mine ? 'grid' : 'none';
      document.getElementById('bsEnemyField').style.display = mine ? 'none' : 'grid';
      if (!mine) bsRenderEnemyField();
      else bsRenderMyField();
    };
  });
  bsShowLobby();
}
function closeBs() {
  if (BS.pollTimer) clearInterval(BS.pollTimer);
  BS.pollTimer = null;
  BS.gameId = null;
  document.getElementById('screen-bs').style.display = 'none';
  document.getElementById('bottom-nav').style.display = '';
  if (state.tab === 'games') loadTabData('games');
}
function bsRenderBets() {
  const box = document.getElementById('bsBets');
  box.innerHTML = '';
  [10,50,100,500].forEach(v => {
    const b = document.createElement('button');
    b.className = 'bs-bet' + (v === BS.bet ? ' active' : '');
    b.innerHTML = `${v} <img class="coin" src="/assets/ic_shift.webp" style="width:16px;height:16px" alt="">`;
    b.onclick = () => { BS.bet = v; bsRenderBets(); };
    box.appendChild(b);
  });
}
function bsShowLobby() {
  document.getElementById('bsLobby').style.display = '';
  document.getElementById('bsGame').style.display = 'none';
  BS.status = 'lobby'; BS.isBot = false;
  BS.myShips = []; BS.myShots = []; BS.enemyShots = [];
}
function bsShowGame() {
  document.getElementById('bsLobby').style.display = 'none';
  document.getElementById('bsGame').style.display = '';
}
async function bsCreate() {
  try {
    const r = await apiPost('/api/bs/create', {bet: BS.bet});
    BS.gameId = r.game_id; BS.side = 1;
    haptic('success'); bsShowGame(); bsRandomShips(); bsRenderFleet();
    modalOpen({title:'ИГРА СОЗДАНА',
      body:`Код: <div style="font-family:'Anton',sans-serif;font-size:36px;text-align:center;color:var(--cyan-dark);letter-spacing:6px;margin:12px 0">${r.code}</div>`,
      actions:[{label:'ОК', style:'btn'}]});
    bsPollStart();
  } catch (e) { toast(e.message, 'error'); }
}
async function bsJoin() {
  const code = document.getElementById('bsCode').value.trim();
  if (code.length !== 6) { toast('Код — 6 цифр', 'error'); return; }
  try {
    const r = await apiPost('/api/bs/join', {code});
    BS.gameId = r.game_id; BS.side = 2;
    haptic('success'); bsShowGame(); bsRandomShips(); bsRenderFleet(); bsPollStart();
  } catch (e) { toast(e.message, 'error'); }
}
async function bsFind() {
  try {
    const r = await apiPost('/api/bs/find', {bet: BS.bet});
    BS.gameId = r.game_id; BS.side = r.side || 1;
    haptic('success'); bsShowGame(); bsRandomShips(); bsRenderFleet();
    if (r.status === 'queued') document.getElementById('bsStatus').textContent = 'Ожидание соперника...';
    bsPollStart();
  } catch (e) { toast(e.message, 'error'); }
}
async function bsBotStart() {
  try {
    await apiPost('/api/bs/bot-start', {bet: BS.bet});
    BS.isBot = true; BS.gameId = 'bot'; BS.side = 1;
    haptic('success'); bsShowGame();
    BS.botShips = bsEmptyShips(); BS.botShots = [];
    bsRandomShips(); bsRenderFleet();
    BS.status = 'placing';
    document.getElementById('bsStatus').textContent = 'Расставляй корабли и жми ГОТОВ';
  } catch (e) { toast(e.message, 'error'); }
}
function bsEmptyShips() {
  const res = []; const sizes = [];
  BS_SHIPS.forEach(s => { for (let i=0; i<s.count; i++) sizes.push(s.size); });
  const grid = Array.from({length:10}, () => Array(10).fill(0));
  for (const size of sizes) {
    let placed = false;
    for (let t=0; t<500 && !placed; t++) {
      const horiz = Math.random() < 0.5;
      const x = Math.floor(Math.random() * (horiz ? 10-size+1 : 10));
      const y = Math.floor(Math.random() * (horiz ? 10 : 10-size+1));
      const cells = [];
      for (let k=0; k<size; k++) cells.push([horiz?x+k:x, horiz?y:y+k]);
      let ok = true;
      for (const [cx,cy] of cells) {
        for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
          const nx = cx+dx, ny = cy+dy;
          if (nx<0||nx>9||ny<0||ny>9) continue;
          if (grid[ny][nx]) ok = false;
        }
      }
      if (ok) {
        for (const [cx,cy] of cells) grid[cy][cx] = 1;
        res.push({size, cells: cells.map(c => ({x:c[0], y:c[1]}))});
        placed = true;
      }
    }
  }
  return res;
}
function bsRandomShips() {
  BS.myShips = bsEmptyShips();
  bsRenderMyField(); bsRenderEnemyField();
}
function bsRenderMyField() {
  const box = document.getElementById('bsMyField');
  if (!box) return;
  box.innerHTML = '';
  for (let y=0; y<10; y++) for (let x=0; x<10; x++) {
    const c = document.createElement('div');
    c.className = 'bs-cell';
    const isShip = BS.myShips.some(s => s.cells.some(cc => cc.x === x && cc.y === y));
    const shot = BS.enemyShots.find(s => s.x === x && s.y === y);
    if (shot) c.classList.add(isShip ? 'hit' : 'miss');
    else if (isShip) c.classList.add('ship');
    box.appendChild(c);
  }
}
function bsRenderEnemyField() {
  const box = document.getElementById('bsEnemyField');
  if (!box) return;
  box.innerHTML = '';
  for (let y=0; y<10; y++) for (let x=0; x<10; x++) {
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
function bsRenderFleet() {
  const box = document.getElementById('bsFleet');
  if (!box) return;
  const left = {};
  BS_SHIPS.forEach(s => left[s.size] = (left[s.size]||0) + s.count);
  BS.myShips.forEach(s => { left[s.size] = Math.max(0, (left[s.size]||0) - 1); });
  box.innerHTML = BS_SHIPS.map(sh =>
    `<div class="bs-fleet-item">${sh.size}-палуб: ${left[sh.size] || 0}/${sh.count}</div>`).join('');
}
async function bsReady() {
  if (!BS.myShips.length) { toast('Расставь корабли', 'error'); return; }
  if (BS.isBot) {
    BS.status = 'playing'; bsRenderEnemyField(); bsRenderMyField();
    document.getElementById('bsStatus').textContent = 'Твой ход';
    haptic('success'); return;
  }
  try {
    const r = await apiPost('/api/bs/ready', {game_id: BS.gameId, ships: BS.myShips});
    haptic('success');
    if (r.status === 'playing') {
      BS.status = 'playing'; bsRenderEnemyField();
      document.getElementById('bsStatus').textContent = r.your_turn ? 'Твой ход' : 'Ход соперника';
    } else document.getElementById('bsStatus').textContent = 'Ждём соперника...';
  } catch (e) { toast(e.message, 'error'); }
}
async function bsFire(x, y) {
  if (BS.status !== 'playing') return;
  if (BS.isBot) {
    let hitShip = null;
    for (const s of BS.botShips) if (s.cells.some(c => c.x === x && c.y === y)) { hitShip = s; break; }
    if (!hitShip) {
      BS.myShots.push({x, y, result:'miss'}); bsRenderEnemyField();
      haptic('error'); setTimeout(bsBotFire, 500); return;
    }
    const sunk = hitShip.cells.every(c =>
      BS.myShots.some(s => s.x === c.x && s.y === c.y) || (c.x === x && c.y === y));
    BS.myShots.push({x, y, result: sunk ? 'sunk' : 'hit'});
    bsRenderEnemyField(); haptic('success');
    const allEnemyCells = BS.botShips.flatMap(s => s.cells);
    const allHit = allEnemyCells.every(c => BS.myShots.some(s => s.x === c.x && s.y === c.y));
    if (allHit) {
      BS.status = 'finished';
      document.getElementById('bsStatus').textContent = 'Ты победил!';
      apiPost('/api/bs/finish-bot', {bet: BS.bet, outcome:'win'}).catch(()=>{});
      popIcon('ic-trophy'); return;
    }
    if (!sunk) return;
    setTimeout(bsBotFire, 500); return;
  }
  try {
    const r = await apiPost('/api/bs/fire', {game_id: BS.gameId, x, y});
    if (r.result === 'miss') haptic('error'); else haptic('success');
    BS.myShots.push({x, y, result: r.result});
    bsRenderEnemyField();
    document.getElementById('bsStatus').textContent = r.your_turn ? 'Твой ход' : 'Ход соперника';
    if (r.status === 'finished') {
      BS.status = 'finished';
      const res = r.result_data || {};
      if (res.outcome === 'win') { document.getElementById('bsStatus').textContent = 'Победа!'; popIcon('ic-trophy'); }
      else if (res.outcome === 'lose') document.getElementById('bsStatus').textContent = 'Поражение';
      else document.getElementById('bsStatus').textContent = 'Ничья';
    }
  } catch (e) { haptic('error'); toast(e.message, 'error'); }
}
function bsBotFire() {
  if (BS.status !== 'playing') return;
  let x, y, t = 0;
  do {
    x = Math.floor(Math.random()*10);
    y = Math.floor(Math.random()*10);
    t++;
  } while (BS.botShots.some(s => s.x === x && s.y === y) && t < 300);
  BS.botShots.push({x, y});
  const isHit = BS.myShips.some(s => s.cells.some(c => c.x === x && c.y === y));
  BS.enemyShots.push({x, y});
  bsRenderMyField();
  haptic(isHit ? 'error' : 'light');
  const allMyCells = BS.myShips.flatMap(s => s.cells);
  const allHit = allMyCells.every(c => BS.enemyShots.some(s => s.x === c.x && s.y === c.y));
  if (allHit) {
    BS.status = 'finished';
    document.getElementById('bsStatus').textContent = 'Бот победил';
    apiPost('/api/bs/finish-bot', {bet: BS.bet, outcome:'lose'}).catch(()=>{});
    return;
  }
  document.getElementById('bsStatus').textContent = 'Твой ход';
}
async function bsSurrender() {
  modalConfirm('СДАТЬСЯ?', 'Ты потеряешь ставку.', async () => {
    if (BS.isBot) {
      BS.status = 'finished';
      apiPost('/api/bs/finish-bot', {bet: BS.bet, outcome:'lose'}).catch(()=>{});
      document.getElementById('bsStatus').textContent = 'Ты сдался';
      return;
    }
    try {
      await apiPost('/api/bs/surrender', {game_id: BS.gameId});
      BS.status = 'finished';
      document.getElementById('bsStatus').textContent = 'Ты сдался';
    } catch (e) { toast(e.message, 'error'); }
  }, 'СДАТЬСЯ');
}
function bsPollStart() {
  if (BS.pollTimer) clearInterval(BS.pollTimer);
  BS.pollTimer = setInterval(async () => {
    if (!BS.gameId || BS.isBot) return;
    try {
      const s = await apiGet('/api/bs/state', {game_id: BS.gameId});
      if (s.status === 'playing') {
        BS.status = 'playing';
        BS.myShots = s.my_shots || [];
        BS.enemyShots = s.enemy_shots || [];
        document.getElementById('bsStatus').textContent = s.your_turn ? 'Твой ход' : 'Ход соперника';
        bsRenderEnemyField(); bsRenderMyField();
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


function actionOpenNotifyEditor() {
  haptic('light');
  const p = state.profile;
  state.notifyEditorType = p?.notify_type || 'today';
  state.notifyEditorHour = (p?.notify_hour >= 0) ? p.notify_hour : 8;
  state.notifyEditorMinute = p?.notify_minute || 0;
  state.notifyEditor = true;
  render();
}
function actionNotifyBack() { state.notifyEditor = false; render(); }
function actionNotifySetType(ntype) {
  state.notifyEditorType = ntype;
  if (ntype === 'today' && state.notifyEditorHour > 10) {
    state.notifyEditorHour = 8; state.notifyEditorMinute = 0;
  }
  render();
}
async function actionNotifySave() {
  const input = document.getElementById('notify-time-input');
  if (!input) return;
  const val = (input.value || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(val)) { toast('Введи ЧЧ:ММ', 'error'); return; }
  const [hhStr, mmStr] = val.split(':');
  const hh = parseInt(hhStr, 10), mm = parseInt(mmStr, 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) { toast('Неверное время', 'error'); return; }
  if (state.notifyEditorType === 'today' && hh > 10) { toast('Для «Сегодня» — не позже 10:00', 'error'); return; }
  try {
    await apiPost('/api/notify-set', {type: state.notifyEditorType, hour: hh, minute: mm});
    state.notifyEditor = false; haptic('success'); toast('Сохранено', 'success');
    await loadProfile(); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionNotifyOff() {
  try {
    await apiPost('/api/notify-set', {type: null});
    state.notifyEditor = false; haptic('success'); toast('Уведомления выключены');
    await loadProfile(); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionChooseGroup() {
  await loadGroups(true);
  if (!state.groups || !Object.keys(state.groups).length) { toast('Не удалось загрузить', 'error'); return; }
  state.pickerMode = 'institute';
  state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
  render();
}
function actionPickerBack() {
  if (state.pickerMode === 'group') { state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = ''; }
  else if (state.pickerMode === 'course') { state.pickerMode = 'institute'; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; }
  else { state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = ''; }
  render();
}
function actionPickerChooseInstitute(inst) {
  state.pickerInstitute = inst; state.pickerMode = 'course'; state.pickerCourse = null; state.pickerSearch = '';
  render();
}
function actionPickerChooseCourse(course) {
  state.pickerCourse = parseInt(course, 10); state.pickerMode = 'group'; state.pickerSearch = '';
  render();
}
async function actionPickerChooseGroup(groupId, groupName) {
  haptic('success');
  try {
    await apiPost('/api/set-group', {group_id: groupId, group_name: groupName, subgroup: state.profile?.subgroup || 0});
    if (state.profile) state.profile.group = groupName;
    state.pickerMode = null; state.pickerInstitute = null; state.pickerCourse = null; state.pickerSearch = '';
    await loadProfile(); await loadSchedule();
    toast('Группа обновлена', 'success');
    render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionSetSubgroup(value) {
  try {
    await apiPost('/api/set-subgroup', {subgroup: value});
    if (state.profile) state.profile.subgroup = value;
    haptic('success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionSetGender(value) {
  if (value !== 'male' && value !== 'female') return;
  if (state.avatarGender === value) return;
  const prev = state.avatarGender;
  state.avatarGender = value;
  if (state.profile) state.profile.avatar_gender = value;
  render();
  try {
    await apiPost('/api/set-avatar-gender', {gender: value});
    haptic('success');
  } catch (e) {
    state.avatarGender = prev;
    if (state.profile) state.profile.avatar_gender = prev;
    render();
    toast(e.message, 'error');
  }
}
async function actionQuoteSubscribe(value) {
  try {
    await apiPost('/api/quote-subscribe', {subscribe: value === 1});
    if (state.profile) state.profile.daily_subscribed = value === 1;
    haptic('success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionFeedbackSend() {
  const el = document.getElementById('feedback-text');
  if (!el) return;
  const text = (el.value || '').trim();
  if (!text) { toast('Пустое сообщение', 'error'); return; }
  try {
    await apiPost('/api/feedback', {text});
    el.value = ''; haptic('success'); toast('Отправлено', 'success');
  } catch (e) { toast(e.message, 'error'); }
}
async function actionTaskDone(id) {
  try {
    await apiPost('/api/task-update', {id, done: true});
    haptic('success'); popIcon('ic-check');
    await loadTasks(); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function actionTaskDelete(id) {
  modalConfirm('УДАЛИТЬ ЗАДАЧУ?', 'Отменить не получится.', async () => {
    try {
      await apiPost('/api/task-delete', {id});
      haptic('success'); await loadTasks(); render();
    } catch (e) { toast(e.message, 'error'); }
  }, 'УДАЛИТЬ');
}
async function actionTasksClear() {
  modalConfirm('ОЧИСТИТЬ?', 'Все выполненные задачи удалятся.', async () => {
    try {
      await apiPost('/api/task-clear');
      haptic('success'); await loadTasks(); render();
    } catch (e) { toast(e.message, 'error'); }
  }, 'ОЧИСТИТЬ');
}
function actionTaskAdd() {
  let form = {text:'', priority:2, due:'none', customDate:'', customTime:''};
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
    ${form.due==='custom' ? `
      <div class="date-input-row">
        <input type="date" id="task-date" value="${escapeHtml(form.customDate)}">
        <input type="time" id="task-time" value="${escapeHtml(form.customTime)}">
      </div>` : ''}
  `;
  const attach = () => {
    const ti = document.getElementById('task-text');
    if (ti) ti.oninput = (e) => form.text = e.target.value;
    const di = document.getElementById('task-date');
    if (di) di.onchange = (e) => form.customDate = e.target.value;
    const ti2 = document.getElementById('task-time');
    if (ti2) ti2.onchange = (e) => form.customTime = e.target.value;
    document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => {
      form.due = b.dataset.due;
      document.getElementById('modalBody').innerHTML = renderBody();
      attach();
    });
    document.querySelectorAll('[data-prio]').forEach(b => b.onclick = () => {
      form.priority = parseInt(b.dataset.prio);
      document.getElementById('modalBody').innerHTML = renderBody();
      attach();
    });
  };
  modalOpen({
    title:'НОВАЯ ЗАДАЧА',
    body: renderBody(),
    actions: [
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const ti = document.getElementById('task-text');
        const text = (ti?.value || form.text || '').trim();
        if (!text) { toast('Введи текст', 'error'); return; }
        let due_date = null, due_time = null;
        const today = nowIrkutsk();
        if (form.due === 'today') due_date = fmtDate(today);
        else if (form.due === 'tomorrow') due_date = fmtDate(addDays(today,1));
        else if (form.due === 'custom' && form.customDate) {
          const [y,m,d] = form.customDate.split('-');
          due_date = `${d}.${m}.${y}`;
          if (form.customTime) due_time = form.customTime;
        }
        try {
          await apiPost('/api/task-add', {text, due_date, due_time, priority: form.priority});
          haptic('success'); toast('Задача добавлена', 'success');
          await loadTasks(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  attach();
}
function actionTaskEdit(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  let form = {text: t.text, priority: t.priority || 2};
  const renderBody = () => `
    <div class="label">ТЕКСТ</div>
    <input class="input" id="task-edit-text" value="${escapeHtml(form.text)}" maxlength="200">
    <div class="label">ПРИОРИТЕТ</div>
    <div class="choice-row">
      <button class="choice ${form.priority===1?'active':''}" data-prio="1">Низкий</button>
      <button class="choice ${form.priority===2?'active':''}" data-prio="2">Средний</button>
      <button class="choice ${form.priority===3?'active':''}" data-prio="3">Высокий</button>
    </div>
  `;
  const attach = () => {
    document.querySelectorAll('[data-prio]').forEach(b => b.onclick = () => {
      form.priority = parseInt(b.dataset.prio);
      document.getElementById('modalBody').innerHTML = renderBody();
      attach();
    });
  };
  modalOpen({
    title:'ИЗМЕНИТЬ ЗАДАЧУ',
    body: renderBody(),
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const ti = document.getElementById('task-edit-text');
        const text = (ti?.value || form.text || '').trim();
        if (!text) { toast('Пустой текст', 'error'); return; }
        try {
          await apiPost('/api/task-update', {id, text, priority: form.priority});
          haptic('success'); toast('Сохранено', 'success');
          await loadTasks(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  attach();
}
function actionNoteAdd() {
  let form = {subject:'', text:''};
  const renderBody = () => `
    <div class="label">ПРЕДМЕТ</div>
    <input class="input" id="note-subj" placeholder="Название предмета" value="${escapeHtml(form.subject)}" maxlength="100">
    ${state.notesSubjects?.length ? `<div class="choice-row" style="margin-top:4px">${state.notesSubjects.map(s => `<button class="choice" data-subj="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    <div class="label">ТЕКСТ</div>
    <textarea class="input" id="note-text" rows="4" maxlength="500">${escapeHtml(form.text)}</textarea>
  `;
  const attach = () => {
    const si = document.getElementById('note-subj');
    if (si) si.oninput = (e) => form.subject = e.target.value;
    const ti = document.getElementById('note-text');
    if (ti) ti.oninput = (e) => form.text = e.target.value;
    document.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => {
      form.subject = b.dataset.subj;
      document.getElementById('note-subj').value = form.subject;
      document.querySelectorAll('[data-subj]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  };
  modalOpen({
    title:'НОВАЯ ЗАМЕТКА',
    body: renderBody(),
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const s = (document.getElementById('note-subj')?.value || form.subject || '').trim();
        const t = (document.getElementById('note-text')?.value || form.text || '').trim();
        if (!s || !t) { toast('Заполни оба поля', 'error'); return; }
        try {
          await apiPost('/api/note-save', {subject: s, text: t});
          haptic('success'); toast('Заметка сохранена', 'success');
          await loadNotes(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  attach();
}
function actionNoteEdit(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  modalOpen({
    title:'ИЗМЕНИТЬ ЗАМЕТКУ',
    body: `
      <div class="label">ПРЕДМЕТ</div>
      <input class="input" id="note-edit-subj" value="${escapeHtml(n.subject)}" maxlength="100">
      <div class="label">ТЕКСТ</div>
      <textarea class="input" id="note-edit-text" rows="4" maxlength="500">${escapeHtml(n.text)}</textarea>
    `,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const s = (document.getElementById('note-edit-subj')?.value || '').trim();
        const t = (document.getElementById('note-edit-text')?.value || '').trim();
        if (!s || !t) { toast('Заполни оба поля', 'error'); return; }
        try {
          await apiPost('/api/note-save', {subject: s, text: t});
          haptic('success'); toast('Сохранено', 'success');
          await loadNotes(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
}
async function actionNoteDelete(id) {
  modalConfirm('УДАЛИТЬ ЗАМЕТКУ?', 'Восстановить нельзя.', async () => {
    try {
      await apiPost('/api/note-delete', {id});
      haptic('success'); await loadNotes(); render();
    } catch (e) { toast(e.message, 'error'); }
  }, 'УДАЛИТЬ');
}
function actionScholarshipSetAmount() {
  let amount = state.scholarship?.amount || 0;
  modalOpen({
    title:'СУММА СТИПЕНДИИ',
    body: `
      <div class="label">руб. в месяц</div>
      <input class="input" id="sch-amount" type="number" min="0" max="100000" value="${amount}">
      <div class="choice-row">
        <button class="choice" data-amt="0">Не получаю</button>
        <button class="choice" data-amt="3000">3000</button>
        <button class="choice" data-amt="5000">5000</button>
        <button class="choice" data-amt="7000">7000</button>
      </div>
    `,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const v = parseInt(document.getElementById('sch-amount')?.value || '0') || 0;
        try {
          await apiPost('/api/scholarship-set-amount', {amount: v});
          haptic('success'); toast('Сохранено', 'success');
          await loadScholarship(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  setTimeout(() => {
    document.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => {
      const inp = document.getElementById('sch-amount');
      if (inp) inp.value = b.dataset.amt;
    });
  }, 0);
}
function actionScholarshipAddGrade() {
  let form = {subject:'', grade:5};
  const subs = state.scholarship?.available_subjects || [];
  const renderBody = () => `
    <div class="label">ПРЕДМЕТ</div>
    <input class="input" id="gr-subj" placeholder="Название" value="${escapeHtml(form.subject)}" maxlength="100">
    ${subs.length ? `<div class="choice-row" style="margin-top:4px;max-height:140px;overflow-y:auto">${subs.map(s => `<button class="choice" data-subj="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    <div class="label">ОЦЕНКА</div>
    <div class="choice-row">${[2,3,4,5].map(g => `<button class="choice ${form.grade===g?'active':''}" data-grade="${g}">${g}</button>`).join('')}</div>
  `;
  const attach = () => {
    const si = document.getElementById('gr-subj');
    if (si) si.oninput = (e) => form.subject = e.target.value;
    document.querySelectorAll('[data-subj]').forEach(b => b.onclick = () => {
      form.subject = b.dataset.subj;
      document.getElementById('gr-subj').value = form.subject;
      document.querySelectorAll('[data-subj]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    document.querySelectorAll('[data-grade]').forEach(b => b.onclick = () => {
      form.grade = parseInt(b.dataset.grade);
      document.getElementById('modalBody').innerHTML = renderBody();
      attach();
    });
  };
  modalOpen({
    title:'ДОБАВИТЬ ОЦЕНКУ',
    body: renderBody(),
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const s = (document.getElementById('gr-subj')?.value || '').trim();
        if (!s) { toast('Введи предмет', 'error'); return; }
        try {
          await apiPost('/api/scholarship-add-grade', {subject: s, grade: form.grade});
          haptic('success'); toast('Сохранено', 'success');
          await loadScholarship(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  attach();
}
async function actionScholarshipClear() {
  modalConfirm('ОЧИСТИТЬ ОЦЕНКИ?', 'Все оценки удалятся.', async () => {
    try {
      await apiPost('/api/scholarship-clear');
      haptic('success'); await loadScholarship(); render();
    } catch (e) { toast(e.message, 'error'); }
  }, 'ОЧИСТИТЬ');
}
async function actionAISend() {
  const el = document.getElementById('ai-input');
  const question = (el?.value || '').trim();
  const hasPhoto = !!state.aiPendingPhoto;
  if (!question && !hasPhoto) { toast('Введи вопрос', 'error'); return; }
  if (hasPhoto) {
    state.aiMessages.push({role:'user', text: question || 'Что на фото?', photo: state.aiPendingPhoto});
    const photo = state.aiPendingPhoto;
    state.aiPendingPhoto = null;
    state.aiPending = true;
    if (el) el.value = '';
    render();
    try {
      const r = await apiPost('/api/ai-photo', {photo, question});
      state.aiMessages.push({role:'assistant', text: r.answer || 'Нет ответа'});
      haptic('success');
    } catch (e) {
      state.aiMessages.push({role:'assistant', text: 'Ошибка: ' + e.message});
      haptic('error');
    } finally { state.aiPending = false; render(); }
    return;
  }
  state.aiMessages.push({role:'user', text: question});
  state.aiPending = true;
  if (el) el.value = '';
  render();
  try {
    const r = await apiPost('/api/ai', {question});
    state.aiMessages.push({role:'assistant', text: r.answer || 'Нет ответа'});
    haptic('success');
  } catch (e) {
    state.aiMessages.push({role:'assistant', text: 'Ошибка: ' + e.message});
    haptic('error');
  } finally { state.aiPending = false; render(); }
}
function actionAIClear() {
  modalConfirm('ОЧИСТИТЬ ЧАТ?', 'История удалится.', async () => {
    state.aiMessages = []; state.aiPendingPhoto = null;
    try { await apiPost('/api/ai/clear-history'); } catch(e){}
    render();
  }, 'ОЧИСТИТЬ');
}
function actionAIPhotoOpen() {
  const input = document.getElementById('ai-photo-input');
  if (input) input.click();
}
function actionAIPhotoRemove() { state.aiPendingPhoto = null; render(); }
function actionAIPhotoSelected(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast('Фото до 8 МБ', 'error'); return; }
  if (!file.type.startsWith('image/')) { toast('Нужно изображение', 'error'); return; }
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
      render();
    };
    img.onerror = () => toast('Не удалось прочитать', 'error');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
async function actionForgetGroup() {
  modalConfirm('ЗАБЫТЬ ГРУППУ?', 'Расписание перестанет показываться.', async () => {
    try {
      await apiPost('/api/set-group', {group_id:'', group_name:'', subgroup:0});
      if (state.profile) { state.profile.group = null; state.profile.group_id = null; }
      haptic('success'); await loadProfile(); render();
    } catch (e) { toast(e.message, 'error'); }
  }, 'ЗАБЫТЬ');
}
async function actionAdminMonitor() {
  try { state.adminMonitor = await apiGet('/api/admin/monitor'); }
  catch (e) { state.adminMonitor = {ok:false, status:0, error:e.message}; }
  render();
}
function actionAdminBroadcast() {
  const el = document.getElementById('admin-broadcast-text');
  const text = (el?.value || '').trim();
  if (!text) { toast('Пустое', 'error'); return; }
  modalConfirm('ОТПРАВИТЬ ВСЕМ?', 'Уйдёт всем.', async () => {
    try {
      await apiPost('/api/admin/broadcast', {text});
      if (el) el.value = '';
      haptic('success'); toast('Рассылка запущена', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }, 'ОТПРАВИТЬ');
}
function actionAdminFbReply(fid) {
  modalOpen({
    title:'ОТВЕТ',
    body: `<div class="label">ТЕКСТ</div><textarea class="input" id="fb-reply-text" rows="4"></textarea>`,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'ОТПРАВИТЬ', style:'btn', onClick: async () => {
        const t = (document.getElementById('fb-reply-text')?.value || '').trim();
        if (!t) { toast('Пусто', 'error'); return; }
        try {
          await apiPost('/api/admin/feedback-reply', {id: fid, text: t});
          haptic('success'); toast('Отправлено', 'success');
          await loadAdminFeedback(); await loadAdminStats(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
}
async function actionAdminFbPostpone(fid) {
  try {
    await apiPost('/api/admin/feedback-postpone', {id: fid});
    haptic('success');
    await loadAdminFeedback(); await loadAdminStats(); render();
  } catch (e) { toast(e.message, 'error'); }
}
function actionSetName() {
  const p = state.profile;
  const wallet = p?.wallet || {};
  const currentName = wallet.custom_name || '';
  const freeChanges = wallet.free_name_changes || 0;
  const hasCustom = !!wallet.custom_name;
  const costText = !hasCustom
    ? 'Первая установка — бесплатно'
    : (freeChanges > 0
        ? `У тебя ${freeChanges} бесплатных смен`
        : 'Смена стоит 5 Нова');

  modalOpen({
    title:'ИЗМЕНИТЬ ИМЯ',
    body: `
      <div class="card-subtitle" style="text-align:center;margin-bottom:12px">
        Это имя видят все игроки: в топе, играх, шапке расписания.
      </div>
      <div class="label">НОВОЕ ИМЯ</div>
      <input class="input" id="set-name-input" maxlength="24" placeholder="Например: Студент-Легенда" value="${escapeHtml(currentName)}" autocomplete="off">
      <div class="card-subtitle" style="text-align:center;margin-top:8px">${escapeHtml(costText)}</div>
    `,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const v = (document.getElementById('set-name-input')?.value || '').trim();
        if (!v) { toast('Введи имя', 'error'); return; }
        if (v === currentName) { toast('Это твоё текущее имя', 'info'); return; }
        try {
          await apiPost('/api/set-name', {name: v});
          haptic('success');
          popIcon('ic-check');
          toast('Имя изменено', 'success');
          await loadProfile();
          render();
        } catch (e) {
          if (e.code === 'need_hard') toast('Нужно 5 Нова', 'error');
          else toast(e.message, 'error');
        }
      }}
    ]
  });
  setTimeout(() => {
    const inp = document.getElementById('set-name-input');
    if (inp) { inp.focus(); inp.select(); }
  }, 150);
}

const CHEST_META = {
  capsule:  {name:'Капсула',  img:'/assets/capsule.webp',  costLabel:'Бесплатно (раз в 24 ч)',
             drops:[['Шифт 10–40','55%'],['XP 50–150','30%'],['Нова ×1','10%'],['Шифт ×100','5%']]},
  relic:    {name:'Реликт',   img:'/assets/relic.webp',    costLabel:'50 Шифт',
             drops:[['Шифт 60–150','50%'],['XP 200–500','30%'],['Нова 1–3','18%'],['Нова ×10','2%']]},
  artifact: {name:'Артефакт', img:'/assets/artifact.webp', costLabel:'15 Нова',
             drops:[['Шифт ×500','30%'],['XP ×1000','30%'],['Нова 5–15','35%'],['Нова ×50','5%']]},
  core:     {name:'Ядро',     img:'/assets/core.webp',     costLabel:'80 Нова',
             drops:[['Шифт ×2000','25%'],['XP ×5000','25%'],['Нова 30–60','40%'],['Нова ×200','10%']]},
};
function actionChestModal(id) {
  const meta = CHEST_META[id];
  if (!meta) return;
  const isCapsule = id === 'capsule';
  const st = state.chestStatus || {};
  const canOpenCapsule = !isCapsule || st.can_open !== false;
  const dropsHtml = meta.drops.map(d =>
    `<div class="chest-drop"><span>${escapeHtml(d[0])}</span><span class="chance">${escapeHtml(d[1])}</span></div>`
  ).join('');
  const timerHtml = isCapsule && !canOpenCapsule && st.next_at
    ? `<div class="card-subtitle" style="text-align:center;margin-top:10px">Доступно через <b data-chest-timer="${escapeHtml(st.next_at)}">--:--:--</b></div>`
    : '';
  modalOpen({
    title: meta.name.toUpperCase(),
    body: `
      <div style="text-align:center;margin-bottom:8px">
        <img src="${meta.img}" alt="${escapeHtml(meta.name)}" style="max-width:220px;width:70%;height:auto;border-radius:18px" draggable="false">
      </div>
      <div class="card-subtitle" style="text-align:center;margin-bottom:12px">${escapeHtml(meta.costLabel)}</div>
      <div class="label">Что может выпасть</div>
      <div class="chest-drops">${dropsHtml}</div>
      ${timerHtml}
    `,
    actions: [
      {label:'ЗАКРЫТЬ', style:'btn-secondary'},
      {label: isCapsule ? (canOpenCapsule ? 'ОТКРЫТЬ' : 'ЖДИ') : 'ОТКРЫТЬ', style: 'btn',
       onClick: async () => {
         if (isCapsule && !canOpenCapsule) { toast('Ещё рано', 'error'); return; }
         if (typeof openChestRoulette === 'function') {
           openChestRoulette(id, async (res) => {
             if (res.ok) {
               state.chestStatus = await apiGet('/api/chest/status').catch(()=>null);
               await loadProfile();
               updateProfileValuesOnly();
               startChestTimer();
             }
           });
         } else {
           toast('Рулетка не загружена', 'error');
         }
       }}
    ]
  });
  startChestTimer();
}
function actionExchange() {
  modalOpen({
    title:'ОБМЕННИК',
    body: `
      <div class="card-subtitle" style="text-align:center;margin-bottom:12px;display:flex;align-items:center;gap:8px;justify-content:center">
        100 <img class="coin" src="/assets/ic_shift.webp" style="width:18px;height:18px" alt=""> Шифт = 1 <img class="coin" src="/assets/ic_nova.webp" style="width:18px;height:18px" alt=""> Нова
      </div>
      <div class="label">СКОЛЬКО ШИФТ</div>
      <input class="input" id="ex-amount" type="number" min="100" step="100" value="100">
      <div class="choice-row">
        <button class="choice" data-ex="100">100</button>
        <button class="choice" data-ex="500">500</button>
        <button class="choice" data-ex="1000">1000</button>
        <button class="choice" data-ex="5000">5000</button>
      </div>
    `,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'ОБМЕНЯТЬ', style:'btn', onClick: async () => {
        const amount = parseInt(document.getElementById('ex-amount')?.value || '0') || 0;
        if (amount < 100) { toast('Минимум 100', 'error'); return; }
        try {
          const r = await apiPost('/api/exchange-soft-to-hard', {amount});
          haptic('success'); popIcon('ic-exchange');
          toast(`${r.soft_spent} Шифт → ${r.hard_received} Нова`, 'success');
          await loadProfile();
          updateProfileValuesOnly();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  setTimeout(() => {
    document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => {
      const inp = document.getElementById('ex-amount');
      if (inp) inp.value = b.dataset.ex;
    });
  }, 0);
}
function achIconById(id) { return `ic-ach-${id}`; }
async function actionShowAchievements() {
  try {
    const d = await apiGet('/api/achievements');
    state.achData = d;
    renderAchievementsModal(d);
  } catch (e) { toast(e.message, 'error'); }
}
function renderAchievementsModal(d) {
  const claimable = d.items.filter(x => x.can_claim);
  let body = `<div class="ach-progress"><div class="ach-progress-num">${d.got} / ${d.total}</div><div class="ach-progress-label">Разблокировано</div></div>`;
  if (claimable.length > 0) {
    const tr = d.total_reward;
    body += `<div class="card" style="background:var(--cyan);color:#0A0E0F;border:none">
      <div style="font-weight:800;text-align:center;margin-bottom:8px">Доступно: ${claimable.length}</div>
      <div style="text-align:center;font-family:'Anton',sans-serif;font-style:italic;display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap">
        <span>+${tr.xp} ${icXp(14)}</span>
        <span>+${tr.soft} ${icShift(14)}</span>
        <span>+${tr.hard} ${icNova(14)}</span>
      </div>
      <button class="btn btn-red" data-action="ach-claim-all" style="width:100%;margin-top:12px;background:#0A0E0F;color:#FFF">ЗАБРАТЬ ВСЁ</button>
    </div>`;
  }
  body += '<div class="ach-grid">';
  for (const a of d.items) {
    const cls = !a.unlocked ? 'locked' : (a.can_claim ? 'claimable' : (a.claimed ? 'claimed' : ''));
    body += `<div class="ach-card ${cls}">
      <div class="ach-icon">${icon(achIconById(a.id),36)}</div>
      <div class="ach-body">
        <div class="ach-name">${escapeHtml(a.name)}</div>
        <div class="ach-desc">${escapeHtml(a.desc)}</div>
        <div class="ach-reward">+${a.reward.xp} ${icXp(14)}${a.reward.soft ? ` · +${a.reward.soft} ${icShift(14)}` : ''}${a.reward.hard ? ` · +${a.reward.hard} ${icNova(14)}` : ''}</div>
      </div>
      ${a.can_claim ? `<button class="ach-claim" data-action="ach-claim" data-id="${a.id}">ЗАБРАТЬ</button>`
        : a.claimed ? `<button class="ach-claim claimed" disabled>${icon('ic-check',14)}</button>` : ''}
    </div>`;
  }
  body += '</div>';
  modalOpen({title:'ДОСТИЖЕНИЯ', body, actions:[{label:'ЗАКРЫТЬ', style:'btn-secondary'}]});
  setTimeout(() => {
    document.querySelectorAll('[data-action="ach-claim"]').forEach(b => {
      b.onclick = async () => {
        try {
          const r = await apiPost('/api/achievement-claim', {ach_id: b.dataset.id});
          haptic('success'); popIcon('ic-gift');
          toast(`+${r.reward.xp} XP · +${r.reward.soft} Шифт · +${r.reward.hard} Нова`, 'success');
          await loadProfile();
          const dd = await apiGet('/api/achievements');
          state.achData = dd;
          renderAchievementsModal(dd);
          if (state.tab === 'profile') render();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
    const allBtn = document.querySelector('[data-action="ach-claim-all"]');
    if (allBtn) allBtn.onclick = async () => {
      const pending = d.items.filter(x => x.can_claim);
      let totalXp = 0, totalSoft = 0, totalHard = 0;
      for (const it of pending) {
        try {
          const r = await apiPost('/api/achievement-claim', {ach_id: it.id});
          totalXp += r.reward.xp; totalSoft += r.reward.soft; totalHard += r.reward.hard;
        } catch(e){}
      }
      haptic('success'); popIcon('ic-gift');
      toast(`+${totalXp} XP · +${totalSoft} Шифт · +${totalHard} Нова`, 'success');
      await loadProfile();
      const dd = await apiGet('/api/achievements');
      state.achData = dd;
      renderAchievementsModal(dd);
      if (state.tab === 'profile') render();
    };
  }, 0);
}
function actionExportPdf() {
  modalConfirm('ЭКСПОРТ PDF?', 'PDF придёт в чат с ботом.', async () => {
    try {
      await apiPost('/api/export');
      haptic('success'); toast('PDF отправлен в Telegram', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }, 'ЭКСПОРТ');
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
  modalOpen({
    title:'НАПОМИНАНИЕ',
    body: `<div class="card-subtitle">За сколько минут до пары</div><div class="choice-row">${[0,5,10,15,20,30,60].map(v => `<button class="choice" data-nb="${v}">${v===0?'Выкл':v+' мин'}</button>`).join('')}</div>`,
    actions:[
      {label:'ОТМЕНА', style:'btn-secondary'},
      {label:'СОХРАНИТЬ', style:'btn', onClick: async () => {
        const v = state._pendingNb || 0;
        try {
          await apiPost('/api/notify-set-before', {minutes: v});
          haptic('success'); toast('Сохранено', 'success');
          await loadProfile(); render();
        } catch (e) { toast(e.message, 'error'); }
      }}
    ]
  });
  setTimeout(() => {
    document.querySelectorAll('[data-nb]').forEach(b => b.onclick = () => {
      state._pendingNb = parseInt(b.dataset.nb);
      document.querySelectorAll('[data-nb]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  }, 0);
}
async function actionAttendanceSet(date, time, subject, status) {
  try { await apiPost('/api/attendance-set', {date, time, subject, status}); haptic('success'); }
  catch (e) { toast(e.message, 'error'); }
}
function actionAttHelp() {
  modalOpen({
    title:'КАК РАБОТАЕТ',
    body: `
      <div class="label">${icon('ic-was',18)} ПОСЕЩЕНО</div><div class="card-subtitle">+3 XP и +1 Шифт.</div>
      <div class="label">${icon('ic-missed',18)} ПРОПУЩЕНО</div><div class="card-subtitle">Пропуск без причины.</div>
      <div class="label">${icon('ic-sick',18)} БОЛЕЛ</div><div class="card-subtitle">Пропуск по болезни.</div>
      <div class="label">${icon('ic-excused',18)} УВАЖИТЕЛЬНАЯ</div><div class="card-subtitle">Уважительная причина.</div>
    `,
    actions:[{label:'ПОНЯТНО', style:'btn'}]
  });
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
  if (notifyCb) notifyCb.addEventListener('change', async (e) => {
    const val = e.target.checked;
    try {
      await apiPost('/api/notify-set', {changes: val});
      if (state.profile) state.profile.notify_changes = val;
      haptic('success');
    } catch (err) {
      haptic('error'); toast(err.message, 'error');
      e.target.checked = !val;
    }
  });
  const aiPhotoInput = document.getElementById('ai-photo-input');
  if (aiPhotoInput) aiPhotoInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) actionAIPhotoSelected(file);
    e.target.value = '';
  });
}

function handleAction(el) {
  const a = el.dataset.action;
  if (a === 'set-subgroup') actionSetSubgroup(parseInt(el.dataset.value));
  else if (a === 'set-gender') actionSetGender(el.dataset.value);
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
  else if (a === 'sch-set-amount') actionScholarshipSetAmount();
  else if (a === 'sch-add-grade') actionScholarshipAddGrade();
  else if (a === 'sch-clear') actionScholarshipClear();
  else if (a === 'ai-send') actionAISend();
  else if (a === 'ai-clear') actionAIClear();
  else if (a === 'ai-photo-open') actionAIPhotoOpen();
  else if (a === 'ai-photo-remove') actionAIPhotoRemove();
  else if (a === 'choose-group') actionChooseGroup();
  else if (a === 'forget-group') actionForgetGroup();
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
  else if (a === 'week-prev') { state.weekOffset -= 1; state.scheduleViewMode = 'week'; state.scheduleDay = null; loadWeekAndRender(); }
  else if (a === 'week-next') { state.weekOffset += 1; state.scheduleViewMode = 'week'; state.scheduleDay = null; loadWeekAndRender(); }
  else if (a === 'week-current') {
    const now = nowIrkutsk();
    state.weekOffset = (now.getDay() === 0) ? 1 : 0;
    state.scheduleViewMode = 'week'; state.scheduleDay = null;
    loadWeekAndRender();
  }
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
  else if (a === 'chest-modal') actionChestModal(el.dataset.id);
  else if (a === 'exchange') actionExchange();
  else if (a === 'show-achievements') actionShowAchievements();
  else if (a === 'export-pdf') actionExportPdf();
  else if (a === 'show-my-feedback') actionShowMyFeedback();
  else if (a === 'att-help') actionAttHelp();
}
function actionDayToday() {
  state.scheduleDay = 'today'; state.scheduleViewMode = 'today'; render();
}
function actionDayTomorrow() {
  state.scheduleDay = 'tomorrow'; state.scheduleViewMode = 'today';
  if (!state.weekDays) { render(); ensureWeekLoaded().then(render); } else render();
}

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

(async function init() {
  await loadTabData(state.tab);
})();
