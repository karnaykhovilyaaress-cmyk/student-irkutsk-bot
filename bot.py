import asyncio
import re
import sys
import logging
from datetime import datetime, timedelta, timezone
import aiohttp
from bs4 import BeautifulSoup
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
)

# ============================================================
TOKEN = "8953672814:AAG4cxGgLJRVv-EXzDip6cT7u6NO7vez18E"
bot = Bot(token=TOKEN)
dp = Dispatcher()

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

WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]


# ============================================================
# СКАЧИВАНИЕ HTML И ПАРСИНГ
# ============================================================
async def fetch_page(group_id: str) -> str:
    url = f"https://www.istu.edu/raspisanie/grup/{group_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as response:
            html = await response.text()
            logging.info(f"[DEBUG] GET {url} → {response.status}, len={len(html)}")
            return html


def parse_schedule(html: str):
    """Возвращает (week_parity, days) где days = [{date, name, lessons:[...]}]."""
    soup = BeautifulSoup(html, "html.parser")

    # Чётность недели
    week_parity = "all"
    for item in soup.find_all("div", class_="info-block-item"):
        label = item.find("div", class_="info-block-item-label")
        value = item.find("div", class_="info-block-item-value")
        if label and value and "Показана неделя" in label.get_text():
            txt = value.get_text(strip=True).lower()
            week_parity = "odd" if "нечет" in txt else "even"

    days = []
    for day_div in soup.find_all("div", class_="sch-list-day"):
        # Дата
        date_str = ""
        params = day_div.get("data-params", "")
        m = re.search(r"'date'\s*:\s*'([^']+)'", params)
        if m:
            date_str = m.group(1)

        header = day_div.find("h2", class_="sch-list-day-header")
        day_name = header.get_text(strip=True) if header else date_str

        lessons = []
        # Ищем все sch-list-item (время + пары)
        for item in day_div.find_all("div", class_="sch-list-item"):
            time_div = item.find("div", class_="sch-list-item-time-inner")
            time_str = time_div.get_text(strip=True) if time_div else ""

            # Внутри item — блоки по чётности
            for week_block in item.find_all("div", class_="sch-list-item-week"):
                classes = week_block.get("class", [])
                week_type = "all"
                if "week-even" in classes:
                    week_type = "even"
                elif "week-odd" in classes:
                    week_type = "odd"

                # Пропускаем несовпадающую чётность
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
                        "time": time_str,
                        "subject": subject,
                        "type": lesson_type,
                        "teacher": teacher,
                        "subgroup": subgroup,
                        "auditorium": auditorium,
                    })

        days.append({"date": date_str, "name": day_name, "lessons": lessons})

    return week_parity, days


# ============================================================
# ФОРМАТИРОВАНИЕ
# ============================================================
def format_day(day: dict) -> str:
    lines = [f"📅 {day['name']}", ""]
    if not day["lessons"]:
        lines.append("Занятий нет.")
        lines.append("")
        return "\n".join(lines)

    # Группируем по времени
    by_time = {}
    for les in day["lessons"]:
        by_time.setdefault(les["time"], []).append(les)

    for time_str in by_time:
        lines.append(f"🕐 {time_str}")
        for les in by_time[time_str]:
            subj = les["subject"]
            if les["type"]:
                subj += f" ({les['type']})"
            lines.append(f"   • {subj}")
            if les["teacher"]:
                lines.append(f"     👤 {les['teacher']}")
            if les["auditorium"]:
                lines.append(f"     🚪 {les['auditorium']}")
            if les["subgroup"]:
                lines.append(f"     👥 Подгруппа: {les['subgroup']}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _now_irkutsk() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=8)


def _group_name_by_id(group_id: str) -> str:
    for groups in GROUPS.values():
        for g in groups:
            if g["id"] == group_id:
                return g["name"]
    return "Неизвестная группа"


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

    try:
        html = await fetch_page(group_id)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка парсинга")
        await callback.message.edit_text(
            f"Не удалось загрузить расписание: {e}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{group_id}")]
            ]),
        )
        await callback.answer()
        return

    today = _now_irkutsk()
    today_str = today.strftime("%d.%m.%Y")

    # Ищем сегодняшний день
    day = None
    for d in days:
        if d["date"] == today_str:
            day = d
            break

    if day is None:
        # Если сегодня нет в расписании — покажем первый день недели
        if days:
            text = f"📅 На {today_str} занятий нет.\n\nРасписание на текущую неделю:\n\n"
            text += "\n".join(format_day(d) for d in days)
        else:
            text = f"📅 На {today_str} занятий нет."
    else:
        text = format_day(day)

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

    try:
        html = await fetch_page(group_id)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка парсинга")
        await callback.message.edit_text(
            f"Не удалось загрузить расписание: {e}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="⬅️ Назад", callback_data=f"group_{group_id}")]
            ]),
        )
        await callback.answer()
        return

    if not days:
        text = f"📅 Расписание для группы {group_name} не найдено."
    else:
        text = f"📅 Расписание на неделю\nГруппа: {group_name}\n\n"
        text += "\n".join(format_day(d) for d in days)

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
