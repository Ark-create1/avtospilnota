"""Форум: теми, відповіді, голосування (▲/▼ за теми, лайки за відповіді), модерація."""
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, votes, views
from ..database import get_db
from ..ratelimit import UserRateLimiter
from ..models import now_ms

router = APIRouter(prefix="/topics", tags=["forum"])

topic_limiter = UserRateLimiter(6, 3600, "Забагато тем за годину, спробуйте пізніше")
post_limiter = UserRateLimiter(40, 3600, "Забагато повідомлень у темах за годину, спробуйте пізніше")

DAY_MS = 86_400_000
WINDOWS = {"week": 7 * DAY_MS, "month": 30 * DAY_MS}


def _post_out(p: models.Post, likes: int, mine: int) -> schemas.PostOut:
    return schemas.PostOut(
        id=p.id, author=p.author.name, text=p.text or "",
        quote_author=p.quote_author or "", quote_text=p.quote_text or "",
        photo_url=p.photo_url or "", youtube_id=p.youtube_id or "",
        timestamp=p.timestamp, likes_count=likes, liked_by_me=mine > 0,
    )


def _topic_out(t: models.Topic, *, score: int, my_vote: int, posts_count: int,
               posts: Optional[List[schemas.PostOut]] = None,
               last_author: str = "", last_text: str = "", participants: Optional[List[str]] = None) -> schemas.TopicOut:
    return schemas.TopicOut(
        id=t.id, title=t.title, text=t.text or "", category=t.category or "", subcategory=t.subcategory or "",
        photo_url=t.photo_url or "", youtube_id=t.youtube_id or "", author=t.author.name,
        timestamp=t.timestamp, views=t.views or 0, pinned=bool(t.pinned), closed=bool(t.closed),
        score=score, my_vote=my_vote, posts_count=posts_count,
        last_post_author=last_author, last_post_text=last_text,
        participants=participants or [t.author.name], posts=posts or [],
    )


