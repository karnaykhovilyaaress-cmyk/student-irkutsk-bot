import asyncio
import json
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
# ПОЛУЧЕНИЕ РАСПИСАНИЯ С САЙТА ИРНИТУ (POST + JSON)
# ============================================================
async def fetch_schedule(group_id: str, date: datetime):
    """Отправляет POST-запрос к AJAX-скрипту ИРНИТУ и возвращает JSON."""
    url = "https://www.istu.edu/Sys/Module/ScheduleClassList/v2/calendar.ajax.php"

    params = {
        "group_id": group_id,
        "year": date.year,
        "month": date.month,   # 1..12 (как в JS)
        "day": date.day,
    }

    # Сайт передаёт параметры как JSON-строку в поле 'params'
    data = {"params": json.dumps(params)}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data) as response:
                raw = await response.text()
                # Отладочный вывод в логи BotHost
                print(f"[DEBUG] group={group_id} date={date.date()} status={response.status}")
                print(f"[DEBUG] response: {raw[:800]}")
                if response.status == 200:
                    try:
                        return json.loads(raw)
                    except json.JSONDecodeError:
                        print("[DEBUG] Не удалось распарсить JSON")
                        return None
                return None
    except Exception as e:
        print(f"[DEBUG] Ошибка запроса: {e}")
        return None


# ============================================================
# ФОРМАТИРОВАНИЕ ОТВЕТА СЕРВЕРА В ТЕКСТ
# ============================================================
WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

def _extract_lesson(lesson: dict) -> dict:
    """Достаёт поля пары из объекта любого возможного формата."""
    # Название предмета
    subject = (
        lesson.get("name") or lesson.get("subject") or
        lesson.get("discipline") or lesson.get("title") or "—"
    )

    # Время
    time_start = lesson.get("time_start") or lesson.get("timeStart") or lesson.get("start") or ""
    time_end = lesson.get("time_end") or lesson.get("timeEnd") or lesson.get("end") or ""
    if not time_start and lesson.get("time"):
        time_start = lesson["time"]
    time_str = f"{time_start}–{time_end}" if time_start and time_end else (time_start or "—")

    # Номер пары
    number = lesson.get("number") or lesson.get("num") or lesson.get("pair") or ""

    # Тип занятия
    ltype = lesson.get("type") or lesson.get("lesson_type") or lesson.get("kind") or ""

    # Преподаватели
    teachers = lesson.get("teachers") or lesson.get("teacher") or []
    if isinstance(teachers, str):
        teachers = [{"name": teachers}]
    if isinstance(teachers, dict):
        teachers = [teachers]
    teachers_str = ", ".join([t.get("name", "") if isinstance(t, dict) else str(t) for t in teachers if t])

    # Аудитории
    rooms = lesson.get("auditories") or lesson.get("auditoriums") or lesson.get("rooms") or lesson.get("room") or []
    if isinstance(rooms, str):
        rooms = [{"name": rooms}]
    if isinstance(rooms, dict):
        rooms = [rooms]
    rooms_str = ", ".join([r.get("name", "") if isinstance(r, dict) else str(r) for r in rooms if r])

    # Подгруппа
    subgroup = lesson.get("subgroup") or lesson.get("sub_group") or lesson.get("podgruppa") or ""

    return {
        "number": number,
        "time": time_str,
        "subject": subject,
        "type": ltype,
        "teachers": teachers_str,
        "rooms": rooms_str,
        "subgroup": subgroup,
    }


def _iterate_days(data: dict):
    """Возвращает список (date_str, day_obj) из ответа сервера."""
    if not data:
        return []

    dates = data.get("dates")
    if dates is None:
        return []

    # Формат 1: dates — список объектов
    if isinstance(dates, list):
        result = []
        for d in dates:
            date_str = d.get("date") or d.get("day") or ""
            result.append((date_str, d))
        return result

    # Формат 2: dates — словарь { "2026-09-22": {...}, ... }
    if isinstance(dates, dict):
        return list(dates.items())

    return []


def _get_lessons_from_day(day: dict):
    """Возвращает список пар из объекта дня."""
    if not isinstance(day, dict):
        return []
    for key in ("items", "lessons", "classes", "pairs", "schedule", "list"):
        if key in day and isinstance(day[key], list):
            return day[key]
    return []


def format_day(data: dict, date: datetime, group_name: str) -> str:
    """Формирует текст расписания на один день."""
    days = _iterate_days(data)

    header = f"📅 {WEEKDAYS[date.weekday()]}, {date.strftime('%d.%m.%Y')}"

    # Ищем нужный день
    target = date.strftime("%Y-%m-%d")
    day_obj = None
    for date_str, d in days:
        if date_str and date_str.startswith(target):
            day_obj = d
            break
    if day_obj is None and days:
        day_obj = days[0][1]

    if day_obj is None:
        return f"{header}\n\nЗанятий нет.\n"

    lessons = _get_lessons_from_day(day_obj)
    if not lessons:
        return f"{header}\n\nЗанятий нет.\n"

    lines = [header, ""]
    for lesson in lessons:
        info = _extract_lesson(lesson)
        # Заголовок пары
        head_parts = []
        if info["number"]:
            head_parts.append(f"{info['number']} пара")
        if info["time"]:
            head_parts.append(info["time"])
        head = " | ".join(head_parts) if head_parts else "Пара"
        lines.append(head)
        # Предмет
        subject_line = info["subject"]
        if info["type"]:
            subject_line += f" ({info['type']})"
        lines.append(subject_line)
        # Преподаватель
        if info["teachers"]:
            lines.append(f"👤 {info['teachers']}")
        # Аудитория
        if info["rooms"]:
            lines.append(f"🚪 {info['rooms']}")
        # Подгруппа
        if info["subgroup"]:
            lines.append(f"👥 Подгруппа: {info['subgroup']}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def format_week(group_id: str, group_name: str, start: datetime, days_data: list) -> str:
    """Формирует текст расписания на неделю."""
    text = f"📅 Расписание на неделю\nГруппа: {group_name}\n\n"
    for date, data in days_data:
        text += format_day(data, date, group_name) + "\n"
    return text


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
    kb = [
        [InlineKeyboardButton(text=g["name"], callback_data=f"group_{g['id']}")]
        for g in groups
    ]
    kb.append([InlineKeyboardButton(text="⬅️ Назад к институтам", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_schedule_actions_keyboard(group_id: str):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📅 Расписание на сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="📅 Расписание на неделю", callback_data=f"week_{group_id}")],
        [InlineKeyboardButton(text="⬅️ Назад к группам", callback_data="back_to_institutes")],
    ])


def _group_name_by_id(group_id: str) -> str:
    for groups in GROUPS.values():
        for g in groups:
            if g["id"] == group_id:
                return g["name"]
    return "Неизвестная группа"


def _now_irkutsk() -> datetime:
    """Текущее время в Иркутске (UTC+8)."""
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
    data = await fetch_schedule(group_id, today)
    text = format_day(data, today, group_name)

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
    # С понедельника текущей недели
    monday = today - timedelta(days=today.weekday())

    days_data = []
    for i in range(7):
        d = monday + timedelta(days=i)
        data = await fetch_schedule(group_id, d)
        days_data.append((d, data))
        await asyncio.sleep(0.3)  # небольшая пауза, чтобы не долбить сервер

    text = format_week(group_id, group_name, monday, days_data)

    # Telegram ограничивает сообщение 4096 символами — режем при необходимости
    if len(text) > 4000:
        text = text[:4000] + "\n\n… (сообщение обрезано)"

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
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
