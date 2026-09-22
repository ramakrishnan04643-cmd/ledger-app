"""
One-off app-lock reset.

Your password is stored only as a one-way PBKDF2 hash, so it can't be read
back. This script instead CLEARS the stored hash so the app returns to its
"first run" state and lets you set a brand-new password.

It ONLY nulls out settings.password_hash. It does NOT touch any of your
ledger data (people, payments, expenses, savings, categories) or the other
settings values (cash balance, savings goal, current savings).

Usage (run from the backend/ folder, pointed at your live database):

    # Windows PowerShell:
    $env:DATABASE_URL = "postgresql://<paste EXTERNAL url from Render>"
    python reset_password.py

    # macOS / Linux:
    export DATABASE_URL="postgresql://<paste EXTERNAL url from Render>"
    python reset_password.py

DATABASE_URL is read by database.py exactly the way the running app reads it,
so this hits the same Postgres your phone talks to. After it finishes, open
the app and it will prompt you to choose a NEW password.
"""
import os
import sys

# Reuse the app's own DB setup (handles postgres:// -> postgresql:// and .env).
from database import SessionLocal, DATABASE_URL
import models


def _masked(url: str) -> str:
    """Show which DB we're about to touch without printing the password."""
    if "@" in url and "://" in url:
        scheme, rest = url.split("://", 1)
        creds, host = rest.split("@", 1)
        user = creds.split(":", 1)[0] if ":" in creds else creds
        return f"{scheme}://{user}:****@{host}"
    return url


def main() -> int:
    print(f"Target database: {_masked(DATABASE_URL)}")
    if DATABASE_URL.startswith("sqlite"):
        print("  (This is a LOCAL SQLite file, not your Render database. If you meant\n"
              "   to reset the deployed app, set DATABASE_URL to the EXTERNAL Render URL first.)")

    db = SessionLocal()
    try:
        settings = db.query(models.Settings).first()
        if settings is None:
            print("No settings row exists yet — there's no password to clear.")
            print("Just open the app; it will ask you to set one.")
            return 0
        if not settings.password_hash:
            print("No password is currently set.")
            print("Just open the app; it will ask you to set one.")
            return 0

        confirm = input("A password IS set. Clear it so you can choose a new one? [y/N] ").strip().lower()
        if confirm not in ("y", "yes"):
            print("Aborted. Nothing was changed.")
            return 1

        settings.password_hash = None
        db.commit()
        print("\nDone. The app lock has been cleared.")
        print("Open the app on your phone — it will now prompt you to set a NEW password.")
        print("All of your ledger data is untouched.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
