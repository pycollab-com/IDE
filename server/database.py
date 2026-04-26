import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.exc import OperationalError as SQLAlchemyOperationalError

try:
    from psycopg2 import OperationalError as Psycopg2OperationalError
except ImportError:  # pragma: no cover - psycopg2 is installed in production
    Psycopg2OperationalError = ()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # folder of database.py
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
# Handle connection arguments based on database type
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
elif DATABASE_URL.startswith("postgresql"):
    # For PostgreSQL (including Supabase), use connection pooling
    # Supabase requires SSL/TLS for all connections
    # Ensure SSL mode is set in connection URL if not already present
    connection_url = DATABASE_URL
    if "sslmode" not in connection_url.lower():
        separator = "&" if "?" in connection_url else "?"
        connection_url = f"{connection_url}{separator}sslmode=require"
    
    engine = create_engine(
        connection_url,
        pool_pre_ping=True,  # Verify connections before using them
        pool_recycle=300,    # Recycle connections after 5 minutes
        pool_size=5,         # Maximum number of connections in pool
        max_overflow=10,     # Maximum overflow connections
        future=True
    )
else:
    engine = create_engine(DATABASE_URL, future=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def is_transient_db_startup_error(exc: Exception) -> bool:
    if not isinstance(exc, (SQLAlchemyOperationalError, Psycopg2OperationalError)):
        return False

    message = str(exc).lower()
    transient_markers = (
        "the database system is starting up",
        "connection refused",
        "could not connect to server",
        "server closed the connection unexpectedly",
        "terminating connection due to administrator command",
    )
    return any(marker in message for marker in transient_markers)
