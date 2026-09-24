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
from aiogram.types import (
    Message, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
)

# ============================================================
# НАСТРОЙКИ
# ============================================================
TOKEN = "8953672814:AAG4cxGgLJRVv-EXzDip6cT7u6NO7vez18E"
ADMIN_ID = 0  # ← ВСТАВЬ СВОЙ TELEGRAM ID (узнать через /myid в боте)
bot = Bot(token=TOKEN)
dp = Dispatcher()

DB_PATH = "users.db"

# Время для уведомлений (час:минута)
NOTIFY_PRESETS = [
    ("7:00",  7, 0),
    ("8:00",  8, 0),
    ("19:00", 19, 0),
    ("20:00", 20, 0),
    ("21:00", 21, 0),
    ("22:00", 22, 0),
]


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
            notify_minute INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()


def _ensure_user(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    conn.commit()
    conn.close()


def save_user_group(user_id: int, group_id: str, group_name: str):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE users SET group_id=?, group_name=? WHERE user_id=?",
        (group_id, group_name, user_id),
    )
    conn.commit()
    conn.close()


def get_user_group(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT group_id, group_name FROM users WHERE user_id=?",
        (user_id,),
    ).fetchone()
    conn.close()
    if row and row[0]:
        return row
    return None


def delete_user_group(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE users SET group_id=NULL, group_name=NULL, notify_hour=-1 WHERE user_id=?",
        (user_id,),
    )
    conn.commit()
    conn.close()


def set_notify_time(user_id: int, hour: int, minute: int):
    _ensure_user(user_id)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE users SET notify_hour=?, notify_minute=? WHERE user_id=?",
        (hour, minute, user_id),
    )
    conn.commit()
    conn.close()


def get_notify_time(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT notify_hour, notify_minute FROM users WHERE user_id=?",
        (user_id,),
    ).fetchone()
    conn.close()
    if row and row[0] is not None and row[0] >= 0:
        return row
    return None


