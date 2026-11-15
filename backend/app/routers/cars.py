"""Гараж: авто, записи бортжурналу, голосування за записи, стрічка білдів."""
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, votes
from ..database import get_db
from ..ratelimit import UserRateLimiter
from ..models import now_ms

router = APIRouter(prefix="/cars", tags=["garage"])

car_limiter = UserRateLimiter(10, 86400, "Забагато авто за добу, спробуйте пізніше")
entry_limiter = UserRateLimiter(20, 3600, "Забагато записів за годину, спробуйте пізніше")
garage_router = APIRouter(prefix="/garage", tags=["garage"])

DAY_MS = 86_400_000
WINDOWS = {"week": 7 * DAY_MS, "month": 30 * DAY_MS}


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _entry_out(e: models.CarEntry, score: int, mine: int) -> schemas.CarEntryOut:
    return schemas.CarEntryOut(
        id=e.id, type=e.type or "repair", title=e.title, text=e.text or "", cover=e.cover or "",
        tags=list(e.tags or []), timestamp=e.timestamp,
        score=score, my_vote=mine, liked_by_me=mine > 0, disliked_by_me=mine < 0,
    )


def _car_out(car: models.Car, db: Session, me: Optional[models.User]) -> schemas.CarOut:
    entries = sorted(car.entries, key=lambda e: e.timestamp, reverse=True)
    ids = [e.id for e in entries]
    sc = votes.scores(db, "entry", ids)
    mine = votes.my_votes(db, me, "entry", ids)
    return schemas.CarOut(
        id=car.id, owner=car.owner.name, make=car.make, model=car.model,
        engine_code=car.engine_code or "", year=car.year, mileage=car.mileage or 0, created_at=car.created_at,
        entries=[_entry_out(e, sc.get(e.id, 0), mine.get(e.id, 0)) for e in entries],
    )


