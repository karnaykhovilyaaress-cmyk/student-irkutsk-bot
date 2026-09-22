import time
import asyncio
import os
import aiohttp
from datetime import datetime, timedelta, timezone
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup


# --- НАСТРОЙКИ ---
TOKEN = "8953672814:AAGUOY7EI5CSY_M9ecKLzYchVyL1ZCfyX1Y"

bot = Bot(token=TOKEN)
dp = Dispatcher()

# --- ДАННЫЕ О ГРУППАХ (ИАМиТ, 1 курс) ---
GROUPS = {
    "ИАМиТ": [
        {"name": "АСПм-26-1", "id": "478012"},
        {"name": "АТПРб-26-1", "id": "478049"},
        {"name": "ЛИМб-26-1", "id": "478284"},
        {"name": "МИРб-26-1", "id": "478310"},
        {"name": "ММб-26-1", "id": "478314"},
        {"name": "МТб-26-1", "id": "478318"},
        {"name": "ППТм-26-1", "id": "478441"},
        {"name": "СДМ-26-1", "id": "478478"},
        {"name": "СМ-26-1", "id": "478493"},
        {"name": "СМ-26-2", "id": "478494"},
        {"name": "СМ-26-3", "id": "479896"},
        {"name": "ТЭАм-26-1", "id": "478548"},
        {"name": "УКб-26-1", "id": "478551"},
        {"name": "ЦПКм-26-1", "id": "478601"},
        {"name": "ЭЛб-26-1", "id": "478640"},
    ]
}

# --- ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ РАСПИСАНИЯ ---
async def fetch_schedule(group_id: str, date: datetime):
    url = "https://www.istu.edu/Sys/Module/ScheduleClassList/v2/calendar.ajax.php"
    params = {
        "group_id": group_id,
        "date": date.strftime("%Y-%m-%d"),
        "_": int(time.time() * 1000)  # Добавляем временную метку
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    return None
    except Exception as e:
        print(f"Ошибка при запросе расписания: {e}")
        return None

# --- ФОРМАТИРОВАНИЕ РАСПИСАНИЯ ---
def format_schedule(data, date: datetime, group_name: str):
    """Преобразует данные из JSON в читаемый текст."""
    if not data or not data.get("dates"):
        return f"📅 На {date.strftime('%d.%m.%Y')} для группы {group_name} занятий нет."

    text = f"📅 Расписание для группы {group_name} на {date.strftime('%d.%m.%Y')}:\n\n"
    
    # Здесь будет логика обработки данных из JSON.
    # Пока структура JSON неизвестна, поэтому выводим заглушку.
    # Когда семестр начнётся, нужно будет посмотреть реальный JSON и распарсить его.
    for day in data["dates"]:
        # Предполагаем, что в day есть список пар
        # Это нужно будет уточнить, когда появятся реальные данные
        text += "Данные о парах появятся после начала семестра.\n"
        break
    
    return text

# --- СОСТОЯНИЯ (FSM) ---
class UserState(StatesGroup):
    waiting_for_group = State()

# --- КЛАВИАТУРЫ ---
def get_main_keyboard():
    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📅 Расписание")],
            [KeyboardButton(text="📝 Дедлайны"), KeyboardButton(text="ℹ️ Помощь")]
        ],
        resize_keyboard=True
    )
    return keyboard

def get_institutes_keyboard():
    institutes = list(GROUPS.keys())
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=inst, callback_data=f"institute_{inst}")] for inst in institutes
    ])
    return keyboard

def get_groups_keyboard(institute_name):
    groups = GROUPS.get(institute_name, [])
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=group["name"], callback_data=f"group_{group['id']}")] for group in groups
    ])
    keyboard.inline_keyboard.append([InlineKeyboardButton(text="⬅️ Назад к институтам", callback_data="back_to_institutes")])
    return keyboard

def get_schedule_actions_keyboard(group_id):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📅 Расписание на сегодня", callback_data=f"today_{group_id}")],
        [InlineKeyboardButton(text="📅 Расписание на неделю", callback_data=f"week_{group_id}")],
        [InlineKeyboardButton(text="⬅️ Назад к группам", callback_data="back_to_groups")]
    ])
    return keyboard

# --- ХЕНДЛЕРЫ ---

@dp.message(CommandStart())
async def start(message: Message):
    await message.answer(
        f"Привет, {message.from_user.full_name}! Я бот для студентов ИРНИТУ.\n\n"
        "Выбери действие на клавиатуре ниже:",
        reply_markup=get_main_keyboard()
    )

@dp.message(F.text == "📅 Расписание")
async def show_institutes(message: Message):
    await message.answer("Выбери свой институт:", reply_markup=get_institutes_keyboard())

@dp.callback_query(F.data.startswith("institute_"))
async def process_institute(callback: CallbackQuery):
    institute_name = callback.data.split("_", 1)[1]
    await callback.message.edit_text(
        f"Институт: **{institute_name}**\n\nВыбери свою группу:",
        reply_markup=get_groups_keyboard(institute_name),
        parse_mode="Markdown"
    )
    await callback.answer()

@dp.callback_query(F.data.startswith("group_"))
async def process_group(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = "Неизвестная группа"
    for inst_groups in GROUPS.values():
        for group in inst_groups:
            if group["id"] == group_id:
                group_name = group["name"]
                break
    
    await callback.message.edit_text(
        f"Группа: **{group_name}**\n\nЧто показать?",
        reply_markup=get_schedule_actions_keyboard(group_id),
        parse_mode="Markdown"
    )
    await callback.answer()

@dp.callback_query(F.data == "back_to_institutes")
async def back_to_institutes(callback: CallbackQuery):
    await callback.message.edit_text("Выбери свой институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()

@dp.callback_query(F.data == "back_to_groups")
async def back_to_groups(callback: CallbackQuery):
    await callback.message.edit_text("Выбери свой институт:", reply_markup=get_institutes_keyboard())
    await callback.answer()

@dp.callback_query(F.data.startswith("today_"))
async def show_today(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = "Неизвестная группа"
    for inst_groups in GROUPS.values():
        for group in inst_groups:
            if group["id"] == group_id:
                group_name = group["name"]
                break
    
    await callback.message.edit_text("Загружаю расписание...")
    
    today = datetime.now(timezone.utc) + timedelta(hours=8)
    data = await fetch_schedule(group_id, today)
    text = format_schedule(data, today, group_name)
    
    await callback.message.edit_text(
        text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data="back_to_groups")]
        ])
    )
    await callback.answer()

@dp.callback_query(F.data.startswith("week_"))
async def show_week(callback: CallbackQuery):
    group_id = callback.data.split("_", 1)[1]
    group_name = "Неизвестная группа"
    for inst_groups in GROUPS.values():
        for group in inst_groups:
            if group["id"] == group_id:
                group_name = group["name"]
                break
    
    await callback.message.edit_text("Загружаю расписание на неделю...")
    
    # Получаем расписание на каждый день недели, начиная с сегодня
    today = datetime.now(timezone.utc) + timedelta(hours=8)
    week_text = f"📅 Расписание для группы {group_name} на неделю:\n\n"
    
    for i in range(7):
        current_date = today + timedelta(days=i)
        data = await fetch_schedule(group_id, current_date)
        day_text = format_schedule(data, current_date, group_name)
        week_text += day_text + "\n\n"
    
    await callback.message.edit_text(
        week_text,
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Назад", callback_data="back_to_groups")]
        ])
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
        "• (Скоро) Напоминать о дедлайнах\n\n"
        "Просто нажимай кнопки.",
        reply_markup=get_main_keyboard()
    )

# --- ЗАПУСК ---
async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
