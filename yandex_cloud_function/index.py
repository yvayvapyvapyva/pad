# Яндекс.Облако функция: сохранение/загрузка сцен в YDB (таблица "scene")
#
# Деплой:
#   1. Создайте сервисный аккаунт и выдайте ему роли ydb.admin/editor + право вызова функции IAM.
#   2. Привяжите сервисный аккаунт к облачной функции.
#   3. Укажите в переменных окружения функции:
#        YDB_ENDPOINT  — например grpcs://ydb.serverless.yandexcloud.net:2135
#        YDB_DATABASE  — например /ru-central1/b1g.../etn...
#
# Формат запроса (JSON, метод POST):
#   {"name": "scean_20260828_143512", "data": { ...состояние сцены... }}
#
# Ответы:
#   POST /            — сохранить сцену -> {"ok": true, "name": "..."}
#   GET /?name=...    — получить одну сцену -> {"ok": true, "name": "...", "data": {...}}
#   GET /             — список сцен -> {"ok": true, "scenes": [{"name": "...", "savedAt": "..."}]}
#   DELETE /?name=... — удалить сцену -> {"ok": true}

import json
import os
import urllib.request

import ydb
import ydb.credentials


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
    # IAM-токен сервисного аккаунта, привязанного к функции
    return ydb.DriverConfig(endpoint, database, credentials=_IAMCredentials())


def _ensure_table(session: ydb.Session) -> None:
    """Создаёт таблицу scene, если её ещё нет."""
    try:
        session.describe_table(_scene_path())
        return
    except Exception:
        pass
    # Таблицы не существует — создаём
    session.create_table(
        _scene_path(),
        ydb.TableDescription()
        .with_primary_keys("name")
        .with_columns(
            ydb.Column("name", ydb.OptionalType(ydb.PrimitiveType.Utf8)),
            ydb.Column("data", ydb.OptionalType(ydb.PrimitiveType.Utf8)),
        ),
    )


def _upsert_scene(session: ydb.Session, name: str, data) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    data_query = session.prepare(
        "DECLARE $name AS Utf8; "
        "DECLARE $data AS Utf8; "
        "UPSERT INTO `scene` (`name`, `data`) VALUES ($name, $data);"
    )
    session.transaction().execute(
        data_query,
        parameters={
            "$name": name,
            "$data": payload,
        },
        commit_tx=True,
    )
    return name


def _ascii(v) -> str:
    """YDB может вернуть Utf8 как str или bytes — приводим к str."""
    if isinstance(v, bytes):
        return v.decode("utf-8")
    return str(v)


def _get_scene(session: ydb.Session, name: str):
    data_query = session.prepare(
        "DECLARE $name AS Utf8; "
        "SELECT `name`, `data` FROM `scene` WHERE `name` = $name;"
    )
    result_sets = session.transaction().execute(
        data_query,
        parameters={"$name": name},
        commit_tx=True,
    )
    rows = result_sets[0].rows
    if not rows:
        return None
    return {"name": _ascii(rows[0]["name"]), "data": _ascii(rows[0]["data"])}


def _list_scenes(session: ydb.Session):
    result_sets = session.transaction().execute(
        "SELECT `name`, `data` FROM `scene`;",
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
    # Сортируем по имени, чтобы ответ был стабильным
    out.sort(key=lambda s: s["name"])
    return out


def _delete_scene(session: ydb.Session, name: str) -> bool:
    data_query = session.prepare(
        "DECLARE $name AS Utf8; "
        "DELETE FROM `scene` WHERE `name` = $name;"
    )
    session.transaction().execute(
        data_query,
        parameters={"$name": name},
        commit_tx=True,
    )
    return True


def handler(event, context):
    method = (event.get("httpMethod") or event.get("method") or "GET").upper()

    # CORS preflight — отвечаем сразу, без обращения к БД
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

    driver = None
    try:
        driver = ydb.Driver(_driver())
        driver.wait(timeout=10)
        with ydb.SessionPool(driver, size=1) as pool:
            def run(session):
                _ensure_table(session)
                return _dispatch(session, method, name, body)
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


def _dispatch(session, method, name, body):
    if method == "POST":
        if not name:
            raise ValueError("Параметр 'name' обязателен")
        data = body.get("data") if isinstance(body, dict) else body
        if data is None:
            raise ValueError("Поле 'data' обязателен")
        saved = _upsert_scene(session, name, data)
        return {"ok": True, "name": saved}

    if method == "GET":
        if name:
            scene = _get_scene(session, name)
            if scene is None:
                raise KeyError("Сцена не найдена")
            return {"ok": True, **scene}
        return {"ok": True, "scenes": _list_scenes(session)}

    if method == "DELETE":
        if not name:
            raise ValueError("Параметр 'name' обязателен")
        _delete_scene(session, name)
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
