"""Точка входу: python -m uvicorn app.main:app --reload"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from . import models  # noqa: F401  (реєструє моделі для create_all / Alembic)
from .routers import auth, users, questions, topics, cars, masters, chat, admin

IS_DEV = os.environ.get("AUTOSPILNOTA_ENV") == "dev"

# У розробці таблиці створюються автоматично. На продакшені схемою керують міграції: alembic upgrade head


def _dev_upgrade_schema():
    """Лише для розробки на SQLite: create_all не змінює вже існуючі таблиці, тому стара локальна база
    (з колонкою is_admin) без цього падала б після появи ролей. На продакшені це робить міграція 0004."""
    if engine.dialect.name != "sqlite":
        return
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    try:
        with engine.begin() as conn:
            if "role" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'"))
                if "is_admin" in cols:
                    conn.execute(text("UPDATE users SET role = 'owner' WHERE is_admin = 1"))
            if "is_banned" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_banned BOOLEAN NOT NULL DEFAULT 0"))
            if "is_admin" in cols:
                conn.execute(text("ALTER TABLE users DROP COLUMN is_admin"))
    except Exception as e:  # стара SQLite без DROP COLUMN тощо
        print("[dev] Не вдалося оновити локальну базу автоматично:", e)
        print("[dev] Видаліть backend/app.db (дані розробки зникнуть) і запустіть знову.")


if IS_DEV:
    Base.metadata.create_all(bind=engine)
    _dev_upgrade_schema()

app = FastAPI(title="АвтоСпільнота API")

# CORS: з яких адрес фронтенд може звертатися до API (через кому). Токен передається в заголовку, не в cookie.
_default_origins = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000"
origins = [o.strip() for o in os.environ.get("AUTOSPILNOTA_CORS_ORIGINS", _default_origins).split(",") if o.strip()]
if IS_DEV:
    origins.append("null")  # сторінки, відкриті прямо з диска (file://)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

for r in (auth.router, users.router, questions.router, topics.router, cars.router, cars.garage_router, masters.router, chat.router, admin.router):
    app.include_router(r)


@app.get("/health", tags=["service"])
def health():
    return {"status": "ok"}
