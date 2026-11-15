from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, votes
from ..database import get_db

router = APIRouter(prefix="/users", tags=["users"])


# Важливо: цей маршрут має стояти ПЕРЕД "/{name}", інакше "me" сприймається як ім'я користувача
@router.get("/me", response_model=schemas.UserPublic)
def my_profile(current_user: models.User = Depends(auth.get_current_user)):
    return schemas.UserPublic.model_validate(current_user)


@router.get("/me/stats", response_model=schemas.MyStats)
def my_stats(current_user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Скільки питань і відповідей у поточного користувача — для лічильників у бічній панелі."""
    return schemas.MyStats(
        questions=db.query(func.count(models.Question.id)).filter(models.Question.author_id == current_user.id).scalar() or 0,
        answers=db.query(func.count(models.Answer.id)).filter(models.Answer.author_id == current_user.id).scalar() or 0,
    )


@router.get("/{name}", response_model=schemas.UserProfile)
def get_profile(name: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.name == name).first()
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    # Публічно: без email; телефон лише якщо власник дозволив
    return schemas.UserProfile(
        id=user.id, name=user.name, is_admin=user.is_admin,
        city=user.city or "", bio=user.bio or "", experience=user.experience or "",
        phone=(user.phone or "") if user.show_phone else "",
    )


@router.patch("/me", response_model=schemas.UserPublic)
def update_my_profile(
    data: schemas.ProfileUpdate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return schemas.UserPublic.model_validate(current_user)


PROFILE_LIST_LIMIT = 50


def _reputation(db: Session, user_id: int) -> int:
    """Репутація = сума голосів за контент користувача: теми, записи гаража, питання (лайки) та відповіді на форумі."""
    def total(target_type: str, ids_query) -> int:
        return db.query(func.coalesce(func.sum(models.Vote.value), 0)).filter(
            models.Vote.target_type == target_type, models.Vote.target_id.in_(ids_query)
        ).scalar() or 0

    return int(
        total("topic", db.query(models.Topic.id).filter(models.Topic.author_id == user_id))
        + total("post", db.query(models.Post.id).filter(models.Post.author_id == user_id))
        + total("question", db.query(models.Question.id).filter(models.Question.author_id == user_id))
        + total("entry", db.query(models.CarEntry.id).join(models.Car, models.Car.id == models.CarEntry.car_id).filter(models.Car.owner_id == user_id))
    )


@router.get("/{name}/profile", response_model=schemas.ProfilePage)
def get_profile_page(name: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.name == name).first()
    if not user:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    uid = user.id
    limit = PROFILE_LIST_LIMIT

    def count(model, *conds):
        return db.query(func.count(model.id)).filter(*conds).scalar() or 0

    # авто та записи
    cars = db.query(models.Car).filter(models.Car.owner_id == uid).order_by(models.Car.created_at.desc()).limit(limit).all()
    entries_by_car = dict(
        db.query(models.CarEntry.car_id, func.count(models.CarEntry.id))
        .join(models.Car, models.Car.id == models.CarEntry.car_id).filter(models.Car.owner_id == uid)
        .group_by(models.CarEntry.car_id).all()
    )
    entry_rows = (
        db.query(models.CarEntry, models.Car)
        .join(models.Car, models.Car.id == models.CarEntry.car_id).filter(models.Car.owner_id == uid)
        .order_by(models.CarEntry.timestamp.desc()).limit(limit).all()
    )
    entry_scores = votes.scores(db, "entry", [e.id for e, _ in entry_rows])

    # питання й відповіді
    questions = db.query(models.Question).filter(models.Question.author_id == uid).order_by(models.Question.timestamp.desc()).limit(limit).all()
    qids = [q.id for q in questions]
    answers_count = dict(
        db.query(models.Answer.question_id, func.count(models.Answer.id))
        .filter(models.Answer.question_id.in_(qids)).group_by(models.Answer.question_id).all()
    ) if qids else {}
    q_likes = votes.scores(db, "question", qids)
    answer_rows = (
        db.query(models.Answer, models.Question.title)
        .join(models.Question, models.Question.id == models.Answer.question_id)
        .filter(models.Answer.author_id == uid).order_by(models.Answer.timestamp.desc()).limit(limit).all()
    )

    # теми
    topics = db.query(models.Topic).filter(models.Topic.author_id == uid).order_by(models.Topic.timestamp.desc()).limit(limit).all()
    tids = [t.id for t in topics]
    posts_count = dict(
        db.query(models.Post.topic_id, func.count(models.Post.id))
        .filter(models.Post.topic_id.in_(tids)).group_by(models.Post.topic_id).all()
    ) if tids else {}
    t_scores = votes.scores(db, "topic", tids)

    stats = schemas.ProfileStats(
        cars=count(models.Car, models.Car.owner_id == uid),
        entries=db.query(func.count(models.CarEntry.id)).join(models.Car, models.Car.id == models.CarEntry.car_id).filter(models.Car.owner_id == uid).scalar() or 0,
        questions=count(models.Question, models.Question.author_id == uid),
        answers=count(models.Answer, models.Answer.author_id == uid),
        topics=count(models.Topic, models.Topic.author_id == uid),
        reputation=_reputation(db, uid),
    )
    return schemas.ProfilePage(
        user=schemas.UserProfile(
            id=user.id, name=user.name, is_admin=user.is_admin,
            city=user.city or "", bio=user.bio or "", experience=user.experience or "",
            phone=(user.phone or "") if user.show_phone else "",
        ),
        stats=stats,
        cars=[schemas.ProfileCar(id=c.id, make=c.make, model=c.model, engine_code=c.engine_code or "", year=c.year,
                                 mileage=c.mileage or 0, entries_count=entries_by_car.get(c.id, 0), created_at=c.created_at) for c in cars],
        entries=[schemas.ProfileEntry(id=e.id, car_id=car.id, car_name=f"{car.make} {car.model}", type=e.type or "repair",
                                      title=e.title, text=e.text or "", cover=e.cover or "", tags=list(e.tags or []),
                                      timestamp=e.timestamp, score=entry_scores.get(e.id, 0)) for e, car in entry_rows],
        questions=[schemas.ProfileQuestion(id=q.id, title=q.title, category=q.category or "", timestamp=q.timestamp, views=q.views or 0,
                                           solved=bool(q.solved), likes=q_likes.get(q.id, 0), answers_count=answers_count.get(q.id, 0)) for q in questions],
        answers=[schemas.ProfileAnswer(id=a.id, text=a.text, timestamp=a.timestamp, question_id=a.question_id, question_title=title) for a, title in answer_rows],
        topics=[schemas.ProfileTopic(id=t.id, title=t.title, text=t.text or "", category=t.category or "", subcategory=t.subcategory or "",
                                     timestamp=t.timestamp, views=t.views or 0, pinned=bool(t.pinned), closed=bool(t.closed),
                                     posts_count=posts_count.get(t.id, 0), score=t_scores.get(t.id, 0)) for t in topics],
    )
