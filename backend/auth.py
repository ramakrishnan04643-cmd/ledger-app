"""
Minimal single-user password protection.

- Password is hashed (PBKDF2-SHA256) and stored in the settings table.
- On login, we issue a signed, httponly cookie (via itsdangerous) — no server
  session store needed, and it can't be read or forged from JS in the browser.
- Every API route (except /api/auth/*) requires a valid cookie.
"""
import os
import hashlib
import hmac
import secrets
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session

from database import get_db
import models

SECRET_KEY = os.getenv("LEDGER_SECRET_KEY")
if not SECRET_KEY:
    # Falls back to a random key generated at process start. This means
    # sessions won't survive a server restart unless you set
    # LEDGER_SECRET_KEY yourself in .env — recommended for real use.
    SECRET_KEY = secrets.token_hex(32)

serializer = URLSafeTimedSerializer(SECRET_KEY, salt="ledger-session")
COOKIE_NAME = "ledger_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(check.hex(), digest_hex)


def create_session_token() -> str:
    return serializer.dumps({"authed": True})


def verify_session_token(token: str) -> bool:
    try:
        data = serializer.loads(token, max_age=SESSION_MAX_AGE)
        return bool(data.get("authed"))
    except (BadSignature, SignatureExpired):
        return False


def require_auth(request: Request, db: Session = Depends(get_db)) -> None:
    settings = db.query(models.Settings).first()

    # First run: no password set yet — everything is open until you set one
    # via POST /api/auth/set-password. This keeps first-time setup simple.
    if settings is None or not settings.password_hash:
        return

    token = request.cookies.get(COOKIE_NAME)
    if not token or not verify_session_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
