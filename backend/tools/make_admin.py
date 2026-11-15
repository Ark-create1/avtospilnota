"""Призначення ролі користувачу з сервера (єдиний спосіб зробити власника).

Запуск з папки backend, у активованому venv:
    python -m tools.make_admin email@приклад.com owner
    python -m tools.make_admin email@приклад.com moderator
    python -m tools.make_admin email@приклад.com user
"""
import sys

from app.database import SessionLocal
from app import models

ROLES = ("owner", "moderator", "user")


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[2] not in ROLES:
        print(__doc__)
        return 2
    email, role = sys.argv[1].strip().lower(), sys.argv[2]
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            print(f"Користувача з email {email} не знайдено. Спершу зареєструйтеся на сайті.")
            return 1
        old = user.role
        user.role = role
        db.commit()
        print(f"{user.name} ({email}): {old} -> {role}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
