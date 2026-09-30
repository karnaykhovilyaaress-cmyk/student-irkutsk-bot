from dotenv import load_dotenv
load_dotenv()

import os
import asyncio
import re
import sys
import json
import base64
import random
import sqlite3
import logging
from datetime import datetime, timedelta, timezone
import aiohttp
from aiohttp import web
from bs4 import BeautifulSoup
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, FSInputFile, WebAppInfo
)
from aiogram.utils.web_app import safe_parse_webapp_init_data


# ============================================================
# ОЧИСТКА LATEX / MARKDOWN
# ============================================================
def clean_latex(text: str) -> str:
    if not text:
        return text
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
    greek = {
        r"\\alpha": "α", r"\\beta": "β", r"\\gamma": "γ", r"\\delta": "δ",
        r"\\epsilon": "ε", r"\\theta": "θ", r"\\lambda": "λ",
        r"\\mu": "μ", r"\\nu": "ν", r"\\pi": "π",
        r"\\rho": "ρ", r"\\sigma": "σ", r"\\tau": "τ",
        r"\\phi": "φ", r"\\varphi": "φ", r"\\chi": "χ", r"\\psi": "ψ",
        r"\\omega": "ω", r"\\Gamma": "Γ", r"\\Delta": "Δ", r"\\Theta": "Θ",
        r"\\Lambda": "Λ", r"\\Pi": "Π", r"\\Sigma": "Σ",
        r"\\Phi": "Φ", r"\\Psi": "Ψ", r"\\Omega": "Ω",
    }
    for cmd, repl in greek.items():
        text = re.sub(cmd + r"\b", repl, text)
    replacements = [
        (r"\\cdot", "·"), (r"\\times", "×"), (r"\\div", "÷"),
        (r"\\pm", "±"), (r"\\leq", "≤"), (r"\\le", "≤"),
        (r"\\geq", "≥"), (r"\\ge", "≥"), (r"\\neq", "≠"),
        (r"\\approx", "≈"), (r"\\infty", "∞"),
        (r"\\sum", "Σ"), (r"\\prod", "Π"), (r"\\int", "∫"),
        (r"\\rightarrow", "→"), (r"\\to", "→"), (r"\\leftarrow", "←"),
        (r"\\Rightarrow", "⇒"), (r"\\leftrightarrow", "↔"),
        (r"\\in", "∈"), (r"\\notin", "∉"),
        (r"\\subset", "⊂"), (r"\\supset", "⊃"),
        (r"\\cup", "∪"), (r"\\cap", "∩"),
        (r"\\forall", "∀"), (r"\\exists", "∃"),
        (r"\\emptyset", "∅"), (r"\\angle", "∠"), (r"\\degree", "°"),
        (r"\\ldots", "..."), (r"\\dots", "..."), (r"\\cdots", "..."),
    ]
    for cmd, repl in replacements:
        text = re.sub(cmd, repl, text)
    text = re.sub(
        r"\\(sin|cos|tan|ctg|cot|log|ln|lg|exp|lim|max|min|arg|det|mod)\b",
        r"\1", text)
    text = re.sub(r"\\[a-zA-Z]*\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def clean_markdown(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\*(.+?)\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"```[a-zA-Z]*\n?(.+?)```", r"\1", text, flags=re.DOTALL)
    lines = text.split("\n")
    out = []
    for line in lines:
        stripped = line.strip()
        if re.fullmatch(r"\|?[\s\-:|]+\|?", stripped) and "-" in stripped:
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            cells = [c for c in cells if c]
            out.append("  ".join(cells))
        else:
            out.append(line)
    text = "\n".join(out)
    text = re.sub(r"^[\-\*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ============================================================
# НАСТРОЙКИ
# ============================================================
TOKEN = os.getenv("BOT_TOKEN", "")
GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_KEY", "")
YANDEX_VISION_API_KEY = os.getenv("YANDEX_VISION_API_KEY", "")
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID", "")
ADMIN_ID = 6014557174
ADMIN_USERNAME = "ilyaech"
BOT_USERNAME = "@student_irk38_bot"
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

REFERRAL_DAYS = 3

if not TOKEN:
    logging.error("BOT_TOKEN не задан!")
    sys.exit(1)

bot = Bot(token=TOKEN)
dp = Dispatcher()

giga_client = None
if GIGACHAT_CREDENTIALS:
    try:
        from gigachat import GigaChat
        giga_client = GigaChat(
            credentials=GIGACHAT_CREDENTIALS,
            base_url="https://api.giga.chat/v1",
            scope="GIGACHAT_API_PERS",
            verify_ssl_certs=False,
            model="GigaChat-2-Max",
            timeout=600
        )
        logging.info("GigaChat клиент инициализирован")
    except Exception as e:
        logging.error(f"GigaChat ошибка: {e}")

DB_PATH = os.getenv("DB_PATH", "users.db")
CACHE_TTL_HOURS = 2

PRIORITY_LABELS = {0: "низкий", 1: "средний", 2: "высокий"}

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
    "Отличник — это не тот, кто всё знает, а тот, кто умеет находить.",
    "Лучший конспект — это тот, который ты написал сам.",
    "Каждая пара приближает тебя к свободе. Или к дедлайну.",
    "Кто рано встаёт, тот сдаёт первым.",
    "Учиться никогда не поздно, но иногда поздно сдавать.",
    "Самое сложное в учёбе — начать.",
    "Знание — это единственное, что никто не отнимет.",
    "Не сравнивай свой путь с чужим — у каждого своя траектория.",
    "Если не понимаешь — это нормально. Если не спрашиваешь — нет.",
    "Универ не учит думать. Универ даёт материал. Думать — твоя работа.",
]


# ============================================================
# БАЗА ДАННЫХ
# ============================================================
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY, group_id TEXT, group_name TEXT,
        notify_hour INTEGER DEFAULT -1, notify_minute INTEGER DEFAULT 0,
        notify_changes INTEGER DEFAULT 0, subgroup INTEGER DEFAULT 0)""")
    for alter in [
        "ALTER TABLE users ADD COLUMN notify_changes INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN subgroup INTEGER DEFAULT 0",
    ]:
        try:
            conn.execute(alter)
        except sqlite3.OperationalError:
            pass

    conn.execute("""CREATE TABLE IF NOT EXISTS referrals (
        user_id INTEGER PRIMARY KEY,
        referrer_id INTEGER,
        created_at TEXT,
        rewarded INTEGER DEFAULT 0)""")

    conn.execute("""CREATE TABLE IF NOT EXISTS daily_subscribers (
        user_id INTEGER PRIMARY KEY,
        subscribed_at TEXT)""")

    conn.execute("""CREATE TABLE IF NOT EXISTS scholarship (
        user_id INTEGER PRIMARY KEY,
        current_amount INTEGER DEFAULT 0,
        updated_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        subject TEXT,
        grade INTEGER,
        created_at TEXT)""")

    conn.execute("""CREATE TABLE IF NOT EXISTS schedule_cache (
        group_id TEXT, week_start TEXT, html TEXT, cached_at TEXT,
        PRIMARY KEY (group_id, week_start))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS schedule_snapshots (
        group_id TEXT, week_start TEXT, snapshot TEXT, updated_at TEXT,
        PRIMARY KEY (group_id, week_start))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT,
        text TEXT, created_at TEXT, admin_msg_id INTEGER,
        status TEXT DEFAULT 'new', answered_at TEXT)""")
    for alter in [
        "ALTER TABLE feedback ADD COLUMN status TEXT DEFAULT 'new'",
        "ALTER TABLE feedback ADD COLUMN answered_at TEXT",
    ]:
        try:
            conn.execute(alter)
        except sqlite3.OperationalError:
            pass
    conn.execute("UPDATE feedback SET status='new' WHERE status IS NULL")

    conn.execute("""CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT,
        due_date TEXT, done INTEGER DEFAULT 0, created_at TEXT,
        priority INTEGER DEFAULT 1, due_time TEXT, done_at TEXT)""")
    for alter in [
        "ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 1",
        "ALTER TABLE tasks ADD COLUMN due_time TEXT",
        "ALTER TABLE tasks ADD COLUMN done_at TEXT",
    ]:
        try:
            conn.execute(alter)
        except sqlite3.OperationalError:
            pass

    conn.execute("""CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, subject TEXT,
        text TEXT, created_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS vip (
        user_id INTEGER PRIMARY KEY, expiry TEXT,
        tier TEXT DEFAULT 'premium', granted_at TEXT)""")
    conn.commit(); conn.close()


def _ensure_user(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    conn.commit(); conn.close()


def user_exists(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row is not None


def add_referral(new_user_id, referrer_id):
    if new_user_id == referrer_id:
        return False
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT referrer_id FROM referrals WHERE user_id=?",
                       (new_user_id,)).fetchone()
    if row:
        conn.close(); return False
    conn.execute(
        "INSERT INTO referrals (user_id, referrer_id, created_at, rewarded) VALUES (?, ?, ?, 0)",
        (new_user_id, referrer_id, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()
    return True


def mark_referral_rewarded(new_user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE referrals SET rewarded=1 WHERE user_id=?", (new_user_id,))
    conn.commit(); conn.close()


def get_referral_stats(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, created_at, rewarded FROM referrals WHERE referrer_id=?",
        (user_id,)).fetchall()
    conn.close()
    total = len(rows)
    rewarded = sum(1 for r in rows if r[2])
    return total, rewarded


def daily_subscribe(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR IGNORE INTO daily_subscribers (user_id, subscribed_at) VALUES (?, ?)",
        (user_id, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def daily_unsubscribe(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM daily_subscribers WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()


def daily_is_subscribed(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT 1 FROM daily_subscribers WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    return row is not None


def daily_get_all_subscribers():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id FROM daily_subscribers").fetchall()
    conn.close()
    return [r[0] for r in rows]


def set_scholarship_amount(user_id, amount):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO scholarship (user_id, current_amount, updated_at) VALUES (?, ?, ?)",
        (user_id, amount, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def get_scholarship_amount(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT current_amount FROM scholarship WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    return row[0] if row else None


def add_grade(user_id, subject, grade):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO grades (user_id, subject, grade, created_at) VALUES (?, ?, ?, ?)",
        (user_id, subject, grade, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def get_grades(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, subject, grade FROM grades WHERE user_id=? ORDER BY subject",
        (user_id,)).fetchall()
    conn.close()
    return rows


def delete_grade(grade_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM grades WHERE id=? AND user_id=?", (grade_id, user_id))
    conn.commit(); conn.close()


def clear_grades(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM grades WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()


def save_user_group(user_id, group_id, group_name):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET group_id=?, group_name=? WHERE user_id=?",
                 (group_id, group_name, user_id))
    conn.commit(); conn.close()


def get_user_group(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT group_id, group_name FROM users WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    return row if row and row[0] else None


def delete_user_group(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET group_id=NULL, group_name=NULL, notify_hour=-1, notify_changes=0, subgroup=0 WHERE user_id=?",
                 (user_id,))
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


def set_notify_time(user_id, hour, minute):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET notify_hour=?, notify_minute=? WHERE user_id=?",
                 (hour, minute, user_id))
    conn.commit(); conn.close()


def get_notify_time(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_hour, notify_minute FROM users WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    return row if row and row[0] is not None and row[0] >= 0 else None


def set_notify_changes(user_id, enabled):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET notify_changes=? WHERE user_id=?",
                 (1 if enabled else 0, user_id))
    conn.commit(); conn.close()


def get_notify_changes(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_changes FROM users WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    return bool(row and row[0])


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


def set_vip(user_id, days, tier="premium"):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT expiry FROM vip WHERE user_id=?", (user_id,)).fetchone()
    now = datetime.now(timezone.utc)
    base = now
    if row and row[0]:
        try:
            current_expiry = datetime.fromisoformat(row[0])
            if current_expiry > now:
                base = current_expiry
        except Exception:
            pass
    new_expiry = base + timedelta(days=days)
    conn.execute("INSERT OR REPLACE INTO vip (user_id, expiry, tier, granted_at) VALUES (?, ?, ?, ?)",
                 (user_id, new_expiry.isoformat(), tier, now.isoformat()))
    conn.commit(); conn.close()
    return new_expiry


def is_vip(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT expiry FROM vip WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    if not row or not row[0]:
        return False
    try:
        return datetime.fromisoformat(row[0]) > datetime.now(timezone.utc)
    except Exception:
        return False


def get_vip_info(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT expiry, tier FROM vip WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    if not row or not row[0]:
        return None
    try:
        expiry = datetime.fromisoformat(row[0])
        if expiry > datetime.now(timezone.utc):
            return expiry, row[1] or "premium"
    except Exception:
        pass
    return None


def revoke_vip(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM vip WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()


def get_all_vips():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id, expiry, tier FROM vip").fetchall()
    conn.close()
    now = datetime.now(timezone.utc)
    result = []
    for uid, exp, tier in rows:
        try:
            if datetime.fromisoformat(exp) > now:
                result.append((uid, exp, tier))
        except Exception:
            pass
    return result


def get_cached_schedule(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT html, cached_at FROM schedule_cache WHERE group_id=? AND week_start=?",
                       (group_id, week_start)).fetchone()
    conn.close()
    if not row:
        return None
    html, cached_at = row
    try:
        if datetime.now(timezone.utc) - datetime.fromisoformat(cached_at) < timedelta(hours=CACHE_TTL_HOURS):
            return html
    except Exception:
        pass
    return None


def save_cached_schedule(group_id, week_start, html):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO schedule_cache VALUES (?, ?, ?, ?)",
                 (group_id, week_start, html, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


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
    rows = conn.execute(
        "SELECT id, user_id, username, text, created_at, COALESCE(status,'new') "
        "FROM feedback WHERE COALESCE(status,'new') IN ('new', 'postponed') "
        "ORDER BY CASE COALESCE(status,'new') WHEN 'new' THEN 0 ELSE 1 END, id DESC").fetchall()
    conn.close()
    return rows


def set_feedback_status(feedback_id, status):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET status=? WHERE id=?", (status, feedback_id))
    conn.commit(); conn.close()


def mark_feedback_answered(feedback_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET status='answered', answered_at=? WHERE id=?",
                 (datetime.now(timezone.utc).isoformat(), feedback_id))
    conn.commit(); conn.close()


def get_feedback_by_id(feedback_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, user_id, username, text FROM feedback WHERE id=?",
                       (feedback_id,)).fetchone()
    conn.close()
    return row


def add_task(user_id, text, due_date=None, priority=1, due_time=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO tasks (user_id, text, due_date, done, created_at, priority, due_time) "
        "VALUES (?, ?, ?, 0, ?, ?, ?)",
        (user_id, text, due_date, datetime.now(timezone.utc).isoformat(), priority, due_time))
    tid = cur.lastrowid
    conn.commit(); conn.close()
    return tid


def update_task(task_id, user_id, text=None, due_date=None, priority=None,
                due_time=None, reset_due=False):
    conn = sqlite3.connect(DB_PATH)
    fields = []
    values = []
    if text is not None:
        fields.append("text=?"); values.append(text)
    if reset_due:
        fields.append("due_date=NULL"); fields.append("due_time=NULL")
    else:
        if due_date is not None:
            fields.append("due_date=?"); values.append(due_date)
        if due_time is not None:
            fields.append("due_time=?"); values.append(due_time)
    if priority is not None:
        fields.append("priority=?"); values.append(priority)
    if not fields:
        conn.close(); return
    values.extend([task_id, user_id])
    conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
    conn.commit(); conn.close()


def get_task(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id, text, due_date, done, created_at, priority, due_time, done_at "
        "FROM tasks WHERE id=? AND user_id=?",
        (task_id, user_id)).fetchone()
    conn.close()
    return row


def get_user_tasks(user_id, only_active=True):
    conn = sqlite3.connect(DB_PATH)
    if only_active:
        rows = conn.execute(
            "SELECT id, text, due_date, done, created_at, priority, due_time "
            "FROM tasks WHERE user_id=? AND done=0",
            (user_id,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, text, due_date, done, created_at, priority, due_time "
            "FROM tasks WHERE user_id=? ORDER BY id DESC",
            (user_id,)).fetchall()
    conn.close()
    return rows


def get_done_tasks(user_id, days=7):
    conn = sqlite3.connect(DB_PATH)
    threshold = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = conn.execute(
        "SELECT id, text, due_date, done, created_at, priority, due_time, done_at "
        "FROM tasks WHERE user_id=? AND done=1 AND done_at IS NOT NULL AND done_at >= ? "
        "ORDER BY done_at DESC",
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
    row = conn.execute(
        "SELECT "
        "SUM(CASE WHEN done=0 THEN 1 ELSE 0 END), "
        "SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) "
        "FROM tasks WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    active = row[0] or 0
    done = row[1] or 0
    return active, done


def add_or_update_note(user_id, subject, text):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id FROM notes WHERE user_id=? AND LOWER(subject)=LOWER(?)",
                       (user_id, subject)).fetchone()
    if row:
        conn.execute("UPDATE notes SET text=?, created_at=? WHERE id=?",
                     (text, datetime.now(timezone.utc).isoformat(), row[0]))
    else:
        conn.execute("INSERT INTO notes (user_id, subject, text, created_at) VALUES (?, ?, ?, ?)",
                     (user_id, subject, text, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def get_user_notes(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, subject, text FROM notes WHERE user_id=? ORDER BY subject",
                       (user_id,)).fetchall()
    conn.close()
    return rows


def delete_note_by_id(note_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
    conn.commit(); conn.close()


# ============================================================
# ГРУППЫ
# ============================================================
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
    ],
    "ДЛРЯ": [
        {"name": "ИНС-26-1", "id": "479936"}, {"name": "ИНС-26-2", "id": "479937"},
        {"name": "ИНС-26-3", "id": "479938"}, {"name": "ИНС-26-4", "id": "479939"},
        {"name": "ИНС-26-5", "id": "479940"}, {"name": "ИНС-26-6", "id": "479941"},
        {"name": "ИНСм-26-1", "id": "479942"}, {"name": "ИНСм-26-2", "id": "479943"},
        {"name": "ИНСм-26-3", "id": "479944"},
    ],
    "ССГ": [
        {"name": "ГИИм-26-1", "id": "478127"}, {"name": "ИТГб-26-1", "id": "478243"},
        {"name": "РМ-26-1", "id": "478460"}, {"name": "РФ-26-1", "id": "478476"},
        {"name": "ЦГФм-26-1", "id": "478599"},
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
    ],
    "ИИТиАД": [
        {"name": "АСУб-26-1", "id": "478021"}, {"name": "АСУб-26-2", "id": "478022"},
        {"name": "БКСм-26-1", "id": "478092"}, {"name": "ИБб-26-1", "id": "478205"},
        {"name": "ИБб-26-2", "id": "479889"}, {"name": "ИСИб-26-1", "id": "478232"},
        {"name": "ИСТб-26-1", "id": "478240"}, {"name": "ИСТб-26-2", "id": "478241"},
        {"name": "ИСТб-26-3", "id": "479892"}, {"name": "ИИТм-26-1", "id": "478219"},
        {"name": "КСм-26-1", "id": "478261"}, {"name": "ЦППм-26-1", "id": "478603"},
        {"name": "ЭВМб-26-1", "id": "478624"}, {"name": "ЭВМб-26-2", "id": "479900"},
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
    ],
    "ИЭ": [
        {"name": "ЭАПЭб-26-1", "id": "478614"}, {"name": "КТЭм-26-1", "id": "478273"},
        {"name": "СТЭб-26-1", "id": "478508"}, {"name": "СТЭб-26-2", "id": "479897"},
        {"name": "УЭСм-26-1", "id": "478569"}, {"name": "ЦЭм-26-1", "id": "478609"},
        {"name": "ЭНГм-26-1", "id": "478650"}, {"name": "ЭПб-26-1", "id": "478660"},
        {"name": "ЭПб-26-2", "id": "478661"}, {"name": "ЭСб-26-1", "id": "478692"},
        {"name": "ЭСм-26-1", "id": "478699"}, {"name": "ЭСТм-26-1", "id": "478701"},
        {"name": "ЭУм-26-1", "id": "478709"},
    ],
}

LESSON_TIMES = {
    "8:15": "9:45", "8:30": "10:00", "10:00": "11:30", "10:10": "11:40",
    "11:45": "13:15", "12:00": "13:30", "13:45": "15:15", "14:00": "15:30",
    "15:30": "17:00", "15:45": "17:15", "17:10": "18:40", "17:25": "18:55",
    "18:50": "20:20", "19:05": "20:35",
}


def _now_irkutsk():
    return datetime.now(timezone.utc) + timedelta(hours=8)


def _group_name_by_id(group_id):
    for groups in GROUPS.values():
        for g in groups:
            if g["id"] == group_id:
                return g["name"]
    return "Неизвестная группа"


def _monday_of_week(d):
    return d - timedelta(days=d.weekday())


def _filter_lessons_by_subgroup(lessons, subgroup):
    if not subgroup:
        return lessons
    result = []
    for les in lessons:
        if not les["subgroup"]:
            result.append(les)
        elif str(subgroup) == str(les["subgroup"]):
            result.append(les)
    return result


def parse_week_range(soup):
    start = end = None
    for item in soup.find_all("div", class_="info-block-item"):
        label = item.find("div", class_="info-block-item-label")
        value = item.find("div", class_="info-block-item-value")
        if not label or not value:
            continue
        ltxt = label.get_text(strip=True)
        vtxt = value.get_text(strip=True)
        if "Начало действия" in ltxt:
            start = vtxt
        elif "Окончание действия" in ltxt:
            end = vtxt
    return start, end


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
        if m:
            date_str = m.group(1)
        header = day_div.find("h2", class_="sch-list-day-header")
        day_name = header.get_text(strip=True) if header else date_str
        lessons = []
        for item in day_div.find_all("div", class_="sch-list-item"):
            time_div = item.find("div", class_="sch-list-item-time-inner")
            time_str = time_div.get_text(strip=True) if time_div else ""
            for week_block in item.find_all("div", class_="sch-list-item-week"):
                classes = week_block.get("class", [])
                week_type = "all"
                if "week-even" in classes:
                    week_type = "even"
                elif "week-odd" in classes:
                    week_type = "odd"
                if week_type != "all" and week_parity != "all" and week_type != week_parity:
                    continue
                for cls in week_block.find_all("div", class_="schcls-item"):
                    if "schcls-empty" in cls.get("class", []):
                        continue
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
                    if sm:
                        subgroup = sm.group(1)
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
        if cached:
            return cached
    date_str = target_monday.strftime("%d.%m.%Y")
    url = f"https://www.istu.edu/raspisanie/grup/{group_id}/{date_str}/"
    headers = {"User-Agent": "Mozilla/5.0", "Accept-Language": "ru-RU,ru;q=0.9"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                html = await response.text()
                if response.status == 200 and html:
                    save_cached_schedule(group_id, week_start_str, html)
                return html
    except Exception as e:
        logging.error(f"[WEEK] Ошибка: {e}")
        if use_cache:
            conn = sqlite3.connect(DB_PATH)
            row = conn.execute("SELECT html FROM schedule_cache WHERE group_id=? AND week_start=?",
                             (group_id, week_start_str)).fetchone()
            conn.close()
            if row:
                return row[0]
        return ""


# ============================================================
# initData
# ============================================================
def _verify_webapp_init(init_data: str):
    if not init_data:
        return None
    try:
        data = safe_parse_webapp_init_data(token=TOKEN, init_data=init_data)
        if data and data.user:
            return data.user.id
    except Exception as e:
        logging.warning(f"[WEB] initData verify error: {e}")
    return None


# ============================================================
# API — ПОЛЬЗОВАТЕЛЬСКИЕ
# ============================================================
async def api_schedule(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    saved = get_user_group(user_id)
    if not saved:
        return web.json_response({"error": "no_group", "message": "Сначала выбери группу"}, status=200)

    group_id, group_name = saved
    subgroup = get_user_subgroup(user_id)
    today = _now_irkutsk()
    monday = _monday_of_week(today)
    html = await fetch_week_html(group_id, monday, use_cache=True)
    if not html:
        return web.json_response({"error": "no_data", "message": "Не удалось загрузить"}, status=200)

    _, days = parse_schedule(html)
    today_str = today.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)
    if day is None:
        return web.json_response({"date": today_str, "dayName": "", "group": group_name,
                                   "subgroup": subgroup, "lessons": []})
    filtered = _filter_lessons_by_subgroup(day["lessons"], subgroup)
    lessons_out = [{
        "time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
        "subject": les["subject"], "type": les["type"],
        "teacher": les["teacher"], "auditorium": les["auditorium"],
        "subgroup": les["subgroup"],
    } for les in filtered]
    return web.json_response({
        "date": day["date"], "dayName": day["name"], "group": group_name,
        "subgroup": subgroup, "lessons": lessons_out,
    })


async def api_week(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    offset = int(request.query.get("offset", "0"))
    saved = get_user_group(user_id)
    if not saved:
        return web.json_response({"error": "no_group"}, status=200)

    group_id, group_name = saved
    subgroup = get_user_subgroup(user_id)
    today = _now_irkutsk()
    target_monday = _monday_of_week(today) + timedelta(days=7 * offset)
    html = await fetch_week_html(group_id, target_monday, use_cache=True)
    if not html:
        return web.json_response({"error": "no_data"}, status=200)

    _, days = parse_schedule(html)
    days_out = []
    for d in days:
        filtered = _filter_lessons_by_subgroup(d["lessons"], subgroup)
        lessons_out = [{
            "time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
            "subject": les["subject"], "type": les["type"],
            "teacher": les["teacher"], "auditorium": les["auditorium"],
            "subgroup": les["subgroup"],
        } for les in filtered]
        days_out.append({"date": d["date"], "name": d["name"], "lessons": lessons_out})
    return web.json_response({"group": group_name, "subgroup": subgroup, "days": days_out})


async def api_me(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    _ensure_user(user_id)
    saved = get_user_group(user_id)
    vip_info = get_vip_info(user_id)
    active, done = count_user_tasks(user_id)
    notes = get_user_notes(user_id)
    amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id)
    total, rewarded = get_referral_stats(user_id)
    daily = daily_is_subscribed(user_id)
    notif = get_notify_time(user_id)
    changes = get_notify_changes(user_id)

    avg = sum(g[2] for g in grades) / len(grades) if grades else 0

    return web.json_response({
        "user_id": user_id,
        "is_admin": user_id == ADMIN_ID,
        "group": saved[1] if saved else None,
        "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id),
        "is_vip": is_vip(user_id),
        "vip_until": vip_info[0].isoformat() if vip_info else None,
        "vip_days_left": (vip_info[0] - datetime.now(timezone.utc)).days if vip_info else 0,
        "tasks_active": active, "tasks_done": done,
        "notes_count": len(notes),
        "scholarship_amount": amount,
        "grades_count": len(grades),
        "grades_avg": round(avg, 2),
        "referral_total": total, "referral_rewarded": rewarded,
        "referral_days": rewarded * REFERRAL_DAYS,
        "daily_subscribed": daily,
        "notify_time": f"{notif[0]:02d}:{notif[1]:02d}" if notif else None,
        "notify_changes": changes,
    })


async def api_groups(request: web.Request):
    return web.json_response({"groups": GROUPS})


async def api_set_group(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    group_id = str(body.get("group_id", ""))
    group_name = str(body.get("group_name", ""))
    subgroup = int(body.get("subgroup", 0))
    if not group_id or not group_name:
        delete_user_group(user_id)
        return web.json_response({"ok": True})
    save_user_group(user_id, group_id, group_name)
    set_user_subgroup(user_id, subgroup)
    return web.json_response({"ok": True})


async def api_set_subgroup(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    subgroup = int(body.get("subgroup", 0))
    set_user_subgroup(user_id, subgroup)
    return web.json_response({"ok": True})


def _task_to_dict(row):
    tid, text, due_date, done, created_at, priority, due_time = row
    overdue = False
    if due_date and not done:
        try:
            if due_time:
                dt = datetime.strptime(f"{due_date} {due_time}", "%d.%m.%Y %H:%M")
            else:
                dt = datetime.strptime(due_date, "%d.%m.%Y").replace(hour=23, minute=59)
            overdue = dt < _now_irkutsk()
        except Exception:
            pass
    return {"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
            "priority": priority or 1, "done": bool(done), "overdue": overdue}


async def api_tasks(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    show_done = request.query.get("done", "0") == "1"
    if show_done:
        rows = get_done_tasks(user_id, days=7)
        tasks = []
        for r in rows:
            tid, text, due_date, done, created_at, priority, due_time, done_at = r
            tasks.append({"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
                          "priority": priority or 1, "done": True, "done_at": done_at, "overdue": False})
    else:
        rows = get_user_tasks(user_id, only_active=True)
        tasks = [_task_to_dict(r) for r in rows]
    active, done_count = count_user_tasks(user_id)
    return web.json_response({"tasks": tasks, "active": active, "done": done_count})


async def api_task_add(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "empty_text"}, status=400)
    if len(text) > 500:
        text = text[:500]
    due_date = body.get("due_date") or None
    due_time = body.get("due_time") or None
    priority = int(body.get("priority", 1))
    if priority not in (0, 1, 2):
        priority = 1
    tid = add_task(user_id, text, due_date, priority, due_time)
    return web.json_response({"ok": True, "id": tid})


async def api_task_update(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    tid = int(body.get("id", 0))
    if not tid:
        return web.json_response({"error": "no_id"}, status=400)
    row = get_task(tid, user_id)
    if not row:
        return web.json_response({"error": "not_found"}, status=404)
    if body.get("done") is True:
        mark_task_done(tid, user_id)
        return web.json_response({"ok": True, "done": True})
    text = body.get("text")
    due_date = body.get("due_date")
    due_time = body.get("due_time")
    priority = body.get("priority")
    reset_due = body.get("reset_due", False)
    if priority is not None:
        priority = int(priority)
    update_task(tid, user_id,
                text=text if text is not None else None,
                due_date=due_date if due_date else None,
                priority=priority,
                due_time=due_time if due_time is not None else None,
                reset_due=reset_due)
    return web.json_response({"ok": True})


async def api_task_delete(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    tid = int(body.get("id", 0))
    if not tid:
        return web.json_response({"error": "no_id"}, status=400)
    delete_task(tid, user_id)
    return web.json_response({"ok": True})


async def api_task_clear(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    clear_done_tasks(user_id)
    return web.json_response({"ok": True})


async def api_notes(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    rows = get_user_notes(user_id)
    return web.json_response({"notes": [{"id": nid, "subject": subj, "text": txt} for nid, subj, txt in rows]})


async def api_note_save(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    subject = (body.get("subject") or "").strip()
    text = (body.get("text") or "").strip()
    if not subject or not text:
        return web.json_response({"error": "empty"}, status=400)
    if len(subject) > 100:
        subject = subject[:100]
    if len(text) > 500:
        text = text[:500]
    add_or_update_note(user_id, subject, text)
    return web.json_response({"ok": True})


async def api_note_delete(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    nid = int(body.get("id", 0))
    if not nid:
        return web.json_response({"error": "no_id"}, status=400)
    delete_note_by_id(nid, user_id)
    return web.json_response({"ok": True})


async def api_notify_set(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    hour = int(body.get("hour", -1))
    minute = int(body.get("minute", 0))
    changes = bool(body.get("changes", False))
    set_notify_time(user_id, hour, minute)
    set_notify_changes(user_id, changes)
    return web.json_response({"ok": True})


async def api_quote(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    return web.json_response({
        "quote": random.choice(DAILY_QUOTES),
        "subscribed": daily_is_subscribed(user_id),
    })


async def api_quote_subscribe(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    sub = bool(body.get("subscribe", False))
    if sub:
        daily_subscribe(user_id)
    else:
        daily_unsubscribe(user_id)
    return web.json_response({"ok": True, "subscribed": sub})


async def api_referral(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    total, rewarded = get_referral_stats(user_id)
    bot_username = BOT_USERNAME.replace("@", "")
    link = f"https://t.me/{bot_username}?start=ref_{user_id}"
    return web.json_response({
        "link": link, "total": total, "rewarded": rewarded,
        "days": rewarded * REFERRAL_DAYS, "referral_days": REFERRAL_DAYS,
    })


async def api_scholarship(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id)
    grades_out = [{"id": gid, "subject": subj, "grade": grade} for gid, subj, grade in grades]
    avg = sum(g[2] for g in grades) / len(grades) if grades else 0
    count5 = sum(1 for g in grades if g[2] == 5)
    count4 = sum(1 for g in grades if g[2] == 4)
    count3 = sum(1 for g in grades if g[2] == 3)
    count2 = sum(1 for g in grades if g[2] == 2)
    forecast = ""
    if count2 > 0 or count3 > 0:
        forecast = "На академическую не проходишь: есть тройки/двойки."
    elif avg >= 4.5:
        forecast = "Проходишь на академическую и можешь претендовать на повышенную."
    elif avg >= 4.0:
        forecast = f"Проходишь на академическую. До повышенной не хватает {4.5 - avg:.2f}."
    elif grades:
        forecast = "На академическую не проходишь: средний балл ниже 4.0."
    return web.json_response({
        "amount": amount, "grades": grades_out, "avg": round(avg, 2),
        "count5": count5, "count4": count4, "count3": count3, "count2": count2,
        "forecast": forecast,
    })


async def api_scholarship_set_amount(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    amount = int(body.get("amount", 0))
    if amount < 0 or amount > 100000:
        return web.json_response({"error": "invalid"}, status=400)
    set_scholarship_amount(user_id, amount)
    return web.json_response({"ok": True})


async def api_scholarship_add_grade(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    subject = (body.get("subject") or "").strip()
    grade = int(body.get("grade", 0))
    if not subject or grade not in (2, 3, 4, 5):
        return web.json_response({"error": "invalid"}, status=400)
    if len(subject) > 100:
        subject = subject[:100]
    add_grade(user_id, subject, grade)
    return web.json_response({"ok": True})


async def api_scholarship_delete_grade(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    gid = int(body.get("id", 0))
    if not gid:
        return web.json_response({"error": "no_id"}, status=400)
    delete_grade(gid, user_id)
    return web.json_response({"ok": True})


async def api_scholarship_clear(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    clear_grades(user_id)
    return web.json_response({"ok": True})


async def api_ai(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    if not is_vip(user_id):
        return web.json_response({"error": "vip_only"}, status=403)
    if giga_client is None:
        return web.json_response({"error": "ai_unavailable"}, status=503)
    question = (body.get("question") or "").strip()
    if not question:
        return web.json_response({"error": "empty"}, status=400)
    if len(question) > 2000:
        question = question[:2000]
    try:
        prompt = (
            "Ты — студенческий помощник. Ответь на вопрос студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n"
            "- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n"
            "- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n"
            "- Пиши без воды.\n\n"
            f"Вопрос: {question}"
        )
        response = await giga_client.achat(prompt)
        try:
            answer = response.choices[0].message.content
        except AttributeError:
            answer = response.messages[0].content[0].text if response.messages else "Нет ответа."
        answer = clean_latex(answer)
        answer = clean_markdown(answer)
        if len(answer) > 4000:
            answer = answer[:4000] + "\n... (обрезано)"
        return web.json_response({"answer": answer})
    except Exception as e:
        logging.exception("[AI-WEB]")
        return web.json_response({"error": "ai_failed", "message": str(e)}, status=500)


async def api_feedback(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "empty"}, status=400)
    if len(text) > 2000:
        text = text[:2000]
    uname = f"user_{user_id}"
    fid = save_feedback(user_id, uname, text)
    try:
        vip_mark = "[VIP] " if is_vip(user_id) else ""
        admin_msg = await bot.send_message(
            ADMIN_ID,
            f"{vip_mark}Обращение #{fid} (из веба)\nОт: user_{user_id}\n\n{text}")
        update_feedback_admin_msg(fid, admin_msg.message_id)
    except Exception as e:
        logging.error(f"[FEEDBACK-WEB] {e}")
    return web.json_response({"ok": True, "id": fid})


async def api_vip(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    info = get_vip_info(user_id)
    if info:
        expiry, tier = info
        days_left = (expiry - datetime.now(timezone.utc)).days
        return web.json_response({"is_vip": True, "expiry": expiry.isoformat(),
                                   "days_left": days_left, "tier": tier})
    return web.json_response({"is_vip": False})


# ============================================================
# API — АДМИНСКИЕ (только ADMIN_ID)
# ============================================================
def _admin_only(init_data):
    user_id = _verify_webapp_init(init_data)
    if not user_id or user_id != ADMIN_ID:
        return None
    return user_id


async def api_admin_stats(request: web.Request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data):
        return web.json_response({"error": "forbidden"}, status=403)
    total = get_total_users()
    vips = get_all_vips()
    pending = get_pending_feedback()
    return web.json_response({
        "total_users": total,
        "vip_count": len(vips),
        "pending_feedback": len(pending),
    })


async def api_admin_feedback_list(request: web.Request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data):
        return web.json_response({"error": "forbidden"}, status=403)
    rows = get_pending_feedback()
    items = []
    for fid, uid, uname, text, created, status in rows:
        items.append({"id": fid, "user_id": uid, "username": uname,
                      "text": text, "created": created, "status": status})
    return web.json_response({"items": items})


async def api_admin_feedback_reply(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")):
        return web.json_response({"error": "forbidden"}, status=403)
    fid = int(body.get("id", 0))
    reply = (body.get("text") or "").strip()
    if not fid or not reply:
        return web.json_response({"error": "empty"}, status=400)
    row = get_feedback_by_id(fid)
    if not row:
        return web.json_response({"error": "not_found"}, status=404)
    _, target_uid, _, _ = row
    try:
        await bot.send_message(target_uid, f"Ответ администратора на обращение #{fid}:\n\n{reply}")
        mark_feedback_answered(fid)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def api_admin_feedback_postpone(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")):
        return web.json_response({"error": "forbidden"}, status=403)
    fid = int(body.get("id", 0))
    if not fid:
        return web.json_response({"error": "no_id"}, status=400)
    set_feedback_status(fid, "postponed")
    return web.json_response({"ok": True})


async def api_admin_broadcast(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")):
        return web.json_response({"error": "forbidden"}, status=403)
    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "empty"}, status=400)

    async def _run():
        user_ids = get_all_user_ids()
        sent = failed = 0
        for uid in user_ids:
            try:
                await bot.send_message(uid, text)
                sent += 1
            except Exception:
                failed += 1
            await asyncio.sleep(0.05)
        logging.info(f"[BROADCAST] отправлено {sent}, не доставлено {failed}")

    asyncio.create_task(_run())
    return web.json_response({"ok": True, "started": True})


async def api_admin_give_vip(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")):
        return web.json_response({"error": "forbidden"}, status=403)
    uid = int(body.get("user_id", 0))
    days = int(body.get("days", 0))
    if not uid or days <= 0:
        return web.json_response({"error": "invalid"}, status=400)
    expiry = set_vip(uid, days)
    exp_local = expiry + timedelta(hours=8)
    try:
        await bot.send_message(uid, f"Тебе активирован VIP на {days} дней!")
    except Exception:
        pass
    return web.json_response({"ok": True, "expiry": exp_local.strftime("%d.%m.%Y")})


async def api_admin_revoke_vip(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")):
        return web.json_response({"error": "forbidden"}, status=403)
    uid = int(body.get("user_id", 0))
    if not uid:
        return web.json_response({"error": "no_id"}, status=400)
    revoke_vip(uid)
    return web.json_response({"ok": True})


async def api_admin_vip_list(request: web.Request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data):
        return web.json_response({"error": "forbidden"}, status=403)
    vips = get_all_vips()
    items = []
    for uid, exp, tier in vips[:100]:
        try:
            exp_local = datetime.fromisoformat(exp) + timedelta(hours=8)
            days = (datetime.fromisoformat(exp) - datetime.now(timezone.utc)).days
            items.append({"user_id": uid, "expiry": exp_local.strftime("%d.%m.%Y"), "days": days})
        except Exception:
            items.append({"user_id": uid, "expiry": exp, "days": 0})
    return web.json_response({"items": items})


async def api_admin_monitor(request: web.Request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data):
        return web.json_response({"error": "forbidden"}, status=403)
    check_url = "https://www.istu.edu/raspisanie/"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(check_url, timeout=aiohttp.ClientTimeout(total=15),
                                   headers={"User-Agent": "Mozilla/5.0"}) as response:
                return web.json_response({"status": response.status, "ok": response.status == 200})
    except Exception as e:
        return web.json_response({"status": 0, "ok": False, "error": str(e)})


# ============================================================
# ВЕБ-СЕРВЕР
# ============================================================
async def start_webapp():
    port = int(os.getenv("PORT", "3000"))
    base_dir = os.path.dirname(os.path.abspath(__file__))
    possible_paths = [
        os.path.join(base_dir, "webapp"),
        os.path.join(os.getcwd(), "webapp"),
        "/app/webapp",
        "webapp",
    ]
    webapp_dir = None
    for p in possible_paths:
        if os.path.isdir(p):
            webapp_dir = p
            break

    app = web.Application()

    app.router.add_get("/api/schedule", api_schedule)
    app.router.add_get("/api/week", api_week)
    app.router.add_get("/api/me", api_me)
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
    app.router.add_get("/api/quote", api_quote)
    app.router.add_post("/api/quote-subscribe", api_quote_subscribe)
    app.router.add_get("/api/referral", api_referral)
    app.router.add_get("/api/scholarship", api_scholarship)
    app.router.add_post("/api/scholarship-set-amount", api_scholarship_set_amount)
    app.router.add_post("/api/scholarship-add-grade", api_scholarship_add_grade)
    app.router.add_post("/api/scholarship-delete-grade", api_scholarship_delete_grade)
    app.router.add_post("/api/scholarship-clear", api_scholarship_clear)
    app.router.add_post("/api/ai", api_ai)
    app.router.add_post("/api/feedback", api_feedback)
    app.router.add_get("/api/vip", api_vip)

    app.router.add_get("/api/admin/stats", api_admin_stats)
    app.router.add_get("/api/admin/feedback-list", api_admin_feedback_list)
    app.router.add_post("/api/admin/feedback-reply", api_admin_feedback_reply)
    app.router.add_post("/api/admin/feedback-postpone", api_admin_feedback_postpone)
    app.router.add_post("/api/admin/broadcast", api_admin_broadcast)
    app.router.add_post("/api/admin/give-vip", api_admin_give_vip)
    app.router.add_post("/api/admin/revoke-vip", api_admin_revoke_vip)
    app.router.add_get("/api/admin/vip-list", api_admin_vip_list)
    app.router.add_get("/api/admin/monitor", api_admin_monitor)

    if webapp_dir:
        logging.info(f"[WEB] отдаю статику из {webapp_dir}")

        async def index_handler(request):
            index_path = os.path.join(webapp_dir, "index.html")
            if os.path.isfile(index_path):
                return web.FileResponse(index_path)
            return web.Response(text="index.html not found", status=404)

        async def style_handler(request):
            path = os.path.join(webapp_dir, "style.css")
            if os.path.isfile(path):
                return web.FileResponse(path, headers={"Content-Type": "text/css"})
            return web.Response(text="not found", status=404)

        async def appjs_handler(request):
            path = os.path.join(webapp_dir, "app.js")
            if os.path.isfile(path):
                return web.FileResponse(path, headers={"Content-Type": "application/javascript"})
            return web.Response(text="not found", status=404)

        async def favicon_handler(request):
            return web.Response(status=204)

        app.router.add_get("/", index_handler)
        app.router.add_get("/index.html", index_handler)
        app.router.add_get("/style.css", style_handler)
        app.router.add_get("/app.js", appjs_handler)
        app.router.add_get("/favicon.ico", favicon_handler)
    else:
        logging.warning("[WEB] папка webapp не найдена")
        async def root(request):
            return web.Response(text="webapp not found", status=404)
        app.router.add_get("/", root)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    logging.info(f"[WEB] сервер запущен на 0.0.0.0:{port}")


# ============================================================
# ХЕНДЛЕРЫ БОТА (минимум)
# ============================================================
@dp.message(CommandStart())
async def cmd_start(message: Message):
    _ensure_user(message.from_user.id)
    if not WEBAPP_URL:
        await message.answer("Приложение ещё не настроено. Обратись к администратору.")
        return
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "Привет! Открой приложение — там расписание, задачи, заметки и многое другое.",
        reply_markup=kb)


@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Только для админа.")
        return
    await message.answer(
        "АДМИН-КОМАНДЫ (всё остальное — в Mini App, вкладка «Админ»):\n\n"
        "/backup — прислать файл users.db\n"
        "/restore — восстановить базу (пришли .db с подписью /restore)\n"
        "/admin — эта справка"
    )


@dp.message(Command("backup"))
async def cmd_backup(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    try:
        total = get_total_users()
        doc = FSInputFile(DB_PATH, filename="users_backup.db")
        await message.answer_document(doc, caption=f"Резервная копия. Всего пользователей: {total}")
    except Exception as e:
        await message.answer(f"Ошибка: {e}")


@dp.message(Command("restore"))
async def cmd_restore(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    if not message.document:
        await message.answer("Пришли файл .db с командой /restore в подписи.")
        return
    try:
        file = await bot.get_file(message.document.file_id)
        await bot.download_file(file.file_path, DB_PATH)
        init_db()
        await message.answer(f"База восстановлена. Всего: {get_total_users()}")
    except Exception as e:
        await message.answer(f"Ошибка: {e}")


# ============================================================
# ЗАПУСК
# ============================================================
async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        stream=sys.stdout, force=True)
    init_db()
    await bot.delete_webhook(drop_pending_updates=True)
    logging.info("Webhook удалён, polling")

    asyncio.create_task(start_webapp())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
