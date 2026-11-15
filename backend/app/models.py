"""SQLAlchemy-моделі для АвтоСпільноти."""
import time
from sqlalchemy import Column, Integer, BigInteger, Float, String, Text, Boolean, ForeignKey, UniqueConstraint, Index, false
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON
from .database import Base


def now_ms() -> int:
    return int(time.time() * 1000)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    # Ім'я в «згорнутому» вигляді (casefold) з унікальним індексом: профілі, «Додав:» і автори скрізь
    # ідентифікуються за ім'ям, тому два «Олег Коваль» (чи «Адмін» і «адмін») створювали б плутанину й підміну.
    # Рахуємо в Python, а не в базі: SQLite не вміє переводити кирилицю в нижній регістр.
    name_key = Column(String(120), unique=True, index=True, nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    # Роль: user | moderator | owner. Змінюється лише власником (адмінка) або скриптом tools/make_admin.py.
    role = Column(String(20), default="user", nullable=False, server_default="user")
    is_banned = Column(Boolean, default=False, nullable=False, server_default=false())
    created_at = Column(BigInteger, default=now_ms)

    # профіль
    city = Column(String(120), default="")
    bio = Column(Text, default="")
    experience = Column(String(120), default="")
    phone = Column(String(60), default="")
    show_phone = Column(Boolean, default=False)

    @property
    def is_admin(self) -> bool:
        """Сумісність зі старим кодом: «персонал» = модератор або власник."""
        return self.role in ("moderator", "owner")

    questions = relationship("Question", back_populates="author", cascade="all, delete-orphan")
    answers = relationship("Answer", back_populates="author", cascade="all, delete-orphan")
    topics = relationship("Topic", back_populates="author", cascade="all, delete-orphan")
    posts = relationship("Post", back_populates="author", cascade="all, delete-orphan")
    cars = relationship("Car", back_populates="owner", cascade="all, delete-orphan")
    masters = relationship("Master", back_populates="added_by", cascade="all, delete-orphan")
    chat_messages = relationship("ChatMessage", back_populates="author", cascade="all, delete-orphan")
    votes = relationship("Vote", back_populates="user", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    text = Column(Text, nullable=False)
    category = Column(String(120), default="Без категорії")
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    timestamp = Column(BigInteger, default=now_ms)
    views = Column(Integer, default=0)
    solved = Column(Boolean, default=False)

    author = relationship("User", back_populates="questions")
    answers = relationship("Answer", back_populates="question", cascade="all, delete-orphan")


class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    timestamp = Column(BigInteger, default=now_ms)

    question = relationship("Question", back_populates="answers")
    author = relationship("User", back_populates="answers")


class Topic(Base):
    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(Text, nullable=False)
    text = Column(Text, default="")
    category = Column(String(120), default="")
    subcategory = Column(String(120), default="")
    photo_url = Column(Text, default="")
    youtube_id = Column(String(60), default="")
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    timestamp = Column(BigInteger, default=now_ms)
    views = Column(Integer, default=0)
    pinned = Column(Boolean, default=False)
    closed = Column(Boolean, default=False)

    author = relationship("User", back_populates="topics")
    posts = relationship("Post", back_populates="topic", cascade="all, delete-orphan")


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(Integer, ForeignKey("topics.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, default="")
    quote_author = Column(String(120), default="")
    quote_text = Column(Text, default="")
    photo_url = Column(Text, default="")
    youtube_id = Column(String(60), default="")
    timestamp = Column(BigInteger, default=now_ms)

    topic = relationship("Topic", back_populates="posts")
    author = relationship("User", back_populates="posts")


class Car(Base):
    __tablename__ = "cars"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    make = Column(String(120), nullable=False)
    model = Column(String(120), nullable=False)
    engine_code = Column(String(60), default="")
    year = Column(Integer, nullable=True)
    mileage = Column(Integer, default=0)
    created_at = Column(BigInteger, default=now_ms)

    owner = relationship("User", back_populates="cars")
    entries = relationship("CarEntry", back_populates="car", cascade="all, delete-orphan")


class CarEntry(Base):
    __tablename__ = "car_entries"

    id = Column(Integer, primary_key=True, index=True)
    car_id = Column(Integer, ForeignKey("cars.id"), nullable=False)
    type = Column(String(30), default="repair")
    title = Column(Text, nullable=False)
    text = Column(Text, default="")
    cover = Column(Text, default="")
    tags = Column(JSON, default=list)
    timestamp = Column(BigInteger, default=now_ms)

    car = relationship("Car", back_populates="entries")


class Master(Base):
    __tablename__ = "masters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    address = Column(String(300), nullable=False)
    phone = Column(String(60), default="")
    specialization = Column(JSON, default=list)
    description = Column(Text, default="")
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    added_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(BigInteger, default=now_ms)

    added_by = relationship("User", back_populates="masters")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    timestamp = Column(BigInteger, default=now_ms)

    author = relationship("User", back_populates="chat_messages")


class Vote(Base):
    """Один голос користувача за одну ціль. Унікальність (користувач, ціль) гарантує база даних,
    тому «один користувач — один голос» не можна обійти ні гонкою запитів, ні подвійним кліком."""
    __tablename__ = "votes"
    __table_args__ = (
        UniqueConstraint("user_id", "target_type", "target_id", name="uq_vote_user_target"),
        Index("ix_votes_target", "target_type", "target_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type = Column(String(20), nullable=False)   # topic | post | entry
    target_id = Column(Integer, nullable=False)
    value = Column(Integer, nullable=False)            # +1 або -1
    timestamp = Column(BigInteger, default=now_ms)

    user = relationship("User", back_populates="votes")


class AuditLog(Base):
    """Журнал дій персоналу: хто, що і з чим зробив. Записи не видаляються й не редагуються через API."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    actor_name = Column(String(120), nullable=False)      # копія імені на момент дії
    action = Column(String(40), nullable=False)           # ban | unban | set_role | delete
    target_type = Column(String(20), nullable=False)      # user | question | answer | topic | post | chat | entry | master
    target_id = Column(Integer, nullable=False)
    detail = Column(Text, default="")
    timestamp = Column(BigInteger, default=now_ms, index=True)
