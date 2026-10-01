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
    text = re.sub(r"\\(sin|cos|tan|ctg|cot|log|ln|lg|exp|lim|max|min|arg|det|mod)\b", r"\1", text)
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


TOKEN = os.getenv("BOT_TOKEN", "")
GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_KEY", "")
YANDEX_VISION_API_KEY = os.getenv("YANDEX_VISION_API_KEY", "")
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID", "")
ADMIN_ID = 6014557174
ADMIN_USERNAME = "ilyaech"
BOT_USERNAME = "@student_irk38_bot"
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

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


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY, group_id TEXT, group_name TEXT,
        notify_hour INTEGER DEFAULT -1, notify_minute INTEGER DEFAULT 0,
        notify_changes INTEGER DEFAULT 0, subgroup INTEGER DEFAULT 0)""")
    for alter in [
        "ALTER TABLE users ADD COLUMN notify_changes INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN subgroup INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN notify_type TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN last_notified_at TEXT DEFAULT NULL",
    ]:
        try:
            conn.execute(alter)
        except sqlite3.OperationalError:
            pass

    conn.execute("""CREATE TABLE IF NOT EXISTS daily_subscribers (
        user_id INTEGER PRIMARY KEY, subscribed_at TEXT)""")

    conn.execute("""CREATE TABLE IF NOT EXISTS scholarship (
        user_id INTEGER PRIMARY KEY, current_amount INTEGER DEFAULT 0, updated_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS grades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
        subject TEXT, grade INTEGER, created_at TEXT, is_auto INTEGER DEFAULT 0)""")
    try:
        conn.execute("ALTER TABLE grades ADD COLUMN is_auto INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

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
        priority INTEGER DEFAULT 2, due_time TEXT, done_at TEXT)""")
    for alter in [
        "ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 2",
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


def upsert_grade(user_id, subject, grade, is_auto=0):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id FROM grades WHERE user_id=? AND LOWER(subject)=LOWER(?)",
        (user_id, subject)
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE grades SET grade=?, subject=?, is_auto=?, created_at=? WHERE id=?",
            (grade, subject, int(bool(is_auto)),
             datetime.now(timezone.utc).isoformat(), row[0])
        )
    else:
        conn.execute(
            "INSERT INTO grades (user_id, subject, grade, is_auto, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, subject, grade, int(bool(is_auto)),
             datetime.now(timezone.utc).isoformat())
        )
    conn.commit(); conn.close()


def get_grades(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, subject, grade, COALESCE(is_auto, 0) FROM grades WHERE user_id=? ORDER BY subject",
        (user_id,)).fetchall()
    conn.close()
    return rows


