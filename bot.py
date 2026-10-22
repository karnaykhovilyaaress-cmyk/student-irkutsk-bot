from dotenv import load_dotenv
load_dotenv()
import os, asyncio, re, sys, json, base64, random, secrets, sqlite3, logging, shutil, io
import hashlib
import urllib.parse
from datetime import datetime, timedelta, timezone
import aiohttp
from aiohttp import web
from bs4 import BeautifulSoup
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (Message, InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, FSInputFile, WebAppInfo, BufferedInputFile)
from aiogram.utils.web_app import safe_parse_webapp_init_data
try:
    from aiogram.exceptions import TelegramForbiddenError, TelegramBadRequest
except Exception:
    class TelegramForbiddenError(Exception): pass
    class TelegramBadRequest(Exception): pass
try:
    from fpdf import FPDF
    _FPDF_AVAILABLE = True
except Exception:
    _FPDF_AVAILABLE = False
try:
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE
    _PPTX_AVAILABLE = True
except Exception as _e:
    print(f"[PPTX] python-pptx not installed: {_e}")
    _PPTX_AVAILABLE = False

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _MATPLOTLIB_AVAILABLE = True
except Exception:
    _MATPLOTLIB_AVAILABLE = False


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
ADMIN_ID = int(os.getenv("ADMIN_ID", "6014557174"))
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "ilyaech")
BOT_USERNAME = os.getenv("BOT_USERNAME", "@student_irk38_bot")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")
CACHE_TTL_HOURS = int(os.getenv("CACHE_TTL_HOURS", "2"))
DB_PATH = os.getenv("DB_PATH", "users.db")

WEATHER_LAT = float(os.getenv("WEATHER_LAT", "52.2864"))
WEATHER_LON = float(os.getenv("WEATHER_LON", "104.2807"))
WEATHER_CITY = os.getenv("WEATHER_CITY", "Иркутск")
AI_CACHE_TTL_DAYS = int(os.getenv("AI_CACHE_TTL_DAYS", "7"))

if not TOKEN:
    logging.error("BOT_TOKEN не задан!"); sys.exit(1)
bot = Bot(token=TOKEN)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
giga_client = None
if GIGACHAT_CREDENTIALS:
    try:
        from gigachat import GigaChat
        giga_client = GigaChat(
            credentials=GIGACHAT_CREDENTIALS,
            base_url="https://api.giga.chat/v1",
            scope="GIGACHAT_API_PERS",
            model="GigaChat-2-Max",
            timeout=600,
            verify_ssl_certs=False,
        )
    except Exception as e:
        logging.error(f"GigaChat ошибка: {e}")


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    try:
        mode = conn.execute("PRAGMA journal_mode=WAL").fetchone()
        if not mode or mode[0] != "wal":
            logging.warning(f"[SQLITE] WAL недоступен, режим: {mode}")
    except Exception as e:
        logging.warning(f"[SQLITE] PRAGMA WAL: {e}")
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
    except Exception:
        pass
    return conn


def _table_columns(conn, table: str):
    try:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return {r[1] for r in rows}
    except Exception:
        return set()


def _ensure_column(conn, table: str, column: str, ddl: str):
    cols = _table_columns(conn, table)
    if column in cols:
        return False
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        logging.info(f"[DB] ALTER {table} ADD COLUMN {column}")
        return True
    except Exception as e:
        logging.warning(f"[DB] ALTER {table} ADD COLUMN {column} failed: {e}")
        return False


