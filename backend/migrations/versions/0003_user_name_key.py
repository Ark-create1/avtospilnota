"""user name key: унікальне ім'я користувача без урахування регістру

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) додаємо колонку без обмежень, щоб заповнити її для вже існуючих користувачів
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('name_key', sa.String(length=120), nullable=True))

    # 2) заповнюємо name_key (casefold у Python — SQLite не вміє переводити кирилицю в нижній регістр)
    bind = op.get_bind()
    users = bind.execute(sa.text("SELECT id, name FROM users")).fetchall()
    seen = {}
    for uid, name in users:
        key = (name or '').strip().casefold()
        if key in seen:
            raise RuntimeError(
                f"Користувачі з id {seen[key]} та {uid} мають однакове ім'я «{name}». "
                "Перейменуйте одного з них у базі й повторіть міграцію."
            )
        seen[key] = uid
        bind.execute(sa.text("UPDATE users SET name_key = :k WHERE id = :i"), {"k": key, "i": uid})

    # 3) тепер можна зробити колонку обов'язковою й унікальною
    with op.batch_alter_table('users') as batch:
        batch.alter_column('name_key', existing_type=sa.String(length=120), nullable=False)
        batch.create_index('ix_users_name_key', ['name_key'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_index('ix_users_name_key')
        batch.drop_column('name_key')
