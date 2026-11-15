"""Перевірка форуму, гаража, майстрів, чату, голосування, обмежень і CORS.
Запуск з кореня проєкту: python -m tests.smoke_api"""
import os, sys, time, warnings, subprocess, tempfile
warnings.filterwarnings("ignore")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")  # тести ніколи не чіпають вашу базу
os.environ["AUTOSPILNOTA_ENV"] = "dev"
os.environ["AUTOSPILNOTA_DISABLE_RATELIMIT"] = "1"
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, views
from app.models import now_ms
from sqlalchemy.exc import IntegrityError

c = TestClient(app)
fails = 0
def ok(cond, msg):
    global fails
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails += 1

def reg(name, email):
    r = c.post("/auth/register", json={"name": name, "email": email, "password": "secret123"})
    assert r.status_code == 201, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}, r.json()["user"]["id"]

oleg, oleg_id = reg("Олег", "oleg@e.com")
ivan, ivan_id = reg("Іван", "ivan@e.com")
anna, anna_id = reg("Анна", "anna@e.com")
db = SessionLocal(); db.query(models.User).filter_by(id=anna_id).update({"role": "owner"}); db.commit(); db.close()

print("=== ФОРУМ ===")
r = c.post("/topics", headers=oleg, json={"title": "Турбіна на BRE", "text": "опис", "category": "Техніка", "subcategory": "Двигун"})
ok(r.status_code == 201 and r.json()["author"] == "Олег", "створення теми")
t1 = r.json()["id"]
t2 = c.post("/topics", headers=ivan, json={"title": "Поїздка в Барселону", "category": "Поїздки"}).json()["id"]
t3 = c.post("/topics", headers=anna, json={"title": "Правила форуму", "category": "Офтопік"}).json()["id"]
ok(c.post("/topics", json={"title": "x"}).status_code == 401, "створення теми без входу -> 401")
ok(c.post("/topics", headers=oleg, json={"title": "x", "photo_url": "javascript:alert(1)"}).status_code == 422, "тема з javascript: у фото відхилена")

# голосування
ok(c.post(f"/topics/{t1}/vote", headers=oleg, json={"vote": 1}).status_code == 403, "за свою тему голосувати не можна (403)")
ok(c.post(f"/topics/{t1}/vote", json={"vote": 1}).status_code == 401, "голосування без входу -> 401")
r = c.post(f"/topics/{t1}/vote", headers=ivan, json={"vote": 1}); ok(r.json() == {"score": 1, "my_vote": 1}, f"Іван ▲ -> score 1 ({r.json()})")
r = c.post(f"/topics/{t1}/vote", headers=ivan, json={"vote": 1}); ok(r.json()["score"] == 1, "повторне ▲ тим самим користувачем НЕ збільшує рахунок (ідемпотентно)")
r = c.post(f"/topics/{t1}/vote", headers=anna, json={"vote": 1}); ok(r.json()["score"] == 2, "Анна ▲ -> score 2")
r = c.post(f"/topics/{t1}/vote", headers=ivan, json={"vote": -1}); ok(r.json() == {"score": 0, "my_vote": -1}, f"Іван перемикає на ▼ -> score 0 ({r.json()})")
r = c.post(f"/topics/{t1}/vote", headers=ivan, json={"vote": 0}); ok(r.json() == {"score": 1, "my_vote": 0}, "Іван знімає голос -> score 1")
ok(c.post(f"/topics/{t1}/vote", headers=ivan, json={"vote": 5}).status_code == 422, "vote=5 відхилено")
db = SessionLocal(); db.add(models.Vote(user_id=anna_id, target_type="topic", target_id=t1, value=1))
try: db.commit(); dup = False
except IntegrityError: dup = True; db.rollback()
db.close(); ok(dup, "база не дозволяє другий голос того ж користувача за ту саму тему (UNIQUE)")
ok(c.get(f"/topics/{t1}", headers=anna).json()["my_vote"] == 1, "my_vote у відповіді для поточного користувача")
ok(c.get(f"/topics/{t1}").json()["my_vote"] == 0, "гість: my_vote = 0")

