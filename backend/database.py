"""
Database setup.

Locally, this defaults to a single SQLite file (ledger.db) — simple, no
setup needed.

On a host with an ephemeral filesystem (like Render's free tier), SQLite
is NOT safe: the file gets wiped every time the service restarts or spins
back up after idling, silently erasing all your data. For anywhere you
need data to actually survive, set the DATABASE_URL environment variable
to a real hosted Postgres connection string (e.g. from Neon or Supabase's
free tiers) and this will use that instead automatically.
"""
import os
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # Render (and some other hosts) hand out URLs starting with
    # "postgres://", but SQLAlchemy 2.x requires the "postgresql://" form.
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    DB_PATH = os.getenv("LEDGER_DB_PATH", os.path.join(os.path.dirname(__file__), "ledger.db"))
    DATABASE_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},  # needed for SQLite + FastAPI's threadpool
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
