"""Адмінка: статистика, користувачі, модерація контенту, журнал дій.

Захист на сервері, а не в інтерфейсі:
  * увесь роутер вимагає мінімум модератора (dependencies на рівні роутера, забути перевірку на окремому
    ендпоінті неможливо);
  * чутливі ендпоінти (ролі, журнал) додатково вимагають власника;
  * роль береться з бази при кожному запиті, а не з токена;
  * кожна дія, що щось змінює, пишеться в audit_log.
Новий маршрут у цьому файлі треба віднести до однієї з груп у tests/smoke_admin.py, інакше тест впаде.
"""
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas, auth, votes
from ..database import get_db
from ..models import now_ms

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(auth.require_moderator)])

DAY = 86_400_000


def _log(db: Session, actor: models.User, action: str, target_type: str, target_id: int, detail: str = "") -> None:
    db.add(models.AuditLog(
        actor_id=actor.id, actor_name=actor.name, action=action,
        target_type=target_type, target_id=target_id, detail=(detail or "")[:500],
    ))


def _user_out(u: models.User, actor: models.User) -> schemas.AdminUserOut:
    return schemas.AdminUserOut(
        id=u.id, name=u.name,
        email=u.email if actor.role == "owner" else "",   # персональні дані бачить лише власник
        role=u.role, is_banned=bool(u.is_banned), created_at=int(u.created_at or 0),
    )


