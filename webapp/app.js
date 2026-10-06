/* ============================================================
   STUDENT IRK WebApp
   Все API совпадают с bot.py
   ============================================================ */

const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand(); tg?.setHeaderColor?.('#000'); tg?.disableVerticalSwipes?.();

const INIT_DATA = tg?.initData || '';
const qs = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);
const fmt = n => (n ?? 0).toLocaleString('ru-RU');

const API = {
  me:'/api/me', wallet:'/api/wallet', setName:'/api/set-name', setAvatar:'/api/set-avatar',
  exchange:'/api/exchange-soft-to-hard',
  schedule:'/api/schedule', week:'/api/week', groups:'/api/groups',
  setGroup:'/api/set-group', setSubgroup:'/api/set-subgroup',
  tasks:'/api/tasks', taskAdd:'/api/task-add', taskUpdate:'/api/task-update',
  taskDelete:'/api/task-delete', taskClear:'/api/task-clear',
  notes:'/api/notes', noteSave:'/api/note-save', noteDelete:'/api/note-delete',
  notifySet:'/api/notify-set', notifyBefore:'/api/notify-set-before',
  quote:'/api/quote', quoteSub:'/api/quote-subscribe',
  scholarship:'/api/scholarship', schAmount:'/api/scholarship-set-amount',
  schAddGrade:'/api/scholarship-add-grade', schUpdGrade:'/api/scholarship-update-grade',
  schDelGrade:'/api/scholarship-delete-grade', schClear:'/api/scholarship-clear',
  attendance:'/api/attendance-set',
  gameInfo:'/api/game/info', gameSubmit:'/api/game/submit',
  chestStatus:'/api/chest/status', chestOpen:'/api/chest/open',
  premiumOpen:'/api/premium-chest/open',
  achievements:'/api/achievements', walletTop:'/api/wallet/leaderboard',
  ai:'/api/ai', aiPhoto:'/api/ai-photo', aiHistory:'/api/ai/history',
  aiClear:'/api/ai/clear-history',
  feedback:'/api/feedback', feedbackMy:'/api/feedback/my',
  exportPdf:'/api/export', vip:'/api/vip',
  bsCreate:'/api/bs/create', bsJoin:'/api/bs/join', bsFind:'/api/bs/find',
  bsReady:'/api/bs/ready', bsState:'/api/bs/state', bsFire:'/api/bs/fire',
  bsSurrender:'/api/bs/surrender', bsCancel:'/api/bs/cancel',
  bsBotStart:'/api/bs/bot-start', bsFinishBot:'/api/bs/finish-bot',
  adminStats:'/api/admin/stats', adminFbList:'/api/admin/feedback-list',
  adminFbReply:'/api/admin/feedback-reply', adminFbPostpone:'/api/admin/feedback-postpone',
  adminBroadcast:'/api/admin/broadcast', adminMonitor:'/api/admin/monitor',
};

async function apiGet(url, params={}){
  const q = new URLSearchParams({ initData: INIT_DATA, ...params });
  const r = await fetch(`${url}?${q}`);
  if(!r.ok && r.status===401){ showModal('Ошибка','Открой через Telegram'); throw new Error('401'); }
  return r.json();
}
async function apiPost(url, body={}){
  const r = await fetch(url,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({initData:INIT_DATA, ...body})});
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(d.error||'error'),{data:d});
  return d;
}

