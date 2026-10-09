/* ===== РУЛЕТКА КЕЙСА (CS:GO style) =====
   Открывается из actionChestModal → openChestRoulette(id, callback).
   Сама дергает /api/chest/open, крутит ленту, показывает результат.
*/

const CHEST_DROP_ICONS = {
  /* что нарисовать в ячейке ленты в зависимости от типа дропа */
  shift:     '/assets/ic_shift.webp',
  nova:      '/assets/ic_nova.webp',
  xp:        '/assets/ic_xp.webp',       /* если нет — покажется алт */
  default:   '/assets/ic_shift.webp',
};

/* Карта наград для визуального разнообразия ленты (исходя из CHESTS в app.py) */
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
  /* 40 ячеек, победитель — в позиции 32 */
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

  /* 1. Сначала запрос на сервер — узнаём, что выпадет */
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

  /* Рендер ячеек */
  strip.innerHTML = cells.map((c, i) => `
    <div class="roulette-cell rar-${c.rar||'common'}" data-idx="${i}">
      <img class="rc-icon" src="${_coinIconByType(c.type)}" alt="">
      <div class="rc-label">${c.label}</div>
    </div>
  `).join('');
  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';

  /* После отрисовки измеряем и вычисляем смещение */
  requestAnimationFrame(() => {
    const cellW = 132 + 12;            /* ширина ячейки + gap */
    const viewportW = viewport.clientWidth;
    /* Целимся так, чтобы центр ячейки winPos оказался в центре viewport */
    const cellCenter = winPos * cellW + 132 / 2;
    const offset = cellCenter - viewportW / 2;
    const duration = 4200;             /* длительность анимации, мс */
    strip.style.transition = `transform ${duration}ms cubic-bezier(.15,.85,.25,1)`;
    strip.style.transform = `translateX(-${offset}px)`;

    /* Через duration — финал */
    setTimeout(() => {
      flash.classList.add('on');
      if (window.Telegram?.WebApp?.HapticFeedback) {
        try { window.Telegram.WebApp.HapticFeedback.notificationOccurred('success'); } catch(e){}
      }
      setTimeout(() => flash.classList.remove('on'), 300);

      /* Показываем плашку с выигрышем */
      const label = winDrop.label || _fmtDropLabel(winDrop);
      win.innerHTML = `
        <img class="roulette-win-icon" src="${_coinIconByType(winDrop.type)}" alt="">
        <div class="roulette-win-label">${label}</div>
        <div class="roulette-win-sub">${(wallet && (wallet.shift != null)) ? `Баланс: ${wallet.shift} Шифт · ${wallet.nova} Нова` : ''}</div>
      `;
      win.classList.add('on');

      /* Автозакрытие через 3 секунды, либо по клику */
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
