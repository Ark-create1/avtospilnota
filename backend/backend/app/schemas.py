"""Pydantic-схеми запитів/відповідей."""
import re
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator

# Допустиме посилання на зображення: http(s) або data:image (поки фото зберігаються як base64).
# Це серверна перевірка: фронтенд теж перевіряє, але довіряти лише йому не можна.
MAX_IMAGE_FIELD = 1_500_000
_IMG_URL_RE = re.compile(r"^(https?://|data:image/)", re.IGNORECASE)
_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _check_image(v: Optional[str]) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    if len(v) > MAX_IMAGE_FIELD:
        raise ValueError("Зображення завелике")
    if not _IMG_URL_RE.match(v):
        raise ValueError("Посилання на фото має починатися з http://, https:// або data:image/")
    return v


def _check_youtube(v: Optional[str]) -> str:
    v = (v or "").strip()
    if v and not _YT_ID_RE.match(v):
        raise ValueError("Некоректний id відео YouTube")
    return v


# ---------- Users / Auth ----------
class UserRegister(BaseModel):
    name: str = Field(max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Вкажіть ім'я")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: EmailStr
    is_admin: bool
    city: str = ""
    bio: str = ""
    experience: str = ""
    phone: str = ""
    show_phone: bool = False


class UserProfile(BaseModel):
    """Те, що бачать усі: без email, телефон лише якщо власник дозволив показ."""
    id: int
    name: str
    is_admin: bool = False
    city: str = ""
    bio: str = ""
    experience: str = ""
    phone: str = ""


class ProfileStats(BaseModel):
    cars: int = 0
    entries: int = 0
    questions: int = 0
    answers: int = 0
    topics: int = 0
    reputation: int = 0


class ProfileCar(BaseModel):
    id: int
    make: str
    model: str
    engine_code: str = ""
    year: Optional[int] = None
    mileage: int = 0
    entries_count: int = 0
    created_at: int


class ProfileEntry(BaseModel):
    id: int
    car_id: int
    car_name: str
    type: str
    title: str
    text: str = ""
    cover: str = ""
    tags: List[str] = []
    timestamp: int
    score: int = 0


class ProfileQuestion(BaseModel):
    id: int
    title: str
    category: str = ""
    timestamp: int
    views: int = 0
    solved: bool = False
    likes: int = 0
    answers_count: int = 0


class ProfileAnswer(BaseModel):
    id: int
    text: str
    timestamp: int
    question_id: int
    question_title: str


class ProfileTopic(BaseModel):
    id: int
    title: str
    text: str = ""
    category: str = ""
    subcategory: str = ""
    timestamp: int
    views: int = 0
    pinned: bool = False
    closed: bool = False
    posts_count: int = 0
    score: int = 0


class ProfilePage(BaseModel):
    """Усе, що потрібно сторінці профілю, одним запитом (списки — до 50 останніх елементів)."""
    user: "UserProfile"
    stats: ProfileStats
    cars: List[ProfileCar] = []
    entries: List[ProfileEntry] = []
    questions: List[ProfileQuestion] = []
    answers: List[ProfileAnswer] = []
    topics: List[ProfileTopic] = []


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class ProfileUpdate(BaseModel):
    city: Optional[str] = Field(default=None, max_length=120)
    bio: Optional[str] = Field(default=None, max_length=2000)
    experience: Optional[str] = Field(default=None, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=60)
    show_phone: Optional[bool] = None


# ---------- Questions ----------
class QuestionCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    text: str = Field(min_length=1, max_length=10000)
    category: Optional[str] = Field(default="Без категорії", max_length=120)

    @field_validator("title", "text")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Поле не може бути порожнім")
        return v


class AnswerCreate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)

    @field_validator("text")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Відповідь не може бути порожньою")
        return v


class AnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    author: str
    text: str
    timestamp: int


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    text: str
    category: str
    author: str
    timestamp: int
    views: int
    likes: int = 0
    liked_by_me: bool = False
    solved: bool
    answers_count: int = 0
    answers: List[AnswerOut] = []   # у списку питань порожній (достатньо answers_count), у питанні — повний


