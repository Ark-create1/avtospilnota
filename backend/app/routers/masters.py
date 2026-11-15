"""Майстри (СТО) на карті."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
from ..database import get_db
from ..ratelimit import UserRateLimiter

router = APIRouter(prefix="/masters", tags=["masters"])

master_limiter = UserRateLimiter(5, 86400, "Забагато СТО за добу, спробуйте пізніше")


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _out(m: models.Master) -> schemas.MasterOut:
    return schemas.MasterOut(
        id=m.id, name=m.name, address=m.address, phone=m.phone or "",
        specialization=list(m.specialization or []), description=m.description or "",
        lat=m.lat, lng=m.lng, added_by=m.added_by.name if m.added_by else None, created_at=m.created_at,
    )


@router.get("", response_model=List[schemas.MasterOut])
def list_masters(
    search: Optional[str] = Query(None, max_length=100),
    specialization: Optional[str] = Query(None, max_length=60),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(models.Master).options(joinedload(models.Master.added_by))
    if search:
        like = f"%{_like_escape(search.strip())}%"
        q = q.filter(or_(models.Master.name.ilike(like, escape="\\"), models.Master.address.ilike(like, escape="\\")))
    if specialization:
        needle = '%"' + _like_escape(specialization.strip()) + '"%'
        q = q.filter(cast(models.Master.specialization, String).like(needle, escape="\\"))
    return [_out(m) for m in q.order_by(models.Master.created_at.desc()).offset(offset).limit(limit).all()]


@router.post("", response_model=schemas.MasterOut, status_code=201, dependencies=[Depends(master_limiter)])
def create_master(
    data: schemas.MasterCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    m = models.Master(
        name=data.name.strip(), address=data.address.strip(), phone=(data.phone or "").strip(),
        specialization=[s.strip() for s in (data.specialization or []) if s and s.strip()],
        description=(data.description or "").strip(), lat=data.lat, lng=data.lng,
        added_by_id=current_user.id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _out(m)


@router.delete("/{master_id}", status_code=204)
def delete_master(
    master_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    m = db.query(models.Master).filter(models.Master.id == master_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="СТО не знайдено")
    if m.added_by_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Видалити може лише той, хто додав, або адміністратор")
    db.delete(m)
    db.commit()