/* ============ NAV ============ */
function go(screen){
  qsa('.screen').forEach(s=>s.classList.toggle('active', s.dataset.screen===screen));
  qsa('.dock__btn').forEach(b=>b.classList.toggle('active', b.dataset.goto===screen));
  window.scrollTo({top:0,behavior:'smooth'});
  const loaders = {
    levels:renderLevels, tasks:loadTasks, schedule:()=>loadWeek(0),
    notes:loadNotes, ai:loadAiHistory, achievements:loadAchievements,
    leaderboard:loadLeaderboard, scholarship:loadScholarship,
    settings:loadSettings, feedback:loadFeedback, shop:loadShop,
    games:loadGames, checks:loadChecks, attendance:loadAttendance,
    admin:loadAdmin, exchange:()=>{},
  };
  loaders[screen]?.();
}
qsa('[data-goto]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.goto)));

/* ============ MODAL ============ */
function showModal(t,b){
  qs('#modalTitle').textContent=t; qs('#modalBody').innerHTML=b;
  qs('#modal').classList.remove('hidden');
}
qs('#modalOk').onclick=()=>qs('#modal').classList.add('hidden');

/* ============ UTILS ============ */
function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function headForLevel(lvl){
  if(lvl<=5) return 'assets/head-1.png';
  if(lvl<=10) return 'assets/head-2.png';
  if(lvl<=15) return 'assets/head-3.png';
  if(lvl<=20) return 'assets/head-4.png';
  if(lvl<=25) return 'assets/head-5.png';
  return 'assets/head-6.png';
}

/* ============ PROFILE ============ */
let ME=null, TASKS_TAB='active';

async function loadMe(){
  try { ME=await apiGet(API.me); renderProfile(ME); }
  catch(e){ console.error(e); }
}
function renderProfile(d){
  qs('#pName').textContent=d.display_name||d.player_tag||'PLAYER';
  qs('#pHead').src=headForLevel(d.wallet.level);
  qs('#pLevelTag').textContent=`${d.wallet.level} LVL`;
  const total=d.wallet.xp_in_level+d.wallet.xp_to_next;
  qs('#xpFill').style.width=(total? d.wallet.xp_in_level/total*100:0)+'%';
  qs('#xpCur').textContent=fmt(d.wallet.xp_in_level)+'XP';
  qs('#xpNext').textContent=fmt(total)+'XP';
  qs('#wSoft').textContent=fmt(d.wallet.soft);
  qs('#wHard').textContent=fmt(d.wallet.hard);
  ['#lvSoft','#gmSoft','#shSoft'].forEach(s=>qs(s).textContent=fmt(d.wallet.soft));
  ['#lvHard','#gmHard','#shHard'].forEach(s=>qs(s).textContent=fmt(d.wallet.hard));
  qs('#stNotes').textContent=d.notes_count||0;
  qs('#stStreak').textContent=d.streak||0;
  qs('#stTasks').textContent=d.tasks_done||0;
  if(d.is_admin) qs('#menuAdmin').style.display='block';
}

qs('#btnEditName').onclick=async()=>{
  const cur=ME?.wallet?.custom_name||'';
  const name=prompt('Новый ник (до 24 символов):',cur);
  if(name===null) return;
  try {
    const r=await apiPost(API.setName,{name:name.trim()});
    ME.wallet=r.wallet; renderProfile(ME);
  } catch(e){
    if(e.data?.error==='need_hard') showModal('Не хватает','Нужно 5 Автоматов для смены ника');
    else showModal('Ошибка',e.message);
  }
};
qs('#xpBarWrap').onclick=()=>go('levels');
qs('#btnShare').onclick=()=>{
  const url=`https://t.me/share/url?url=${encodeURIComponent('https://t.me/student_irk38_bot')}&text=${encodeURIComponent('Зацени STUDENT IRK!')}`;
  tg?.openTelegramLink?.(url)||window.open(url);
};
qs('#btnMenuAcc').onclick=()=>qs('#menuSub').classList.toggle('hidden');
qs('#btnDelete').onclick=()=>showModal('Удалить аккаунт','Напиши в поддержку, чтобы удалить аккаунт.');
qs('#btnExport').onclick=async()=>{
  try { await apiPost(API.exportPdf); showModal('Готово','PDF отправлен тебе в Telegram.'); }
  catch(e){ showModal('Ошибка',e.message); }
};

/* ============ CHESTS ============ */
qs('#chestDaily').onclick=async()=>{
  try { const r=await apiPost(API.chestOpen); showModal('🎁 Бокс открыт!',r.reward.label); loadMe(); }
  catch(e){
    if(e.data?.error==='already_opened') showModal('Уже открыт','Приходи завтра!');
    else showModal('Ошибка',e.message);
  }
};
qs('#chestPremium').onclick=async()=>{
  if(!confirm('Открыть премиум-бокс за 10 Автоматов?')) return;
  try { const r=await apiPost(API.premiumOpen); showModal('💎 Премиум!',r.reward.label); loadMe(); }
  catch(e){ showModal('Не хватает',e.data?.message||e.message); }
};

/* ============ QUOTE ============ */
async function loadQuote(){
  try {
    const d=await apiGet(API.quote);
    qs('#quoteText').textContent=d.quote;
    qs('#quoteSubBtn').classList.toggle('active', d.subscribed);
  } catch(e){}
}
qs('#quoteSubBtn').onclick=async()=>{
  try {
    const cur=qs('#quoteSubBtn').classList.contains('active');
    await apiPost(API.quoteSub,{subscribe:!cur});
    loadQuote();
  } catch(e){}
};

/* ============ LEVELS ============ */
function renderLevels(){
  if(!ME) return;
  const lvl=ME.wallet.level;
  qs('#lvNum').textContent=lvl;
  qs('#lvCur').textContent=fmt(ME.wallet.xp_in_level)+'XP';
  const total=ME.wallet.xp_in_level+ME.wallet.xp_to_next;
  qs('#lvNext').textContent=fmt(total)+'XP';
  qs('#lvLeft').textContent=fmt(ME.wallet.xp_to_next)+'XP';
  qs('#lvFill').style.width=(total? ME.wallet.xp_in_level/total*100:0)+'%';
  const list=qs('#levelsList'); list.innerHTML='';
  for(let i=1;i<=30;i++){
    const need=i*500;
    const locked=i>lvl;
    const reward=i<=5?'+10 🔥':i<=10?'+25 🔥':i<=20?'+50 🔥':'+100 🔥';
    const div=document.createElement('div');
    div.className='lv-item'+(locked?' lv-item--locked':'');
    div.innerHTML=`<div>
      <div class="lv-item__name">УРОВЕНЬ ${i}</div>
      <div class="lv-item__xp">от ${fmt(need)}XP</div>
      <div class="lv-item__reward">${reward}</div>
    </div>
    <button class="lv-item__btn">${locked?'закрыто':'получено'}</button>`;
    list.appendChild(div);
  }
}

/* ============ GAMES ============ */
async function loadGames(){
  const list=qs('#gamesList'); list.innerHTML='';
  const games=[
    {id:'flappy', name:'ДО ПАРЫ УСПЕТЬ',  img:'card-flappy.png', badge:'НОВОЕ'},
    {id:'bs',     name:'МОРСКОЙ БОЙ',     img:'card-bs.png'},
    {id:'mix',    name:'СЕССИЯ МИКС',     img:'card-mix.png'},
    {id:'rush',   name:'ДЕДЛАЙН РАШ',     img:'card-rush.png'},
    {id:'ninja',  name:'НИНДЗЯ-СТИПУХА',  img:'card-ninja.png'},
    {id:'hunt',   name:'ОХОТА ЗА АВТОМАТОМ', img:'card-hunt.png'},
    {id:'space',  name:'КОСМО-СЕССИЯ',    img:'card-space.png'},
  ];
  let flappyBest=0, flappyPlays=0;
  try {
    const d=await apiGet(API.gameInfo);
    const f=d.games.find(x=>x.id==='flappy');
    if(f){ flappyBest=f.best; flappyPlays=f.plays; }
  } catch(e){}
  games.forEach(g=>{
    const card=document.createElement('div');
    card.className='game-card';
    card.innerHTML=`
      ${g.badge?`<div class="game-card__badge">${g.badge}</div>`:''}
      <div class="game-card__bg" style="background-image:url('assets/${g.img}')"></div>
      <div class="game-card__overlay"></div>
      <div class="game-card__content">
        <div class="game-card__name">${g.name}</div>
        ${g.id==='flappy'?`<div class="muted" style="font-size:11px;margin-bottom:8px;">Рекорд: ${flappyBest} · Игр: ${flappyPlays}</div>`:''}
        <button class="game-card__btn">играть</button>
      </div>`;
    card.querySelector('.game-card__btn').onclick=()=>{
      if(g.id==='bs') go('bs');
      else if(g.id==='flappy') showModal('До пары успеть','Игра откроется в отдельном окне Flappy.');
      else showModal('Скоро','Эта игра ещё в разработке');
    };
    list.appendChild(card);
  });
}

/* ============ BS ============ */
let BS_BET=10, BS_GAME=null, BS_POLL=null;
function renderBsBets(){
  const box=qs('#bsBets'); box.innerHTML='';
  [10,50,100,500].forEach(v=>{
    const b=document.createElement('button');
    b.className='bs-bet'+(v===BS_BET?' active':'');
    b.textContent=v;
    b.onclick=()=>{ BS_BET=v; renderBsBets(); };
    box.appendChild(b);
  });
}
renderBsBets();

qs('#bsCreate').onclick=async()=>{
  try {
    const r=await apiPost(API.bsCreate,{bet:BS_BET});
    BS_GAME=r; showModal('Игра создана',`Код: <b>${r.code}</b><br>Скинь другу`);
    pollBs();
  } catch(e){ showModal('Ошибка',e.data?.message||e.message); }
};
qs('#bsFind').onclick=async()=>{
  try {
    const r=await apiPost(API.bsFind,{bet:BS_BET});
    if(r.status==='matched'){ BS_GAME=r; startBsBoard(); }
    else { showModal('В очереди',`Код: <b>${r.code}</b><br>Ждём соперника...`); pollBs(); }
  } catch(e){ showModal('Ошибка',e.data?.message||e.message); }
};
qs('#bsJoin').onclick=async()=>{
  const code=qs('#bsCode').value.trim();
  if(code.length!==6) return showModal('Ошибка','Код — 6 цифр');
  try {
    const r=await apiPost(API.bsJoin,{code});
    BS_GAME=r; startBsBoard();
  } catch(e){ showModal('Ошибка',e.data?.message||e.message); }
};
qs('#bsBot').onclick=async()=>{
  try {
    await apiPost(API.bsBotStart,{bet:BS_BET});
    BS_GAME={ game_id:'bot', bet:BS_BET, bot:true };
    startBsBoard();
  } catch(e){ showModal('Ошибка',e.data?.message||e.message); }
};
function pollBs(){
  if(BS_POLL) clearInterval(BS_POLL);
  BS_POLL=setInterval(async()=>{
    if(!BS_GAME?.game_id) return;
    try {
      const s=await apiGet(API.bsState,{game_id:BS_GAME.game_id});
      if(s.status==='playing'){ clearInterval(BS_POLL); startBsBoard(); }
      if(s.status==='finished'){ clearInterval(BS_POLL); showBsResult(s.result); }
    } catch(e){}
  },2500);
}
function startBsBoard(){ showModal('Расстановка','Скоро: полный экран морского боя'); }

/* ============ TASKS ============ */
async function loadTasks(){
  const list=qs('#tasksList'); list.innerHTML='<p class="muted">Загрузка...</p>';
  try {
    const d=await apiGet(API.tasks,{done:TASKS_TAB==='done'?'1':'0'});
    list.innerHTML='';
    if(!d.tasks.length){ list.innerHTML='<p class="muted">Пусто</p>'; return; }
    d.tasks.forEach(t=>{
      const div=document.createElement('div');
      div.className='task-item'+(t.done?' task-item--done':'');
      div.innerHTML=`
        <span class="task-item__prio prio-${t.priority}"></span>
        <span class="task-item__text">${escapeHtml(t.text)}${t.due_date?` <small class="muted">до ${t.due_date}${t.due_time?' '+t.due_time:''}</small>`:''}</span>
        <button class="task-item__del">✕</button>`;
      if(!t.done){
        div.querySelector('.task-item__text').onclick=async()=>{
          await apiPost(API.taskUpdate,{id:t.id,done:true});
          loadTasks(); loadMe();
        };
      }
      div.querySelector('.task-item__del').onclick=async(e)=>{
        e.stopPropagation();
        await apiPost(API.taskDelete,{id:t.id});
        loadTasks();
      };
      list.appendChild(div);
    });
  } catch(e){ list.innerHTML='<p class="muted">Ошибка</p>'; }
}
qs('#taskAddBtn').onclick=async()=>{
  const inp=qs('#taskInput'); const text=inp.value.trim();
  if(!text) return;
  await apiPost(API.taskAdd,{text});
  inp.value=''; loadTasks(); loadMe();
};
qsa('.tab').forEach(t=>t.onclick=()=>{
  qsa('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); TASKS_TAB=t.dataset.tab; loadTasks();
});

/* ============ SCHEDULE ============ */
async function loadWeek(offset=0){
  const box=qs('#schedDays'); box.innerHTML='<p class="muted">Загрузка...</p>';
  try {
    const d=await apiGet(API.week,{offset});
    if(d.error){ box.innerHTML='<p class="muted">Выбери группу в настройках</p>'; return; }
    box.innerHTML='';
    d.days.forEach(day=>{
      const card=document.createElement('div');
      card.className='day-card';
      let lessonsHtml='';
      if(!day.lessons.length){ lessonsHtml='<p class="muted">Занятий нет</p>'; }
      else {
        day.lessons.forEach(l=>{
          const time=l.timeEnd?`${l.time}–${l.timeEnd}`:l.time;
          const meta=[l.type, l.auditorium&&`ауд. ${l.auditorium}`, l.teacher].filter(Boolean).join(' · ');
          lessonsHtml+=`
            <div class="lesson">
              <div class="lesson__time">${time}</div>
              <div class="lesson__body">
                <div>${escapeHtml(l.subject)}</div>
                <div class="lesson__meta">${escapeHtml(meta)}</div>
                <div class="lesson__att">
                  <button class="att-btn ${l.attendance==='was'?'active-was':''}" data-st="was">Был</button>
                  <button class="att-btn ${l.attendance==='missed'?'active-missed':''}" data-st="missed">Пропустил</button>
                  <button class="att-btn ${l.attendance==='sick'?'active-sick':''}" data-st="sick">Болел</button>
                </div>
              </div>
            </div>`;
        });
      }
      card.innerHTML=`<div class="day-card__header"><span>${escapeHtml(day.name)}</span><span>${day.date}</span></div>${lessonsHtml}`;
      card.querySelectorAll('.att-btn').forEach(btn=>{
        btn.onclick=async()=>{
          const lesson = btn.closest('.lesson');
          const time = lesson.querySelector('.lesson__time').textContent.split('–')[0];
          const subject = lesson.querySelector('.lesson__body > div').textContent;
          const st = btn.dataset.st;
          await apiPost(API.attendance,{date:day.date,time,subject,status:st});
          btn.parentElement.querySelectorAll('.att-btn').forEach(b=>b.className='att-btn');
          btn.className='att-btn active-'+st;
        };
      });
      box.appendChild(card);
    });
  } catch(e){ box.innerHTML='<p class="muted">Ошибка</p>'; }
}

/* ============ NOTES ============ */
async function loadNotes(){
  try {
    const d=await apiGet(API.notes);
    const list=qs('#notesList'); list.innerHTML='';
    if(!d.notes.length){ list.innerHTML='<p class="muted">Пока нет заметок</p>'; return; }
    d.notes.forEach(n=>{
      const div=document.createElement('div');
      div.className='note-item';
      div.innerHTML=`<div><b>${escapeHtml(n.subject)}</b></div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(n.text)}</div>`;
      div.onclick=async()=>{
        if(confirm('Удалить заметку?')){ await apiPost(API.noteDelete,{id:n.id}); loadNotes(); }
      };
      list.appendChild(div);
    });
  } catch(e){}
}
qs('#noteAddBtn').onclick=async()=>{
  const s=qs('#noteSubject').value.trim();
  const t=qs('#noteText').value.trim();
  if(!s||!t) return;
  await apiPost(API.noteSave,{subject:s,text:t});
  qs('#noteSubject').value=''; qs('#noteText').value='';
  loadNotes(); loadMe();
};

/* ============ AI ============ */
async function loadAiHistory(){
  try {
    const d=await apiGet(API.aiHistory);
    const box=qs('#aiChat'); box.innerHTML='';
    if(!d.items.length){ box.innerHTML='<p class="muted">Спроси что-нибудь у AI-помощника</p>'; return; }
    d.items.forEach(m=>addAiMsg(m.role==='user'?'user':'ai',m.text));
  } catch(e){}
}
function addAiMsg(role,text){
  const box=qs('#aiChat');
  const div=document.createElement('div');
  div.className=`ai-msg ai-msg--${role}`;
  div.textContent=text;
  box.appendChild(div); box.scrollTop=box.scrollHeight;
  return div;
}
qs('#aiSend').onclick=async()=>{
  const inp=qs('#aiInput'); const q=inp.value.trim();
  if(!q) return;
  inp.value='';
  addAiMsg('user',q);
  const pending=addAiMsg('ai','...');
  try {
    const r=await apiPost(API.ai,{question:q});
    pending.textContent=r.answer||'Нет ответа';
    loadMe();
  } catch(e){ pending.textContent='Ошибка: '+e.message; }
};
qs('#aiClear').onclick=async()=>{
  if(!confirm('Очистить историю?')) return;
  await apiPost(API.aiClear); loadAiHistory();
};
qs('#aiPhoto').onchange=async(e)=>{
  const f=e.target.files[0]; if(!f) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    const b64=reader.result;
    addAiMsg('user','📷 Фото');
    const pending=addAiMsg('ai','...');
    try {
      const r=await apiPost(API.aiPhoto,{photo:b64,question:''});
      pending.textContent=r.answer||'Нет ответа';
    } catch(e){ pending.textContent='Ошибка: '+e.message; }
  };
  reader.readAsDataURL(f);
  e.target.value='';
};

/* ============ ACHIEVEMENTS ============ */
async function loadAchievements(){
  try {
    const d=await apiGet(API.achievements);
    const list=qs('#achList'); list.innerHTML='';
    d.items.forEach(a=>{
      const div=document.createElement('div');
      div.className='ach-item'+(a.unlocked?'':' ach-item--locked');
      div.innerHTML=`<div class="ach-item__icon">${a.icon}</div>
        <div style="flex:1">
          <div class="ach-item__name">${escapeHtml(a.name)}</div>
          <div class="ach-item__desc">${escapeHtml(a.desc)}</div>
        </div>
        <div class="muted">${a.unlocked?'✓':''}</div>`;
      list.appendChild(div);
    });
  } catch(e){}
}

/* ============ LEADERBOARD ============ */
async function loadLeaderboard(){
  try {
    const d=await apiGet(API.walletTop);
    const list=qs('#lbList'); list.innerHTML='';
    d.items.forEach(it=>{
      const div=document.createElement('div');
      div.className='lb-item';
      div.innerHTML=`<div class="lb-item__rank">${it.rank}</div>
        <div class="lb-item__name">${escapeHtml(it.display)}${it.is_me?' (ты)':''}</div>
        <div class="lb-item__xp">${fmt(it.xp)} XP</div>`;
      list.appendChild(div);
    });
  } catch(e){}
}

/* ============ EXCHANGE ============ */
qs('#exBtn').onclick=async()=>{
  const amount=parseInt(qs('#exAmount').value||'0');
  if(amount<100) return showModal('Мало','Минимум 100 Стипух');
  try {
    const r=await apiPost(API.exchange,{amount});
    qs('#exResult').textContent=`Обменяно ${r.soft_spent} → ${r.hard_received}`;
    loadMe();
  } catch(e){ showModal('Ошибка',e.data?.message||e.message); }
};

/* ============ SCHOLARSHIP ============ */
async function loadScholarship(){
  try {
    const d=await apiGet(API.scholarship);
    const box=qs('#schContent');
    let html=`
      <div class="note-item">
        <div class="muted">Сумма стипендии</div>
        <div style="font-family:'Anton';font-size:28px;font-style:italic;color:var(--cyan);">
          ${d.amount?fmt(d.amount)+' ₽':'не указана'}
        </div>
      </div>
      <div class="note-item">
        <div class="muted">Средний балл</div>
        <div style="font-family:'Anton';font-size:28px;font-style:italic;">
          ${d.avg?d.avg.toFixed(2):'—'}
        </div>
        <div class="muted" style="margin-top:8px;">${escapeHtml(d.forecast)}</div>
      </div>
      <div class="note-item">
        <div class="muted">Оценки (${d.grades.length})</div>
        ${d.grades.map(g=>`<div style="margin-top:6px;">${escapeHtml(g.subject)}: <b>${g.grade}</b>${g.is_auto?' (авто)':''}</div>`).join('')}
      </div>`;
    box.innerHTML=html;
  } catch(e){}
}

/* ============ ATTENDANCE ============ */
async function loadAttendance(){
  try {
    const d=await apiGet(API.me);
    const box=qs('#attStats');
    box.innerHTML=`
      <div class="stat"><div class="stat__icon">✅</div><div class="stat__label">ПОСЕЩЕНО</div><div class="stat__val">${d.attendance_was}</div></div>
      <div class="stat"><div class="stat__icon">❌</div><div class="stat__label">ПРОПУЩЕНО</div><div class="stat__val">${d.attendance_missed}</div></div>
      <div class="stat"><div class="stat__icon">🤒</div><div class="stat__label">БОЛЕЛ</div><div class="stat__val">${d.attendance_sick}</div></div>`;
  } catch(e){}
}

/* ============ SETTINGS ============ */
async function loadSettings(){
  const box=qs('#settingsContent');
  try {
    const groups=await apiGet(API.groups);
    let html=`
      <div class="note-item">
        <div class="muted">Группа</div>
        <div style="margin-top:8px;">${ME?.group||'не выбрана'}</div>
        <button class="btn btn--cyan" style="margin-top:10px;width:100%;" id="btnPickGroup">Сменить группу</button>
      </div>
      <div class="note-item">
        <div class="muted">Подгруппа</div>
        <div style="margin-top:8px;display:flex;gap:8px;">
          ${[0,1,2].map(n=>`<button class="tab ${ME?.subgroup===n?'active':''}" data-sg="${n}">${n===0?'Все':n}</button>`).join('')}
        </div>
      </div>
      <div class="note-item">
        <div class="muted">Уведомления о расписании</div>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="tab ${!ME?.notify_type?'active':''}" data-nf="">Выкл</button>
          <button class="tab ${ME?.notify_type==='today'?'active':''}" data-nf="today">Сегодня</button>
          <button class="tab ${ME?.notify_type==='tomorrow'?'active':''}" data-nf="tomorrow">Завтра</button>
        </div>
      </div>
      <div class="note-item">
        <div class="muted">Отслеживать изменения в расписании</div>
        <div style="margin-top:8px;">
          <button class="tab ${ME?.notify_changes?'active':''}" id="btnChangeToggle">${ME?.notify_changes?'Вкл':'Выкл'}</button>
        </div>
      </div>`;
    box.innerHTML=html;
    qs('#btnPickGroup').onclick=()=>pickGroup(groups.groups);
    box.querySelectorAll('[data-sg]').forEach(b=>b.onclick=async()=>{
      await apiPost(API.setSubgroup,{subgroup:parseInt(b.dataset.sg)});
      loadMe(); loadSettings();
    });
    box.querySelectorAll('[data-nf]').forEach(b=>b.onclick=async()=>{
      const t=b.dataset.nf;
      if(!t) await apiPost(API.notifySet,{type:''});
      else {
        const h=prompt('Час (0-23):', t==='today'?'8':'20');
        const m=prompt('Минуты:', '0');
        await apiPost(API.notifySet,{type:t,hour:parseInt(h||'8'),minute:parseInt(m||'0')});
      }
      loadMe(); loadSettings();
    });
    qs('#btnChangeToggle').onclick=async()=>{
      await apiPost(API.notifySet,{changes:!ME?.notify_changes});
      loadMe(); loadSettings();
    };
  } catch(e){}
}
function pickGroup(groups){
  const cat=prompt('Факультет:\n'+Object.keys(groups).join('\n'));
  if(!cat||!groups[cat]) return;
  const grp=prompt('Группа:\n'+groups[cat].map(g=>g.name).join('\n'));
  if(!grp) return;
  const found=groups[cat].find(g=>g.name===grp);
  if(!found) return showModal('Не найдено','Проверь название');
  apiPost(API.setGroup,{group_id:found.id,group_name:found.name,subgroup:0})
    .then(()=>{loadMe();loadSettings();showModal('Готово','Группа обновлена');});
}

/* ============ FEEDBACK ============ */
async function loadFeedback(){
  try {
    const d=await apiGet(API.feedbackMy);
    const list=qs('#fbList'); list.innerHTML='';
    if(!d.items.length){ list.innerHTML='<p class="muted">Обращений нет</p>'; return; }
    d.items.forEach(f=>{
      const div=document.createElement('div');
      div.className='fb-item';
      div.innerHTML=`<div class="muted" style="font-size:11px;">#${f.id} · ${f.status}</div>
        <div style="margin-top:6px;">${escapeHtml(f.text)}</div>
        ${f.admin_reply?`<div style="margin-top:8px;color:var(--cyan);">Ответ: ${escapeHtml(f.admin_reply)}</div>`:''}`;
      list.appendChild(div);
    });
  } catch(e){}
}
qs('#fbSend').onclick=async()=>{
  const t=qs('#fbInput').value.trim();
  if(!t) return;
  await apiPost(API.feedback,{text:t});
  qs('#fbInput').value=''; loadFeedback();
};

/* ============ SHOP ============ */
function loadShop(){
  const items=[
    {name:'3 МЕСЯЦА ЯНДЕКС ПЛЮС',price:1299,emoji:'🎬'},
    {name:'SBERBOOM MINI 2',price:4999,emoji:'🔊'},
    {name:'ЯНДЕКС СТАНЦИЯ ЛАЙТ 2',price:3999,emoji:'📻'},
    {name:'3 МЕСЯЦА WINK',price:799,emoji:'📺'},
    {name:'МАРУСЯ, VK КАПСУЛА МИНИ',price:5999,emoji:'🤖'},
    {name:'АВТОМАТ В КАРМАНЕ',price:500,emoji:'🔥'},
  ];
  const grid=qs('#shopGrid'); grid.innerHTML='';
  items.forEach(it=>{
    const div=document.createElement('div');
    div.className='shop-item';
    div.innerHTML=`<div class="shop-item__img">${it.emoji}</div>
      <div class="shop-item__name">${it.name}</div>
      <div class="shop-item__price">${fmt(it.price)} 🔥</div>`;
    div.onclick=()=>showModal('Покупка',`«${it.name}» за ${it.price} Автоматов.<br><br>Скоро!`);
    grid.appendChild(div);
  });
}

/* ============ CHECKS ============ */
function loadChecks(){
  const grid=qs('#checksGrid'); grid.innerHTML='';
  const promos=[
    {name:'ПОВЫШЕННЫЙ КЭШБЕК',emoji:'💳'},
    {name:'РОЗЫГРЫШ 100 ПРИЗОВ',emoji:'🎁'},
    {name:'ИСПОЛНИМ МЕЧТУ',emoji:'✨'},
    {name:'НОВЫЕ ВКУСЫ',emoji:'🥒'},
  ];
  promos.forEach(p=>{
    const div=document.createElement('div');
    div.className='shop-item';
    div.innerHTML=`<div class="shop-item__img">${p.emoji}</div>
      <div class="shop-item__name">${p.name}</div>`;
    div.onclick=()=>showModal(p.name,'Сканируй чек и участвуй!');
    grid.appendChild(div);
  });
}

/* ============ ADMIN ============ */
async function loadAdmin(){
  try {
    const s=await apiGet(API.adminStats);
    qs('#adminStats').innerHTML=`
      <div class="stat"><div class="stat__label">ВСЕГО ЮЗЕРОВ</div><div class="stat__val">${s.total_users}</div></div>
      <div class="stat"><div class="stat__label">ОБРАЩЕНИЙ</div><div class="stat__val">${s.pending_feedback}</div></div>`;
    const f=await apiGet(API.adminFbList);
    const box=qs('#adminFb'); box.innerHTML='';
    f.items.forEach(it=>{
      const div=document.createElement('div');
      div.className='fb-item';
      div.innerHTML=`<div class="muted" style="font-size:11px;">#${it.id} от ${it.username}</div>
        <div style="margin-top:6px;">${escapeHtml(it.text)}</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn btn--cyan" data-act="reply" data-id="${it.id}">Ответить</button>
          <button class="btn btn--ghost" data-act="postpone" data-id="${it.id}">Отложить</button>
        </div>`;
      box.appendChild(div);
    });
    box.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{
      const id=parseInt(b.dataset.id);
      if(b.dataset.act==='postpone'){ await apiPost(API.adminFbPostpone,{id}); }
      else {
        const t=prompt('Ответ:');
        if(!t) return;
        await apiPost(API.adminFbReply,{id,text:t});
      }
      loadAdmin();
    });
    const m=await apiGet(API.adminMonitor);
    qs('#adminMonitor').textContent=`istu.edu: ${m.ok?'✅ OK':'❌ '+m.status}`;
  } catch(e){}
}
qs('#adminBroadcastBtn').onclick=async()=>{
  const t=qs('#adminBroadcast').value.trim();
  if(!t) return;
  await apiPost(API.adminBroadcast,{text:t});
  qs('#adminBroadcast').value='';
  showModal('Готово','Рассылка запущена');
};

/* ============ INIT ============ */
window.addEventListener('load', async ()=>{
  setTimeout(()=>{
    qs('#splash').classList.add('fade');
    setTimeout(()=>qs('#splash').remove(), 500);
  }, 900);
  await loadMe();
  await loadQuote();
  await loadTasks();
});
