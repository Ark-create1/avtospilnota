"""Перевірка реєстрації, входу, приватності профілю, валідації та схем.
Запуск з кореня проєкту: python -m tests.smoke_auth"""
import os, json, warnings, subprocess, sys, time
warnings.filterwarnings("ignore")
import tempfile
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")  # тести ніколи не чіпають вашу базу
ok = lambda c, m: print(("PASS " if c else "FAIL ") + m)

# 0) без секрету застосунок не стартує
env = {k: v for k, v in os.environ.items() if not k.startswith("AUTOSPILNOTA")}
p = subprocess.run([sys.executable, "-c", "import app.auth"], env=env, capture_output=True, text=True)
ok(p.returncode != 0 and "AUTOSPILNOTA_SECRET_KEY" in p.stderr, "без AUTOSPILNOTA_SECRET_KEY застосунок не стартує (зрозуміле повідомлення)")
env2 = dict(env, AUTOSPILNOTA_SECRET_KEY="x" * 40)
p = subprocess.run([sys.executable, "-c", "import app.auth"], env=env2, capture_output=True, text=True)
ok(p.returncode == 0, "з AUTOSPILNOTA_SECRET_KEY стартує")

os.environ["AUTOSPILNOTA_ENV"] = "dev"
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models
c = TestClient(app)

r = c.post("/auth/register", json={"name": "  Олег Коваль  ", "email": "oleg@example.com", "password": "secret123"})
ok(r.status_code == 201 and r.json()["user"]["name"] == "Олег Коваль", "реєстрація працює, ім'я обрізається по краях")
tok = r.json()["access_token"]; h = {"Authorization": f"Bearer {tok}"}
r = c.post("/auth/login", json={"email": "OLEG@example.com", "password": "secret123"})
ok(r.status_code == 200, "вхід працює (email без урахування регістру)")
ok(c.post("/auth/login", json={"email": "oleg@example.com", "password": "bad"}).status_code == 401, "невірний пароль -> 401")
ok(c.post("/auth/register", json={"name": "     ", "email": "b@example.com", "password": "secret123"}).status_code == 422, "ім'я з самих пробілів відхилено (422)")
ok(c.post("/auth/register", json={"name": "X", "email": "oleg@example.com", "password": "secret123"}).status_code == 400, "дубль email -> 400")

# приватність
c.patch("/users/me", headers=h, json={"phone": "+420123456789", "show_phone": False, "city": "Прага"})
body = c.get("/users/Олег Коваль").json()
ok("email" not in body, "публічний профіль не містить email")
ok(body["phone"] == "", "телефон прихований, коли show_phone=false")
c.patch("/users/me", headers=h, json={"show_phone": True})
ok(c.get("/users/Олег Коваль").json()["phone"] == "+420123456789", "телефон видно, коли власник дозволив")
me = c.get("/users/me", headers=h)
ok(me.status_code == 200 and me.json()["email"] == "oleg@example.com", "GET /users/me віддає власні дані (з email) лише власнику")
ok(c.get("/users/me").status_code == 401, "GET /users/me без токена -> 401 (а не пошук користувача 'me')")
ok(c.patch("/users/me", headers=h, json={"bio": "x" * 2001}).status_code == 422, "занадто довгий bio відхилено")

# питання
ok(c.post("/questions", headers=h, json={"title": "", "text": ""}).status_code == 422, "порожнє питання відхилено")
ok(c.post("/questions", headers=h, json={"title": "Т" * 100000, "text": "x"}).status_code == 422, "заголовок на 100 000 символів відхилено")
ok(c.post("/questions", headers=h, json={"title": "ab", "text": "x"}).status_code == 422, "заголовок коротший за 3 символи відхилено")
for i in range(55):
    c.post("/questions", headers=h, json={"title": f"Питання номер {i}", "text": "текст"})
c.post("/questions", headers=h, json={"title": "100% дизель_турбо", "text": "t"})
lst = c.get("/questions").json()
ok(len(lst) == 50, f"список за замовчуванням обмежений 50 (отримано {len(lst)})")
ok(len(c.get("/questions", params={"limit": 10, "offset": 5}).json()) == 10, "limit/offset працюють")
ok(c.get("/questions", params={"limit": 1000}).status_code == 422, "limit більше 100 відхилено")
ok(len(c.get("/questions", params={"search": "%"}).json()) == 1, "пошук '%' знаходить лише заголовок із символом %, а не все")
ok(len(c.get("/questions", params={"search": "дизель_турбо"}).json()) == 1, "пошук із _ працює буквально")
qid = lst[0]["id"]
ok(c.post(f"/questions/{qid}/answers", headers=h, json={"text": "   "}).status_code == 422, "порожня відповідь відхилена")
ok(c.post(f"/questions/{qid}/answers", headers=h, json={"text": "Перевірте клапан EGR"}).status_code == 201, "нормальна відповідь приймається")

# схеми гаража/форуму/майстрів (роутерів ще немає — перевіряємо самі схеми)
from pydantic import ValidationError
from app import schemas
def bad(cls, **kw):
    try: cls(**kw); return False
    except ValidationError: return True
ok(bad(schemas.CarEntryCreate, title="t", cover="javascript:alert(1)"), "cover з javascript: відхилено")
ok(not bad(schemas.CarEntryCreate, title="t", cover="https://x.test/a.jpg"), "cover https:// приймається")
ok(not bad(schemas.CarEntryCreate, title="t", cover="data:image/jpeg;base64,AAAA"), "cover data:image приймається")
ok(bad(schemas.CarEntryCreate, title="t", cover="data:image/jpeg;base64," + "A" * 1_600_000), "завеликий cover відхилено")
ok(bad(schemas.CarEntryCreate, title="t", type="hack"), "невідомий тип запису відхилено")
ok(schemas.CarEntryCreate(title="t", tags=[" Турбо ", "", "BRE"]).tags == ["турбо", "bre"], "теги очищаються й приводяться до нижнього регістру")
ok(bad(schemas.TopicCreate, title="t", youtube_id="<script>"), "некоректний youtube_id відхилено")
ok(bad(schemas.MasterCreate, name="n", address="a", lat=999, lng=0), "координати поза межами відхилено")
ok(bad(schemas.CarCreate, make="Audi", model="A6", year=1500), "рік 1500 відхилено")

# типи колонок
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
d1 = str(CreateTable(models.User.__table__).compile(dialect=postgresql.dialect()))
d2 = str(CreateTable(models.Master.__table__).compile(dialect=postgresql.dialect()))
ok("created_at BIGINT" in d1, "users.created_at у PostgreSQL = BIGINT")
ok("lat FLOAT" in d2 and "lng FLOAT" in d2, "masters.lat/lng у PostgreSQL = FLOAT")
