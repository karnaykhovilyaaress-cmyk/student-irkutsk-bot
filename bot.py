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
    CallbackQuery, FSInputFile, WebAppInfo, BufferedInputFile
)
from aiogram.utils.web_app import safe_parse_webapp_init_data

try:
    from fpdf import FPDF
    _FPDF_AVAILABLE = True
except Exception:
    _FPDF_AVAILABLE = False


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
        "ALTER TABLE users ADD COLUMN notify_before_min INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN username TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN first_name TEXT DEFAULT NULL",
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
    for alter in [
        "ALTER TABLE grades ADD COLUMN is_auto INTEGER DEFAULT 0",
        "ALTER TABLE grades ADD COLUMN semester TEXT DEFAULT NULL",
    ]:
        try:
            conn.execute(alter)
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
        status TEXT DEFAULT 'new', answered_at TEXT, admin_reply TEXT DEFAULT NULL)""")
    for alter in [
        "ALTER TABLE feedback ADD COLUMN status TEXT DEFAULT 'new'",
        "ALTER TABLE feedback ADD COLUMN answered_at TEXT",
        "ALTER TABLE feedback ADD COLUMN admin_reply TEXT DEFAULT NULL",
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
    conn.execute("""CREATE TABLE IF NOT EXISTS game_scores (
        user_id INTEGER PRIMARY KEY,
        best_score INTEGER DEFAULT 0,
        plays_count INTEGER DEFAULT 0,
        updated_at TEXT)""")
    for alter in [
        "ALTER TABLE game_scores ADD COLUMN username TEXT DEFAULT NULL",
        "ALTER TABLE game_scores ADD COLUMN first_name TEXT DEFAULT NULL",
    ]:
        try:
            conn.execute(alter)
        except sqlite3.OperationalError:
            pass

    conn.execute("""CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        role TEXT,
        text TEXT,
        has_photo INTEGER DEFAULT 0,
        created_at TEXT)""")

    conn.execute("""CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        date TEXT,
        time TEXT,
        subject TEXT,
        status TEXT,
        updated_at TEXT,
        UNIQUE(user_id, date, time, subject))""")

    conn.commit(); conn.close()


def _ensure_user(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    conn.commit(); conn.close()


def _update_user_meta(user_id, username, first_name):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE users SET username=?, first_name=? WHERE user_id=?",
                 (username, first_name, user_id))
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


def upsert_grade(user_id, subject, grade, is_auto=0, semester=None):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT id FROM grades WHERE user_id=? AND LOWER(subject)=LOWER(?) AND COALESCE(semester,'')=COALESCE(?,'')",
        (user_id, subject, semester)
    ).fetchone()
    if row:
        conn.execute(
            "UPDATE grades SET grade=?, subject=?, is_auto=?, semester=?, created_at=? WHERE id=?",
            (grade, subject, int(bool(is_auto)), semester,
             datetime.now(timezone.utc).isoformat(), row[0])
        )
    else:
        conn.execute(
            "INSERT INTO grades (user_id, subject, grade, is_auto, semester, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, subject, grade, int(bool(is_auto)), semester,
             datetime.now(timezone.utc).isoformat())
        )
    conn.commit(); conn.close()


def get_grades(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, subject, grade, COALESCE(is_auto, 0), COALESCE(semester, '') "
        "FROM grades WHERE user_id=? ORDER BY subject",
        (user_id,)).fetchall()
    conn.close()
    return rows


def update_grade_by_id(grade_id, user_id, subject=None, grade=None, is_auto=None, semester=None):
    conn = sqlite3.connect(DB_PATH)
    fields = []; values = []
    if subject is not None:
        fields.append("subject=?"); values.append(subject)
    if grade is not None:
        fields.append("grade=?"); values.append(grade)
    if is_auto is not None:
        fields.append("is_auto=?"); values.append(int(bool(is_auto)))
    if semester is not None:
        fields.append("semester=?"); values.append(semester)
    if not fields:
        conn.close(); return
    values.extend([grade_id, user_id])
    conn.execute(f"UPDATE grades SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
    conn.commit(); conn.close()


def delete_grade(grade_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM grades WHERE id=? AND user_id=?", (grade_id, user_id))
    conn.commit(); conn.close()


def clear_grades(user_id, semester=None):
    conn = sqlite3.connect(DB_PATH)
    if semester:
        conn.execute("DELETE FROM grades WHERE user_id=? AND COALESCE(semester,'')=?", (user_id, semester))
    else:
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


def get_users_for_lesson_reminder():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, subgroup, notify_before_min FROM users "
        "WHERE notify_before_min > 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
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


def mark_feedback_answered(feedback_id, reply_text=None):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET status='answered', answered_at=?, admin_reply=? WHERE id=?",
                 (datetime.now(timezone.utc).isoformat(), reply_text, feedback_id))
    conn.commit(); conn.close()


def get_feedback_by_id(feedback_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, user_id, username, text FROM feedback WHERE id=?",
                       (feedback_id,)).fetchone()
    conn.close()
    return row


def get_user_feedback(user_id, limit=30):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, text, COALESCE(status,'new'), created_at, answered_at, admin_reply "
        "FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, limit)).fetchall()
    conn.close()
    return rows


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


# ============ ATTENDANCE ============

def attendance_set(user_id, date, time, subject, status):
    conn = sqlite3.connect(DB_PATH)
    if status:
        conn.execute(
            "INSERT INTO attendance (user_id, date, time, subject, status, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(user_id, date, time, subject) DO UPDATE SET "
            "status=excluded.status, updated_at=excluded.updated_at",
            (user_id, date, time, subject, status, datetime.now(timezone.utc).isoformat()))
    else:
        conn.execute(
            "DELETE FROM attendance WHERE user_id=? AND date=? AND time=? AND subject=?",
            (user_id, date, time, subject))
    conn.commit(); conn.close()


def attendance_get_map(user_id, dates):
    if not dates:
        return {}
    conn = sqlite3.connect(DB_PATH)
    placeholders = ",".join("?" * len(dates))
    rows = conn.execute(
        f"SELECT date, time, subject, status FROM attendance "
        f"WHERE user_id=? AND date IN ({placeholders})",
        (user_id, *dates)).fetchall()
    conn.close()
    result = {}
    for date, time_, subject, status in rows:
        result[(date, time_, subject)] = status
    return result


def attendance_stats(user_id):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT status, COUNT(*) FROM attendance WHERE user_id=? GROUP BY status",
        (user_id,)).fetchall()
    conn.close()
    result = {"was": 0, "missed": 0, "sick": 0}
    for status, count in rows:
        if status in result:
            result[status] = count
    return result


# ============ AI HISTORY ============

def ai_get_history(user_id, limit=30):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, role, text, has_photo, created_at FROM ai_messages "
        "WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, limit)).fetchall()
    conn.close()
    rows.reverse()
    return rows


def ai_save_message(user_id, role, text, has_photo=0):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO ai_messages (user_id, role, text, has_photo, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, role, text or '', int(bool(has_photo)), datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def ai_clear_history(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM ai_messages WHERE user_id=?", (user_id,))
    conn.commit(); conn.close()


# ============ GAME ============

def game_get_user_score(user_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT best_score, plays_count FROM game_scores WHERE user_id=?",
        (user_id,)).fetchone()
    conn.close()
    if row:
        return {"best": row[0] or 0, "plays": row[1] or 0}
    return {"best": 0, "plays": 0}


def game_save_score(user_id, score):
    score = max(0, min(int(score), 99999))
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT best_score, plays_count FROM game_scores WHERE user_id=?",
        (user_id,)).fetchone()
    meta = conn.execute("SELECT username, first_name FROM users WHERE user_id=?", (user_id,)).fetchone()
    username = meta[0] if meta else None
    first_name = meta[1] if meta else None

    now = datetime.now(timezone.utc).isoformat()
    if row:
        old_best = row[0] or 0
        plays = (row[1] or 0) + 1
        new_best = max(old_best, score)
        conn.execute(
            "UPDATE game_scores SET best_score=?, plays_count=?, updated_at=?, username=?, first_name=? WHERE user_id=?",
            (new_best, plays, now, username, first_name, user_id))
        is_record = score > old_best
    else:
        new_best = score
        plays = 1
        conn.execute(
            "INSERT INTO game_scores (user_id, best_score, plays_count, updated_at, username, first_name) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, score, 1, now, username, first_name))
        is_record = score > 0
    conn.commit(); conn.close()
    return {"best": new_best, "is_record": is_record, "plays": plays}


def game_get_leaderboard(limit=10):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT g.user_id, g.best_score, "
        "COALESCE(u.username, g.username, ''), "
        "COALESCE(u.first_name, g.first_name, '') "
        "FROM game_scores g "
        "LEFT JOIN users u ON u.user_id = g.user_id "
        "WHERE g.best_score > 0 ORDER BY g.best_score DESC LIMIT ?",
        (limit,)).fetchall()
    conn.close()
    return rows


# ============ EXPORT ============

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
    username = meta[0] if meta else None
    first_name = meta[1] if meta else None

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id,
        "username": username,
        "first_name": first_name,
        "group": saved[1] if saved else None,
        "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id),
        "scholarship_amount": amount,
        "tasks": [
            {"id": t[0], "text": t[1], "due_date": t[2], "done": bool(t[3]),
             "priority": t[5], "due_time": t[6]}
            for t in tasks
        ],
        "notes": [{"id": n[0], "subject": n[1], "text": n[2]} for n in notes],
        "grades": [
            {"id": g[0], "subject": g[1], "grade": g[2],
             "is_auto": bool(g[3]), "semester": g[4]}
            for g in grades
        ],
        "feedback": [
            {"id": f[0], "text": f[1], "status": f[2], "created_at": f[3],
             "answered_at": f[4], "admin_reply": f[5]}
            for f in feedback
        ],
        "attendance": att,
    }


# ⚠️ ВСТАВЬ СЮДА СВОЮ СТАРУЮ СЕКЦИЮ GROUPS
# Она не менялась. Скопируй её полностью из предыдущего файла bot.py.
GROUPS = {
    # ... вставь свой старый словарь GROUPS здесь целиком
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


def _verify_webapp_init_full(init_data: str):
    if not init_data:
        return None
    try:
        data = safe_parse_webapp_init_data(token=TOKEN, init_data=init_data)
        if data and data.user:
            return data.user
    except Exception as e:
        logging.warning(f"[WEB] initData verify error: {e}")
    return None


def _verify_webapp_init(init_data: str):
    u = _verify_webapp_init_full(init_data)
    return u.id if u else None


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
    att_map = attendance_get_map(user_id, [day["date"]])
    lessons_out = []
    for les in filtered:
        key = (day["date"], les["time"], les["subject"])
        lessons_out.append({
            "time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
            "subject": les["subject"], "type": les["type"],
            "teacher": les["teacher"], "auditorium": les["auditorium"],
            "subgroup": les["subgroup"],
            "date": day["date"],
            "attendance": att_map.get(key, ""),
        })
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
    dates_list = [d["date"] for d in days]
    att_map = attendance_get_map(user_id, dates_list)
    days_out = []
    for d in days:
        filtered = _filter_lessons_by_subgroup(d["lessons"], subgroup)
        lessons_out = []
        for les in filtered:
            key = (d["date"], les["time"], les["subject"])
            lessons_out.append({
                "time": les["time"], "timeEnd": LESSON_TIMES.get(les["time"], ""),
                "subject": les["subject"], "type": les["type"],
                "teacher": les["teacher"], "auditorium": les["auditorium"],
                "subgroup": les["subgroup"],
                "date": d["date"],
                "attendance": att_map.get(key, ""),
            })
        days_out.append({"date": d["date"], "name": d["name"], "lessons": lessons_out})
    return web.json_response({"group": group_name, "subgroup": subgroup, "days": days_out})


async def api_me(request: web.Request):
    init_data = request.query.get("initData", "")
    user_obj = _verify_webapp_init_full(init_data)
    if not user_obj:
        return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id

    _ensure_user(user_id)
    _update_user_meta(user_id, user_obj.username, user_obj.first_name)

    saved = get_user_group(user_id)
    active, done = count_user_tasks(user_id)
    notes = get_user_notes(user_id)
    amount = get_scholarship_amount(user_id)
    grades = get_grades(user_id)
    daily = daily_is_subscribed(user_id)
    notif_settings = get_notify_settings(user_id)

    avg = sum(g[2] for g in grades) / len(grades) if grades else 0
    att_stats = attendance_stats(user_id)

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
        "notify_before_min": get_notify_before_min(user_id),
        "attendance_was": att_stats["was"],
        "attendance_missed": att_stats["missed"],
        "attendance_sick": att_stats["sick"],
        "attendance_total": att_stats["was"] + att_stats["missed"] + att_stats["sick"],
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


async def api_notify_set_before(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        minutes = int(body.get("minutes", 0))
    except Exception:
        return web.json_response({"error": "bad_minutes"}, status=400)
    if minutes not in (0, 5, 10, 15, 20, 30, 60):
        minutes = 0
    set_notify_before_min(user_id, minutes)
    return web.json_response({"ok": True, "minutes": minutes})


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

    grades_out = [{"id": g[0], "subject": g[1], "grade": g[2], "is_auto": bool(g[3]), "semester": g[4] or ""} for g in grades]
    semesters = sorted(set(g[4] for g in grades if g[4]))

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
        "semesters": semesters,
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
    semester = (body.get("semester") or "").strip() or None
    if not subject or grade not in (2, 3, 4, 5):
        return web.json_response({"error": "invalid"}, status=400)
    if len(subject) > 100:
        subject = subject[:100]
    if semester and len(semester) > 40:
        semester = semester[:40]
    upsert_grade(user_id, subject, grade, is_auto, semester)
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

    semester = body.get("semester")
    if semester is not None:
        semester = (semester or "").strip()
        if len(semester) > 40:
            semester = semester[:40]

    update_grade_by_id(gid, user_id, subject if subject else None, grade, is_auto, semester)
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
    semester = body.get("semester")
    if semester is not None:
        semester = (semester or "").strip() or None
    clear_grades(user_id, semester)
    return web.json_response({"ok": True})


async def api_attendance_set(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    date = (body.get("date") or "").strip()
    time_ = (body.get("time") or "").strip()
    subject = (body.get("subject") or "").strip()
    status = (body.get("status") or "").strip()
    if not date or not time_ or not subject:
        return web.json_response({"error": "empty"}, status=400)
    if status not in ("", "was", "missed", "sick"):
        return web.json_response({"error": "bad_status"}, status=400)
    if len(subject) > 200:
        subject = subject[:200]
    attendance_set(user_id, date, time_, subject, status)
    return web.json_response({"ok": True, "status": status})


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

    ai_save_message(user_id, 'user', question, has_photo=0)

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

        ai_save_message(user_id, 'assistant', answer, has_photo=0)
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

    ai_save_message(user_id, 'user', question or 'Что на фото?', has_photo=1)

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

        ai_save_message(user_id, 'assistant', answer, has_photo=0)
        return web.json_response({"answer": answer})
    except Exception as e:
        logging.exception("[AI-PHOTO-GIGA]")
        return web.json_response({"error": "ai_failed", "message": str(e)}, status=500)


async def api_ai_history(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    rows = ai_get_history(user_id, limit=30)
    items = [{"id": r[0], "role": r[1], "text": r[2], "has_photo": bool(r[3])} for r in rows]
    return web.json_response({"items": items})


async def api_ai_clear_history(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    ai_clear_history(user_id)
    return web.json_response({"ok": True})


async def api_game_info(request: web.Request):
    init_data = request.query.get("initData", "")
    user_obj = _verify_webapp_init_full(init_data)
    if not user_obj:
        return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id
    _ensure_user(user_id)
    _update_user_meta(user_id, user_obj.username, user_obj.first_name)

    data = game_get_user_score(user_id)
    rows = game_get_leaderboard(10)
    items = []
    for i, (uid, score, username, first_name) in enumerate(rows):
        if first_name and username:
            display = f"{first_name} (@{username})"
        elif first_name:
            display = first_name
        elif username:
            display = "@" + username
        else:
            display = f"Игрок #{str(uid)[-4:]}"
        items.append({
            "rank": i + 1,
            "user_id": uid,
            "score": score,
            "username": username or "",
            "first_name": first_name or "",
            "display": display,
            "is_me": uid == user_id,
        })
    return web.json_response({
        "best": data["best"],
        "plays": data["plays"],
        "top": items,
    })


async def api_game_submit(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_obj = _verify_webapp_init_full(body.get("initData", ""))
    if not user_obj:
        return web.json_response({"error": "unauthorized"}, status=401)
    user_id = user_obj.id
    _ensure_user(user_id)
    _update_user_meta(user_id, user_obj.username, user_obj.first_name)

    try:
        score = int(body.get("score", 0))
    except Exception:
        score = 0
    result = game_save_score(user_id, score)
    rows = game_get_leaderboard(10)
    items = []
    for i, (uid, s, username, first_name) in enumerate(rows):
        if first_name and username:
            display = f"{first_name} (@{username})"
        elif first_name:
            display = first_name
        elif username:
            display = "@" + username
        else:
            display = f"Игрок #{str(uid)[-4:]}"
        items.append({
            "rank": i + 1,
            "user_id": uid,
            "score": s,
            "username": username or "",
            "first_name": first_name or "",
            "display": display,
            "is_me": uid == user_id,
        })
    return web.json_response({
        "ok": True,
        "best": result["best"],
        "is_record": result["is_record"],
        "plays": result["plays"],
        "top": items,
    })


async def api_feedback_my(request: web.Request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)
    rows = get_user_feedback(user_id, limit=30)
    items = []
    for r in rows:
        items.append({
            "id": r[0],
            "text": r[1],
            "status": r[2],
            "created_at": r[3],
            "answered_at": r[4],
            "admin_reply": r[5],
        })
    return web.json_response({"items": items})


def _find_or_download_pdf_font():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        os.path.join(base_dir, "fonts", "DejaVuSans.ttf"),
        "fonts/DejaVuSans.ttf",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    try:
        target_dir = os.path.join(base_dir, "fonts")
        os.makedirs(target_dir, exist_ok=True)
        target = os.path.join(target_dir, "DejaVuSans.ttf")
        import urllib.request
        urls = [
            "https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf",
            "https://cdn.jsdelivr.net/gh/dejavu-fonts/dejavu-fonts@master/ttf/DejaVuSans.ttf",
        ]
        for url in urls:
            try:
                with urllib.request.urlopen(url, timeout=45) as resp:
                    data = resp.read()
                    if len(data) > 100000:
                        with open(target, "wb") as f:
                            f.write(data)
                        logging.info(f"[PDF FONT] скачан: {target}")
                        return target
            except Exception as e:
                logging.warning(f"[PDF FONT] {url}: {e}")
    except Exception as e:
        logging.warning(f"[PDF FONT] download failed: {e}")
    return None


def _pdf_short(text, limit=120):
    if not text:
        return ""
    s = str(text).replace("\r", "").strip()
    if len(s) > limit:
        s = s[:limit - 1] + "…"
    return s


def generate_user_pdf(user_id):
    if not _FPDF_AVAILABLE:
        raise RuntimeError("Библиотека fpdf2 не установлена")

    font_path = _find_or_download_pdf_font()
    if not font_path:
        raise RuntimeError("Не удалось найти шрифт для PDF")

    data = get_export_data(user_id)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_font("Main", "", font_path)
    pdf.set_font("Main", size=11)
    pdf.add_page()

    def hr():
        pdf.set_draw_color(200, 200, 200)
        pdf.set_line_width(0.2)
        y = pdf.get_y()
        pdf.line(15, y, 195, y)
        pdf.ln(3)

    def section(title):
        pdf.ln(3)
        pdf.set_font("Main", size=14)
        pdf.set_text_color(0, 180, 160)
        pdf.cell(0, 8, title, ln=True)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Main", size=11)
        hr()

    pdf.set_font("Main", size=22)
    pdf.cell(0, 12, "Student IRK", ln=True)
    pdf.set_font("Main", size=10)
    pdf.set_text_color(120, 120, 120)
    now_str = _now_irkutsk().strftime("%d.%m.%Y в %H:%M")
    pdf.cell(0, 6, f"Отчёт от {now_str}", ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    pdf.set_font("Main", size=12)
    name = data.get("first_name") or "Не указано"
    uname = data.get("username")
    if uname:
        name = f"{name} (@{uname})"
    pdf.cell(0, 7, f"Пользователь: {name}", ln=True)
    pdf.set_font("Main", size=11)
    pdf.cell(0, 6, f"ID: {user_id}", ln=True)
    if data.get("group"):
        g = data["group"]
        if data.get("subgroup"):
            g += f" · подгруппа {data['subgroup']}"
        pdf.cell(0, 6, f"Группа: {g}", ln=True)

    tasks = data.get("tasks", [])
    active_tasks = [t for t in tasks if not t["done"]]
    done_tasks = [t for t in tasks if t["done"]]
    section(f"Задачи ({len(tasks)}: активных {len(active_tasks)}, выполнено {len(done_tasks)})")
    if not tasks:
        pdf.cell(0, 6, "Нет задач", ln=True)
    else:
        prio_map = {1: "низкий", 2: "средний", 3: "высокий"}
        for t in tasks:
            mark = "[v]" if t["done"] else "[ ]"
            text = _pdf_short(t["text"], 100)
            pdf.set_font("Main", size=11)
            pdf.multi_cell(0, 5.5, f"{mark} {text}")
            meta_parts = []
            if t.get("due_date"):
                due = f"до {t['due_date']}"
                if t.get("due_time"):
                    due += f" {t['due_time']}"
                meta_parts.append(due)
            pr = t.get("priority", 2)
            meta_parts.append(f"приоритет: {prio_map.get(pr, 'средний')}")
            pdf.set_font("Main", size=9)
            pdf.set_text_color(130, 130, 130)
            pdf.cell(0, 5, "    " + " · ".join(meta_parts), ln=True)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Main", size=11)

    notes = data.get("notes", [])
    section(f"Заметки ({len(notes)})")
    if not notes:
        pdf.cell(0, 6, "Нет заметок", ln=True)
    else:
        for n in notes:
            pdf.set_font("Main", size=11)
            pdf.multi_cell(0, 5.5, f"{n['subject']}:")
            pdf.set_font("Main", size=10)
            pdf.set_text_color(70, 70, 70)
            pdf.multi_cell(0, 5, "    " + _pdf_short(n["text"], 400))
            pdf.set_text_color(0, 0, 0)
            pdf.ln(1)

    section("Стипендия")
    amount = data.get("scholarship_amount")
    if amount is None or amount == 0:
        pdf.cell(0, 6, "Сумма не указана", ln=True)
    else:
        pdf.cell(0, 6, f"Сумма: {amount} руб./мес", ln=True)
    grades = data.get("grades", [])
    if grades:
        avg = sum(g["grade"] for g in grades) / len(grades)
        pdf.cell(0, 6, f"Средний балл: {avg:.2f} ({len(grades)} предметов)", ln=True)
        pdf.ln(1)
        for g in grades:
            auto = " (автомат)" if g.get("is_auto") else ""
            sem = f" · {g['semester']}" if g.get("semester") else ""
            pdf.cell(0, 5.5, f"  {g['subject']}: {g['grade']}{auto}{sem}", ln=True)
    else:
        pdf.cell(0, 6, "Оценок нет", ln=True)

    att = data.get("attendance", {})
    total = att.get("was", 0) + att.get("missed", 0) + att.get("sick", 0)
    section(f"Посещаемость (отмечено {total})")
    if total == 0:
        pdf.cell(0, 6, "Отметок пока нет", ln=True)
    else:
        pdf.cell(0, 6, f"Посещено: {att.get('was', 0)}", ln=True)
        pdf.cell(0, 6, f"Пропущено: {att.get('missed', 0)}", ln=True)
        pdf.cell(0, 6, f"По болезни: {att.get('sick', 0)}", ln=True)

    feedback = data.get("feedback", [])
    if feedback:
        section(f"Обращения ({len(feedback)})")
        for f in feedback[:20]:
            date_str = (f.get("created_at") or "")[:10]
            pdf.set_font("Main", size=10)
            pdf.set_text_color(130, 130, 130)
            pdf.cell(0, 5, f"#{f['id']} · {date_str}", ln=True)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Main", size=11)
            pdf.multi_cell(0, 5.5, "    " + _pdf_short(f["text"], 400))
            if f.get("admin_reply"):
                pdf.set_font("Main", size=10)
                pdf.set_text_color(0, 150, 130)
                pdf.multi_cell(0, 5, "    Ответ: " + _pdf_short(f["admin_reply"], 400))
                pdf.set_text_color(0, 0, 0)
            pdf.ln(1)

    pdf.ln(6)
    hr()
    pdf.set_font("Main", size=9)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 5, "Сгенерировано ботом Student IRK", ln=True, align="C")

    out = pdf.output()
    if isinstance(out, str):
        out = out.encode("latin-1")
    return bytes(out)


async def api_export(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        return web.json_response({"error": "unauthorized"}, status=401)

    try:
        pdf_bytes = await asyncio.to_thread(generate_user_pdf, user_id)
    except Exception as e:
        logging.exception("[PDF]")
        return web.json_response({"error": "pdf_failed", "message": str(e)}, status=500)

    date_str = _now_irkutsk().strftime("%Y-%m-%d")
    try:
        doc = BufferedInputFile(pdf_bytes, filename=f"student_irk_{date_str}.pdf")
        await bot.send_document(
            user_id, doc,
            caption="Твой отчёт Student IRK. Открой PDF — там задачи, заметки, оценки и посещаемость.")
        return web.json_response({"ok": True})
    except Exception as e:
        logging.error(f"[EXPORT] {e}")
        return web.json_response({"error": str(e)}, status=500)


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
        mark_feedback_answered(fid, reply)
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
    app.router.add_get("/api/ai/history", api_ai_history)
    app.router.add_post("/api/ai/clear-history", api_ai_clear_history)
    app.router.add_post("/api/ai", api_ai)
    app.router.add_post("/api/ai-photo", api_ai_photo)
    app.router.add_post("/api/feedback", api_feedback)
    app.router.add_get("/api/feedback/my", api_feedback_my)
    app.router.add_post("/api/export", api_export)
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
    try:
        _update_user_meta(message.from_user.id, message.from_user.username, message.from_user.first_name)
    except Exception:
        pass

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


async def send_lesson_reminder(user_id, les, before_min):
    try:
        subject = les.get("subject", "Пара")
        time_str = les.get("time", "")
        auditorium = les.get("auditorium", "")
        teacher = les.get("teacher", "")
        text = f"Через {before_min} мин — {subject}"
        if time_str:
            text += f" в {time_str}"
        details = []
        if auditorium:
            details.append(f"ауд. {auditorium}")
        if teacher:
            details.append(teacher)
        if details:
            text += "\n" + " · ".join(details)
        await bot.send_message(user_id, text, parse_mode=None)
    except Exception as e:
        logging.error(f"[REMIND] send user={user_id}: {e}")


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


async def lesson_reminder_worker():
    logging.info("[REMIND] воркер запущен")
    sent_keys = set()
    while True:
        try:
            now = _now_irkutsk()
            today_str = now.strftime("%d.%m.%Y")
            if len(sent_keys) > 20000:
                sent_keys.clear()

            users = get_users_for_lesson_reminder()
            html_cache = {}
            for uid, gid, subgroup, before_min in users:
                try:
                    monday = _monday_of_week(now)
                    key_cache = (gid, monday.strftime("%Y-%m-%d"))
                    if key_cache in html_cache:
                        html = html_cache[key_cache]
                    else:
                        html = await fetch_week_html(gid, monday, use_cache=True)
                        html_cache[key_cache] = html
                    if not html:
                        continue
                    _, days = parse_schedule(html)
                    day = next((d for d in days if d["date"] == today_str), None)
                    if not day:
                        continue
                    lessons = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
                    for les in lessons:
                        time_str = les.get("time", "")
                        if not time_str or ":" not in time_str:
                            continue
                        try:
                            hh_s, mm_s = time_str.split(":")
                            lesson_dt = now.replace(hour=int(hh_s), minute=int(mm_s), second=0, microsecond=0)
                        except Exception:
                            continue
                        delta_min = (lesson_dt - now).total_seconds() / 60
                        if abs(delta_min - before_min) < 1:
                            key = (uid, today_str, time_str, before_min)
                            if key in sent_keys:
                                continue
                            sent_keys.add(key)
                            await send_lesson_reminder(uid, les, before_min)
                except Exception as e:
                    logging.error(f"[REMIND] user={uid}: {e}")
        except Exception:
            logging.exception("[REMIND WORKER]")
        await asyncio.sleep(60)


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

    try:
        if _FPDF_AVAILABLE:
            await asyncio.to_thread(_find_or_download_pdf_font)
    except Exception as e:
        logging.warning(f"[PDF FONT preload] {e}")

    asyncio.create_task(start_webapp())
    asyncio.create_task(notification_worker())
    asyncio.create_task(lesson_reminder_worker())
    asyncio.create_task(change_worker())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