# відповіді
r = c.post(f"/topics/{t1}/posts", headers=ivan, json={"text": "Перевір актуатор"})
ok(r.status_code == 201 and r.json()["posts_count"] == 1, "відповідь додано")
pid = r.json()["posts"][0]["id"]
ok(c.post(f"/topics/{t1}/posts", headers=ivan, json={"text": "   "}).status_code == 422, "порожня відповідь відхилена")
ok(c.post(f"/topics/{t1}/posts/{pid}/like", headers=ivan, json={"vote": 1}).status_code == 403, "лайк власної відповіді заборонено")
ok(c.post(f"/topics/{t1}/posts/{pid}/like", headers=oleg, json={"vote": -1}).status_code == 422, "для відповідей мінус заборонений (лише лайки)")
r = c.post(f"/topics/{t1}/posts/{pid}/like", headers=oleg, json={"vote": 1}); ok(r.json()["score"] == 1, "лайк відповіді")
r = c.post(f"/topics/{t1}/posts/{pid}/like", headers=oleg, json={"vote": 1}); ok(r.json()["score"] == 1, "повторний лайк не збільшує")
d = c.get(f"/topics/{t1}", headers=oleg).json()
ok(d["posts"][0]["likes_count"] == 1 and d["posts"][0]["liked_by_me"] is True, "likes_count / liked_by_me у темі")

# перегляди без накрутки
views._seen.clear()
v = [c.get(f"/topics/{t2}").json()["views"] for _ in range(5)]
ok(v == [1, 1, 1, 1, 1], f"5 запитів гостя = 1 перегляд ({v})")
ok(c.get(f"/topics/{t2}", headers=oleg).json()["views"] == 2, "інший користувач додає ще один")

# список: сортування, пагінація, закріплення, період
r = c.patch(f"/topics/{t3}/moderate", headers=ivan, json={"pinned": True}); ok(r.status_code == 403, "закріпити може лише адмін (403 для звичайного)")
r = c.patch(f"/topics/{t3}/moderate", headers=anna, json={"pinned": True}); ok(r.status_code == 200 and r.json()["pinned"], "адмін закріплює тему")
db = SessionLocal(); old = models.Topic(title="Стара тема", author_id=oleg_id, category="Техніка", timestamp=now_ms() - 20 * 86_400_000); db.add(old); db.commit(); old_id = old.id; db.close()
for u in (ivan, anna):
    c.post(f"/topics/{old_id}/vote", headers=u, json={"vote": 1})
titles = lambda **p: [t["title"] for t in c.get("/topics", params=p).json()]
new = titles(sort="new")
ok(new[0] == "Правила форуму", f"sort=new: закріплена перша ({new})")
wk = titles(sort="week"); ok("Стара тема" not in wk and wk[0] == "Правила форуму", f"sort=week: стара тема випала ({wk})")
mo = titles(sort="month"); ok(mo[1] == "Стара тема", f"sort=month: після закріпленої — найвищий рейтинг ({mo})")
ok(len(titles(limit=2)) == 2 and len(titles(limit=2, offset=3)) == 1, "limit/offset")
ok(titles(category="Поїздки") == ["Поїздка в Барселону"], "фільтр за категорією")
ls = c.get("/topics").json(); t1o = next(t for t in ls if t["id"] == t1)
ok(t1o["posts_count"] == 1 and t1o["last_post_author"] == "Іван" and t1o["participants"][:2] == ["Олег", "Іван"], f"прев'ю останньої відповіді й учасники ({t1o['last_post_author']}, {t1o['participants']})")

# закрита тема / видалення
c.patch(f"/topics/{t2}/moderate", headers=anna, json={"closed": True})
ok(c.post(f"/topics/{t2}/posts", headers=oleg, json={"text": "ще"}).status_code == 403, "у закриту тему писати не можна")
ok(c.delete(f"/topics/{t1}", headers=ivan).status_code == 403, "чужу тему видалити не можна")
ok(c.delete(f"/topics/{t1}", headers=oleg).status_code == 204, "автор видаляє свою тему")
db = SessionLocal(); left = db.query(models.Vote).filter(models.Vote.target_type.in_(["topic", "post"]), models.Vote.target_id.in_([t1, pid])).count(); db.close()
ok(left == 0 or True, "перевірка голосів після видалення")  # уточнюємо нижче
db = SessionLocal(); lt = db.query(models.Vote).filter_by(target_type="topic", target_id=t1).count(); lp = db.query(models.Vote).filter_by(target_type="post", target_id=pid).count(); db.close()
ok(lt == 0 and lp == 0, f"голоси видаленої теми й відповідей прибрано (topic={lt}, post={lp})")

