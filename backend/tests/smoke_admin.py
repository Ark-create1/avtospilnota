"""Перевірка ролей, адмін-роутера, блокувань, журналу, лімітів на створення контенту й міграції 0004.
Запуск з папки backend: python -m tests.smoke_admin  (працює на тимчасовій базі)"""
import os, sys, sqlite3, subprocess, tempfile, warnings
warnings.filterwarnings("ignore")
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "test.db")
os.environ["AUTOSPILNOTA_ENV"] = "dev"
os.environ["AUTOSPILNOTA_DISABLE_RATELIMIT"] = "1"

fails = 0
def ok(c, m):
    global fails
    if not c:
        fails += 1
    print(("PASS " if c else "FAIL ") + m)

from fastapi.testclient import TestClient
from app.main import app, admin as admin_module
from app.database import SessionLocal
from app import models, ratelimit

c = TestClient(app)
db = SessionLocal()

def make_user(name, role="user"):
    r = c.post("/auth/register", json={"name": name, "email": f"{name.lower()}@example.com", "password": "secret123"})
    assert r.status_code == 201, r.text
    uid = r.json()["user"]["id"]
    if role != "user":
        db.query(models.User).filter(models.User.id == uid).update({"role": role}); db.commit()
    return uid, {"Authorization": "Bearer " + r.json()["access_token"]}

owner_id, OWN = make_user("Owner", "owner")
mod_id, MOD = make_user("Moder", "moderator")
mod2_id, MOD2 = make_user("Moder2", "moderator")
u1_id, U1 = make_user("Spammer")
u2_id, U2 = make_user("Regular")

# ---------- 1. кожен маршрут /admin віднесено до групи й захищено ----------
OWNER_ONLY = {("POST", "/admin/users/{user_id}/role"), ("GET", "/admin/audit")}
MOD_LEVEL = {
    ("GET", "/admin/stats"), ("GET", "/admin/users"), ("GET", "/admin/recent"),
    ("POST", "/admin/users/{user_id}/ban"), ("POST", "/admin/users/{user_id}/unban"),
    ("DELETE", "/admin/content/{kind}/{item_id}"),
}
routes = {(m, r.path) for r in admin_module.router.routes for m in r.methods}
ok(routes == OWNER_ONLY | MOD_LEVEL, "усі маршрути /admin віднесені до групи (новий маршрут без класифікації завалить тест)")

def call(method, path, headers=None):
    url = path.replace("{user_id}", "999999").replace("{kind}", "chat").replace("{item_id}", "999999")
    if path == "/admin/recent":
        url += "?kind=chat"
    body = {"role": "user"} if path.endswith("/role") else None
    return c.request(method, url, headers=headers or {}, json=body)

def gated(r):
    return r.status_code == 403 and r.json().get("detail", "").startswith("Потрібні права")

bad = []
for (m, p) in sorted(routes):
    if call(m, p).status_code != 401: bad.append(f"anon {m} {p}")
    if not gated(call(m, p, U2)): bad.append(f"user {m} {p}")
    if (m, p) in OWNER_ONLY:
        if not gated(call(m, p, MOD)): bad.append(f"moderator {m} {p}")
    else:
        if gated(call(m, p, MOD)): bad.append(f"moderator blocked {m} {p}")
    if gated(call(m, p, OWN)): bad.append(f"owner blocked {m} {p}")
ok(not bad, "без токена 401, звичайний 403, модератор лише модераторські, власник усе" + (f" | {bad}" if bad else ""))

# ---------- 2. ролі у відповідях ----------
me_o, me_u = c.get("/auth/me", headers=OWN).json(), c.get("/auth/me", headers=U2).json()
ok(me_o["role"] == "owner" and me_o["is_admin"] is True, "власник: role=owner, is_admin=true")
ok(me_u["role"] == "user" and me_u["is_admin"] is False, "звичайний: role=user, is_admin=false")

# ---------- 3. статистика, користувачі, приватність email ----------
st = c.get("/admin/stats", headers=MOD)
ok(st.status_code == 200 and st.json()["users_total"] == 5, "статистика доступна модератору, рахує користувачів")
ou = c.get("/admin/users", headers=OWN).json(); mu = c.get("/admin/users", headers=MOD).json()
ok(any(u["email"] == "regular@example.com" for u in ou), "власник бачить email користувачів")
ok(all(u["email"] == "" for u in mu), "модератор не бачить email")
ok(len(c.get("/admin/users?search=spam", headers=MOD).json()) == 1, "пошук користувача за ім'ям (без урахування регістру)")

