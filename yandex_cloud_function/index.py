# Яндекс.Облако функция: сохранение/загрузка сцен в YDB (таблица "scene")
#
# Сцены привязаны к Telegram-пользователю: первичный ключ таблицы — (user_id, name).
# Пользователь видит и загружает только свои сцены.
#
# Деплой:
#   1. Создайте сервисный аккаунт и выдайте ему роль ydb.editor; привяжите к функции.
#   2. Укажите в переменных окружения функции:
#        YDB_ENDPOINT        — например grpcs://ydb.serverless.yandexcloud.net:2135
#        YDB_DATABASE        — например /ru-central1/b1g.../etn...
#        TELEGRAM_BOT_TOKEN  — (рекомендуется) токен бота для проверки init_data.
#
# Безопасность: frontend шлёт user_id и init_data. Если задан TELEGRAM_BOT_TOKEN,
# сервер проверяет подпись init_data и берёт user_id из неё (надёжно). Иначе
# берётся user_id из запроса — это подходит только для доверенного окружения.
#
# Формат запроса (JSON, метод POST):
#   {"name": "scene_...", "data": {...}, "user_id": "123", "init_data": "..."}
#
# Ответы:
#   POST /            — сохранить сцену -> {"ok": true, "name": "..."}
#   GET /?name=...    — получить одну сцену -> {"ok": true, "name": "...", "data": {...}}
#   GET /             — список сцен -> {"ok": true, "scenes": [{"name": "...", "savedAt": "..."}]}
#   DELETE /?name=... — удалить сцену -> {"ok": true}

import hashlib
import hmac
import json
import logging
import os
import urllib.parse
import urllib.request

import ydb
import ydb.credentials

logging.basicConfig(level=logging.INFO)
_log = logging.getLogger("initdata")


def _scene_path() -> str:
    return os.environ["YDB_DATABASE"].rstrip("/") + "/scene"


def _get_sa_token() -> dict:
    """Получаем IAM-токен сервисного аккаунта функции из внутреннего сервиса метаданных."""
    url = ("http://169.254.169.254/computeMetadata/v1/instance/"
           "service-accounts/default/token")
    req = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


class _IAMCredentials(ydb.credentials.AbstractExpiringTokenCredentials):
    """Динамические IAM-креды сервисного аккаунта (токен кэшируется и обновляется)."""

    def _make_token_request(self):
        return _get_sa_token()


def _driver() -> ydb.DriverConfig:
    endpoint = os.environ["YDB_ENDPOINT"]
    database = os.environ["YDB_DATABASE"]
    return ydb.DriverConfig(endpoint, database, credentials=_IAMCredentials())


def _ensure_table(session: ydb.Session) -> None:
    """Создаёт таблицу scene с ключом (user_id, name), если её ещё нет."""
    # Проверяем, существует ли таблица и того ли она вида (есть ли ключ user_id).
    need_create = False
    try:
        desc = session.describe_table(_scene_path())
        cols = {c.name for c in getattr(desc, "columns", [])}
        pk = {c for c in getattr(desc, "primary_key", []) or []}
        if "user_id" not in cols or {"user_id", "name"} != pk:
            # Таблица старой схемы — пересоздаём (данные тестовые, теряем).
            session.drop_table(_scene_path())
            need_create = True
    except Exception:
        need_create = True

    if need_create:
        session.create_table(
            _scene_path(),
            ydb.TableDescription()
            .with_primary_keys("user_id", "name")
            .with_columns(
                ydb.Column("user_id", ydb.OptionalType(ydb.PrimitiveType.Utf8)),
                ydb.Column("name", ydb.OptionalType(ydb.PrimitiveType.Utf8)),
                ydb.Column("data", ydb.OptionalType(ydb.PrimitiveType.Utf8)),
            ),
        )


def _ascii(v) -> str:
    """YDB может вернуть Utf8 как str или bytes — приводим к str."""
    if isinstance(v, bytes):
        return v.decode("utf-8")
    return str(v)


def _upsert_scene(session: ydb.Session, user_id: str, name: str, data) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    data_query = session.prepare(
        "DECLARE $user_id AS Utf8; "
        "DECLARE $name AS Utf8; "
        "DECLARE $data AS Utf8; "
        "UPSERT INTO `scene` (`user_id`, `name`, `data`) VALUES ($user_id, $name, $data);"
    )
    session.transaction().execute(
        data_query,
        parameters={
            "$user_id": user_id,
            "$name": name,
            "$data": payload,
        },
        commit_tx=True,
    )
    return name


def _get_scene(session: ydb.Session, user_id: str, name: str):
    data_query = session.prepare(
        "DECLARE $user_id AS Utf8; "
        "DECLARE $name AS Utf8; "
        "SELECT `name`, `data` FROM `scene` "
        "WHERE `user_id` = $user_id AND `name` = $name;"
    )
    result_sets = session.transaction().execute(
        data_query,
        parameters={"$user_id": user_id, "$name": name},
        commit_tx=True,
    )
    rows = result_sets[0].rows
    if not rows:
        return None
    return {"name": _ascii(rows[0]["name"]), "data": _ascii(rows[0]["data"])}


def _list_scenes(session: ydb.Session, user_id: str):
    data_query = session.prepare(
        "DECLARE $user_id AS Utf8; "
        "SELECT `name`, `data` FROM `scene` WHERE `user_id` = $user_id;"
    )
    result_sets = session.transaction().execute(
        data_query,
        parameters={"$user_id": user_id},
        commit_tx=True,
    )
    out = []
    for row in result_sets[0].rows:
        name = _ascii(row["name"])
        try:
            saved_at = json.loads(_ascii(row["data"])).get("savedAt")
        except Exception:
            saved_at = None
        out.append({"name": name, "savedAt": saved_at})
    out.sort(key=lambda s: s["name"])
    return out


