"""ролі користувачів, блокування й журнал дій персоналу

Revision ID: 0004
Revises: 0003

users.is_admin (bool) замінено на users.role: user | moderator | owner.
Усі, у кого було is_admin = true, стають власниками (owner).
Додано users.is_banned і таблицю audit_log.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('role', sa.String(length=20), nullable=False, server_default='user'))
        batch.add_column(sa.Column('is_banned', sa.Boolean(), nullable=False, server_default=sa.false()))

    # переносимо старих адмінів у власники
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE users SET role = 'owner' WHERE is_admin = :t"), {"t": True})

    with op.batch_alter_table('users') as batch:
        batch.drop_column('is_admin')

    op.create_table(
        'audit_log',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('actor_name', sa.String(length=120), nullable=False),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('target_type', sa.String(length=20), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('timestamp', sa.BigInteger(), nullable=True),
    )
    op.create_index('ix_audit_log_actor_id', 'audit_log', ['actor_id'])
    op.create_index('ix_audit_log_timestamp', 'audit_log', ['timestamp'])


def downgrade() -> None:
    op.drop_index('ix_audit_log_timestamp', table_name='audit_log')
    op.drop_index('ix_audit_log_actor_id', table_name='audit_log')
    op.drop_table('audit_log')

    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('is_admin', sa.Boolean(), nullable=False, server_default=sa.false()))

    bind = op.get_bind()
    bind.execute(sa.text("UPDATE users SET is_admin = :t WHERE role IN ('moderator', 'owner')"), {"t": True})

    with op.batch_alter_table('users') as batch:
        batch.drop_column('is_banned')
        batch.drop_column('role')