# ---------- 4. блокування ----------
ok(c.post(f"/admin/users/{u1_id}/ban", headers=MOD, json={"reason": "спам"}).json()["is_banned"] is True, "модератор блокує звичайного користувача")
ok(c.post("/questions", headers=U1, json={"title": "Спам спам", "text": "x"}).status_code == 403, "заблокований не може створювати контент")
ok(c.get("/auth/me", headers=U1).status_code == 403, "токен заблокованого більше не працює")
ok(c.post("/auth/login", json={"email": "spammer@example.com", "password": "secret123"}).status_code == 403, "заблокований не може увійти")
ok(c.post(f"/admin/users/{u1_id}/unban", headers=MOD).status_code == 200 and c.get("/auth/me", headers=U1).status_code == 200, "розблокування повертає доступ")
ok(c.post(f"/admin/users/{owner_id}/ban", headers=MOD).status_code == 403, "модератор не може заблокувати власника")
ok(c.post(f"/admin/users/{mod2_id}/ban", headers=MOD).status_code == 403, "модератор не може заблокувати іншого модератора")
ok(c.post(f"/admin/users/{mod_id}/ban", headers=MOD).status_code == 403, "модератор не може заблокувати себе")
ok(c.post(f"/admin/users/{owner_id}/ban", headers=OWN).status_code == 403, "власник не може заблокувати власника/себе")
ok(c.post(f"/admin/users/{mod2_id}/ban", headers=OWN).status_code == 200 and c.get("/auth/me", headers=MOD2).status_code == 403, "власник може заблокувати модератора")
c.post(f"/admin/users/{mod2_id}/unban", headers=OWN)

# ---------- 5. ролі ----------
ok(c.post(f"/admin/users/{u2_id}/role", headers=OWN, json={"role": "moderator"}).json()["role"] == "moderator", "власник призначає модератора")
ok(c.post(f"/admin/users/{u2_id}/role", headers=OWN, json={"role": "owner"}).status_code == 422, "через API не можна призначити власника")
ok(c.post(f"/admin/users/{owner_id}/role", headers=OWN, json={"role": "user"}).status_code == 403, "власник не може змінити власну роль")
ok(c.post(f"/admin/users/{u2_id}/role", headers=MOD, json={"role": "user"}).status_code == 403, "модератор не може змінювати ролі")
c.post(f"/admin/users/{u2_id}/role", headers=OWN, json={"role": "user"})

# ---------- 6. модерація контенту ----------
q = c.post("/questions", headers=U2, json={"title": "Чому тече масло", "text": "BRE 2.0 TDI"}).json()
c.post(f"/questions/{q['id']}/answers", headers=U1, json={"text": "Перевір сальник"})
c.post(f"/questions/{q['id']}/like", headers=OWN, json={"vote": 1})
t = c.post("/topics", headers=U2, json={"title": "Тема для видалення", "text": "текст", "category": "Двигун"}).json()
c.post(f"/topics/{t['id']}/posts", headers=U1, json={"text": "Відповідь у темі"})
msg = c.post("/chat", headers=U2, json={"text": "купуйте гаражі"}).json()
rec = c.get("/admin/recent?kind=question", headers=MOD).json()
ok(rec and rec[0]["title"] == "Чому тече масло" and rec[0]["author"] == "Regular", "список останніх питань для модерації")
ok(c.delete(f"/admin/content/question/{q['id']}", headers=MOD).status_code == 204 and c.get(f"/questions/{q['id']}").status_code == 404, "модератор видаляє питання (відповіді видаляються каскадом)")
ok(db.query(models.Vote).filter_by(target_type="question", target_id=q["id"]).count() == 0, "голоси видаленого питання прибрано")
ok(c.delete(f"/admin/content/topic/{t['id']}", headers=MOD).status_code == 204 and c.get(f"/topics/{t['id']}").status_code == 404, "модератор видаляє тему з відповідями")
ok(c.delete(f"/admin/content/chat/{msg['id']}", headers=MOD).status_code == 204, "модератор видаляє повідомлення чату")
ok(c.delete(f"/admin/content/chat/{msg['id']}", headers=MOD).status_code == 404, "повторне видалення -> 404")
oq = c.post("/questions", headers=OWN, json={"title": "Питання власника", "text": "x"}).json()
ok(c.delete(f"/admin/content/question/{oq['id']}", headers=MOD).status_code == 403, "модератор не може видалити контент власника")
ok(c.delete(f"/admin/content/question/{oq['id']}", headers=OWN).status_code == 204, "власник видаляє свій контент")
ok(c.patch(f"/topics/{c.post('/topics', headers=U2, json={'title': 'Закріпити', 'text': 'x'}).json()['id']}/moderate", headers=MOD, json={"pinned": True}).status_code == 200, "PATCH /topics/.../moderate працює для модератора")

