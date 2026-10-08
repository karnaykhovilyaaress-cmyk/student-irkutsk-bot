from dotenv import load_dotenv
load_dotenv()
import os, asyncio, re, sys, json, base64, random, secrets, sqlite3, logging
from datetime import datetime, timedelta, timezone
import aiohttp
from aiohttp import web
from bs4 import BeautifulSoup
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (Message, InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, FSInputFile, WebAppInfo, BufferedInputFile)
from aiogram.utils.web_app import safe_parse_webapp_init_data
try:
    from fpdf import FPDF
    _FPDF_AVAILABLE = True
except Exception:
    _FPDF_AVAILABLE = False

def clean_latex(text):
    if not text: return text
    text = re.sub(r"\$\$(.+?)\$\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\\\[(.+?)\\\]", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\\\((.+?)\\\)", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\\[dt]?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"(\1)/(\2)", text)
    text = re.sub(r"\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]+)\}", r"\1-й корень из (\2)", text)
    text = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"√(\1)", text)
    text = re.sub(r"\\vec\s*\{([^{}]+)\}", r"\1", text)
    text = re.sub(r"\\hat\s*\{([^{}]+)\}", r"\1", text)
    text = re.sub(r"\\bar\s*\{([^{}]+)\}", r"\1", text)
    text = re.sub(r"\^\s*\{([^{}]+)\}", r"^\1", text)
    text = re.sub(r"_\s*\{([^{}]+)\}", r"_\1", text)
    greek = {r"\\alpha":"α",r"\\beta":"β",r"\\gamma":"γ",r"\\delta":"δ",r"\\epsilon":"ε",
        r"\\theta":"θ",r"\\lambda":"λ",r"\\mu":"μ",r"\\nu":"ν",r"\\pi":"π",r"\\rho":"ρ",
        r"\\sigma":"σ",r"\\tau":"τ",r"\\phi":"φ",r"\\varphi":"φ",r"\\chi":"χ",r"\\psi":"ψ",
        r"\\omega":"ω",r"\\Gamma":"Γ",r"\\Delta":"Δ",r"\\Theta":"Θ",r"\\Lambda":"Λ",
        r"\\Pi":"Π",r"\\Sigma":"Σ",r"\\Phi":"Φ",r"\\Psi":"Ψ",r"\\Omega":"Ω"}
    for cmd, repl in greek.items(): text = re.sub(cmd + r"\b", repl, text)
    reps = [(r"\\cdot","·"),(r"\\times","×"),(r"\\div","÷"),(r"\\pm","±"),
        (r"\\leq","≤"),(r"\\le","≤"),(r"\\geq","≥"),(r"\\ge","≥"),(r"\\neq","≠"),
        (r"\\approx","≈"),(r"\\infty","∞"),(r"\\sum","Σ"),(r"\\prod","Π"),(r"\\int","∫"),
        (r"\\rightarrow","→"),(r"\\to","→"),(r"\\leftarrow","←"),(r"\\Rightarrow","⇒"),
        (r"\\leftrightarrow","↔"),(r"\\in","∈"),(r"\\notin","∉"),(r"\\subset","⊂"),
        (r"\\supset","⊃"),(r"\\cup","∪"),(r"\\cap","∩"),(r"\\forall","∀"),
        (r"\\exists","∃"),(r"\\emptyset","∅"),(r"\\angle","∠"),(r"\\degree","°"),
        (r"\\ldots","..."),(r"\\dots","..."),(r"\\cdots","...")]
    for cmd, repl in reps: text = re.sub(cmd, repl, text)
    text = re.sub(r"\\(sin|cos|tan|ctg|cot|log|ln|lg|exp|lim|max|min|arg|det|mod)\b", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]*\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)
    text = text.replace("{","").replace("}","")
    text = re.sub(r"[ \t]+", " ", text); text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def clean_markdown(text):
    if not text: return text
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\*(.+?)\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"```[a-zA-Z]*\n?(.+?)```", r"\1", text, flags=re.DOTALL)
    lines = text.split("\n"); out = []
    for line in lines:
        s = line.strip()
        if re.fullmatch(r"\|?[\s\-:|]+\|?", s) and "-" in s: continue
        if s.startswith("|") and s.endswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|") if c.strip()]
            out.append("  ".join(cells))
        else: out.append(line)
    text = "\n".join(out)
    text = re.sub(r"^[\-\*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

TOKEN = os.getenv("BOT_TOKEN", "")
GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_KEY", "")
YANDEX_VISION_API_KEY = os.getenv("YANDEX_VISION_API_KEY", "")
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID", "")
ADMIN_ID = 6014557174
ADMIN_USERNAME = "ilyaech"
BOT_USERNAME = "@student_irk38_bot"
WEBAPP_URL = os.getenv("WEBAPP_URL", "")
ADMIN_BONUS_SHIFT = 1000000
ADMIN_BONUS_NOVA = 10000
EXCHANGE_RATE_SHIFT_TO_NOVA = 100
BS_BET_OPTIONS = [10, 50, 100, 500]
BS_TURN_TIMEOUT_SEC = 120
if not TOKEN:
    logging.error("BOT_TOKEN не задан!"); sys.exit(1)
bot = Bot(token=TOKEN)
dp = Dispatcher()
giga_client = None
if GIGACHAT_CREDENTIALS:
    try:
        from gigachat import GigaChat
        giga_client = GigaChat(credentials=GIGACHAT_CREDENTIALS,
            base_url="https://api.giga.chat/v1", scope="GIGACHAT_API_PERS",
            verify_ssl_certs=False, model="GigaChat-2-Max", timeout=600)
    except Exception as e:
        logging.error(f"GigaChat ошибка: {e}")
DB_PATH = os.getenv("DB_PATH", "users.db")
CACHE_TTL_HOURS = 2
PRIORITY_LABELS = {1: "низкий", 2: "средний", 3: "высокий"}
DAILY_QUOTES = [
    "Учись так, будто тебе нечего терять, и работай так, будто тебе нечего доказывать.",
    "Сессия сдаётся не за неделю, а за семестр.",
    "Студент — это человек, который учится всю жизнь, но не всегда в универе.",
    "Пара не последняя, а самая первая — просто ты её проспал.",
    "Оценка — это не ты, но она влияет на стипендию.",
    "Лекция без конспекта — это медитация.",
    "Сон — это не лень, это восстановление к следующей паре.",
    "Если не знаешь, что делать — начни с конспекта.",
    "Сессия — это когда весь семестр за одну ночь.",
    "Не откладывай на завтра то, что можно отложить на после сессии.",
    "Матан — это не предмет, это образ жизни.",
    "Лучшее, что можно взять из универа — это знакомства и привычку думать.",
    "Пока ты спишь, кто-то учится. А кто-то тоже спит. Всё нормально.",
    "Универ — это про то, как не сдаваться, когда сложно.",
    "Каждый, кто сдал сессию, когда-то не понимал, что делает.",
    "Забыл — перечитай. Не понял — спроси. Лень — иди спать.",
    "Делай больше, чем от тебя требуют, и меньше, чем о тебе говорят.",
    "Студенческий билет — это пропуск в мир взрослых проблем.",
    "Не сдал — не конец. Сдал — не финиш.",
    "Дисциплина — это не про силу воли, а про систему.",
]
GAMES = {"flappy": {"name": "До пары успеть", "desc": "Пролетай между парами, лови бонусы"}}
ACHIEVEMENTS = {
    "first_day":    {"name": "Первый день",      "icon": "ic-ach-first_day",    "desc": "Зашёл в бота"},
    "week_visit":   {"name": "Неделя в боте",    "icon": "ic-ach-week_visit",   "desc": "7 дней подряд"},
    "first_note":   {"name": "Первый конспект",  "icon": "ic-ach-first_note",   "desc": "Добавил первую заметку"},
    "first_task":   {"name": "Сделал дело",      "icon": "ic-ach-first_task",   "desc": "Первая выполненная задача"},
    "prod_50":      {"name": "Продуктивный",     "icon": "ic-ach-prod_50",      "desc": "50 выполненных задач"},
    "excellent":    {"name": "Отличник",         "icon": "ic-ach-excellent",    "desc": "Средний балл 5.0"},
    "flappy_30":    {"name": "Снайпер",          "icon": "ic-ach-flappy_30",    "desc": "30 очков в Flappy"},
    "legend_30":    {"name": "Легенда",          "icon": "ic-ach-legend_30",    "desc": "30 уровень"},
    "bs_first_win": {"name": "Морской волк",     "icon": "ic-ach-bs_first_win", "desc": "Первая победа в бою"},
    "bs_5_wins":    {"name": "Адмирал",          "icon": "ic-ach-bs_5_wins",    "desc": "5 побед в бою"},
    "bs_10_wins":   {"name": "Легенда флота",    "icon": "ic-ach-bs_10_wins",   "desc": "10 побед в бою"},
    "exchange_1":   {"name": "Обменник",         "icon": "ic-ach-exchange_1",   "desc": "Первый обмен"},
}
ACHIEVEMENT_REWARDS = {
    "first_day":    {"xp": 10,   "shift": 5,    "nova": 0},
    "first_note":   {"xp": 20,   "shift": 10,   "nova": 0},
    "first_task":   {"xp": 30,   "shift": 15,   "nova": 0},
    "flappy_30":    {"xp": 50,   "shift": 30,   "nova": 1},
    "week_visit":   {"xp": 100,  "shift": 50,   "nova": 1},
    "prod_50":      {"xp": 200,  "shift": 100,  "nova": 2},
    "excellent":    {"xp": 300,  "shift": 150,  "nova": 3},
    "legend_30":    {"xp": 1000, "shift": 500,  "nova": 10},
    "bs_first_win": {"xp": 100,  "shift": 50,   "nova": 1},
    "bs_5_wins":    {"xp": 300,  "shift": 150,  "nova": 3},
    "bs_10_wins":   {"xp": 800,  "shift": 400,  "nova": 8},
    "exchange_1":   {"xp": 20,   "shift": 0,    "nova": 1},
}
CHESTS = {
    "capsule": {"name":"Капсула","cooldown_h":24,"cost_shift":0,"cost_nova":0,"drops":[
        {"type":"shift","min":10,"max":40,"chance":0.55},
        {"type":"xp","min":50,"max":150,"chance":0.30},
        {"type":"nova","min":1,"max":1,"chance":0.10},
        {"type":"shift","min":100,"max":100,"chance":0.05}]},
    "relic": {"name":"Реликт","cooldown_h":0,"cost_shift":50,"cost_nova":0,"drops":[
        {"type":"shift","min":60,"max":150,"chance":0.50},
        {"type":"xp","min":200,"max":500,"chance":0.30},
        {"type":"nova","min":1,"max":3,"chance":0.18},
        {"type":"nova","min":10,"max":10,"chance":0.02}]},
    "artifact": {"name":"Артефакт","cooldown_h":0,"cost_shift":0,"cost_nova":15,"drops":[
        {"type":"shift","min":500,"max":500,"chance":0.30},
        {"type":"xp","min":1000,"max":1000,"chance":0.30},
        {"type":"nova","min":5,"max":15,"chance":0.35},
        {"type":"nova","min":50,"max":50,"chance":0.05}]},
    "core": {"name":"Ядро","cooldown_h":0,"cost_shift":0,"cost_nova":80,"drops":[
        {"type":"shift","min":2000,"max":2000,"chance":0.25},
        {"type":"xp","min":5000,"max":5000,"chance":0.25},
        {"type":"nova","min":30,"max":60,"chance":0.40},
        {"type":"nova","min":200,"max":200,"chance":0.10}]},
}
LEVEL_REWARDS = {}
for _lvl in range(1, 31):
    if _lvl <= 5: LEVEL_REWARDS[_lvl] = {"shift":100,"nova":1,"xp":0}
    elif _lvl <= 10: LEVEL_REWARDS[_lvl] = {"shift":250,"nova":3,"xp":0}
    elif _lvl <= 20: LEVEL_REWARDS[_lvl] = {"shift":600,"nova":8,"xp":0}
    else: LEVEL_REWARDS[_lvl] = {"shift":1500,"nova":25,"xp":0}

def calc_level(xp):
    lvl = 1; left = int(xp or 0)
    while lvl <= 30:
        need = lvl * 500
        if left < need: return lvl, left, need
        left -= need; lvl += 1
    return 30, left, 500

def level_title(lvl):
    if lvl <= 5: return "Первокурсник"
    if lvl <= 10: return "Второкурсник"
    if lvl <= 15: return "Третьекурсник"
    if lvl <= 20: return "Старшекурсник"
    if lvl <= 25: return "Магистрант"
    if lvl <= 29: return "Аспирант"
    return "Легенда ИРНИТУ"

def roll_chest_drop(chest_id):
    chest = CHESTS.get(chest_id)
    if not chest: return None
    r = random.random(); acc = 0.0
    for drop in chest["drops"]:
        acc += drop["chance"]
        if r <= acc:
            return {"type": drop["type"], "amount": random.randint(drop["min"], drop["max"])}
    last = chest["drops"][-1]
    return {"type": last["type"], "amount": random.randint(last["min"], last["max"])}

def _now_irkutsk(): return datetime.now(timezone.utc) + timedelta(hours=8)
def _monday_of_week(d): return d - timedelta(days=d.weekday())

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, group_id TEXT, group_name TEXT,
        notify_hour INTEGER DEFAULT -1, notify_minute INTEGER DEFAULT 0, notify_changes INTEGER DEFAULT 0, subgroup INTEGER DEFAULT 0)""")
    for a in ["ALTER TABLE users ADD COLUMN notify_changes INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN subgroup INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN notify_type TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN last_notified_at TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN notify_before_min INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN first_name TEXT DEFAULT NULL"]:
        try: conn.execute(a)
        except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS daily_subscribers (user_id INTEGER PRIMARY KEY, subscribed_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS scholarship (user_id INTEGER PRIMARY KEY, current_amount INTEGER DEFAULT 0, updated_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS grades (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
        subject TEXT, grade INTEGER, created_at TEXT, is_auto INTEGER DEFAULT 0)""")
    for a in ["ALTER TABLE grades ADD COLUMN is_auto INTEGER DEFAULT 0","ALTER TABLE grades ADD COLUMN semester TEXT DEFAULT NULL"]:
        try: conn.execute(a)
        except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS schedule_cache (group_id TEXT, week_start TEXT, html TEXT, cached_at TEXT, PRIMARY KEY (group_id, week_start))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS schedule_snapshots (group_id TEXT, week_start TEXT, snapshot TEXT, updated_at TEXT, PRIMARY KEY (group_id, week_start))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
        text TEXT, created_at TEXT, admin_msg_id INTEGER, status TEXT DEFAULT 'new', answered_at TEXT, admin_reply TEXT DEFAULT NULL)""")
    for a in ["ALTER TABLE feedback ADD COLUMN status TEXT DEFAULT 'new'","ALTER TABLE feedback ADD COLUMN answered_at TEXT","ALTER TABLE feedback ADD COLUMN admin_reply TEXT DEFAULT NULL"]:
        try: conn.execute(a)
        except: pass
    conn.execute("UPDATE feedback SET status='new' WHERE status IS NULL")
    conn.execute("""CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT,
        due_date TEXT, done INTEGER DEFAULT 0, created_at TEXT, priority INTEGER DEFAULT 2, due_time TEXT, done_at TEXT)""")
    for a in ["ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 2","ALTER TABLE tasks ADD COLUMN due_time TEXT","ALTER TABLE tasks ADD COLUMN done_at TEXT"]:
        try: conn.execute(a)
        except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, subject TEXT, text TEXT, created_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS ai_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role TEXT,
        text TEXT, has_photo INTEGER DEFAULT 0, created_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT,
        time TEXT, subject TEXT, status TEXT, updated_at TEXT, UNIQUE(user_id, date, time, subject))""")
    try:
        cur = conn.execute("PRAGMA table_info(game_scores)"); cols = [r[1] for r in cur.fetchall()]
        if cols and "game_id" not in cols:
            conn.execute("ALTER TABLE game_scores RENAME TO game_scores_old")
            conn.execute("""CREATE TABLE game_scores (user_id INTEGER, game_id TEXT, best_score INTEGER DEFAULT 0,
                plays_count INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (user_id, game_id))""")
            try:
                conn.execute("""INSERT OR IGNORE INTO game_scores (user_id, game_id, best_score, plays_count, updated_at)
                    SELECT user_id, 'flappy', best_score, plays_count, updated_at FROM game_scores_old""")
            except: pass
            conn.execute("DROP TABLE game_scores_old")
    except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS game_scores (user_id INTEGER, game_id TEXT, best_score INTEGER DEFAULT 0,
        plays_count INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (user_id, game_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS wallet (user_id INTEGER PRIMARY KEY, xp INTEGER DEFAULT 0,
        shift INTEGER DEFAULT 0, nova INTEGER DEFAULT 0, custom_name TEXT DEFAULT NULL, avatar_idx INTEGER DEFAULT 0,
        free_name_changes INTEGER DEFAULT 0, capsule_opened_at TEXT DEFAULT NULL, created_at TEXT, updated_at TEXT)""")
    for a in ["ALTER TABLE wallet ADD COLUMN shift INTEGER DEFAULT 0","ALTER TABLE wallet ADD COLUMN nova INTEGER DEFAULT 0",
        "ALTER TABLE wallet ADD COLUMN custom_name TEXT DEFAULT NULL","ALTER TABLE wallet ADD COLUMN avatar_idx INTEGER DEFAULT 0",
        "ALTER TABLE wallet ADD COLUMN free_name_changes INTEGER DEFAULT 0","ALTER TABLE wallet ADD COLUMN capsule_opened_at TEXT DEFAULT NULL",
        "ALTER TABLE wallet ADD COLUMN created_at TEXT"]:
        try: conn.execute(a)
        except: pass
    try:
        cur = conn.execute("PRAGMA table_info(wallet)"); cols = [r[1] for r in cur.fetchall()]
        if "soft" in cols: conn.execute("UPDATE wallet SET shift = COALESCE(shift,0) + COALESCE(soft,0)")
        if "hard" in cols: conn.execute("UPDATE wallet SET nova = COALESCE(nova,0) + COALESCE(hard,0)")
    except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS achievements (user_id INTEGER, ach_id TEXT, unlocked_at TEXT, PRIMARY KEY (user_id, ach_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS user_stats (user_id INTEGER PRIMARY KEY, tasks_done INTEGER DEFAULT 0,
        notes_added INTEGER DEFAULT 0, first_seen TEXT, last_seen TEXT, streak INTEGER DEFAULT 0)""")
    for a in ["ALTER TABLE user_stats ADD COLUMN tasks_done INTEGER DEFAULT 0","ALTER TABLE user_stats ADD COLUMN notes_added INTEGER DEFAULT 0",
        "ALTER TABLE user_stats ADD COLUMN first_seen TEXT","ALTER TABLE user_stats ADD COLUMN last_seen TEXT",
        "ALTER TABLE user_stats ADD COLUMN streak INTEGER DEFAULT 0"]:
        try: conn.execute(a)
        except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS bs_games (game_id TEXT PRIMARY KEY, code TEXT, p1_id INTEGER, p2_id INTEGER,
        bet INTEGER DEFAULT 0, status TEXT DEFAULT 'waiting', turn INTEGER DEFAULT 0, p1_ships TEXT DEFAULT NULL,
        p2_ships TEXT DEFAULT NULL, p1_ready INTEGER DEFAULT 0, p2_ready INTEGER DEFAULT 0, p1_shots TEXT DEFAULT '[]',
        p2_shots TEXT DEFAULT '[]', winner INTEGER DEFAULT 0, surrender_by INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)""")
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bs_code ON bs_games(code)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bs_status ON bs_games(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bs_p1 ON bs_games(p1_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bs_p2 ON bs_games(p2_id)")
    except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS bs_meta (key TEXT PRIMARY KEY, value TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS achievement_claims (user_id INTEGER, ach_id TEXT, claimed_at TEXT, PRIMARY KEY (user_id, ach_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS achievement_rewards (user_id INTEGER, ach_id TEXT, xp INTEGER DEFAULT 0,
        shift INTEGER DEFAULT 0, nova INTEGER DEFAULT 0, granted_at TEXT, PRIMARY KEY (user_id, ach_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS level_rewards (user_id INTEGER, level INTEGER, claimed_at TEXT, PRIMARY KEY (user_id, level))""")
    conn.commit(); conn.close()