def get_users_to_notify(hour: int, minute: int):
    """Возвращает [(user_id, group_id, group_name), ...] для отправки уведомлений."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT user_id, group_id, group_name FROM users "
        "WHERE notify_hour=? AND notify_minute=? AND group_id IS NOT NULL",
        (hour, minute),
    ).fetchall()
    conn.close()
    return rows


def get_stats():
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    with_group = conn.execute(
        "SELECT COUNT(*) FROM users WHERE group_id IS NOT NULL"
    ).fetchone()[0]
    with_notify = conn.execute(
        "SELECT COUNT(*) FROM users WHERE notify_hour >= 0 AND group_id IS NOT NULL"
    ).fetchone()[0]
    conn.close()
    return total, with_group, with_notify


# ============================================================
# ГРУППЫ ПО ИНСТИТУТАМ
# ============================================================
GROUPS = {
    "ИАМиТ": [
        {"name": "АСПм-26-1",  "id": "478012"},
        {"name": "АТПРб-26-1", "id": "478049"},
        {"name": "ЛИМб-26-1",  "id": "478284"},
        {"name": "МИРб-26-1",  "id": "478310"},
        {"name": "ММб-26-1",   "id": "478314"},
        {"name": "МТб-26-1",   "id": "478318"},
        {"name": "ППТм-26-1",  "id": "478441"},
        {"name": "СДМ-26-1",   "id": "478478"},
        {"name": "СМ-26-1",    "id": "478493"},
        {"name": "СМ-26-2",    "id": "478494"},
        {"name": "СМ-26-3",    "id": "479896"},
        {"name": "ТЭАм-26-1",  "id": "478548"},
        {"name": "УКб-26-1",   "id": "478551"},
        {"name": "ЦПКм-26-1",  "id": "478601"},
        {"name": "ЭЛб-26-1",   "id": "478640"},
    ],
    "Аспирантура": [
        {"name": "аАУП-26-1",   "id": "477932"},
        {"name": "аБЗТ-26-1",   "id": "477934"},
        {"name": "аБПП-26-1",   "id": "477936"},
        {"name": "аБТХ-26-1",   "id": "477937"},
        {"name": "аВДС-26-1",   "id": "477939"},
        {"name": "аГГ-26-1",    "id": "477940"},
        {"name": "аГГМ-26-1",   "id": "477942"},
        {"name": "аГНГ-26-1",   "id": "477946"},
        {"name": "аГНП-26-1",   "id": "477948"},
        {"name": "аДВЛ-26-1",   "id": "477955"},
        {"name": "аМВ-26-1",    "id": "477977"},
        {"name": "аМЕТ-26-1",   "id": "477979"},
        {"name": "аММП-26-1",   "id": "479885"},
        {"name": "аМН-26-1",    "id": "477982"},
        {"name": "аНСкгм-26-1", "id": "477987"},
        {"name": "аНСдсм-26-1", "id": "477986"},
        {"name": "аОБП-26-1",   "id": "477989"},
        {"name": "аОХМ-26-1",   "id": "477990"},
        {"name": "аПБ-26-1",    "id": "477991"},
        {"name": "аРЭоэ-26-1",  "id": "478006"},
        {"name": "аРЭс-26-1",   "id": "478007"},
        {"name": "аСМХ-26-1",   "id": "478010"},
        {"name": "аССП-26-1",   "id": "478013"},
        {"name": "аСТМ-26-1",   "id": "478014"},
        {"name": "аТАРР-26-1",  "id": "478029"},
        {"name": "аТМД-26-1",   "id": "478031"},
        {"name": "аТМН-26-1",   "id": "478033"},
        {"name": "аТОС-26-1",   "id": "478035"},
        {"name": "аТПС-26-1",   "id": "478051"},
        {"name": "аТПСК-26-1",  "id": "478053"},
        {"name": "аТТГР-26-1",  "id": "478055"},
        {"name": "аТХВ-26-1",   "id": "478056"},
        {"name": "аУПП-26-1",   "id": "478057"},
        {"name": "аУСТ-26-1",   "id": "478061"},
        {"name": "аФХМ-26-1",   "id": "478062"},
        {"name": "аХТВ-26-1",   "id": "478064"},
        {"name": "аЭКЛ-26-1",   "id": "478066"},
        {"name": "аЭКО-26-1",   "id": "478068"},
        {"name": "аЭКС-26-1",   "id": "478070"},
        {"name": "аЭНК-26-1",   "id": "478072"},
        {"name": "аЭТРд-26-1",  "id": "478073"},
        {"name": "аЭТРоп-26-1", "id": "478075"},
        {"name": "аЭЭН-26-1",   "id": "478077"},
    ],
    "БРИКС": [
        {"name": "ВЗАм-26-1",   "id": "478105"},
        {"name": "ИИКб-26-1",   "id": "478215"},
        {"name": "ИИКб-26-2",   "id": "479891"},
        {"name": "КБКб-26-1",   "id": "478251"},
        {"name": "ЛБКб-26-1",   "id": "478279"},
        {"name": "ЛБКб-26-2",   "id": "478280"},
        {"name": "МДБб-26-1",   "id": "478306"},
        {"name": "РКИб-26-1",   "id": "478455"},
        {"name": "РКИб-26-2",   "id": "478456"},
        {"name": "СПРКм-26-1",  "id": "479947"},
        {"name": "УЛм-26-1",    "id": "479898"},
        {"name": "ФНб-26-1",    "id": "478580"},
        {"name": "ЦТм-26-1",    "id": "478605"},
        {"name": "ЭПАб-26-1",   "id": "478654"},
        {"name": "ЭЗТм-26-1",   "id": "478632"},
    ],
    "ДЛРЯ": [
        {"name": "ИНС-26-1",   "id": "479936"},
        {"name": "ИНС-26-2",   "id": "479937"},
        {"name": "ИНС-26-3",   "id": "479938"},
        {"name": "ИНС-26-4",   "id": "479939"},
        {"name": "ИНС-26-5",   "id": "479940"},
        {"name": "ИНС-26-6",   "id": "479941"},
        {"name": "ИНСм-26-1",  "id": "479942"},
        {"name": "ИНСм-26-2",  "id": "479943"},
        {"name": "ИНСм-26-3",  "id": "479944"},
    ],
    "ССГ": [
        {"name": "ГИИм-26-1",   "id": "478127"},
        {"name": "ИТГб-26-1",   "id": "478243"},
        {"name": "РМ-26-1",     "id": "478460"},
        {"name": "РФ-26-1",     "id": "478476"},
        {"name": "ЦГФм-26-1",   "id": "478599"},
    ],
    "ИАСиД": [
        {"name": "АД-26-1",     "id": "477954"},
        {"name": "АДм-26-1",    "id": "477957"},
        {"name": "АРб-26-1",    "id": "478002"},
        {"name": "АРб-26-2",    "id": "478003"},
        {"name": "ВВб-26-1",    "id": "478101"},
        {"name": "ВВм-26-1",    "id": "478102"},
        {"name": "ГРб-26-1",    "id": "478173"},
        {"name": "ГРм-26-1",    "id": "478175"},
        {"name": "ГСХб-26-1",   "id": "478179"},
        {"name": "ГСХм-26-1",   "id": "478181"},
        {"name": "ДИб-26-1",    "id": "479888"},
        {"name": "ДСб-26-1",    "id": "478192"},
        {"name": "ДСб-26-2",    "id": "478193"},
        {"name": "КНб-26-1",    "id": "478255"},
        {"name": "НТЗм-26-1",   "id": "478411"},
        {"name": "ОТКм-26-1",   "id": "478429"},
        {"name": "ПГСб-26-1",   "id": "478436"},
        {"name": "РРб-26-1",    "id": "478465"},
        {"name": "СНГб-26-1",   "id": "478501"},
        {"name": "ССЭм-26-1",   "id": "478503"},
        {"name": "СУЗ-26-1",    "id": "478519"},
        {"name": "ТГПм-26-1",   "id": "478524"},
        {"name": "ТМПм-26-1",   "id": "478536"},
        {"name": "УСТб-26-1",   "id": "478563"},
        {"name": "УСТм-26-1",   "id": "478565"},
        {"name": "УСТмз-26-1",  "id": "479899"},
        {"name": "ЭУНб-26-1",   "id": "478714"},
    ],
    "ИВТ": [
        {"name": "АМПб-26-1",   "id": "477984"},
        {"name": "АТПб-26-1",   "id": "478040"},
        {"name": "АТПб-26-2",   "id": "479886"},
        {"name": "БТб-26-1",    "id": "478096"},
        {"name": "БТб-26-2",    "id": "478097"},
        {"name": "ИНОм-26-1",   "id": "478222"},
        {"name": "ИРб-26-1",    "id": "478226"},
        {"name": "ИФб-26-1",    "id": "478247"},
        {"name": "МЦб-26-1",    "id": "478327"},
        {"name": "МЦм-26-1",    "id": "478336"},
        {"name": "МЦТб-26-1",   "id": "478339"},
        {"name": "МХТб-26-1",   "id": "478324"},
        {"name": "НХПм-26-1",   "id": "478412"},
        {"name": "ОХФм-26-1",   "id": "478431"},
        {"name": "ПИм-26-1",    "id": "478438"},
        {"name": "РДб-26-1",    "id": "478447"},
        {"name": "РТУм-26-1",   "id": "478472"},
        {"name": "ХПм-26-1",    "id": "478582"},
        {"name": "ХТм-26-1",    "id": "478590"},
        {"name": "ХТОб-26-1",   "id": "478594"},
        {"name": "ХТТб-26-1",   "id": "478598"},
    ],
    "ИИТиАД": [
        {"name": "АСУб-26-1",   "id": "478021"},
        {"name": "АСУб-26-2",   "id": "478022"},
        {"name": "БКСм-26-1",   "id": "478092"},
        {"name": "ИБб-26-1",    "id": "478205"},
        {"name": "ИБб-26-2",    "id": "479889"},
        {"name": "ИСИб-26-1",   "id": "478232"},
        {"name": "ИСТб-26-1",   "id": "478240"},
        {"name": "ИСТб-26-2",   "id": "478241"},
        {"name": "ИСТб-26-3",   "id": "479892"},
        {"name": "ИИТм-26-1",   "id": "478219"},
        {"name": "КСм-26-1",    "id": "478261"},
        {"name": "ЦППм-26-1",   "id": "478603"},
        {"name": "ЭВМб-26-1",   "id": "478624"},
        {"name": "ЭВМб-26-2",   "id": "479900"},
    ],
    "ИН": [
        {"name": "БЖТм-26-1",   "id": "478088"},
        {"name": "ГА-26-1",     "id": "478109"},
        {"name": "ГГ-26-1",     "id": "478115"},
        {"name": "ГМ-26-1",     "id": "478134"},
        {"name": "ГО-26-1",     "id": "478146"},
        {"name": "ГП-26-1",     "id": "478160"},
        {"name": "ИГ-26-1",     "id": "478210"},
        {"name": "ИГ-26-2",     "id": "479890"},
        {"name": "НДДб-26-1",   "id": "478405"},
        {"name": "НДДб-26-2",   "id": "478406"},
        {"name": "НДДб-26-3",   "id": "479894"},
        {"name": "НДб-26-1",    "id": "478396"},
        {"name": "НДб-26-2",    "id": "478397"},
        {"name": "НДм-26-1",    "id": "478408"},
        {"name": "ООСб-26-1",   "id": "478415"},
        {"name": "ОП-26-1",     "id": "478421"},
        {"name": "ПБмз-26-1",   "id": "479895"},
        {"name": "ТХб-26-1",    "id": "478545"},
        {"name": "ЭКОм-26-1",   "id": "478634"},
    ],
    "ИЭУП": [
        {"name": "ВДм-26-1",    "id": "479887"},
        {"name": "ЖРб-26-1",    "id": "478200"},
        {"name": "ИИм-26-1",    "id": "478217"},
        {"name": "МБб-26-1",    "id": "478297"},
        {"name": "МБб-26-2",    "id": "478298"},
        {"name": "МБб-26-3",    "id": "479893"},
        {"name": "НБ-26-1",     "id": "478349"},
        {"name": "НБ-26-2",     "id": "478350"},
        {"name": "СМТм-26-1",   "id": "478497"},
        {"name": "ТД-26-1",     "id": "478532"},
        {"name": "ТД-26-2",     "id": "478533"},
        {"name": "УОБТб-26-1",  "id": "478555"},
        {"name": "ФКб-26-1",    "id": "478575"},
        {"name": "ФКб-26-2",    "id": "478576"},
        {"name": "ЭМЭНм-26-1",  "id": "478646"},
        {"name": "ЭМЭНмз-26-1", "id": "479901"},
        {"name": "ЭПЭб-26-1",   "id": "478680"},
        {"name": "ЭПЭб-26-2",   "id": "478679"},
        {"name": "ЭТЭКб-26-1",  "id": "478706"},
        {"name": "ЭТЭКб-26-2",  "id": "478707"},
        {"name": "ЮРУб-26-1",   "id": "478723"},
    ],
    "ИЭ": [
        {"name": "ЭАПЭб-26-1",  "id": "478614"},
        {"name": "КТЭм-26-1",   "id": "478273"},
        {"name": "СТЭб-26-1",   "id": "478508"},
        {"name": "СТЭб-26-2",   "id": "479897"},
        {"name": "УЭСм-26-1",   "id": "478569"},
        {"name": "ЦЭм-26-1",    "id": "478609"},
        {"name": "ЭНГм-26-1",   "id": "478650"},
        {"name": "ЭПб-26-1",    "id": "478660"},
        {"name": "ЭПб-26-2",    "id": "478661"},
        {"name": "ЭСб-26-1",    "id": "478692"},
        {"name": "ЭСм-26-1",    "id": "478699"},
        {"name": "ЭСТм-26-1",   "id": "478701"},
        {"name": "ЭУм-26-1",    "id": "478709"},
    ],
}

LESSON_TIMES = {
    "8:15":  "9:45",  "8:30":  "10:00",
    "10:00": "11:30", "10:10": "11:40",
    "11:45": "13:15", "12:00": "13:30",
    "13:45": "15:15", "14:00": "15:30",
    "15:30": "17:00", "15:45": "17:15",
    "17:10": "18:40", "17:25": "18:55",
    "18:50": "20:20", "19:05": "20:35",
}


# ============================================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================
def _now_irkutsk() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=8)


def _group_name_by_id(group_id: str) -> str:
    for groups in GROUPS.values():
        for g in groups:
            if g["id"] == group_id:
                return g["name"]
    return "Неизвестная группа"


def _monday_of_week(d: datetime) -> datetime:
    return d - timedelta(days=d.weekday())


def _time_sort_key(t: str) -> tuple:
    m = re.match(r"(\d+):(\d+)", t)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return (99, 99)


def _time_range(t: str) -> str:
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


def parse_schedule(html: str):
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


async def fetch_week_html(group_id: str, target_monday: datetime) -> str:
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
                return html
    except Exception as e:
        logging.error(f"[WEEK] Ошибка: {e}")
        return ""


def format_day(day: dict) -> str:
    lines = [day["name"], ""]
    if not day["lessons"]:
        lines.append("Занятий нет.")
        lines.append("")
        return "\n".join(lines)

    by_time = {}
    for les in day["lessons"]:
        by_time.setdefault(les["time"], []).append(les)

    for time_str in sorted(by_time.keys(), key=_time_sort_key):
        lessons = by_time[time_str]
        for i, les in enumerate(lessons):
            subj = les["subject"] or "—"
            if les["type"]:
                subj += f" ({les['type']})"
            prefix = "!! " if ("перенос" in subj.lower() or "перенес" in subj.lower()) else ""
            if i == 0:
                lines.append(f"{prefix}{_time_range(time_str)}")
                lines.append(f"  {subj}")
            else:
                if les["subgroup"]:
                    lines.append(f"  подгр. {les['subgroup']}: {subj}")
                else:
                    lines.append(f"  {subj}")
            details = []
            if les["teacher"]:
                details.append(les["teacher"])
            if les["auditorium"]:
                details.append(f"ауд. {les['auditorium']}")
            if les["subgroup"] and i == 0 and len(lessons) == 1:
                details.append(f"подгр. {les['subgroup']}")
            if details:
                lines.append(f"  {', '.join(details)}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


async def send_schedule_for_date(user_id: int, group_id: str, group_name: str, target_date: datetime, title: str):
    """Отправляет расписание на указанную дату конкретному пользователю."""
    monday = _monday_of_week(target_date)
    html = await fetch_week_html(group_id, monday)
    if not html:
        return
    _, days = parse_schedule(html)
    date_str = target_date.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == date_str), None)
    if day is None:
        text = f"{title} ({date_str})\n\nЗанятий нет."
    else:
        text = f"{title}\n\n" + format_day(day).strip()
    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"
    try:
        await bot.send_message(user_id, text)
    except Exception as e:
        logging.error(f"[NOTIFY] Не удалось отправить {user_id}: {e}")


# ============================================================
# КЛАВИАТУРЫ
# ============================================================
def get_main_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="Моя группа"), KeyboardButton(text="Расписание")],
            [KeyboardButton(text="Уведомления"), KeyboardButton(text="Помощь")],
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


def get_groups_keyboard(institute_name: str, page: int = 0):
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
    kb.append([InlineKeyboardButton(text="Назад", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_schedule_actions_keyboard(group_id: str, is_my_group: bool = False):
    buttons = [
        [InlineKeyboardButton(text="Сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="Текущая неделя", callback_data=f"week_0_{group_id}")],
        [InlineKeyboardButton(text="Следующая неделя", callback_data=f"week_1_{group_id}")],
    ]
    if is_my_group:
        buttons.append([InlineKeyboardButton(text="Забыть группу", callback_data="forget_my")])
    else:
        buttons.append([InlineKeyboardButton(text="Сделать моей группой", callback_data=f"save_my_{group_id}")])
    buttons.append([InlineKeyboardButton(text="Назад", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def get_notify_keyboard(current: tuple = None):
    buttons = []
    for label, h, m in NOTIFY_PRESETS:
        mark = " ✅" if current and current[0] == h and current[1] == m else ""
        buttons.append([InlineKeyboardButton(text=f"{label}{mark}", callback_data=f"notify_{h}_{m}")])
    buttons.append([InlineKeyboardButton(text="Выключить", callback_data="notify_off")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


# ============================================================
# ХЕНДЛЕРЫ
# ============================================================
@dp.message(CommandStart())
async def start(message: Message):
    _ensure_user(message.from_user.id)
    saved = get_user_group(message.from_user.id)
    hint = f"\n\nТвоя группа: {saved[1]}" if saved else \
           "\n\nСовет: выбери группу через «Расписание» и нажми «Сделать моей группой»."
    await message.answer(
        f"Привет, {message.from_user.full_name}!\n\n"
        "Я бот для студентов ИРНИТУ." + hint,
        reply_markup=get_main_keyboard(),
    )


@dp.message(Command("myid"))
async def cmd_myid(message: Message):
    await message.answer(f"Твой Telegram ID: {message.from_user.id}")


@dp.message(Command("stats"))
async def cmd_stats(message: Message):
    if message.from_user.id != ADMIN_ID:
        await message.answer("Команда только для администратора.")
        return
    total, with_group, with_notify = get_stats()
    await message.answer(
        f"Статистика бота:\n\n"
        f"Всего пользователей: {total}\n"
        f"С сохранённой группой: {with_group}\n"
        f"С уведомлениями: {with_notify}"
    )


@dp.message(F.text == "Расписание")
async def show_institutes(message: Message):
    await message.answer("Выбери институт:", reply_markup=get_institutes_keyboard())


@dp.message(F.text == "Моя группа")
async def show_my_group(message: Message):
    saved = get_user_group(message.from_user.id)
    if not saved:
        await message.answer(
            "У тебя нет сохранённой группы.\n\n"
            "Выбери её через «Расписание» → институт → группу, "
            "затем нажми «Сделать моей группой».",
            reply_markup=get_main_keyboard(),
        )
        return
    group_id, group_name = saved
    await message.answer(
        f"Моя группа: {group_name}\n\nЧто показать?",
        reply_markup=get_schedule_actions_keyboard(group_id, is_my_group=True),
    )


@dp.message(F.text == "Уведомления")
async def notifications_menu(message: Message):
    saved = get_user_group(message.from_user.id)
    if not saved:
        await message.answer(
            "Сначала сохрани свою группу (через «Расписание»). "
            "Потом можно настроить уведомления.",
            reply_markup=get_main_keyboard(),
        )
        return
    current = get_notify_time(message.from_user.id)
    if current:
        status = f"Сейчас уведомления приходят в {current[0]:02d}:{current[1]:02d}."
    else:
        status = "Уведомления выключены."
    await message.answer(
        f"{status}\n\nВыбери время, когда присылать расписание на завтра:",
        reply_markup=get_notify_keyboard(current),
    )


@dp.callback_query(F.data.startswith("notify_"))
async def process_notify(callback: CallbackQuery):
    if callback.data == "notify_off":
        set_notify_time(callback.from_user.id, -1, 0)
        await callback.message.edit_text("Уведомления выключены.")
        await callback.answer("Выключено")
        return
    parts = callback.data.split("_")
    h, m = int(parts[1]), int(parts[2])
    set_notify_time(callback.from_user.id, h, m)
    await callback.message.edit_text(
        f"Уведомления включены.\n\n"
        f"Каждый день в {h:02d}:{m:02d} (по Иркутску) бот будет присылать "
        f"расписание на завтра.",
    )
    await callback.answer("Сохранено")


@dp.callback_query(F.data.startswith("institute_"))
async def process_institute(callback: CallbackQuery):
    institute_name = callback.data.split("_", 1)[1]
    await callback.message.edit_text(
        f"Институт: {institute_name}\n\nВыбери группу:",
        reply_markup=get_groups_keyboard(institute_name, 0),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("instpage_"))
async def process_page(callback: CallbackQuery):
    parts = callback.data.split("_", 2)
    await callback.message.edit_text(
        f"Институт: {parts[1]}\n\nВыбери группу:",
        reply_markup=get_groups_keyboard(parts[1], int(parts[2])),
    )
    await callback.answer()


@dp.callback_query(F.data == "noop")
async def noop(callback: CallbackQuery):
    await callback.answer()


@dp.callback_query(F.data.startswith("group_"))
async def process_group(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = _group_name_by_id(group_id)
    saved = get_user_group(callback.from_user.id)
    is_my = saved is not None and saved[0] == group_id
    await callback.message.edit_text(
        f"Группа: {group_name}\n\nЧто показать?",
        reply_markup=get_schedule_actions_keyboard(group_id, is_my_group=is_my),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("save_my_"))
async def save_my_group(callback: CallbackQuery):
    group_id = callback.data.split("_", 2)[2]
    group_name = _group_name_by_id(group_id)
    save_user_group(callback.from_user.id, group_id, group_name)
    await callback.message.edit_text(
        f"Группа {group_name} сохранена как твоя.\n\n"
        f"Теперь в меню есть «Моя группа» и можно настроить «Уведомления».",
        reply_markup=get_schedule_actions_keyboard(group_id, is_my_group=True),
    )
    await callback.answer("Сохранено")


@dp.callback_query(F.data == "forget_my")
async def forget_my_group(callback: CallbackQuery):
    delete_user_group(callback.from_user.id)
    await callback.message.edit_text(
        "Группа удалена. Уведомления тоже отключены.\n\n"
        "Можешь выбрать новую через «Расписание».",
    )
    await callback.answer("Удалено")


@dp.callback_query(F.data == "back_to_institutes")
async def back_to_institutes(callback: CallbackQuery):
    await callback.message.edit_text("Выбери институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("today_"))
async def show_today(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    await callback.message.edit_text("Загружаю...")
    today = _now_irkutsk()
    monday = _monday_of_week(today)
    try:
        html = await fetch_week_html(group_id, monday)
        soup = BeautifulSoup(html, "html.parser")
        start, end = parse_week_range(soup)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка")
        await callback.message.edit_text(f"Ошибка: {e}")
        await callback.answer()
        return
    today_str = today.strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)
    header = f"Сегодня {today_str}"
    if start and end:
        header += f" (неделя {start} - {end})"
    text = f"{header}\n\n" + (format_day(day).strip() if day else "Занятий нет.")
    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("week_"))
async def show_week(callback: CallbackQuery):
    parts = callback.data.split("_", 2)
    offset = int(parts[1])
    group_id = parts[2]
    group_name = _group_name_by_id(group_id)
    await callback.message.edit_text("Загружаю...")
    today = _now_irkutsk()
    target_monday = _monday_of_week(today) + timedelta(days=7 * offset)
    try:
        html = await fetch_week_html(group_id, target_monday)
        soup = BeautifulSoup(html, "html.parser")
        start, end = parse_week_range(soup)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка")
        await callback.message.edit_text(f"Ошибка: {e}")
        await callback.answer()
        return
    title = "Текущая неделя" if offset == 0 else "Следующая неделя"
    header = f"{title}\nГруппа: {group_name}"
    if start and end:
        header += f"\n{start} - {end}"
    text = header + "\n\n" + ("\n".join(format_day(d) for d in days) if days else "Расписание не найдено.")
    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"
    await callback.message.edit_text(
        text.strip(),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.message(F.text == "Помощь")
async def help_cmd(message: Message):
    await message.answer(
        "Я умею:\n"
        "- Показывать расписание по всем институтам ИРНИТУ\n"
        "- Запоминать твою группу («Моя группа»)\n"
        "- Присылать расписание на завтра в выбранное время («Уведомления»)\n\n"
        "Просто нажимай кнопки.",
        reply_markup=get_main_keyboard(),
    )


# ============================================================
# ФОНОВАЯ ЗАДАЧА — РАССЫЛКА УВЕДОМЛЕНИЙ
# ============================================================
async def notification_loop():
    """Каждую минуту проверяет: кому сейчас надо отправить уведомление."""
    last_sent_key = None  # чтобы не отправлять дважды в одну минуту
    while True:
        try:
            now = _now_irkutsk()
            current_key = f"{now.strftime('%Y-%m-%d %H:%M')}"

            if current_key != last_sent_key:
                users = get_users_to_notify(now.hour, now.minute)
                if users:
                    logging.info(f"[NOTIFY] Минута {now.hour:02d}:{now.minute:02d}, получателей: {len(users)}")
                    tomorrow = now + timedelta(days=1)
                    for user_id, group_id, group_name in users:
                        try:
                            await send_schedule_for_date(
                                user_id, group_id, group_name, tomorrow,
                                f"Расписание на завтра ({group_name})"
                            )
                        except Exception as e:
                            logging.error(f"[NOTIFY] Ошибка для {user_id}: {e}")
                last_sent_key = current_key
        except Exception as e:
            logging.exception(f"[NOTIFY] Ошибка в цикле: {e}")
        await asyncio.sleep(30)


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
    # Запускаем фоновую рассылку
    asyncio.create_task(notification_loop())
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
