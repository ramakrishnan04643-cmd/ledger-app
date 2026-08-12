"""
Password protection — currently DISABLED.

The app was originally built with password protection (see git history /
the commented-out logic below if you ever want it back). It's switched off
here so the app loads straight in with no login screen.

⚠️ If this is deployed somewhere with a public URL (e.g. Render), disabling
this means anyone with the link can view and edit all the data — there's no
protection at all. Fine for purely local/private use; not fine for a public
deployment with real financial data in it.
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
    # Password protection disabled — every request passes through.
    return
