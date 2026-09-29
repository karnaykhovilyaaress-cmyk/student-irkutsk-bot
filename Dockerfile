FROM python:3.11-slim

WORKDIR /app

# Устанавливаем зависимости
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь код
COPY . .

# BotHost ожидает, что приложение слушает порт из переменной PORT
EXPOSE 3000

# Запускаем именно Python
CMD ["python", "bot.py"]