print("\n=== ГАРАЖ ===")
r = c.post("/cars", headers=oleg, json={"make": "Audi", "model": "A6 C6", "engine_code": "BRE", "year": 2006, "mileage": 250000})
ok(r.status_code == 201, "авто створено"); car1 = r.json()["id"]
car2 = c.post("/cars", headers=ivan, json={"make": "BMW", "model": "N47", "engine_code": "N47"}).json()["id"]
ok(c.post(f"/cars/{car1}/entries", headers=ivan, json={"title": "x"}).status_code == 403, "додати запис до чужого авто не можна")
e1 = c.post(f"/cars/{car1}/entries", headers=oleg, json={"type": "tuning", "title": "Три турбіни", "text": "жесть", "tags": ["Турбо", "bre"], "cover": "https://x.test/a.jpg"}).json()["id"]
e2 = c.post(f"/cars/{car1}/entries", headers=oleg, json={"type": "repair", "title": "Заміна ГРМ", "tags": ["грм"]}).json()["id"]
e3 = c.post(f"/cars/{car2}/entries", headers=ivan, json={"type": "project", "title": "335d replica", "tags": ["проєкт"]}).json()["id"]
ok(c.post(f"/cars/{car1}/entries", headers=oleg, json={"title": "x", "type": "hack"}).status_code == 422, "невідомий тип запису -> 422")
ok(c.post(f"/cars/{car1}/entries", headers=oleg, json={"title": "x", "cover": "javascript:1"}).status_code == 422, "небезпечний cover -> 422")
ok(c.post(f"/cars/{car1}/entries/{e1}/vote", headers=oleg, json={"vote": 1}).status_code == 403, "за свій запис голосувати не можна")
r = c.post(f"/cars/{car1}/entries/{e1}/vote", headers=ivan, json={"vote": 1}); ok(r.json() == {"score": 1, "my_vote": 1}, "▲ запису")
r = c.post(f"/cars/{car1}/entries/{e1}/vote", headers=ivan, json={"vote": 1}); ok(r.json()["score"] == 1, "повтор не збільшує (1 користувач — 1 голос)")
c.post(f"/cars/{car1}/entries/{e1}/vote", headers=anna, json={"vote": 1})
c.post(f"/cars/{car2}/entries/{e3}/vote", headers=oleg, json={"vote": 1})
ok(c.get(f"/cars/{car1}", headers=ivan).json()["entries"][-1]["id"] in (e1, e2) and any(e["liked_by_me"] for e in c.get(f"/cars/{car1}", headers=ivan).json()["entries"]), "GET /cars/{id}: liked_by_me для Івана")
feed = lambda **p: c.get("/garage/feed", params=p).json()
f = feed(); ok(len(f) == 3 and f[0]["title"] == "335d replica", f"feed sort=new ({[x['title'] for x in f]})")
f = feed(sort="all"); ok(f[0]["title"] == "Три турбіни" and f[0]["score"] == 2 and f[0]["car_make"] == "Audi" and f[0]["engine_code"] == "BRE" and f[0]["owner"] == "Олег", f"feed sort=all: рейтинг {f[0]['score']}, дані авто в записі")
ok([x["title"] for x in feed(type="repair")] == ["Заміна ГРМ"], "feed: фільтр за типом")
ok([x["title"] for x in feed(search="n47")] == ["335d replica"], "feed: пошук за кодом двигуна (n47)")
ok([x["title"] for x in feed(search="олег", sort="new")] == ["Заміна ГРМ", "Три турбіни"], "feed: пошук за автором (регістр не важливий, кирилиця)")
ok([x["title"] for x in feed(tag="турбо")] == ["Три турбіни"], "feed: фільтр за тегом із кирилицею")
ok(len(feed(search="%")) == 0, "feed: пошук за '%' не збігається з усім")
ok(len(feed(limit=2)) == 2 and len(feed(limit=2, offset=2)) == 1, "feed: пагінація")
b = c.get("/garage/build-of-week").json()
ok(b and b["title"] == "Три турбіни", f"білд тижня = {b and b['title']}")
tg = c.get("/garage/tags").json(); ok(tg[:1] in (["bre"], ["турбо"], ["грм"], ["проєкт"]) and set(tg) == {"турбо", "bre", "грм", "проєкт"}, f"/garage/tags: {tg}")
st = c.get("/garage/stats").json(); ok(st == {"entries": 3, "cars": 2, "owners": 2}, f"/garage/stats: {st}")
ok(c.delete(f"/cars/{car1}/entries/{e2}", headers=ivan).status_code == 403, "чужий запис видалити не можна")
ok(c.delete(f"/cars/{car1}", headers=oleg).status_code == 204, "власник видаляє авто")
db = SessionLocal(); lv = db.query(models.Vote).filter(models.Vote.target_type == "entry", models.Vote.target_id.in_([e1, e2])).count(); ents = db.query(models.CarEntry).filter(models.CarEntry.car_id == car1).count(); db.close()
ok(lv == 0 and ents == 0, f"запис(и) і їхні голоси видалено разом з авто (votes={lv}, entries={ents})")

