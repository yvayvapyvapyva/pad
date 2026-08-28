# Отправка отчётов в Telegram через бота.
#
# Использует переменные окружения:
#   TELEGRAM_BOT_TOKEN        — токен бота (общий с проверкой init_data);
#   TELEGRAM_REPORT_CHAT_ID   — chat_id, куда отправлять отчёты.
#
# Вызывается из index.py при событиях сохранения/загрузки сцен.
# Сбой отправки не должен ломать основной запрос — все ошибки глушатся.

import json
import os
import urllib.parse
import urllib.request


def send_report(user_id, action, scene_name=None, status=None, extra=None):
    """Отправляет текстовый отчёт о действии пользователя в Telegram.

    Параметры:
      user_id     — Telegram id пользователя;
      action      — тип события (например 'save' / 'load' / 'delete');
      scene_name  — имя сцены;
      status      — результат ('ok' / 'error' / и т.п.);
      extra       — дополнительный dict, добавляется в отчёт.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_REPORT_CHAT_ID")
    if not token or not chat_id:
        return False

    lines = ["📌 Сцена: " + (action or "?"), "👤 ID: " + str(user_id)]
    if scene_name:
        lines.append("🗂 Имя: " + str(scene_name))
    if status:
        lines.append("✅ Статус: " + str(status))
    if extra:
        for k, v in extra.items():
            lines.append(f"{k}: {v}")
    text = "\n".join(lines)

    url = (
        "https://api.telegram.org/bot" + token + "/sendMessage"
        + "?chat_id=" + urllib.parse.quote(str(chat_id))
        + "&text=" + urllib.parse.quote(text)
        + "&disable_web_page_preview=1"
    )
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return bool(data.get("ok"))
    except Exception:
        return False