def _full_topic(db: Session, topic_id: int, me: Optional[models.User]) -> schemas.TopicOut:
    t = (
        db.query(models.Topic)
        .options(joinedload(models.Topic.author), joinedload(models.Topic.posts).joinedload(models.Post.author))
        .filter(models.Topic.id == topic_id)
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    posts = sorted(t.posts, key=lambda p: p.timestamp)
    pids = [p.id for p in posts]
    likes = votes.scores(db, "post", pids)
    mine = votes.my_votes(db, me, "post", pids)
    t_score = votes.scores(db, "topic", [t.id]).get(t.id, 0)
    t_mine = votes.my_votes(db, me, "topic", [t.id]).get(t.id, 0)
    last = posts[-1] if posts else None
    return _topic_out(
        t, score=t_score, my_vote=t_mine, posts_count=len(posts),
        posts=[_post_out(p, likes.get(p.id, 0), mine.get(p.id, 0)) for p in posts],
        last_author=last.author.name if last else "", last_text=(last.text or "")[:200] if last else "",
        participants=_participants(t, posts),
    )


def _participants(t: models.Topic, posts: List[models.Post]) -> List[str]:
    people = [t.author.name]
    for p in reversed(posts):
        if len(people) >= 3:
            break
        if p.author.name not in people:
            people.append(p.author.name)
    return people


@router.get("", response_model=List[schemas.TopicOut])
def list_topics(
    category: Optional[str] = None,
    subcategory: Optional[str] = None,
    sort: Literal["new", "week", "month", "all"] = "new",
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    """sort=new — за часом; week/month/all — за рейтингом (week/month обмежують період створення теми).
    Закріплені теми завжди першими."""
    score_sq = (
        db.query(models.Vote.target_id.label("tid"), func.sum(models.Vote.value).label("score"))
        .filter(models.Vote.target_type == "topic")
        .group_by(models.Vote.target_id)
        .subquery()
    )
    score_col = func.coalesce(score_sq.c.score, 0)
    q = (
        db.query(models.Topic, score_col.label("score"))
        .outerjoin(score_sq, score_sq.c.tid == models.Topic.id)
        .options(joinedload(models.Topic.author))
    )
    if category:
        q = q.filter(models.Topic.category == category)
    if subcategory:
        q = q.filter(models.Topic.subcategory == subcategory)
    if sort in WINDOWS:
        q = q.filter(models.Topic.timestamp >= now_ms() - WINDOWS[sort])

    if sort == "new":
        q = q.order_by(models.Topic.pinned.desc(), models.Topic.timestamp.desc())
    else:
        q = q.order_by(models.Topic.pinned.desc(), score_col.desc(), models.Topic.timestamp.desc())
    rows = q.offset(offset).limit(limit).all()

    ids = [t.id for t, _ in rows]
    counts = dict(
        db.query(models.Post.topic_id, func.count(models.Post.id))
        .filter(models.Post.topic_id.in_(ids)).group_by(models.Post.topic_id).all()
    ) if ids else {}
    posts_by_topic = {}
    if ids:
        for p in (
            db.query(models.Post).options(joinedload(models.Post.author))
            .filter(models.Post.topic_id.in_(ids)).order_by(models.Post.timestamp.asc()).all()
        ):
            posts_by_topic.setdefault(p.topic_id, []).append(p)
    mine = votes.my_votes(db, me, "topic", ids)

    out = []
    for t, score in rows:
        plist = posts_by_topic.get(t.id, [])
        last = plist[-1] if plist else None
        out.append(_topic_out(
            t, score=int(score or 0), my_vote=mine.get(t.id, 0), posts_count=counts.get(t.id, 0),
            last_author=last.author.name if last else "", last_text=(last.text or "")[:200] if last else "",
            participants=_participants(t, plist),
        ))
    return out


@router.post("", response_model=schemas.TopicOut, status_code=201, dependencies=[Depends(topic_limiter)])
def create_topic(
    data: schemas.TopicCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    t = models.Topic(
        title=data.title.strip(), text=(data.text or "").strip(),
        category=data.category or "", subcategory=data.subcategory or "",
        photo_url=data.photo_url or "", youtube_id=data.youtube_id or "",
        author_id=current_user.id,
    )
    db.add(t)
    db.commit()
    return _full_topic(db, t.id, current_user)


@router.get("/{topic_id}", response_model=schemas.TopicOut)
def get_topic(
    topic_id: int,
    request: Request,
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    exists = db.query(models.Topic.id).filter(models.Topic.id == topic_id).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    if views.should_count("topic", topic_id, request, me):
        # атомарний інкремент: без гонок між одночасними запитами
        db.query(models.Topic).filter(models.Topic.id == topic_id).update({models.Topic.views: models.Topic.views + 1})
        db.commit()
    return _full_topic(db, topic_id, me)


@router.post("/{topic_id}/posts", response_model=schemas.TopicOut, status_code=201, dependencies=[Depends(post_limiter)])
def add_post(
    topic_id: int,
    data: schemas.PostCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    if t.closed:
        raise HTTPException(status_code=403, detail="Тема закрита")
    text = (data.text or "").strip()
    if not text and not data.photo_url and not data.youtube_id:
        raise HTTPException(status_code=422, detail="Напишіть відповідь")
    db.add(models.Post(
        topic_id=t.id, author_id=current_user.id, text=text,
        quote_author=data.quote_author or "", quote_text=data.quote_text or "",
        photo_url=data.photo_url or "", youtube_id=data.youtube_id or "",
    ))
    db.commit()
    return _full_topic(db, t.id, current_user)


@router.post("/{topic_id}/vote", response_model=schemas.VoteResult)
def vote_topic(
    topic_id: int,
    data: schemas.VoteRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """vote: 1 (▲), -1 (▼) або 0 (зняти голос)."""
    t = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    if t.author_id == current_user.id:
        raise HTTPException(status_code=403, detail="За свою тему голосувати не можна")
    votes.set_vote(db, current_user.id, "topic", t.id, data.vote)
    return schemas.VoteResult(score=votes.scores(db, "topic", [t.id]).get(t.id, 0), my_vote=data.vote)


@router.post("/{topic_id}/posts/{post_id}/like", response_model=schemas.VoteResult)
def like_post(
    topic_id: int,
    post_id: int,
    data: schemas.VoteRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Для відповідей лише лайки: vote = 1 або 0."""
    p = db.query(models.Post).filter(models.Post.id == post_id, models.Post.topic_id == topic_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Відповідь не знайдено")
    if data.vote < 0:
        raise HTTPException(status_code=422, detail="Для відповідей доступні лише лайки")
    if p.author_id == current_user.id:
        raise HTTPException(status_code=403, detail="За свою відповідь голосувати не можна")
    votes.set_vote(db, current_user.id, "post", p.id, data.vote)
    return schemas.VoteResult(score=votes.scores(db, "post", [p.id]).get(p.id, 0), my_vote=data.vote)


@router.patch("/{topic_id}/moderate", response_model=schemas.TopicOut)
def moderate_topic(
    topic_id: int,
    data: schemas.TopicModerate,
    admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    t = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    if data.pinned is not None:
        t.pinned = data.pinned
    if data.closed is not None:
        t.closed = data.closed
    db.commit()
    return _full_topic(db, t.id, admin)


@router.delete("/{topic_id}", status_code=204)
def delete_topic(
    topic_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    t = db.query(models.Topic).filter(models.Topic.id == topic_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Тему не знайдено")
    if t.author_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Видалити тему може лише автор або адміністратор")
    votes.clear_votes(db, "post", [p.id for p in t.posts])
    votes.clear_votes(db, "topic", [t.id])
    db.delete(t)
    db.commit()