def _load_car(db: Session, car_id: int) -> models.Car:
    car = (
        db.query(models.Car)
        .options(joinedload(models.Car.owner), joinedload(models.Car.entries))
        .filter(models.Car.id == car_id)
        .first()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Авто не знайдено")
    return car


@router.get("", response_model=List[schemas.CarOut])
def list_cars(
    owner: Optional[str] = None,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    q = db.query(models.Car).options(joinedload(models.Car.owner), joinedload(models.Car.entries))
    if owner:
        q = q.join(models.User, models.User.id == models.Car.owner_id).filter(models.User.name == owner)
    cars = q.order_by(models.Car.created_at.desc()).offset(offset).limit(limit).all()
    return [_car_out(c, db, me) for c in cars]


@router.post("", response_model=schemas.CarOut, status_code=201, dependencies=[Depends(car_limiter)])
def create_car(
    data: schemas.CarCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    car = models.Car(
        owner_id=current_user.id, make=data.make.strip(), model=data.model.strip(),
        engine_code=(data.engine_code or "").strip(), year=data.year, mileage=data.mileage or 0,
    )
    db.add(car)
    db.commit()
    return _car_out(_load_car(db, car.id), db, current_user)


@router.get("/{car_id}", response_model=schemas.CarOut)
def get_car(
    car_id: int,
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    return _car_out(_load_car(db, car_id), db, me)


@router.delete("/{car_id}", status_code=204)
def delete_car(
    car_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    car = _load_car(db, car_id)
    if car.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Видалити авто може лише власник або адміністратор")
    votes.clear_votes(db, "entry", [e.id for e in car.entries])
    db.delete(car)
    db.commit()


@router.post("/{car_id}/entries", response_model=schemas.CarEntryOut, status_code=201, dependencies=[Depends(entry_limiter)])
def add_entry(
    car_id: int,
    data: schemas.CarEntryCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    car = db.query(models.Car).filter(models.Car.id == car_id).first()
    if not car:
        raise HTTPException(status_code=404, detail="Авто не знайдено")
    if car.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Додавати записи може лише власник авто")
    entry = models.CarEntry(
        car_id=car.id, type=data.type, title=data.title.strip(), text=(data.text or "").strip(),
        cover=data.cover or "", tags=data.tags or [],
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_out(entry, 0, 0)


@router.delete("/{car_id}/entries/{entry_id}", status_code=204)
def delete_entry(
    car_id: int,
    entry_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    car = db.query(models.Car).filter(models.Car.id == car_id).first()
    entry = db.query(models.CarEntry).filter(models.CarEntry.id == entry_id, models.CarEntry.car_id == car_id).first()
    if not car or not entry:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    if car.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Видалити запис може лише власник або адміністратор")
    votes.clear_votes(db, "entry", [entry.id])
    db.delete(entry)
    db.commit()


@router.post("/{car_id}/entries/{entry_id}/vote", response_model=schemas.VoteResult)
def vote_entry(
    car_id: int,
    entry_id: int,
    data: schemas.VoteRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """vote: 1, -1 або 0 (зняти голос)."""
    car = db.query(models.Car).filter(models.Car.id == car_id).first()
    entry = db.query(models.CarEntry).filter(models.CarEntry.id == entry_id, models.CarEntry.car_id == car_id).first()
    if not car or not entry:
        raise HTTPException(status_code=404, detail="Запис не знайдено")
    if car.owner_id == current_user.id:
        raise HTTPException(status_code=403, detail="За свій запис голосувати не можна")
    votes.set_vote(db, current_user.id, "entry", entry.id, data.vote)
    return schemas.VoteResult(score=votes.scores(db, "entry", [entry.id]).get(entry.id, 0), my_vote=data.vote)


# ====================== Стрічка гаража ======================
def _feed_query(db: Session):
    score_sq = (
        db.query(models.Vote.target_id.label("tid"), func.sum(models.Vote.value).label("score"))
        .filter(models.Vote.target_type == "entry")
        .group_by(models.Vote.target_id)
        .subquery()
    )
    score_col = func.coalesce(score_sq.c.score, 0)
    q = (
        db.query(models.CarEntry, models.Car, models.User, score_col.label("score"))
        .join(models.Car, models.Car.id == models.CarEntry.car_id)
        .join(models.User, models.User.id == models.Car.owner_id)
        .outerjoin(score_sq, score_sq.c.tid == models.CarEntry.id)
    )
    return q, score_col


def _feed_out(rows, db: Session, me: Optional[models.User]) -> List[schemas.FeedEntryOut]:
    ids = [e.id for e, _, _, _ in rows]
    mine = votes.my_votes(db, me, "entry", ids)
    out = []
    for e, car, owner, score in rows:
        m = mine.get(e.id, 0)
        out.append(schemas.FeedEntryOut(
            id=e.id, type=e.type or "repair", title=e.title, text=e.text or "", cover=e.cover or "",
            tags=list(e.tags or []), timestamp=e.timestamp, score=int(score or 0),
            my_vote=m, liked_by_me=m > 0, disliked_by_me=m < 0,
            car_id=car.id, car_make=car.make, car_model=car.model,
            engine_code=car.engine_code or "", owner=owner.name,
        ))
    return out


@garage_router.get("/feed", response_model=List[schemas.FeedEntryOut])
def garage_feed(
    type: Optional[Literal["repair", "tuning", "project"]] = None,
    sort: Literal["new", "week", "month", "all"] = "new",
    search: Optional[str] = Query(None, max_length=100),
    tag: Optional[str] = Query(None, max_length=40),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    """sort=new — за часом; week/month/all — за рейтингом (week/month обмежують період запису)."""
    q, score_col = _feed_query(db)
    if type:
        q = q.filter(models.CarEntry.type == type)
    if search:
        like = f"%{_like_escape(search.strip())}%"
        q = q.filter(or_(
            models.CarEntry.title.ilike(like, escape="\\"),
            models.User.name.ilike(like, escape="\\"),
            models.Car.make.ilike(like, escape="\\"),
            models.Car.model.ilike(like, escape="\\"),
            models.Car.engine_code.ilike(like, escape="\\"),
        ))
    if tag:
        needle = '%"' + _like_escape(tag.strip().lower()) + '"%'
        q = q.filter(cast(models.CarEntry.tags, String).like(needle, escape="\\"))
    if sort in WINDOWS:
        q = q.filter(models.CarEntry.timestamp >= now_ms() - WINDOWS[sort])

    if sort == "new":
        q = q.order_by(models.CarEntry.timestamp.desc())
    else:
        q = q.order_by(score_col.desc(), models.CarEntry.timestamp.desc())
    rows = q.offset(offset).limit(limit).all()
    return _feed_out(rows, db, me)


@garage_router.get("/build-of-week", response_model=Optional[schemas.FeedEntryOut])
def build_of_week(
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    """Найкращий за рейтингом тюнінг або проєкт за 7 днів (лише з додатним рахунком)."""
    q, score_col = _feed_query(db)
    row = (
        q.filter(models.CarEntry.type != "repair", models.CarEntry.timestamp >= now_ms() - 7 * DAY_MS, score_col > 0)
        .order_by(score_col.desc(), models.CarEntry.timestamp.desc())
        .first()
    )
    if not row:
        return None
    return _feed_out([row], db, me)[0]


@garage_router.get("/tags", response_model=List[str])
def popular_tags(limit: int = Query(20, ge=1, le=50), db: Session = Depends(get_db)):
    """Найчастіші теги серед останніх 500 записів — для фільтра у стрічці."""
    rows = db.query(models.CarEntry.tags).order_by(models.CarEntry.timestamp.desc()).limit(500).all()
    counts: dict = {}
    for (tags,) in rows:
        for t in tags or []:
            counts[t] = counts.get(t, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [t for t, _ in ranked[:limit]]


@garage_router.get("/stats", response_model=schemas.GarageStats)
def garage_stats(db: Session = Depends(get_db)):
    return schemas.GarageStats(
        entries=db.query(func.count(models.CarEntry.id)).scalar() or 0,
        cars=db.query(func.count(models.Car.id)).scalar() or 0,
        owners=db.query(func.count(func.distinct(models.Car.owner_id))).scalar() or 0,
    )
