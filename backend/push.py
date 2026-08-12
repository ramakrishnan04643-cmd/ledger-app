"""
Push notifications for due-date reminders.

Uses standard Web Push (VAPID) — no third-party notification service, no
account needed anywhere. A keypair is generated once on first run and saved
locally so your phone's subscription stays valid across server restarts.

Requires HTTPS (or localhost) to work in the browser — see README for the
Tailscale HTTPS note if you're accessing this over your private network.
"""
import os
import json
import base64
import logging
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from pywebpush import webpush, WebPushException

logger = logging.getLogger("ledger.push")

VAPID_FILE = os.path.join(os.path.dirname(__file__), "vapid_keys.json")
VAPID_CLAIMS_EMAIL = os.getenv("LEDGER_VAPID_EMAIL", "mailto:ledger@localhost")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def get_or_create_vapid_keys() -> dict:
    """Returns {"private_key": <raw base64url, what pywebpush expects>,
    "public_key": <base64url, browser-ready>}.
    Generated once and cached to disk — regenerating would silently break
    every phone that already subscribed."""
    if os.path.exists(VAPID_FILE):
        with open(VAPID_FILE) as f:
            return json.load(f)

    vapid = Vapid01()
    vapid.generate_keys()

    private_value = vapid.private_key.private_numbers().private_value
    private_raw = private_value.to_bytes(32, "big")

    raw_public = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    data = {"private_key": _b64url(private_raw), "public_key": _b64url(raw_public)}
    with open(VAPID_FILE, "w") as f:
        json.dump(data, f)
    return data


def send_notification(subscription_info: dict, title: str, body: str) -> bool:
    """Sends one push notification. Returns False (and logs) on failure —
    e.g. the subscription expired — rather than raising, since one bad
    subscription shouldn't block others in a batch send."""
    keys = get_or_create_vapid_keys()
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body}),
            vapid_private_key=keys["private_key"],
            vapid_claims={"sub": VAPID_CLAIMS_EMAIL},
        )
        return True
    except WebPushException as e:
        logger.warning("Push failed for %s: %s", subscription_info.get("endpoint", "?")[:60], e)
        return False
