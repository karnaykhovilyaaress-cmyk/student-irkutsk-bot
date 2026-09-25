import asyncio
import re
import sys
import sqlite3
import logging
from datetime import datetime, timedelta, timezone
import aiohttp
from bs4 import BeautifulSoup
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    Message, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery,
    FSInputFile
)

# ============================================================
# НАСТРОЙКИ
# ============================================================
TOKEN = "8953672814:AAG4cxGgLJRVv-EXzDip6cT7u6NO7vez18E"
ADMIN_ID = 6014557174  # ← ВСТАВЬ СВОЙ TELEGRAM ID (узнать через /myid)
bot = Bot(token=TOKEN)
dp = Dispatcher()

DB_PATH = "users.db"
CACHE_TTL_HOURS = 2
CHANGES_CHECK_INTERVAL_MIN = 60

NOTIFY_PRESETS = [
    ("7:00", 7, 0), ("8:00", 8, 0),
    ("19:00", 19, 0), ("20:00", 20, 0),
    ("21:00", 21, 0), ("22:00", 22, 0),
]


# ============================================================
# СОСТОЯНИЯ FSM
# ============================================================
class FeedbackState(StatesGroup):
    waiting_message = State()

class TaskState(StatesGroup):
    waiting_text = State()

class NoteState(StatesGroup):
    waiting_subject = State()
    waiting_text = State()

class AuditoriumState(StatesGroup):
    waiting_code = State()