def init_db():
    conn = _connect()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            group_id TEXT,
            group_name TEXT,
            notify_hour INTEGER DEFAULT -1,
            notify_minute INTEGER DEFAULT 0,
            notify_changes INTEGER DEFAULT 0,
            subgroup INTEGER DEFAULT 0
        )""")
        _ensure_column(conn, "users", "group_id",       "group_id TEXT")
        _ensure_column(conn, "users", "group_name",     "group_name TEXT")
        _ensure_column(conn, "users", "notify_hour",    "notify_hour INTEGER DEFAULT -1")
        _ensure_column(conn, "users", "notify_minute",  "notify_minute INTEGER DEFAULT 0")
        _ensure_column(conn, "users", "notify_changes", "notify_changes INTEGER DEFAULT 0")
        _ensure_column(conn, "users", "subgroup",       "subgroup INTEGER DEFAULT 0")
        _ensure_column(conn, "users", "notify_type",    "notify_type TEXT DEFAULT NULL")
        _ensure_column(conn, "users", "last_notified_at", "last_notified_at TEXT DEFAULT NULL")
        _ensure_column(conn, "users", "notify_before_min", "notify_before_min INTEGER DEFAULT 0")
        _ensure_column(conn, "users", "username",       "username TEXT DEFAULT NULL")
        _ensure_column(conn, "users", "first_name",     "first_name TEXT DEFAULT NULL")

        conn.execute("""CREATE TABLE IF NOT EXISTS daily_subscribers (
            user_id INTEGER PRIMARY KEY, subscribed_at TEXT)""")

        conn.execute("""CREATE TABLE IF NOT EXISTS scholarship (
            user_id INTEGER PRIMARY KEY,
            current_amount INTEGER DEFAULT 0,
            updated_at TEXT)""")

        conn.execute("""CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, subject TEXT, grade INTEGER,
            created_at TEXT, is_auto INTEGER DEFAULT 0, semester TEXT DEFAULT NULL)""")
        _ensure_column(conn, "grades", "is_auto",  "is_auto INTEGER DEFAULT 0")
        _ensure_column(conn, "grades", "semester", "semester TEXT DEFAULT NULL")

        conn.execute("""CREATE TABLE IF NOT EXISTS schedule_cache (
            group_id TEXT, week_start TEXT, html TEXT, cached_at TEXT,
            PRIMARY KEY (group_id, week_start))""")

        conn.execute("""CREATE TABLE IF NOT EXISTS schedule_snapshots (
            group_id TEXT, week_start TEXT, snapshot TEXT, updated_at TEXT,
            PRIMARY KEY (group_id, week_start))""")

        conn.execute("""CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, username TEXT, text TEXT, created_at TEXT,
            admin_msg_id INTEGER, status TEXT DEFAULT 'new',
            answered_at TEXT, admin_reply TEXT DEFAULT NULL)""")
        _ensure_column(conn, "feedback", "status",      "status TEXT DEFAULT 'new'")
        _ensure_column(conn, "feedback", "answered_at", "answered_at TEXT")
        _ensure_column(conn, "feedback", "admin_reply", "admin_reply TEXT DEFAULT NULL")
        try:
            conn.execute("UPDATE feedback SET status='new' WHERE status IS NULL")
        except Exception:
            pass

        conn.execute("""CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, text TEXT, due_date TEXT, done INTEGER DEFAULT 0,
            created_at TEXT, priority INTEGER DEFAULT 2, due_time TEXT, done_at TEXT)""")
        _ensure_column(conn, "tasks", "priority",    "priority INTEGER DEFAULT 2")
        _ensure_column(conn, "tasks", "due_time",    "due_time TEXT")
        _ensure_column(conn, "tasks", "done_at",     "done_at TEXT")
        _ensure_column(conn, "tasks", "tags",        "tags TEXT DEFAULT ''")
        _ensure_column(conn, "tasks", "repeat_rule", "repeat_rule TEXT DEFAULT NULL")

        conn.execute("""CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, subject TEXT, text TEXT, created_at TEXT)""")
        _ensure_column(conn, "notes", "tags",       "tags TEXT DEFAULT ''")
        _ensure_column(conn, "notes", "pinned",     "pinned INTEGER DEFAULT 0")
        _ensure_column(conn, "notes", "updated_at", "updated_at TEXT DEFAULT NULL")

        conn.execute("""CREATE TABLE IF NOT EXISTS ai_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, role TEXT, text TEXT,
            has_photo INTEGER DEFAULT 0, created_at TEXT)""")

        conn.execute("""CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, date TEXT, time TEXT, subject TEXT,
            status TEXT, updated_at TEXT,
            UNIQUE(user_id, date, time, subject))""")

        conn.execute("""CREATE TABLE IF NOT EXISTS ai_cache (
            prompt_hash TEXT PRIMARY KEY,
            question TEXT, answer TEXT,
            created_at TEXT, hits INTEGER DEFAULT 0
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_cache(created_at)")

        conn.execute("""CREATE TABLE IF NOT EXISTS weather_cache (
            cache_key TEXT PRIMARY KEY,
            payload TEXT, updated_at TEXT
        )""")

        conn.execute("""CREATE TABLE IF NOT EXISTS debts_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER, user_id INTEGER,
            old_due TEXT, new_due TEXT,
            moved_at TEXT
        )""")

        conn.commit()
        logging.info("[DB] init_db OK")
    except Exception as e:
        logging.exception(f"[DB] init_db error: {e}")
        raise
    finally:
        conn.close()


def _ensure_user(user_id):
    conn = _connect()
    try:
        conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
        conn.commit()
    finally:
        conn.close()


def _update_user_meta(user_id, username, first_name):
    conn = _connect()
    try:
        conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
        conn.execute("UPDATE users SET username=?, first_name=? WHERE user_id=?",
                     (username, first_name, user_id))
        conn.commit()
    finally:
        conn.close()


def user_exists(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT 1 FROM users WHERE user_id=?", (user_id,)).fetchone()
        return row is not None
    finally:
        conn.close()


def save_user_group(user_id, group_id, group_name):
    conn = _connect()
    try:
        conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
        cols = _table_columns(conn, "users")
        if "group_id" not in cols or "group_name" not in cols:
            logging.error(f"[DB] users без колонок group_id/group_name. cols={sorted(cols)}")
            return False
        conn.execute(
            "UPDATE users SET group_id=?, group_name=? WHERE user_id=?",
            (str(group_id), str(group_name), user_id)
        )
        conn.commit()
        row = conn.execute(
            "SELECT group_id, group_name FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        ok = bool(row and row[0] == str(group_id) and row[1] == str(group_name))
        if not ok:
            logging.warning(f"[DB] save_user_group: не сохранилось. user={user_id} row={row}")
        return ok
    except Exception as e:
        logging.exception(f"[DB] save_user_group error: {e}")
        return False
    finally:
        conn.close()


def get_user_group(user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT group_id, group_name FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        return row if row and row[0] else None
    finally:
        conn.close()


def delete_user_group(user_id):
    conn = _connect()
    try:
        conn.execute("""UPDATE users SET group_id=NULL, group_name=NULL,
            notify_hour=-1, notify_changes=0, subgroup=0, notify_type=NULL
            WHERE user_id=?""", (user_id,))
        conn.commit()
    finally:
        conn.close()


def set_user_subgroup(user_id, subgroup):
    conn = _connect()
    try:
        conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
        conn.execute("UPDATE users SET subgroup=? WHERE user_id=?", (int(subgroup), user_id))
        conn.commit()
    finally:
        conn.close()


def get_user_subgroup(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT subgroup FROM users WHERE user_id=?", (user_id,)).fetchone()
        return row[0] if row and row[0] is not None else 0
    finally:
        conn.close()


def daily_subscribe(user_id):
    conn = _connect()
    try:
        conn.execute("INSERT OR IGNORE INTO daily_subscribers (user_id, subscribed_at) VALUES (?, ?)",
            (user_id, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()

def daily_unsubscribe(user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM daily_subscribers WHERE user_id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()

def daily_is_subscribed(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT 1 FROM daily_subscribers WHERE user_id=?", (user_id,)).fetchone()
        return row is not None
    finally:
        conn.close()

def daily_get_all_subscribers():
    conn = _connect()
    try:
        rows = conn.execute("SELECT user_id FROM daily_subscribers").fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


def set_scholarship_amount(user_id, amount):
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO scholarship (user_id, current_amount, updated_at) VALUES (?, ?, ?)",
            (user_id, amount, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()

def get_scholarship_amount(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT current_amount FROM scholarship WHERE user_id=?", (user_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def upsert_grade(user_id, subject, grade, is_auto=0, semester=None):
    conn = _connect()
    try:
        row = conn.execute("SELECT id FROM grades WHERE user_id=? AND LOWER(subject)=LOWER(?) AND COALESCE(semester,'')=COALESCE(?,'')",
            (user_id, subject, semester)).fetchone()
        if row:
            conn.execute("UPDATE grades SET grade=?, subject=?, is_auto=?, semester=?, created_at=? WHERE id=?",
                (grade, subject, int(bool(is_auto)), semester, datetime.now(timezone.utc).isoformat(), row[0]))
        else:
            conn.execute("INSERT INTO grades (user_id, subject, grade, is_auto, semester, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, subject, grade, int(bool(is_auto)), semester, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()

def get_grades(user_id):
    conn = _connect()
    try:
        rows = conn.execute("SELECT id, subject, grade, COALESCE(is_auto, 0), COALESCE(semester, '') FROM grades WHERE user_id=? ORDER BY subject", (user_id,)).fetchall()
        return rows
    finally:
        conn.close()

_ALLOWED_GRADE_COLS = {"subject", "grade", "is_auto", "semester"}

def update_grade_by_id(grade_id, user_id, subject=None, grade=None, is_auto=None, semester=None):
    conn = _connect(); fields = []; values = []
    try:
        for name, val in (("subject", subject), ("grade", grade),
                          ("is_auto", None if is_auto is None else int(bool(is_auto))),
                          ("semester", semester)):
            if val is not None and name in _ALLOWED_GRADE_COLS:
                fields.append(f"{name}=?"); values.append(val)
        if not fields: return
        values.extend([grade_id, user_id])
        conn.execute(f"UPDATE grades SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
        conn.commit()
    finally:
        conn.close()

def delete_grade(grade_id, user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM grades WHERE id=? AND user_id=?", (grade_id, user_id))
        conn.commit()
    finally:
        conn.close()

def clear_grades(user_id, semester=None):
    conn = _connect()
    try:
        if semester: conn.execute("DELETE FROM grades WHERE user_id=? AND COALESCE(semester,'')=?", (user_id, semester))
        else: conn.execute("DELETE FROM grades WHERE user_id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def set_notify_changes(user_id, enabled):
    _ensure_user(user_id)
    conn = _connect()
    try:
        conn.execute("UPDATE users SET notify_changes=? WHERE user_id=?", (1 if enabled else 0, user_id))
        conn.commit()
    finally:
        conn.close()

def get_notify_changes(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT notify_changes FROM users WHERE user_id=?", (user_id,)).fetchone()
        return bool(row and row[0])
    finally:
        conn.close()

def set_notify_settings(user_id, ntype, hour, minute):
    _ensure_user(user_id)
    conn = _connect()
    try:
        conn.execute("UPDATE users SET notify_type=?, notify_hour=?, notify_minute=? WHERE user_id=?", (ntype, hour, minute, user_id))
        conn.commit()
    finally:
        conn.close()

def get_notify_settings(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT notify_type, notify_hour, notify_minute FROM users WHERE user_id=?", (user_id,)).fetchone()
        if row and row[0]:
            return {"type": row[0], "hour": row[1] if row[1] is not None else 0, "minute": row[2] if row[2] is not None else 0}
        return None
    finally:
        conn.close()

def set_notify_before_min(user_id, minutes):
    _ensure_user(user_id)
    conn = _connect()
    try:
        conn.execute("UPDATE users SET notify_before_min=? WHERE user_id=?", (int(minutes), user_id))
        conn.commit()
    finally:
        conn.close()

def get_notify_before_min(user_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT notify_before_min FROM users WHERE user_id=?", (user_id,)).fetchone()
        return int(row[0]) if row and row[0] is not None else 0
    finally:
        conn.close()

def get_users_for_notification():
    conn = _connect()
    try:
        rows = conn.execute("SELECT user_id, group_id, subgroup, notify_type, notify_hour, notify_minute FROM users WHERE notify_type IS NOT NULL AND notify_type != '' AND notify_hour >= 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
        return rows
    finally:
        conn.close()

def get_users_for_change_tracking():
    conn = _connect()
    try:
        rows = conn.execute("SELECT user_id, group_id, subgroup FROM users WHERE notify_changes=1 AND group_id IS NOT NULL AND group_id != ''").fetchall()
        return rows
    finally:
        conn.close()

def get_users_for_lesson_reminder():
    conn = _connect()
    try:
        rows = conn.execute("SELECT user_id, group_id, subgroup, notify_before_min FROM users WHERE notify_before_min > 0 AND group_id IS NOT NULL AND group_id != ''").fetchall()
        return rows
    finally:
        conn.close()

def get_total_users():
    conn = _connect()
    try:
        n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        return n
    finally:
        conn.close()

def get_all_user_ids():
    conn = _connect()
    try:
        rows = conn.execute("SELECT user_id FROM users").fetchall()
        return [r[0] for r in rows]
    finally:
        conn.close()


def get_cached_schedule(group_id, week_start):
    conn = _connect()
    try:
        row = conn.execute("SELECT html, cached_at FROM schedule_cache WHERE group_id=? AND week_start=?", (group_id, week_start)).fetchone()
        if not row: return None
        html, cached_at = row
        try:
            if datetime.now(timezone.utc) - datetime.fromisoformat(cached_at) < timedelta(hours=CACHE_TTL_HOURS): return html
        except: pass
        return None
    finally:
        conn.close()

def save_cached_schedule(group_id, week_start, html):
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO schedule_cache VALUES (?, ?, ?, ?)",
            (group_id, week_start, html, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()

def save_snapshot(group_id, week_start, snapshot_str):
    conn = _connect()
    try:
        conn.execute("INSERT OR REPLACE INTO schedule_snapshots (group_id, week_start, snapshot, updated_at) VALUES (?, ?, ?, ?)",
            (group_id, week_start, snapshot_str, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()

def get_snapshot(group_id, week_start):
    conn = _connect()
    try:
        row = conn.execute("SELECT snapshot FROM schedule_snapshots WHERE group_id=? AND week_start=?", (group_id, week_start)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()

def make_snapshot_str(days):
    parts = []
    for d in days:
        day_key = d.get("date", "")
        for les in d.get("lessons", []):
            parts.append(f"{day_key}|{les.get('time','')}|{les.get('subject','')}|{les.get('type','')}|{les.get('teacher','')}|{les.get('auditorium','')}|{les.get('subgroup','')}")
    return "\n".join(sorted(parts))


def save_feedback(user_id, username, text, admin_msg_id=None):
    conn = _connect()
    try:
        cur = conn.execute("INSERT INTO feedback (user_id, username, text, created_at, admin_msg_id, status) VALUES (?, ?, ?, ?, ?, 'new')",
            (user_id, username, text, datetime.now(timezone.utc).isoformat(), admin_msg_id))
        fid = cur.lastrowid
        conn.commit()
        return fid
    finally:
        conn.close()

def update_feedback_admin_msg(feedback_id, admin_msg_id):
    conn = _connect()
    try:
        conn.execute("UPDATE feedback SET admin_msg_id=? WHERE id=?", (admin_msg_id, feedback_id))
        conn.commit()
    finally:
        conn.close()

def get_pending_feedback():
    conn = _connect()
    try:
        rows = conn.execute("SELECT id, user_id, username, text, created_at, COALESCE(status,'new') FROM feedback WHERE COALESCE(status,'new') IN ('new', 'postponed') ORDER BY CASE COALESCE(status,'new') WHEN 'new' THEN 0 ELSE 1 END, id DESC").fetchall()
        return rows
    finally:
        conn.close()

def set_feedback_status(feedback_id, status):
    conn = _connect()
    try:
        conn.execute("UPDATE feedback SET status=? WHERE id=?", (status, feedback_id))
        conn.commit()
    finally:
        conn.close()

def mark_feedback_answered(feedback_id, reply_text=None):
    conn = _connect()
    try:
        conn.execute("UPDATE feedback SET status='answered', answered_at=?, admin_reply=? WHERE id=?",
            (datetime.now(timezone.utc).isoformat(), reply_text, feedback_id))
        conn.commit()
    finally:
        conn.close()

def get_feedback_by_id(feedback_id):
    conn = _connect()
    try:
        row = conn.execute("SELECT id, user_id, username, text FROM feedback WHERE id=?", (feedback_id,)).fetchone()
        return row
    finally:
        conn.close()

def get_user_feedback(user_id, limit=30):
    conn = _connect()
    try:
        rows = conn.execute("SELECT id, text, COALESCE(status,'new'), created_at, answered_at, admin_reply FROM feedback WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit)).fetchall()
        return rows
    finally:
        conn.close()


def count_user_tasks(user_id):
    conn = _connect()
    try:
        active = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_id=? AND done=0", (user_id,)
        ).fetchone()[0]
        done = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_id=? AND done=1", (user_id,)
        ).fetchone()[0]
        return active, done
    finally:
        conn.close()


def get_user_tasks(user_id, only_active=True, tag=None, search=None, sort_by="due"):
    conn = _connect()
    try:
        sql = "SELECT id, text, due_date, done, created_at, priority, due_time, tags, repeat_rule FROM tasks WHERE user_id=?"
        params = [user_id]
        if only_active:
            sql += " AND done=0"
        if tag:
            sql += " AND (' ' || COALESCE(tags,'') || ' ') LIKE ?"
            params.append(f"% {tag} %")
        if search:
            sql += " AND LOWER(text) LIKE ?"
            params.append(f"%{search.lower()}%")
        if sort_by == "priority":
            sql += " ORDER BY priority DESC, due_date IS NULL, due_date ASC, id DESC"
        elif sort_by == "created":
            sql += " ORDER BY id DESC"
        else:
            sql += " ORDER BY done ASC, due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, priority DESC, id DESC"
        rows = conn.execute(sql, params).fetchall()
        return rows
    finally:
        conn.close()


def get_done_tasks(user_id, days=30):
    conn = _connect()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows = conn.execute(
            """SELECT id, text, due_date, done, created_at, priority, due_time, done_at, tags
               FROM tasks WHERE user_id=? AND done=1
               AND (done_at IS NULL OR done_at >= ?)
               ORDER BY done_at DESC, id DESC""",
            (user_id, cutoff),
        ).fetchall()
        return rows
    finally:
        conn.close()


def get_task(task_id, user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT id, text, due_date, done, created_at, priority, due_time, tags, repeat_rule FROM tasks WHERE id=? AND user_id=?",
            (task_id, user_id),
        ).fetchone()
        return row
    finally:
        conn.close()


def add_task(user_id, text, due_date=None, priority=2, due_time=None, tags="", repeat_rule=None):
    conn = _connect()
    try:
        cur = conn.execute(
            """INSERT INTO tasks (user_id, text, due_date, done, created_at, priority, due_time, tags, repeat_rule)
               VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)""",
            (user_id, text, due_date, datetime.now(timezone.utc).isoformat(),
             int(priority), due_time, tags or "", repeat_rule),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def update_task(task_id, user_id, text=None, due_date=None, priority=None,
                due_time=None, reset_due=False, tags=None, repeat_rule=None):
    conn = _connect()
    try:
        fields = []; values = []
        if text is not None:
            fields.append("text=?"); values.append(text)
        if due_date is not None:
            fields.append("due_date=?"); values.append(due_date)
        if priority is not None:
            fields.append("priority=?"); values.append(int(priority))
        if due_time is not None:
            fields.append("due_time=?"); values.append(due_time)
        if tags is not None:
            fields.append("tags=?"); values.append(tags)
        if repeat_rule is not None:
            fields.append("repeat_rule=?"); values.append(repeat_rule or None)
        if reset_due:
            fields.append("done=0"); fields.append("done_at=NULL")
        if not fields:
            return
        values.extend([task_id, user_id])
        conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id=? AND user_id=?", values)
        conn.commit()
    finally:
        conn.close()


def mark_task_done(task_id, user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT repeat_rule, due_date, due_time FROM tasks WHERE id=? AND user_id=?",
            (task_id, user_id),
        ).fetchone()
        now_iso = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE tasks SET done=1, done_at=? WHERE id=? AND user_id=?",
            (now_iso, task_id, user_id),
        )
        if row and row[0]:
            repeat_rule = row[0]
            old_due = row[1]
            old_time = row[2]
            new_due = None
            if old_due:
                try:
                    d = datetime.strptime(old_due, "%d.%m.%Y")
                    if repeat_rule == "daily":
                        d = d + timedelta(days=1)
                    elif repeat_rule == "weekly":
                        d = d + timedelta(weeks=1)
                    elif repeat_rule == "monthly":
                        d = d + timedelta(days=30)
                    new_due = d.strftime("%d.%m.%Y")
                except Exception:
                    new_due = None
            conn.execute(
                """INSERT INTO tasks (user_id, text, due_date, done, created_at, priority, due_time, tags, repeat_rule)
                   SELECT user_id, text, ?, 0, ?, priority, ?, tags, repeat_rule
                   FROM tasks WHERE id=?""",
                (new_due, now_iso, old_time, task_id),
            )
        conn.commit()
    finally:
        conn.close()


def delete_task(task_id, user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))
        conn.commit()
    finally:
        conn.close()


def clear_done_tasks(user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM tasks WHERE user_id=? AND done=1", (user_id,))
        conn.commit()
    finally:
        conn.close()


def task_stats(user_id):
    conn = _connect()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        total_done = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE user_id=? AND done=1 AND done_at >= ?",
            (user_id, cutoff),
        ).fetchone()[0]
    finally:
        conn.close()

    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT DISTINCT substr(done_at, 1, 10) AS d FROM tasks
               WHERE user_id=? AND done=1 AND done_at IS NOT NULL
               ORDER BY d DESC LIMIT 60""",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return {"total_done": total_done, "streak": 0}

    today = _now_irkutsk().date()
    streak = 0
    cur = today
    dates_set = set()
    for (ds,) in rows:
        try:
            dt = datetime.fromisoformat(ds).date()
        except Exception:
            continue
        dt_local = dt + timedelta(hours=8)
        dates_set.add(dt_local)
    while cur in dates_set:
        streak += 1
        cur = cur - timedelta(days=1)

    return {"total_done": total_done, "streak": streak}


def get_all_task_tags(user_id):
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT tags FROM tasks WHERE user_id=? AND tags IS NOT NULL AND tags != ''",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    tags_set = set()
    for (t,) in rows:
        for tag in (t or "").split():
            tag = tag.strip()
            if tag:
                tags_set.add(tag)
    return sorted(tags_set)


def get_user_notes(user_id, search=None, tag=None, sort="pinned"):
    conn = _connect()
    try:
        sql = "SELECT id, subject, text, tags, pinned FROM notes WHERE user_id=?"
        params = [user_id]
        if tag:
            sql += " AND (' ' || COALESCE(tags,'') || ' ') LIKE ?"
            params.append(f"% {tag} %")
        if search:
            sql += " AND (LOWER(subject) LIKE ? OR LOWER(text) LIKE ?)"
            s = f"%{search.lower()}%"
            params.append(s); params.append(s)
        if sort == "pinned":
            sql += " ORDER BY pinned DESC, id DESC"
        else:
            sql += " ORDER BY id DESC"
        rows = conn.execute(sql, params).fetchall()
        return rows
    finally:
        conn.close()


def add_or_update_note(user_id, subject, text, tags=""):
    conn = _connect()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        row = conn.execute(
            "SELECT id FROM notes WHERE user_id=? AND LOWER(subject)=LOWER(?)",
            (user_id, subject),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE notes SET text=?, tags=?, updated_at=? WHERE id=? AND user_id=?",
                (text, tags or "", now_iso, row[0], user_id),
            )
        else:
            conn.execute(
                "INSERT INTO notes (user_id, subject, text, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
                (user_id, subject, text, tags or "", now_iso, now_iso),
            )
        conn.commit()
    finally:
        conn.close()


def delete_note_by_id(note_id, user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM notes WHERE id=? AND user_id=?", (note_id, user_id))
        conn.commit()
    finally:
        conn.close()


def toggle_note_pin(note_id, user_id):
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT pinned FROM notes WHERE id=? AND user_id=?", (note_id, user_id)
        ).fetchone()
        if not row:
            return None
        new_val = 0 if row[0] else 1
        conn.execute(
            "UPDATE notes SET pinned=? WHERE id=? AND user_id=?",
            (new_val, note_id, user_id),
        )
        conn.commit()
        return bool(new_val)
    finally:
        conn.close()


def get_all_note_tags(user_id):
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT tags FROM notes WHERE user_id=? AND tags IS NOT NULL AND tags != ''",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    tags_set = set()
    for (t,) in rows:
        for tag in (t or "").split():
            tag = tag.strip()
            if tag:
                tags_set.add(tag)
    return sorted(tags_set)


def attendance_get_map(user_id, dates):
    if not dates:
        return {}
    conn = _connect()
    try:
        placeholders = ",".join("?" for _ in dates)
        rows = conn.execute(
            f"SELECT date, time, subject, status FROM attendance WHERE user_id=? AND date IN ({placeholders})",
            [user_id] + list(dates),
        ).fetchall()
    finally:
        conn.close()
    return {(r[0], r[1], r[2]): r[3] for r in rows}


def attendance_set(user_id, date, time_, subject, status):
    conn = _connect()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        if status == "":
            conn.execute(
                "DELETE FROM attendance WHERE user_id=? AND date=? AND time=? AND subject=?",
                (user_id, date, time_, subject),
            )
        else:
            conn.execute(
                """INSERT INTO attendance (user_id, date, time, subject, status, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id, date, time, subject)
                   DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at""",
                (user_id, date, time_, subject, status, now_iso),
            )
        conn.commit()
    finally:
        conn.close()


def attendance_stats(user_id):
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT status, COUNT(*) FROM attendance WHERE user_id=? GROUP BY status",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    result = {"was": 0, "missed": 0, "sick": 0, "excused": 0}
    for status, n in rows:
        if status in result:
            result[status] = n
    return result


def ai_save_message(user_id, role, text, has_photo=0):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO ai_messages (user_id, role, text, has_photo, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, role, text or "", int(bool(has_photo)), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def ai_get_history(user_id, limit=30):
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, role, text, has_photo FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return list(reversed(rows))
    finally:
        conn.close()


def ai_clear_history(user_id):
    conn = _connect()
    try:
        conn.execute("DELETE FROM ai_messages WHERE user_id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def get_export_data(user_id):
    saved = get_user_group(user_id)
    subgroup = get_user_subgroup(user_id)

    conn = _connect()
    try:
        row = conn.execute(
            "SELECT username, first_name FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
    finally:
        conn.close()
    username = row[0] if row else None
    first_name = row[1] if row else None

    conn = _connect()
    try:
        tasks_rows = conn.execute(
            """SELECT id, text, due_date, done, created_at, priority, due_time, tags, repeat_rule
               FROM tasks WHERE user_id=? ORDER BY done ASC, id DESC""",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    tasks = []
    for r in tasks_rows:
        tasks.append({
            "id": r[0], "text": r[1], "due_date": r[2], "done": bool(r[3]),
            "priority": r[5] if r[5] in (1, 2, 3) else 2,
            "due_time": r[6], "tags": r[7] or "",
        })

    conn = _connect()
    try:
        nrows = conn.execute(
            "SELECT id, subject, text, tags, pinned FROM notes WHERE user_id=? ORDER BY pinned DESC, id DESC",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    notes = []
    for r in nrows:
        notes.append({"id": r[0], "subject": r[1], "text": r[2],
                      "tags": r[3] or "", "pinned": bool(r[4])})

    amount = get_scholarship_amount(user_id)
    grades_rows = get_grades(user_id)
    grades = [{"id": g[0], "subject": g[1], "grade": g[2],
               "is_auto": bool(g[3]), "semester": g[4] or ""} for g in grades_rows]

    att = attendance_stats(user_id)

    return {
        "username": username,
        "first_name": first_name,
        "group": saved[1] if saved else None,
        "subgroup": subgroup,
        "tasks": tasks,
        "notes": notes,
        "scholarship_amount": amount,
        "grades": grades,
        "attendance": att,
    }


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
            conn = _connect()
            try:
                row = conn.execute("SELECT html FROM schedule_cache WHERE group_id=? AND week_start=?", (group_id, week_start_str)).fetchone()
                if row: return row[0]
            finally:
                conn.close()
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


_restore_lock = asyncio.Lock()


def _db_schema_version() -> str:
    try:
        conn = _connect()
        try:
            cols_users = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            cols_grades = [r[1] for r in conn.execute("PRAGMA table_info(grades)").fetchall()]
            return f"users:{len(cols_users)} | grades:{len(cols_grades)}"
        finally:
            conn.close()
    except Exception:
        return "unknown"


def _make_db_snapshot(dst_path: str) -> None:
    src = sqlite3.connect(DB_PATH, timeout=30)
    dst = sqlite3.connect(dst_path)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close(); src.close()


def _check_db_integrity(path: str) -> tuple:
    try:
        c = sqlite3.connect(path)
        ok = c.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            c.close(); return False, f"integrity: {ok}"
        has_users = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
        c.close()
        if not has_users:
            return False, "нет таблицы users"
        return True, ""
    except Exception as e:
        return False, str(e)


def _now_irkutsk(): return datetime.now(timezone.utc) + timedelta(hours=8)
def _monday_of_week(d): return d - timedelta(days=d.weekday())


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


def _ai_hash(question: str) -> str:
    q = (question or "").strip().lower()
    q = re.sub(r"\s+", " ", q)
    q = re.sub(r"[?!.,;:]+$", "", q)
    return hashlib.sha256(q.encode("utf-8")).hexdigest()


def ai_cache_get(question: str):
    conn = _connect()
    try:
        h = _ai_hash(question)
        row = conn.execute(
            "SELECT answer, created_at FROM ai_cache WHERE prompt_hash=?", (h,)
        ).fetchone()
        if not row:
            return None
        created = row[1]
        try:
            if datetime.now(timezone.utc) - datetime.fromisoformat(created) > timedelta(days=AI_CACHE_TTL_DAYS):
                conn.execute("DELETE FROM ai_cache WHERE prompt_hash=?", (h,))
                conn.commit()
                return None
        except Exception:
            pass
        conn.execute("UPDATE ai_cache SET hits=hits+1 WHERE prompt_hash=?", (h,))
        conn.commit()
        return row[0]
    finally:
        conn.close()


def ai_cache_put(question: str, answer: str):
    if not question or not answer: return
    if len(answer) > 8000: return
    conn = _connect()
    try:
        h = _ai_hash(question)
        conn.execute(
            "INSERT OR REPLACE INTO ai_cache (prompt_hash, question, answer, created_at, hits) "
            "VALUES (?, ?, ?, ?, COALESCE((SELECT hits FROM ai_cache WHERE prompt_hash=?), 0))",
            (h, question[:500], answer, datetime.now(timezone.utc).isoformat(), h)
        )
        conn.commit()
    finally:
        conn.close()


def ai_cache_stats():
    conn = _connect()
    try:
        row = conn.execute("SELECT COUNT(*), SUM(hits) FROM ai_cache").fetchone()
        return {"size": row[0] or 0, "hits": row[1] or 0}
    finally:
        conn.close()


def ai_cache_clear():
    conn = _connect()
    try:
        conn.execute("DELETE FROM ai_cache")
        conn.commit()
    finally:
        conn.close()


_giga_semaphore = asyncio.Semaphore(3)
_giga_last_calls = []
_giga_lock = asyncio.Lock()
GIGA_MAX_PER_MIN = int(os.getenv("GIGA_MAX_PER_MIN", "15"))


async def _giga_rate_wait():
    async with _giga_lock:
        now = datetime.now(timezone.utc).timestamp()
        _giga_last_calls[:] = [t for t in _giga_last_calls if now - t < 60]
        if len(_giga_last_calls) >= GIGA_MAX_PER_MIN:
            wait = 60 - (now - _giga_last_calls[0]) + 0.5
            if wait > 0:
                logging.info(f"[GIGA] rate limit, ждём {wait:.1f}с")
                await asyncio.sleep(wait)
        _giga_last_calls.append(datetime.now(timezone.utc).timestamp())


async def giga_chat_safe(prompt: str, timeout: int = 120, max_retries: int = 3):
    if giga_client is None:
        raise RuntimeError("GigaChat не настроен")
    last_err = None
    for attempt in range(max_retries):
        await _giga_rate_wait()
        async with _giga_semaphore:
            try:
                resp = await asyncio.wait_for(giga_client.achat(prompt), timeout=timeout)
                try:
                    return resp.choices[0].message.content or ""
                except AttributeError:
                    return resp.messages[0].content[0].text if resp.messages else ""
            except asyncio.TimeoutError:
                last_err = "GigaChat не ответил вовремя"
            except Exception as e:
                msg = str(e)
                last_err = msg
                if "429" in msg or "Too Many Requests" in msg:
                    wait = 2 ** attempt * 3
                    logging.warning(f"[GIGA] 429 на попытке {attempt+1}, ждём {wait}с")
                    await asyncio.sleep(wait)
                    continue
                if any(code in msg for code in ("500", "502", "503", "504")):
                    wait = 2 ** attempt * 2
                    logging.warning(f"[GIGA] {msg[:80]} на попытке {attempt+1}, ждём {wait}с")
                    await asyncio.sleep(wait)
                    continue
                raise
    if "429" in str(last_err) or "Too Many Requests" in str(last_err):
        raise RuntimeError("GigaChat перегружен, попробуй через минуту")
    raise RuntimeError(f"GigaChat: {last_err}")


async def fetch_weather(force=False):
    cache_key = f"{WEATHER_LAT:.3f},{WEATHER_LON:.3f}"
    if not force:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT payload, updated_at FROM weather_cache WHERE cache_key=?",
                (cache_key,)
            ).fetchone()
        finally:
            conn.close()
        if row:
            try:
                if datetime.now(timezone.utc) - datetime.fromisoformat(row[1]) < timedelta(hours=1):
                    return json.loads(row[0])
            except Exception:
                pass

    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
        f"&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m"
        f"&daily=temperature_2m_max,temperature_2m_min,weather_code"
        f"&timezone=Asia%2FIrkutsk&forecast_days=2"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
    except Exception as e:
        logging.warning(f"[WEATHER] {e}")
        return None

    cur = (data.get("current") or {})
    daily = (data.get("daily") or {})
    code = cur.get("weather_code", 0)
    payload = {
        "temp": cur.get("temperature_2m"),
        "feels": cur.get("apparent_temperature"),
        "wind": cur.get("wind_speed_10m"),
        "code": code,
        "desc": _weather_desc(code),
        "tmax": (daily.get("temperature_2m_max") or [None])[0],
        "tmin": (daily.get("temperature_2m_min") or [None])[0],
        "city": WEATHER_CITY,
    }

    conn = _connect()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO weather_cache (cache_key, payload, updated_at) "
            "VALUES (?, ?, ?)",
            (cache_key, json.dumps(payload, ensure_ascii=False),
             datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
    finally:
        conn.close()
    return payload


def _weather_desc(code: int) -> str:
    if code == 0: return "ясно"
    if code in (1, 2): return "малооблачно"
    if code == 3: return "пасмурно"
    if code in (45, 48): return "туман"
    if code in (51, 53, 55, 56, 57): return "морось"
    if code in (61, 63, 65, 66, 67): return "дождь"
    if code in (71, 73, 75, 77): return "снег"
    if code in (80, 81, 82): return "ливень"
    if code in (85, 86): return "снегопад"
    if code in (95, 96, 99): return "гроза"
    return "—"


def _weather_emoji(code: int) -> str:
    if code == 0: return "☀️"
    if code in (1, 2): return "🌤"
    if code == 3: return "☁️"
    if code in (45, 48): return "🌫"
    if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82): return "🌧"
    if code in (71, 73, 75, 77, 85, 86): return "❄️"
    if code in (95, 96, 99): return "⛈"
    return "🌡"


def weather_line(w) -> str:
    if not w: return ""
    t = w.get("temp")
    if t is None: return ""
    try: t = round(float(t))
    except: return ""
    feels = w.get("feels")
    try: feels = round(float(feels)) if feels is not None else None
    except: feels = None
    wind = w.get("wind")
    try: wind = round(float(wind)) if wind is not None else None
    except: wind = None
    parts = [f"{_weather_emoji(w.get('code', 0))} {t}°C"]
    if feels is not None and abs(feels - t) >= 3:
        parts.append(f"ощущ. {feels}°")
    if wind is not None and wind >= 5:
        parts.append(f"ветер {wind} м/с")
    parts.append(w.get("desc") or "")
    return " · ".join(p for p in parts if p)


def get_overdue_debt_tasks():
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT id, user_id, text, due_date, due_time FROM tasks
            WHERE done=0
              AND due_date IS NOT NULL AND due_date != ''
              AND (' ' || COALESCE(tags,'') || ' ') LIKE '% #долг %'
        """).fetchall()
        return rows
    finally:
        conn.close()


def move_debt_to_date(task_id, user_id, new_date):
    conn = _connect()
    try:
        row = conn.execute("SELECT due_date FROM tasks WHERE id=? AND user_id=?",
                           (task_id, user_id)).fetchone()
        old_due = row[0] if row else ""
        conn.execute("UPDATE tasks SET due_date=? WHERE id=? AND user_id=?",
                     (new_date, task_id, user_id))
        conn.execute("""
            INSERT INTO debts_log (task_id, user_id, old_due, new_due, moved_at)
            VALUES (?, ?, ?, ?, ?)
        """, (task_id, user_id, old_due, new_date, datetime.now(timezone.utc).isoformat()))
        conn.commit()
        return True
    except Exception as e:
        logging.warning(f"[DEBT] {e}")
        return False
    finally:
        conn.close()


def count_user_debts(user_id):
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT due_date FROM tasks
            WHERE done=0 AND user_id=?
              AND due_date IS NOT NULL AND due_date != ''
              AND (' ' || COALESCE(tags,'') || ' ') LIKE '% #долг %'
        """, (user_id,)).fetchall()
    finally:
        conn.close()
    today_str = _now_irkutsk().strftime("%d.%m.%Y")
    today_key = today_str[6:] + today_str[3:5] + today_str[:2]
    n = 0
    for r in rows:
        d = r[0] or ""
        if len(d) == 10:
            key = d[6:] + d[3:5] + d[:2]
            if key < today_key:
                n += 1
    return n


def get_semester_start() -> datetime:
    now = _now_irkutsk()
    year = now.year
    m = now.month
    if m >= 9:
        return datetime(year, 9, 1, tzinfo=timezone.utc) + timedelta(hours=8)
    if m >= 2:
        return datetime(year, 2, 1, tzinfo=timezone.utc) + timedelta(hours=8)
    return datetime(year - 1, 9, 1, tzinfo=timezone.utc) + timedelta(hours=8)


def attendance_semester_stats(user_id):
    since = get_semester_start()
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT subject, status, COUNT(*) FROM attendance
            WHERE user_id=? AND updated_at >= ?
            GROUP BY subject, status
        """, (user_id, since.isoformat())).fetchall()
    finally:
        conn.close()

    result = {}
    for subject, status, n in rows:
        if subject not in result:
            result[subject] = {"total": 0, "was": 0, "missed": 0, "sick": 0, "excused": 0}
        result[subject][status] = result[subject].get(status, 0) + n
        result[subject]["total"] += n

    totals = {"total": 0, "was": 0, "missed": 0, "sick": 0, "excused": 0}
    for subj, d in result.items():
        for k in ("total", "was", "missed", "sick", "excused"):
            totals[k] += d.get(k, 0)

    return {"by_subject": result, "totals": totals, "since": since.strftime("%d.%m.%Y")}


def _ics_escape(text: str) -> str:
    if not text: return ""
    return (text.replace("\\", "\\\\").replace(",", "\\,")
                .replace(";", "\\;").replace("\n", "\\n"))


def _ics_datetime(date_str: str, time_str: str, tz_offset_hours: int = 8):
    try:
        d, m, y = date_str.split(".")
        hh, mm = time_str.split(":")
        dt = datetime(int(y), int(m), int(d), int(hh), int(mm),
                      tzinfo=timezone(timedelta(hours=tz_offset_hours)))
        return dt.strftime("%Y%m%dT%H%M%S")
    except Exception:
        return None


def _ics_now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


async def generate_ics_for_user_async(user_id, weeks: int = 2) -> bytes:
    saved = get_user_group(user_id)
    if not saved:
        raise ValueError("Сначала выбери группу")
    group_id, group_name = saved
    subgroup = get_user_subgroup(user_id)

    now = _now_irkutsk()
    monday = _monday_of_week(now)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Student IRK//Schedule//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:Расписание {_ics_escape(group_name)}",
        "X-WR-TIMEZONE:Asia/Irkutsk",
    ]

    total = 0
    for w in range(weeks):
        target_monday = monday + timedelta(days=7 * w)
        html = await fetch_week_html(group_id, target_monday, use_cache=True)
        if not html: continue
        _, days = parse_schedule(html)
        for d in days:
            filtered = _filter_lessons_by_subgroup(d.get("lessons", []), subgroup)
            for les in filtered:
                date_str = d.get("date", "")
                time_str = les.get("time", "")
                time_end = LESSON_TIMES.get(time_str, "")
                if not time_str or not time_end: continue
                dtstart = _ics_datetime(date_str, time_str)
                dtend = _ics_datetime(date_str, time_end)
                if not dtstart or not dtend: continue

                summary = les.get("subject", "Пара")
                if les.get("type"):
                    summary = f"{summary} ({les['type']})"

                descr_parts = []
                if les.get("teacher"): descr_parts.append(f"Преподаватель: {les['teacher']}")
                if les.get("subgroup"): descr_parts.append(f"Подгруппа: {les['subgroup']}")
                descr = "\\n".join(descr_parts)

                location = f"ауд. {les.get('auditorium','')}" if les.get("auditorium") else ""
                uid = f"{group_id}-{dtstart}-{abs(hash(summary)) % 100000}@student-irk"

                lines += [
                    "BEGIN:VEVENT",
                    f"UID:{uid}",
                    f"DTSTAMP:{_ics_now_utc()}",
                    f"DTSTART:{dtstart}",
                    f"DTEND:{dtend}",
                    f"SUMMARY:{_ics_escape(summary)}",
                ]
                if location:
                    lines.append(f"LOCATION:{_ics_escape(location)}")
                if descr:
                    lines.append(f"DESCRIPTION:{_ics_escape(descr)}")
                lines += [
                    "BEGIN:VALARM",
                    "TRIGGER:-PT15M",
                    "ACTION:DISPLAY",
                    "DESCRIPTION:Напоминание о паре",
                    "END:VALARM",
                    "END:VEVENT",
                ]
                total += 1

    lines.append("END:VCALENDAR")
    if total == 0:
        raise ValueError("Не удалось получить расписание")
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


PRESENT_STYLES = {
    "academic": {
        "name": "Академический",
        "bg": (255, 255, 255), "title_bg": (14, 90, 82),
        "accent": (31, 184, 166), "accent2": (196, 240, 235),
        "text": (15, 25, 28), "text_soft": (110, 125, 128),
        "title_text": (255, 255, 255),
        "shape_style": "rect_thin", "heading_case": "upper",
    },
    "creative": {
        "name": "Креативный",
        "bg": (245, 242, 235), "title_bg": (26, 26, 36),
        "accent": (255, 138, 30), "accent2": (255, 200, 130),
        "text": (26, 20, 15), "text_soft": (140, 120, 100),
        "title_text": (255, 255, 255),
        "shape_style": "circle_big", "heading_case": "normal",
    },
    "minimal": {
        "name": "Минимализм",
        "bg": (255, 255, 255), "title_bg": (250, 250, 250),
        "accent": (20, 20, 20), "accent2": (220, 220, 220),
        "text": (15, 15, 15), "text_soft": (130, 130, 130),
        "title_text": (20, 20, 20),
        "shape_style": "line_only", "heading_case": "upper",
    },
    "dark": {
        "name": "Тёмный",
        "bg": (16, 22, 26), "title_bg": (10, 14, 18),
        "accent": (127, 233, 255), "accent2": (40, 100, 115),
        "text": (235, 240, 245), "text_soft": (170, 190, 195),
        "title_text": (255, 255, 255),
        "shape_style": "glow_line", "heading_case": "normal",
    },
    "magazine": {
        "name": "Журнальный",
        "bg": (252, 248, 240), "title_bg": (235, 220, 195),
        "accent": (200, 30, 40), "accent2": (245, 200, 130),
        "text": (25, 15, 15), "text_soft": (130, 100, 90),
        "title_text": (25, 15, 15),
        "shape_style": "big_number", "heading_case": "upper",
    },
    "neon": {
        "name": "Неон",
        "bg": (18, 10, 30), "title_bg": (10, 6, 22),
        "accent": (255, 60, 180), "accent2": (100, 30, 90),
        "text": (240, 240, 255), "text_soft": (200, 180, 240),
        "title_text": (255, 255, 255),
        "shape_style": "neon_line", "heading_case": "normal",
    },
}

_style_history = {"recent": []}

def _pick_random_style() -> str:
    all_keys = list(PRESENT_STYLES.keys())
    recent = _style_history["recent"][-3:]
    candidates = [k for k in all_keys if k not in recent]
    if not candidates:
        candidates = all_keys
    chosen = random.choice(candidates)
    _style_history["recent"].append(chosen)
    if len(_style_history["recent"]) > 10:
        _style_history["recent"] = _style_history["recent"][-10:]
    return chosen


def _rel_luminance(rgb):
    def c(v):
        v /= 255
        return v/12.92 if v <= 0.03928 else ((v+0.055)/1.055)**2.4
    r, g, b = map(c, rgb[:3])
    return 0.2126*r + 0.7152*g + 0.0722*b

def _contrast_ratio(c1, c2):
    l1, l2 = _rel_luminance(c1), _rel_luminance(c2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)

def _pick_readable(fg, bg):
    if _contrast_ratio(fg, bg) >= 4.5: return fg
    return (255, 255, 255) if _rel_luminance(bg) < 0.5 else (15, 15, 15)


def _extract_json(text: str) -> dict:
    if not text: raise ValueError("Пустой ответ")
    s = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    s = re.sub(r"\s*```\s*$", "", s)
    start = s.find("{")
    if start == -1: raise ValueError("В ответе нет JSON: " + s[:200])
    depth, in_str, esc, end = 0, False, False, -1
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == '"': in_str = False
        else:
            if c == '"': in_str = True
            elif c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0: end = i; break
    if end == -1: raise ValueError("Незакрытый JSON")
    raw = s[start:end+1]
    for candidate in (raw,
                      re.sub(r",\s*([}\]])", r"\1",
                             raw.replace("\u201c", '"').replace("\u201d", '"')
                                .replace("\u2018", "'").replace("\u2019", "'"))):
        try: return json.loads(candidate)
        except json.JSONDecodeError: continue
    raise ValueError("Невалидный JSON: " + raw[:300])


async def _gigachat_json(prompt: str) -> dict:
    content = await giga_chat_safe(prompt, timeout=180)
    return _extract_json(content or "")


def _validate_plan(plan: dict, topic: str) -> list:
    errors = []
    if not (plan.get("title") or "").strip():
        errors.append("Нет заголовка")
    slides = plan.get("slides") or []
    if len(slides) < 2:
        errors.append("Меньше 2 слайдов")
    for i, s in enumerate(slides, 2):
        h = (s.get("heading") or "").strip()
        if not h: errors.append(f"Слайд {i}: нет заголовка")
        if len(h) > 70: errors.append(f"Слайд {i}: длинный заголовок ({len(h)})")
        t = s.get("type", "bullets")
        if t == "bullets":
            bl = s.get("bullets") or []
            if len(bl) < 2: errors.append(f"Слайд {i}: <2 пунктов")
            for b in bl:
                if len(b) > 400: errors.append(f"Слайд {i}: пункт >400 символов")
        elif t == "flow" and len(s.get("steps") or []) < 2:
            errors.append(f"Слайд {i}: <2 шагов")
        elif t == "compare":
            if len(s.get("left_items") or []) < 1 or len(s.get("right_items") or []) < 1:
                errors.append(f"Слайд {i}: compare неполный")
        elif t == "chart":
            if not s.get("categories") or not s.get("values"):
                errors.append(f"Слайд {i}: chart без данных")
        elif t == "timeline":
            if len(s.get("events") or []) < 2:
                errors.append(f"Слайд {i}: timeline без событий")
        elif t == "quote":
            if not s.get("quote"):
                errors.append(f"Слайд {i}: quote пустая")
    return errors


NARRATIVE_STRATEGIES = {
    "chronological": "Хронология: события по времени, причины → ход → последствия.",
    "problem_solution": "Проблема → причины → последствия → решение → результат.",
    "research": "Вопрос → гипотеза → методы → данные → вывод.",
    "comparative": "Критерии сравнения → A → B → что лучше и почему.",
    "mechanism": "Принцип работы → компоненты → этапы → применение.",
    "concept_map": "Ключевое понятие → составные части → связи → следствия.",
    "case_study": "Ситуация → контекст → действия → результат → урок.",
    "argument": "Тезис → аргумент 1 → аргумент 2 → контраргумент → вывод.",
}


async def analyze_source(user_info: str) -> dict:
    if giga_client is None:
        raise RuntimeError("GigaChat не настроен")

    prompt = f"""Ты — аналитик учебных текстов. Разбери МАТЕРИАЛ и составь его карту.

═══ МАТЕРИАЛ ═══
{user_info[:14000]}
═══ КОНЕЦ МАТЕРИАЛА ═══

ЗАДАЧА:
1. Извлеки ВСЕ значимые элементы. Ничего не придумывай — только то, что есть в тексте.
2. Каждому элементу присвой ID: F1, F2, F3...
3. Укажи тип (kind):
   - date        — дата/период
   - number      — число, процент, статистика
   - definition  — определение термина
   - claim       — тезис/утверждение автора
   - cause       — причина
   - effect      — следствие/результат
   - example     — пример
   - conclusion  — вывод
   - quote       — цитата
4. Определи, какая нарративная стратегия лучше подходит материалу:
{chr(10).join(f'   - {k}: {v}' for k, v in NARRATIVE_STRATEGIES.items())}
5. Выдели 2-5 главных тезисов (main_theses) — своими словами, но без искажения.

Верни СТРОГО JSON:
{{
  "facts": [
    {{"id": "F1", "kind": "date", "text": "точная формулировка из источника"}}
  ],
  "structure_hint": "chronological",
  "main_theses": ["тезис 1", "тезис 2"],
  "word_count": 1234
}}

ТРЕБОВАНИЯ:
- Минимум 5 фактов (если материал короче — сколько есть, но не выдумывай).
- Если факт содержит число или дату — сохрани его ТОЧНО как в тексте.
- Не перефразируй определения — бери дословно.
- Только JSON, без пояснений."""

    result = await _gigachat_json(prompt)
    facts = result.get("facts") or []
    src_lower = user_info.lower()
    validated = []
    for i, f in enumerate(facts):
        text = (f.get("text") or "").strip()
        if not text or len(text) < 3:
            continue
        words = [w for w in re.findall(r"\w{4,}", text.lower()) if len(w) >= 4]
        if words:
            hits = sum(1 for w in words[:8] if w in src_lower)
            if hits == 0 and len(words) >= 4:
                logging.warning(f"[ANALYZE] факт {f.get('id')} не найден в источнике, отброшен")
                continue
        validated.append({
            "id": f.get("id") or f"F{i+1}",
            "kind": f.get("kind") or "claim",
            "text": text,
        })
    return {
        "facts": validated,
        "structure_hint": result.get("structure_hint") or "problem_solution",
        "main_theses": result.get("main_theses") or [],
        "word_count": len(user_info.split()),
    }


async def plan_narrative(topic: str, source_map: dict, slides_limit: int,
                          user_wishes: str = "") -> dict:
    facts_block = "\n".join(
        f"{f['id']} [{f['kind']}]: {f['text']}" for f in source_map["facts"]
    ) or "(фактов не извлечено)"

    n_facts = len(source_map["facts"])
    suggested = max(4, min(slides_limit, (n_facts + 1) // 2 + 2))

    prompt = f"""Ты — режиссёр презентации. Составь план: какая функция у каждого слайда,
какие факты (по ID) на него попадут.

ТЕМА: «{topic}»
ЖЕЛАТЕМОЕ ЧИСЛО СЛАЙДОВ: ~{suggested} (лимит {slides_limit})
СТРАТЕГИЯ (рекомендация аналитика): {source_map['structure_hint']}
{f'ПОЖЕЛАНИЯ: {user_wishes[:800]}' if user_wishes else ''}

═══ КАРТА ФАКТОВ ═══
{facts_block}
═══ КОНЕЦ КАРТЫ ═══

ПРАВИЛА:
1. Каждый значимый факт из карты должен попасть ХОТЯ БЫ на один слайд.
   Исключение — дубли и явный мусор (укажи причину в "dropped").
2. Не придумывай новых фактов. Используй только ID из карты.
3. Не смешивай на одном слайде больше 4-5 фактов — лучше больше слайдов.
4. Соседние слайды не должны иметь одинаковую функцию и тип без причины.
5. Функции слайдов: intro, thesis, evidence, comparison, timeline, cause_effect,
   mechanism, example, quote, counterargument, conclusion, question.
6. Тип визуализации: bullets, flow, compare, numbers, cards, chart, timeline, quote.

Верни СТРОГО JSON:
{{
  "title": "до 70 символов",
  "subtitle": "до 130 символов",
  "strategy": "{source_map['structure_hint']}",
  "slides": [
    {{
      "function": "intro",
      "heading": "до 50 символов",
      "fact_ids": ["F1", "F2"],
      "type": "bullets",
      "notes": "что сказать вслух (по фактам, без выдумок)"
    }}
  ],
  "dropped": [{{"id": "F9", "reason": "дубль F3"}}]
}}

Только JSON."""

    return await _gigachat_json(prompt)


async def materialize_slides(topic: str, plan: dict, source_map: dict) -> dict:
    facts_by_id = {f["id"]: f for f in source_map["facts"]}
    slide_specs = plan.get("slides") or []

    packed = []
    for s in slide_specs:
        ids = [x for x in (s.get("fact_ids") or []) if x in facts_by_id]
        packed.append({
            "function": s.get("function", "evidence"),
            "heading": s.get("heading", ""),
            "type": s.get("type", "bullets"),
            "notes": s.get("notes", ""),
            "facts": [{"id": i, "kind": facts_by_id[i]["kind"],
                       "text": facts_by_id[i]["text"]} for i in ids],
        })

    facts_dump = "\n".join(
        f"{f['id']} [{f['kind']}]: {f['text']}" for f in source_map["facts"]
    )
    prompt = f"""Ты — оформитель. Ниже — план и точные формулировки фактов.
Собери содержимое слайдов, СОХРАНЯЯ формулировки фактов.

ТЕМА: «{topic}»

═══ ФАКТЫ (не перефразируй, не добавляй) ═══
{facts_dump}
═══ КОНЕЦ ═══

═══ ПЛАН СЛАЙДОВ ═══
{json.dumps(packed, ensure_ascii=False, indent=2)}
═══ КОНЕЦ ПЛАНА ═══

Для каждого слайда верни поля по его типу:
- bullets:  bullets = [пункты, каждый — факт из списка]
- flow:     steps = [{{"label":"1","text":"факт"}}]
- compare:  left_title, right_title, left_items, right_items (факты)
- numbers:  facts = [{{"number":"из факта","label":"из факта"}}]
- cards:    cards = [{{"icon":"1","title":"...","text":"факт"}}]
- chart:    categories, values, unit — ТОЛЬКО если числа есть в фактах
- timeline: events = [{{"date":"из факта","text":"факт"}}]
- quote:    quote (дословно из фактов), quote_author (если есть), bullets

ПРАВИЛО: если в факте нет числа — не подставляй число в chart/numbers.
Если мало данных для типа — верни type="bullets".

Верни СТРОГО JSON:
{{
  "title": "{plan.get('title','')}",
  "subtitle": "{plan.get('subtitle','')}",
  "slides": [
    {{"type":"bullets","heading":"...","bullets":["..."]}}
  ]
}}

Только JSON."""

    result = await _gigachat_json(prompt)
    for i, s in enumerate(result.get("slides") or []):
        if i < len(packed):
            s["function"] = packed[i].get("function")
            s["fact_ids"] = [f["id"] for f in packed[i].get("facts", [])]
    return result


def verify_coverage(source_map: dict, materialized: dict) -> dict:
    all_ids = [f["id"] for f in source_map["facts"]]
    if not all_ids:
        return {"covered": [], "missing": [], "coverage_pct": 100.0}

    texts = []
    for s in materialized.get("slides") or []:
        for k, v in s.items():
            if isinstance(v, str):
                texts.append(v.lower())
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, str):
                        texts.append(item.lower())
                    elif isinstance(item, dict):
                        for vv in item.values():
                            if isinstance(vv, str):
                                texts.append(vv.lower())
    blob = " ".join(texts)

    covered, missing = [], []
    for f in source_map["facts"]:
        fid = f["id"]
        words = re.findall(r"\w{4,}", f["text"].lower())
        if not words:
            ok = f["text"].lower() in blob
        else:
            hits = sum(1 for w in words if w in blob)
            ok = hits / len(words) >= 0.7
        (covered if ok else missing).append(fid)

    pct = 100.0 * len(covered) / len(all_ids)
    return {"covered": covered, "missing": missing, "coverage_pct": pct}


BULLET_LAYOUTS = [
    "text_left_image_right", "image_left_text_right",
    "full_text_top_image_bottom", "two_columns_text",
    "big_first_bullet", "accent_block_left",
]
FLOW_LAYOUTS = ["flow_horizontal", "flow_vertical", "flow_zigzag"]
COMPARE_LAYOUTS = ["compare_two_cols", "compare_split_diagonal"]
NUMBERS_LAYOUTS = ["numbers_row", "numbers_grid_2x2", "numbers_hero_one"]
CARDS_LAYOUTS = ["cards_row", "cards_stack_vertical"]
CHART_LAYOUTS = ["chart_full", "chart_with_text"]

def _pick_layout(kind: str, idx: int) -> str:
    pools = {
        "bullets": BULLET_LAYOUTS, "flow": FLOW_LAYOUTS, "compare": COMPARE_LAYOUTS,
        "numbers": NUMBERS_LAYOUTS, "cards": CARDS_LAYOUTS, "chart": CHART_LAYOUTS,
        "timeline": ["timeline_h"], "quote": ["quote_full"],
    }
    pool = pools.get(kind, BULLET_LAYOUTS)
    return pool[idx % len(pool)]


def _add_rect(slide, x, y, w, h, color):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor(*color)
    shp.line.fill.background(); shp.shadow.inherit = False
    return shp

def _add_oval(slide, x, y, w, h, color):
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor(*color)
    shp.line.fill.background(); shp.shadow.inherit = False
    return shp

def _add_round_rect(slide, x, y, w, h, color, line_color=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor(*color)
    if line_color:
        shp.line.color.rgb = RGBColor(*line_color); shp.line.width = Pt(1.25)
    else:
        shp.line.fill.background()
    shp.shadow.inherit = False
    try: shp.adjustments[0] = 0.08
    except Exception: pass
    return shp

def _add_arrow(slide, x, y, w, h, color):
    shp = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor(*color)
    shp.line.fill.background(); shp.shadow.inherit = False
    return shp

def _add_bar_chart(slide, x, y, w, h, categories, values, unit="", title=""):
    try:
        from pptx.chart.data import CategoryChartData
        from pptx.enum.chart import XL_CHART_TYPE
        cd = CategoryChartData()
        cd.categories = categories
        cd.add_series(unit or "Значение", values)
        gf = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, x, y, w, h, cd)
        chart = gf.chart
        chart.has_legend = False
        chart.has_title = bool(title)
        if title: chart.chart_title.text_frame.text = title
        return chart
    except Exception as e:
        logging.warning(f"[CHART] {e}")
        return None


def _build_pptx(plan: dict, style_id: str = "academic") -> bytes:
    if not _PPTX_AVAILABLE: raise RuntimeError("python-pptx не установлена")
    style = PRESENT_STYLES.get(style_id, PRESENT_STYLES["academic"])
    prs = Presentation()
    prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    SHAPE = style.get("shape_style", "rect_thin")
    CASE = style.get("heading_case", "normal")

    def rgb(t): return RGBColor(*t)

    def add_text(slide, x, y, w, h, text, size=16, bold=False, color=None,
                 align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, italic=False, spacing=None):
        base = color if color else style["text"]
        c = _pick_readable(base, style["bg"])
        tb = slide.shapes.add_textbox(x, y, w, h)
        tf = tb.text_frame; tf.word_wrap = True; tf.vertical_anchor = anchor
        p = tf.paragraphs[0]; p.alignment = align
        if spacing is not None:
            try: p.line_spacing = spacing
            except: pass
        run = p.add_run(); run.text = str(text)
        run.font.size = Pt(size); run.font.bold = bold; run.font.italic = italic
        run.font.color.rgb = rgb(c); run.font.name = "DejaVu Sans"
        return tb

    def add_bullets(slide, x, y, w, h, bullets, size=13, bullet_char="•"):
        if not bullets: return
        tf = slide.shapes.add_textbox(x, y, w, h).text_frame
        tf.word_wrap = True
        for j, b in enumerate(bullets[:6]):
            p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
            p.space_after = Pt(11)
            try: p.line_spacing = 1.15
            except: pass
            run = p.add_run(); run.text = f"{bullet_char}  {b}"
            run.font.size = Pt(size)
            run.font.color.rgb = rgb(_pick_readable(style["text"], style["bg"]))
            run.font.name = "DejaVu Sans"

    def add_image_placeholder(slide, x, y, w, h, hint):
        _add_round_rect(slide, x, y, w, h, style["accent2"], style["accent"])
        ix = x + Inches(0.2); iy = y + Inches(0.2)
        iw = w - Inches(0.4); ih = h - Inches(0.4)
        _add_round_rect(slide, ix, iy, iw, ih, style["bg"])
        tf = slide.shapes.add_textbox(ix, iy, iw, ih).text_frame
        tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = "СХЕМА / ИЛЛЮСТРАЦИЯ"
        r.font.size = Pt(12); r.font.bold = True
        r.font.color.rgb = rgb(_pick_readable(style["accent"], style["bg"]))
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
        r2 = p2.add_run(); r2.text = hint or "Визуальное пояснение материала"
        r2.font.size = Pt(11); r2.font.italic = True
        r2.font.color.rgb = rgb(_pick_readable(style["text_soft"], style["bg"]))

    def _add_page_number(slide, n):
        add_text(slide, Inches(12.3), Inches(7.0), Inches(0.8), Inches(0.4),
                 str(n), size=11, color=style["text_soft"], align=PP_ALIGN.RIGHT)

    def _decor(slide):
        W = prs.slide_width; H = prs.slide_height
        if SHAPE == "rect_thin":
            _add_rect(slide, 0, 0, Inches(0.22), H, style["accent"])
            _add_rect(slide, 0, 0, W, Inches(0.07), style["accent"])
        elif SHAPE == "circle_big":
            _add_oval(slide, Inches(-1.0), Inches(-1.0), Inches(3.0), Inches(3.0), style["accent"])
            _add_oval(slide, Inches(12.5), Inches(6.7), Inches(2.0), Inches(2.0), style["accent2"])
        elif SHAPE == "line_only":
            _add_rect(slide, Inches(0.6), Inches(0.5), Inches(0.05), Inches(1.0), style["accent"])
        elif SHAPE == "glow_line":
            _add_rect(slide, 0, Inches(1.55), W, Inches(0.02), style["accent"])
            _add_oval(slide, Inches(12.5), Inches(-0.7), Inches(2.0), Inches(2.0), style["accent2"])
        elif SHAPE == "big_number":
            _add_rect(slide, Inches(0.6), 0, Inches(0.35), H, style["accent"])
        elif SHAPE == "neon_line":
            _add_rect(slide, 0, 0, W, Inches(0.05), style["accent"])
            _add_rect(slide, 0, Inches(1.6), W, Inches(0.03), style["accent2"])

    def _header(slide, heading):
        text = heading.upper() if CASE == "upper" else heading
        add_text(slide, Inches(1.0), Inches(0.55), Inches(12.0), Inches(0.95),
                 text, size=26, bold=True,
                 color=style["accent"] if SHAPE in ("glow_line", "neon_line") else style["text"])
        _add_rect(slide, Inches(1.0), Inches(1.55), Inches(1.8), Inches(0.05), style["accent"])

    s0 = prs.slides.add_slide(blank)
    _add_rect(s0, 0, 0, prs.slide_width, prs.slide_height, style["title_bg"])
    _add_rect(s0, 0, 0, Inches(4.7), prs.slide_height, style["accent"])
    _add_oval(s0, Inches(11.2), Inches(5.2), Inches(3.2), Inches(3.2), style["accent2"])
    _add_oval(s0, Inches(10.3), Inches(6.1), Inches(1.4), Inches(1.4), style["accent"])
    add_text(s0, Inches(5.4), Inches(2.1), Inches(7.4), Inches(2.6),
             plan.get("title", "Презентация"), size=40, bold=True,
             color=style["title_text"], align=PP_ALIGN.LEFT)
    if plan.get("subtitle"):
        add_text(s0, Inches(5.4), Inches(4.85), Inches(7.4), Inches(1.1),
                 plan["subtitle"], size=15, color=style["accent2"])
    meta_line = []
    if plan.get("author"): meta_line.append(str(plan["author"]))
    if plan.get("group"): meta_line.append(f"группа {plan['group']}")
    if plan.get("teacher"): meta_line.append(f"преподаватель: {plan['teacher']}")
    if plan.get("year"): meta_line.append(str(plan["year"]))
    if meta_line:
        add_text(s0, Inches(5.4), Inches(6.1), Inches(7.4), Inches(0.9),
                 " · ".join(meta_line), size=12, color=style["accent2"])

    slides = plan.get("slides", [])
    page_num = 2

    outline = plan.get("outline") or []
    if outline and len(outline) >= 2:
        so = prs.slides.add_slide(blank)
        _add_rect(so, 0, 0, prs.slide_width, prs.slide_height, style["bg"])
        _decor(so)
        _header(so, "Содержание")
        bullets = [f"{i+1}. {x}" for i, x in enumerate(outline[:8])]
        add_bullets(so, Inches(1.5), Inches(2.3), Inches(10.5), Inches(4.5), bullets, size=16)
        _add_page_number(so, page_num); page_num += 1

    for idx, sl in enumerate(slides):
        s = prs.slides.add_slide(blank)
        _add_rect(s, 0, 0, prs.slide_width, prs.slide_height, style["bg"])
        _decor(s)
        _header(s, sl.get("heading", "Слайд"))

        stype = (sl.get("type") or "bullets").lower()
        layout = _pick_layout(stype, idx)
        notes = sl.get("notes")
        if notes:
            try: s.notes_slide.notes_text_frame.text = str(notes)
            except: pass

        if stype == "bullets":
            bullets = sl.get("bullets", []) or []
            hint = sl.get("image_hint", "")
            if layout == "text_left_image_right":
                add_bullets(s, Inches(1.0), Inches(2.0), Inches(6.7), Inches(4.9), bullets, size=13)
                add_image_placeholder(s, Inches(8.0), Inches(2.0), Inches(4.85), Inches(4.5), hint)
            elif layout == "image_left_text_right":
                add_image_placeholder(s, Inches(0.9), Inches(2.0), Inches(4.6), Inches(4.5), hint)
                add_bullets(s, Inches(5.9), Inches(2.0), Inches(6.9), Inches(4.9), bullets, size=13)
            elif layout == "full_text_top_image_bottom":
                add_bullets(s, Inches(1.0), Inches(2.0), Inches(11.3), Inches(2.5), bullets[:3], size=13)
                add_image_placeholder(s, Inches(1.0), Inches(4.8), Inches(11.3), Inches(2.4), hint)
            elif layout == "two_columns_text":
                half = max(1, (len(bullets) + 1) // 2)
                add_bullets(s, Inches(1.0), Inches(2.0), Inches(5.5), Inches(4.9), bullets[:half], size=13)
                add_bullets(s, Inches(7.0), Inches(2.0), Inches(5.5), Inches(4.9), bullets[half:], size=13)
            elif layout == "big_first_bullet":
                if bullets:
                    _add_round_rect(s, Inches(1.0), Inches(2.0), Inches(11.3), Inches(1.5),
                                    style["accent2"], style["accent"])
                    add_text(s, Inches(1.3), Inches(2.25), Inches(10.7), Inches(1.1),
                             bullets[0], size=16, bold=True, color=style["text"],
                             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.MIDDLE)
                    add_bullets(s, Inches(1.0), Inches(3.8), Inches(11.3), Inches(3.2),
                                bullets[1:5], size=12)
            elif layout == "accent_block_left":
                _add_round_rect(s, Inches(0.7), Inches(2.0), Inches(5.0), Inches(4.5),
                                style["accent2"], style["accent"])
                add_bullets(s, Inches(1.0), Inches(2.3), Inches(4.5), Inches(4.0), bullets, size=12)
                add_image_placeholder(s, Inches(6.2), Inches(2.0), Inches(6.6), Inches(4.5), hint)

        elif stype == "flow":
            steps = sl.get("steps", [])[:4]
            n = len(steps) if steps else 1
            if layout == "flow_vertical":
                y0 = Inches(2.1); box_h = Inches(1.05); gap_y = Inches(0.2)
                for i, stp in enumerate(steps):
                    by = y0 + i * (box_h + gap_y)
                    _add_round_rect(s, Inches(1.0), by, Inches(11.3), box_h,
                                    style["accent2"], style["accent"])
                    add_text(s, Inches(1.3), by, Inches(2.5), box_h,
                             stp.get("label", f"Шаг {i+1}"), size=15, bold=True,
                             color=style["accent"], anchor=MSO_ANCHOR.MIDDLE)
                    add_text(s, Inches(3.9), by, Inches(8.2), box_h,
                             stp.get("text", ""), size=11, color=style["text"],
                             anchor=MSO_ANCHOR.MIDDLE)
            elif layout == "flow_zigzag":
                cols = 2
                box_w = Inches(5.6); box_h = Inches(2.2)
                gx = Inches(0.3); gy = Inches(0.25)
                for i, stp in enumerate(steps):
                    r = i // cols; c = i % cols
                    bx = Inches(0.85) + c * (box_w + gx)
                    by = Inches(2.2) + r * (box_h + gy)
                    _add_round_rect(s, bx, by, box_w, box_h, style["accent2"], style["accent"])
                    add_text(s, bx + Inches(0.15), by + Inches(0.15), box_w - Inches(0.3), Inches(0.6),
                             stp.get("label", f"Шаг {i+1}"), size=14, bold=True,
                             color=style["accent"], align=PP_ALIGN.CENTER)
                    add_text(s, bx + Inches(0.15), by + Inches(0.8), box_w - Inches(0.3), Inches(1.3),
                             stp.get("text", ""), size=10, color=style["text"],
                             align=PP_ALIGN.CENTER, spacing=1.1)
            else:
                total_w = Inches(12.0); gap = Inches(0.55)
                box_w = int((total_w - gap * (n - 1)) / n) if n > 1 else total_w
                box_h = Inches(2.6); y0 = Inches(2.7); x0 = Inches(0.7)
                for i, stp in enumerate(steps):
                    bx = x0 + i * (box_w + gap)
                    _add_round_rect(s, bx, y0, box_w, box_h, style["accent2"], style["accent"])
                    add_text(s, bx + Inches(0.15), y0 + Inches(0.25), box_w - Inches(0.3), Inches(0.7),
                             stp.get("label", f"Шаг {i+1}"), size=16, bold=True,
                             color=style["accent"], align=PP_ALIGN.CENTER)
                    add_text(s, bx + Inches(0.15), y0 + Inches(1.0), box_w - Inches(0.3), Inches(1.5),
                             stp.get("text", ""), size=11, color=style["text"],
                             align=PP_ALIGN.CENTER, spacing=1.1)
                    if i < n - 1:
                        _add_arrow(s, bx + box_w + Inches(0.06), y0 + box_h / 2 - Inches(0.22),
                                   gap - Inches(0.12), Inches(0.44), style["accent"])

        elif stype == "compare":
            lt = sl.get("left_title", "A"); rt = sl.get("right_title", "B")
            li = sl.get("left_items", [])[:4]; ri = sl.get("right_items", [])[:4]
            if layout == "compare_split_diagonal":
                _add_round_rect(s, Inches(0.7), Inches(2.0), Inches(6.5), Inches(2.2),
                                style["accent2"], style["accent"])
                add_text(s, Inches(0.9), Inches(2.15), Inches(6.1), Inches(0.5),
                         lt, size=15, bold=True, color=style["accent"])
                add_bullets(s, Inches(0.9), Inches(2.65), Inches(6.1), Inches(1.5), li, size=11)
                _add_round_rect(s, Inches(6.1), Inches(4.4), Inches(6.5), Inches(2.2),
                                style["bg"], style["accent"])
                add_text(s, Inches(6.3), Inches(4.55), Inches(6.1), Inches(0.5),
                         rt, size=15, bold=True, color=style["accent"])
                add_bullets(s, Inches(6.3), Inches(5.05), Inches(6.1), Inches(1.5), ri, size=11)
            else:
                col_w = Inches(5.7); col_h = Inches(4.5); y0 = Inches(2.1)
                _add_round_rect(s, Inches(0.75), y0, col_w, col_h, style["accent2"])
                add_text(s, Inches(0.9), y0 + Inches(0.2), col_w - Inches(0.3), Inches(0.6),
                         lt, size=16, bold=True, color=style["accent"], align=PP_ALIGN.CENTER)
                add_bullets(s, Inches(0.95), y0 + Inches(0.95), col_w - Inches(0.4),
                            col_h - Inches(1.1), li, size=11)
                _add_round_rect(s, Inches(6.85), y0, col_w, col_h, style["bg"], style["accent"])
                add_text(s, Inches(7.0), y0 + Inches(0.2), col_w - Inches(0.3), Inches(0.6),
                         rt, size=16, bold=True, color=style["accent"], align=PP_ALIGN.CENTER)
                add_bullets(s, Inches(7.05), y0 + Inches(0.95), col_w - Inches(0.4),
                            col_h - Inches(1.1), ri, size=11)

        elif stype == "numbers":
            facts = sl.get("facts", [])[:4]
            n = len(facts) if facts else 1
            if layout == "numbers_grid_2x2":
                box_w = Inches(5.6); box_h = Inches(2.2)
                gx = Inches(0.3); gy = Inches(0.25)
                for i, f in enumerate(facts):
                    r = i // 2; c = i % 2
                    bx = Inches(0.85) + c * (box_w + gx)
                    by = Inches(2.2) + r * (box_h + gy)
                    _add_round_rect(s, bx, by, box_w, box_h, style["accent2"])
                    add_text(s, bx + Inches(0.15), by + Inches(0.15), box_w - Inches(0.3), Inches(1.2),
                             f.get("number", "—"), size=32, bold=True,
                             color=style["accent"], align=PP_ALIGN.CENTER)
                    add_text(s, bx + Inches(0.15), by + Inches(1.35), box_w - Inches(0.3), Inches(0.7),
                             f.get("label", ""), size=11, color=style["text"],
                             align=PP_ALIGN.CENTER)
            elif layout == "numbers_hero_one" and facts:
                _add_round_rect(s, Inches(0.7), Inches(2.1), Inches(6.5), Inches(4.5),
                                style["accent2"], style["accent"])
                add_text(s, Inches(0.9), Inches(2.6), Inches(6.1), Inches(2.0),
                         facts[0].get("number", "—"), size=72, bold=True,
                         color=style["accent"], align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
                add_text(s, Inches(0.9), Inches(4.9), Inches(6.1), Inches(1.2),
                         facts[0].get("label", ""), size=14, color=style["text"],
                         align=PP_ALIGN.CENTER)
                y = Inches(2.3)
                for f in facts[1:4]:
                    _add_round_rect(s, Inches(7.5), y, Inches(5.2), Inches(1.3),
                                    style["bg"], style["accent"])
                    add_text(s, Inches(7.7), y + Inches(0.15), Inches(2.0), Inches(1.0),
                             f.get("number", "—"), size=20, bold=True,
                             color=style["accent"], anchor=MSO_ANCHOR.MIDDLE)
                    add_text(s, Inches(9.7), y + Inches(0.15), Inches(2.9), Inches(1.0),
                             f.get("label", ""), size=11, color=style["text"],
                             anchor=MSO_ANCHOR.MIDDLE)
                    y += Inches(1.5)
            else:
                gap = Inches(0.4)
                box_w = int((Inches(12.0) - gap * (n - 1)) / n) if n > 1 else Inches(12.0)
                y0 = Inches(2.6); box_h = Inches(3.4); x0 = Inches(0.7)
                for i, f in enumerate(facts):
                    bx = x0 + i * (box_w + gap)
                    _add_round_rect(s, bx, y0, box_w, box_h, style["accent2"])
                    add_text(s, bx + Inches(0.1), y0 + Inches(0.4), box_w - Inches(0.2), Inches(1.6),
                             f.get("number", "—"), size=40, bold=True,
                             color=style["accent"], align=PP_ALIGN.CENTER)
                    add_text(s, bx + Inches(0.15), y0 + Inches(2.1), box_w - Inches(0.3), Inches(1.1),
                             f.get("label", ""), size=12, color=style["text"],
                             align=PP_ALIGN.CENTER, spacing=1.1)

        elif stype == "cards":
            cards = sl.get("cards", [])[:4]
            n = len(cards) if cards else 1
            if layout == "cards_stack_vertical":
                y = Inches(2.1); box_h = Inches(1.15); gap_y = Inches(0.15)
                for i, c in enumerate(cards):
                    by = y + i * (box_h + gap_y)
                    _add_round_rect(s, Inches(1.0), by, Inches(11.3), box_h,
                                    style["bg"], style["accent"])
                    icon_size = Inches(0.8)
                    _add_oval(s, Inches(1.2), by + (box_h - icon_size) / 2, icon_size, icon_size,
                              style["accent"])
                    add_text(s, Inches(1.2), by + (box_h - icon_size) / 2, icon_size, icon_size,
                             str(c.get("icon", str(i+1))), size=18, bold=True,
                             color=style["title_text"], align=PP_ALIGN.CENTER,
                             anchor=MSO_ANCHOR.MIDDLE)
                    add_text(s, Inches(2.3), by + Inches(0.15), Inches(3.5), Inches(0.85),
                             c.get("title", ""), size=14, bold=True, color=style["text"],
                             anchor=MSO_ANCHOR.MIDDLE)
                    add_text(s, Inches(5.9), by + Inches(0.15), Inches(6.3), Inches(0.85),
                             c.get("text", ""), size=11, color=style["text_soft"],
                             anchor=MSO_ANCHOR.MIDDLE)
            else:
                gap = Inches(0.4)
                box_w = int((Inches(12.0) - gap * (n - 1)) / n) if n > 1 else Inches(12.0)
                y0 = Inches(2.5); box_h = Inches(3.6); x0 = Inches(0.7)
                for i, c in enumerate(cards):
                    bx = x0 + i * (box_w + gap)
                    _add_round_rect(s, bx, y0, box_w, box_h, style["bg"], style["accent"])
                    icon_size = Inches(0.9)
                    icon_x = bx + (box_w - icon_size) / 2
                    icon_y = y0 + Inches(0.35)
                    _add_oval(s, icon_x, icon_y, icon_size, icon_size, style["accent"])
                    add_text(s, icon_x, icon_y, icon_size, icon_size,
                             str(c.get("icon", str(i+1))), size=22, bold=True,
                             color=style["title_text"], align=PP_ALIGN.CENTER,
                             anchor=MSO_ANCHOR.MIDDLE)
                    add_text(s, bx + Inches(0.15), y0 + Inches(1.5), box_w - Inches(0.3), Inches(0.8),
                             c.get("title", ""), size=14, bold=True, color=style["text"],
                             align=PP_ALIGN.CENTER)
                    add_text(s, bx + Inches(0.15), y0 + Inches(2.25), box_w - Inches(0.3), Inches(1.2),
                             c.get("text", ""), size=10, color=style["text_soft"],
                             align=PP_ALIGN.CENTER, spacing=1.1)

        elif stype == "chart":
            cats = sl.get("categories") or []
            vals = sl.get("values") or []
            unit = sl.get("unit", "")
            chart_title = sl.get("chart_title", "")
            try:
                vals = [float(v) for v in vals]
            except:
                vals = []
            if cats and vals and len(cats) == len(vals):
                if layout == "chart_with_text":
                    _add_bar_chart(s, Inches(0.9), Inches(2.0), Inches(7.5), Inches(4.7),
                                   cats, vals, unit, chart_title)
                    add_bullets(s, Inches(8.7), Inches(2.2), Inches(3.9), Inches(4.5),
                                sl.get("bullets", []), size=12)
                else:
                    _add_bar_chart(s, Inches(1.0), Inches(2.0), Inches(11.3), Inches(4.7),
                                   cats, vals, unit, chart_title)
            else:
                add_bullets(s, Inches(1.0), Inches(2.0), Inches(6.7), Inches(4.9),
                            sl.get("bullets", []), size=13)
                add_image_placeholder(s, Inches(8.0), Inches(2.0), Inches(4.85), Inches(4.5),
                                      sl.get("image_hint", ""))

        elif stype == "timeline":
            events = sl.get("events", [])[:6]
            n = max(len(events), 1)
            line_y = Inches(4.4)
            _add_rect(s, Inches(1.0), line_y, Inches(11.3), Inches(0.06), style["accent"])
            step_w = Inches(11.3) / n
            for i, ev in enumerate(events):
                cx = Inches(1.0) + step_w * i + step_w / 2
                _add_oval(s, cx - Inches(0.12), line_y - Inches(0.12),
                          Inches(0.24), Inches(0.24), style["accent"])
                add_text(s, cx - Inches(0.9), line_y - Inches(1.2),
                         Inches(1.8), Inches(0.5), ev.get("date", ""),
                         size=14, bold=True, color=style["accent"],
                         align=PP_ALIGN.CENTER)
                add_text(s, cx - Inches(0.9), line_y + Inches(0.35),
                         Inches(1.8), Inches(1.8), ev.get("text", ""),
                         size=10, color=style["text"], align=PP_ALIGN.CENTER,
                         spacing=1.1)

        elif stype == "quote":
            _add_round_rect(s, Inches(1.5), Inches(2.2), Inches(10.3), Inches(3.2),
                            style["accent2"], style["accent"])
            add_text(s, Inches(1.7), Inches(2.3), Inches(0.9), Inches(0.9),
                     "«", size=64, bold=True, color=style["accent"])
            add_text(s, Inches(2.2), Inches(2.6), Inches(9.3), Inches(2.2),
                     sl.get("quote", ""), size=20, italic=True,
                     color=style["text"], anchor=MSO_ANCHOR.MIDDLE)
            if sl.get("quote_author"):
                add_text(s, Inches(2.2), Inches(4.95), Inches(9.3), Inches(0.5),
                         "— " + sl["quote_author"], size=13,
                         color=style["text_soft"], align=PP_ALIGN.RIGHT)
            add_bullets(s, Inches(1.5), Inches(5.7), Inches(10.3), Inches(1.5),
                        sl.get("bullets", [])[:3], size=12)

        else:
            add_bullets(s, Inches(1.0), Inches(2.0), Inches(6.7), Inches(4.9),
                        sl.get("bullets", []), size=13)
            add_image_placeholder(s, Inches(8.0), Inches(2.0), Inches(4.85), Inches(4.5),
                                  sl.get("image_hint", ""))

        _add_page_number(s, page_num); page_num += 1

    sources = plan.get("sources") or []
    if sources:
        ss = prs.slides.add_slide(blank)
        _add_rect(ss, 0, 0, prs.slide_width, prs.slide_height, style["bg"])
        _decor(ss)
        _header(ss, "Источники")
        lines = []
        for i, src in enumerate(sources[:10], 1):
            parts = []
            if src.get("author"): parts.append(str(src["author"]))
            if src.get("title"): parts.append(f"«{src['title']}»")
            if src.get("publisher"): parts.append(str(src["publisher"]))
            if src.get("year"): parts.append(str(src["year"]))
            lines.append(f"{i}. " + ". ".join(parts))
        add_bullets(ss, Inches(1.0), Inches(2.2), Inches(11.3), Inches(4.6), lines, size=12)
        _add_page_number(ss, page_num); page_num += 1

    sN = prs.slides.add_slide(blank)
    _add_rect(sN, 0, 0, prs.slide_width, prs.slide_height, style["title_bg"])
    _add_rect(sN, 0, 0, prs.slide_width, Inches(0.15), style["accent"])
    _add_oval(sN, Inches(-1.0), Inches(4.9), Inches(3.0), Inches(3.0), style["accent"])
    _add_oval(sN, Inches(11.2), Inches(-0.9), Inches(2.6), Inches(2.6), style["accent2"])
    add_text(sN, Inches(1), Inches(3.0), Inches(11.3), Inches(1.5),
             "СПАСИБО ЗА ВНИМАНИЕ", size=38, bold=True,
             color=style["title_text"], align=PP_ALIGN.CENTER)
    add_text(sN, Inches(1), Inches(4.5), Inches(11.3), Inches(0.6),
             "Вопросы?", size=18, italic=True,
             color=style["accent"], align=PP_ALIGN.CENTER)
    _add_page_number(sN, page_num)

    buf = io.BytesIO(); prs.save(buf); return buf.getvalue()


async def generate_presentation(user_id: int, topic: str, slides_count: int = 10,
                                style_id: str = "random",
                                user_info: str = "", user_wishes: str = "",
                                meta: dict = None) -> bytes:
    if not _PPTX_AVAILABLE:
        raise RuntimeError("python-pptx не установлена")
    if giga_client is None:
        raise RuntimeError("GigaChat не настроен")
    if not user_info or len(user_info.strip()) < 40:
        raise ValueError(
            "Материал пуст или слишком короткий. "
            "Вставь текст/конспект по теме (минимум 40 символов) — я оформлю его в презентацию."
        )

    if not style_id or style_id == "random":
        style_id = _pick_random_style()
    if style_id not in PRESENT_STYLES:
        style_id = "academic"
    style_name = PRESENT_STYLES[style_id]["name"]

    status_msg = None
    try:
        status_msg = await bot.send_message(
            user_id, f"Собираю презентацию «{topic}»\nСтиль: {style_name}")
    except Exception:
        pass

    async def _edit(text):
        if not status_msg: return
        try:
            await bot.edit_message_text(chat_id=user_id,
                message_id=status_msg.message_id, text=text)
        except Exception:
            pass

    await _edit(f"Стиль: {style_name}\nШаг 1/5 · Разбираю материал...")
    try:
        source_map = await analyze_source(user_info)
    except Exception as e:
        logging.exception("[PRESENT] analyze_source")
        raise RuntimeError(f"Не удалось разобрать материал: {e}")

    if not source_map["facts"]:
        raise ValueError(
            "В материале не нашлось фактов для слайдов. "
            "Добавь конкретики: даты, числа, определения, тезисы."
        )

    await _edit(f"Стиль: {style_name}\nШаг 2/5 · Строю логику рассказа...")
    plan = await plan_narrative(topic, source_map, slides_count, user_wishes)

    await _edit(f"Стиль: {style_name}\nШаг 3/5 · Раскладываю факты по слайдам...")
    materialized = await materialize_slides(topic, plan, source_map)

    await _edit(f"Стиль: {style_name}\nШаг 4/5 · Проверяю, что всё сохранено...")
    report = verify_coverage(source_map, materialized)
    logging.info(f"[PRESENT] coverage: {report['coverage_pct']:.0f}% "
                 f"missing={report['missing']}")

    if report["coverage_pct"] < 80.0 and report["missing"]:
        missing_facts = [
            f for f in source_map["facts"] if f["id"] in report["missing"]
        ]
        try:
            await _edit(f"Стиль: {style_name}\nШаг 4/5 · Дополняю пропущенные факты...")
            extra_prompt = f"""В плане презентации потеряны факты. Добавь их на существующие
или новые слайды, НЕ УДАЛЯЯ уже размещённое.

ТЕМА: «{topic}»

ПОТЕРЯННЫЕ ФАКТЫ:
{chr(10).join(f"{f['id']} [{f['kind']}]: {f['text']}" for f in missing_facts)}

ТЕКУЩИЕ СЛАЙДЫ (JSON):
{json.dumps(materialized.get('slides', []), ensure_ascii=False)[:8000]}

Верни ПОЛНЫЙ обновлённый JSON той же структуры со всеми слайдами."""
            materialized2 = await _gigachat_json(extra_prompt)
            if materialized2.get("slides"):
                materialized = materialized2
                report = verify_coverage(source_map, materialized)
                logging.info(f"[PRESENT] coverage after fix: {report['coverage_pct']:.0f}%")
        except Exception as e:
            logging.warning(f"[PRESENT] coverage fix failed: {e}")

    if meta:
        materialized.setdefault("author", meta.get("author"))
        materialized.setdefault("group", meta.get("group"))
        materialized.setdefault("teacher", meta.get("teacher"))
        materialized.setdefault("year", meta.get("year"))
    materialized.setdefault("title", plan.get("title") or topic)
    materialized.setdefault("subtitle", plan.get("subtitle") or "")

    await _edit(f"Стиль: {style_name}\nШаг 5/5 · Рисую слайды...")
    pptx_bytes = await asyncio.to_thread(_build_pptx, materialized, style_id)

    if report["missing"]:
        logging.warning(
            f"[PRESENT] user={user_id} не покрыто: {report['missing']} "
            f"({report['coverage_pct']:.0f}% покрыто)"
        )

    await _edit("Готово, отправляю файл...")
    return pptx_bytes


async def api_present(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    topic = (body.get("topic") or "").strip()
    user_info = (body.get("info") or "").strip()
    user_wishes = (body.get("wishes") or "").strip()
    if not topic:
        return web.json_response({"error": "empty_topic",
                                  "message": "Введи тему презентации"}, status=400)
    if len(user_info) < 40:
        return web.json_response({
            "error": "empty_material",
            "message": "Вставь материал по теме (минимум 40 символов). "
                       "Презентация собирается ТОЛЬКО из твоего текста — ИИ не добавляет факты."
        }, status=400)
    if len(topic) > 300: topic = topic[:300]
    if len(user_info) > 20000: user_info = user_info[:20000]
    if len(user_wishes) > 2000: user_wishes = user_wishes[:2000]
    try: slides_count = int(body.get("slides", 10))
    except: slides_count = 10
    slides_count = max(3, min(20, slides_count))
    style_id = (body.get("style") or "random").strip()

    meta = {
        "author": (body.get("author") or "").strip()[:120] or None,
        "group": (body.get("group") or "").strip()[:40] or None,
        "teacher": (body.get("teacher") or "").strip()[:120] or None,
        "year": (body.get("year") or "").strip()[:10] or None,
    }
    meta = {k: v for k, v in meta.items() if v} or None

    try:
        pptx_bytes = await generate_presentation(
            user_id, topic, slides_count, style_id, user_info, user_wishes, meta)
    except ValueError as e:
        return web.json_response({"error": "empty_material", "message": str(e)}, status=400)
    except Exception as e:
        logging.exception("[PRESENT]")
        return web.json_response({"error": "present_failed", "message": str(e)}, status=500)

    date_str = _now_irkutsk().strftime("%Y-%m-%d_%H-%M")
    try:
        doc = BufferedInputFile(pptx_bytes, filename=f"presentation_{date_str}.pptx")
        await bot.send_document(user_id, doc, caption="Твоя презентация готова. Скачай её и открой в PowerPoint / WPS / Google Slides.")
        return web.json_response({"ok": True})
    except TelegramForbiddenError:
        return web.json_response({"error": "bot_blocked",
            "message": "Разблокируй бота в Telegram, чтобы получать файлы"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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
    filtered = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
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
        filtered = _filter_lessons_by_subgroup(d.get("lessons", []), subgroup)
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
    debts_count = count_user_debts(user_id)

    return web.json_response({
        "user_id": user_id, "is_admin": user_id == ADMIN_ID,
        "group": saved[1] if saved else None, "group_id": saved[0] if saved else None,
        "subgroup": get_user_subgroup(user_id),
        "tasks_active": active, "tasks_done": done, "tasks_debts": debts_count,
        "notes_count": len(notes), "scholarship_amount": amount,
        "grades_count": len(grades), "grades_avg": round(avg, 2),
        "daily_subscribed": daily,
        "notify_type": notif_settings["type"] if notif_settings else None,
        "notify_hour": notif_settings["hour"] if notif_settings else -1,
        "notify_minute": notif_settings["minute"] if notif_settings else 0,
        "notify_changes": get_notify_changes(user_id),
        "notify_before_min": get_notify_before_min(user_id),
        "attendance_was": att_stats["was"], "attendance_missed": att_stats["missed"],
        "attendance_sick": att_stats["sick"], "attendance_excused": att_stats["excused"],
        "attendance_total": sum(att_stats.values()),
        "username": user_obj.username, "first_name": user_obj.first_name,
        "last_name": user_obj.last_name
    })


async def api_groups(request): return web.json_response({"groups": GROUPS})


async def api_set_group(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id:
        logging.warning("[API/set-group] unauthorized")
        return web.json_response({"error": "unauthorized"}, status=401)
    group_id = str(body.get("group_id", "")).strip()
    group_name = str(body.get("group_name", "")).strip()
    try:
        subgroup = int(body.get("subgroup", 0))
    except Exception:
        subgroup = 0
    if not group_id or not group_name:
        delete_user_group(user_id)
        logging.info(f"[API/set-group] user={user_id} → forget")
        return web.json_response({"ok": True, "saved": False})
    ok = save_user_group(user_id, group_id, group_name)
    set_user_subgroup(user_id, subgroup)
    saved = get_user_group(user_id)
    if not ok or not saved:
        logging.error(f"[API/set-group] user={user_id} НЕ сохранилось: {group_name} ({group_id})")
        return web.json_response({
            "error": "db_error",
            "message": "Не удалось сохранить группу. Открой /whereami у админа."
        }, status=500)
    logging.info(f"[API/set-group] user={user_id} -> {group_name} ({group_id}) sub={subgroup}")
    return web.json_response({
        "ok": True, "saved": True,
        "group": saved[1], "group_id": saved[0], "subgroup": subgroup
    })


async def api_set_subgroup(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try: subgroup = int(body.get("subgroup", 0))
    except: subgroup = 0
    set_user_subgroup(user_id, subgroup)
    return web.json_response({"ok": True})


def _task_to_dict(row):
    tid, text, due_date, done, created_at, priority, due_time, tags, repeat_rule = row
    overdue = False
    if due_date and not done:
        try:
            if due_time: dt = datetime.strptime(f"{due_date} {due_time}", "%d.%m.%Y %H:%M")
            else: dt = datetime.strptime(due_date, "%d.%m.%Y").replace(hour=23, minute=59)
            overdue = dt < _now_irkutsk()
        except: pass
    p = priority if priority is not None else 2
    if p not in (1, 2, 3): p = 2
    is_debt = " #долг " in f" {(tags or '')} "
    return {"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
            "priority": p, "done": bool(done), "overdue": overdue,
            "tags": tags or "", "repeat_rule": repeat_rule, "is_debt": is_debt}


async def api_tasks(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    show_done = request.query.get("done", "0") == "1"
    tag = (request.query.get("tag") or "").strip() or None
    search = (request.query.get("search") or "").strip() or None
    sort_by = (request.query.get("sort") or "due").strip()
    if sort_by not in ("due", "priority", "created"): sort_by = "due"
    if show_done:
        rows = get_done_tasks(user_id, days=30)
        tasks = []
        for r in rows:
            tid, text, due_date, done, created_at, priority, due_time, done_at, tags = r
            p = priority if priority in (1, 2, 3) else 2
            tasks.append({"id": tid, "text": text, "due_date": due_date, "due_time": due_time,
                          "priority": p, "done": True, "done_at": done_at, "overdue": False,
                          "tags": tags or "", "repeat_rule": None,
                          "is_debt": " #долг " in f" {(tags or '')} "})
    else:
        rows = get_user_tasks(user_id, only_active=True, tag=tag, search=search, sort_by=sort_by)
        tasks = [_task_to_dict(r) for r in rows]
    active, done_count = count_user_tasks(user_id)
    stats = task_stats(user_id)
    tags = get_all_task_tags(user_id)
    debts_count = count_user_debts(user_id)
    return web.json_response({"tasks": tasks, "active": active, "done": done_count,
        "stats": stats, "tags": tags, "debts_count": debts_count})


async def api_task_add(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    text = (body.get("text") or "").strip()
    if not text: return web.json_response({"error": "empty_text"}, status=400)
    if len(text) > 500: text = text[:500]
    due_date = body.get("due_date") or None
    due_time = body.get("due_time") or None
    priority = int(body.get("priority", 2))
    if priority not in (1, 2, 3): priority = 2
    tags = (body.get("tags") or "").strip()[:200]
    repeat_rule = body.get("repeat_rule") or None
    if repeat_rule not in (None, "", "daily", "weekly", "monthly"): repeat_rule = None
    if not repeat_rule: repeat_rule = None
    tid = add_task(user_id, text, due_date, priority, due_time, tags=tags, repeat_rule=repeat_rule)
    return web.json_response({"ok": True, "id": tid})


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
        mark_task_done(tid, user_id)
        return web.json_response({"ok": True, "done": True})
    text = body.get("text")
    due_date = body.get("due_date")
    due_time = body.get("due_time")
    priority = body.get("priority")
    tags = body.get("tags")
    repeat_rule = body.get("repeat_rule")
    if repeat_rule is not None and repeat_rule not in ("", "daily", "weekly", "monthly"):
        repeat_rule = None
    reset_due = body.get("reset_due", False)
    if priority is not None:
        priority = int(priority)
        if priority not in (1, 2, 3): priority = 2
    update_task(tid, user_id,
        text=text if text is not None else None,
        due_date=due_date if due_date else None,
        priority=priority,
        due_time=due_time if due_time is not None else None,
        reset_due=reset_due,
        tags=tags if tags is not None else None,
        repeat_rule=repeat_rule if repeat_rule is not None else None)
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
    search = (request.query.get("search") or "").strip() or None
    tag = (request.query.get("tag") or "").strip() or None
    sort = (request.query.get("sort") or "pinned").strip()
    rows = get_user_notes(user_id, search=search, tag=tag, sort=sort)
    items = [{"id": r[0], "subject": r[1], "text": r[2], "tags": r[3], "pinned": bool(r[4])}
             for r in rows]
    return web.json_response({"notes": items, "tags": get_all_note_tags(user_id)})


async def api_note_save(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    subject = (body.get("subject") or "").strip()
    text = (body.get("text") or "").strip()
    tags = (body.get("tags") or "").strip()[:200]
    if not subject or not text: return web.json_response({"error": "empty"}, status=400)
    if len(subject) > 100: subject = subject[:100]
    if len(text) > 5000: text = text[:5000]
    add_or_update_note(user_id, subject, text, tags=tags)
    return web.json_response({"ok": True})


async def api_note_delete(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    nid = int(body.get("id", 0))
    if not nid: return web.json_response({"error": "no_id"}, status=400)
    delete_note_by_id(nid, user_id)
    return web.json_response({"ok": True})


async def api_note_pin(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    nid = int(body.get("id", 0))
    if not nid: return web.json_response({"error": "no_id"}, status=400)
    res = toggle_note_pin(nid, user_id)
    if res is None: return web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"ok": True, "pinned": res})


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
                    for les in d.get("lessons", []):
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
    upsert_grade(user_id, subject, grade, is_auto, semester)
    return web.json_response({"ok": True})


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
    return web.json_response({"ok": True, "status": status})


async def api_attendance_semester(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    stats = attendance_semester_stats(user_id)
    return web.json_response(stats)


async def api_weather(request):
    init_data = request.query.get("initData", "")
    user_id = _verify_webapp_init(init_data)
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    w = await fetch_weather()
    return web.json_response({"weather": w, "line": weather_line(w) if w else ""})


async def api_export_ics(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    user_id = _verify_webapp_init(body.get("initData", ""))
    if not user_id: return web.json_response({"error": "unauthorized"}, status=401)
    try:
        weeks = int(body.get("weeks", 2))
        weeks = max(1, min(4, weeks))
        ics_bytes = await generate_ics_for_user_async(user_id, weeks=weeks)
    except ValueError as e:
        return web.json_response({"error": "no_group", "message": str(e)}, status=400)
    except Exception as e:
        logging.exception("[ICS]")
        return web.json_response({"error": "ics_failed", "message": str(e)}, status=500)

    try:
        doc = BufferedInputFile(ics_bytes, filename="student_irk_schedule.ics")
        await bot.send_document(user_id, doc, caption="Расписание в формате .ics.\nОткрой файл в Google Calendar / Apple Calendar / Яндекс.Календаре — пары добавятся автоматически.")
        return web.json_response({"ok": True})
    except TelegramForbiddenError:
        return web.json_response({"error": "bot_blocked"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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

    cached = ai_cache_get(question)
    if cached:
        ai_save_message(user_id, 'assistant', cached, has_photo=0)
        return web.json_response({"answer": cached, "cached": True})

    try:
        prompt = ("Ты студенческий помощник. Ответь на вопрос студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n- Пиши без воды.\n\n"
            f"Вопрос: {question}")
        answer = await giga_chat_safe(prompt, timeout=120)
        answer = clean_latex(answer); answer = clean_markdown(answer)
        if len(answer) > 4000: answer = answer[:4000] + "\n... (обрезано)"
        ai_save_message(user_id, 'assistant', answer, has_photo=0)
        ai_cache_put(question, answer)
        return web.json_response({"answer": answer, "cached": False})
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
    b64 = photo_data.split(",", 1)[-1]
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
        prompt = ("Ты студенческий помощник. Пользователь прислал фото, с которого распознан текст. "
            "Выполни задачу студента.\n\n"
            "ТРЕБОВАНИЯ К ФОРМАТУ:\n- НЕ используй Markdown-таблицы, заголовки ### и горизонтальные линии.\n"
            "- НЕ используй LaTeX-команды.\n- Формулы пиши обычным текстом.\n"
            "- Структурируй текст простыми списками.\n- Пиши без воды.\n\n"
            f"Распознанный текст с фото:\n{recognized_text}\n\nЗадача студента: {question}")
        answer = await giga_chat_safe(prompt, timeout=120)
        answer = clean_latex(answer); answer = clean_markdown(answer)
        if len(answer) > 4000: answer = answer[:4000] + "\n... (обрезано)"
        ai_save_message(user_id, 'assistant', answer, has_photo=0)
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
        admin_msg = await bot.send_message(ADMIN_ID, f"Обращение (из веба)\nОт: user_{user_id}\n\n{text}")
        update_feedback_admin_msg(fid, admin_msg.message_id)
    except Exception as e:
        logging.error(f"[FEEDBACK-WEB] {e}")
    return web.json_response({"ok": True, "id": fid})


def _find_or_download_pdf_font():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "fonts", "DejaVuSans.ttf"),
        os.path.join(base_dir, "webapp", "fonts", "DejaVuSans.ttf"),
        os.path.join(os.getcwd(), "fonts", "DejaVuSans.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "fonts/DejaVuSans.ttf"]
    for p in candidates:
        if os.path.isfile(p):
            logging.info(f"[PDF FONT] найден: {p}")
            return p
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
    if len(s) > limit: s = s[:limit - 1] + "..."
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
            if t.get("tags"): meta.append(f"теги: {t['tags']}")
            pdf.set_font("Main", size=9); pdf.set_text_color(130, 130, 130)
            pdf.cell(0, 5, "    " + " · ".join(meta), ln=True)
            pdf.set_text_color(0, 0, 0); pdf.set_font("Main", size=11)
    notes = data.get("notes", [])
    section(f"Заметки ({len(notes)})")
    if not notes: pdf.cell(0, 6, "Нет заметок", ln=True)
    else:
        for n in notes:
            pin = "[PIN] " if n.get("pinned") else ""
            pdf.set_font("Main", size=11); pdf.multi_cell(0, 5.5, f"{pin}{n['subject']}:")
            pdf.set_font("Main", size=10); pdf.set_text_color(70, 70, 70)
            pdf.multi_cell(0, 5, "    " + _pdf_short(n["text"], 400))
            if n.get("tags"):
                pdf.set_font("Main", size=9); pdf.set_text_color(120, 120, 120)
                pdf.cell(0, 5, "    теги: " + n["tags"], ln=True)
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
    except TelegramForbiddenError:
        return web.json_response({"error": "bot_blocked"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def _admin_only(init_data):
    user_id = _verify_webapp_init(init_data)
    if not user_id or user_id != ADMIN_ID: return None
    return user_id


async def api_admin_stats(request):
    init_data = request.query.get("initData", "")
    if not _admin_only(init_data): return web.json_response({"error": "forbidden"}, status=403)
    cache_stats = ai_cache_stats()
    return web.json_response({
        "total_users": get_total_users(),
        "pending_feedback": len(get_pending_feedback()),
        "ai_cache": cache_stats,
    })


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
        await bot.send_message(target_uid, f"Ответ администратора:\n\n{reply}")
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


async def api_admin_clear_ai_cache(request):
    try: body = await request.json()
    except: return web.json_response({"error": "bad_json"}, status=400)
    if not _admin_only(body.get("initData", "")): return web.json_response({"error": "forbidden"}, status=403)
    ai_cache_clear()
    return web.json_response({"ok": True})


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
    app.router.add_post("/api/note-pin", api_note_pin)
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
    app.router.add_get("/api/attendance/semester", api_attendance_semester)
    app.router.add_get("/api/weather", api_weather)
    app.router.add_post("/api/export_ics", api_export_ics)
    app.router.add_get("/api/ai/history", api_ai_history)
    app.router.add_post("/api/ai/clear-history", api_ai_clear_history)
    app.router.add_post("/api/ai", api_ai)
    app.router.add_post("/api/ai-photo", api_ai_photo)
    app.router.add_post("/api/present", api_present)
    app.router.add_post("/api/feedback", api_feedback)
    app.router.add_get("/api/feedback/my", api_feedback_my)
    app.router.add_post("/api/export", api_export)
    app.router.add_get("/api/admin/stats", api_admin_stats)
    app.router.add_get("/api/admin/feedback-list", api_admin_feedback_list)
    app.router.add_post("/api/admin/feedback-reply", api_admin_feedback_reply)
    app.router.add_post("/api/admin/feedback-postpone", api_admin_feedback_postpone)
    app.router.add_post("/api/admin/broadcast", api_admin_broadcast)
    app.router.add_get("/api/admin/monitor", api_admin_monitor)
    app.router.add_post("/api/admin/clear-ai-cache", api_admin_clear_ai_cache)
    if webapp_dir:
        NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate","Pragma": "no-cache","Expires": "0"}
        async def index_handler(request):
            p = os.path.join(webapp_dir, "index.html")
            if os.path.isfile(p): return web.FileResponse(p, headers=NO_CACHE)
            return web.Response(text="not found", status=404)
        async def style_handler(request):
            p = os.path.join(webapp_dir, "style.css")
            if os.path.isfile(p): return web.FileResponse(p, headers={**NO_CACHE, "Content-Type": "text/css"})
            return web.Response(status=404)
        async def appjs_handler(request):
            p = os.path.join(webapp_dir, "app.js")
            if os.path.isfile(p): return web.FileResponse(p, headers={**NO_CACHE, "Content-Type": "application/javascript"})
            return web.Response(status=404)
        async def asset_handler(request):
            name = request.match_info.get("name", "")
            safe_name = os.path.basename(name)
            if not safe_name or safe_name.startswith("."): return web.Response(status=404)
            p = os.path.join(webapp_dir, "assets", safe_name)
            if os.path.isfile(p): return web.FileResponse(p, headers=NO_CACHE)
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


def open_app_kb():
    if not WEBAPP_URL:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])


@dp.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    try: await state.clear()
    except: pass
    _ensure_user(message.from_user.id)
    try: _update_user_meta(message.from_user.id, message.from_user.username, message.from_user.first_name)
    except: pass
    text = (
        f"Привет, {message.from_user.first_name or 'студент'}!\n\n"
        "Это Student IRK — твой помощник в учёбе. Всё внутри приложения:\n"
        "• Расписание пар\n"
        "• Задачи и заметки\n"
        "• Стипендия и посещаемость\n"
        "• AI-помощник и презентации\n\n"
    )
    kb = open_app_kb()
    if kb:
        text += "Нажми кнопку ниже, чтобы открыть приложение."
        await message.answer(text, reply_markup=kb)
    else:
        text += "Приложение пока недоступно (админ не настроил WEBAPP_URL)."
        await message.answer(text)


@dp.message(Command("help"))
async def cmd_help(message: Message):
    kb = open_app_kb()
    text = (
        "Student IRK\n\n"
        "Всё управление — в приложении. Нажми кнопку ниже:\n\n"
        "• Расписание: пары на сегодня/завтра/неделю, отметки посещаемости\n"
        "• Задачи: с приоритетом, сроками, тегами, повторами\n"
        "• Заметки: с тегами и закреплением\n"
        "• AI: вопросы и разбор фото\n"
        "• Стипендия: оценки, средний балл, прогноз\n"
        "• Экспорт: PDF, .ics для календаря\n\n"
        "Если что-то не работает — открой в приложении Профиль → Обратная связь."
    )
    await message.answer(text, reply_markup=kb)


@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer(f"Только для админа.\nТвой ID: {message.from_user.id}"); return
    kb = open_app_kb()
    text = (
        "АДМИН-КОМАНДЫ:\n"
        "/backup — снимок users.db (SQLite Backup API)\n"
        "/backup_all — полный zip (БД + шрифты + webapp)\n"
        "/restore — восстановить users.db (отправь .db с подписью)\n"
        "/whereami — где база и твой ID\n"
        "/dbcheck — проверка схемы БД (колонки, пользователи)\n"
        "/cache — статистика кэша ИИ\n"
        "/admin — эта справка\n\n"
        "Очередь модерации и каналы удалены из бота."
    )
    await message.answer(text, reply_markup=kb)


@dp.message(Command("whereami"))
async def cmd_whereami(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Только для админа."); return
    db_abs = os.path.abspath(DB_PATH)
    exists = os.path.isfile(db_abs)
    size = os.path.getsize(db_abs) if exists else 0
    wal_exists = os.path.isfile(db_abs + "-wal")
    shm_exists = os.path.isfile(db_abs + "-shm")
    text = (f"Твой ID: {message.from_user.id}\n"
            f"ADMIN_ID: {ADMIN_ID}\n"
            f"cwd: {os.getcwd()}\n"
            f"DB_PATH: {DB_PATH}\n"
            f"abs: {db_abs}\n"
            f"exists: {exists}\n"
            f"size: {size} B ({size // 1024} КБ)\n"
            f"WAL: {'да' if wal_exists else 'нет'} | SHM: {'да' if shm_exists else 'нет'}\n"
            f"schema: {_db_schema_version()}")
    await message.answer(text)


@dp.message(Command("dbcheck"))
async def cmd_dbcheck(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Только для админа."); return
    try:
        conn = _connect()
        try:
            tables = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()]
            cols_users = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            cols_tasks = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
            cols_notes = [r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()]
            total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            with_group = conn.execute(
                "SELECT COUNT(*) FROM users WHERE group_id IS NOT NULL AND group_id != ''"
            ).fetchone()[0]
            pending_feedback = conn.execute("SELECT COUNT(*) FROM feedback WHERE COALESCE(status,'new') IN ('new','postponed')").fetchone()[0]
        finally:
            conn.close()

        need_users = {"user_id", "group_id", "group_name", "subgroup",
                      "notify_hour", "notify_minute", "notify_type",
                      "notify_changes", "notify_before_min",
                      "username", "first_name"}
        missing_users = need_users - set(cols_users)

        lines = [
            f"Таблицы ({len(tables)}): {', '.join(tables[:20])}",
            "",
            f"users ({len(cols_users)}): {', '.join(cols_users)}",
            f"tasks ({len(cols_tasks)}): {', '.join(cols_tasks)}",
            f"notes ({len(cols_notes)}): {', '.join(cols_notes)}",
            "",
            f"Пользователей: {total}",
            f"С группой: {with_group}",
            f"Обращений в очереди: {pending_feedback}",
        ]
        if missing_users:
            lines.append("")
            lines.append(f"[!] В users НЕТ колонок: {sorted(missing_users)}")
            lines.append("Запусти бота один раз, init_db() добавит их.")
        else:
            lines.append("")
            lines.append("[OK] users содержит все нужные колонки")
        await message.answer("\n".join(lines))
    except Exception as e:
        logging.exception("[DBCHECK]")
        await message.answer(f"Ошибка: {e}")


@dp.message(Command("cache"))
async def cmd_cache(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Только для админа."); return
    ai = ai_cache_stats()
    lines = [
        "КЭШ ИИ:",
        "",
        f"Записей: {ai['size']}",
        f"Попаданий: {ai['hits']}",
    ]
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Очистить кэш ИИ", callback_data="admin_clear_ai")],
    ])
    await message.answer("\n".join(lines), reply_markup=kb)


@dp.callback_query(F.data == "admin_clear_ai")
async def cb_admin_clear_ai(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Не для тебя", show_alert=True); return
    ai_cache_clear()
    await callback.answer("Кэш ИИ очищен", show_alert=True)
    try:
        await callback.message.edit_text("Кэш ИИ очищен. AI-ответы: 0 записей.")
    except Exception:
        pass


@dp.message(Command("backup"))
async def cmd_backup(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer(f"Только для админа.\nТвой ID: {message.from_user.id}"); return
    try:
        db_abs = os.path.abspath(DB_PATH)
        if not os.path.isfile(db_abs):
            await message.answer(f"Файл базы не найден:\n{db_abs}"); return
        ts = _now_irkutsk().strftime('%Y%m%d_%H%M%S')
        tmp_path = db_abs + f".snapshot_{ts}"
        _make_db_snapshot(tmp_path)
        size_kb = os.path.getsize(tmp_path) // 1024
        total = get_total_users()
        fname = f"users_backup_{_now_irkutsk().strftime('%Y%m%d_%H%M')}.db"
        doc = FSInputFile(tmp_path, filename=fname)
        await message.answer_document(
            doc,
            caption=(f"Резервная копия\n"
                     f"Пользователей: {total}\n"
                     f"Размер: {size_kb} КБ\n"
                     f"WAL-checkpoint: OK\n"
                     f"Схема: {_db_schema_version()}")
        )
        try: os.remove(tmp_path)
        except: pass
    except Exception as e:
        logging.exception("[BACKUP]")
        await message.answer(f"Ошибка бэкапа: {e}")


@dp.message(Command("backup_all"))
async def cmd_backup_all(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Только для админа."); return
    try:
        import zipfile
        base_dir = os.path.dirname(os.path.abspath(__file__))
        ts = _now_irkutsk().strftime('%Y%m%d_%H%M%S')
        zip_path = os.path.join(base_dir, f"student_irk_backup_{ts}.zip")
        db_abs = os.path.abspath(DB_PATH)
        db_snap = db_abs + f".snap_tmp_{ts}"
        _make_db_snapshot(db_snap)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(db_snap, "users.db")
            fonts_dir = os.path.join(base_dir, "fonts")
            if os.path.isdir(fonts_dir):
                for f in os.listdir(fonts_dir):
                    fp = os.path.join(fonts_dir, f)
                    if os.path.isfile(fp):
                        z.write(fp, f"fonts/{f}")
            webapp_dir = os.path.join(base_dir, "webapp")
            if os.path.isdir(webapp_dir):
                for root, _, files in os.walk(webapp_dir):
                    for f in files:
                        p = os.path.join(root, f)
                        rel = os.path.relpath(p, base_dir)
                        z.write(p, rel)
            z.writestr("README.txt",
                f"Student IRK backup\nДата: {ts} (Иркутск)\nПользователей: {get_total_users()}\nСхема: {_db_schema_version()}\n")
        try: os.remove(db_snap)
        except: pass
        size_mb = os.path.getsize(zip_path) / 1024 / 1024
        await message.answer_document(
            FSInputFile(zip_path, filename=os.path.basename(zip_path)),
            caption=f"Полный бэкап\nРазмер: {size_mb:.2f} МБ"
        )
        try: os.remove(zip_path)
        except: pass
    except Exception as e:
        logging.exception("[BACKUP_ALL]")
        await message.answer(f"Ошибка: {e}")


@dp.message(Command("restore"))
async def cmd_restore(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer(f"Только для админа.\nТвой ID: {message.from_user.id}"); return
    if not message.document:
        await message.answer("Пришли .db файл с подписью /restore (в одном сообщении)."); return
    fname = (message.document.file_name or "").lower()
    if not fname.endswith(".db"):
        await message.answer("Нужен файл с расширением .db"); return
    async with _restore_lock:
        try:
            db_abs = os.path.abspath(DB_PATH)
            if os.path.isfile(db_abs):
                bak = db_abs + ".before_restore_" + _now_irkutsk().strftime('%Y%m%d_%H%M%S')
                shutil.copy2(db_abs, bak)
                for ext in ("-wal", "-shm"):
                    if os.path.isfile(db_abs + ext):
                        try: shutil.copy2(db_abs + ext, bak + ext)
                        except: pass
            os.makedirs(os.path.dirname(db_abs) or ".", exist_ok=True)
            tmp_new = db_abs + ".incoming"
            file = await bot.get_file(message.document.file_id)
            await bot.download_file(file.file_path, tmp_new)
            ok, err = _check_db_integrity(tmp_new)
            if not ok:
                try: os.remove(tmp_new)
                except: pass
                await message.answer(f"Файл не прошёл проверку: {err}"); return
            for ext in ("-wal", "-shm"):
                if os.path.isfile(db_abs + ext):
                    try: os.remove(db_abs + ext)
                    except: pass
            os.replace(tmp_new, db_abs)
            init_db()
            await message.answer(
                f"База восстановлена.\n"
                f"Всего пользователей: {get_total_users()}\n"
                f"Схема: {_db_schema_version()}\n"
                f"Файл: {db_abs}"
            )
        except Exception as e:
            logging.exception("[RESTORE]")
            await message.answer(f"Ошибка восстановления: {e}")


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

        w_line = ""
        if ntype == "today":
            try:
                w = await fetch_weather()
                w_line = weather_line(w)
            except Exception:
                pass

        if not day:
            txt = f"{header}\n"
            if w_line: txt += f"\n{w_line}\n"
            txt += "\nНе удалось загрузить."
            await bot.send_message(user_id, txt, parse_mode=None); return
        lessons = _filter_lessons_by_subgroup(day.get("lessons", []), subgroup)
        lines = [header]
        if w_line:
            lines.append("")
            lines.append(w_line)
        if not lessons:
            lines.append("")
            lines.append("Занятий нет.")
            await bot.send_message(user_id, "\n".join(lines), parse_mode=None); return
        lines.append("")
        for les in lessons:
            time_end = LESSON_TIMES.get(les["time"], "")
            time_str = f"{les['time']}-{time_end}" if time_end else les["time"]
            lines.append(time_str); lines.append(les["subject"])
            details = []
            if les.get("type"): details.append(les["type"])
            if les.get("auditorium"): details.append(f"ауд. {les['auditorium']}")
            if les.get("teacher"): details.append(les["teacher"])
            if details: lines.append(f"{' · '.join(details)}")
            lines.append("")
        await bot.send_message(user_id, "\n".join(lines), parse_mode=None)
    except Exception as e:
        logging.error(f"[NOTIFY] user={user_id}: {e}")


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
    except Exception as e:
        logging.error(f"[REMIND] user={user_id}: {e}")


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


async def cleanup_cache_worker():
    while True:
        try:
            await asyncio.sleep(3600)
            now = _now_irkutsk()
            if now.hour == 4:
                cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
                conn = _connect()
                try:
                    conn.execute("DELETE FROM schedule_cache WHERE cached_at < ?", (cutoff,))
                    conn.commit()
                finally:
                    conn.close()
                try:
                    conn = _connect()
                    try:
                        ai_cutoff = (datetime.now(timezone.utc) - timedelta(days=AI_CACHE_TTL_DAYS)).isoformat()
                        conn.execute("DELETE FROM ai_cache WHERE created_at < ?", (ai_cutoff,))
                        conn.commit()
                    finally:
                        conn.close()
                except Exception:
                    pass
                logging.info("[CLEANUP] старый кэш удалён")
        except Exception:
            logging.exception("[CLEANUP]")


async def autobackup_worker():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backup_dir = os.path.join(base_dir, "backups")
    try: os.makedirs(backup_dir, exist_ok=True)
    except: pass
    last_date = None
    while True:
        try:
            now = _now_irkutsk()
            today = now.strftime("%Y-%m-%d")
            if now.hour == 4 and now.minute < 5 and last_date != today:
                last_date = today
                db_abs = os.path.abspath(DB_PATH)
                dst_path = os.path.join(backup_dir, f"auto_{now.strftime('%Y%m%d_%H%M')}.db")
                try:
                    _make_db_snapshot(dst_path)
                    logging.info(f"[AUTOBACKUP] {dst_path}")
                    cutoff = now - timedelta(days=14)
                    for f in os.listdir(backup_dir):
                        if not f.startswith("auto_"): continue
                        p = os.path.join(backup_dir, f)
                        try:
                            mt = datetime.fromtimestamp(os.path.getmtime(p), tz=timezone.utc) + timedelta(hours=8)
                            if mt < cutoff: os.remove(p)
                        except Exception: pass
                except Exception as e:
                    logging.error(f"[AUTOBACKUP] {e}")
        except Exception:
            logging.exception("[AUTOBACKUP]")
        await asyncio.sleep(60)


async def debts_worker():
    await asyncio.sleep(60)
    last_date = None
    while True:
        try:
            now = _now_irkutsk()
            today = now.strftime("%Y-%m-%d")
            if now.hour == 9 and last_date != today:
                last_date = today
                rows = get_overdue_debt_tasks()
                moved_by_user = {}
                today_str = now.strftime("%d.%m.%Y")
                tomorrow_str = (now + timedelta(days=1)).strftime("%d.%m.%Y")
                today_key = today_str[6:] + today_str[3:5] + today_str[:2]
                for tid, uid, text, due, due_time in rows:
                    if not due or len(due) != 10: continue
                    key = due[6:] + due[3:5] + due[:2]
                    if key < today_key:
                        if move_debt_to_date(tid, uid, tomorrow_str):
                            moved_by_user.setdefault(uid, []).append(text[:60])
                for uid, items in moved_by_user.items():
                    n = len(items)
                    word = "долг" if n == 1 else ("долга" if n in (2, 3, 4) else "долгов")
                    lines = [f"{n} {word} перенесено на завтра ({tomorrow_str}):", ""]
                    for t in items[:10]:
                        lines.append(f"- {t}")
                    if n > 10: lines.append(f"... и ещё {n-10}")
                    lines.append("")
                    lines.append("Разберись, пока не превратилось в хвост.")
                    try:
                        await bot.send_message(uid, "\n".join(lines), parse_mode=None)
                    except Exception:
                        pass
        except Exception:
            logging.exception("[DEBTS]")
        await asyncio.sleep(600)


async def weather_warmup_worker():
    while True:
        try:
            await fetch_weather(force=True)
        except Exception:
            logging.exception("[WEATHER]")
        await asyncio.sleep(3600)


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s",
        stream=sys.stdout, force=True)
    init_db()
    if not WEBAPP_URL:
        logging.warning("[MAIN] WEBAPP_URL не задан — кнопка приложения в /start НЕ появится. Настрой WEBAPP_URL в переменных окружения.")
    await bot.delete_webhook(drop_pending_updates=True)
    try:
        if _FPDF_AVAILABLE: await asyncio.to_thread(_find_or_download_pdf_font)
    except: pass

    asyncio.create_task(start_webapp())
    asyncio.create_task(notification_worker())
    asyncio.create_task(lesson_reminder_worker())
    asyncio.create_task(change_worker())
    asyncio.create_task(cleanup_cache_worker())
    asyncio.create_task(autobackup_worker())
    asyncio.create_task(debts_worker())
    asyncio.create_task(weather_warmup_worker())

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
