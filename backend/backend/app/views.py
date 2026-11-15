"""Лічильник переглядів без накрутки: один користувач (або IP) рахується раз на годину.

Працює в пам'яті процесу — для перших етапів достатньо; при кількох воркерах краще Redis.
"""
import time
from typing import Optional
from fastapi import Request

from . import models

_WINDOW_S = 3600
_seen = {}


def should_count(kind: str, target_id: int, request: Request, user: Optional[models.User]) -> bool:
    ident = f"u{user.id}" if user else f"ip{request.client.host if request.client else 'unknown'}"
    key = (kind, target_id, ident)
    now = time.monotonic()
    last = _seen.get(key)
    if last is not None and now - last < _WINDOW_S:
        return False
    if len(_seen) > 20000:  # не даємо словнику рости безмежно
        for k in [k for k, t in _seen.items() if now - t >= _WINDOW_S]:
            _seen.pop(k, None)
    _seen[key] = now
    return True
