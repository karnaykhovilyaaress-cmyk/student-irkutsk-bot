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
# НАСТРОЙКИ
# ============================================================
TOKEN = "8953672814:AAG4cxGgLJRVv-EXzDip6cT7u6NO7vez18E"
bot = Bot(token=TOKEN)
dp = Dispatcher()

# ============================================================
# ГРУППЫ (ИАМиТ, 1 курс)
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
# ЗАГРУЗКА И ПАРСИНГ
# ============================================================
async def fetch_page(group_id: str, target_date: datetime = None) -> str:
    url = f"https://www.istu.edu/raspisanie/grup/{group_id}"
    if target_date:
        url += f"?date={target_date.strftime('%Y-%m-%d')}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as response:
            html = await response.text()
            logging.info(f"[DEBUG] GET {url} -> {response.status}, len={len(html)}")
            return html


def parse_schedule(html: str):
    soup = BeautifulSoup(html, "html.parser")

    week_parity = "all"
    for item in soup.find_all("div", class_="info-block-item"):
        label = item.find("div", class_="info-block-item-label")
        value = item.find("div", class_="info-block-item-value")
        if label and value and "Показана неделя" in label.get_text():
            txt = value.get_text(strip=True).lower()
            week_parity = "odd" if "нечет" in txt else "even"

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
    lines = [day["name"], ""]
    if not day["lessons"]:
        lines.append("Занятий нет.")
        lines.append("")
        return "\n".join(lines)

    by_time = {}
    for les in day["lessons"]:
        by_time.setdefault(les["time"], []).append(les)

    for time_str in by_time:
        for les in by_time[time_str]:
            subj = les["subject"]
            if les["type"]:
                subj += f" ({les['type']})"
            lines.append(f"{time_str} {subj}")

            extras = []
            if les["teacher"]:
                extras.append(les["teacher"])
            if les["auditorium"]:
                extras.append(les["auditorium"])
            if les["subgroup"]:
                extras.append(f"подгр. {les['subgroup']}")
            if extras:
                lines.append(", ".join(extras))
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
            [KeyboardButton(text="Расписание")],
            [KeyboardButton(text="Дедлайны"), KeyboardButton(text="Помощь")],
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
    kb.append([InlineKeyboardButton(text="Назад", callback_data="back_to_institutes")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


def get_schedule_actions_keyboard(group_id: str):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="Текущая неделя", callback_data=f"week_0_{group_id}")],
        [InlineKeyboardButton(text="Следующая неделя", callback_data=f"week_1_{group_id}")],
        [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")],
    ])


# ============================================================
# ХЕНДЛЕРЫ
# ============================================================
@dp.message(CommandStart())
async def start(message: Message):
    await message.answer(
        f"Привет, {message.from_user.full_name}!\n\n"
        "Я бот для студентов ИРНИТУ. Выбери действие на клавиатуре ниже.",
        reply_markup=get_main_keyboard(),
    )


@dp.message(F.text == "Расписание")
async def show_institutes(message: Message):
    await message.answer("Выбери институт:", reply_markup=get_institutes_keyboard())


@dp.callback_query(F.data.startswith("institute_"))
async def process_institute(callback: CallbackQuery):
    institute_name = callback.data.split("_", 1)[1]
    await callback.message.edit_text(
        f"Институт: {institute_name}\n\nВыбери группу:",
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
    await callback.message.edit_text("Выбери институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()


@dp.callback_query(F.data.startswith("today_"))
async def show_today(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = _group_name_by_id(group_id)

    await callback.message.edit_text("Загружаю...")

    try:
        html = await fetch_page(group_id)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка парсинга")
        await callback.message.edit_text(
            f"Ошибка: {e}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
            ]),
        )
        await callback.answer()
        return

    today_str = _now_irkutsk().strftime("%d.%m.%Y")
    day = next((d for d in days if d["date"] == today_str), None)

    if day is None:
        text = f"Сегодня ({today_str}) занятий нет."
    else:
        text = format_day(day).strip()

    await callback.message.edit_text(
        text or "Занятий нет.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("week_"))
async def show_week(callback: CallbackQuery):
    # формат: week_{0|1}_{group_id}
    parts = callback.data.split("_", 2)
    offset = int(parts[1])
    group_id = parts[2]
    group_name = _group_name_by_id(group_id)

    await callback.message.edit_text("Загружаю...")

    today = _now_irkutsk()
    target = today + timedelta(days=7 * offset)

    try:
        html = await fetch_page(group_id, target_date=target)
        _, days = parse_schedule(html)
    except Exception as e:
        logging.exception("Ошибка парсинга")
        await callback.message.edit_text(
            f"Ошибка: {e}",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
            ]),
        )
        await callback.answer()
        return

    if not days:
        text = f"Расписание для группы {group_name} не найдено."
    else:
        title = "Текущая неделя" if offset == 0 else "Следующая неделя"
        text = f"{title}\nГруппа: {group_name}\n\n"
        text += "\n".join(format_day(d) for d in days)

    if len(text) > 4000:
        text = text[:4000] + "\n… (обрезано)"

    await callback.message.edit_text(
        text.strip(),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="Назад", callback_data=f"group_{group_id}")]
        ]),
    )
    await callback.answer()


@dp.message(F.text == "Дедлайны")
async def deadlines(message: Message):
    await message.answer("Раздел в разработке.", reply_markup=get_main_keyboard())


@dp.message(F.text == "Помощь")
async def help_cmd(message: Message):
    await message.answer(
        "Я умею:\n"
        "- Показывать расписание по группам ИАМиТ\n"
        "- Скоро: напоминать о дедлайнах\n\n"
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
