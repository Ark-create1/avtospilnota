"""Хешування паролів та JWT-токени."""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from . import models

# Секрет підпису токенів. Без нього застосунок не стартує: інакше будь-хто міг би підробити токен (зокрема адміна).
# Локально для розробки: AUTOSPILNOTA_ENV=dev (тоді береться тимчасовий ключ).
_secret = os.environ.get("AUTOSPILNOTA_SECRET_KEY")
if not _secret:
    if os.environ.get("AUTOSPILNOTA_ENV") == "dev":
        _secret = "dev-only-secret-not-for-production"
    else:
        raise RuntimeError(
            "Не задано AUTOSPILNOTA_SECRET_KEY (довгий випадковий рядок). "
            "Для локальної розробки встановіть AUTOSPILNOTA_ENV=dev."
        )
SECRET_KEY = _secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 днів

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        return None


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Потрібна авторизація",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exc
    user_id = decode_token(token)
    if user_id is None:
        raise credentials_exc
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise credentials_exc
    return user


def get_current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    if not token:
        return None
    user_id = decode_token(token)
    if user_id is None:
        return None
    return db.query(models.User).filter(models.User.id == user_id).first()


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Потрібні права адміністратора")
    return user