def update_grade_by_id(grade_id, user_id, subject=None, grade=None, is_auto=None):
    conn = sqlite3.connect(DB_PATH)
    fields = []; values = []
    if subject is not None:
        fields.append("subject=?"); values.append(subject)
    if grade is not None:
        fields.append("grade=?"); values.append(grade)
    if is_auto is not None:
        fields.append("is_auto=?"); values.append(int(bool(is_auto)))
    if not fields:
        conn.close(); return
    values.extend([grade_id, user_id])
    conn.execute(f"UPDATE grades SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
    conn.commit(); conn.close()


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
    row = conn.execute("SELECT group_id, group_name FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return row if row and row[0] else None


def delete_user_group(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET group_id=NULL, group_name=NULL, notify_hour=-1, notify_changes=0, subgroup=0, notify_type=NULL WHERE user_id=?",
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
    conn.execute("UPDATE users SET notify_type=?, notify_hour=?, notify_minute=? WHERE user_id=?",
                 (ntype, hour, minute, user_id))
    conn.commit(); conn.close()


def get_notify_settings(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT notify_type, notify_hour, notify_minute FROM users WHERE user_id=?",
                       (user_id,)).fetchone()
    conn.close()
    if row and row[0]:
        return {"type": row[0], "hour": row[1] if row[1] is not None else 0, "minute": row[2] if row[2] is not None else 0}
    return None


def get_users_for_notification():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, subgroup, notify_type, notify_hour, notify_minute "
        "FROM users WHERE notify_type IS NOT NULL AND notify_type != '' "
        "AND notify_hour >= 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
    conn.close()
    return rows


def get_users_for_change_tracking():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, subgroup FROM users "
        "WHERE notify_changes=1 AND group_id IS NOT NULL AND group_id != ''").fetchall()
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


def is_vip(user_id):
    return True


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


def save_snapshot(group_id, week_start, snapshot_str):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT OR REPLACE INTO schedule_snapshots (group_id, week_start, snapshot, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (group_id, week_start, snapshot_str, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def get_snapshot(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT snapshot FROM schedule_snapshots WHERE group_id=? AND week_start=?",
                       (group_id, week_start)).fetchone()
    conn.close()
    return row[0] if row else None


def make_snapshot_str(days):
    parts = []
    for d in days:
        day_key = d.get("date", "")
        for les in d.get("lessons", []):
            parts.append(
                f"{day_key}|{les.get('time','')}|{les.get('subject','')}|"
                f"{les.get('type','')}|{les.get('teacher','')}|"
                f"{les.get('auditorium','')}|{les.get('subgroup','')}")
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


def add_task(user_id, text, due_date=None, priority=2, due_time=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO tasks (user_id, text, due_date, done, created_at, priority, due_time) "
        "VALUES (?, ?, ?, 0, ?, ?, ?)",
        (user_id, text, due_date, datetime.now(timezone.utc).isoformat(), priority, due_time))
    tid = cur.lastrowid
    conn.commit(); conn.close()
    return tid


def update_task(task_id, user_id, text=None, due_date=None, priority=None, due_time=None, reset_due=False):
    conn = sqlite3.connect(DB_PATH)
    fields = []; values = []
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
        "FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
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
    rows = conn.execute(
        "SELECT id, text, due_date, done, created_at, priority, due_time, done_at "
        "FROM tasks WHERE user_id=? AND done=1 AND done_at IS NOT NULL AND done_at >= ? "
        "ORDER BY done_at DESC", (user_id, threshold)).fetchall()
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
        "SELECT SUM(CASE WHEN done=0 THEN 1 ELSE 0 END), SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) "
        "FROM tasks WHERE user_id=?", (user_id,)).fetchone()
    conn.close()
    return (row[0] or 0, row[1] or 0)


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

LESSON_TIMES = {
    "8:15": "9:45", "8:30": "10:00", "10:00": "11:30", "10:10": "11:40",
    "11:45": "13:15", "12:00": "13:30", "13:45": "15:15", "14:00": "15:30",
    "15:30": "17:00", "15:45": "17:15", "17:10": "18:40", "17:25": "18:55",
    "18:50": "20:20", "19:05": "20:35",
}


def _now_irkutsk():
    return datetime.now(timezone.utc) + timedelta(hours=8)


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
    active, done = count_user_tasks(user_id)
    notes = get_user_notes(user_id)
    amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id)
    daily = daily_is_subscribed(user_id)
    notif_settings = get_notify_settings(user_id)

    avg = sum(g[2] for g in grades) / len(grades) if grades else 0

    return web.json_response({
        "user_id": user_id,
        "is_admin": user_id == ADMIN_ID,
        "group": saved[1] if saved else None,
        "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id),
        "is_vip": True,
        "tasks_active": active, "tasks_done": done,
        "notes_count": len(notes),
        "scholarship_amount": amount,
        "grades_count": len(grades),
        "grades_avg": round(avg, 2),
        "daily_subscribed": daily,
        "notify_type": notif_settings["type"] if notif_settings else None,
        "notify_hour": notif_settings["hour"] if notif_settings else -1,
        "notify_minute": notif_settings["minute"] if notif_settings else 0,
        "notify_changes": get_notify_changes(user_id),
        "chat_unread": 0,
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
    p = priority if priority is not None else 2
    if p not in (1, 2, 3):
        p = 2
    return {"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
            "priority": p, "done": bool(done), "overdue": overdue}


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
            p = priority if priority is not None else 2
            if p not in (1, 2, 3):
                p = 2
            tasks.append({"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
                          "priority": p, "done": True, "done_at": done_at, "overdue": False})
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
    priority = int(body.get("priority", 2))
    if priority not in (1, 2, 3):
        priority = 2
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
        if priority not in (1, 2, 3):
            priority = 2
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

    if "changes" in body:
        set_notify_changes(user_id, bool(body.get("changes", False)))
        return web.json_response({"ok": True})

    ntype = body.get("type", None)

    if ntype is None or ntype == "":
        set_notify_settings(user_id, None, -1, 0)
        return web.json_response({"ok": True, "type": None})

    if ntype not in ("today", "tomorrow"):
        return web.json_response({"error": "bad_type"}, status=400)

    try:
        hour = int(body.get("hour", 8))
        minute = int(body.get("minute", 0))
    except Exception:
        return web.json_response({"error": "bad_time"}, status=400)

    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return web.json_response({"error": "bad_time"}, status=400)

    if ntype == "today" and hour > 10:
        return web.json_response({
            "error": "today_limit",
            "message": "Для «Сегодня» — не позже 10:00"
        }, status=400)

    set_notify_settings(user_id, ntype, hour, minute)
    return web.json_response({"ok": True, "type": ntype, "hour": hour, "minute": minute})


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


async def api_scholarship(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id)

    grades_out = [{"id": g[0], "subject": g[1], "grade": g[2], "is_auto": bool(g[3])} for g in grades]

    avg = sum(g[2] for g in grades) / len(grades) if grades else 0
    count5 = sum(1 for g in grades if g[2] == 5)
    count4 = sum(1 for g in grades if g[2] == 4)
    count3 = sum(1 for g in grades if g[2] == 3)
    count2 = sum(1 for g in grades if g[2] == 2)
    count_auto = sum(1 for g in grades if g[3])

    forecast = ""
    if count2 > 0 or count3 > 0:
        forecast = "На академическую не проходишь: есть тройки/двойки."
    elif avg >= 4.5:
        forecast = "Проходишь на академическую и можешь претендовать на повышенную."
    elif avg >= 4.0:
        forecast = f"Проходишь на академическую. До повышенной не хватает {4.5 - avg:.2f}."
    elif grades:
        forecast = "На академическую не проходишь: средний балл ниже 4.0."

    available_subjects = []
    saved = get_user_group(user_id)
    if saved:
        try:
            group_id, _ = saved
            subgroup = get_user_subgroup(user_id)
            today = _now_irkutsk()
            monday = _monday_of_week(today)
            html = await fetch_week_html(group_id, monday, use_cache=True)
            if html:
                _, days = parse_schedule(html)
                subjects = set()
                for d in days:
                    for les in d["lessons"]:
                        s = (les.get("subject") or "").strip()
                        if s:
                            subjects.add(s)
                available_subjects = sorted(subjects)
        except Exception as e:
            logging.warning(f"[SCH] subjects fetch: {e}")

    return web.json_response({
        "amount": amount, "grades": grades_out, "avg": round(avg, 2),
        "count5": count5, "count4": count4, "count3": count3, "count2": count2,
        "count_auto": count_auto,
        "forecast": forecast,
        "available_subjects": available_subjects,
    })


async def api_scholarship_set_amount(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
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
    subject = (body.get("subject") or "").strip()
    grade = int(body.get("grade", 0))
    is_auto = bool(body.get("is_auto", False))
    if not subject or grade not in (2, 3, 4, 5):
        return web.json_response({"error": "invalid"}, status=400)
    if len(subject) > 100:
        subject = subject[:100]
    upsert_grade(user_id, subject, grade, is_auto)
    return web.json_response({"ok": True})


async def api_scholarship_update_grade(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    gid = int(body.get("id", 0))
    if not gid:
        return web.json_response({"error": "no_id"}, status=400)

    subject = (body.get("subject") or "").strip()
    if subject and len(subject) > 100:
        subject = subject[:100]

    grade = body.get("grade")
    if grade is not None:
        grade = int(grade)
        if grade not in (2, 3, 4, 5):
            return web.json_response({"error": "invalid_grade"}, status=400)

    is_auto = body.get("is_auto")
    if is_auto is not None:
        is_auto = bool(is_auto)

    update_grade_by_id(
        gid, user_id,
        subject if subject else None,
        grade,
        is_auto,
    )
    return web.json_response({"ok": True})


async def api_scholarship_delete_grade(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
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


async def api_ai_photo(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)

    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    if not YANDEX_VISION_API_KEY or not YANDEX_FOLDER_ID:
        return web.json_response({"error": "ocr_unavailable", "message": "OCR не настроен"}, status=503)

    if giga_client is None:
        return web.json_response({"error": "ai_unavailable"}, status=503)

    photo_data = (body.get("photo") or "").strip()
    question = (body.get("question") or "").strip()

    if not photo_data:
        return web.json_response({"error": "no_photo"}, status=400)

    if "," in photo_data:
        _, b64 = photo_data.split(",", 1)
    else:
        b64 = photo_data

    try:
        img_bytes = base64.b64decode(b64)
    except Exception:
        return web.json_response({"error": "bad_photo"}, status=400)

    if len(img_bytes) > 8 * 1024 * 1024:
        return web.json_response({"error": "too_big", "message": "Фото слишком большое (макс 8 МБ)"}, status=400)

    try:
        ocr_url = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText"
        ocr_headers = {
            "Authorization": f"Api-Key {YANDEX_VISION_API_KEY}",
            "Content-Type": "application/json",
        }
        ocr_body = {
            "mimeType": "image/jpeg",
            "languageCodes": ["ru", "en"],
            "model": "page",
            "content": b64,
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(ocr_url, headers=ocr_headers, json=ocr_body,
                                    timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200:
                    err_text = await resp.text()
                    logging.error(f"[OCR] HTTP {resp.status}: {err_text}")
                    return web.json_response({"error": "ocr_failed", "message": f"OCR HTTP {resp.status}"}, status=500)
                ocr_result = await resp.json()

        recognized_text = ""
        try:
            recognized_text = ocr_result["result"]["textAnnotation"]["fullText"] or ""
        except (KeyError, TypeError):
            try:
                blocks = ocr_result["result"]["textAnnotation"]["blocks"]
                parts = []
                for b in blocks:
                    for line in b.get("lines", []):
                        parts.append(line.get("text", ""))
                recognized_text = "\n".join(parts)
            except Exception:
                recognized_text = ""

        recognized_text = recognized_text.strip()
    except Exception as e:
        logging.exception("[OCR]")
        return web.json_response({"error": "ocr_failed", "message": str(e)}, status=500)

    if not recognized_text:
        return web.json_response({
            "answer": "На фото не удалось распознать текст. Попробуй другое фото — лучше, чтобы текст был чётким и хорошо освещённым."
        })

    if len(recognized_text) > 4000:
        recognized_text = recognized_text[:4000]

    if not question:
        question = "Разберись, что это за задача или текст, и помоги студенту."
    if len(question) > 2000:
        question = question[:2000]

    try:
        prompt = (
            "Ты — студенческий помощник. Пользователь прислал фото, с которого распознан текст. "
            "Выполни задачу студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n"
            "- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n"
            "- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n"
            "- Пиши без воды.\n\n"
            f"Распознанный текст с фото:\n{recognized_text}\n\n"
            f"Задача студента: {question}"
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
        logging.exception("[AI-PHOTO-GIGA]")
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
        admin_msg = await bot.send_message(
            ADMIN_ID,
            f"Обращение #{fid} (из веба)\nОт: user_{user_id}\n\n{text}")
        update_feedback_admin_msg(fid, admin_msg.message_id)
    except Exception as e:
        logging.error(f"[FEEDBACK-WEB] {e}")
    return web.json_response({"ok": True, "id": fid})


async def api_vip(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    return web.json_response({"is_vip": True})


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
    pending = get_pending_feedback()
    return web.json_response({
        "total_users": total,
        "vip_count": 0,
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
    app.router.add_get("/api/scholarship", api_scholarship)
    app.router.add_post("/api/scholarship-set-amount", api_scholarship_set_amount)
    app.router.add_post("/api/scholarship-add-grade", api_scholarship_add_grade)
    app.router.add_post("/api/scholarship-update-grade", api_scholarship_update_grade)
    app.router.add_post("/api/scholarship-delete-grade", api_scholarship_delete_grade)
    app.router.add_post("/api/scholarship-clear", api_scholarship_clear)
    app.router.add_post("/api/ai", api_ai)
    app.router.add_post("/api/ai-photo", api_ai_photo)
    app.router.add_post("/api/feedback", api_feedback)
    app.router.add_get("/api/vip", api_vip)

    app.router.add_get("/api/admin/stats", api_admin_stats)
    app.router.add_get("/api/admin/feedback-list", api_admin_feedback_list)
    app.router.add_post("/api/admin/feedback-reply", api_admin_feedback_reply)
    app.router.add_post("/api/admin/feedback-postpone", api_admin_feedback_postpone)
    app.router.add_post("/api/admin/broadcast", api_admin_broadcast)
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


async def send_schedule_notification(user_id, group_id, subgroup, ntype):
    try:
        today = _now_irkutsk()
        target_date = today + timedelta(days=1) if ntype == "tomorrow" else today

        monday = _monday_of_week(target_date)
        html = await fetch_week_html(group_id, monday, use_cache=True)
        if not html:
            return
        _, days = parse_schedule(html)
        target_str = target_date.strftime("%d.%m.%Y")
        day = next((d for d in days if d["date"] == target_str), None)

        label = "Сегодня" if ntype == "today" else "Завтра"
        header = f"{label}, {target_str}"

        if not day:
            await bot.send_message(user_id, f"{header}\n\nНе удалось загрузить расписание.", parse_mode=None)
            return

        lessons = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
        if not lessons:
            await bot.send_message(user_id, f"{header}\n\nЗанятий нет.", parse_mode=None)
            return

        lines = [header, ""]
        for les in lessons:
            time_end = LESSON_TIMES.get(les["time"], "")
            time_str = f"{les['time']}–{time_end}" if time_end else les["time"]
            lines.append(time_str)
            lines.append(les["subject"])
            details = []
            if les.get("type"):
                details.append(les["type"])
            if les.get("auditorium"):
                details.append(f"ауд. {les['auditorium']}")
            if les.get("teacher"):
                details.append(les["teacher"])
            if details:
                lines.append(f"{' · '.join(details)}")
            lines.append("")

        await bot.send_message(user_id, "\n".join(lines), parse_mode=None)
    except Exception as e:
        logging.error(f"[NOTIFY] user={user_id} error: {e}")


async def send_daily_quotes():
    subs = daily_get_all_subscribers()
    if not subs:
        return
    quote = random.choice(DAILY_QUOTES)
    text = f"Цитата дня\n\n{quote}"
    for uid in subs:
        try:
            await bot.send_message(uid, text, parse_mode=None)
        except Exception as e:
            logging.error(f"[QUOTE] user={uid}: {e}")
        await asyncio.sleep(0.05)


async def notification_worker():
    logging.info("[NOTIFY] воркер запущен")
    last_quote_date = None
    while True:
        try:
            now = _now_irkutsk()
            today_str = now.strftime("%Y-%m-%d")
            hh = now.hour
            mm = now.minute

            users = get_users_for_notification()
            for uid, gid, subgroup, ntype, nh, nm in users:
                if nh == hh and nm == mm:
                    await send_schedule_notification(uid, gid, subgroup, ntype)

            if hh == 10 and mm == 0 and last_quote_date != today_str:
                last_quote_date = today_str
                await send_daily_quotes()
        except Exception:
            logging.exception("[NOTIFY WORKER]")

        await asyncio.sleep(60 - datetime.now().second)


async def check_schedule_changes():
    users = get_users_for_change_tracking()
    if not users:
        return

    html_cache = {}
    now = _now_irkutsk()

    for uid, group_id, subgroup in users:
        try:
            for offset in (0, 1):
                target_monday = _monday_of_week(now) + timedelta(days=7 * offset)
                week_start_str = target_monday.strftime("%Y-%m-%d")

                cache_key = (group_id, week_start_str)
                if cache_key in html_cache:
                    html = html_cache[cache_key]
                else:
                    html = await fetch_week_html(group_id, target_monday, use_cache=False)
                    html_cache[cache_key] = html

                if not html:
                    continue

                _, days = parse_schedule(html)
                new_snap = make_snapshot_str(days)
                old_snap = get_snapshot(group_id, week_start_str)

                if old_snap is None:
                    save_snapshot(group_id, week_start_str, new_snap)
                    continue

                if old_snap != new_snap:
                    save_snapshot(group_id, week_start_str, new_snap)
                    label = "текущей" if offset == 0 else "следующей"
                    try:
                        await bot.send_message(
                            uid,
                            f"Изменения в расписании\n\n"
                            f"Обнаружены правки в расписании на {label} неделе.\n"
                            f"Открой приложение, чтобы посмотреть актуальную версию.",
                            parse_mode=None)
                    except Exception as e:
                        logging.error(f"[CHANGE] notify user={uid}: {e}")
        except Exception as e:
            logging.error(f"[CHANGE] user={uid}: {e}")


async def change_worker():
    logging.info("[CHANGE] воркер запущен")
    await asyncio.sleep(180)
    while True:
        try:
            await check_schedule_changes()
        except Exception:
            logging.exception("[CHANGE WORKER]")
        await asyncio.sleep(1800)


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        stream=sys.stdout, force=True)
    init_db()
    await bot.delete_webhook(drop_pending_updates=True)
    logging.info("Webhook удалён, polling")

    asyncio.create_task(start_webapp())
    asyncio.create_task(notification_worker())
    asyncio.create_task(change_worker())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