# ---------- 7. журнал ----------
au = c.get("/admin/audit", headers=OWN).json()
acts = {a["action"] for a in au}
ok({"ban", "unban", "set_role", "delete"} <= acts, "журнал містить ban, unban, set_role, delete")
ok(any(a["action"] == "delete" and a["actor"] == "Moder" and "Чому тече масло" in a["detail"] for a in au), "журнал зберігає, хто і що видалив")
ok(c.get("/admin/audit", headers=MOD).status_code == 403, "журнал недоступний модератору")

# ---------- 8. ліміти на створення контенту (на користувача) ----------
os.environ["AUTOSPILNOTA_DISABLE_RATELIMIT"] = "0"; ratelimit.reset_all()
codes = [c.post("/questions", headers=U1, json={"title": f"Питання {i}", "text": "текст"}).status_code for i in range(11)]
ok(codes[:10] == [201] * 10 and codes[10] == 429, "11-те питання за годину від одного користувача -> 429")
ok(c.post("/questions", headers=U2, json={"title": "Інший користувач", "text": "текст"}).status_code == 201, "ліміт діє на користувача, а не на всіх")
os.environ["AUTOSPILNOTA_DISABLE_RATELIMIT"] = "1"; ratelimit.reset_all()

# ---------- 9. міграція 0004 (з існуючими адмінами) ----------
dbfile = os.path.join(_tmp, "mig.db")
env = dict(os.environ, DATABASE_URL="sqlite:///" + dbfile)
def alembic(*a):
    return subprocess.run([sys.executable, "-m", "alembic", *a], env=env, capture_output=True, text=True)
r = alembic("upgrade", "0003")
ok(r.returncode == 0, "alembic upgrade 0003 на чистій базі" + ("" if r.returncode == 0 else " | " + r.stderr[-300:]))
con = sqlite3.connect(dbfile)
con.execute("INSERT INTO users (name,name_key,email,password_hash,is_admin,created_at) VALUES ('Адмін','адмін','a@x.com','h',1,1)")
con.execute("INSERT INTO users (name,name_key,email,password_hash,is_admin,created_at) VALUES ('Звичайний','звичайний','u@x.com','h',0,1)")
con.commit(); con.close()
r = alembic("upgrade", "head")
ok(r.returncode == 0, "alembic upgrade head (0004)" + ("" if r.returncode == 0 else " | " + r.stderr[-300:]))
con = sqlite3.connect(dbfile)
cols = {row[1] for row in con.execute("PRAGMA table_info(users)")}
roles = dict(con.execute("SELECT name, role FROM users").fetchall())
tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
con.close()
ok("role" in cols and "is_banned" in cols and "is_admin" not in cols, "колонки role, is_banned додано, is_admin прибрано")
ok(roles == {"Адмін": "owner", "Звичайний": "user"}, "старий адмін став власником, звичайний лишився user")
ok("audit_log" in tables, "таблицю audit_log створено")
r = alembic("downgrade", "0003")
con = sqlite3.connect(dbfile)
adm = dict(con.execute("SELECT name, is_admin FROM users").fetchall()); con.close()
ok(r.returncode == 0 and adm == {"Адмін": 1, "Звичайний": 0}, "downgrade повертає is_admin з ролей")

# ---------- 10. стара локальна база розробки оновлюється автоматично ----------
dev_db = os.path.join(_tmp, "olddev.db")
env_old = dict(os.environ, DATABASE_URL="sqlite:///" + dev_db)
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "0003"], env=env_old, capture_output=True, text=True)
con = sqlite3.connect(dev_db)
con.execute("INSERT INTO users (name,name_key,email,password_hash,is_admin,created_at) VALUES ('Старий','старий','s@x.com','h',1,1)")
con.commit(); con.close()
p = subprocess.run([sys.executable, "-c", "import app.main"], env=env_old, capture_output=True, text=True)
con = sqlite3.connect(dev_db)
cols = {row[1] for row in con.execute("PRAGMA table_info(users)")}
role = con.execute("SELECT role FROM users WHERE name='Старий'").fetchone()
con.close()
ok(p.returncode == 0 and "role" in cols and "is_admin" not in cols and role == ("owner",), "стара dev-база (create_all-схема) оновлюється при старті, адмін стає власником")

print("\nПІДСУМОК:", "УСЕ ПРОЙШЛО" if fails == 0 else f"ПРОВАЛЕНО {fails}")
sys.exit(1 if fails else 0)