def _get_user(db: Session, user_id: int) -> models.User:
    u = db.query(models.User).filter(models.User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    return u


def _check_can_moderate(actor: models.User, target: models.User) -> None:
    if target.id == actor.id:
        raise HTTPException(status_code=403, detail="Не можна застосувати цю дію до себе")
    if target.role == "owner":
        raise HTTPException(status_code=403, detail="Власника не можна блокувати")
    if actor.role != "owner" and target.role != "user":
        raise HTTPException(status_code=403, detail="Модератор може блокувати лише звичайних користувачів")


# ---------- статистика ----------
@router.get("/stats", response_model=schemas.AdminStats)
def stats(db: Session = Depends(get_db)):
    now = now_ms()
    d1, d7 = now - DAY, now - 7 * DAY

    def count(model, col=None, since=None) -> int:
        q = db.query(func.count(model.id))
        if since is not None:
            q = q.filter(col >= since)
        return int(q.scalar() or 0)

    unanswered = (
        db.query(func.count(models.Question.id))
        .select_from(models.Question)
        .outerjoin(models.Answer, models.Answer.question_id == models.Question.id)
        .filter(models.Answer.id.is_(None))
        .scalar()
    )
    cats = (
        db.query(models.Question.category, func.count(models.Question.id))
        .group_by(models.Question.category)
        .order_by(func.count(models.Question.id).desc())
        .limit(5)
        .all()
    )
    return schemas.AdminStats(
        users_total=count(models.User),
        users_24h=count(models.User, models.User.created_at, d1),
        users_7d=count(models.User, models.User.created_at, d7),
        banned=int(db.query(func.count(models.User.id)).filter(models.User.is_banned.is_(True)).scalar() or 0),
        questions_total=count(models.Question),
        questions_24h=count(models.Question, models.Question.timestamp, d1),
        questions_unanswered=int(unanswered or 0),
        answers_total=count(models.Answer),
        answers_24h=count(models.Answer, models.Answer.timestamp, d1),
        topics_total=count(models.Topic),
        topics_24h=count(models.Topic, models.Topic.timestamp, d1),
        posts_total=count(models.Post),
        chat_total=count(models.ChatMessage),
        chat_24h=count(models.ChatMessage, models.ChatMessage.timestamp, d1),
        cars_total=count(models.Car),
        entries_total=count(models.CarEntry),
        masters_total=count(models.Master),
        top_categories=[{"category": c or "Без категорії", "count": int(n)} for c, n in cats],
    )


# ---------- користувачі ----------
@router.get("/users", response_model=List[schemas.AdminUserOut])
def list_users(
    search: str = Query("", max_length=100),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    actor: models.User = Depends(auth.require_moderator),
    db: Session = Depends(get_db),
):
    q = db.query(models.User)
    s = search.strip()
    if s:
        cond = models.User.name_key.contains(s.casefold(), autoescape=True)
        if actor.role == "owner":
            cond = or_(cond, models.User.email.contains(s.lower(), autoescape=True))
        q = q.filter(cond)
    users = q.order_by(models.User.id.desc()).limit(limit).offset(offset).all()
    return [_user_out(u, actor) for u in users]


@router.post("/users/{user_id}/ban", response_model=schemas.AdminUserOut)
def ban_user(
    user_id: int,
    data: schemas.BanRequest = schemas.BanRequest(),
    actor: models.User = Depends(auth.require_moderator),
    db: Session = Depends(get_db),
):
    target = _get_user(db, user_id)
    _check_can_moderate(actor, target)
    target.is_banned = True
    _log(db, actor, "ban", "user", target.id, data.reason or target.name)
    db.commit()
    return _user_out(target, actor)


@router.post("/users/{user_id}/unban", response_model=schemas.AdminUserOut)
def unban_user(
    user_id: int,
    actor: models.User = Depends(auth.require_moderator),
    db: Session = Depends(get_db),
):
    target = _get_user(db, user_id)
    _check_can_moderate(actor, target)
    target.is_banned = False
    _log(db, actor, "unban", "user", target.id, target.name)
    db.commit()
    return _user_out(target, actor)


@router.post("/users/{user_id}/role", response_model=schemas.AdminUserOut, dependencies=[Depends(auth.require_owner)])
def set_role(
    user_id: int,
    data: schemas.RoleRequest,
    actor: models.User = Depends(auth.require_owner),
    db: Session = Depends(get_db),
):
    target = _get_user(db, user_id)
    if target.id == actor.id:
        raise HTTPException(status_code=403, detail="Власник не може змінювати власну роль")
    if target.role == "owner":
        raise HTTPException(status_code=403, detail="Роль власника змінюється лише скриптом на сервері")
    old = target.role
    target.role = data.role
    _log(db, actor, "set_role", "user", target.id, f"{target.name}: {old} -> {data.role}")
    db.commit()
    return _user_out(target, actor)


# ---------- модерація контенту ----------
_RECENT = {
    "question": (models.Question, models.Question.timestamp),
    "answer": (models.Answer, models.Answer.timestamp),
    "topic": (models.Topic, models.Topic.timestamp),
    "post": (models.Post, models.Post.timestamp),
    "chat": (models.ChatMessage, models.ChatMessage.timestamp),
}


@router.get("/recent", response_model=List[schemas.AdminContentItem])
def recent(
    kind: Literal["question", "answer", "topic", "post", "chat"] = Query(...),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    model, ts = _RECENT[kind]
    rows = (
        db.query(model, models.User.name)
        .join(models.User, models.User.id == model.author_id)
        .order_by(ts.desc(), model.id.desc())
        .limit(limit)
        .all()
    )
    return [
        schemas.AdminContentItem(
            id=obj.id, kind=kind, title=getattr(obj, "title", "") or "",
            text=(getattr(obj, "text", "") or "")[:200], author=name, author_id=obj.author_id,
            timestamp=int(getattr(obj, "timestamp", 0) or 0),
        )
        for obj, name in rows
    ]


@router.delete("/content/{kind}/{item_id}", status_code=204)
def delete_content(
    kind: Literal["question", "answer", "topic", "post", "chat", "entry", "master"],
    item_id: int,
    actor: models.User = Depends(auth.require_moderator),
    db: Session = Depends(get_db),
):
    author_id = None
    snippet = ""
    if kind == "question":
        obj = db.query(models.Question).filter(models.Question.id == item_id).first()
        if obj:
            author_id, snippet = obj.author_id, obj.title
            votes.clear_votes(db, "question", [obj.id])
    elif kind == "answer":
        obj = db.query(models.Answer).filter(models.Answer.id == item_id).first()
        if obj:
            author_id, snippet = obj.author_id, obj.text
    elif kind == "topic":
        obj = db.query(models.Topic).filter(models.Topic.id == item_id).first()
        if obj:
            author_id, snippet = obj.author_id, obj.title
            votes.clear_votes(db, "post", [p.id for p in obj.posts])
            votes.clear_votes(db, "topic", [obj.id])
    elif kind == "post":
        obj = db.query(models.Post).filter(models.Post.id == item_id).first()
        if obj:
            author_id, snippet = obj.author_id, obj.text or ""
            votes.clear_votes(db, "post", [obj.id])
    elif kind == "chat":
        obj = db.query(models.ChatMessage).filter(models.ChatMessage.id == item_id).first()
        if obj:
            author_id, snippet = obj.author_id, obj.text
    elif kind == "entry":
        obj = db.query(models.CarEntry).filter(models.CarEntry.id == item_id).first()
        if obj:
            author_id, snippet = obj.car.owner_id, obj.title
            votes.clear_votes(db, "entry", [obj.id])
    else:  # master
        obj = db.query(models.Master).filter(models.Master.id == item_id).first()
        if obj:
            author_id, snippet = obj.added_by_id, obj.name
    if not obj:
        raise HTTPException(status_code=404, detail="Не знайдено")

    # модератор не може видаляти контент власника
    if author_id is not None and actor.role != "owner":
        author = db.query(models.User).filter(models.User.id == author_id).first()
        if author and author.role == "owner":
            raise HTTPException(status_code=403, detail="Не можна видаляти контент власника")

    _log(db, actor, "delete", kind, item_id, snippet)
    db.delete(obj)
    db.commit()


# ---------- журнал (лише власник) ----------
@router.get("/audit", response_model=List[schemas.AuditOut], dependencies=[Depends(auth.require_owner)])
def audit(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = db.query(models.AuditLog).order_by(models.AuditLog.id.desc()).limit(limit).offset(offset).all()
    return [
        schemas.AuditOut(
            id=r.id, actor=r.actor_name, action=r.action, target_type=r.target_type,
            target_id=r.target_id, detail=r.detail or "", timestamp=int(r.timestamp or 0),
        )
        for r in rows
    ]
