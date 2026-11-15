from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .. import models, schemas, auth
from ..database import get_db
from ..ratelimit import RateLimiter

router = APIRouter(prefix="/auth", tags=["auth"])

# З однієї IP-адреси: не більше 10 спроб входу на хвилину і 5 реєстрацій за 10 хвилин
login_limiter = RateLimiter(10, 60, "Забагато спроб входу, зачекайте хвилину")
register_limiter = RateLimiter(5, 600, "Забагато реєстрацій з цієї адреси, спробуйте пізніше")


@router.post("/register", response_model=schemas.TokenResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(register_limiter)])
def register(data: schemas.UserRegister, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == data.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Користувач з таким email вже існує")
    if db.query(models.User).filter(models.User.name_key == data.name.strip().casefold()).first():
        raise HTTPException(status_code=400, detail="Це ім'я вже зайняте. Додайте, наприклад, друге ім'я чи місто")

    user = models.User(
        name=data.name.strip(),
        name_key=data.name.strip().casefold(),
        email=data.email.lower(),
        password_hash=auth.hash_password(data.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # одночасна реєстрація з тим самим email або ім'ям
        db.rollback()
        raise HTTPException(status_code=400, detail="Користувач з таким email або іменем вже існує")
    db.refresh(user)

    token = auth.create_access_token(user.id)
    return schemas.TokenResponse(access_token=token, user=schemas.UserPublic.model_validate(user))


@router.post("/login", response_model=schemas.TokenResponse, dependencies=[Depends(login_limiter)])
def login(data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email.lower()).first()
    if not user or not auth.verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Невірний email або пароль")
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Акаунт заблоковано")

    token = auth.create_access_token(user.id)
    return schemas.TokenResponse(access_token=token, user=schemas.UserPublic.model_validate(user))


@router.get("/me", response_model=schemas.UserPublic)
def me(current_user: models.User = Depends(auth.get_current_user)):
    return schemas.UserPublic.model_validate(current_user)
