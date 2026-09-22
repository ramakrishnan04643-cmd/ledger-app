"""
Cloud backup: dump every table of the ledger database to a JSON file.

Run by .github/workflows/backup.yml on a schedule. Reads the connection string
from the DATABASE_URL environment variable (a GitHub Actions secret) and writes
the dump to the path given as the first argument. Deliberately prints no data
and no connection string, so it's safe even in public Actions logs.

    python scripts/cloud_backup.py ledger-backup-2026-09-22.json
"""
import os
import sys
import ssl
import json
import datetime
import decimal
from urllib.parse import urlparse, unquote

import pg8000.dbapi


def jsonable(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", "replace")
    return v


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set"); return 1
    out = sys.argv[1] if len(sys.argv) > 1 else "ledger-backup.json"

    p = urlparse(url)
    kw = dict(
        user=unquote(p.username or ""),
        password=unquote(p.password or ""),
        host=p.hostname,
        port=p.port or 5432,
        database=(p.path or "/").lstrip("/"),
        timeout=30,
    )
    try:
        conn = pg8000.dbapi.connect(ssl_context=ssl.create_default_context(), **kw)
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = pg8000.dbapi.connect(ssl_context=ctx, **kw)

    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    tables = [r[0] for r in cur.fetchall()]

    dump = {"_meta": {
        "backed_up_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "tables": tables,
    }}
    total = 0
    for t in tables:
        cur.execute(f'SELECT * FROM "{t}"')
        cols = [d[0] for d in cur.description]
        dump[t] = [dict(zip(cols, (jsonable(v) for v in row))) for row in cur.fetchall()]
        total += len(dump[t])

    with open(out, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=2)

    cur.close(); conn.close()
    print(f"Backup complete: {len(tables)} tables, {total} rows -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
