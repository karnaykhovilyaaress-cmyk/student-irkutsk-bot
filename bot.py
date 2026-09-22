import asyncio
import json
import sys
import logging
import aiohttp
from datetime import datetime, timedelta, timezone
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
)

# ============================================================
# НАСТРОЙКИ
# ============================================================
TOKEN = "8953672814:AAG4cxGgLJRVv-EXzDip6cT7u6NO7vez18E"

bot = Bot(token=TOKEN)
dp = Dispatcher()

# ============================================================
# ДАННЫЕ О ГРУППАХ (ИАМиТ, 1 курс)
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
    ]
}

# ============================================================
# ПОЛУЧЕНИЕ РАСПИСАНИЯ С САЙТА ИРНИТУ
# Отправляем JSON напрямую: {"month":.., "year":.., "group_id":".."}
# ============================================================
async def fetch_schedule(group_id: str, year: int, month: int):
    url = "https://www.istu.edu/Sys/Module/ScheduleClassList/v2/calendar.ajax.php"
    payload = {"month": month, "year": year, "group_id": group_id}
    headers = {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                raw = await response.text()
                logging.info(f"[DEBUG] status={response.status} url={url}")
                logging.info(f"[DEBUG] payload={json.dumps(payload)}")
                logging.info(f"[DEBUG] response={raw[:2000]}")
                if response.status == 200:
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        logging.error("[DEBUG] Ответ не JSON")
                        return None
                return None
    except Exception as e:
        logging.error(f"[DEBUG] Ошибка запроса: {e}")
        return None


# ============================================================
# ВЫТАСКИВАНИЕ ПОЛЕЙ ИЗ ОБЪЕКТА ПАРЫ
# ============================================================
def _val(obj, *keys, default=""):
    """Возвращает первое найденное значение по ключам."""
    if not isinstance(obj, dict):
        return default
    for k in keys:
        if k in obj and obj[k]:
            return obj[k]
    return default


def _extract_lesson(lesson: dict) -> dict:
    # Номер пары
    number = _val(lesson, "number", "num", "pair", "pair_number")

    # Время
    t_start = _val(lesson, "time_start", "timeStart", "start", "begin")
    t_end = _val(lesson, "time_end", "timeEnd", "end", "finish")
    if not t_start and lesson.get("time"):
        t_start = lesson["time"]
    time_str = f"{t_start}–{t_end}" if t_start and t_end else (t_start or "")

    # Предмет
    subject = _val(lesson, "name", "subject", "discipline", "title", "lesson_name")

    # Тип
    ltype = _val(lesson, "type", "lesson_type", "kind", "form")

    # Преподаватели
    teachers = _val(lesson, "teachers", "teacher", "prepod", "prepods", default=[])
    if isinstance(teachers, str):
        teachers = [{"name": teachers}]
    if isinstance(teachers, dict):
        teachers = [teachers]
    t_str = ", ".join([t.get("name", "") if isinstance(t, dict) else str(t) for t in teachers if t])

    # Аудитории
    rooms = _val(lesson, "auditories", "auditoriums", "rooms", "room", "audience", default=[])
    if isinstance(rooms, str):
        rooms = [{"name": rooms}]
    if isinstance(rooms, dict):
        rooms = [rooms]
    r_str = ", ".join([r.get("name", "") if isinstance(r, dict) else str(r) for r in rooms if r])

    # Подгруппа
    subgroup = _val(lesson, "subgroup", "sub_group", "podgruppa")

    return {
        "number": number, "time": time_str, "subject": subject,
        "type": ltype, "teachers": t_str, "rooms": r_str, "subgroup": subgroup,
    }


# ============================================================
# ПОИСК ДНЯ И ПАР В ОТВЕТЕ СЕРВЕРА
# ============================================================
def _find_day(data, target_date: datetime):
    """Ищет в ответе сервера день, соответствующий target_date."""
    if not data:
        return None

    target_iso = target_date.strftime("%Y-%m-%d")
    target_dmy = target_date.strftime("%d.%m.%Y")

    # Собираем все списки дней, где бы они ни лежали
    candidates = []
    if isinstance(data, list):
        candidates = data
    elif isinstance(data, dict):
        for key in ("dates", "days", "items", "schedule", "list", "data"):
            v = data.get(key)
            if isinstance(v, list):
                candidates = v
                break
            if isinstance(v, dict):
                candidates = list(v.values())
                break

    for d in candidates:
        if not isinstance(d, dict):
            continue
        date_str = str(_val(d, "date", "day", "date_str", "dt"))
        if target_iso in date_str or target_dmy in date_str:
            return d

    return None


def _get_lessons(day_obj):
    if not isinstance(day_obj, dict):
        return []
    for key in ("items", "lessons", "classes", "pairs", "schedule", "list", "rows"):
        v = day_obj.get(key)
        if isinstance(v, list):
            return v
    return []


WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]