def _ensure_user(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    now = datetime.now(timezone.utc).isoformat()
    conn.execute("INSERT OR IGNORE INTO wallet (user_id, created_at, updated_at) VALUES (?, ?, ?)", (user_id, now, now))
    if user_id == ADMIN_ID:
        conn.execute("""UPDATE wallet SET shift = MAX(COALESCE(shift,0), ?), nova = MAX(COALESCE(nova,0), ?),
            updated_at = ? WHERE user_id = ?""", (ADMIN_BONUS_SHIFT, ADMIN_BONUS_NOVA, now, user_id))
    conn.execute("INSERT OR IGNORE INTO user_stats (user_id, first_seen, last_seen) VALUES (?, ?, ?)", (user_id, now, now))
    conn.commit(); conn.close()

def _update_user_meta(user_id, username, first_name):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET username=?, first_name=? WHERE user_id=?", (username, first_name, user_id))
    conn.commit(); conn.close()

def wallet_get(user_id):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("""SELECT xp, shift, nova, custom_name, avatar_idx, free_name_changes, capsule_opened_at
        FROM wallet WHERE user_id=?""", (user_id,)).fetchone()
    conn.close()
    if not row:
        xp = shift = nova = 0; custom_name = None; avatar_idx = 0; free_name_changes = 0; capsule_opened_at = None
    else:
        xp, shift, nova, custom_name, avatar_idx, free_name_changes, capsule_opened_at = row
        xp = xp or 0; shift = shift or 0; nova = nova or 0; avatar_idx = avatar_idx or 0; free_name_changes = free_name_changes or 0
    if user_id == ADMIN_ID:
        if shift < ADMIN_BONUS_SHIFT or nova < ADMIN_BONUS_NOVA:
            conn = sqlite3.connect(DB_PATH)
            conn.execute("UPDATE wallet SET shift = MAX(shift, ?), nova = MAX(nova, ?) WHERE user_id = ?",
                (ADMIN_BONUS_SHIFT, ADMIN_BONUS_NOVA, user_id))
            conn.commit(); conn.close()
            shift = max(shift, ADMIN_BONUS_SHIFT); nova = max(nova, ADMIN_BONUS_NOVA)
    lvl, in_lvl, to_next = calc_level(xp)
    return {"xp": xp, "shift": shift, "nova": nova, "soft": shift, "hard": nova,
        "custom_name": custom_name, "avatar_idx": avatar_idx, "free_name_changes": free_name_changes,
        "capsule_opened_at": capsule_opened_at, "chest_opened_at": capsule_opened_at,
        "level": lvl, "level_title": level_title(lvl), "xp_in_level": in_lvl, "xp_to_next": to_next}

def wallet_add(user_id, xp=0, shift=0, nova=0):
    _ensure_user(user_id)
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE wallet SET xp = xp + ?, shift = shift + ?, nova = nova + ?, updated_at = ? WHERE user_id = ?",
        (int(xp), int(shift), int(nova), now, user_id))
    conn.commit(); conn.close()

def wallet_set_name(user_id, name):
    _ensure_user(user_id); name = (name or "").strip()
    if not name: name = None
    if name and len(name) > 24: name = name[:24]
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE wallet SET custom_name=?, updated_at=? WHERE user_id=?", (name, now, user_id))
    conn.commit(); conn.close()

def wallet_set_avatar(user_id, idx):
    _ensure_user(user_id); idx = max(0, min(int(idx), 11))
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE wallet SET avatar_idx=?, updated_at=? WHERE user_id=?", (idx, now, user_id))
    conn.commit(); conn.close()

def wallet_consume(user_id, currency, amount):
    if currency not in ("shift", "nova"): return False
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(f"SELECT {currency} FROM wallet WHERE user_id=?", (user_id,)).fetchone()
    if not row or (row[0] or 0) < amount:
        conn.close(); return False
    conn.execute(f"UPDATE wallet SET {currency} = {currency} - ? WHERE user_id=?", (amount, user_id))
    conn.commit(); conn.close()
    return True

def wallet_use_free_name(user_id):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT free_name_changes FROM wallet WHERE user_id=?", (user_id,)).fetchone()
    if not row or (row[0] or 0) <= 0:
        conn.close(); return False
    conn.execute("UPDATE wallet SET free_name_changes = free_name_changes - 1 WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()
    return True

def wallet_add_free_name(user_id):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE wallet SET free_name_changes = free_name_changes + 1 WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()

def wallet_leaderboard(limit=10):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""SELECT w.user_id, w.xp, COALESCE(w.custom_name, u.first_name, ''), COALESCE(u.username, '')
        FROM wallet w LEFT JOIN users u ON u.user_id = w.user_id WHERE w.xp > 0 ORDER BY w.xp DESC LIMIT ?""", (limit,)).fetchall()
    conn.close()
    return rows

def stats_update_streak(user_id):
    _ensure_user(user_id)
    now = _now_irkutsk(); today_str = now.strftime("%Y-%m-%d")
    yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT last_seen, streak FROM user_stats WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        conn.execute("INSERT OR REPLACE INTO user_stats (user_id, last_seen, streak, first_seen) VALUES (?, ?, 1, ?)",
            (user_id, today_str, now.isoformat()))
        conn.commit(); conn.close(); return 1
    last_seen, streak = row; streak = streak or 0
    if last_seen == today_str:
        conn.close(); return streak
    streak = streak + 1 if last_seen == yesterday_str else 1
    conn.execute("UPDATE user_stats SET last_seen=?, streak=? WHERE user_id=?", (today_str, streak, user_id))
    conn.commit(); conn.close()
    return streak

def stats_inc(user_id, field, by=1):
    _ensure_user(user_id)
    if field not in ("tasks_done", "notes_added"): return
    conn = sqlite3.connect(DB_PATH)
    conn.execute(f"UPDATE user_stats SET {field} = COALESCE({field}, 0) + ? WHERE user_id=?", (int(by), user_id))
    conn.commit(); conn.close()

def stats_get(user_id):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT tasks_done, notes_added, first_seen, last_seen, streak FROM user_stats WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    if not row: return {"tasks_done":0,"notes_added":0,"first_seen":None,"last_seen":None,"streak":0}
    return {"tasks_done": row[0] or 0, "notes_added": row[1] or 0, "first_seen": row[2], "last_seen": row[3], "streak": row[4] or 0}

def achievements_get(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT ach_id, unlocked_at FROM achievements WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}

def achievement_unlock(user_id, ach_id):
    if ach_id not in ACHIEVEMENTS: return False
    conn = sqlite3.connect(DB_PATH)
    if conn.execute("SELECT 1 FROM achievements WHERE user_id=? AND ach_id=?", (user_id, ach_id)).fetchone():
        conn.close(); return False
    conn.execute("INSERT INTO achievements (user_id, ach_id, unlocked_at) VALUES (?, ?, ?)",
        (user_id, ach_id, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()
    return True

def bs_count_wins(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT COUNT(*) FROM bs_games WHERE winner=? AND status='finished'", (user_id,)).fetchone()
    conn.close()
    return row[0] if row else 0

def check_and_award_achievements(user_id):
    newly = []
    wallet = wallet_get(user_id); stats = stats_get(user_id)
    def _unlock(aid):
        if not achievement_unlock(user_id, aid): return False
        newly.append(aid); return True
    _unlock("first_day")
    if stats["streak"] >= 7: _unlock("week_visit")
    if stats["notes_added"] >= 1: _unlock("first_note")
    if stats["tasks_done"] >= 1: _unlock("first_task")
    if stats["tasks_done"] >= 50: _unlock("prod_50")
    if wallet["level"] >= 30: _unlock("legend_30")
    try:
        grades = get_grades(user_id)
        if grades and len(grades) >= 3:
            avg = sum(g[2] for g in grades) / len(grades)
            if avg >= 5.0: _unlock("excellent")
    except: pass
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT game_id, best_score FROM game_scores WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    best = {r[0]: r[1] for r in rows}
    if best.get("flappy", 0) >= 30: _unlock("flappy_30")
    try:
        wins = bs_count_wins(user_id)
        if wins >= 1: _unlock("bs_first_win")
        if wins >= 5: _unlock("bs_5_wins")
        if wins >= 10: _unlock("bs_10_wins")
    except: pass
    conn = sqlite3.connect(DB_PATH)
    unlocked_rows = conn.execute("SELECT ach_id FROM achievements WHERE user_id=?", (user_id,)).fetchall()
    for (aid,) in unlocked_rows:
        rw = ACHIEVEMENT_REWARDS.get(aid)
        if not rw: continue
        if conn.execute("SELECT 1 FROM achievement_rewards WHERE user_id=? AND ach_id=?", (user_id, aid)).fetchone(): continue
        conn.execute("INSERT INTO achievement_rewards (user_id, ach_id, xp, shift, nova, granted_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, aid, rw["xp"], rw["shift"], rw["nova"], datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()
    return newly

def chest_status(user_id, chest_id="capsule"):
    chest = CHESTS.get(chest_id)
    if not chest: return {"can_open": False, "next_at": None, "last_opened": None}
    cooldown_h = chest.get("cooldown_h", 0)
    if cooldown_h <= 0: return {"can_open": True, "next_at": None, "last_opened": None}
    wallet = wallet_get(user_id); last = wallet.get("capsule_opened_at")
    can_open = True; next_at_iso = None
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.tzinfo is None: last_dt = last_dt.replace(tzinfo=timezone.utc)
            elapsed = datetime.now(timezone.utc) - last_dt
            if elapsed < timedelta(hours=cooldown_h):
                can_open = False; next_at_iso = (last_dt + timedelta(hours=cooldown_h)).isoformat()
        except: pass
    return {"can_open": can_open, "next_at": next_at_iso, "last_opened": last}

def chest_open(user_id, chest_id):
    chest = CHESTS.get(chest_id)
    if not chest: return None, "bad_chest"
    st = chest_status(user_id, chest_id)
    if not st["can_open"]: return None, "already_opened"
    cost_shift = chest.get("cost_shift", 0); cost_nova = chest.get("cost_nova", 0)
    wallet = wallet_get(user_id)
    if cost_shift > 0 and (wallet.get("shift") or 0) < cost_shift: return None, "not_enough_shift"
    if cost_nova > 0 and (wallet.get("nova") or 0) < cost_nova: return None, "not_enough_nova"
    if cost_shift > 0 and not wallet_consume(user_id, "shift", cost_shift): return None, "not_enough_shift"
    if cost_nova > 0 and not wallet_consume(user_id, "nova", cost_nova): return None, "not_enough_nova"
    reward = roll_chest_drop(chest_id)
    if not reward: return None, "roll_failed"
    if reward["type"] == "shift":
        wallet_add(user_id, shift=reward["amount"]); label = f"+{reward['amount']} Шифт"
    elif reward["type"] == "nova":
        wallet_add(user_id, nova=reward["amount"]); label = f"+{reward['amount']} Нова"
    elif reward["type"] == "xp":
        wallet_add(user_id, xp=reward["amount"]); label = f"+{reward['amount']} XP"
    else: label = "Пусто"
    if chest.get("cooldown_h", 0) > 0:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("UPDATE wallet SET capsule_opened_at=? WHERE user_id=?",
            (datetime.now(timezone.utc).isoformat(), user_id))
        conn.commit(); conn.close()
    return {"type": reward["type"], "amount": reward["amount"], "label": label, "chest": chest_id}, None

def level_rewards_claimed(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT level FROM level_rewards WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    return sorted([r[0] for r in rows])

def level_reward_claim(user_id, lvl):
    wallet = wallet_get(user_id)
    if lvl < 1 or lvl > 30: return None, "bad_level"
    if lvl > wallet["level"]: return None, "locked"
    conn = sqlite3.connect(DB_PATH)
    if conn.execute("SELECT 1 FROM level_rewards WHERE user_id=? AND level=?", (user_id, lvl)).fetchone():
        conn.close(); return None, "already"
    rw = LEVEL_REWARDS.get(lvl) or {"shift": 0, "nova": 0, "xp": 0}
    wallet_add(user_id, shift=rw.get("shift", 0), nova=rw.get("nova", 0), xp=rw.get("xp", 0))
    conn.execute("INSERT INTO level_rewards (user_id, level, claimed_at) VALUES (?, ?, ?)",
        (user_id, lvl, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()
    return rw, None

def game_get_scores(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT game_id, best_score, plays_count FROM game_scores WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    result = {gid: {"best": b or 0, "plays": p or 0} for gid, b, p in rows}
    for gid in GAMES:
        if gid not in result: result[gid] = {"best": 0, "plays": 0}
    return result

def game_save_score(user_id, game_id, score):
    if game_id not in GAMES: return None
    score = max(0, min(int(score), 99999))
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT best_score, plays_count FROM game_scores WHERE user_id=? AND game_id=?", (user_id, game_id)).fetchone()
    now = datetime.now(timezone.utc).isoformat()
    if row:
        old_best = row[0] or 0; plays = (row[1] or 0) + 1; new_best = max(old_best, score)
        conn.execute("UPDATE game_scores SET best_score=?, plays_count=?, updated_at=? WHERE user_id=? AND game_id=?",
            (new_best, plays, now, user_id, game_id))
        is_record = score > old_best
    else:
        new_best = score; plays = 1
        conn.execute("INSERT INTO game_scores (user_id, game_id, best_score, plays_count, updated_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, game_id, score, 1, now))
        is_record = score > 0
    conn.commit(); conn.close()
    return {"best": new_best, "is_record": is_record, "plays": plays}

def game_leaderboard(game_id, limit=10):
    if game_id not in GAMES: return []
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""SELECT g.user_id, g.best_score, COALESCE(u.first_name, ''), COALESCE(u.username, ''), COALESCE(w.custom_name, '')
        FROM game_scores g LEFT JOIN users u ON u.user_id = g.user_id LEFT JOIN wallet w ON w.user_id = g.user_id
        WHERE g.game_id = ? AND g.best_score > 0 ORDER BY g.best_score DESC LIMIT ?""", (game_id, limit)).fetchall()
    conn.close()
    return [(uid, score, custom_name or first_name or '', username) for uid, score, first_name, username, custom_name in rows]