# ============================================================
# БАЗА ДАННЫХ
# ============================================================
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            group_id TEXT,
            group_name TEXT,
            notify_hour INTEGER DEFAULT -1,
            notify_minute INTEGER DEFAULT 0,
            notify_changes INTEGER DEFAULT 0
        )
    """)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN notify_changes INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    conn.execute("""
        CREATE TABLE IF NOT EXISTS schedule_cache (
            group_id TEXT, week_start TEXT, html TEXT, cached_at TEXT,
            PRIMARY KEY (group_id, week_start)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schedule_snapshots (
            group_id TEXT, week_start TEXT, snapshot TEXT, updated_at TEXT,
            PRIMARY KEY (group_id, week_start)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, username TEXT, text TEXT,
            created_at TEXT, admin_msg_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, text TEXT, due_date TEXT,
            done INTEGER DEFAULT 0, created_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, subject TEXT, text TEXT,
            created_at TEXT
        )
    """)
    conn.commit(); conn.close()


def _ensure_user(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
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
    conn.execute("UPDATE users SET group_id=NULL, group_name=NULL, notify_hour=-1, notify_changes=0 WHERE user_id=?",
                 (user_id,))
    conn.commit(); conn.close()


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


def get_users_to_notify(hour, minute):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, group_name FROM users "
        "WHERE notify_hour=? AND notify_minute=? AND group_id IS NOT NULL",
        (hour, minute)).fetchall()
    conn.close()
    return rows


def get_changes_subscribers():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, group_name FROM users "
        "WHERE notify_changes=1 AND group_id IS NOT NULL"
    ).fetchall()
    conn.close()
    result = {}
    for uid, gid, gname in rows:
        result.setdefault(gid, []).append((uid, gname))
    return result


def get_stats():
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    with_group = conn.execute("SELECT COUNT(*) FROM users WHERE group_id IS NOT NULL").fetchone()[0]
    with_notify = conn.execute("SELECT COUNT(*) FROM users WHERE notify_hour >= 0 AND group_id IS NOT NULL").fetchone()[0]
    changes = conn.execute("SELECT COUNT(*) FROM users WHERE notify_changes=1 AND group_id IS NOT NULL").fetchone()[0]
    cache_count = conn.execute("SELECT COUNT(*) FROM schedule_cache").fetchone()[0]
    fb_count = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
    tasks_count = conn.execute("SELECT COUNT(*) FROM tasks WHERE done=0").fetchone()[0]
    notes_count = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    conn.close()
    return total, with_group, with_notify, changes, cache_count, fb_count, tasks_count, notes_count


def get_all_user_ids():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id FROM users").fetchall()
    conn.close()
    return [r[0] for r in rows]


# ---- Кэш ----
def get_cached_schedule(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT html, cached_at FROM schedule_cache WHERE group_id=? AND week_start=?",
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


def clear_old_cache():
    conn = sqlite3.connect(DB_PATH)
    threshold = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    conn.execute("DELETE FROM schedule_cache WHERE cached_at < ?", (threshold,))
    conn.commit(); conn.close()


# ---- Снапшоты ----
def get_snapshot(group_id, week_start):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT snapshot FROM schedule_snapshots WHERE group_id=? AND week_start=?",
                       (group_id, week_start)).fetchone()
    conn.close()
    return row[0] if row else None


def save_snapshot(group_id, week_start, snapshot):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR REPLACE INTO schedule_snapshots VALUES (?, ?, ?, ?)",
                 (group_id, week_start, snapshot, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def build_snapshot(days):
    parts = []
    for d in days:
        for les in d["lessons"]:
            parts.append(f"{d['date']}|{les['time']}|{les['subject']}|{les['type']}|"
                         f"{les['teacher']}|{les['auditorium']}|{les['subgroup']}")
    return "\n".join(sorted(parts))


# ---- Обратная связь ----
def save_feedback(user_id, username, text, admin_msg_id=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO feedback (user_id, username, text, created_at, admin_msg_id) VALUES (?, ?, ?, ?, ?)",
        (user_id, username, text, datetime.now(timezone.utc).isoformat(), admin_msg_id))
    fid = cur.lastrowid
    conn.commit(); conn.close()
    return fid


def update_feedback_admin_msg(feedback_id, admin_msg_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE feedback SET admin_msg_id=? WHERE id=?", (admin_msg_id, feedback_id))
    conn.commit(); conn.close()


def get_feedback_by_admin_msg(admin_msg_id):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id, user_id FROM feedback WHERE admin_msg_id=?",
                       (admin_msg_id,)).fetchone()
    conn.close()
    return row


def get_all_feedback(limit=20):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, user_id, username, text, created_at FROM feedback ORDER BY id DESC LIMIT ?",
        (limit,)).fetchall()
    conn.close()
    return rows


# ---- Задачи ----
def add_task(user_id, text, due_date=None):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute(
        "INSERT INTO tasks (user_id, text, due_date, done, created_at) VALUES (?, ?, ?, 0, ?)",
        (user_id, text, due_date, datetime.now(timezone.utc).isoformat()))
    tid = cur.lastrowid
    conn.commit(); conn.close()
    return tid


def get_user_tasks(user_id, only_active=True):
    conn = sqlite3.connect(DB_PATH)
    if only_active:
        rows = conn.execute("SELECT id, text, due_date, done FROM tasks WHERE user_id=? AND done=0 ORDER BY id DESC",
                            (user_id,)).fetchall()
    else:
        rows = conn.execute("SELECT id, text, due_date, done FROM tasks WHERE user_id=? ORDER BY id DESC",
                            (user_id,)).fetchall()
    conn.close()
    return rows


def mark_task_done(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("UPDATE tasks SET done=1 WHERE id=? AND user_id=?", (task_id, user_id))
    conn.commit(); conn.close()


def delete_task(task_id, user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE id=? AND user_id=?", (task_id, user_id))
    conn.commit(); conn.close()


def clear_done_tasks(user_id):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM tasks WHERE user_id=? AND done=1", (user_id,))
    conn.commit(); conn.close()


def get_tasks_with_due():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT user_id, id, text, due_date FROM tasks WHERE done=0 AND due_date IS NOT NULL").fetchall()
    conn.close()
    return rows


# ---- Заметки ----
def add_or_update_note(user_id, subject, text):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT id FROM notes WHERE user_id=? AND subject=?",
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


def get_note(user_id, subject):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT text FROM notes WHERE user_id=? AND subject=?",
                       (user_id, subject)).fetchone()
    conn.close()
    return row[0] if row else None


# ============================================================
# ГРУППЫ
# ============================================================
GROUPS = {
    "ИАМиТ": [
        {"name": "АСПм-26-1",  "id": "478012"}, {"name": "АТПРб-26-1", "id": "478049"},
        {"name": "ЛИМб-26-1",  "id": "478284"}, {"name": "МИРб-26-1",  "id": "478310"},
        {"name": "ММб-26-1",   "id": "478314"}, {"name": "МТб-26-1",   "id": "478318"},
        {"name": "ППТм-26-1",  "id": "478441"}, {"name": "СДМ-26-1",   "id": "478478"},
        {"name": "СМ-26-1",    "id": "478493"}, {"name": "СМ-26-2",    "id": "478494"},
        {"name": "СМ-26-3",    "id": "479896"}, {"name": "ТЭАм-26-1",  "id": "478548"},
        {"name": "УКб-26-1",   "id": "478551"}, {"name": "ЦПКм-26-1",  "id": "478601"},
        {"name": "ЭЛб-26-1",   "id": "478640"},
    ],
    "Аспирантура": [
        {"name": "аАУП-26-1",   "id": "477932"}, {"name": "аБЗТ-26-1",   "id": "477934"},
        {"name": "аБПП-26-1",   "id": "477936"}, {"name": "аБТХ-26-1",   "id": "477937"},
        {"name": "аВДС-26-1",   "id": "477939"}, {"name": "аГГ-26-1",    "id": "477940"},
        {"name": "аГГМ-26-1",   "id": "477942"}, {"name": "аГНГ-26-1",   "id": "477946"},
        {"name": "аГНП-26-1",   "id": "477948"}, {"name": "аДВЛ-26-1",   "id": "477955"},
        {"name": "аМВ-26-1",    "id": "477977"}, {"name": "аМЕТ-26-1",   "id": "477979"},
        {"name": "аММП-26-1",   "id": "479885"}, {"name": "аМН-26-1",    "id": "477982"},
        {"name": "аНСкгм-26-1", "id": "477987"}, {"name": "аНСдсм-26-1", "id": "477986"},
        {"name": "аОБП-26-1",   "id": "477989"}, {"name": "аОХМ-26-1",   "id": "477990"},
        {"name": "аПБ-26-1",    "id": "477991"}, {"name": "аРЭоэ-26-1",  "id": "478006"},
        {"name": "аРЭс-26-1",   "id": "478007"}, {"name": "аСМХ-26-1",   "id": "478010"},
        {"name": "аССП-26-1",   "id": "478013"}, {"name": "аСТМ-26-1",   "id": "478014"},
        {"name": "аТАРР-26-1",  "id": "478029"}, {"name": "аТМД-26-1",   "id": "478031"},
        {"name": "аТМН-26-1",   "id": "478033"}, {"name": "аТОС-26-1",   "id": "478035"},
        {"name": "аТПС-26-1",   "id": "478051"}, {"name": "аТПСК-26-1",  "id": "478053"},
        {"name": "аТТГР-26-1",  "id": "478055"}, {"name": "аТХВ-26-1",   "id": "478056"},
        {"name": "аУПП-26-1",   "id": "478057"}, {"name": "аУСТ-26-1",   "id": "478061"},
        {"name": "аФХМ-26-1",   "id": "478062"}, {"name": "аХТВ-26-1",   "id": "478064"},
        {"name": "аЭКЛ-26-1",   "id": "478066"}, {"name": "аЭКО-26-1",   "id": "478068"},
        {"name": "аЭКС-26-1",   "id": "478070"}, {"name": "аЭНК-26-1",   "id": "478072"},
        {"name": "аЭТРд-26-1",  "id": "478073"}, {"name": "аЭТРоп-26-1", "id": "478075"},
        {"name": "аЭЭН-26-1",   "id": "478077"},
    ],
    "БРИКС": [
        {"name": "ВЗАм-26-1",   "id": "478105"}, {"name": "ИИКб-26-1",   "id": "478215"},
        {"name": "ИИКб-26-2",   "id": "479891"}, {"name": "КБКб-26-1",   "id": "478251"},
        {"name": "ЛБКб-26-1",   "id": "478279"}, {"name": "ЛБКб-26-2",   "id": "478280"},
        {"name": "МДБб-26-1",   "id": "478306"}, {"name": "РКИб-26-1",   "id": "478455"},
        {"name": "РКИб-26-2",   "id": "478456"}, {"name": "СПРКм-26-1",  "id": "479947"},
        {"name": "УЛм-26-1",    "id": "479898"}, {"name": "ФНб-26-1",    "id": "478580"},
        {"name": "ЦТм-26-1",    "id": "478605"}, {"name": "ЭПАб-26-1",   "id": "478654"},
        {"name": "ЭЗТм-26-1",   "id": "478632"},
    ],
    "ДЛРЯ": [
        {"name": "ИНС-26-1",   "id": "479936"}, {"name": "ИНС-26-2",   "id": "479937"},
        {"name": "ИНС-26-3",   "id": "479938"}, {"name": "ИНС-26-4",   "id": "479939"},
        {"name": "ИНС-26-5",   "id": "479940"}, {"name": "ИНС-26-6",   "id": "479941"},
        {"name": "ИНСм-26-1",  "id": "479942"}, {"name": "ИНСм-26-2",  "id": "479943"},
        {"name": "ИНСм-26-3",  "id": "479944"},
    ],
    "ССГ": [
        {"name": "ГИИм-26-1",   "id": "478127"}, {"name": "ИТГб-26-1",   "id": "478243"},
        {"name": "РМ-26-1",     "id": "478460"}, {"name": "РФ-26-1",     "id": "478476"},
        {"name": "ЦГФм-26-1",   "id": "478599"},
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

BUILDINGS = {
    "А": {"name": "Административный корпус", "addr": "ул. Лермонтова, 83"},
    "Б": {"name": "Библиотека (Б-корпус)",   "addr": "ул. Лермонтова, 83"},
    "В": {"name": "Вспомогательный корпус",  "addr": "ул. Лермонтова, 83"},
    "Г": {"name": "Главный корпус",          "addr": "ул. Лермонтова, 83"},
    "Д": {"name": "Д-корпус",                "addr": "ул. Лермонтова, 83"},
    "Е": {"name": "Е-корпус",                "addr": "ул. Лермонтова, 83"},
    "Ж": {"name": "Ж-корпус",                "addr": "ул. Лермонтова, 83"},
    "И": {"name": "Инженерный корпус",       "addr": "ул. Лермонтова, 83"},
    "К": {"name": "К-корпус",                "addr": "ул. Лермонтова, 83"},
    "Л": {"name": "Л-корпус",                "addr": "ул. Лермонтова, 83"},
    "М": {"name": "М-корпус",                "addr": "ул. Лермонтова, 83"},
    "Н": {"name": "Научный корпус",          "addr": "ул. Лермонтова, 83"},
    "ТП": {"name": "Технопарк",              "addr": "ул. Лермонтова, 83"},
}

TWOGIS_URL = "https://2gis.ru/irkutsk/search/ИРНИТУ"


# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ
# ============================================================
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


def _time_sort_key(t):
    m = re.match(r"(\d+):(\d+)", t)
    return (int(m.group(1)), int(m.group(2))) if m else (99, 99)


def _time_range(t):
    end = LESSON_TIMES.get(t)
    return f"{t} – {end}" if end else t


# ============================================================
# ПАРСИНГ
# ============================================================
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
                    lessons.append({
                        "time": time_str, "subject": subject, "type": lesson_type,
                        "teacher": teacher, "subgroup": subgroup, "auditorium": auditorium,
                    })
        days.append({"date": date_str, "name": day_name, "lessons": lessons})
    return week_parity, days


async def fetch_week_html(group_id, target_monday, use_cache=True):
    week_start_str = target_monday.strftime("%Y-%m-%d")
    if use_cache:
        cached = get_cached_schedule(group_id, week_start_str)
        if cached:
            logging.info(f"[CACHE] HIT {group_id} {week_start_str}")
            return cached
    date_str = target_monday.strftime("%d.%m.%Y")
    url = f"https://www.istu.edu/raspisanie/grup/{group_id}/{date_str}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                html = await response.text()
                logging.info(f"[WEEK] GET {url} -> {response.status}, len={len(html)}")
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


def format_day(day, user_id=None):
    lines = [f"📅 {day['name']}", ""]
    if not day["lessons"]:
        lines.append("🎉 Занятий нет!")
        lines.append("")
        return "\n".join(lines)

    by_time = {}
    for les in day["lessons"]:
        by_time.setdefault(les["time"], []).append(les)

    subjects_today = set()

    for time_str in sorted(by_time.keys(), key=_time_sort_key):
        lessons = by_time[time_str]
        for i, les in enumerate(lessons):
            subj = les["subject"] or "—"
            if les["type"]:
                subj += f" ({les['type']})"
            prefix = "⚠️ " if ("перенос" in subj.lower() or "перенес" in subj.lower()) else ""
            if i == 0:
                lines.append(f"🕐 {prefix}{_time_range(time_str)}")
                lines.append(f"  📖 {subj}")
            else:
                if les["subgroup"]:
                    lines.append(f"  👥 подгр. {les['subgroup']}: {subj}")
                else:
                    lines.append(f"  📖 {subj}")
            details = []
            if les["teacher"]:
                details.append(f"👤 {les['teacher']}")
            if les["auditorium"]:
                details.append(f"🚪 ауд. {les['auditorium']}")
            if les["subgroup"] and i == 0 and len(lessons) == 1:
                details.append(f"👥 подгр. {les['subgroup']}")
            if details:
                lines.append(f"  {'  '.join(details)}")
            if les["subject"]:
                subjects_today.add(les["subject"])
        lines.append("")

    if user_id and subjects_today:
        notes_lines = []
        for subj in sorted(subjects_today):
            note = get_note(user_id, subj)
            if note:
                notes_lines.append(f"📝 {subj}: {note}")
        if notes_lines:
            lines.append("— — —")
            lines.extend(notes_lines)

    return "\n".join(lines).rstrip() + "\n"


async def send_schedule_for_date(user_id, group_id, group_name, target_date, title):
    monday = _monday_of_week(target_date)
    html = await fetch_week_html(group_id, monday, use_cache=True)
    if not html:
        return
    _, days = parse_schedule(html)
    date_str = target_date.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == date_str), None)
    if day is None:
        text = f"{title}\n\n🎉 Занятий нет!"
    else:
        text = f"{title}\n\n" + format_day(day, user_id=user_id).strip()
    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"
    try:
        await bot.send_message(user_id, text)
    except Exception as e:
        logging.error(f"[NOTIFY] {user_id}: {e}")


# ============================================================
# КЛАВИАТУРЫ
# ============================================================
def get_main_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎓 Моя группа"), KeyboardButton(text="📅 Расписание")],
            [KeyboardButton(text="🔔 Уведомления"), KeyboardButton(text="📝 Задачи")],
            [KeyboardButton(text="🗒 Заметки"), KeyboardButton(text="🗺 Аудитория")],
            [KeyboardButton(text="📬 Обратная связь"), KeyboardButton(text="ℹ️ Помощь")],
        ],
        resize_keyboard=True,
    )


def get_institutes_keyboard():
    keys = list(GROUPS.keys())
    kb = []
    for i in range(0, len(keys), 2):
        row = [InlineKeyboardButton(text=keys[i], callback_data=f"institute_{keys[i]}")]
        if i + 1 < len(keys):
            row.append(InlineKeyboardButton(text=keys[i+1], callback_data=f"institute_{keys[i+1]}"))
        kb.append(row)
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_groups_keyboard(institute_name, page=0):
    groups = GROUPS.get(institute_name, [])
    per_page = 20
    total_pages = max(1, (len(groups) + per_page - 1) // per_page)
    page = max(0, min(page, total_pages - 1))
    chunk = groups[page * per_page: (page + 1) * per_page]
    kb = []
    for i in range(0, len(chunk), 2):
        row = [InlineKeyboardButton(text=chunk[i]["name"], callback_data=f"group_{chunk[i]['id']}")]
        if i + 1 < len(chunk):
            row.append(InlineKeyboardButton(text=chunk[i+1]["name"], callback_data=f"group_{chunk[i+1]['id']}"))
        kb.append(row)
    if total_pages > 1:
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton(text="<<", callback_data=f"instpage_{institute_name}_{page-1}"))
        nav.append(InlineKeyboardButton(text=f"{page+1}/{total_pages}", callback_data="noop"))
        if page < total_pages - 1:
            nav.append(InlineKeyboardButton(text=">>", callback_data=f"instpage_{institute_name}_{page+1}"))
        kb.append(nav)
    kb.append([InlineKeyboardButton(text="⬅️ Назад", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_schedule_actions_keyboard(group_id, is_my_group=False):
    buttons = [
        [InlineKeyboardButton(text="☀️ Сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="📅 Текущая неделя", callback_data=f"week_0_{group_id}")],
        [InlineKeyboardButton(text="📅 Следующая неделя", callback_data=f"week_1_{group_id}")],
        [InlineKeyboardButton(text="🔄 Обновить (без кэша)", callback_data=f"refresh_{group_id}")],
    ]
    if is_my_group:
        buttons.append([InlineKeyboardButton(text="❌ Забыть группу", callback_data="forget_my")])
    else:
        buttons.append([InlineKeyboardButton(text="⭐ Сделать моей группой", callback_data=f"save_my_{group_id}")])
    buttons.append([InlineKeyboardButton(text="⬅️ Назад", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def get_notify_keyboard(current=None, changes_on=False):
    buttons = []
    for label, h, m in NOTIFY_PRESETS:
        mark = " ✅" if current and current[0] == h and current[1] == m else ""
        buttons.append([InlineKeyboardButton(text=f"{label}{mark}", callback_data=f"notify_{h}_{m}")])
    buttons.append([InlineKeyboardButton(text="🔕 Выключить", callback_data="notify_off")])
    changes_mark = " ✅ вкл" if changes_on else " выкл"
    buttons.append([InlineKeyboardButton(text=f"🔔 Следить за изменениями:{changes_mark}",
                                          callback_data="changes_toggle")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def get_tasks_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Добавить задачу", callback_data="task_add")],
        [InlineKeyboardButton(text="📋 Мои задачи", callback_data="task_list")],
        [InlineKeyboardButton(text="🗑 Очистить выполненные", callback_data="task_clear")],
    ])


def get_notes_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Добавить/изменить заметку", callback_data="note_add")],
        [InlineKeyboardButton(text="📋 Мои заметки", callback_data="note_list")],
    ])


# ============================================================
# БАЗОВЫЕ ХЕНДЛЕРЫ
# ============================================================
@dp.message(CommandStart())
async def start(message: Message):
    _ensure_user(message.from_user.id)
    saved = get_user_group(message.from_user.id)
    hint = f"\n\n🎓 Твоя группа: {saved[1]}" if saved else \
           "\n\n💡 Совет: выбери группу через «📅 Расписание» и нажми «⭐ Сделать моей группой»."
    await message.answer(
        f"👋 Привет, {message.from_user.full_name}!\n\n"
        "Я бот для студентов ИРНИТУ." + hint,
        reply_markup=get_main_keyboard(),
    )


@dp.message(Command("myid"))
async def cmd_myid(message: Message):
    await message.answer(f"🆔 Твой Telegram ID: {message.from_user.id}")


@dp.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext):
    current = await state.get_state()
    if current is None:
        await message.answer("Нечего отменять.", reply_markup=get_main_keyboard())
        return
    await state.clear()
    await message.answer("Отменено.", reply_markup=get_main_keyboard())


# ============================================================
# АДМИН-КОМАНДЫ
# ============================================================
@dp.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Команда только для администратора.")
        return
    await message.answer(
        "👑 Админ-команды\n\n"
        "🆔 /myid — твой Telegram ID\n"
        "📊 /stats — статистика\n"
        "📤 /broadcast Текст — рассылка\n"
        "💾 /backup — резервная копия\n"
        "📥 /restore — восстановить из файла\n"
        "📬 /feedback_list — обращения\n"
        "🧹 /clearcache — очистить кэш\n"
        "🔔 /checknow — проверить изменения\n"
        "📡 /monitor — статус сайта ИРНИТУ\n"
        "👑 /admin — этот список"
    )


@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Команда только для администратора.")
        return
    s = get_stats()
    await message.answer(
        f"📊 Статистика:\n\n"
        f"👥 Всего: {s[0]}\n"
        f"🎓 С группой: {s[1]}\n"
        f"🔔 С уведомлениями: {s[2]}\n"
        f"🔔 Следят за изменениями: {s[3]}\n"
        f"💾 В кэше: {s[4]}\n"
        f"📬 Обращений: {s[5]}\n"
        f"📝 Активных задач: {s[6]}\n"
        f"🗒 Заметок: {s[7]}"
    )


@dp.message(Command("broadcast"))
async def cmd_broadcast(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    text = message.text.replace("/broadcast", "", 1).strip()
    if not text:
        await message.answer("Использование: /broadcast Текст")
        return
    user_ids = get_all_user_ids()
    if not user_ids:
        await message.answer("В базе нет пользователей.")
        return
    status = await message.answer(f"📤 Отправляю {len(user_ids)}...")
    sent = failed = 0
    for uid in user_ids:
        try:
            await bot.send_message(uid, text)
            sent += 1
        except Exception:
            failed += 1
        await asyncio.sleep(0.05)
    await status.edit_text(f"✅ Отправлено: {sent}\n❌ Не доставлено: {failed}")


@dp.message(Command("backup"))
async def cmd_backup(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    try:
        s = get_stats()
        doc = FSInputFile(DB_PATH, filename="users_backup.db")
        await message.answer_document(doc, caption=(
            f"💾 Резервная копия\n👥 {s[0]} | 🎓 {s[1]} | 🔔 {s[2]} | "
            f"📝 {s[6]} задач | 🗒 {s[7]} заметок"))
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
        s = get_stats()
        await message.answer(f"✅ База восстановлена. Всего: {s[0]}")
    except Exception as e:
        await message.answer(f"Ошибка: {e}")


@dp.message(Command("feedback_list"))
async def cmd_feedback_list(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    rows = get_all_feedback(20)
    if not rows:
        await message.answer("Обращений пока нет.")
        return
    lines = ["📬 Последние обращения:\n"]
    for fid, uid, uname, text, created in rows:
        lines.append(f"#{fid} | {uname or uid}\n{text[:200]}\n")
    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:4000] + "\n…"
    await message.answer(text)


@dp.message(Command("clearcache"))
async def cmd_clearcache(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM schedule_cache")
    conn.commit(); conn.close()
    await message.answer("🧹 Кэш очищен.")


@dp.message(Command("checknow"))
async def cmd_checknow(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    await message.answer("🔔 Запускаю проверку изменений...")
    await check_schedule_changes()
    await message.answer("Готово.")


@dp.message(Command("monitor"))
async def cmd_monitor(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    check_url = "https://www.istu.edu/raspisanie/"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(check_url, timeout=aiohttp.ClientTimeout(total=15),
                                   headers={"User-Agent": "Mozilla/5.0"}) as response:
                if response.status == 200:
                    await message.answer(f"📡 Сайт ИРНИТУ: ✅ отвечает (HTTP {response.status})")
                else:
                    await message.answer(f"📡 Сайт ИРНИТУ: ⚠️ HTTP {response.status}")
    except Exception as e:
        await message.answer(f"📡 Сайт ИРНИТУ: 🚨 не отвечает.\n\n{e}")


# ============================================================
# РАСПИСАНИЕ
# ============================================================
@dp.message(F.text == "📅 Расписание")
async def show_institutes(message: Message):
    await message.answer("Выбери институт:", reply_markup=get_institutes_keyboard())


@dp.message(F.text == "🎓 Моя группа")
async def show_my_group(message: Message):
    saved = get_user_group(message.from_user.id)
    if not saved:
        await message.answer("У тебя нет сохранённой группы. Выбери её через «📅 Расписание».",
                             reply_markup=get_main_keyboard())
        return
    group_id, group_name = saved
    await message.answer(f"🎓 Моя группа: {group_name}\n\nЧто показать?",
                         reply_markup=get_schedule_actions_keyboard(group_id, is_my_group=True))


@dp.callback_query(F.data.startswith("institute_"))
async def process_institute(callback: CallbackQuery):
    name = callback.data.split("_", 1)[1]
    await callback.message.edit_text(f"Институт: {name}\n\nВыбери группу:",
                                     reply_markup=get_groups_keyboard(name, 0))
    await callback.answer()


@dp.callback_query(F.data.startswith("instpage_"))
async def process_page(callback: CallbackQuery):
    parts = callback.data.split("_", 2)
    await callback.message.edit_text(f"Институт: {parts[1]}\n\nВыбери группу:",
                                     reply_markup=get_groups_keyboard(parts[1], int(parts[2])))
    await callback.answer()


@dp.callback_query(F.data == "noop")
async def noop(callback: CallbackQuery):
    await callback.answer()


@dp.callback_query(F.data.startswith("group_"))
async def process_group(callback: CallbackQuery):
    gid = callback.data.split("_", 1)[1]
    gname = _group_name_by_id(gid)
    saved = get_user_group(callback.from_user.id)
    is_my = saved is not None and saved[0] == gid
    await callback.message.edit_text(f"Группа: {gname}\n\nЧто показать?",
                                     reply_markup=get_schedule_actions_keyboard(gid, is_my_group=is_my))
    await callback.answer()


@dp.callback_query(F.data.startswith("save_my_"))
async def save_my_group(callback: CallbackQuery):
    gid = callback.data.split("_", 2)[2]
    gname = _group_name_by_id(gid)
    save_user_group(callback.from_user.id, gid, gname)
    await callback.message.edit_text(
        f"⭐ Группа {gname} сохранена как твоя.\n\n"
        f"Теперь в меню есть «🎓 Моя группа» и «🔔 Уведомления».",
        reply_markup=get_schedule_actions_keyboard(gid, is_my_group=True))
    await callback.answer("Сохранено")


@dp.callback_query(F.data == "forget_my")
async def forget_my_group(callback: CallbackQuery):
    delete_user_group(callback.from_user.id)
    await callback.message.edit_text("❌ Группа удалена. Уведомления отключены.")
    await callback.answer("Удалено")


@dp.callback_query(F.data == "back_to_institutes")
async def back_to_institutes(callback: CallbackQuery):
    await callback.message.edit_text("Выбери институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("today_"))
async def show_today(callback: CallbackQuery):
    gid = callback.data.split("_", 1)[1]
    await callback.message.edit_text("⏳ Загружаю...")
    today = _now_irkutsk()
    monday = _monday_of_week(today)
    try:
        html = await fetch_week_html(gid, monday)
        soup = BeautifulSoup(html, "html.parser")
        start, end = parse_week_range(soup)
        _, days = parse_schedule(html)
    except Exception as e:
        await callback.message.edit_text(f"Ошибка: {e}")
        await callback.answer(); return
    today_str = today.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)
    header = f"☀️ Сегодня {today_str}"
    if start and end:
        header += f"\n🗓 неделя {start} – {end}"
    text = f"{header}\n\n" + (format_day(day, user_id=callback.from_user.id).strip() if day else "🎉 Занятий нет!")
    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"
    await callback.message.edit_text(text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{gid}")]
        ]))
    await callback.answer()


@dp.callback_query(F.data.startswith("refresh_"))
async def refresh_schedule(callback: CallbackQuery):
    gid = callback.data.split("_", 1)[1]
    await callback.message.edit_text("🔄 Обновляю...")
    today = _now_irkutsk()
    monday = _monday_of_week(today)
    html = await fetch_week_html(gid, monday, use_cache=False)
    if not html:
        await callback.message.edit_text("⚠️ Не удалось обновить.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{gid}")]
            ]))
        await callback.answer(); return
    _, days = parse_schedule(html)
    save_snapshot(gid, monday.strftime("%Y-%m-%d"), build_snapshot(days))
    soup = BeautifulSoup(html, "html.parser")
    start, end = parse_week_range(soup)
    today_str = today.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)
    header = f"☀️ Сегодня {today_str}"
    if start and end:
        header += f"\n🗓 неделя {start} – {end}"
    text = f"{header}\n\n" + (format_day(day, user_id=callback.from_user.id).strip() if day else "🎉 Занятий нет!")
    await callback.message.edit_text(text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{gid}")]
        ]))
    await callback.answer("Обновлено")


@dp.callback_query(F.data.startswith("week_"))
async def show_week(callback: CallbackQuery):
    parts = callback.data.split("_", 2)
    offset = int(parts[1])
    gid = parts[2]
    gname = _group_name_by_id(gid)
    await callback.message.edit_text("⏳ Загружаю...")
    today = _now_irkutsk()
    target_monday = _monday_of_week(today) + timedelta(days=7 * offset)
    try:
        html = await fetch_week_html(gid, target_monday)
        soup = BeautifulSoup(html, "html.parser")
        start, end = parse_week_range(soup)
        _, days = parse_schedule(html)
    except Exception as e:
        await callback.message.edit_text(f"Ошибка: {e}")
        await callback.answer(); return
    title = "📅 Текущая неделя" if offset == 0 else "📅 Следующая неделя"
    header = f"{title}\n🎓 Группа: {gname}"
    if start and end:
        header += f"\n🗓 {start} – {end}"
    text = header + "\n\n" + ("\n".join(format_day(d, user_id=callback.from_user.id) for d in days) if days else "Расписание не найдено.")
    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"
    await callback.message.edit_text(text.strip(),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{gid}")]
        ]))
    await callback.answer()


# ============================================================
# УВЕДОМЛЕНИЯ
# ============================================================
@dp.message(F.text == "🔔 Уведомления")
async def notifications_menu(message: Message):
    saved = get_user_group(message.from_user.id)
    if not saved:
        await message.answer("Сначала сохрани группу (через «📅 Расписание»).",
                             reply_markup=get_main_keyboard())
        return
    current = get_notify_time(message.from_user.id)
    changes = get_notify_changes(message.from_user.id)
    if current:
        h, m = current
        when = "на сегодня" if h < 12 else "на завтра"
        status = f"🔔 Расписание в {h:02d}:{m:02d} ({when})."
    else:
        status = "🔕 Уведомления по времени выключены."
    ch_status = "🔔 Слежение за изменениями включено." if changes else "🔕 Слежение за изменениями выключено."
    await message.answer(
        f"{status}\n{ch_status}\n\n"
        "☀️ Утро (7:00, 8:00) — расписание на СЕГОДНЯ.\n"
        "🌙 Вечер (19:00–22:00) — расписание на ЗАВТРА.\n\n"
        "🔔 «Следить за изменениями» — бот пришлёт уведомление, если пары перенесли.",
        reply_markup=get_notify_keyboard(current, changes))


@dp.callback_query(F.data.startswith("notify_"))
async def process_notify(callback: CallbackQuery):
    if callback.data == "notify_off":
        set_notify_time(callback.from_user.id, -1, 0)
        current = get_notify_time(callback.from_user.id)
        changes = get_notify_changes(callback.from_user.id)
        await callback.message.edit_text("🔕 Уведомления по времени выключены.",
            reply_markup=get_notify_keyboard(current, changes))
        await callback.answer("Выключено")
        return
    parts = callback.data.split("_")
    h, m = int(parts[1]), int(parts[2])
    set_notify_time(callback.from_user.id, h, m)
    current = get_notify_time(callback.from_user.id)
    changes = get_notify_changes(callback.from_user.id)
    if h < 12:
        text = f"✅ Расписание в {h:02d}:{m:02d} — на СЕГОДНЯ."
    else:
        text = f"✅ Расписание в {h:02d}:{m:02d} — на ЗАВТРА."
    await callback.message.edit_text(text, reply_markup=get_notify_keyboard(current, changes))
    await callback.answer("Сохранено")


@dp.callback_query(F.data == "changes_toggle")
async def toggle_changes(callback: CallbackQuery):
    current = get_notify_changes(callback.from_user.id)
    set_notify_changes(callback.from_user.id, not current)
    current_time = get_notify_time(callback.from_user.id)
    new_state = not current
    if new_state:
        text = "🔔 Слежение за изменениями ВКЛЮЧЕНО. Буду сообщать, если пары перенесли."
    else:
        text = "🔕 Слежение за изменениями выключено."
    await callback.message.edit_text(text, reply_markup=get_notify_keyboard(current_time, new_state))
    await callback.answer("Сохранено")


# ============================================================
# ЗАДАЧИ
# ============================================================
@dp.message(F.text == "📝 Задачи")
async def tasks_menu(message: Message):
    await message.answer(
        "📝 Личные задачи\n\n"
        "Добавляй, отмечай выполненные, удаляй.\n"
        "Можно указать срок: `Сдать курсовую | 25.10.2026`",
        reply_markup=get_tasks_keyboard(),
        parse_mode="Markdown")


@dp.callback_query(F.data == "task_add")
async def task_add_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text(
        "✏️ Напиши текст задачи.\n\n"
        "Можно добавить срок в формате:\n"
        "`Текст задачи | 25.10.2026`\n\n"
        "Для отмены — /cancel.",
        parse_mode="Markdown")
    await state.set_state(TaskState.waiting_text)
    await callback.answer()


@dp.message(TaskState.waiting_text)
async def task_add_text(message: Message, state: FSMContext):
    raw = (message.text or "").strip()
    if not raw:
        await message.answer("Пусто. Напиши текст задачи.")
        return
    due = None
    text = raw
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|", 1)]
        text = parts[0]
        due = parts[1] if len(parts) > 1 else None
        if due:
            try:
                datetime.strptime(due, "%d.%m.%Y")
            except ValueError:
                await message.answer("⚠️ Дата в формате ДД.ММ.ГГГГ. Попробуй снова или /cancel.")
                return
    tid = add_task(message.from_user.id, text, due)
    due_info = f" (до {due})" if due else ""
    await state.clear()
    await message.answer(f"✅ Задача #{tid} добавлена{due_info}.\n\n{text}",
                         reply_markup=get_main_keyboard())


def _tasks_view(user_id):
    tasks = get_user_tasks(user_id, only_active=True)
    if not tasks:
        return "📋 У тебя нет активных задач.", get_tasks_keyboard()
    kb = []
    lines = ["📋 Твои задачи:\n"]
    for tid, text, due, done in tasks:
        due_str = f" (до {due})" if due else ""
        lines.append(f"#{tid} {text}{due_str}")
        kb.append([
            InlineKeyboardButton(text=f"✅ #{tid}", callback_data=f"task_done_{tid}"),
            InlineKeyboardButton(text=f"❌ #{tid}", callback_data=f"task_del_{tid}"),
        ])
    kb.append([InlineKeyboardButton(text="⬅️ Назад", callback_data="task_back")])
    return "\n".join(lines), InlineKeyboardMarkup(inline_keyboard=kb)


@dp.callback_query(F.data == "task_list")
async def task_list(callback: CallbackQuery):
    text, kb = _tasks_view(callback.from_user.id)
    await callback.message.edit_text(text, reply_markup=kb)
    await callback.answer()


@dp.callback_query(F.data == "task_back")
async def task_back(callback: CallbackQuery):
    await callback.message.edit_text("📝 Личные задачи", reply_markup=get_tasks_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("task_done_"))
async def task_done(callback: CallbackQuery):
    tid = int(callback.data.split("_", 2)[2])
    mark_task_done(tid, callback.from_user.id)
    await callback.answer("✅ Выполнено")
    text, kb = _tasks_view(callback.from_user.id)
    await callback.message.edit_text(text, reply_markup=kb)


@dp.callback_query(F.data.startswith("task_del_"))
async def task_del(callback: CallbackQuery):
    tid = int(callback.data.split("_", 2)[2])
    delete_task(tid, callback.from_user.id)
    await callback.answer("❌ Удалено")
    text, kb = _tasks_view(callback.from_user.id)
    await callback.message.edit_text(text, reply_markup=kb)


@dp.callback_query(F.data == "task_clear")
async def task_clear(callback: CallbackQuery):
    clear_done_tasks(callback.from_user.id)
    await callback.message.edit_text("🗑 Выполненные задачи удалены.",
        reply_markup=get_tasks_keyboard())
    await callback.answer("Очищено")


# ============================================================
# ЗАМЕТКИ
# ============================================================
@dp.message(F.text == "🗒 Заметки")
async def notes_menu(message: Message):
    notes = get_user_notes(message.from_user.id)
    if not notes:
        text = ("🗒 Заметки к предметам\n\n"
                "Заметка привязывается к названию предмета и показывается под расписанием дня, "
                "если этот предмет есть в этот день.\n\n"
                "У тебя пока нет заметок.")
    else:
        lines = ["🗒 Твои заметки:\n"]
        for nid, subj, text_note in notes:
            lines.append(f"• {subj}: {text_note}")
        text = "\n".join(lines)
        if len(text) > 4000:
            text = text[:4000] + "\n…"
    await message.answer(text, reply_markup=get_notes_keyboard())


@dp.callback_query(F.data == "note_add")
async def note_add_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text(
        "✏️ Напиши название предмета (как в расписании).\n\n"
        "Например: `Математика` или `Иностранный язык`.\n\n"
        "Для отмены — /cancel.",
        parse_mode="Markdown")
    await state.set_state(NoteState.waiting_subject)
    await callback.answer()


@dp.message(NoteState.waiting_subject)
async def note_subject(message: Message, state: FSMContext):
    subj = (message.text or "").strip()
    if not subj:
        await message.answer("Пусто. Напиши название предмета.")
        return
    await state.update_data(subject=subj)
    existing = get_note(message.from_user.id, subj)
    if existing:
        await message.answer(f"У тебя уже есть заметка к «{subj}»:\n\n{existing}\n\nНапиши новый текст для замены.")
    else:
        await message.answer(f"✏️ Теперь напиши текст заметки к «{subj}».")
    await state.set_state(NoteState.waiting_text)


@dp.message(NoteState.waiting_text)
async def note_text(message: Message, state: FSMContext):
    text = (message.text or "").strip()
    if not text:
        await message.answer("Пусто. Напиши текст заметки.")
        return
    data = await state.get_data()
    subj = data.get("subject", "")
    if not subj:
        await state.clear()
        await message.answer("Что-то пошло не так. Начни заново.",
            reply_markup=get_main_keyboard())
        return
    add_or_update_note(message.from_user.id, subj, text)
    await state.clear()
    await message.answer(
        f"✅ Заметка к «{subj}» сохранена.\n\n"
        f"Она будет показываться под расписанием дня, если этот предмет есть в этот день.",
        reply_markup=get_main_keyboard())


@dp.callback_query(F.data == "note_list")
async def note_list(callback: CallbackQuery):
    notes = get_user_notes(callback.from_user.id)
    if not notes:
        await callback.message.edit_text("🗒 У тебя нет заметок.", reply_markup=get_notes_keyboard())
        await callback.answer(); return
    lines = ["🗒 Твои заметки:\n"]
    for nid, subj, text_note in notes:
        lines.append(f"• {subj}: {text_note}")
    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:4000] + "\n…"
    await callback.message.edit_text(text, reply_markup=get_notes_keyboard())
    await callback.answer()


# ============================================================
# АУДИТОРИИ
# ============================================================
@dp.message(F.text == "🗺 Аудитория")
async def ask_auditorium(message: Message, state: FSMContext):
    await message.answer(
        "🗺 Напиши номер аудитории — покажу, в каком это корпусе.\n\n"
        "Например: `Б-307`, `И-319`, `К-104`.\n\n"
        "Для отмены — /cancel.",
        parse_mode="Markdown")
    await state.set_state(AuditoriumState.waiting_code)


@dp.message(AuditoriumState.waiting_code)
async def process_auditorium(message: Message, state: FSMContext):
    raw = (message.text or "").strip().upper()
    if not raw:
        await message.answer("Пусто. Напиши номер аудитории.")
        return
    m = re.match(r"^([А-ЯЁ]+)[\-\s]?(\d+.*)$", raw)
    if not m:
        await message.answer("⚠️ Не понял номер. Формат: `Б-307` или `И-319`.",
            parse_mode="Markdown")
        return
    building_code = m.group(1)
    room_number = m.group(2)

    building = None
    if building_code.startswith("ТП"):
        building = BUILDINGS["ТП"]
        building_code = "ТП"
    else:
        building = BUILDINGS.get(building_code[:1])

    lines = [f"🚪 Аудитория: {building_code}-{room_number}", ""]
    if building:
        lines.append(f"🏛 Корпус: {building['name']}")
        lines.append(f"📍 Адрес: {building['addr']}")
    else:
        lines.append(f"🏛 Корпус: {building_code} (неизвестный)")
        lines.append("📍 Адрес: уточни в расписании")
    lines.append("")
    lines.append("🗺 Открыть карту ИРНИТУ в 2ГИС:")
    lines.append(TWOGIS_URL)

    await state.clear()
    await message.answer("\n".join(lines),
        reply_markup=get_main_keyboard(),
        disable_web_page_preview=True)


# ============================================================
# ОБРАТНАЯ СВЯЗЬ
# ============================================================
@dp.message(F.text == "📬 Обратная связь")
async def feedback_start(message: Message, state: FSMContext):
    await message.answer(
        "📬 Напиши своё сообщение — предложение, баг или идею.\n\n"
        "Оно уйдёт администратору. Если он ответит, ты получишь ответ здесь.\n\n"
        "Чтобы отменить — /cancel.")
    await state.set_state(FeedbackState.waiting_message)


@dp.message(FeedbackState.waiting_message)
async def feedback_receive(message: Message, state: FSMContext):
    text = (message.text or "").strip()
    if not text:
        await message.answer("Пустое сообщение не отправлю.")
        return
    if len(text) > 2000:
        text = text[:2000] + "…"
    user = message.from_user
    uname = f"@{user.username}" if user.username else user.full_name
    feedback_id = save_feedback(user.id, uname, text)
    try:
        admin_msg = await bot.send_message(
            ADMIN_ID,
            f"📬 Обращение #{feedback_id}\nОт: {uname} (ID: {user.id})\n\n{text}\n\n"
            f"↩️ Ответь на это сообщение, чтобы ответить.")
        update_feedback_admin_msg(feedback_id, admin_msg.message_id)
        await message.answer("✅ Спасибо! Сообщение отправлено.",
            reply_markup=get_main_keyboard())
    except Exception as e:
        logging.error(f"[FEEDBACK] {e}")
        await message.answer("⚠️ Не удалось отправить.")
    await state.clear()


@dp.message(F.reply_to_message)
async def admin_reply_to_feedback(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    row = get_feedback_by_admin_msg(message.reply_to_message.message_id)
    if not row:
        return
    fid, user_id = row
    try:
        await bot.send_message(user_id, f"💬 Ответ администратора на обращение #{fid}:\n\n{message.text}")
        await message.answer("✅ Отправлено пользователю.")
    except Exception as e:
        await message.answer(f"⚠️ {e}")


# ============================================================
# ПОМОЩЬ
# ============================================================
@dp.message(F.text == "ℹ️ Помощь")
async def help_cmd(message: Message):
    await message.answer(
        "ℹ️ Что я умею:\n\n"
        "📅 Расписание по всем институтам ИРНИТУ\n"
        "🎓 Моя группа — быстрое расписание\n"
        "🔔 Уведомления:\n"
        "    ☀️ утром — расписание на сегодня\n"
        "    🌙 вечером — расписание на завтра\n"
        "    🔔 следить за изменениями (переносы, замены)\n"
        "📝 Личные задачи с напоминаниями\n"
        "🗒 Заметки к предметам (показываются в расписании дня)\n"
        "🗺 Поиск аудитории по номеру (Б-307, И-319 и т.д.)\n"
        "📬 Обратная связь администратору\n\n"
        "Просто нажимай кнопки.",
        reply_markup=get_main_keyboard())


# ============================================================
# ФОНОВЫЕ ЗАДАЧИ
# ============================================================
async def notification_loop():
    last_sent_key = None
    while True:
        try:
            now = _now_irkutsk()
            current_key = now.strftime("%Y-%m-%d %H:%M")
            if current_key != last_sent_key:
                users = get_users_to_notify(now.hour, now.minute)
                if users:
                    logging.info(f"[NOTIFY] {now.hour:02d}:{now.minute:02d}, {len(users)}")
                    if now.hour < 12:
                        target = now
                        title_tpl = "☀️ Расписание на сегодня\n🎓 Группа: {}"
                    else:
                        target = now + timedelta(days=1)
                        title_tpl = "🌙 Расписание на завтра\n🎓 Группа: {}"
                    for user_id, group_id, group_name in users:
                        try:
                            await send_schedule_for_date(user_id, group_id, group_name, target,
                                                          title_tpl.format(group_name))
                        except Exception as e:
                            logging.error(f"[NOTIFY] {user_id}: {e}")
                last_sent_key = current_key
        except Exception as e:
            logging.exception(f"[NOTIFY] {e}")
        await asyncio.sleep(30)


async def task_reminder_loop():
    sent_keys = set()
    while True:
        try:
            now = _now_irkutsk()
            today = now.strftime("%d.%m.%Y")
            tomorrow = (now + timedelta(days=1)).strftime("%d.%m.%Y")
            rows = get_tasks_with_due()
            for user_id, task_id, text, due in rows:
                for target_date, label in ((tomorrow, "завтра"), (today, "сегодня")):
                    if due == target_date:
                        key = f"{user_id}:{task_id}:{due}:{label}"
                        if key in sent_keys:
                            continue
                        if label == "завтра" and not (now.hour == 20 and now.minute < 10):
                            continue
                        if label == "сегодня" and not (now.hour == 8 and now.minute < 10):
                            continue
                        try:
                            await bot.send_message(
                                user_id,
                                f"📝 Напоминание о задаче:\n\n#{task_id} {text}\nСрок: {due} ({label})")
                            sent_keys.add(key)
                        except Exception as e:
                            logging.error(f"[TASK] {user_id}: {e}")
        except Exception as e:
            logging.exception(f"[TASK] {e}")
        await asyncio.sleep(600)


async def cache_cleanup_loop():
    while True:
        try:
            clear_old_cache()
            logging.info("[CACHE] Очистка выполнена")
        except Exception as e:
            logging.error(f"[CACHE] {e}")
        await asyncio.sleep(24 * 60 * 60)


async def check_schedule_changes():
    subscribers = get_changes_subscribers()
    if not subscribers:
        return
    now = _now_irkutsk()
    monday = _monday_of_week(now)
    week_start = monday.strftime("%Y-%m-%d")

    for group_id, users in subscribers.items():
        try:
            html = await fetch_week_html(group_id, monday, use_cache=False)
            if not html:
                continue
            _, days = parse_schedule(html)
            new_snapshot = build_snapshot(days)
            old_snapshot = get_snapshot(group_id, week_start)

            if old_snapshot is None:
                save_snapshot(group_id, week_start, new_snapshot)
                continue

            if new_snapshot != old_snapshot:
                old_lines = set(old_snapshot.split("\n"))
                new_lines = set(new_snapshot.split("\n"))
                added = new_lines - old_lines
                removed = old_lines - new_lines

                diff_lines = []
                for line in list(added)[:5]:
                    parts = line.split("|")
                    if len(parts) >= 3:
                        diff_lines.append(f"➕ {parts[0]} {parts[1]}: {parts[2]}")
                for line in list(removed)[:5]:
                    parts = line.split("|")
                    if len(parts) >= 3:
                        diff_lines.append(f"➖ {parts[0]} {parts[1]}: {parts[2]}")
                diff_text = "\n".join(diff_lines) if diff_lines else "Изменения в расписании."

                for user_id, group_name in users:
                    try:
                        await bot.send_message(
                            user_id,
                            f"🔔 Изменения в расписании!\n"
                            f"🎓 Группа: {group_name}\n"
                            f"🗓 Неделя с {monday.strftime('%d.%m.%Y')}\n\n"
                            f"{diff_text}\n\n"
                            f"Открой «🎓 Моя группа», чтобы посмотреть подробнее.")
                    except Exception as e:
                        logging.error(f"[CHANGES] {user_id}: {e}")

                save_snapshot(group_id, week_start, new_snapshot)
                logging.info(f"[CHANGES] {group_id}: изменения, уведомлено {len(users)}")
        except Exception as e:
            logging.error(f"[CHANGES] {group_id}: {e}")
        await asyncio.sleep(1)


async def changes_loop():
    await asyncio.sleep(120)
    while True:
        try:
            await check_schedule_changes()
        except Exception as e:
            logging.exception(f"[CHANGES] {e}")
        await asyncio.sleep(CHANGES_CHECK_INTERVAL_MIN * 60)


async def monitor_loop():
    failures = 0
    alerted = False
    check_url = "https://www.istu.edu/raspisanie/"
    while True:
        try:
            ok = False
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(check_url,
                                           timeout=aiohttp.ClientTimeout(total=15),
                                           headers={"User-Agent": "Mozilla/5.0"}) as response:
                        ok = (response.status == 200)
            except Exception as e:
                logging.warning(f"[MONITOR] {e}")
                ok = False
            if ok:
                if alerted:
                    try:
                        await bot.send_message(ADMIN_ID, "✅ Сайт ИРНИТУ снова отвечает.")
                    except Exception:
                        pass
                    alerted = False
                failures = 0
            else:
                failures += 1
                logging.warning(f"[MONITOR] Провал #{failures}")
                if failures >= 3 and not alerted:
                    try:
                        await bot.send_message(
                            ADMIN_ID,
                            "🚨 Сайт ИРНИТУ не отвечает уже 3 проверки подряд.\n\n"
                            "Проверь: " + check_url)
                        alerted = True
                    except Exception as e:
                        logging.error(f"[MONITOR] {e}")
        except Exception as e:
            logging.exception(f"[MONITOR] {e}")
        await asyncio.sleep(5 * 60)


# ============================================================
# ЗАПУСК
# ============================================================
async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        stream=sys.stdout,
        force=True,
    )
    init_db()
    await bot.delete_webhook(drop_pending_updates=True)
    logging.info("Webhook удалён, запускаю polling")
    asyncio.create_task(notification_loop())
    asyncio.create_task(task_reminder_loop())
    asyncio.create_task(cache_cleanup_loop())
    asyncio.create_task(changes_loop())
    asyncio.create_task(monitor_loop())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
