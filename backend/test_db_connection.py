"""
Test whether DATABASE_URL is valid and reachable — run this LOCALLY before
setting it on Render, so you catch mistakes in seconds instead of waiting
on a deploy each time.

Usage:
    cd backend
    ../venv/bin/pip install psycopg2-binary sqlalchemy   # if not already installed
    DATABASE_URL="postgresql://postgres:yourpassword@db.xxxx.supabase.co:5432/postgres" ../venv/bin/python test_db_connection.py
    (Windows: set DATABASE_URL=... then venv\\Scripts\\python test_db_connection.py)
"""
import os
import sys

url = os.getenv("DATABASE_URL")

if not url:
    print("❌ DATABASE_URL is not set. Set it in your terminal first, e.g.:")
    print('   DATABASE_URL="postgresql://postgres:yourpassword@host:5432/postgres" python test_db_connection.py')
    sys.exit(1)

check_url = url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url

# --- Step 1: does the URL even parse the way you'd expect? ---
# Uses SQLAlchemy's own parser (not Python's generic urlparse) so this
# exactly matches what create_engine() will actually do with it.
from sqlalchemy.engine import make_url

try:
    parsed = make_url(check_url)
except Exception as e:
    print(f"❌ SQLAlchemy couldn't even parse this as a URL: {e}")
    print()
    print("Check for: extra quotes around the value, a trailing newline/space from copy-paste,")
    print("or a missing '://' after the scheme.")
    sys.exit(1)

print("Parsed connection details:")
print(f"  scheme:   {parsed.drivername}")
print(f"  username: {parsed.username}")
print(f"  password: {'(set, hidden)' if parsed.password else '(MISSING)'}")
print(f"  host:     {parsed.host}")
print(f"  port:     {parsed.port}")
print(f"  database: {parsed.database}")
print()

problems = []
if not parsed.username:
    problems.append("No username found — check there's a ':' between the scheme and username.")
if not parsed.password:
    problems.append("No password found — check there's a ':' between username and password.")
if not parsed.host or "@" in (parsed.host or ""):
    problems.append(f"Host looks wrong ('{parsed.host}') — an '@' in the host usually means "
                     "your password (or username) contains a character (@, :, /, #, ?) that needs URL-encoding.")
if not parsed.database:
    problems.append("No database name found at the end of the URL.")

if problems:
    print("⚠️  Found likely problems with the URL format:")
    for p in problems:
        print(f"   - {p}")
    print()
    print("If your password contains special characters, URL-encode it. For example, in Python:")
    print("   from urllib.parse import quote_plus; print(quote_plus('your@password'))")
    print()

# --- Step 2: actually try to connect ---
print("Attempting to connect...")
try:
    from sqlalchemy import create_engine, text
    engine = create_engine(check_url, pool_pre_ping=True)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1"))
        result.fetchone()
    print("✅ Connected successfully! This DATABASE_URL is good to use on Render.")
except Exception as e:
    print(f"❌ Connection failed: {e}")
    print()
    print("Common fixes:")
    print("  - Double check you copied the FULL connection string, not a truncated version")
    print("  - Make sure there are no extra spaces, quotes, or line breaks around the value")
    print("  - If using Supabase, try the 'Connection pooling' string instead of the direct one")
    print("  - Confirm the database is actually running (check your Neon/Supabase dashboard)")
    sys.exit(1)
