# АвтоСпільнота — бекенд (FastAPI + SQLAlchemy)

## Швидкий старт (розробка)

```bash
pip install -r requirements.txt

# Windows PowerShell:           bash / macOS / Linux:
$env:AUTOSPILNOTA_ENV="dev"     export AUTOSPILNOTA_ENV=dev

python -m uvicorn app.main:app --reload
```
Документація API: http://127.0.0.1:8000/docs. У режимі `dev` таблиці створюються автоматично (`app.db`), а CORS дозволяє сторінки, відкриті прямо з диска.

## Запуск разом із сайтом

```bash
# термінал 1 — бекенд
AUTOSPILNOTA_ENV=dev python -m uvicorn app.main:app --reload      # PowerShell: $env:AUTOSPILNOTA_ENV="dev"

# термінал 2 — сайт (у папці з html-файлами)
python -m http.server 5500
```
Відкрийте http://127.0.0.1:5500/garage.html. Адреса API задається на початку `main.js` (константа `API_BASE`, за замовчуванням `http://127.0.0.1:8000`); на сервері змініть її на адресу вашого API й додайте адресу сайту в `AUTOSPILNOTA_CORS_ORIGINS`.

Усі сторінки сайту працюють через цей API; localStorage у браузері зберігає лише токен входу й ім'я для швидкого показу в шапці.

## Змінні середовища

| Змінна | Призначення |
|---|---|
| `AUTOSPILNOTA_SECRET_KEY` | **Обов'язкова на продакшені.** Довгий випадковий рядок для підпису токенів (`python -c "import secrets; print(secrets.token_urlsafe(48))"`). Без неї застосунок не стартує. |
| `AUTOSPILNOTA_ENV` | `dev` — локальна розробка (тимчасовий ключ, автоматичні таблиці, CORS для `file://`). |
| `DATABASE_URL` | За замовчуванням SQLite `app.db`. Для PostgreSQL: `postgresql://user:pass@host/db` (`postgres://` теж приймається). |
| `AUTOSPILNOTA_CORS_ORIGINS` | Адреси фронтенду через кому, напр. `https://autospilnota.example`. |

## Продакшен: схема бази через міграції

```bash
alembic upgrade head          # створити/оновити таблиці
alembic revision --autogenerate -m "опис зміни"   # після зміни models.py
```
Після кожної зміни моделей створюйте міграцію, інакше існуюча база не оновиться.

## Тести

```bash
python -m tests.smoke_auth    # реєстрація, вхід, приватність, валідація
python -m tests.smoke_api     # форум, гараж, майстри, чат, голосування, ліміти, CORS
```
Тести працюють на тимчасовій базі й не чіпають вашу.

## Голосування

Голоси й лайки (теми, відповіді, записи гаража, питання) лежать в одній таблиці `votes` з унікальним індексом (користувач, тип цілі, id цілі): база сама не дозволяє другий голос. Запит `{"vote": 1 | -1 | 0}` — це *встановлення стану*, а не «+1»: повторне надсилання того ж значення нічого не змінює. 0 знімає голос. За власні теми/записи/відповіді голосувати не можна. Для відповідей на форумі доступні лише лайки (1 або 0).

## Огляд ендпоінтів

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /users/me`, `PATCH /users/me`, `GET /users/me/stats`, `GET /users/{name}` (публічно: без email, телефон лише за згодою), `GET /users/{name}/profile` (усе для сторінки профілю одним запитом: лічильники, репутація, авто, записи, питання, відповіді, теми — до 50 останніх у кожному списку)
- Питання: `GET/POST /questions` (`category`, `search`, `author`, `sort=new|hot`, `status=all|solved|unanswered`, `limit`, `offset`), `GET /questions/stats`, `GET /questions/{id}`, `POST /questions/{id}/answers`, `POST /questions/{id}/solve`, `POST /questions/{id}/like` (лише лайки: 1 або 0)
- Форум: `GET/POST /topics` (`sort=new|week|month|all`, `category`, `subcategory`, `limit`, `offset`), `GET/DELETE /topics/{id}`, `POST /topics/{id}/posts`, `POST /topics/{id}/vote`, `POST /topics/{id}/posts/{post_id}/like`, `PATCH /topics/{id}/moderate` (адмін)
- Гараж: `GET/POST /cars`, `GET/DELETE /cars/{id}`, `POST /cars/{id}/entries`, `DELETE /cars/{id}/entries/{entry_id}`, `POST /cars/{id}/entries/{entry_id}/vote`, `GET /garage/feed` (`type`, `sort`, `search`, `tag`), `GET /garage/build-of-week`
- `GET/POST /masters`, `DELETE /masters/{id}`
- Чат: `GET /chat?after_id=N` (опитування), `POST /chat`
- `GET /health`

Авторизація: заголовок `Authorization: Bearer <token>` (токен повертають register/login).

## Репутація й ранг

Репутація = сума голосів за контент користувача (теми, відповіді на форумі, питання, записи гаража). Ранг на сторінці профілю рахує фронтенд (`profile.js`): до 10 — Новачок, 10–49 — Учасник, 50–199 — Досвідчений, від 200 — Майстер.

## Відомі обмеження (свідомо відкладено)

- **Користувачі ідентифікуються за ім'ям.** Ім'я унікальне без урахування регістру (колонка `name_key` з унікальним індексом), тож «Олег Коваль» і «олег коваль» — один користувач, а підмінити чужий профіль не вийде. Мінус: двом людям з однаковим ім'ям доведеться додати щось до нього. Якщо захочете повноцінні нікнейми (`@handle`) і посилання за id — це окрема зміна API й фронтенду.
- Обмеження частоти запитів і лічильник переглядів працюють у пам'яті одного процесу (при кількох воркерах чи перезапуску лічильники окремі) — для масштабу замінити на Redis.
- Фото й обкладинки поки зберігаються як `data:image/...` у базі (до ~1,5 МБ). Далі: ендпоінт завантаження файлів і сховище.
- Чат — опитування; WebSocket і кімнати додаються пізніше (формат повідомлень лишається).
- Немає підтвердження email, відновлення пароля й видалення акаунта (потрібні також для GDPR).
- Для SQLite нечутливий до регістру пошук кирилиці забезпечено підміною `lower()` у `app/database.py`; на PostgreSQL залежить від локалі бази (потрібна UTF-8).
