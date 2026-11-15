"""Налаштування бази даних SQLAlchemy (SQLite за замовчуванням, PostgreSQL через DATABASE_URL)."""
import json
import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}")

# Деякі хостинги (Heroku, Railway) віддають адресу у вигляді postgres://, а SQLAlchemy потрібне postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}

# ensure_ascii=False: кирилиця в JSON-полях (теги, спеціалізації) зберігається читабельно й доступна для пошуку
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    json_serializer=lambda obj: json.dumps(obj, ensure_ascii=False),
)

if is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")   # SQLite за замовчуванням не перевіряє зовнішні ключі
        cur.execute("PRAGMA journal_mode=WAL")  # читання не блокується записом
        cur.close()
        # SQLite не вміє переводити кирилицю в нижній регістр (lower() і LIKE працюють лише з ASCII),
        # тому пошук «олег» не знаходив би «Олег». Підміняємо lower() на Unicode-версію.
        dbapi_conn.create_function("lower", 1, lambda s: s.lower() if isinstance(s, str) else s, deterministic=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
