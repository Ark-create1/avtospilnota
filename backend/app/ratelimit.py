"""Просте обмеження частоти запитів у пам'яті процесу.

Обмеження: працює в межах одного процесу (при кількох воркерах чи перезапуску лічильники окремі).
За reverse-proxy (nginx) потрібно передавати справжню IP-адресу клієнта. Для великого навантаження
замініть на Redis-реалізацію (наприклад, slowapi + Redis).
"""
import os
import time
from collections import defaultdict, deque
from fastapi import Depends, HTTPException, Request


from .auth import get_current_user as _current_user  # noqa: E402


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int, message: str = "Забагато спроб, зачекайте трохи"):
        self.limit = limit
        self.window = window_seconds
        self.message = message
        self.hits = defaultdict(deque)

    def reset(self):
        self.hits.clear()

    def __call__(self, request: Request):
        if os.environ.get("AUTOSPILNOTA_DISABLE_RATELIMIT") == "1":
            return
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status_code=429, detail=self.message, headers={"Retry-After": str(self.window)})
        q.append(now)


class UserRateLimiter:
    """Ліміт створення контенту на користувача (а не на IP): захист від спаму з одного акаунта.
    Лічильники в пам'яті процесу, як і в RateLimiter. Вимикається так само: AUTOSPILNOTA_DISABLE_RATELIMIT=1."""
    registry = []

    def __init__(self, limit: int, window_seconds: int, message: str):
        self.limit = limit
        self.window = window_seconds
        self.message = message
        self.hits = defaultdict(deque)
        UserRateLimiter.registry.append(self)

    def reset(self):
        self.hits.clear()

    def __call__(self, current_user=Depends(_current_user)):
        if os.environ.get("AUTOSPILNOTA_DISABLE_RATELIMIT") == "1":
            return
        now = time.monotonic()
        q = self.hits[current_user.id]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status_code=429, detail=self.message, headers={"Retry-After": str(self.window)})
        q.append(now)


def reset_all():
    for l in UserRateLimiter.registry:
        l.reset()