class QuestionStats(BaseModel):
    total: int
    solved_percent: int
    users: int


class MyStats(BaseModel):
    questions: int
    answers: int


# ---------- Forum (Topics/Posts) ----------
class TopicCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: Optional[str] = Field(default="", max_length=20000)
    category: Optional[str] = Field(default="", max_length=120)
    subcategory: Optional[str] = Field(default="", max_length=120)
    photo_url: Optional[str] = ""
    youtube_id: Optional[str] = ""

    _v_photo = field_validator("photo_url")(lambda cls, v: _check_image(v))
    _v_yt = field_validator("youtube_id")(lambda cls, v: _check_youtube(v))


class PostCreate(BaseModel):
    text: Optional[str] = Field(default="", max_length=10000)
    quote_author: Optional[str] = Field(default="", max_length=120)
    quote_text: Optional[str] = Field(default="", max_length=500)
    photo_url: Optional[str] = ""
    youtube_id: Optional[str] = ""

    _v_photo = field_validator("photo_url")(lambda cls, v: _check_image(v))
    _v_yt = field_validator("youtube_id")(lambda cls, v: _check_youtube(v))


class VoteRequest(BaseModel):
    vote: int = Field(ge=-1, le=1)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    author: str
    text: str
    quote_author: str = ""
    quote_text: str = ""
    photo_url: str = ""
    youtube_id: str = ""
    timestamp: int
    likes_count: int = 0
    liked_by_me: bool = False


class GarageStats(BaseModel):
    entries: int
    cars: int
    owners: int


class VoteResult(BaseModel):
    score: int
    my_vote: int = 0   # -1, 0 або 1


class TopicModerate(BaseModel):
    pinned: Optional[bool] = None
    closed: Optional[bool] = None


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    text: str
    category: str
    subcategory: str
    photo_url: str
    youtube_id: str
    author: str
    timestamp: int
    views: int
    pinned: bool
    closed: bool
    score: int = 0
    my_vote: int = 0
    posts_count: int = 0
    # для стрічки тем: прев'ю останньої відповіді та учасники (автор теми + до двох останніх)
    last_post_author: str = ""
    last_post_text: str = ""
    participants: List[str] = []
    posts: List[PostOut] = []


# ---------- Garage (Cars/Entries) ----------
class CarCreate(BaseModel):
    make: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=120)
    engine_code: Optional[str] = Field(default="", max_length=60)
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    mileage: Optional[int] = Field(default=0, ge=0, le=5_000_000)


class CarEntryCreate(BaseModel):
    type: Literal["repair", "tuning", "project"] = "repair"
    title: str = Field(min_length=1, max_length=200)
    text: Optional[str] = Field(default="", max_length=10000)
    cover: Optional[str] = ""
    tags: Optional[List[str]] = Field(default_factory=list, max_length=10)

    _v_cover = field_validator("cover")(lambda cls, v: _check_image(v))

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v):
        return [t.strip().lower()[:40] for t in (v or []) if t and t.strip()]


class CarEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    title: str
    text: str
    cover: str
    tags: List[str] = []
    timestamp: int
    score: int = 0
    my_vote: int = 0
    liked_by_me: bool = False
    disliked_by_me: bool = False


class FeedEntryOut(CarEntryOut):
    """Запис бортжурналу разом із даними авто — для стрічки гаража."""
    car_id: int
    car_make: str
    car_model: str
    engine_code: str = ""
    owner: str


class CarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    owner: str
    make: str
    model: str
    engine_code: str
    year: Optional[int]
    mileage: int
    created_at: int
    entries: List[CarEntryOut] = []


# ---------- Masters ----------
class MasterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=300)
    phone: Optional[str] = Field(default="", max_length=60)
    specialization: Optional[List[str]] = Field(default_factory=list, max_length=15)
    description: Optional[str] = Field(default="", max_length=2000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class MasterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    address: str
    phone: str
    specialization: List[str] = []
    description: str
    lat: float
    lng: float
    added_by: Optional[str] = None
    created_at: int


# ---------- Chat ----------
class ChatMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    author: str
    text: str
    timestamp: int
