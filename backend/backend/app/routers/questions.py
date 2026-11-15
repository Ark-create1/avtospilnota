from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, views, votes
from ..database import get_db

router = APIRouter(prefix="/questions", tags=["questions"])


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _to_out(q: models.Question, *, likes: int = 0, liked_by_me: bool = False,
            answers_count: Optional[int] = None, with_answers: bool = True) -> schemas.QuestionOut:
    answers = []
    if with_answers:
        answers = [schemas.AnswerOut(id=a.id, author=a.author.name, text=a.text, timestamp=a.timestamp)
                   for a in sorted(q.answers, key=lambda a: a.timestamp)]
    return schemas.QuestionOut(
        id=q.id, title=q.title, text=q.text, category=q.category,
        author=q.author.name, timestamp=q.timestamp, views=q.views or 0,
        likes=likes, liked_by_me=liked_by_me, solved=bool(q.solved),
        answers_count=answers_count if answers_count is not None else len(q.answers),
        answers=answers,
    )


def _full(db: Session, question_id: int, me: Optional[models.User]) -> schemas.QuestionOut:
    q = (
        db.query(models.Question)
        .options(joinedload(models.Question.author), joinedload(models.Question.answers).joinedload(models.Answer.author))
        .filter(models.Question.id == question_id)
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Питання не знайдено")
    likes = votes.scores(db, "question", [q.id]).get(q.id, 0)
    mine = votes.my_votes(db, me, "question", [q.id]).get(q.id, 0)
    return _to_out(q, likes=likes, liked_by_me=mine > 0)


@router.get("/stats", response_model=schemas.QuestionStats)
def question_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(models.Question.id)).scalar() or 0
    solved = db.query(func.count(models.Question.id)).filter(models.Question.solved.is_(True)).scalar() or 0
    users = db.query(func.count(models.User.id)).scalar() or 0
    return schemas.QuestionStats(total=total, solved_percent=round(solved * 100 / total) if total else 0, users=users)


@router.get("", response_model=List[schemas.QuestionOut])
def list_questions(
    category: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=100),
    author: Optional[str] = Query(None, max_length=120),
    sort: Literal["new", "hot"] = "new",
    status: Literal["all", "solved", "unanswered"] = "all",
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    """sort=hot — за активністю (лайки + 2 × відповіді); status: solved — вирішені, unanswered — без відповідей."""
    likes_sq = (
        db.query(models.Vote.target_id.label("qid"), func.sum(models.Vote.value).label("likes"))
        .filter(models.Vote.target_type == "question").group_by(models.Vote.target_id).subquery()
    )
    ans_sq = (
        db.query(models.Answer.question_id.label("qid"), func.count(models.Answer.id).label("cnt"))
        .group_by(models.Answer.question_id).subquery()
    )
    likes_col = func.coalesce(likes_sq.c.likes, 0)
    ans_col = func.coalesce(ans_sq.c.cnt, 0)

    query = (
        db.query(models.Question, likes_col.label("likes"), ans_col.label("cnt"))
        .outerjoin(likes_sq, likes_sq.c.qid == models.Question.id)
        .outerjoin(ans_sq, ans_sq.c.qid == models.Question.id)
        .options(joinedload(models.Question.author))
    )
    if category:
        query = query.filter(models.Question.category == category)
    if author:
        query = query.join(models.User, models.User.id == models.Question.author_id).filter(models.User.name == author)
    if search:
        like = f"%{_like_escape(search.strip())}%"
        query = query.filter(or_(
            models.Question.title.ilike(like, escape="\\"),
            models.Question.text.ilike(like, escape="\\"),
            models.Question.category.ilike(like, escape="\\"),
        ))
    if status == "solved":
        query = query.filter(models.Question.solved.is_(True))
    elif status == "unanswered":
        query = query.filter(ans_col == 0)

    if sort == "hot":
        query = query.order_by((likes_col + 2 * ans_col).desc(), models.Question.timestamp.desc())
    else:
        query = query.order_by(models.Question.timestamp.desc())
    rows = query.offset(offset).limit(limit).all()

    mine = votes.my_votes(db, me, "question", [qq.id for qq, _, _ in rows])
    return [
        _to_out(qq, likes=int(lk or 0), liked_by_me=mine.get(qq.id, 0) > 0, answers_count=int(cnt or 0), with_answers=False)
        for qq, lk, cnt in rows
    ]


@router.post("", response_model=schemas.QuestionOut, status_code=201)
def create_question(
    data: schemas.QuestionCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    q = models.Question(
        title=data.title, text=data.text, category=data.category or "Без категорії",
        author_id=current_user.id,
    )
    db.add(q)
    db.commit()
    return _full(db, q.id, current_user)


@router.get("/{question_id}", response_model=schemas.QuestionOut)
def get_question(
    question_id: int,
    request: Request,
    db: Session = Depends(get_db),
    me: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    exists = db.query(models.Question.id).filter(models.Question.id == question_id).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Питання не знайдено")
    # один користувач (або IP) рахується раз на годину; інкремент атомарний
    if views.should_count("question", question_id, request, me):
        db.query(models.Question).filter(models.Question.id == question_id).update({models.Question.views: models.Question.views + 1})
        db.commit()
    return _full(db, question_id, me)


@router.post("/{question_id}/answers", response_model=schemas.QuestionOut, status_code=201)
def add_answer(
    question_id: int,
    data: schemas.AnswerCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Питання не знайдено")
    db.add(models.Answer(question_id=q.id, author_id=current_user.id, text=data.text))
    db.commit()
    return _full(db, q.id, current_user)


@router.post("/{question_id}/solve", response_model=schemas.QuestionOut)
def mark_solved(
    question_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Питання не знайдено")
    if q.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Лише автор може позначити питання вирішеним")
    q.solved = True
    db.commit()
    return _full(db, q.id, current_user)


@router.post("/{question_id}/like", response_model=schemas.VoteResult)
def like_question(
    question_id: int,
    data: schemas.VoteRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    """Лише лайки: vote = 1 (поставити) або 0 (зняти)."""
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Питання не знайдено")
    if data.vote < 0:
        raise HTTPException(status_code=422, detail="Для питань доступні лише лайки")
    if q.author_id == current_user.id:
        raise HTTPException(status_code=403, detail="Своє питання лайкати не можна")
    votes.set_vote(db, current_user.id, "question", q.id, data.vote)
    return schemas.VoteResult(score=votes.scores(db, "question", [q.id]).get(q.id, 0), my_vote=data.vote)
