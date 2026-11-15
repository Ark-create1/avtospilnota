"""Точка входу: python -m uvicorn app.main:app --reload"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from . import models  # noqa: F401  (реєструє моделі для create_all / Alembic)
from .routers import auth, users, questions, topics, cars, masters, chat

IS_DEV = os.environ.get("AUTOSPILNOTA_ENV") == "dev"

# У розробці таблиці створюються автоматично. На продакшені схемою керують міграції: alembic upgrade head
if IS_DEV:
    Base.metadata.create_all(bind=engine)

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

for r in (auth.router, users.router, questions.router, topics.router, cars.router, cars.garage_router, masters.router, chat.router):
    app.include_router(r)


@app.get("/health", tags=["service"])
def health():
    return {"status": "ok"}
