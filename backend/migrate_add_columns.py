from urllib.parse import urlparse
import pg8000.native

DATABASE_URL = "postgresql://ledger_db_9enm_user:5s3gd5930LWaRgxf85HoJbpUnbE1kulV@dpg-d9td1bajobas73cltek0-a.oregon-postgres.render.com/ledger_db_9enm"

url = urlparse(DATABASE_URL)

conn = pg8000.native.Connection(
    user=url.username,
    password=url.password,
    host=url.hostname,
    port=url.port or 5432,
    database=url.path.lstrip("/"),
)

info = conn.run("SELECT current_database(), current_user;")
print("Connected to:", info)

tables = conn.run("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
print("Tables in this database:", [t[0] for t in tables])

conn.close()