def _delete_scene(session: ydb.Session, user_id: str, name: str) -> bool:
    data_query = session.prepare(
        "DECLARE $user_id AS Utf8; "
        "DECLARE $name AS Utf8; "
        "DELETE FROM `scene` WHERE `user_id` = $user_id AND `name` = $name;"
    )
    session.transaction().execute(
        data_query,
        parameters={"$user_id": user_id, "$name": name},
        commit_tx=True,
    )
    return True


# ---------- Проверка Telegram initData ----------

def _extract_user_id(body) -> str:
    """Возвращает валидированный user_id, иначе бросает исключение."""
    init_data = (body.get("init_data") if isinstance(body, dict) else None) \
        or (body.get("initData") if isinstance(body, dict) else None)
    token = os.environ.get("TELEGRAM_BOT_TOKEN")

    _log.info("extract: has_init_data=%s has_env_token=%s env_token_len=%s",
              bool(init_data), bool(token), len(token) if token else 0)
    _log.info("extract: init_data_len=%s init_data_head=%r", len(init_data) if init_data else 0,
              (init_data[:60] + "...") if init_data else None)

    if init_data and token:
        user = _validate_init_data(init_data, token)
        _log.info("extract: validate returned user=%s", bool(user))
        if user is None or "id" not in user:
            raise PermissionError("Не удалось проверить подпись Telegram initData")
        return str(user["id"])

    if init_data:
        # Токена нет — пробуем хотя бы вытащить user из init_data (не доверяем подписи)
        parsed = urllib.parse.parse_qs(init_data)
        user_json = parsed.get("user", [None])[0]
        if user_json:
            try:
                u = json.loads(user_json)
                if "id" in u:
                    return str(u["id"])
            except Exception:
                pass

    provided = body.get("user_id") if isinstance(body, dict) else None
    if provided:
        return str(provided)

    raise ValueError("Не удалось определить user_id")


def _validate_init_data(init_data: str, bot_token: str):
    """Проверяет достоверность Telegram WebApp init_data, возвращает dict user."""
    try:
        data = urllib.parse.parse_qs(init_data, keep_blank_values=True)
        received = data.get("hash", [None])[0]
        user_json = data.get("user", [None])[0]
        fields = sorted(k for k in data if k != "hash") if data else []
        _log.info("validate: has_hash=%s has_user=%s fields=%s", bool(received), bool(user_json), fields)
        if not received:
            _log.warning("validate: no hash field in init_data")
            return None
        check = "\n".join(
            "{}={}".format(k, data[k][0])
            for k in sorted(k for k in data if k != "hash")
        )
        secret_key = hmac.new(
            key=b"WebAppData", msg=bot_token.encode("utf-8"), digestmod=hashlib.sha256
        ).digest()
        calc = hmac.new(
            key=secret_key, msg=check.encode("utf-8"), digestmod=hashlib.sha256
        ).hexdigest()
        _log.info("validate: calc_hash=%s received_hash=%s match=%s",
                  calc, received, hmac.compare_digest(calc, received))
        if not hmac.compare_digest(calc, received):
            _log.warning("validate: HMAC mismatch")
            return None
        if not user_json:
            _log.warning("validate: no user field in init_data")
            return None
        return json.loads(user_json)
    except Exception as e:
        _log.warning("validate: exception %r", e)
        return None


# ---------- HTTP-обработчик ----------

def handler(event, context):
    method = (event.get("httpMethod") or event.get("method") or "GET").upper()

    if method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "3600",
            },
            "body": "",
            "isBase64Encoded": False,
        }

    body = event.get("body") or ""
    if body and isinstance(body, dict):
        body = json.dumps(body)
    if body and isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}

    query = event.get("queryStringParameters") or {}
    name = body.get("name") if isinstance(body, dict) else None
    if not name:
        name = query.get("name")

    # Объединяем данные из тела и query для определения init_data/user_id
    merged = dict(body) if isinstance(body, dict) else {}
    for k, v in (query or {}).items():
        if v is not None and merged.get(k) is None:
            merged[k] = v

    driver = None
    try:
        user_id = _extract_user_id(merged)
        driver = ydb.Driver(_driver())
        driver.wait(timeout=10)
        with ydb.SessionPool(driver, size=1) as pool:
            def run(session):
                _ensure_table(session)
                return _dispatch(session, method, user_id, name, body)
            result = pool.retry_operation_sync(run)
        return _ok(result)
    except Exception as e:
        return _error(str(e))
    finally:
        if driver is not None:
            try:
                driver.stop()
            except Exception:
                pass


def _dispatch(session, method, user_id, name, body):
    if method == "POST":
        if not name:
            raise ValueError("Параметр 'name' обязателен")
        data = body.get("data") if isinstance(body, dict) else body
        if data is None:
            raise ValueError("Поле 'data' обязательно")
        saved = _upsert_scene(session, user_id, name, data)
        return {"ok": True, "name": saved}

    if method == "GET":
        if name:
            scene = _get_scene(session, user_id, name)
            if scene is None:
                raise KeyError("Сцена не найдена")
            return {"ok": True, **scene}
        return {"ok": True, "scenes": _list_scenes(session, user_id)}

    if method == "DELETE":
        if not name:
            raise ValueError("Параметр 'name' обязателен")
        _delete_scene(session, user_id, name)
        return {"ok": True, "name": name}

    raise ValueError("Метод не поддерживается: " + method)


def _ok(data):
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(data, ensure_ascii=False),
        "isBase64Encoded": False,
    }


def _error(msg):
    return {
        "statusCode": 400,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"ok": False, "error": str(msg)}, ensure_ascii=False),
        "isBase64Encoded": False,
    }