print("\n=== МАЙСТРИ ===")
r = c.post("/masters", headers=oleg, json={"name": "СТО Вінниця", "address": "вул. Пирогова 1", "specialization": ["АКПП", "Двигун"], "lat": 49.23, "lng": 28.47})
ok(r.status_code == 201 and r.json()["lat"] == 49.23 and r.json()["added_by"] == "Олег", "СТО додано, координати float")
ok(c.post("/masters", json={"name": "x", "address": "y", "lat": 1, "lng": 1}).status_code == 401, "додати СТО без входу -> 401")
ok(c.post("/masters", headers=oleg, json={"name": "x", "address": "y", "lat": 999, "lng": 1}).status_code == 422, "некоректні координати -> 422")
mid = r.json()["id"]
ok(len(c.get("/masters", params={"specialization": "АКПП"}).json()) == 1 and len(c.get("/masters", params={"specialization": "Клімат"}).json()) == 0, "фільтр за спеціалізацією (кирилиця)")
ok(len(c.get("/masters", params={"search": "пирогова"}).json()) == 1, "пошук за адресою")
ok(c.delete(f"/masters/{mid}", headers=ivan).status_code == 403 and c.delete(f"/masters/{mid}", headers=oleg).status_code == 204, "видаляє лише автор/адмін")

print("\n=== ЧАТ ===")
r = c.post("/chat", headers=oleg, json={"text": "  Привіт   всім  "}); ok(r.status_code == 201 and r.json()["text"] == "Привіт всім", "повідомлення збережено, пробіли нормалізовано")
first_id = r.json()["id"]
ok(c.post("/chat", headers=oleg, json={"text": "друге"}).status_code == 429, "друге повідомлення в межах 1,5 с -> 429")
ok(c.post("/chat", json={"text": "x"}).status_code == 401, "чат без входу -> 401")
ok(c.post("/chat", headers=ivan, json={"text": "x" * 501}).status_code == 422, "понад 500 символів -> 422")
c.post("/chat", headers=ivan, json={"text": "відповідь Івана"})
ok(len(c.get("/chat").json()) == 2, "GET /chat віддає історію")
ok([m["text"] for m in c.get("/chat", params={"after_id": first_id}).json()] == ["відповідь Івана"], "GET /chat?after_id віддає лише нові")
time.sleep(1.6)
ok(c.post("/chat", headers=oleg, json={"text": "Привіт всім"}).status_code == 429, "повтор тексту -> 429")

print("\n=== ОБМЕЖЕННЯ ЧАСТОТИ ВХОДУ ===")
os.environ["AUTOSPILNOTA_DISABLE_RATELIMIT"] = "0"
from app.routers import auth as auth_router
auth_router.login_limiter.reset()
codes = [c.post("/auth/login", json={"email": "oleg@e.com", "password": "bad"}).status_code for _ in range(12)]
ok(codes[:10] == [401] * 10 and codes[10:] == [429, 429], f"10 спроб входу дозволено, далі 429 ({codes})")
auth_router.login_limiter.reset(); auth_router.register_limiter.reset()

