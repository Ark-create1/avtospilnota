"""Голосування: один користувач — один голос за ціль (гарантується унікальним індексом у базі)."""
from typing import Dict, Iterable, Optional
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models


def set_vote(db: Session, user_id: int, target_type: str, target_id: int, value: int) -> None:
    """value: 1, -1 або 0 (зняти голос). Повторний виклик ідемпотентний."""
    existing = (
        db.query(models.Vote)
        .filter_by(user_id=user_id, target_type=target_type, target_id=target_id)
        .first()
    )
    if value == 0:
        if existing:
            db.delete(existing)
            db.commit()
        return
    if existing:
        existing.value = value
        db.commit()
        return
    db.add(models.Vote(user_id=user_id, target_type=target_type, target_id=target_id, value=value))
    try:
        db.commit()
    except IntegrityError:
        # одночасний запит устиг створити голос раніше — просто оновлюємо його
        db.rollback()
        existing = (
            db.query(models.Vote)
            .filter_by(user_id=user_id, target_type=target_type, target_id=target_id)
            .first()
        )
        if existing:
            existing.value = value
            db.commit()


def scores(db: Session, target_type: str, ids: Iterable[int]) -> Dict[int, int]:
    ids = list(ids)
    if not ids:
        return {}
    rows = (
        db.query(models.Vote.target_id, func.sum(models.Vote.value))
        .filter(models.Vote.target_type == target_type, models.Vote.target_id.in_(ids))
        .group_by(models.Vote.target_id)
        .all()
    )
    return {tid: int(total or 0) for tid, total in rows}


def my_votes(db: Session, user: Optional[models.User], target_type: str, ids: Iterable[int]) -> Dict[int, int]:
    ids = list(ids)
    if user is None or not ids:
        return {}
    rows = (
        db.query(models.Vote.target_id, models.Vote.value)
        .filter(models.Vote.user_id == user.id, models.Vote.target_type == target_type, models.Vote.target_id.in_(ids))
        .all()
    )
    return {tid: int(v) for tid, v in rows}


def clear_votes(db: Session, target_type: str, target_ids: Iterable[int]) -> None:
    ids = list(target_ids)
    if ids:
        db.query(models.Vote).filter(models.Vote.target_type == target_type, models.Vote.target_id.in_(ids)).delete(synchronize_session=False)
