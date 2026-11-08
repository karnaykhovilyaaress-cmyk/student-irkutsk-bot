import os, hmac, time, json, base64, hashlib
from types import SimpleNamespace
from aiohttp import web


def _token():
    return os.getenv("BOT_TOKEN", "")


def _web_secret():
    return hashlib.sha256(("websession:" + _token()).encode()).digest()


def make_web_token(user_id, first_name, username):
    payload = {"id": int(user_id), "fn": first_name or "", "un": username or "",
               "exp": int(time.time()) + 30 * 86400}
    body = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip("=")
    sig = hmac.new(_web_secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"web.{body}.{sig}"


def parse_web_token(tok):
    try:
        prefix, body, sig = tok.split(".")
        if prefix != "web":
            return None
        good = hmac.new(_web_secret(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, good):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload["exp"] < time.time():
            return None
        return SimpleNamespace(id=payload["id"], username=payload.get("un") or None,
                               first_name=payload.get("fn") or None, last_name=None)
    except Exception:
        return None


def verify_telegram_login(data):
    data = dict(data)
    recv_hash = data.pop("hash", None)
    if not recv_hash:
        return None
    check = "\n".join(f"{k}={data[k]}" for k in sorted(data))
    secret = hashlib.sha256(_token().encode()).digest()
    calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, recv_hash):
        return None
    try:
        if time.time() - int(data.get("auth_date", 0)) > 86400:
            return None
    except Exception:
        return None
    return data


def make_login_handler(ensure_user, update_user_meta):
    async def api_tg_login(request):
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "bad_json"}, status=400)
        d = verify_telegram_login(body)
        if not d:
            return web.json_response({"error": "unauthorized"}, status=401)
        uid = int(d["id"])
        ensure_user(uid)
        update_user_meta(uid, d.get("username"), d.get("first_name"))
        token = make_web_token(uid, d.get("first_name"), d.get("username"))
        return web.json_response({"ok": True, "token": token,
                                  "first_name": d.get("first_name"),
                                  "username": d.get("username")})
    return api_tg_login