def user_exists(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row is not None

def daily_subscribe(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO daily_subscribers (user_id, subscribed_at) VALUES (?, ?)",
        (user_id, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def daily_unsubscribe(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM daily_subscribers WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()

def daily_is_subscribed(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM daily_subscribers WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row is not None

def daily_get_all_subscribers():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id FROM daily_subscribers").fetchall()
    conn.close()
    return [r[0] for r in rows]

def set_scholarship_amount(user_id, amount):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO scholarship (user_id, current_amount, updated_at) VALUES (?, ?, ?)",
        (user_id, amount, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def get_scholarship_amount(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT current_amount FROM scholarship WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row[0] if row else None

def upsert_grade(user_id, subject, grade, is_auto=0, semester=None):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id FROM grades WHERE user_id=? AND LOWER(subject)=LOWER(?) AND COALESCE(semester,'')=COALESCE(?,'')",
        (user_id, subject, semester)).fetchone()
    if row:
        conn.execute("UPDATE grades SET grade=?, subject=?, is_auto=?, semester=?, created_at=? WHERE id=?",
            (grade, subject, int(bool(is_auto)), semester, datetime.now(timezone.utc).isoformat(), row[0]))
    else:
        conn.execute("INSERT INTO grades (user_id, subject, grade, is_auto, semester, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, subject, grade, int(bool(is_auto)), semester, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def get_grades(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, subject, grade, COALESCE(is_auto, 0), COALESCE(semester, '') FROM grades WHERE user_id=? ORDER BY subject", (user_id,)).fetchall()
    conn.close()
    return rows

def update_grade_by_id(grade_id, user_id, subject=None, grade=None, is_auto=None, semester=None):
    conn = sqlite3.connect(DB_PATH); fields = []; values = []
    if subject is not None: fields.append("subject=?"); values.append(subject)
    if grade is not None: fields.append("grade=?"); values.append(grade)
    if is_auto is not None: fields.append("is_auto=?"); values.append(int(bool(is_auto)))
    if semester is not None: fields.append("semester=?"); values.append(semester)
    if not fields: conn.close(); return
    values.extend([grade_id, user_id])
    conn.execute(f"UPDATE grades SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
    conn.commit(); conn.close()

def delete_grade(grade_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM grades WHERE id=? AND user_id=?", (grade_id, user_id))
    conn.commit(); conn.close()

def clear_grades(user_id, semester=None):
    conn = sqlite3.connect(DB_PATH)
    if semester: conn.execute("DELETE FROM grades WHERE user_id=? AND COALESCE(semester,'')=?", (user_id, semester))
    else: conn.execute("DELETE FROM grades WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()

def save_user_group(user_id, group_id, group_name):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET group_id=?, group_name=? WHERE user_id=?", (group_id, group_name, user_id))
    conn.commit(); conn.close()

def get_user_group(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT group_id, group_name FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row if row and row[0] else None

def delete_user_group(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET group_id=NULL, group_name=NULL, notify_hour=-1, notify_changes=0, subgroup=0, notify_type=NULL WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()

def set_user_subgroup(user_id, subgroup):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET subgroup=? WHERE user_id=?", (subgroup, user_id))
    conn.commit(); conn.close()

def get_user_subgroup(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT subgroup FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row[0] if row and row[0] else 0

def set_notify_changes(user_id, enabled):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET notify_changes=? WHERE user_id=?", (1 if enabled else 0, user_id))
    conn.commit(); conn.close()

def get_notify_changes(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_changes FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return bool(row and row[0])

def set_notify_settings(user_id, ntype, hour, minute):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET notify_type=?, notify_hour=?, notify_minute=? WHERE user_id=?", (ntype, hour, minute, user_id))
    conn.commit(); conn.close()

def get_notify_settings(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_type, notify_hour, notify_minute FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    if row and row[0]:
        return {"type": row[0], "hour": row[1] if row[1] is not None else 0, "minute": row[2] if row[2] is not None else 0}
    return None

def set_notify_before_min(user_id, minutes):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET notify_before_min=? WHERE user_id=?", (int(minutes), user_id))
    conn.commit(); conn.close()

def get_notify_before_min(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_before_min FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return int(row[0]) if row and row[0] is not None else 0

def get_users_for_notification():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id, group_id, subgroup, notify_type, notify_hour, notify_minute FROM users WHERE notify_type IS NOT NULL AND notify_type != '' AND notify_hour >= 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
    conn.close()
    return rows

def get_users_for_change_tracking():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id, group_id, subgroup FROM users WHERE notify_changes=1 AND group_id IS NOT NULL AND group_id != ''").fetchall()
    conn.close()
    return rows

def get_users_for_lesson_reminder():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id, group_id, subgroup, notify_before_min FROM users WHERE notify_before_min > 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
    conn.close()
    return rows

def get_total_users():
    conn = sqlite3.connect(DB_PATH)
    n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn.close()
    return n

def get_all_user_ids():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id FROM users").fetchall()
    conn.close()
    return [r[0] for r in rows]

def is_vip(user_id): return True

def get_cached_schedule(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT html, cached_at FROM schedule_cache WHERE group_id=? AND week_start=?", (group_id, week_start)).fetchone()
    conn.close()
    if not row: return None
    html, cached_at = row
    try:
        if datetime.now(timezone.utc) - datetime.fromisoformat(cached_at) < timedelta(hours=CACHE_TTL_HOURS): return html
    except: pass
    return None

def save_cached_schedule(group_id, week_start, html):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO schedule_cache VALUES (?, ?, ?, ?)",
        (group_id, week_start, html, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def save_snapshot(group_id, week_start, snapshot_str):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO schedule_snapshots (group_id, week_start, snapshot, updated_at) VALUES (?, ?, ?, ?)",
        (group_id, week_start, snapshot_str, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def get_snapshot(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT snapshot FROM schedule_snapshots WHERE group_id=? AND week_start=?", (group_id, week_start)).fetchone()
    conn.close()
    return row[0] if row else None

def make_snapshot_str(days):
    parts = []
    for d in days:
        day_key = d.get("date", "")
        for les in d.get("lessons", []):
            parts.append(f"{day_key}|{les.get('time','')}|{les.get('subject','')}|{les.get('type','')}|{les.get('teacher','')}|{les.get('auditorium','')}|{les.get('subgroup','')}")
    return "\n".join(sorted(parts))

def save_feedback(user_id, username, text, admin_msg_id=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute("INSERT INTO feedback (user_id, username, text, created_at, admin_msg_id, status) VALUES (?, ?, ?, ?, ?, 'new')",
        (user_id, username, text, datetime.now(timezone.utc).isoformat(), admin_msg_id))
    fid = cur.lastrowid
    conn.commit(); conn.close()
    return fid

def update_feedback_admin_msg(feedback_id, admin_msg_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET admin_msg_id=? WHERE id=?", (admin_msg_id, feedback_id))
    conn.commit(); conn.close()

def get_pending_feedback():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, user_id, username, text, created_at, COALESCE(status,'new') FROM feedback WHERE COALESCE(status,'new') IN ('new', 'postponed') ORDER BY CASE COALESCE(status,'new') WHEN 'new' THEN 0 ELSE 1 END, id DESC").fetchall()
    conn.close()
    return rows

def set_feedback_status(feedback_id, status):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET status=? WHERE id=?", (status, feedback_id))
    conn.commit(); conn.close()

def mark_feedback_answered(feedback_id, reply_text=None):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET status='answered', answered_at=?, admin_reply=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), reply_text, feedback_id))
    conn.commit(); conn.close()

def get_feedback_by_id(feedback_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, user_id, username, text FROM feedback WHERE id=?", (feedback_id,)).fetchone()
    conn.close()
    return row

def get_user_feedback(user_id, limit=30):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, text, COALESCE(status,'new'), created_at, answered_at, admin_reply FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, limit)).fetchall()
    conn.close()
    return rows

def add_task(user_id, text, due_date=None, priority=2, due_time=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute("INSERT INTO tasks (user_id, text, due_date, done, created_at, priority, due_time) VALUES (?, ?, ?, 0, ?, ?, ?)",
        (user_id, text, due_date, datetime.now(timezone.utc).isoformat(), priority, due_time))
    tid = cur.lastrowid
    conn.commit(); conn.close()
    return tid

def update_task(task_id, user_id, text=None, due_date=None, priority=None, due_time=None, reset_due=False):
    conn = sqlite3.connect(DB_PATH); fields = []; values = []
    if text is not None: fields.append("text=?"); values.append(text)
    if reset_due: fields.append("due_date=NULL"); fields.append("due_time=NULL")
    else:
        if due_date is not None: fields.append("due_date=?"); values.append(due_date)
        if due_time is not None: fields.append("due_time=?"); values.append(due_time)
    if priority is not None: fields.append("priority=?"); values.append(priority)
    if not fields: conn.close(); return
    values.extend([task_id, user_id])
    conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
    conn.commit(); conn.close()

def get_task(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, text, due_date, done, created_at, priority, due_time, done_at FROM tasks WHERE id=? AND user_id=?",
        (task_id, user_id)).fetchone()
    conn.close()
    return row

def get_user_tasks(user_id, only_active=True):
    conn = sqlite3.connect(DB_PATH)
    if only_active:
        rows = conn.execute("SELECT id, text, due_date, done, created_at, priority, due_time FROM tasks WHERE user_id=? AND done=0", (user_id,)).fetchall()
    else:
        rows = conn.execute("SELECT id, text, due_date, done, created_at, priority, due_time FROM tasks WHERE user_id=? ORDER BY id DESC", (user_id,)).fetchall()
    conn.close()
    return rows

def get_done_tasks(user_id, days=7):
    conn = sqlite3.connect(DB_PATH)
    threshold = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = conn.execute("SELECT id, text, due_date, done, created_at, priority, due_time, done_at FROM tasks WHERE user_id=? AND done=1 AND done_at IS NOT NULL AND done_at >= ? ORDER BY done_at DESC",
        (user_id, threshold)).fetchall()
    conn.close()
    return rows

def mark_task_done(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE tasks SET done=1, done_at=? WHERE id=? AND user_id=?",
        (datetime.now(timezone.utc).isoformat(), task_id, user_id))
    conn.commit(); conn.close()

def delete_task(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))
    conn.commit(); conn.close()

def clear_done_tasks(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE user_id=? AND done=1", (user_id,))
    conn.commit(); conn.close()

def count_user_tasks(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT SUM(CASE WHEN done=0 THEN 1 ELSE 0 END), SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) FROM tasks WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return (row[0] or 0, row[1] or 0)

def add_or_update_note(user_id, subject, text):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id FROM notes WHERE user_id=? AND LOWER(subject)=LOWER(?)", (user_id, subject)).fetchone()
    if row:
        conn.execute("UPDATE notes SET text=?, created_at=? WHERE id=?",
            (text, datetime.now(timezone.utc).isoformat(), row[0]))
    else:
        conn.execute("INSERT INTO notes (user_id, subject, text, created_at) VALUES (?, ?, ?, ?)",
            (user_id, subject, text, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def get_user_notes(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, subject, text FROM notes WHERE user_id=? ORDER BY subject", (user_id,)).fetchall()
    conn.close()
    return rows

def delete_note_by_id(note_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    conn.commit(); conn.close()

def attendance_set(user_id, date, time, subject, status):
    if status not in ("", "was", "missed", "sick", "excused"): return False
    conn = sqlite3.connect(DB_PATH)
    if status:
        conn.execute("INSERT INTO attendance (user_id, date, time, subject, status, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date, time, subject) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at",
            (user_id, date, time, subject, status, datetime.now(timezone.utc).isoformat()))
    else:
        conn.execute("DELETE FROM attendance WHERE user_id=? AND date=? AND time=? AND subject=?", (user_id, date, time, subject))
    conn.commit(); conn.close()
    return True

def attendance_get_map(user_id, dates):
    if not dates: return {}
    conn = sqlite3.connect(DB_PATH)
    placeholders = ",".join("?" * len(dates))
    rows = conn.execute(f"SELECT date, time, subject, status FROM attendance WHERE user_id=? AND date IN ({placeholders})",
        (user_id, *dates)).fetchall()
    conn.close()
    return {(d, t, s): st for d, t, s, st in rows}

def attendance_stats(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT status, COUNT(*) FROM attendance WHERE user_id=? GROUP BY status", (user_id,)).fetchall()
    conn.close()
    result = {"was": 0, "missed": 0, "sick": 0, "excused": 0}
    for status, count in rows:
        if status in result: result[status] = count
    return result

def ai_get_history(user_id, limit=30):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, role, text, has_photo, created_at FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT ?", (user_id, limit)).fetchall()
    conn.close()
    rows.reverse()
    return rows

def ai_save_message(user_id, role, text, has_photo=0):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT INTO ai_messages (user_id, role, text, has_photo, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, role, text or '', int(bool(has_photo)), datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()

def ai_clear_history(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM ai_messages WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()

def get_export_data(user_id):
    saved = get_user_group(user_id)
    tasks = get_user_tasks(user_id, only_active=False)
    notes = get_user_notes(user_id)
    grades = get_grades(user_id)
    amount = get_scholarship_amount(user_id)
    feedback = get_user_feedback(user_id, limit=100)
    att = attendance_stats(user_id)
    conn = sqlite3.connect(DB_PATH)
    meta = conn.execute("SELECT username, first_name FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    username = meta[0] if meta else None; first_name = meta[1] if meta else None
    return {"exported_at": datetime.now(timezone.utc).isoformat(), "user_id": user_id,
        "username": username, "first_name": first_name,
        "group": saved[1] if saved else None, "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id), "scholarship_amount": amount,
        "tasks": [{"id": t[0], "text": t[1], "due_date": t[2], "done": bool(t[3]), "priority": t[5], "due_time": t[6]} for t in tasks],
        "notes": [{"id": n[0], "subject": n[1], "text": n[2]} for n in notes],
        "grades": [{"id": g[0], "subject": g[1], "grade": g[2], "is_auto": bool(g[3]), "semester": g[4]} for g in grades],
        "feedback": [{"id": f[0], "text": f[1], "status": f[2], "created_at": f[3], "answered_at": f[4], "admin_reply": f[5]} for f in feedback],
        "attendance": att}

def _bs_now(): return datetime.now(timezone.utc).isoformat()
def _bs_new_game_id(): return secrets.token_hex(8)

def _bs_new_code():
    for _ in range(50):
        code = f"{random.randint(100000, 999999)}"
        conn = sqlite3.connect(DB_PATH)
        row = conn.execute("SELECT 1 FROM bs_games WHERE code=? AND status IN ('waiting','placing','playing')", (code,)).fetchone()
        conn.close()
        if not row: return code
    return f"{random.randint(100000, 999999)}"

def _bs_validate_ships(ships):
    if not ships or not isinstance(ships, list): return False
    required = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]
    if sorted([s.get("size") for s in ships], reverse=True) != required: return False
    occupied = set()
    for s in ships:
        cells = s.get("cells", [])
        if len(cells) != s.get("size"): return False
        xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
        if min(xs) < 0 or max(xs) > 9 or min(ys) < 0 or max(ys) > 9: return False
        if len(set(xs)) > 1 and len(set(ys)) > 1: return False
        sc = sorted(cells, key=lambda c: (c[1], c[0]))
        for i in range(1, len(sc)):
            if abs(sc[i-1][0] - sc[i][0]) + abs(sc[i-1][1] - sc[i][1]) != 1: return False
        for x, y in cells:
            if (x, y) in occupied: return False
            occupied.add((x, y))
    return True

def _bs_check_win(ships, shots):
    if not ships: return False
    all_cells = {(c[0], c[1]) for s in ships for c in s["cells"]}
    hit_cells = {(sh.get("x"), sh.get("y")) for sh in shots}
    return all_cells.issubset(hit_cells)

def _bs_get_game(game_id):
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM bs_games WHERE game_id=?", (game_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def _bs_get_game_by_code(code):
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM bs_games WHERE code=? AND status IN ('waiting','placing','playing') ORDER BY created_at DESC LIMIT 1", (code,)).fetchone()
    conn.close()
    return dict(row) if row else None

def _bs_update_game(game_id, **fields):
    if not fields: return
    fields["updated_at"] = _bs_now()
    keys = ", ".join(f"{k}=?" for k in fields.keys())
    values = list(fields.values()) + [game_id]
    conn = sqlite3.connect(DB_PATH)
    conn.execute(f"UPDATE bs_games SET {keys} WHERE game_id=?", values)
    conn.commit(); conn.close()

def _bs_delete_game(game_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM bs_games WHERE game_id=?", (game_id,))
    conn.commit(); conn.close()

def _bs_player_side(game, user_id):
    if game["p1_id"] == user_id: return 1
    if game["p2_id"] == user_id: return 2
    return 0

def _bs_user_in_active_game(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT game_id FROM bs_games WHERE (p1_id=? OR p2_id=?) AND status IN ('waiting','placing','playing') LIMIT 1", (user_id, user_id)).fetchone()
    conn.close()
    return row[0] if row else None

def _bs_get_user_name(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT COALESCE(custom_name, first_name, username, 'Игрок') FROM wallet w LEFT JOIN users u ON u.user_id = w.user_id WHERE w.user_id=?", (user_id,)).fetchone()
    conn.close()
    return row[0] if row and row[0] else f"Игрок-{str(user_id)[-4:]}"

def _bs_finish_game(game_id, winner_id, surrender_by=0):
    game = _bs_get_game(game_id)
    if not game or game["status"] == "finished": return
    bet = game["bet"] or 0
    if winner_id == 0:
        if game["p1_id"]: wallet_add(game["p1_id"], shift=bet)
        if game["p2_id"]: wallet_add(game["p2_id"], shift=bet)
        _bs_update_game(game_id, status="finished", winner=0, surrender_by=surrender_by)
        return
    wallet_add(winner_id, shift=bet * 2, xp=50)
    _bs_update_game(game_id, status="finished", winner=winner_id, surrender_by=surrender_by)

def _bs_cancel_any_waiting(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT game_id, bet FROM bs_games WHERE p1_id=? AND status='waiting' AND (p2_id IS NULL OR p2_id=0)", (user_id,)).fetchall()
    conn.close()
    for game_id, bet in rows:
        wallet_add(user_id, shift=bet or 0)
        _bs_delete_game(game_id)

def _bs_cleanup_stale_games():
    threshold = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT game_id, p1_id, p2_id, bet FROM bs_games WHERE status IN ('waiting','placing','playing') AND created_at < ?", (threshold,)).fetchall()
    conn.close()
    for game_id, p1_id, p2_id, bet in rows:
        if p1_id: wallet_add(p1_id, shift=bet or 0)
        if p2_id: wallet_add(p2_id, shift=bet or 0)
        _bs_delete_game(game_id)

def exchange_shift_to_nova(user_id, amount_shift):
    try: amount_shift = int(amount_shift)
    except: return None
    if amount_shift <= 0: return None
    amount_nova = amount_shift // EXCHANGE_RATE_SHIFT_TO_NOVA
    if amount_nova <= 0: return None
    if not wallet_consume(user_id, "shift", amount_nova * EXCHANGE_RATE_SHIFT_TO_NOVA): return None
    wallet_add(user_id, nova=amount_nova)
    achievement_unlock(user_id, "exchange_1")
    rw = ACHIEVEMENT_REWARDS.get("exchange_1")
    if rw: wallet_add(user_id, xp=rw["xp"], shift=rw["shift"], nova=rw["nova"])
    return {"soft_spent": amount_nova * EXCHANGE_RATE_SHIFT_TO_NOVA, "shift_spent": amount_nova * EXCHANGE_RATE_SHIFT_TO_NOVA,
        "hard_received": amount_nova, "nova_received": amount_nova}

# === GROUPS_ЗДЕСЬ ===
GROUPS = {
    "ИАМиТ": [
        {"name": "АСПм-26-1", "id": "478012"}, {"name": "АТПРб-26-1", "id": "478049"},
        {"name": "ЛИМб-26-1", "id": "478284"}, {"name": "МИРб-26-1", "id": "478310"},
        {"name": "ММб-26-1", "id": "478314"}, {"name": "МТб-26-1", "id": "478318"},
        {"name": "ППТм-26-1", "id": "478441"}, {"name": "СДМ-26-1", "id": "478478"},
        {"name": "СМ-26-1", "id": "478493"}, {"name": "СМ-26-2", "id": "478494"},
        {"name": "СМ-26-3", "id": "479896"}, {"name": "ТЭАм-26-1", "id": "478548"},
        {"name": "УКб-26-1", "id": "478551"}, {"name": "ЦПКм-26-1", "id": "478601"},
        {"name": "ЭЛб-26-1", "id": "478640"},
        {"name": "АСПм-25-1", "id": "478011"}, {"name": "АТПРб-25-1", "id": "478048"},
        {"name": "ЛИМб-25-1", "id": "478283"}, {"name": "ЛМБм-25-1", "id": "478290"},
        {"name": "МИРб-25-1", "id": "478309"}, {"name": "ММб-25-1", "id": "478313"},
        {"name": "МТб-25-1", "id": "478317"}, {"name": "ППТм-25-1", "id": "478440"},
        {"name": "СДМ-25-1", "id": "478477"}, {"name": "СМ-25-1", "id": "478491"},
        {"name": "СМ-25-2", "id": "478492"}, {"name": "ТЭАм-25-1", "id": "478547"},
        {"name": "УКб-25-1", "id": "478550"}, {"name": "УПКм-25-1", "id": "478558"},
        {"name": "ЦПКм-25-1", "id": "478600"}, {"name": "ЭЛб-25-1", "id": "478639"},
        {"name": "АТПРб-24-1", "id": "478047"}, {"name": "ЛИМб-24-1", "id": "478282"},
        {"name": "МИРб-24-1", "id": "478308"}, {"name": "ММб-24-1", "id": "478312"},
        {"name": "МТб-24-1", "id": "478316"}, {"name": "СМ-24-1", "id": "478489"},
        {"name": "СМ-24-2", "id": "478490"}, {"name": "ТСЧс-24-1", "id": "478541"},
        {"name": "ЭЛб-24-1", "id": "478638"},
        {"name": "АСб-23-1", "id": "478008"}, {"name": "АТПРб-23-1", "id": "478046"},
        {"name": "ЛИМб-23-1", "id": "478281"}, {"name": "МИРб-23-1", "id": "478307"},
        {"name": "ММб-23-1", "id": "478311"}, {"name": "МТб-23-1", "id": "478315"},
        {"name": "СМ-23-1", "id": "478487"}, {"name": "СМ-23-2", "id": "478488"},
        {"name": "ТСЧс-23-1", "id": "478540"}, {"name": "УКб-23-1", "id": "478549"},
        {"name": "ЭЛб-23-1", "id": "478637"},
        {"name": "СМ-22-1", "id": "478485"}, {"name": "СМ-22-2", "id": "478486"},
    ],
    "Аспирантура": [
        {"name": "аАУП-26-1", "id": "477932"}, {"name": "аБЗТ-26-1", "id": "477934"},
        {"name": "аБПП-26-1", "id": "477936"}, {"name": "аБТХ-26-1", "id": "477937"},
        {"name": "аВДС-26-1", "id": "477939"}, {"name": "аГГ-26-1", "id": "477940"},
        {"name": "аГГМ-26-1", "id": "477942"}, {"name": "аГНГ-26-1", "id": "477946"},
        {"name": "аГНП-26-1", "id": "477948"}, {"name": "аДВЛ-26-1", "id": "477955"},
        {"name": "аМВ-26-1", "id": "477977"}, {"name": "аМЕТ-26-1", "id": "477979"},
        {"name": "аММП-26-1", "id": "479885"}, {"name": "аМН-26-1", "id": "477982"},
        {"name": "аНСкгм-26-1", "id": "477987"}, {"name": "аНСдсм-26-1", "id": "477986"},
        {"name": "аОБП-26-1", "id": "477989"}, {"name": "аОХМ-26-1", "id": "477990"},
        {"name": "аПБ-26-1", "id": "477991"}, {"name": "аРЭоэ-26-1", "id": "478006"},
        {"name": "аРЭс-26-1", "id": "478007"}, {"name": "аСМХ-26-1", "id": "478010"},
        {"name": "аССП-26-1", "id": "478013"}, {"name": "аСТМ-26-1", "id": "478014"},
        {"name": "аТАРР-26-1", "id": "478029"}, {"name": "аТМД-26-1", "id": "478031"},
        {"name": "аТМН-26-1", "id": "478033"}, {"name": "аТОС-26-1", "id": "478035"},
        {"name": "аТПС-26-1", "id": "478051"}, {"name": "аТПСК-26-1", "id": "478053"},
        {"name": "аТТГР-26-1", "id": "478055"}, {"name": "аТХВ-26-1", "id": "478056"},
        {"name": "аУПП-26-1", "id": "478057"}, {"name": "аУСТ-26-1", "id": "478061"},
        {"name": "аФХМ-26-1", "id": "478062"}, {"name": "аХТВ-26-1", "id": "478064"},
        {"name": "аЭКЛ-26-1", "id": "478066"}, {"name": "аЭКО-26-1", "id": "478068"},
        {"name": "аЭКС-26-1", "id": "478070"}, {"name": "аЭНК-26-1", "id": "478072"},
        {"name": "аЭТРд-26-1", "id": "478073"}, {"name": "аЭТРоп-26-1", "id": "478075"},
        {"name": "аЭЭН-26-1", "id": "478077"},
        {"name": "аАУП-24-1", "id": "477931"}, {"name": "аБЭТ-24-1", "id": "477933"},
        {"name": "аБПП-24-1", "id": "477935"}, {"name": "аВДС-24-1", "id": "477938"},
        {"name": "аГКЛ-24-1", "id": "477945"}, {"name": "аГКгис-24-1", "id": "477943"},
        {"name": "аГНП-24-1", "id": "477947"}, {"name": "аГФЗ-24-1", "id": "477949"},
        {"name": "аГГМ-24-1", "id": "477941"}, {"name": "аИСНТ-24-1", "id": "477975"},
        {"name": "аМВ-24-1", "id": "477976"}, {"name": "аМЕТ-24-1", "id": "477978"},
        {"name": "аММП-24-1", "id": "477980"}, {"name": "аМН-24-1", "id": "477981"},
        {"name": "аОБП-24-1", "id": "477988"}, {"name": "аПМФ-24-1", "id": "477992"},
        {"name": "аППН-24-1", "id": "477993"}, {"name": "аРТХ-24-1", "id": "478004"},
        {"name": "аРЭ-24-1", "id": "478005"}, {"name": "аСМХ-24-1", "id": "478009"},
        {"name": "аТАРР-24-1", "id": "478028"}, {"name": "аТМД-24-1", "id": "478030"},
        {"name": "аТМН-24-1", "id": "478032"}, {"name": "аТОС-24-1", "id": "478034"},
        {"name": "аТПС-24-1", "id": "478050"}, {"name": "аТПСК-24-1", "id": "478052"},
        {"name": "аТТГР-24-1", "id": "478054"}, {"name": "аУППоп-24-1", "id": "478058"},
        {"name": "аУППс-24-1", "id": "478059"}, {"name": "аУСТ-24-1", "id": "478060"},
        {"name": "аХТВ-24-1", "id": "478063"}, {"name": "аЭКЛ-24-1", "id": "478065"},
        {"name": "аЭКО-24-1", "id": "478067"}, {"name": "аЭКС-24-1", "id": "478069"},
        {"name": "аЭНК-24-1", "id": "478071"}, {"name": "аЭТРоп-24-1", "id": "478074"},
        {"name": "аЭЭН-24-1", "id": "478076"}, {"name": "аЗКМ-24-1", "id": "477958"},
    ],
    "БРИКС": [
        {"name": "ВЗАм-26-1", "id": "478105"}, {"name": "ИИКб-26-1", "id": "478215"},
        {"name": "ИИКб-26-2", "id": "479891"}, {"name": "КБКб-26-1", "id": "478251"},
        {"name": "ЛБКб-26-1", "id": "478279"}, {"name": "ЛБКб-26-2", "id": "478280"},
        {"name": "МДБб-26-1", "id": "478306"}, {"name": "РКИб-26-1", "id": "478455"},
        {"name": "РКИб-26-2", "id": "478456"}, {"name": "СПРКм-26-1", "id": "479947"},
        {"name": "УЛм-26-1", "id": "479898"}, {"name": "ФНб-26-1", "id": "478580"},
        {"name": "ЦТм-26-1", "id": "478605"}, {"name": "ЭПАб-26-1", "id": "478654"},
        {"name": "ЭЗТм-26-1", "id": "478632"},
        {"name": "ИИКб-25-1", "id": "478213"}, {"name": "ИИКб-25-2", "id": "478214"},
        {"name": "КБКб-25-1", "id": "478250"}, {"name": "ЛБКб-25-1", "id": "478277"},
        {"name": "ЛБКб-25-2", "id": "478278"}, {"name": "МДБб-25-1", "id": "478305"},
        {"name": "РКИб-25-1", "id": "478451"}, {"name": "РКИб-25-2", "id": "478452"},
        {"name": "РКИб-25-3", "id": "478453"}, {"name": "РКИб-25-4", "id": "478454"},
        {"name": "УЛм-25-1", "id": "478552"}, {"name": "ФНб-25-1", "id": "478579"},
        {"name": "ЦТм-25-1", "id": "478604"}, {"name": "ЭПАб-25-1", "id": "478653"},
        {"name": "ЖКб-24-1", "id": "478195"}, {"name": "ИИКб-24-1", "id": "478212"},
        {"name": "КБКб-24-1", "id": "478249"}, {"name": "ЛБКб-24-1", "id": "478275"},
        {"name": "ЛБКб-24-2", "id": "478276"}, {"name": "МДБб-24-1", "id": "478304"},
        {"name": "ФНб-24-1", "id": "478578"}, {"name": "ЭПАб-24-1", "id": "478652"},
        {"name": "ЖКб-23-1", "id": "478194"}, {"name": "ИИКб-23-1", "id": "478211"},
        {"name": "ЛБКб-23-1", "id": "478274"}, {"name": "МДБб-23-1", "id": "478303"},
        {"name": "ФНб-23-1", "id": "478577"}, {"name": "ЭПАб-23-1", "id": "478651"},
    ],
    "ДЛРЯ": [
        {"name": "ИНС-26-1", "id": "479936"}, {"name": "ИНС-26-2", "id": "479937"},
        {"name": "ИНС-26-3", "id": "479938"}, {"name": "ИНС-26-4", "id": "479939"},
        {"name": "ИНС-26-5", "id": "479940"}, {"name": "ИНС-26-6", "id": "479941"},
        {"name": "ИНСм-26-1", "id": "479942"}, {"name": "ИНСм-26-2", "id": "479943"},
        {"name": "ИНСм-26-3", "id": "479944"},
        {"name": "ИНС-25-3", "id": "479856"}, {"name": "ИНС-25-6", "id": "479859"},
        {"name": "ИНС-25-7", "id": "479860"}, {"name": "ИНСМ-25-2", "id": "479864"},
        {"name": "ИНСМ-25-3", "id": "479865"},
    ],
    "ССГ": [
        {"name": "ГИИм-26-1", "id": "478127"}, {"name": "ИТГб-26-1", "id": "478243"},
        {"name": "РМ-26-1", "id": "478460"}, {"name": "РФ-26-1", "id": "478476"},
        {"name": "ЦГФм-26-1", "id": "478599"},
        {"name": "ГИС-25-1", "id": "478129"}, {"name": "ИТТб-25-1", "id": "478242"},
        {"name": "РГ-25-1", "id": "478443"},
        {"name": "РМ-24-1", "id": "478459"}, {"name": "РФ-24-1", "id": "478475"},
        {"name": "ГИС-23-1", "id": "478128"}, {"name": "РГ-23-1", "id": "478442"},
        {"name": "РМ-23-1", "id": "478458"}, {"name": "РФ-23-1", "id": "478474"},
        {"name": "РМ-22-1", "id": "478457"}, {"name": "РФ-22-1", "id": "478473"},
    ],
    "ИАСиД": [
        {"name": "АД-26-1", "id": "477954"}, {"name": "АДм-26-1", "id": "477957"},
        {"name": "АРб-26-1", "id": "478002"}, {"name": "АРб-26-2", "id": "478003"},
        {"name": "ВВб-26-1", "id": "478101"}, {"name": "ВВм-26-1", "id": "478102"},
        {"name": "ГРб-26-1", "id": "478173"}, {"name": "ГРм-26-1", "id": "478175"},
        {"name": "ГСХб-26-1", "id": "478179"}, {"name": "ГСХм-26-1", "id": "478181"},
        {"name": "ДИб-26-1", "id": "479888"}, {"name": "ДСб-26-1", "id": "478192"},
        {"name": "ДСб-26-2", "id": "478193"}, {"name": "КНб-26-1", "id": "478255"},
        {"name": "НТЗм-26-1", "id": "478411"}, {"name": "ОТКм-26-1", "id": "478429"},
        {"name": "ПГСб-26-1", "id": "478436"}, {"name": "РРб-26-1", "id": "478465"},
        {"name": "СНГб-26-1", "id": "478501"}, {"name": "ССЭм-26-1", "id": "478503"},
        {"name": "СУЗ-26-1", "id": "478519"}, {"name": "ТГПм-26-1", "id": "478524"},
        {"name": "ТМПм-26-1", "id": "478536"}, {"name": "УСТб-26-1", "id": "478563"},
        {"name": "УСТм-26-1", "id": "478565"}, {"name": "УСТмз-26-1", "id": "479899"},
        {"name": "ЭУНб-26-1", "id": "478714"},
        {"name": "АД-25-1", "id": "477953"}, {"name": "ГРм-25-1", "id": "478174"},
        {"name": "ДСб-25-2", "id": "478191"}, {"name": "РРб-25-1", "id": "478464"},
        {"name": "ТТВм-25-1", "id": "478522"}, {"name": "АДм-25-1", "id": "477956"},
        {"name": "ГСХм-25-1", "id": "478178"}, {"name": "КНб-25-1", "id": "478254"},
        {"name": "СНГб-25-1", "id": "478500"}, {"name": "ТГПм-25-1", "id": "478523"},
        {"name": "ЦУОКсм-25-1", "id": "478607"}, {"name": "АРб-25-1", "id": "478000"},
        {"name": "ССЗм-25-1", "id": "478502"}, {"name": "ТМПм-25-1", "id": "478535"},
        {"name": "ЭУНб-25-1", "id": "478713"}, {"name": "АРб-25-2", "id": "478001"},
        {"name": "ДИб-25-1", "id": "478186"}, {"name": "ОТКм-25-1", "id": "478428"},
        {"name": "СУЗ-25-1", "id": "478518"}, {"name": "УСТб-25-1", "id": "478562"},
        {"name": "ГРб-25-1", "id": "478172"}, {"name": "ДСб-25-1", "id": "478190"},
        {"name": "ПГСб-25-1", "id": "478435"}, {"name": "ТБб-25-1", "id": "478521"},
        {"name": "УСТм-25-1", "id": "478564"},
        {"name": "АД-24-1", "id": "477952"}, {"name": "ГСХб-24-1", "id": "478177"},
        {"name": "МД-24-1", "id": "478302"}, {"name": "УСТб-24-1", "id": "478561"},
        {"name": "АРб-24-1", "id": "477998"}, {"name": "ДИб-24-1", "id": "478185"},
        {"name": "ПГСб-24-1", "id": "478434"}, {"name": "АРб-24-2", "id": "477999"},
        {"name": "ДИб-24-2", "id": "478184"}, {"name": "РРб-24-1", "id": "478463"},
        {"name": "ЭУНб-24-1", "id": "478712"}, {"name": "ВВб-24-1", "id": "478100"},
        {"name": "ДСб-24-1", "id": "478189"}, {"name": "СНГб-24-1", "id": "478499"},
        {"name": "ГРб-24-1", "id": "478171"}, {"name": "КНб-24-1", "id": "478253"},
        {"name": "СУЗ-24-1", "id": "478517"},
        {"name": "АД-23-1", "id": "477951"}, {"name": "ДИб-23-1", "id": "478182"},
        {"name": "ПГСб-23-1", "id": "478433"}, {"name": "УСТб-23-1", "id": "478560"},
        {"name": "АРб-23-1", "id": "477996"}, {"name": "ДИб-23-2", "id": "478183"},
        {"name": "РРб-23-1", "id": "478462"}, {"name": "ЭУНб-23-1", "id": "478711"},
        {"name": "АРб-23-2", "id": "477997"}, {"name": "ДСб-23-1", "id": "478188"},
        {"name": "СНГб-23-1", "id": "478498"}, {"name": "ГРб-23-1", "id": "478170"},
        {"name": "КНб-23-1", "id": "478252"}, {"name": "СУЗ-23-1", "id": "478516"},
        {"name": "ГСХб-23-1", "id": "478176"}, {"name": "МД-23-1", "id": "478301"},
        {"name": "ТБб-23-1", "id": "478520"},
        {"name": "АД-22-1", "id": "477950"}, {"name": "ДСб-22-1", "id": "478187"},
        {"name": "АРб-22-1", "id": "477994"}, {"name": "МД-22-1", "id": "478300"},
        {"name": "АРб-22-2", "id": "477995"}, {"name": "РРб-22-1", "id": "478461"},
        {"name": "ГРб-22-1", "id": "478168"}, {"name": "СУЗ-22-1", "id": "478515"},
        {"name": "ГРб-22-2", "id": "478169"},
        {"name": "МД-21-1", "id": "478299"}, {"name": "СУЗ-21-1", "id": "478514"},
    ],
    "ИВТ": [
        {"name": "АМПб-26-1", "id": "477984"}, {"name": "АТПб-26-1", "id": "478040"},
        {"name": "АТПб-26-2", "id": "479886"}, {"name": "БТб-26-1", "id": "478096"},
        {"name": "БТб-26-2", "id": "478097"}, {"name": "ИНОм-26-1", "id": "478222"},
        {"name": "ИРб-26-1", "id": "478226"}, {"name": "ИФб-26-1", "id": "478247"},
        {"name": "МЦб-26-1", "id": "478327"}, {"name": "МЦм-26-1", "id": "478336"},
        {"name": "МЦТб-26-1", "id": "478339"}, {"name": "МХТб-26-1", "id": "478324"},
        {"name": "НХПм-26-1", "id": "478412"}, {"name": "ОХФм-26-1", "id": "478431"},
        {"name": "ПИм-26-1", "id": "478438"}, {"name": "РДб-26-1", "id": "478447"},
        {"name": "РТУм-26-1", "id": "478472"}, {"name": "ХПм-26-1", "id": "478582"},
        {"name": "ХТм-26-1", "id": "478590"}, {"name": "ХТОб-26-1", "id": "478594"},
        {"name": "ХТТб-26-1", "id": "478598"},
        {"name": "ИФб-25-1", "id": "478246"}, {"name": "ПИм-25-1", "id": "478437"},
        {"name": "ХТТб-25-1", "id": "478597"}, {"name": "АТПб-25-1", "id": "478038"},
        {"name": "РДб-25-1", "id": "478446"}, {"name": "ХТм-25-1", "id": "478589"},
        {"name": "БТб-25-1", "id": "478095"}, {"name": "МЦб-25-1", "id": "478326"},
        {"name": "РТУм-25-1", "id": "478471"}, {"name": "ИРТм-25-1", "id": "478228"},
        {"name": "МЦм-25-1", "id": "478335"}, {"name": "ФХм-25-1", "id": "478581"},
        {"name": "ИРб-25-1", "id": "478225"}, {"name": "ОХПм-25-1", "id": "478430"},
        {"name": "ХТОб-25-1", "id": "478593"},
        {"name": "АТПб-24-1", "id": "478037"}, {"name": "РДб-24-1", "id": "478445"},
        {"name": "БТб-24-1", "id": "478094"}, {"name": "ХТОб-24-1", "id": "478592"},
        {"name": "ИРб-24-1", "id": "478224"}, {"name": "ХТТб-24-1", "id": "478596"},
        {"name": "ИФб-24-1", "id": "478245"}, {"name": "МЦб-24-1", "id": "478325"},
        {"name": "АТПб-23-1", "id": "478036"}, {"name": "НМб-23-1", "id": "478409"},
        {"name": "БТб-23-1", "id": "478093"}, {"name": "РДб-23-1", "id": "478444"},
        {"name": "ИРб-23-1", "id": "478223"}, {"name": "ТПб-23-1", "id": "478537"},
        {"name": "ИФб-23-1", "id": "478244"}, {"name": "ХТОб-23-1", "id": "478591"},
        {"name": "МЦТб-23-1", "id": "478337"}, {"name": "ХТТб-23-1", "id": "478595"},
    ],
    "ИИТиАД": [
        {"name": "АСУб-26-1", "id": "478021"}, {"name": "АСУб-26-2", "id": "478022"},
        {"name": "БКСм-26-1", "id": "478092"}, {"name": "ИБб-26-1", "id": "478205"},
        {"name": "ИБб-26-2", "id": "479889"}, {"name": "ИСИб-26-1", "id": "478232"},
        {"name": "ИСТб-26-1", "id": "478240"}, {"name": "ИСТб-26-2", "id": "478241"},
        {"name": "ИСТб-26-3", "id": "479892"}, {"name": "ИИТм-26-1", "id": "478219"},
        {"name": "КСм-26-1", "id": "478261"}, {"name": "ЦППм-26-1", "id": "478603"},
        {"name": "ЭВМб-26-1", "id": "478624"}, {"name": "ЭВМб-26-2", "id": "479900"},
        {"name": "АСУб-25-1", "id": "478019"}, {"name": "ИИТм-25-1", "id": "478218"},
        {"name": "ЦППм-25-1", "id": "478602"}, {"name": "АСУб-25-2", "id": "478020"},
        {"name": "ИСИб-25-1", "id": "478231"}, {"name": "ЭВМб-25-1", "id": "478622"},
        {"name": "БКСм-25-1", "id": "478091"}, {"name": "ИСТб-25-1", "id": "478237"},
        {"name": "ИБб-25-1", "id": "478203"}, {"name": "ИСТб-25-2", "id": "478238"},
        {"name": "ИБб-25-2", "id": "478204"}, {"name": "КСм-25-1", "id": "478260"},
        {"name": "АСУб-24-1", "id": "478018"}, {"name": "ЭВМб-24-1", "id": "478621"},
        {"name": "ИБб-24-1", "id": "478202"}, {"name": "ИСИб-24-1", "id": "478230"},
        {"name": "ИСТб-24-1", "id": "478235"}, {"name": "ИСТб-24-2", "id": "478236"},
        {"name": "АСУб-23-1", "id": "478015"}, {"name": "ИСТб-23-2", "id": "478234"},
        {"name": "АСУб-23-2", "id": "478016"}, {"name": "ЭВМб-23-1", "id": "478620"},
        {"name": "ИБб-23-1", "id": "478201"}, {"name": "ИСИб-23-1", "id": "478229"},
        {"name": "ИСТб-23-1", "id": "478233"},
    ],
    "ИН": [
        {"name": "БЖТм-26-1", "id": "478088"}, {"name": "ГА-26-1", "id": "478109"},
        {"name": "ГГ-26-1", "id": "478115"}, {"name": "ГМ-26-1", "id": "478134"},
        {"name": "ГО-26-1", "id": "478146"}, {"name": "ГП-26-1", "id": "478160"},
        {"name": "ИГ-26-1", "id": "478210"}, {"name": "ИГ-26-2", "id": "479890"},
        {"name": "НДДб-26-1", "id": "478405"}, {"name": "НДДб-26-2", "id": "478406"},
        {"name": "НДДб-26-3", "id": "479894"}, {"name": "НДб-26-1", "id": "478396"},
        {"name": "НДб-26-2", "id": "478397"}, {"name": "НДм-26-1", "id": "478408"},
        {"name": "ООСб-26-1", "id": "478415"}, {"name": "ОП-26-1", "id": "478421"},
        {"name": "ПБмз-26-1", "id": "479895"}, {"name": "ТХб-26-1", "id": "478545"},
        {"name": "ЭКОм-26-1", "id": "478634"},
        {"name": "БЖТм-25-1", "id": "478087"}, {"name": "БТПб-25-1", "id": "478099"},
        {"name": "ГА-25-1", "id": "478108"}, {"name": "ГГ-25-1", "id": "478114"},
        {"name": "ГМ-25-1", "id": "478133"}, {"name": "ГО-25-1", "id": "478145"},
        {"name": "ГП-25-1", "id": "478159"}, {"name": "ИГ-25-1", "id": "478209"},
        {"name": "НДДб-25-1", "id": "478402"}, {"name": "НДДб-25-2", "id": "478403"},
        {"name": "НДДб-25-3", "id": "478404"}, {"name": "НДб-25-1", "id": "478394"},
        {"name": "НДб-25-2", "id": "478395"}, {"name": "НДм-25-1", "id": "478407"},
        {"name": "ОП-25-1", "id": "478420"}, {"name": "ПОм-25-1", "id": "478439"},
        {"name": "ТХб-25-1", "id": "478544"}, {"name": "ЭКОм-25-1", "id": "478633"},
        {"name": "ГО-24-1", "id": "478144"}, {"name": "ГП-24-1", "id": "478158"},
        {"name": "ГГ-24-1", "id": "478113"}, {"name": "ГМ-24-1", "id": "478132"},
        {"name": "ИГ-24-1", "id": "478208"}, {"name": "НДДб-24-1", "id": "478400"},
        {"name": "НДДб-24-2", "id": "478401"}, {"name": "НДб-24-1", "id": "478393"},
        {"name": "ООСб-24-1", "id": "478414"}, {"name": "ОП-24-1", "id": "478419"},
        {"name": "ТХб-24-1", "id": "478543"},
        {"name": "БТПб-23-1", "id": "478098"}, {"name": "ГА-23-1", "id": "478107"},
        {"name": "ГГ-23-1", "id": "478112"}, {"name": "ГП-23-1", "id": "478157"},
        {"name": "ИГ-23-1", "id": "478207"}, {"name": "НДДб-23-1", "id": "478398"},
        {"name": "НДДб-23-2", "id": "478399"}, {"name": "НДб-23-1", "id": "478392"},
        {"name": "ООСб-23-1", "id": "478413"}, {"name": "ОП-23-1", "id": "478418"},
        {"name": "ТХб-23-1", "id": "478542"},
        {"name": "ГА-22-1", "id": "478106"}, {"name": "ГГ-22-1", "id": "478111"},
        {"name": "ГМ-22-1", "id": "478131"}, {"name": "ГО-22-1", "id": "478143"},
        {"name": "ОП-22-1", "id": "478417"},
    ],
    "ИЭУП": [
        {"name": "ВДм-26-1", "id": "479887"}, {"name": "ЖРб-26-1", "id": "478200"},
        {"name": "ИИм-26-1", "id": "478217"}, {"name": "МБб-26-1", "id": "478297"},
        {"name": "МБб-26-2", "id": "478298"}, {"name": "МБб-26-3", "id": "479893"},
        {"name": "НБ-26-1", "id": "478349"}, {"name": "НБ-26-2", "id": "478350"},
        {"name": "СМТм-26-1", "id": "478497"}, {"name": "ТД-26-1", "id": "478532"},
        {"name": "ТД-26-2", "id": "478533"}, {"name": "УОБТб-26-1", "id": "478555"},
        {"name": "ФКб-26-1", "id": "478575"}, {"name": "ФКб-26-2", "id": "478576"},
        {"name": "ЭМЭНм-26-1", "id": "478646"}, {"name": "ЭМЭНмз-26-1", "id": "479901"},
        {"name": "ЭПЭб-26-1", "id": "478680"}, {"name": "ЭПЭб-26-2", "id": "478679"},
        {"name": "ЭТЭКб-26-1", "id": "478706"}, {"name": "ЭТЭКб-26-2", "id": "478707"},
        {"name": "ЮРУб-26-1", "id": "478723"},
        {"name": "ВДм-25-1", "id": "478103"}, {"name": "ЖРБ-25-1", "id": "478199"},
        {"name": "ИИм-25-1", "id": "478216"}, {"name": "МБб-25-1", "id": "478294"},
        {"name": "МБб-25-2", "id": "478295"}, {"name": "МБб-25-3", "id": "478296"},
        {"name": "НБ-25-1", "id": "478346"}, {"name": "НБ-25-2", "id": "478347"},
        {"name": "НБ-25-3", "id": "478348"}, {"name": "СМТм-25-1", "id": "478496"},
        {"name": "ТД-25-1", "id": "478529"}, {"name": "ТД-25-2", "id": "478530"},
        {"name": "ТД-25-3", "id": "478531"}, {"name": "УОБТб-25-1", "id": "478553"},
        {"name": "УОБТб-25-2", "id": "478554"}, {"name": "ФКб-25-1", "id": "478573"},
        {"name": "ФКб-25-2", "id": "478574"}, {"name": "ЭМЭНм-25-1", "id": "478645"},
        {"name": "ЭПЭб-25-1", "id": "478676"}, {"name": "ЭПЭб-25-2", "id": "478677"},
        {"name": "ЭПЭб-25-3", "id": "478678"}, {"name": "ЭТЭКб-25-1", "id": "478704"},
        {"name": "ЭТЭКб-25-2", "id": "478705"}, {"name": "ЭУМм-25-1", "id": "478710"},
        {"name": "ЮРГб-25-1", "id": "478717"}, {"name": "ЮРУб-25-1", "id": "478722"},
        {"name": "ЖРБ-24-1", "id": "478198"}, {"name": "МБб-24-1", "id": "478292"},
        {"name": "МБб-24-2", "id": "478293"}, {"name": "НБ-24-1", "id": "478344"},
        {"name": "НБ-24-2", "id": "478345"}, {"name": "ТД-24-1", "id": "478527"},
        {"name": "ТД-24-2", "id": "478528"}, {"name": "УПб-24-1", "id": "478557"},
        {"name": "ФКб-24-1", "id": "478571"}, {"name": "ФКб-24-2", "id": "478572"},
        {"name": "ЭПЭб-24-1", "id": "478674"}, {"name": "ЭПЭб-24-2", "id": "478675"},
        {"name": "ЭТЭКб-24-1", "id": "478703"}, {"name": "ЮРГб-24-1", "id": "478716"},
        {"name": "ЮРУб-24-1", "id": "478720"}, {"name": "ЮРУб-24-2", "id": "478721"},
        {"name": "ЖРБ-23-1", "id": "478196"}, {"name": "ЖРБ-23-2", "id": "478197"},
        {"name": "МБб-23-1", "id": "478291"}, {"name": "НБ-23-1", "id": "478342"},
        {"name": "НБ-23-2", "id": "478343"}, {"name": "ТД-23-1", "id": "478525"},
        {"name": "ТД-23-2", "id": "478526"}, {"name": "УПб-23-1", "id": "478556"},
        {"name": "ФКб-23-1", "id": "478570"}, {"name": "ЦТРб-23-1", "id": "478606"},
        {"name": "ЭПЭб-23-1", "id": "478672"}, {"name": "ЭПЭб-23-2", "id": "478673"},
        {"name": "ЭТЭКб-23-1", "id": "478702"}, {"name": "ЮРГб-23-1", "id": "478715"},
        {"name": "ЮРУб-23-1", "id": "478718"}, {"name": "ЮРУб-23-2", "id": "478719"},
        {"name": "НБ-22-1", "id": "478340"}, {"name": "НБ-22-2", "id": "478341"},
        {"name": "ЭПЭб-22-1", "id": "478670"}, {"name": "ЭПЭб-22-2", "id": "478671"},
    ],
    "ИЭ": [
        {"name": "ЭАПЭб-26-1", "id": "478614"}, {"name": "КТЭм-26-1", "id": "478273"},
        {"name": "СТЭб-26-1", "id": "478508"}, {"name": "СТЭб-26-2", "id": "479897"},
        {"name": "УЭСм-26-1", "id": "478569"}, {"name": "ЦЭм-26-1", "id": "478609"},
        {"name": "ЭНГм-26-1", "id": "478650"}, {"name": "ЭПб-26-1", "id": "478660"},
        {"name": "ЭПб-26-2", "id": "478661"}, {"name": "ЭСб-26-1", "id": "478692"},
        {"name": "ЭСм-26-1", "id": "478699"}, {"name": "ЭСТм-26-1", "id": "478701"},
        {"name": "ЭУм-26-1", "id": "478709"},
        {"name": "ИЭм-25-1", "id": "478248"}, {"name": "ЦЭм-25-1", "id": "478608"},
        {"name": "ЭСТм-25-1", "id": "478700"}, {"name": "КТЭм-25-1", "id": "478272"},
        {"name": "ЭАПб-25-1", "id": "478612"}, {"name": "ЭСб-25-1", "id": "478690"},
        {"name": "СТЭб-25-1", "id": "478506"}, {"name": "ЭНГм-25-1", "id": "478649"},
        {"name": "ЭСб-25-2", "id": "478691"}, {"name": "СТЭб-25-2", "id": "478507"},
        {"name": "ЭПб-25-1", "id": "478658"}, {"name": "ЭСм-25-1", "id": "478698"},
        {"name": "ЭУм-25-1", "id": "478708"}, {"name": "ЭПб-25-2", "id": "478659"},
        {"name": "УЭСм-25-1", "id": "478568"},
        {"name": "СТб-24-1", "id": "478505"}, {"name": "ЭСб-24-1", "id": "478689"},
        {"name": "ЭАПЭб-24-1", "id": "478611"}, {"name": "ЭПб-24-1", "id": "478656"},
        {"name": "ЭПб-24-2", "id": "478657"},
        {"name": "СТб-23-1", "id": "478504"}, {"name": "ЭАПЭб-23-1", "id": "478610"},
        {"name": "ЭПб-23-1", "id": "478655"}, {"name": "ЭСб-23-1", "id": "478687"},
        {"name": "ЭСб-23-2", "id": "478688"},
    ],
}

LESSON_TIMES = {"8:15":"9:45","8:30":"10:00","10:00":"11:30","10:10":"11:40",
    "11:45":"13:15","12:00":"13:30","13:45":"15:15","14:00":"15:30",
    "15:30":"17:00","15:45":"17:15","17:10":"18:40","17:25":"18:55",
    "18:50":"20:20","19:05":"20:35"}

def _filter_lessons_by_subgroup(lessons, subgroup):
    if not subgroup: return lessons
    result = []
    for les in lessons:
        if not les["subgroup"]: result.append(les)
        elif str(subgroup) == str(les["subgroup"]): result.append(les)
    return result

def parse_schedule(html):
    soup = BeautifulSoup(html, "html.parser")
    week_parity = "all"
    for item in soup.find_all("div", class_="info-block-item"):
        label = item.find("div", class_="info-block-item-label")
        value = item.find("div", class_="info-block-item-value")
        if label and value and "Показана неделя" in label.get_text():
            txt = value.get_text(strip=True).lower()
            week_parity = "even" if "нечет" in txt else "odd"
    days = []
    for day_div in soup.find_all("div", class_="sch-list-day"):
        date_str = ""
        m = re.search(r"'date'\s*:\s*'([^']+)'", day_div.get("data-params", ""))
        if m: date_str = m.group(1)
        header = day_div.find("h2", class_="sch-list-day-header")
        day_name = header.get_text(strip=True) if header else date_str
        lessons = []
        for item in day_div.find_all("div", class_="sch-list-item"):
            time_div = item.find("div", class_="sch-list-item-time-inner")
            time_str = time_div.get_text(strip=True) if time_div else ""
            for week_block in item.find_all("div", class_="sch-list-item-week"):
                classes = week_block.get("class", [])
                week_type = "all"
                if "week-even" in classes: week_type = "even"
                elif "week-odd" in classes: week_type = "odd"
                if week_type != "all" and week_parity != "all" and week_type != week_parity: continue
                for cls in week_block.find_all("div", class_="schcls-item"):
                    if "schcls-empty" in cls.get("class", []): continue
                    name_div = cls.find("div", class_="schcls-item-name")
                    subject = name_div.get_text(strip=True) if name_div else ""
                    type_div = cls.find("div", class_="schcls-item-distype")
                    lesson_type = type_div.get_text(strip=True) if type_div else ""
                    prepod_div = cls.find("div", class_="schcls-item-prepod")
                    teacher = prepod_div.get_text(strip=True) if prepod_div else ""
                    group_div = cls.find("div", class_="schcls-item-group")
                    group_text = group_div.get_text(strip=True) if group_div else ""
                    subgroup = ""
                    sm = re.search(r"подгруппа\s+(\d+)", group_text)
                    if sm: subgroup = sm.group(1)
                    aud_div = cls.find("div", class_="schcls-item-aud")
                    auditorium = aud_div.get_text(strip=True) if aud_div else ""
                    lessons.append({"time": time_str, "subject": subject, "type": lesson_type,
                        "teacher": teacher, "subgroup": subgroup, "auditorium": auditorium})
        days.append({"date": date_str, "name": day_name, "lessons": lessons})
    return week_parity, days

async def fetch_week_html(group_id, target_monday, use_cache=True):
    week_start_str = target_monday.strftime("%Y-%m-%d")
    if use_cache:
        cached = get_cached_schedule(group_id, week_start_str)
        if cached: return cached
    date_str = target_monday.strftime("%d.%m.%Y")
    url = f"https://www.istu.edu/raspisanie/grup/{group_id}/{date_str}/"
    headers = {"User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                html = await response.text()
                if response.status == 200 and html: save_cached_schedule(group_id, week_start_str, html)
                return html
    except Exception as e:
        logging.error(f"[WEEK] Ошибка: {e}")
        if use_cache:
            conn = sqlite3.connect(DB_PATH)
            row = conn.execute("SELECT html FROM schedule_cache WHERE group_id=? AND week_start=?", (group_id, week_start_str)).fetchone()
            conn.close()
            if row: return row[0]
        return ""

def _verify_webapp_init_full(init_data):
    if not init_data: return None
    try:
        data = safe_parse_webapp_init_data(token=TOKEN, init_data=init_data)
        if data and data.user: return data.user
    except Exception as e:
        logging.warning(f"[WEB] initData verify error: {e}")
    return None

def _verify_webapp_init(init_data):
    u = _verify_webapp_init_full(init_data)
    return u.id if u else None

async def api_schedule(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    saved = get_user_group(user_id)
    if not saved: return web.json_response({"error": "no_group", "message": "Сначала выбери группу"}, status=200)
    group_id, group_name = saved
    subgroup = get_user_subgroup(user_id)
    today = _now_irkutsk(); monday = _monday_of_week(today)
    html = await fetch_week_html(group_id, monday, use_cache=True)
    if not html: return web.json_response({"error": "no_data"}, status=200)
    _, days = parse_schedule(html)
    today_str = today.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)
    if day is None:
        return web.json_response({"date": today_str, "dayName": "", "group": group_name, "subgroup": subgroup, "lessons": []})
    filtered = _filter_lessons_by_subgroup(day["lessons"], subgroup)
    att_map = attendance_get_map(user_id, [day["date"]])
    lessons_out = []
    for les in filtered:
        key = (day["date"], les["time"], les["subject"])
        lessons_out.append({"time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
            "subject": les["subject"], "type": les["type"], "teacher": les["teacher"],
            "auditorium": les["auditorium"], "subgroup": les["subgroup"], "date": day["date"],
            "attendance": att_map.get(key, "")})
    return web.json_response({"date": day["date"], "dayName": day["name"], "group": group_name,
        "subgroup": subgroup, "lessons": lessons_out})

async def api_week(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: offset = int(request.query.get("offset", "0"))
    except: offset = 0
    saved = get_user_group(user_id)
    if not saved: return web.json_response({"error": "no_group"}, status=200)
    group_id, group_name = saved
    subgroup = get_user_subgroup(user_id)
    today = _now_irkutsk()
    target_monday = _monday_of_week(today) + timedelta(days=7 * offset)
    html = await fetch_week_html(group_id, target_monday, use_cache=True)
    if not html: return web.json_response({"error": "no_data"}, status=200)
    _, days = parse_schedule(html)
    dates_list = [d["date"] for d in days]
    att_map = attendance_get_map(user_id, dates_list)
    days_out = []
    for d in days:
        filtered = _filter_lessons_by_subgroup(d["lessons"], subgroup)
        lessons_out = []
        for les in filtered:
            key = (d["date"], les["time"], les["subject"])
            lessons_out.append({"time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
                "subject": les["subject"], "type": les["type"], "teacher": les["teacher"],
                "auditorium": les["auditorium"], "subgroup": les["subgroup"], "date": d["date"],
                "attendance": att_map.get(key, "")})
        days_out.append({"date": d["date"], "name": d["name"], "lessons": lessons_out})
    return web.json_response({"group": group_name, "subgroup": subgroup, "days": days_out})

async def api_me(request):
    init_data = request.query.get("initData", "")
    user_obj = _verify_webapp_init_full(init_data)
    if not user_obj: return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id
    _ensure_user(user_id); _update_user_meta(user_id, user_obj.username, user_obj.first_name)
    streak = stats_update_streak(user_id); check_and_award_achievements(user_id)
    saved = get_user_group(user_id); active, done = count_user_tasks(user_id)
    notes = get_user_notes(user_id); amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id); daily = daily_is_subscribed(user_id)
    notif_settings = get_notify_settings(user_id)
    avg = sum(g[2] for g in grades) / len(grades) if grades else 0
    att_stats = attendance_stats(user_id); wallet = wallet_get(user_id); ach = achievements_get(user_id)
    if wallet["custom_name"]: display_name = wallet["custom_name"]
    else:
        full = " ".join(p for p in [user_obj.first_name or "", user_obj.last_name or ""] if p).strip()
        display_name = full or "PLAYER"
    player_tag = f"PLAYER-{str(user_id)[-6:].upper()}"
    return web.json_response({"user_id": user_id, "is_admin": user_id == ADMIN_ID,
        "group": saved[1] if saved else None, "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id), "tasks_active": active, "tasks_done": done,
        "notes_count": len(notes), "scholarship_amount": amount, "grades_count": len(grades),
        "grades_avg": round(avg, 2), "daily_subscribed": daily,
        "notify_type": notif_settings["type"] if notif_settings else None,
        "notify_hour": notif_settings["hour"] if notif_settings else -1,
        "notify_minute": notif_settings["minute"] if notif_settings else 0,
        "notify_changes": get_notify_changes(user_id), "notify_before_min": get_notify_before_min(user_id),
        "attendance_was": att_stats["was"], "attendance_missed": att_stats["missed"],
        "attendance_sick": att_stats["sick"], "attendance_excused": att_stats["excused"],
        "attendance_total": sum(att_stats.values()), "username": user_obj.username,
        "first_name": user_obj.first_name, "last_name": user_obj.last_name,
        "display_name": display_name, "player_tag": player_tag, "wallet": wallet,
        "streak": streak, "achievements": ach, "chat_unread": 0})

async def api_wallet(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    _ensure_user(user_id); check_and_award_achievements(user_id)
    return web.json_response({"wallet": wallet_get(user_id)})

async def api_set_name(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    name = (body.get("name") or "").strip()
    if len(name) > 24: name = name[:24]
    wallet_before = wallet_get(user_id); used_free = False
    if wallet_before["custom_name"]:
        if wallet_before["free_name_changes"] > 0:
            wallet_use_free_name(user_id); used_free = True
        else:
            if not wallet_consume(user_id, "nova", 5):
                return web.json_response({"error": "need_hard", "message": "Нужно 5 Нова"}, status=400)
    wallet_set_name(user_id, name)
    return web.json_response({"ok": True, "wallet": wallet_get(user_id), "used_free": used_free})

async def api_set_avatar(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: idx = int(body.get("idx", 0))
    except: return web.json_response({"error": "bad_idx"}, status=400)
    idx = max(0, min(idx, 11))
    wallet_set_avatar(user_id, idx)
    return web.json_response({"ok": True, "wallet": wallet_get(user_id)})

async def api_exchange(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: amount = int(body.get("amount", 0))
    except: return web.json_response({"error": "bad_amount"}, status=400)
    if amount <= 0: return web.json_response({"error": "bad_amount"}, status=400)
    amount = (amount // EXCHANGE_RATE_SHIFT_TO_NOVA) * EXCHANGE_RATE_SHIFT_TO_NOVA
    if amount <= 0:
        return web.json_response({"error": "too_small", "message": f"Минимум {EXCHANGE_RATE_SHIFT_TO_NOVA} Шифт"}, status=400)
    w = wallet_get(user_id)
    if (w.get("shift") or 0) < amount:
        return web.json_response({"error": "not_enough_soft", "message": "Недостаточно Шифт"}, status=400)
    result = exchange_shift_to_nova(user_id, amount)
    if not result: return web.json_response({"error": "exchange_failed"}, status=500)
    check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "soft_spent": result["soft_spent"],
        "hard_received": result["hard_received"], "shift_spent": result["shift_spent"],
        "nova_received": result["nova_received"], "wallet": wallet_get(user_id)})

async def api_chest_status(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    chest_id = request.query.get("chest_id", "capsule")
    return web.json_response(chest_status(user_id, chest_id))

async def api_chest_open(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    chest_id = (body.get("type") or body.get("chest") or "capsule").strip()
    if chest_id not in CHESTS: chest_id = "capsule"
    reward, err = chest_open(user_id, chest_id)
    if err:
        msg = {"already_opened": "Кейс уже открыт", "not_enough_shift": "Недостаточно Шифт",
               "not_enough_nova": "Недостаточно Нова", "bad_chest": "Неизвестный кейс",
               "roll_failed": "Ошибка"}.get(err, "Ошибка")
        return web.json_response({"error": err, "message": msg}, status=400)
    check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "reward": reward, "wallet": wallet_get(user_id)})

async def api_achievements(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    _ensure_user(user_id); check_and_award_achievements(user_id)
    unlocked = achievements_get(user_id)
    conn = sqlite3.connect(DB_PATH)
    rewards = conn.execute("SELECT ach_id, xp, shift, nova FROM achievement_rewards WHERE user_id=?", (user_id,)).fetchall()
    claimed = conn.execute("SELECT ach_id FROM achievement_claims WHERE user_id=?", (user_id,)).fetchall()
    conn.close()
    reward_map = {r[0]: {"xp": r[1], "shift": r[2], "nova": r[3], "soft": r[2], "hard": r[3]} for r in rewards}
    claimed_set = {c[0] for c in claimed}
    items = []
    for aid, meta in ACHIEVEMENTS.items():
        is_unlocked = aid in unlocked
        rw_raw = reward_map.get(aid) or ACHIEVEMENT_REWARDS.get(aid, {"xp":0,"shift":0,"nova":0})
        rw = {"xp": rw_raw.get("xp", 0), "shift": rw_raw.get("shift", rw_raw.get("soft", 0)),
              "nova": rw_raw.get("nova", rw_raw.get("hard", 0)),
              "soft": rw_raw.get("shift", rw_raw.get("soft", 0)),
              "hard": rw_raw.get("nova", rw_raw.get("hard", 0))}
        items.append({"id": aid, "name": meta["name"], "icon": meta.get("icon", ""),
            "desc": meta["desc"], "unlocked": is_unlocked, "unlocked_at": unlocked.get(aid),
            "reward": rw, "claimed": aid in claimed_set,
            "can_claim": is_unlocked and aid in reward_map and aid not in claimed_set})
    total_reward = {"xp": 0, "shift": 0, "nova": 0, "soft": 0, "hard": 0}
    for it in items:
        if it["can_claim"]:
            total_reward["xp"] += it["reward"]["xp"]
            total_reward["shift"] += it["reward"]["shift"]
            total_reward["nova"] += it["reward"]["nova"]
    total_reward["soft"] = total_reward["shift"]
    total_reward["hard"] = total_reward["nova"]
    return web.json_response({"items": items, "total": len(ACHIEVEMENTS),
        "got": len(unlocked), "can_claim_count": sum(1 for x in items if x["can_claim"]),
        "total_reward": total_reward})

async def api_achievement_claim(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    ach_id = (body.get("ach_id") or "").strip()
    if not ach_id or ach_id not in ACHIEVEMENTS:
        return web.json_response({"error": "bad_id"}, status=400)
    conn = sqlite3.connect(DB_PATH)
    has = conn.execute("SELECT xp, shift, nova FROM achievement_rewards WHERE user_id=? AND ach_id=?",
        (user_id, ach_id)).fetchone()
    claimed = conn.execute("SELECT 1 FROM achievement_claims WHERE user_id=? AND ach_id=?",
        (user_id, ach_id)).fetchone()
    conn.close()
    if not has or claimed: return web.json_response({"error": "already_claimed"}, status=400)
    xp, shift, nova = has
    wallet_add(user_id, xp=xp, shift=shift, nova=nova)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO achievement_claims (user_id, ach_id, claimed_at) VALUES (?, ?, ?)",
        (user_id, ach_id, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()
    check_and_award_achievements(user_id)
    return web.json_response({"ok": True,
        "reward": {"xp": xp, "shift": shift, "nova": nova, "soft": shift, "hard": nova},
        "wallet": wallet_get(user_id)})

async def api_level_rewards(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    return web.json_response({"claimed": level_rewards_claimed(user_id)})

async def api_level_reward_claim(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: lvl = int(body.get("level", 0))
    except: return web.json_response({"error": "bad_level"}, status=400)
    rw, err = level_reward_claim(user_id, lvl)
    if err: return web.json_response({"error": err}, status=400)
    return web.json_response({"ok": True, "reward": rw, "wallet": wallet_get(user_id)})

async def api_wallet_leaderboard(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    rows = wallet_leaderboard(10)
    items = []
    for i, (uid, xp, custom_name, username) in enumerate(rows):
        lvl, _, _ = calc_level(xp or 0)
        if custom_name: display = custom_name
        elif username: display = "@" + username
        else: display = f"PLAYER-{str(uid)[-6:].upper()}"
        items.append({"rank": i + 1, "user_id": uid, "xp": xp or 0, "level": lvl,
            "display": display, "is_me": uid == user_id})
    return web.json_response({"items": items})

async def api_groups(request): return web.json_response({"groups": GROUPS})

async def api_set_group(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    group_id = str(body.get("group_id", "")); group_name = str(body.get("group_name", ""))
    subgroup = int(body.get("subgroup", 0))
    if not group_id or not group_name:
        delete_user_group(user_id); return web.json_response({"ok": True})
    save_user_group(user_id, group_id, group_name); set_user_subgroup(user_id, subgroup)
    return web.json_response({"ok": True})

async def api_set_subgroup(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    subgroup = int(body.get("subgroup", 0))
    set_user_subgroup(user_id, subgroup)
    return web.json_response({"ok": True})

def _task_to_dict(row):
    tid, text, due_date, done, created_at, priority, due_time = row
    overdue = False
    if due_date and not done:
        try:
            if due_time: dt = datetime.strptime(f"{due_date} {due_time}", "%d.%m.%Y %H:%M")
            else: dt = datetime.strptime(due_date, "%d.%m.%Y").replace(hour=23, minute=59)
            overdue = dt < _now_irkutsk()
        except: pass
    p = priority if priority is not None else 2
    if p not in (1, 2, 3): p = 2
    return {"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
        "priority": p, "done": bool(done), "overdue": overdue}

async def api_tasks(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    show_done = request.query.get("done", "0") == "1"
    if show_done:
        rows = get_done_tasks(user_id, days=7); tasks = []
        for r in rows:
            tid, text, due_date, done, created_at, priority, due_time, done_at = r
            p = priority if priority is not None else 2
            if p not in (1, 2, 3): p = 2
            tasks.append({"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
                "priority": p, "done": True, "done_at": done_at, "overdue": False})
    else:
        rows = get_user_tasks(user_id, only_active=True); tasks = [_task_to_dict(r) for r in rows]
    active, done_count = count_user_tasks(user_id)
    return web.json_response({"tasks": tasks, "active": active, "done": done_count})

async def api_task_add(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    text = (body.get("text") or "").strip()
    if not text: return web.json_response({"error": "empty_text"}, status=400)
    if len(text) > 500: text = text[:500]
    due_date = body.get("due_date") or None; due_time = body.get("due_time") or None
    priority = int(body.get("priority", 2))
    if priority not in (1, 2, 3): priority = 2
    tid = add_task(user_id, text, due_date, priority, due_time)
    wallet_add(user_id, xp=5, shift=1); check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "id": tid, "wallet": wallet_get(user_id)})

async def api_task_update(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    tid = int(body.get("id", 0))
    if not tid: return web.json_response({"error": "no_id"}, status=400)
    row = get_task(tid, user_id)
    if not row: return web.json_response({"error": "not_found"}, status=404)
    if body.get("done") is True:
        mark_task_done(tid, user_id); stats_inc(user_id, "tasks_done", 1)
        wallet_add(user_id, xp=20, shift=5)
        new_ach = check_and_award_achievements(user_id)
        return web.json_response({"ok": True, "done": True, "wallet": wallet_get(user_id), "new_achievements": new_ach})
    text = body.get("text"); due_date = body.get("due_date"); due_time = body.get("due_time")
    priority = body.get("priority"); reset_due = body.get("reset_due", False)
    if priority is not None:
        priority = int(priority)
        if priority not in (1, 2, 3): priority = 2
    update_task(tid, user_id, text=text if text is not None else None,
        due_date=due_date if due_date else None, priority=priority,
        due_time=due_time if due_time is not None else None, reset_due=reset_due)
    return web.json_response({"ok": True})

async def api_task_delete(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    tid = int(body.get("id", 0))
    if not tid: return web.json_response({"error": "no_id"}, status=400)
    delete_task(tid, user_id)
    return web.json_response({"ok": True})

async def api_task_clear(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    clear_done_tasks(user_id)
    return web.json_response({"ok": True})

async def api_notes(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    rows = get_user_notes(user_id)
    return web.json_response({"notes": [{"id": nid, "subject": subj, "text": txt} for nid, subj, txt in rows]})

async def api_note_save(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    subject = (body.get("subject") or "").strip(); text = (body.get("text") or "").strip()
    if not subject or not text: return web.json_response({"error": "empty"}, status=400)
    if len(subject) > 100: subject = subject[:100]
    if len(text) > 500: text = text[:500]
    add_or_update_note(user_id, subject, text); stats_inc(user_id, "notes_added", 1)
    wallet_add(user_id, xp=3, shift=1)
    new_ach = check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "wallet": wallet_get(user_id), "new_achievements": new_ach})

async def api_note_delete(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    nid = int(body.get("id", 0))
    if not nid: return web.json_response({"error": "no_id"}, status=400)
    delete_note_by_id(nid, user_id)
    return web.json_response({"ok": True})

async def api_notify_set(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    if "changes" in body:
        set_notify_changes(user_id, bool(body.get("changes", False)))
        return web.json_response({"ok": True})
    ntype = body.get("type", None)
    if ntype is None or ntype == "":
        set_notify_settings(user_id, None, -1, 0)
        return web.json_response({"ok": True, "type": None})
    if ntype not in ("today", "tomorrow"): return web.json_response({"error": "bad_type"}, status=400)
    try:
        hour = int(body.get("hour", 8)); minute = int(body.get("minute", 0))
    except: return web.json_response({"error": "bad_time"}, status=400)
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return web.json_response({"error": "bad_time"}, status=400)
    if ntype == "today" and hour > 10:
        return web.json_response({"error": "today_limit", "message": "Для «Сегодня» — не позже 10:00"}, status=400)
    set_notify_settings(user_id, ntype, hour, minute)
    return web.json_response({"ok": True, "type": ntype, "hour": hour, "minute": minute})

async def api_notify_set_before(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: minutes = int(body.get("minutes", 0))
    except: return web.json_response({"error": "bad_minutes"}, status=400)
    if minutes not in (0, 5, 10, 15, 20, 30, 60): minutes = 0
    set_notify_before_min(user_id, minutes)
    return web.json_response({"ok": True, "minutes": minutes})

async def api_quote(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    return web.json_response({"quote": random.choice(DAILY_QUOTES), "subscribed": daily_is_subscribed(user_id)})

async def api_quote_subscribe(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    sub = bool(body.get("subscribe", False))
    if sub: daily_subscribe(user_id)
    else: daily_unsubscribe(user_id)
    return web.json_response({"ok": True, "subscribed": sub})

async def api_scholarship(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    amount = get_scholarship_amount(user_id); grades = get_grades(user_id)
    grades_out = [{"id": g[0], "subject": g[1], "grade": g[2], "is_auto": bool(g[3]), "semester": g[4] or ""} for g in grades]
    semesters = sorted(set(g[4] for g in grades if g[4]))
    avg = sum(g[2] for g in grades) / len(grades) if grades else 0
    count5 = sum(1 for g in grades if g[2] == 5); count4 = sum(1 for g in grades if g[2] == 4)
    count3 = sum(1 for g in grades if g[2] == 3); count2 = sum(1 for g in grades if g[2] == 2)
    count_auto = sum(1 for g in grades if g[3])
    forecast = ""
    if count2 > 0 or count3 > 0: forecast = "На академическую не проходишь."
    elif avg >= 4.5: forecast = "Проходишь на академическую и можешь претендовать на повышенную."
    elif avg >= 4.0: forecast = f"Проходишь на академическую. До повышенной не хватает {4.5 - avg:.2f}."
    elif grades: forecast = "На академическую не проходишь: средний балл ниже 4.0."
    available_subjects = []
    saved = get_user_group(user_id)
    if saved:
        try:
            group_id, _ = saved; subgroup = get_user_subgroup(user_id)
            today = _now_irkutsk(); monday = _monday_of_week(today)
            html = await fetch_week_html(group_id, monday, use_cache=True)
            if html:
                _, days = parse_schedule(html); subjects = set()
                for d in days:
                    for les in d["lessons"]:
                        s = (les.get("subject") or "").strip()
                        if s: subjects.add(s)
                available_subjects = sorted(subjects)
        except Exception as e:
            logging.warning(f"[SCH] subjects: {e}")
    return web.json_response({"amount": amount, "grades": grades_out, "avg": round(avg, 2),
        "count5": count5, "count4": count4, "count3": count3, "count2": count2,
        "count_auto": count_auto, "forecast": forecast,
        "available_subjects": available_subjects, "semesters": semesters})

async def api_scholarship_set_amount(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    amount = int(body.get("amount", 0))
    if amount < 0 or amount > 100000: return web.json_response({"error": "invalid"}, status=400)
    set_scholarship_amount(user_id, amount)
    return web.json_response({"ok": True})

async def api_scholarship_add_grade(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    subject = (body.get("subject") or "").strip(); grade = int(body.get("grade", 0))
    is_auto = bool(body.get("is_auto", False)); semester = (body.get("semester") or "").strip() or None
    if not subject or grade not in (2, 3, 4, 5):
        return web.json_response({"error": "invalid"}, status=400)
    if len(subject) > 100: subject = subject[:100]
    if semester and len(semester) > 40: semester = semester[:40]
    upsert_grade(user_id, subject, grade, is_auto, semester); wallet_add(user_id, xp=5, shift=1)
    new_ach = check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "wallet": wallet_get(user_id), "new_achievements": new_ach})

async def api_scholarship_update_grade(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    gid = int(body.get("id", 0))
    if not gid: return web.json_response({"error": "no_id"}, status=400)
    subject = (body.get("subject") or "").strip()
    if subject and len(subject) > 100: subject = subject[:100]
    grade = body.get("grade")
    if grade is not None:
        grade = int(grade)
        if grade not in (2, 3, 4, 5): return web.json_response({"error": "invalid_grade"}, status=400)
    is_auto = body.get("is_auto")
    if is_auto is not None: is_auto = bool(is_auto)
    semester = body.get("semester")
    if semester is not None:
        semester = (semester or "").strip()
        if len(semester) > 40: semester = semester[:40]
    update_grade_by_id(gid, user_id, subject if subject else None, grade, is_auto, semester)
    return web.json_response({"ok": True})

async def api_scholarship_delete_grade(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    gid = int(body.get("id", 0))
    if not gid: return web.json_response({"error": "no_id"}, status=400)
    delete_grade(gid, user_id)
    return web.json_response({"ok": True})

async def api_scholarship_clear(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    semester = body.get("semester")
    if semester is not None: semester = (semester or "").strip() or None
    clear_grades(user_id, semester)
    return web.json_response({"ok": True})

async def api_attendance_set(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    date = (body.get("date") or "").strip(); time_ = (body.get("time") or "").strip()
    subject = (body.get("subject") or "").strip(); status = (body.get("status") or "").strip()
    if not date or not time_ or not subject:
        return web.json_response({"error": "empty"}, status=400)
    if status not in ("", "was", "missed", "sick", "excused"):
        return web.json_response({"error": "bad_status"}, status=400)
    if len(subject) > 200: subject = subject[:200]
    attendance_set(user_id, date, time_, subject, status)
    if status == "was":
        wallet_add(user_id, xp=3, shift=1); check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "status": status, "wallet": wallet_get(user_id)})

async def api_ai(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    if giga_client is None: return web.json_response({"error": "ai_unavailable"}, status=503)
    question = (body.get("question") or "").strip()
    if not question: return web.json_response({"error": "empty"}, status=400)
    if len(question) > 2000: question = question[:2000]
    ai_save_message(user_id, 'user', question, has_photo=0)
    try:
        prompt = ("Ты — студенческий помощник. Ответь на вопрос студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n- Пиши без воды.\n\n"
            f"Вопрос: {question}")
        response = await giga_client.achat(prompt)
        try: answer = response.choices[0].message.content
        except AttributeError:
            answer = response.messages[0].content[0].text if response.messages else "Нет ответа."
        answer = clean_latex(answer); answer = clean_markdown(answer)
        if len(answer) > 4000: answer = answer[:4000] + "\n... (обрезано)"
        ai_save_message(user_id, 'assistant', answer, has_photo=0)
        wallet_add(user_id, xp=2, shift=1)
        return web.json_response({"answer": answer})
    except Exception as e:
        logging.exception("[AI-WEB]")
        return web.json_response({"error": "ai_failed", "message": str(e)}, status=500)

async def api_ai_photo(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    if not YANDEX_VISION_API_KEY or not YANDEX_FOLDER_ID:
        return web.json_response({"error": "ocr_unavailable"}, status=503)
    if giga_client is None: return web.json_response({"error": "ai_unavailable"}, status=503)
    photo_data = (body.get("photo") or "").strip(); question = (body.get("question") or "").strip()
    if not photo_data: return web.json_response({"error": "no_photo"}, status=400)
    b64 = photo_data.split(",", 1)[1] if "," in photo_data else photo_data
    try: img_bytes = base64.b64decode(b64)
    except: return web.json_response({"error": "bad_photo"}, status=400)
    if len(img_bytes) > 8 * 1024 * 1024:
        return web.json_response({"error": "too_big"}, status=400)
    ai_save_message(user_id, 'user', question or 'Что на фото?', has_photo=1)
    try:
        ocr_url = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText"
        ocr_headers = {"Authorization": f"Api-Key {YANDEX_VISION_API_KEY}", "Content-Type": "application/json"}
        ocr_body = {"mimeType": "image/jpeg", "languageCodes": ["ru", "en"], "model": "page", "content": b64}
        async with aiohttp.ClientSession() as session:
            async with session.post(ocr_url, headers=ocr_headers, json=ocr_body,
                                    timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200:
                    return web.json_response({"error": "ocr_failed", "message": f"OCR HTTP {resp.status}"}, status=500)
                ocr_result = await resp.json()
        recognized_text = ""
        try: recognized_text = ocr_result["result"]["textAnnotation"]["fullText"] or ""
        except (KeyError, TypeError):
            try:
                blocks = ocr_result["result"]["textAnnotation"]["blocks"]; parts = []
                for b in blocks:
                    for line in b.get("lines", []): parts.append(line.get("text", ""))
                recognized_text = "\n".join(parts)
            except: recognized_text = ""
        recognized_text = recognized_text.strip()
    except Exception as e:
        return web.json_response({"error": "ocr_failed", "message": str(e)}, status=500)
    if not recognized_text: return web.json_response({"answer": "На фото не удалось распознать текст."})
    if len(recognized_text) > 4000: recognized_text = recognized_text[:4000]
    if not question: question = "Разберись, что это, и помоги студенту."
    if len(question) > 2000: question = question[:2000]
    try:
        prompt = ("Ты — студенческий помощник. Пользователь прислал фото, с которого распознан текст. "
            "Выполни задачу студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n- Пиши без воды.\n\n"
            f"Распознанный текст с фото:\n{recognized_text}\n\nЗадача студента: {question}")
        response = await giga_client.achat(prompt)
        try: answer = response.choices[0].message.content
        except AttributeError:
            answer = response.messages[0].content[0].text if response.messages else "Нет ответа."
        answer = clean_latex(answer); answer = clean_markdown(answer)
        if len(answer) > 4000: answer = answer[:4000] + "\n... (обрезано)"
        ai_save_message(user_id, 'assistant', answer, has_photo=0)
        wallet_add(user_id, xp=5, shift=2)
        return web.json_response({"answer": answer})
    except Exception as e:
        return web.json_response({"error": "ai_failed", "message": str(e)}, status=500)

async def api_ai_history(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    rows = ai_get_history(user_id, limit=30)
    items = [{"id": r[0], "role": r[1], "text": r[2], "has_photo": bool(r[3])} for r in rows]
    return web.json_response({"items": items})

async def api_ai_clear_history(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    ai_clear_history(user_id)
    return web.json_response({"ok": True})

async def api_feedback_my(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    rows = get_user_feedback(user_id, limit=30)
    items = [{"id": r[0], "text": r[1], "status": r[2], "created_at": r[3],
        "answered_at": r[4], "admin_reply": r[5]} for r in rows]
    return web.json_response({"items": items})

async def api_feedback(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    text = (body.get("text") or "").strip()
    if not text: return web.json_response({"error": "empty"}, status=400)
    if len(text) > 2000: text = text[:2000]
    fid = save_feedback(user_id, f"user_{user_id}", text)
    try:
        admin_msg = await bot.send_message(ADMIN_ID, f"Обращение #{fid} (из веба)\nОт: user_{user_id}\n\n{text}")
        update_feedback_admin_msg(fid, admin_msg.message_id)
    except Exception as e:
        logging.error(f"[FEEDBACK-WEB] {e}")
    return web.json_response({"ok": True, "id": fid})

async def api_game_info(request):
    init_data = request.query.get("initData", "")
    user_obj = _verify_webapp_init_full(init_data)
    if not user_obj: return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id
    _ensure_user(user_id); _update_user_meta(user_id, user_obj.username, user_obj.first_name)
    scores = game_get_scores(user_id)
    tops = {}
    for gid in GAMES:
        rows = game_leaderboard(gid, 5); items = []
        for i, (uid, score, display_name, username) in enumerate(rows):
            if display_name and username: display = f"{display_name} (@{username})"
            elif display_name: display = display_name
            elif username: display = "@" + username
            else: display = f"PLAYER-{str(uid)[-6:].upper()}"
            items.append({"rank": i + 1, "user_id": uid, "score": score, "display": display, "is_me": uid == user_id})
        tops[gid] = items
    games_out = []
    for gid, meta in GAMES.items():
        s = scores.get(gid, {"best": 0, "plays": 0})
        games_out.append({"id": gid, "name": meta["name"], "desc": meta["desc"], "best": s["best"], "plays": s["plays"]})
    return web.json_response({"games": games_out, "scores": scores, "tops": tops})

async def api_game_submit(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_obj = _verify_webapp_init_full(body.get("initData", ""))
    if not user_obj: return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id
    _ensure_user(user_id); _update_user_meta(user_id, user_obj.username, user_obj.first_name)
    game_id = (body.get("game_id") or "flappy").strip()
    if game_id not in GAMES: return web.json_response({"error": "bad_game"}, status=400)
    try: score = int(body.get("score", 0))
    except: score = 0
    try: bonus_shift = int(body.get("bonus_shift", 0))
    except: bonus_shift = 0
    bonus_shift = max(0, min(bonus_shift, 200))
    result = game_save_score(user_id, game_id, score)
    soft_reward = max(1, score // 2) + bonus_shift
    xp_reward = max(1, score * 2)
    hard_reward = 0
    if result["is_record"] and score > 0: hard_reward += 1
    wallet_add(user_id, xp=xp_reward, shift=soft_reward, nova=hard_reward)
    rows = game_leaderboard(game_id, 1)
    if rows and rows[0][0] == user_id and score > 0: wallet_add(user_id, nova=5)
    check_and_award_achievements(user_id)
    wallet = wallet_get(user_id)
    lb_rows = game_leaderboard(game_id, 10); items = []
    for i, (uid, s, display_name, username) in enumerate(lb_rows):
        if display_name and username: display = f"{display_name} (@{username})"
        elif display_name: display = display_name
        elif username: display = "@" + username
        else: display = f"PLAYER-{str(uid)[-6:].upper()}"
        items.append({"rank": i + 1, "user_id": uid, "score": s, "display": display, "is_me": uid == user_id})
    return web.json_response({"ok": True, "best": result["best"], "is_record": result["is_record"],
        "plays": result["plays"], "soft_reward": soft_reward, "xp_reward": xp_reward,
        "hard_reward": hard_reward, "wallet": wallet, "top": items})

def _bs_make_result_for(game, user_id):
    winner = game.get("winner") or 0; bet = game.get("bet") or 0
    if winner == 0: return {"outcome": "draw", "reward": 0, "loss": 0, "wallet": wallet_get(user_id)}
    if winner == user_id: return {"outcome": "win", "reward": bet, "loss": 0, "wallet": wallet_get(user_id)}
    return {"outcome": "lose", "reward": 0, "loss": bet, "wallet": wallet_get(user_id)}

async def api_bs_create(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: bet = int(body.get("bet", 0))
    except: bet = 0
    if bet not in BS_BET_OPTIONS: return web.json_response({"error": "bad_bet"}, status=400)
    _ensure_user(user_id); _bs_cleanup_stale_games(); _bs_cancel_any_waiting(user_id)
    active = _bs_user_in_active_game(user_id)
    if active: return web.json_response({"error": "already_in_game", "game_id": active}, status=400)
    w = wallet_get(user_id)
    if (w.get("shift") or 0) < bet: return web.json_response({"error": "not_enough_soft"}, status=400)
    if not wallet_consume(user_id, "shift", bet):
        return web.json_response({"error": "consume_failed"}, status=500)
    game_id = _bs_new_game_id(); code = _bs_new_code()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""INSERT INTO bs_games (game_id, code, p1_id, p2_id, bet, status, turn,
        p1_ships, p2_ships, p1_ready, p2_ready, p1_shots, p2_shots, winner, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, 'waiting', 1, NULL, NULL, 0, 0, '[]', '[]', 0, ?, ?)""",
        (game_id, code, user_id, bet, _bs_now(), _bs_now()))
    conn.commit(); conn.close()
    return web.json_response({"ok": True, "status": "waiting", "game_id": game_id,
        "code": code, "bet": bet, "wallet": wallet_get(user_id)})

async def api_bs_join(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    code = (body.get("code") or "").strip()
    if not code or len(code) != 6 or not code.isdigit():
        return web.json_response({"error": "bad_code"}, status=400)
    _ensure_user(user_id); _bs_cleanup_stale_games()
    active = _bs_user_in_active_game(user_id)
    if active: return web.json_response({"error": "already_in_game"}, status=400)
    game = _bs_get_game_by_code(code)
    if not game: return web.json_response({"error": "not_found"}, status=404)
    if game["p1_id"] == user_id: return web.json_response({"error": "self_join"}, status=400)
    if game["status"] != "waiting": return web.json_response({"error": "not_waiting"}, status=400)
    bet = game["bet"] or 0
    w = wallet_get(user_id)
    if (w.get("shift") or 0) < bet: return web.json_response({"error": "not_enough_soft"}, status=400)
    if not wallet_consume(user_id, "shift", bet):
        return web.json_response({"error": "consume_failed"}, status=500)
    _bs_update_game(game["game_id"], p2_id=user_id, status="placing", turn=1)
    return web.json_response({"ok": True, "game_id": game["game_id"],
        "opponent_name": _bs_get_user_name(game["p1_id"]), "bet": bet, "side": 2,
        "wallet": wallet_get(user_id)})

async def api_bs_find(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: bet = int(body.get("bet", 0))
    except: bet = 0
    if bet not in BS_BET_OPTIONS: return web.json_response({"error": "bad_bet"}, status=400)
    _ensure_user(user_id); _bs_cleanup_stale_games(); _bs_cancel_any_waiting(user_id)
    active = _bs_user_in_active_game(user_id)
    if active: return web.json_response({"error": "already_in_game"}, status=400)
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT game_id, p1_id FROM bs_games WHERE status='waiting' AND bet=? AND p1_id != ? ORDER BY created_at ASC LIMIT 1",
        (bet, user_id)).fetchone()
    conn.close()
    if row:
        game_id, p1_id = row
        w = wallet_get(user_id)
        if (w.get("shift") or 0) < bet: return web.json_response({"error": "not_enough_soft"}, status=400)
        if not wallet_consume(user_id, "shift", bet):
            return web.json_response({"error": "consume_failed"}, status=500)
        _bs_update_game(game_id, p2_id=user_id, status="placing", turn=1)
        return web.json_response({"ok": True, "status": "matched", "game_id": game_id,
            "opponent_name": _bs_get_user_name(p1_id), "bet": bet, "side": 2,
            "wallet": wallet_get(user_id)})
    w = wallet_get(user_id)
    if (w.get("shift") or 0) < bet: return web.json_response({"error": "not_enough_soft"}, status=400)
    if not wallet_consume(user_id, "shift", bet):
        return web.json_response({"error": "consume_failed"}, status=500)
    game_id = _bs_new_game_id(); code = _bs_new_code()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""INSERT INTO bs_games (game_id, code, p1_id, p2_id, bet, status, turn,
        p1_ships, p2_ships, p1_ready, p2_ready, p1_shots, p2_shots, winner, created_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, 'waiting', 1, NULL, NULL, 0, 0, '[]', '[]', 0, ?, ?)""",
        (game_id, code, user_id, bet, _bs_now(), _bs_now()))
    conn.commit(); conn.close()
    return web.json_response({"ok": True, "status": "queued", "game_id": game_id,
        "code": code, "bet": bet, "wallet": wallet_get(user_id)})

async def api_bs_ready(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    game_id = (body.get("game_id") or "").strip(); ships = body.get("ships") or []
    if not game_id: return web.json_response({"error": "no_game"}, status=400)
    if not _bs_validate_ships(ships): return web.json_response({"error": "bad_ships"}, status=400)
    game = _bs_get_game(game_id)
    if not game: return web.json_response({"error": "not_found"}, status=404)
    side = _bs_player_side(game, user_id)
    if side == 0: return web.json_response({"error": "not_in_game"}, status=403)
    ships_json = json.dumps(ships, ensure_ascii=False)
    if side == 1: _bs_update_game(game_id, p1_ships=ships_json, p1_ready=1)
    else: _bs_update_game(game_id, p2_ships=ships_json, p2_ready=1)
    game = _bs_get_game(game_id)
    if game["p1_ready"] and game["p2_ready"] and game["status"] == "placing":
        first = random.choice([1, 2])
        _bs_update_game(game_id, status="playing", turn=first)
    game = _bs_get_game(game_id)
    return web.json_response({"ok": True,
        "status": "playing" if game["status"] == "playing" else "waiting",
        "your_turn": (game["turn"] == side) if game["status"] == "playing" else False})

async def api_bs_state(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    game_id = request.query.get("game_id", "")
    if not game_id: return web.json_response({"error": "no_game"}, status=400)
    game = _bs_get_game(game_id)
    if not game: return web.json_response({"error": "not_found"}, status=404)
    side = _bs_player_side(game, user_id)
    if side == 0: return web.json_response({"error": "not_in_game"}, status=403)
    if game["status"] == "finished":
        return web.json_response({"status": "finished", "result": _bs_make_result_for(game, user_id)})
    my_shots = json.loads(game["p1_shots"] if side == 1 else game["p2_shots"])
    enemy_shots_raw = json.loads(game["p2_shots"] if side == 1 else game["p1_shots"])
    enemy_ships_json = game["p2_ships"] if side == 1 else game["p1_ships"]
    enemy_ships = json.loads(enemy_ships_json) if enemy_ships_json else []
    my_ships_json = game["p1_ships"] if side == 1 else game["p2_ships"]
    my_ships = json.loads(my_ships_json) if my_ships_json else []
    my_shots_out = []
    for sh in my_shots:
        x = sh.get("x"); y = sh.get("y"); result = "miss"
        for s in enemy_ships:
            if any(c[0] == x and c[1] == y for c in s["cells"]):
                sunk = all(any(sh2.get("x") == c[0] and sh2.get("y") == c[1] for sh2 in my_shots) for c in s["cells"])
                result = "sunk" if sunk else "hit"
                break
        my_shots_out.append({"x": x, "y": y, "result": result})
    enemy_shots_out = []
    for sh in enemy_shots_raw:
        x = sh.get("x"); y = sh.get("y"); result = "miss"
        for s in my_ships:
            if any(c[0] == x and c[1] == y for c in s["cells"]):
                sunk = all(any(sh2.get("x") == c[0] and sh2.get("y") == c[1] for sh2 in enemy_shots_raw) for c in s["cells"])
                result = "sunk" if sunk else "hit"
                break
        enemy_shots_out.append({"x": x, "y": y, "result": result})
    opponent = game["p2_id"] if side == 1 else game["p1_id"]
    opponent_name = _bs_get_user_name(opponent) if opponent else ""
    log = [{"type": "miss", "text": f"Враг: ({sh.get('x',0)+1},{sh.get('y',0)+1})"} for sh in enemy_shots_raw[-3:]]
    return web.json_response({"status": "playing" if game["status"] == "playing" else game["status"],
        "your_turn": game["turn"] == side, "my_ships": my_ships, "my_shots": my_shots_out,
        "enemy_shots": enemy_shots_out, "enemy_ships": enemy_ships if game["status"] == "finished" else None,
        "opponent_name": opponent_name, "log": log})

async def api_bs_fire(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    game_id = (body.get("game_id") or "").strip()
    try:
        x = int(body.get("x")); y = int(body.get("y"))
    except: return web.json_response({"error": "bad_coords"}, status=400)
    if x < 0 or x > 9 or y < 0 or y > 9: return web.json_response({"error": "bad_coords"}, status=400)
    game = _bs_get_game(game_id)
    if not game: return web.json_response({"error": "not_found"}, status=404)
    side = _bs_player_side(game, user_id)
    if side == 0: return web.json_response({"error": "not_in_game"}, status=403)
    if game["status"] != "playing": return web.json_response({"error": "not_playing"}, status=400)
    if game["turn"] != side: return web.json_response({"error": "not_your_turn"}, status=400)
    if side == 1:
        my_shots = json.loads(game["p1_shots"]); enemy_ships_json = game["p2_ships"]
    else:
        my_shots = json.loads(game["p2_shots"]); enemy_ships_json = game["p1_ships"]
    enemy_ships = json.loads(enemy_ships_json) if enemy_ships_json else []
    if any(sh.get("x") == x and sh.get("y") == y for sh in my_shots):
        return web.json_response({"error": "already_fired"}, status=400)
    hit_ship = None
    for s in enemy_ships:
        if any(c[0] == x and c[1] == y for c in s["cells"]): hit_ship = s; break
    if hit_ship is None:
        my_shots.append({"x": x, "y": y})
        turn_after = 2 if side == 1 else 1
        result_type = "miss"; sunk_cells = None
    else:
        my_shots.append({"x": x, "y": y})
        sunk = all(any(sh.get("x") == c[0] and sh.get("y") == c[1] for sh in my_shots) for c in hit_ship["cells"])
        if sunk: result_type = "sunk"; sunk_cells = [[c[0], c[1]] for c in hit_ship["cells"]]
        else: result_type = "hit"; sunk_cells = None
        turn_after = side
    if side == 1: _bs_update_game(game_id, p1_shots=json.dumps(my_shots), turn=turn_after)
    else: _bs_update_game(game_id, p2_shots=json.dumps(my_shots), turn=turn_after)
    winner = 0
    if _bs_check_win(enemy_ships, my_shots): winner = user_id
    if winner:
        _bs_finish_game(game_id, winner)
        game = _bs_get_game(game_id)
        check_and_award_achievements(winner)
        return web.json_response({"ok": True, "result": result_type, "sunk_ship": sunk_cells,
            "your_turn": False, "status": "finished", "result_data": _bs_make_result_for(game, user_id)})
    game = _bs_get_game(game_id)
    return web.json_response({"ok": True, "result": result_type, "sunk_ship": sunk_cells,
        "your_turn": game["turn"] == side, "status": "playing"})

async def api_bs_surrender(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    game_id = (body.get("game_id") or "").strip()
    game = _bs_get_game(game_id)
    if not game: return web.json_response({"error": "not_found"}, status=404)
    side = _bs_player_side(game, user_id)
    if side == 0: return web.json_response({"error": "not_in_game"}, status=403)
    if game["status"] == "finished": return web.json_response({"error": "already_finished"}, status=400)
    opponent = game["p2_id"] if side == 1 else game["p1_id"]
    _bs_finish_game(game_id, opponent, surrender_by=user_id)
    game = _bs_get_game(game_id)
    return web.json_response({"ok": True, "result": _bs_make_result_for(game, user_id)})

async def api_bs_cancel(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    game_id = (body.get("game_id") or "").strip()
    game = _bs_get_game(game_id)
    if not game: return web.json_response({"ok": True})
    side = _bs_player_side(game, user_id)
    if side == 0: return web.json_response({"error": "not_in_game"}, status=403)
    if game["status"] in ("waiting", "placing"):
        bet = game["bet"] or 0
        if game["p1_id"]: wallet_add(game["p1_id"], shift=bet)
        if game["p2_id"]: wallet_add(game["p2_id"], shift=bet)
        _bs_delete_game(game_id)
        return web.json_response({"ok": True, "wallet": wallet_get(user_id)})
    return web.json_response({"error": "cant_cancel"}, status=400)

async def api_bs_bot_start(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: bet = int(body.get("bet", 0))
    except: bet = 0
    if bet not in BS_BET_OPTIONS: return web.json_response({"error": "bad_bet"}, status=400)
    _ensure_user(user_id)
    w = wallet_get(user_id)
    if (w.get("shift") or 0) < bet: return web.json_response({"error": "not_enough_soft"}, status=400)
    if not wallet_consume(user_id, "shift", bet):
        return web.json_response({"error": "consume_failed"}, status=500)
    return web.json_response({"ok": True, "bet": bet, "wallet": wallet_get(user_id)})

async def api_bs_finish_bot(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    outcome = (body.get("outcome") or "").strip()
    try: bet = int(body.get("bet", 0))
    except: bet = 0
    if outcome not in ("win", "lose", "draw"): return web.json_response({"error": "bad_outcome"}, status=400)
    if bet not in BS_BET_OPTIONS: bet = 0
    _ensure_user(user_id)
    reward = 0; loss = 0
    if outcome == "win": wallet_add(user_id, shift=bet * 2, xp=30); reward = bet
    elif outcome == "lose": loss = bet
    elif outcome == "draw": wallet_add(user_id, shift=bet)
    check_and_award_achievements(user_id)
    return web.json_response({"ok": True, "reward": reward, "loss": loss, "wallet": wallet_get(user_id)})

def _find_or_download_pdf_font():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "fonts", "DejaVuSans.ttf"),
        os.path.join(base_dir, "webapp", "fonts", "DejaVuSans.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "fonts/DejaVuSans.ttf"]
    for p in candidates:
        if os.path.isfile(p): return p
    try:
        target_dir = os.path.join(base_dir, "fonts"); os.makedirs(target_dir, exist_ok=True)
        target = os.path.join(target_dir, "DejaVuSans.ttf")
        import urllib.request
        urls = [
            "https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/master/ttf/DejaVuSans.ttf",
            "https://cdn.jsdelivr.net/gh/dejavu-fonts/dejavu-fonts@master/ttf/DejaVuSans.ttf"]
        for url in urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=45) as resp:
                    data = resp.read()
                    if len(data) > 100000:
                        with open(target, "wb") as f: f.write(data)
                        logging.info(f"[PDF FONT] скачан: {target}")
                        return target
            except Exception as e:
                logging.warning(f"[PDF FONT] {url}: {e}")
    except Exception as e:
        logging.warning(f"[PDF FONT] {e}")
    return None

def _pdf_short(text, limit=120):
    if not text: return ""
    s = str(text).replace("\r", "").strip()
    if len(s) > limit: s = s[:limit - 1] + "…"
    return s

def generate_user_pdf(user_id):
    if not _FPDF_AVAILABLE: raise RuntimeError("fpdf2 не установлена")
    font_path = _find_or_download_pdf_font()
    if not font_path: raise RuntimeError("Не удалось найти шрифт для PDF")
    data = get_export_data(user_id)
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_font("Main", "", font_path)
    pdf.set_font("Main", size=11); pdf.add_page()

    def hr():
        pdf.set_draw_color(200, 200, 200); pdf.set_line_width(0.2)
        y = pdf.get_y(); pdf.line(15, y, 195, y); pdf.ln(3)

    def section(title):
        pdf.ln(3); pdf.set_font("Main", size=14); pdf.set_text_color(0, 180, 160)
        pdf.cell(0, 8, title, ln=True)
        pdf.set_text_color(0, 0, 0); pdf.set_font("Main", size=11); hr()

    pdf.set_font("Main", size=22); pdf.cell(0, 12, "Student IRK", ln=True)
    pdf.set_font("Main", size=10); pdf.set_text_color(120, 120, 120)
    now_str = _now_irkutsk().strftime("%d.%m.%Y в %H:%M")
    pdf.cell(0, 6, f"Отчёт от {now_str}", ln=True)
    pdf.set_text_color(0, 0, 0); pdf.ln(4)
    pdf.set_font("Main", size=12)
    name = data.get("first_name") or "Не указано"
    uname = data.get("username")
    if uname: name = f"{name} (@{uname})"
    pdf.cell(0, 7, f"Пользователь: {name}", ln=True)
    pdf.set_font("Main", size=11)
    pdf.cell(0, 6, f"ID: {user_id}", ln=True)
    if data.get("group"):
        g = data["group"]
        if data.get("subgroup"): g += f" · подгруппа {data['subgroup']}"
        pdf.cell(0, 6, f"Группа: {g}", ln=True)
    tasks = data.get("tasks", [])
    section(f"Задачи ({len(tasks)})")
    if not tasks: pdf.cell(0, 6, "Нет задач", ln=True)
    else:
        prio_map = {1: "низкий", 2: "средний", 3: "высокий"}
        for t in tasks:
            mark = "[v]" if t["done"] else "[ ]"
            pdf.set_font("Main", size=11)
            pdf.multi_cell(0, 5.5, f"{mark} {_pdf_short(t['text'], 100)}")
            meta = []
            if t.get("due_date"):
                due = f"до {t['due_date']}"
                if t.get("due_time"): due += f" {t['due_time']}"
                meta.append(due)
            meta.append(f"приоритет: {prio_map.get(t.get('priority', 2), 'средний')}")
            pdf.set_font("Main", size=9); pdf.set_text_color(130, 130, 130)
            pdf.cell(0, 5, "    " + " · ".join(meta), ln=True)
            pdf.set_text_color(0, 0, 0); pdf.set_font("Main", size=11)
    notes = data.get("notes", [])
    section(f"Заметки ({len(notes)})")
    if not notes: pdf.cell(0, 6, "Нет заметок", ln=True)
    else:
        for n in notes:
            pdf.set_font("Main", size=11); pdf.multi_cell(0, 5.5, f"{n['subject']}:")
            pdf.set_font("Main", size=10); pdf.set_text_color(70, 70, 70)
            pdf.multi_cell(0, 5, "    " + _pdf_short(n["text"], 400))
            pdf.set_text_color(0, 0, 0); pdf.ln(1)
    section("Стипендия")
    amount = data.get("scholarship_amount")
    if amount is None or amount == 0: pdf.cell(0, 6, "Сумма не указана", ln=True)
    else: pdf.cell(0, 6, f"Сумма: {amount} руб./мес", ln=True)
    grades = data.get("grades", [])
    if grades:
        avg = sum(g["grade"] for g in grades) / len(grades)
        pdf.cell(0, 6, f"Средний балл: {avg:.2f} ({len(grades)} предметов)", ln=True)
        for g in grades:
            auto = " (автомат)" if g.get("is_auto") else ""
            sem = f" · {g['semester']}" if g.get("semester") else ""
            pdf.cell(0, 5.5, f"  {g['subject']}: {g['grade']}{auto}{sem}", ln=True)
    else: pdf.cell(0, 6, "Оценок нет", ln=True)
    att = data.get("attendance", {}); total = sum(att.values())
    section(f"Посещаемость ({total})")
    if total == 0: pdf.cell(0, 6, "Отметок нет", ln=True)
    else:
        pdf.cell(0, 6, f"Посещено: {att.get('was', 0)}", ln=True)
        pdf.cell(0, 6, f"Пропущено: {att.get('missed', 0)}", ln=True)
        pdf.cell(0, 6, f"По болезни: {att.get('sick', 0)}", ln=True)
        pdf.cell(0, 6, f"Уважительная: {att.get('excused', 0)}", ln=True)
    pdf.ln(6); hr()
    pdf.set_font("Main", size=9); pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 5, "Сгенерировано Student IRK", ln=True, align="C")
    out = pdf.output()
    if isinstance(out, str): out = out.encode("latin-1")
    return bytes(out)

async def api_export(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: pdf_bytes = await asyncio.to_thread(generate_user_pdf, user_id)
    except Exception as e:
        return web.json_response({"error": "pdf_failed", "message": str(e)}, status=500)
    date_str = _now_irkutsk().strftime("%Y-%m-%d")
    try:
        doc = BufferedInputFile(pdf_bytes, filename=f"student_irk_{date_str}.pdf")
        await bot.send_document(user_id, doc, caption="Твой отчёт Student IRK.")
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

def _admin_only(init_data):
    user_id = _verify_webapp_init(init_data)
    if not user_id or user_id != ADMIN_ID: return None
    return user_id

async def api_admin_stats(request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data): return web.json_response({"error": "forbidden"}, status=403)
    return web.json_response({"total_users": get_total_users(), "vip_count": 0,
        "pending_feedback": len(get_pending_feedback())})

async def api_admin_feedback_list(request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data): return web.json_response({"error": "forbidden"}, status=403)
    rows = get_pending_feedback()
    return web.json_response({"items": [{"id": fid, "user_id": uid, "username": uname,
        "text": text, "created": created, "status": status}
        for fid, uid, uname, text, created, status in rows]})

async def api_admin_feedback_reply(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")): return web.json_response({"error": "forbidden"}, status=403)
    fid = int(body.get("id", 0)); reply = (body.get("text") or "").strip()
    if not fid or not reply: return web.json_response({"error": "empty"}, status=400)
    row = get_feedback_by_id(fid)
    if not row: return web.json_response({"error": "not_found"}, status=404)
    _, target_uid, _, _ = row
    try:
        await bot.send_message(target_uid, f"Ответ администратора на обращение #{fid}:\n\n{reply}")
        mark_feedback_answered(fid, reply)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

async def api_admin_feedback_postpone(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")): return web.json_response({"error": "forbidden"}, status=403)
    fid = int(body.get("id", 0))
    if not fid: return web.json_response({"error": "no_id"}, status=400)
    set_feedback_status(fid, "postponed")
    return web.json_response({"ok": True})

async def api_admin_broadcast(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")): return web.json_response({"error": "forbidden"}, status=403)
    text = (body.get("text") or "").strip()
    if not text: return web.json_response({"error": "empty"}, status=400)
    async def _run():
        user_ids = get_all_user_ids()
        sent = failed = 0
        for uid in user_ids:
            try: await bot.send_message(uid, text); sent += 1
            except: failed += 1
            await asyncio.sleep(0.05)
        logging.info(f"[BROADCAST] {sent} ok, {failed} fail")
    asyncio.create_task(_run())
    return web.json_response({"ok": True, "started": True})

async def api_admin_monitor(request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data): return web.json_response({"error": "forbidden"}, status=403)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://www.istu.edu/raspisanie/",
                timeout=aiohttp.ClientTimeout(total=15),
                headers={"User-Agent": "Mozilla/5.0"}) as response:
                return web.json_response({"status": response.status, "ok": response.status == 200})
    except Exception as e:
        return web.json_response({"status": 0, "ok": False, "error": str(e)})

async def start_webapp():
    port = int(os.getenv("PORT", "3000"))
    base_dir = os.path.dirname(os.path.abspath(__file__))
    possible_paths = [os.path.join(base_dir, "webapp"), os.path.join(os.getcwd(), "webapp"),
        "/app/webapp", "webapp"]
    webapp_dir = None
    for p in possible_paths:
        if os.path.isdir(p): webapp_dir = p; break
    app = web.Application()
    app.router.add_get("/api/schedule", api_schedule)
    app.router.add_get("/api/week", api_week)
    app.router.add_get("/api/me", api_me)
    app.router.add_get("/api/wallet", api_wallet)
    app.router.add_post("/api/set-name", api_set_name)
    app.router.add_post("/api/set-avatar", api_set_avatar)
    app.router.add_post("/api/exchange-soft-to-hard", api_exchange)
    app.router.add_get("/api/groups", api_groups)
    app.router.add_post("/api/set-group", api_set_group)
    app.router.add_post("/api/set-subgroup", api_set_subgroup)
    app.router.add_get("/api/tasks", api_tasks)
    app.router.add_post("/api/task-add", api_task_add)
    app.router.add_post("/api/task-update", api_task_update)
    app.router.add_post("/api/task-delete", api_task_delete)
    app.router.add_post("/api/task-clear", api_task_clear)
    app.router.add_get("/api/notes", api_notes)
    app.router.add_post("/api/note-save", api_note_save)
    app.router.add_post("/api/note-delete", api_note_delete)
    app.router.add_post("/api/notify-set", api_notify_set)
    app.router.add_post("/api/notify-set-before", api_notify_set_before)
    app.router.add_get("/api/quote", api_quote)
    app.router.add_post("/api/quote-subscribe", api_quote_subscribe)
    app.router.add_get("/api/scholarship", api_scholarship)
    app.router.add_post("/api/scholarship-set-amount", api_scholarship_set_amount)
    app.router.add_post("/api/scholarship-add-grade", api_scholarship_add_grade)
    app.router.add_post("/api/scholarship-update-grade", api_scholarship_update_grade)
    app.router.add_post("/api/scholarship-delete-grade", api_scholarship_delete_grade)
    app.router.add_post("/api/scholarship-clear", api_scholarship_clear)
    app.router.add_post("/api/attendance-set", api_attendance_set)
    app.router.add_get("/api/game/info", api_game_info)
    app.router.add_post("/api/game/submit", api_game_submit)
    app.router.add_post("/api/bs/create", api_bs_create)
    app.router.add_post("/api/bs/join", api_bs_join)
    app.router.add_post("/api/bs/find", api_bs_find)
    app.router.add_post("/api/bs/ready", api_bs_ready)
    app.router.add_get("/api/bs/state", api_bs_state)
    app.router.add_post("/api/bs/fire", api_bs_fire)
    app.router.add_post("/api/bs/surrender", api_bs_surrender)
    app.router.add_post("/api/bs/cancel", api_bs_cancel)
    app.router.add_post("/api/bs/bot-start", api_bs_bot_start)
    app.router.add_post("/api/bs/finish-bot", api_bs_finish_bot)
    app.router.add_get("/api/ai/history", api_ai_history)
    app.router.add_post("/api/ai/clear-history", api_ai_clear_history)
    app.router.add_post("/api/ai", api_ai)
    app.router.add_post("/api/ai-photo", api_ai_photo)
    app.router.add_post("/api/feedback", api_feedback)
    app.router.add_get("/api/feedback/my", api_feedback_my)
    app.router.add_post("/api/export", api_export)
    app.router.add_get("/api/chest/status", api_chest_status)
    app.router.add_post("/api/chest/open", api_chest_open)
    app.router.add_get("/api/achievements", api_achievements)
    app.router.add_post("/api/achievement-claim", api_achievement_claim)
    app.router.add_get("/api/level-rewards", api_level_rewards)
    app.router.add_post("/api/level-reward-claim", api_level_reward_claim)
    app.router.add_get("/api/wallet/leaderboard", api_wallet_leaderboard)
    app.router.add_get("/api/admin/stats", api_admin_stats)
    app.router.add_get("/api/admin/feedback-list", api_admin_feedback_list)
    app.router.add_post("/api/admin/feedback-reply", api_admin_feedback_reply)
    app.router.add_post("/api/admin/feedback-postpone", api_admin_feedback_postpone)
    app.router.add_post("/api/admin/broadcast", api_admin_broadcast)
    app.router.add_get("/api/admin/monitor", api_admin_monitor)
    if webapp_dir:
        NO_CACHE = {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
        async def index_handler(request):
            p = os.path.join(webapp_dir, "index.html")
            if os.path.isfile(p):
                return web.FileResponse(p, headers=NO_CACHE)
            return web.Response(text="not found", status=404)
        async def style_handler(request):
            p = os.path.join(webapp_dir, "style.css")
            if os.path.isfile(p):
                return web.FileResponse(p, headers={**NO_CACHE, "Content-Type": "text/css"})
            return web.Response(status=404)
        async def appjs_handler(request):
            p = os.path.join(webapp_dir, "app.js")
            if os.path.isfile(p):
                return web.FileResponse(p, headers={**NO_CACHE, "Content-Type": "application/javascript"})
            return web.Response(status=404)
        async def asset_handler(request):
            name = request.match_info.get("name", "")
            safe_name = os.path.basename(name)
            if not safe_name or safe_name.startswith("."):
                return web.Response(status=404)
            p = os.path.join(webapp_dir, "assets", safe_name)
            if os.path.isfile(p):
                return web.FileResponse(p, headers=NO_CACHE)
            return web.Response(status=404)
        async def favicon_handler(request): return web.Response(status=204)
        app.router.add_get("/", index_handler)
        app.router.add_get("/index.html", index_handler)
        app.router.add_get("/style.css", style_handler)
        app.router.add_get("/app.js", appjs_handler)
        app.router.add_get("/assets/{name}", asset_handler)
        app.router.add_get("/favicon.ico", favicon_handler)
    else:
        async def root(request): return web.Response(text="webapp not found", status=404)
        app.router.add_get("/", root)
    runner = web.AppRunner(app); await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port); await site.start()
    logging.info(f"[WEB] на 0.0.0.0:{port}")

@dp.message(CommandStart())
async def cmd_start(message: Message):
    _ensure_user(message.from_user.id)
    try: _update_user_meta(message.from_user.id, message.from_user.username, message.from_user.first_name)
    except: pass
    if not WEBAPP_URL:
        await message.answer("Приложение ещё не настроено."); return
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]])
    await message.answer("Привет! Открой приложение.", reply_markup=kb)

@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID: await message.answer("Только для админа."); return
    await message.answer("АДМИН-КОМАНДЫ:\n/backup — прислать users.db\n/restore — восстановить базу\n/admin — справка")

@dp.message(Command("backup"))
async def cmd_backup(message: Message):
    if message.from_user.id != ADMIN_ID: return
    try:
        total = get_total_users()
        doc = FSInputFile(DB_PATH, filename="users_backup.db")
        await message.answer_document(doc, caption=f"Резервная копия. Всего: {total}")
    except Exception as e: await message.answer(f"Ошибка: {e}")

@dp.message(Command("restore"))
async def cmd_restore(message: Message):
    if message.from_user.id != ADMIN_ID: return
    if not message.document: await message.answer("Пришли .db с /restore."); return
    try:
        file = await bot.get_file(message.document.file_id)
        await bot.download_file(file.file_path, DB_PATH)
        init_db()
        await message.answer(f"База восстановлена. Всего: {get_total_users()}")
    except Exception as e: await message.answer(f"Ошибка: {e}")

async def send_schedule_notification(user_id, group_id, subgroup, ntype):
    try:
        today = _now_irkutsk()
        target_date = today + timedelta(days=1) if ntype == "tomorrow" else today
        monday = _monday_of_week(target_date)
        html = await fetch_week_html(group_id, monday, use_cache=True)
        if not html: return
        _, days = parse_schedule(html)
        target_str = target_date.strftime("%d.%m.%Y")
        day = next((d for d in days if d["date"] == target_str), None)
        label = "Сегодня" if ntype == "today" else "Завтра"
        header = f"{label}, {target_str}"
        if not day:
            await bot.send_message(user_id, f"{header}\n\nНе удалось загрузить.", parse_mode=None); return
        lessons = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
        if not lessons:
            await bot.send_message(user_id, f"{header}\n\nЗанятий нет.", parse_mode=None); return
        lines = [header, ""]
        for les in lessons:
            time_end = LESSON_TIMES.get(les["time"], "")
            time_str = f"{les['time']}–{time_end}" if time_end else les["time"]
            lines.append(time_str); lines.append(les["subject"])
            details = []
            if les.get("type"): details.append(les["type"])
            if les.get("auditorium"): details.append(f"ауд. {les['auditorium']}")
            if les.get("teacher"): details.append(les["teacher"])
            if details: lines.append(f"{' · '.join(details)}")
            lines.append("")
        await bot.send_message(user_id, "\n".join(lines), parse_mode=None)
    except Exception as e: logging.error(f"[NOTIFY] user={user_id}: {e}")

async def send_lesson_reminder(user_id, les, before_min):
    try:
        subject = les.get("subject", "Пара"); time_str = les.get("time", "")
        text = f"Через {before_min} мин — {subject}"
        if time_str: text += f" в {time_str}"
        details = []
        if les.get("auditorium"): details.append(f"ауд. {les['auditorium']}")
        if les.get("teacher"): details.append(les["teacher"])
        if details: text += "\n" + " · ".join(details)
        await bot.send_message(user_id, text, parse_mode=None)
    except Exception as e: logging.error(f"[REMIND] user={user_id}: {e}")

async def send_daily_quotes():
    subs = daily_get_all_subscribers()
    if not subs: return
    quote = random.choice(DAILY_QUOTES)
    text = f"Цитата дня\n\n{quote}"
    for uid in subs:
        try: await bot.send_message(uid, text, parse_mode=None)
        except: pass
        await asyncio.sleep(0.05)

async def notification_worker():
    last_quote_date = None
    while True:
        try:
            now = _now_irkutsk(); today_str = now.strftime("%Y-%m-%d")
            hh, mm = now.hour, now.minute
            for uid, gid, subgroup, ntype, nh, nm in get_users_for_notification():
                if nh == hh and nm == mm:
                    await send_schedule_notification(uid, gid, subgroup, ntype)
            if hh == 10 and mm == 0 and last_quote_date != today_str:
                last_quote_date = today_str
                await send_daily_quotes()
        except: logging.exception("[NOTIFY]")
        await asyncio.sleep(60 - datetime.now().second)

async def lesson_reminder_worker():
    sent_keys = set()
    while True:
        try:
            now = _now_irkutsk(); today_str = now.strftime("%d.%m.%Y")
            if len(sent_keys) > 20000: sent_keys.clear()
            html_cache = {}
            for uid, gid, subgroup, before_min in get_users_for_lesson_reminder():
                try:
                    monday = _monday_of_week(now)
                    key_cache = (gid, monday.strftime("%Y-%m-%d"))
                    if key_cache in html_cache: html = html_cache[key_cache]
                    else:
                        html = await fetch_week_html(gid, monday, use_cache=True)
                        html_cache[key_cache] = html
                    if not html: continue
                    _, days = parse_schedule(html)
                    day = next((d for d in days if d["date"] == today_str), None)
                    if not day: continue
                    lessons = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
                    for les in lessons:
                        time_str = les.get("time", "")
                        if not time_str or ":" not in time_str: continue
                        try:
                            hh_s, mm_s = time_str.split(":")
                            lesson_dt = now.replace(hour=int(hh_s), minute=int(mm_s), second=0, microsecond=0)
                        except: continue
                        delta_min = (lesson_dt - now).total_seconds() / 60
                        if abs(delta_min - before_min) < 1:
                            key = (uid, today_str, time_str, before_min)
                            if key in sent_keys: continue
                            sent_keys.add(key)
                            await send_lesson_reminder(uid, les, before_min)
                except: pass
        except: logging.exception("[REMIND]")
        await asyncio.sleep(60)

async def check_schedule_changes():
    users = get_users_for_change_tracking()
    if not users: return
    html_cache = {}; now = _now_irkutsk()
    for uid, group_id, subgroup in users:
        try:
            for offset in (0, 1):
                target_monday = _monday_of_week(now) + timedelta(days=7 * offset)
                week_start_str = target_monday.strftime("%Y-%m-%d")
                cache_key = (group_id, week_start_str)
                if cache_key in html_cache: html = html_cache[cache_key]
                else:
                    html = await fetch_week_html(group_id, target_monday, use_cache=False)
                    html_cache[cache_key] = html
                if not html: continue
                _, days = parse_schedule(html)
                new_snap = make_snapshot_str(days)
                old_snap = get_snapshot(group_id, week_start_str)
                if old_snap is None:
                    save_snapshot(group_id, week_start_str, new_snap); continue
                if old_snap != new_snap:
                    save_snapshot(group_id, week_start_str, new_snap)
                    label = "текущей" if offset == 0 else "следующей"
                    try:
                        await bot.send_message(uid, f"Изменения в расписании\n\nОбнаружены правки на {label} неделе.", parse_mode=None)
                    except: pass
        except: pass

async def change_worker():
    await asyncio.sleep(180)
    while True:
        try: await check_schedule_changes()
        except: logging.exception("[CHANGE]")
        await asyncio.sleep(1800)

async def bs_cleanup_worker():
    while True:
        try: _bs_cleanup_stale_games()
        except: pass
        await asyncio.sleep(600)

async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s",
        stream=sys.stdout, force=True)
    init_db()
    await bot.delete_webhook(drop_pending_updates=True)
    try:
        if _FPDF_AVAILABLE: await asyncio.to_thread(_find_or_download_pdf_font)
    except: pass
    asyncio.create_task(start_webapp())
    asyncio.create_task(notification_worker())
    asyncio.create_task(lesson_reminder_worker())
    asyncio.create_task(change_worker())
    asyncio.create_task(bs_cleanup_worker())
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