def format_day(data, date: datetime, group_name: str) -> str:
    header = f"📅 {WEEKDAYS[date.weekday()]}, {date.strftime('%d.%m.%Y')}"

    day_obj = _find_day(data, date)
    if day_obj is None:
        return f"{header}\n\nЗанятий нет.\n"

    lessons = _get_lessons(day_obj)
    if not lessons:
        return f"{header}\n\nЗанятий нет.\n"

    lines = [header, ""]
    for lesson in lessons:
        if not isinstance(lesson, dict):
            continue
        info = _extract_lesson(lesson)

        head = []
        if info["number"]:
            head.append(f"{info['number']} пара")
        if info["time"]:
            head.append(info["time"])
        if head:
            lines.append(" | ".join(head))

        subj = info["subject"] or "—"
        if info["type"]:
            subj += f" ({info['type']})"
        lines.append(subj)

        if info["teachers"]:
            lines.append(f"👤 {info['teachers']}")
        if info["rooms"]:
            lines.append(f"🚪 {info['rooms']}")
        if info["subgroup"]:
            lines.append(f"👥 Подгруппа: {info['subgroup']}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ============================================================
# КЛАВИАТУРЫ
# ============================================================
def get_main_keyboard():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📅 Расписание")],
            [KeyboardButton(text="📝 Дедлайны"), KeyboardButton(text="ℹ️ Помощь")],
        ],
        resize_keyboard=True,
    )


def get_institutes_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=inst, callback_data=f"institute_{inst}")]
        for inst in GROUPS.keys()
    ])


def get_groups_keyboard(institute_name: str):
    groups = GROUPS.get(institute_name, [])
    kb = [[InlineKeyboardButton(text=g["name"], callback_data=f"group_{g['id']}")] for g in groups]
    kb.append([InlineKeyboardButton(text="⬅️ Назад к институтам", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_schedule_actions_keyboard(group_id: str):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📅 Расписание на сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="📅 Расписание на неделю", callback_data=f"week_{group_id}")],
        [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{group_id}")],
    ])


def _group_name_by_id(group_id: str) -> str:
    for groups in GROUPS.values():
        for g in groups:
            if g["id"] == group_id:
                return g["name"]
    return "Неизвестная группа"


def _now_irkutsk() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=8)


# ============================================================
# ХЕНДЛЕРЫ
# ============================================================
@dp.message(CommandStart())
async def start(message: Message):
    await message.answer(
        f"Привет, {message.from_user.full_name}! Я бот для студентов ИРНИТУ.\n\n"
        "Выбери действие на клавиатуре ниже:",
        reply_markup=get_main_keyboard(),
    )


@dp.message(F.text == "📅 Расписание")
async def show_institutes(message: Message):
    await message.answer("Выбери свой институт:", reply_markup=get_institutes_keyboard())


@dp.callback_query(F.data.startswith("institute_"))
async def process_institute(callback: CallbackQuery):
    institute_name = callback.data.split("_", 1)[1]
    await callback.message.edit_text(
        f"Институт: {institute_name}\n\nВыбери свою группу:",
        reply_markup=get_groups_keyboard(institute_name),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("group_"))
async def process_group(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = _group_name_by_id(group_id)
    await callback.message.edit_text(
        f"Группа: {group_name}\n\nЧто показать?",
        reply_markup=get_schedule_actions_keyboard(group_id),
    )
    await callback.answer()


@dp.callback_query(F.data == "back_to_institutes")
async def back_to_institutes(callback: CallbackQuery):
    await callback.message.edit_text("Выбери свой институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("today_"))
async def show_today(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = _group_name_by_id(group_id)

    await callback.message.edit_text("Загружаю расписание...")

    today = _now_irkutsk()
    data = await fetch_schedule(group_id, today.year, today.month)
    text = format_day(data, today, group_name)

    if len(text) > 4000:
        text = text[:4000] + "\n\n… (обрезано)"

    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("week_"))
async def show_week(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = _group_name_by_id(group_id)

    await callback.message.edit_text("Загружаю расписание на неделю...")

    today = _now_irkutsk()
    monday = today - timedelta(days=today.weekday())

    # Запрашиваем расписание на текущий месяц (и, если неделя переходит, на следующий)
    months_needed = {(monday.year, monday.month)}
    sunday = monday + timedelta(days=6)
    months_needed.add((sunday.year, sunday.month))

    cache = {}
    for (y, m) in months_needed:
        cache[(y, m)] = await fetch_schedule(group_id, y, m)
        await asyncio.sleep(0.3)

    text = f"📅 Расписание на неделю\nГруппа: {group_name}\n\n"
    for i in range(7):
        d = monday + timedelta(days=i)
        data = cache.get((d.year, d.month))
        text += format_day(data, d, group_name) + "\n"

    if len(text) > 4000:
        text = text[:4000] + "\n\n… (обрезано)"

    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.message(F.text == "📝 Дедлайны")
async def deadlines(message: Message):
    await message.answer("Раздел с дедлайнами в разработке.", reply_markup=get_main_keyboard())


@dp.message(F.text == "ℹ️ Помощь")
async def help_cmd(message: Message):
    await message.answer(
        "Я умею:\n"
        "• Показывать расписание по группам ИАМиТ\n"
        "• Скоро: напоминать о дедлайнах\n\n"
        "Просто нажимай кнопки.",
        reply_markup=get_main_keyboard(),
    )


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
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