print("\n=== CORS ===")
r = c.options("/topics", headers={"Origin": "http://localhost:5500", "Access-Control-Request-Method": "GET"})
ok(r.headers.get("access-control-allow-origin") == "http://localhost:5500", "дозволений origin отримує CORS-заголовок")
r = c.options("/topics", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
ok("access-control-allow-origin" not in r.headers, "чужий origin CORS-заголовка не отримує")

print("\n=== ПИТАННЯ ===")
qa = c.post("/questions", headers=oleg, json={"title": "Свистить турбіна", "text": "Після чіпу на BRE з'явився свист", "category": "Двигун"})
ok(qa.status_code == 201 and qa.json()["likes"] == 0 and qa.json()["answers_count"] == 0, "питання створено, likes=0, answers_count=0")
qa = qa.json()["id"]
qb = c.post("/questions", headers=ivan, json={"title": "АКПП пробуксовує", "text": "DSG після 150 тис.", "category": "АКПП / КПП"}).json()["id"]
qc = c.post("/questions", headers=anna, json={"title": "Тиск у шинах Octavia", "text": "норма для літа", "category": "ТО і обслуговування"}).json()["id"]
ok(c.post(f"/questions/{qa}/like", headers=oleg, json={"vote": 1}).status_code == 403, "своє питання лайкати не можна")
ok(c.post(f"/questions/{qa}/like", json={"vote": 1}).status_code == 401, "лайк без входу -> 401")
ok(c.post(f"/questions/{qa}/like", headers=ivan, json={"vote": -1}).status_code == 422, "для питань мінус заборонений")
r = c.post(f"/questions/{qa}/like", headers=ivan, json={"vote": 1}); ok(r.json() == {"score": 1, "my_vote": 1}, "лайк питання")
r = c.post(f"/questions/{qa}/like", headers=ivan, json={"vote": 1}); ok(r.json()["score"] == 1, "повторний лайк не збільшує")
c.post(f"/questions/{qa}/like", headers=anna, json={"vote": 1})
ok(c.get(f"/questions/{qa}", headers=ivan).json()["liked_by_me"] is True and c.get(f"/questions/{qa}").json()["liked_by_me"] is False, "liked_by_me лише для того, хто лайкнув")
c.post(f"/questions/{qb}/answers", headers=oleg, json={"text": "Перевірте мастило в коробці"})
c.post(f"/questions/{qb}/answers", headers=anna, json={"text": "Скиньте адаптації мехатроніка"})
lst = c.get("/questions").json()
ok([x["title"] for x in lst][:3] == ["Тиск у шинах Octavia", "АКПП пробуксовує", "Свистить турбіна"], f"sort=new: за часом ({[x['title'] for x in lst][:3]})")
ok(all(x["answers"] == [] for x in lst) and {x["id"]: x["answers_count"] for x in lst}[qb] == 2, "у списку відповідей немає, але answers_count правильний")
ok(c.get(f"/questions/{qb}").json()["answers_count"] == 2 and len(c.get(f"/questions/{qb}").json()["answers"]) == 2, "у питанні повний список відповідей")
hot = [x["id"] for x in c.get("/questions", params={"sort": "hot"}).json()]
ok(hot[:2] == [qb, qa], f"sort=hot: 2 відповіді (4 бали) вище за 2 лайки (2 бали) ({hot})")
ok([x["id"] for x in c.get("/questions", params={"status": "unanswered"}).json()] == [qc, qa], "status=unanswered: питання без відповідей")
c.post(f"/questions/{qa}/solve", headers=ivan); ok(c.post(f"/questions/{qa}/solve", headers=ivan).status_code == 403, "позначити вирішеним може лише автор")
ok(c.post(f"/questions/{qa}/solve", headers=oleg).json()["solved"] is True, "автор позначив вирішеним")
ok([x["id"] for x in c.get("/questions", params={"status": "solved"}).json()] == [qa], "status=solved")
ok([x["id"] for x in c.get("/questions", params={"search": "dsg"}).json()] == [qb] and [x["id"] for x in c.get("/questions", params={"search": "мехатронік"}).json()] == [], "пошук за текстом питання без урахування регістру (текст відповідей не шукається)")
ok([x["id"] for x in c.get("/questions", params={"search": "шинах"}).json()] == [qc] and [x["id"] for x in c.get("/questions", params={"search": "акпп"}).json()] == [qb], "пошук за заголовком і категорією")
ok([x["id"] for x in c.get("/questions", params={"category": "Двигун"}).json()] == [qa], "фільтр за категорією")
ok(len(c.get("/questions", params={"author": "Іван"}).json()) == 1, "фільтр за автором")
ok(c.get("/questions/stats").json() == {"total": 3, "solved_percent": 33, "users": 3}, f"статистика: {c.get('/questions/stats').json()}")
ok(c.get("/users/me/stats", headers=oleg).json() == {"questions": 1, "answers": 1}, f"лічильники Олега: {c.get('/users/me/stats', headers=oleg).json()}")
ok(c.get("/users/me/stats").status_code == 401, "лічильники без входу -> 401")
ok(c.get("/questions/stats").status_code == 200 and c.get("/questions/9999").status_code == 404, "/questions/stats не плутається з /questions/{id}; неіснуюче -> 404")

print("\n=== УНІКАЛЬНІ ІМЕНА ТА ПРОФІЛЬ ===")
def reg_raw(name, email):
    return c.post("/auth/register", json={"name": name, "email": email, "password": "secret123"})
r = reg_raw("олег", "dup1@e.com"); ok(r.status_code == 400 and "зайняте" in r.json()["detail"], f"те саме ім'я в іншому регістрі відхилено: {r.json()['detail']}")
ok(reg_raw("  ОЛЕГ  ", "dup2@e.com").status_code == 400, "ім'я з пробілами й великими літерами теж відхилено")
ok(reg_raw("Олег Петренко", "dup3@e.com").status_code == 201, "інше ім'я (по батькові/прізвище) дозволено")
db = SessionLocal()
try:
    db.add(models.User(name="Хтось", name_key="олег", email="raw@e.com", password_hash="x")); db.commit(); raw_dup = False
except IntegrityError:
    raw_dup = True; db.rollback()
db.close(); ok(raw_dup, "база не дозволяє два name_key навіть в обхід API (UNIQUE)")

car3 = c.post("/cars", headers=oleg, json={"make": "Skoda", "model": "Octavia A7", "engine_code": "CJZA", "year": 2015, "mileage": 120000}).json()["id"]
e9 = c.post(f"/cars/{car3}/entries", headers=oleg, json={"type": "tuning", "title": "Чіп-тюнінг", "tags": ["чіп"]}).json()["id"]
c.post(f"/cars/{car3}/entries/{e9}/vote", headers=ivan, json={"vote": 1})
c.patch("/users/me", headers=oleg, json={"city": "Вінниця", "bio": "Діагност VAG", "experience": "12 років", "phone": "+380501112233", "show_phone": False})
p = c.get("/users/Олег/profile").json()
st = p["stats"]
ok(st["cars"] == 1 and st["entries"] == 1 and st["questions"] == 1 and st["answers"] == 1 and st["topics"] == 1, f"профіль: лічильники {st}")
ok(st["reputation"] == 5, f"репутація = голоси за теми (2) + питання (2) + записи гаража (1) = 5, отримано {st['reputation']}")
ok(p["user"]["city"] == "Вінниця" and p["user"]["phone"] == "" and "email" not in p["user"], "профіль: місто видно, телефон прихований, email немає")
ok(p["cars"][0]["make"] == "Skoda" and p["cars"][0]["entries_count"] == 1, "профіль: авто з кількістю записів")
ok(p["entries"][0]["title"] == "Чіп-тюнінг" and p["entries"][0]["score"] == 1 and p["entries"][0]["car_name"] == "Skoda Octavia A7", "профіль: записи гаража з рахунком і назвою авто")
ok(p["questions"][0]["title"] == "Свистить турбіна" and p["questions"][0]["likes"] == 2 and p["questions"][0]["solved"] is True, "профіль: питання з лайками й статусом")
ok(p["answers"][0]["question_title"] == "АКПП пробуксовує", "профіль: відповідь із назвою питання")
ok(p["topics"][0]["title"] == "Стара тема" and p["topics"][0]["score"] == 2, "профіль: тема з рейтингом")
c.patch("/users/me", headers=oleg, json={"show_phone": True})
ok(c.get("/users/Олег/profile").json()["user"]["phone"] == "+380501112233", "телефон видно після згоди власника")
ok(c.get("/users/Нема/profile").status_code == 404, "невідомий користувач -> 404")
ok(c.get("/users/Анна/profile").json()["stats"] == {"cars": 0, "entries": 0, "questions": 1, "answers": 1, "topics": 1, "reputation": 0}, "профіль Анни: інші лічильники, репутація 0")

print("\n=== ІНШЕ ===")
ok(c.get("/health").json() == {"status": "ok"}, "/health")
q = c.post("/questions", headers=oleg, json={"title": "Питання тест", "text": "t"}).json()["id"]
views._seen.clear()
ok([c.get(f"/questions/{q}").json()["views"] for _ in range(3)] == [1, 1, 1], "питання: перегляди без накрутки")
print("\nПІДСУМОК:", "УСЕ ПРОЙШЛО" if fails == 0 else f"{fails} ПРОВАЛІВ")
