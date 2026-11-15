"""Загальний чат. Поки що опитування (polling): GET /chat?after_id=N повертає лише нові повідомлення.
Пізніше замінюється на WebSocket без зміни формату повідомлень."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
from ..database import get_db
from ..models import now_ms

router = APIRouter(prefix="/chat", tags=["chat"])

MIN_GAP_MS = 1500
BURST_LIMIT = 5
BURST_WINDOW_MS = 10_000
DUP_WINDOW_MS = 30_000


def _out(m: models.ChatMessage) -> schemas.ChatMessageOut:
    return schemas.ChatMessageOut(id=m.id, author=m.author.name, text=m.text, timestamp=m.timestamp)


@router.get("", response_model=List[schemas.ChatMessageOut])
def list_messages(
    after_id: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(models.ChatMessage).options(joinedload(models.ChatMessage.author))
    if after_id:
        msgs = q.filter(models.ChatMessage.id > after_id).order_by(models.ChatMessage.id.asc()).limit(limit).all()
    else:
        msgs = list(reversed(q.order_by(models.ChatMessage.id.desc()).limit(limit).all()))
    return [_out(m) for m in msgs]


@router.post("", response_model=schemas.ChatMessageOut, status_code=201)
def send_message(
    data: schemas.ChatMessageCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    text = " ".join(data.text.split())
    if not text:
        raise HTTPException(status_code=422, detail="Напишіть повідомлення")

    now = now_ms()
    recent = (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.author_id == current_user.id, models.ChatMessage.timestamp >= now - DUP_WINDOW_MS)
        .order_by(models.ChatMessage.timestamp.desc())
        .all()
    )
    if recent and now - recent[0].timestamp < MIN_GAP_MS:
        raise HTTPException(status_code=429, detail="Не так швидко, зачекайте секунду")
    if sum(1 for m in recent if now - m.timestamp < BURST_WINDOW_MS) >= BURST_LIMIT:
        raise HTTPException(status_code=429, detail="Забагато повідомлень, трохи зачекайте")
    if any(m.text == text for m in recent):
        raise HTTPException(status_code=429, detail="Не повторюйте те саме повідомлення")

    msg = models.ChatMessage(author_id=current_user.id, text=text)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return _out(msg)
