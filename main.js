// main.js — Глобальне ядро АвтоСпільноти (API-клієнт, вхід, спільний інтерфейс)

const appState = {
    isLoggedIn: false,
    currentUser: null,
    // Роль лише для показу пункту «Адмінка» в меню. Справжній доступ перевіряє сервер при кожному запиті.
    role: 'user'
};

// ====================== API: зв'язок із бекендом ======================
// Адреса бекенду. Змініть тут (наприклад, на https://api.ваш-домен.com) або задайте
// window.AUTOSPILNOTA_API / localStorage 'autospilnota_api'.
const API_BASE = (window.AUTOSPILNOTA_API || localStorage.getItem('autospilnota_api') || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TOKEN_KEY = 'autospilnota_token';
// Межа «мобільного» режиму в пікселях. Має збігатися з @media (max-width: 900px) у style.css.
const MOBILE_MAX = 900;

class ApiError extends Error {
    constructor(message, status, network) {
        super(message);
        this.status = status || 0;
        this.network = !!network;
    }
}

function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function setToken(token) {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
}

const FIELD_LABELS = {
    title: 'заголовок', text: 'текст', name: "ім'я", email: 'email', password: 'пароль', make: 'марка',
    model: 'модель', year: 'рік', mileage: 'пробіг', cover: 'фото', category: 'категорія', address: 'адреса',
    lat: 'широта', lng: 'довгота', bio: 'про себе', city: 'місто', phone: 'телефон'
};

// Робимо повідомлення про помилку зрозумілим: сервер повертає або рядок, або список помилок валідації
function apiErrorMessage(data, status) {
    if (data && typeof data.detail === 'string') return data.detail;
    if (data && Array.isArray(data.detail) && data.detail.length) {
        const d = data.detail[0];
        const field = (d.loc || []).slice(-1)[0];
        const label = FIELD_LABELS[field] || field || 'поле';
        const ctx = d.ctx || {};
        if (d.type === 'string_too_short') return `Поле «${label}» занадто коротке (мінімум ${ctx.min_length} символів)`;
        if (d.type === 'string_too_long') return `Поле «${label}» занадто довге (максимум ${ctx.max_length} символів)`;
        if (d.type === 'missing') return `Заповніть поле «${label}»`;
        if (/^(greater|less)_than/.test(d.type)) return `Поле «${label}»: значення поза допустимими межами`;
        if (/_parsing$/.test(d.type)) return `Поле «${label}»: потрібне число`;
        if (d.type === 'literal_error') return `Некоректне значення поля «${label}»`;
        if (field === 'email') return 'Вкажіть коректний email';
        if (d.type === 'value_error' && d.msg) return d.msg.replace(/^Value error, /, '');
        return `Поле «${label}»: ${d.msg}`;
    }
    if (status === 429) return 'Забагато запитів, зачекайте трохи';
    return `Помилка сервера (${status})`;
}

// Універсальний запит. Кидає ApiError із готовим для користувача повідомленням.
async function api(method, path, body) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(API_BASE + path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        throw new ApiError("Немає зв'язку із сервером. Перевірте інтернет і спробуйте ще раз.", 0, true);
    }

    let data = null;
    if (res.status !== 204) {
        try { data = await res.json(); } catch (e) { data = null; }
    }
    if (!res.ok) {
        // токен прострочений або недійсний: виходимо з акаунта й просимо увійти знову
        if (res.status === 401 && token) handleExpiredSession();
        throw new ApiError(apiErrorMessage(data, res.status), res.status);
    }
    return data;
}

function handleExpiredSession() {
    setToken('');
    appState.isLoggedIn = false;
    appState.currentUser = null;
    appState.role = 'user';
    saveAuthState();
    updateAuthUI();
    showToast('Сесія закінчилась, увійдіть знову', 'error');
}

// Невелике спливаюче повідомлення замість alert()
function showToast(text, type) {
    if (!document.getElementById('toastStyles')) {
        const st = document.createElement('style');
        st.id = 'toastStyles';
        st.textContent = `
            .toast-box { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 3000;
                display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; width: max-content; max-width: calc(100vw - 32px); }
            @media (max-width: 900px) { .toast-box { bottom: 76px; } }
            .toast { background: #1a1a1a; color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 13.5px; line-height: 1.4;
                box-shadow: 0 6px 24px rgba(0,0,0,0.25); font-family: 'Manrope', sans-serif; animation: toastIn 0.2s ease; }
            .toast.error { background: var(--red-dark, #A32D2D); }
            @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        `;
        document.head.appendChild(st);
    }
    let box = document.getElementById('toastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toastBox';
        box.className = 'toast-box';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 4500 : 2800);
}

// ====================== ГАМБУРГЕР — ВИДИМІСТЬ ======================
function updateHamburgerVisibility() {
    const btn = document.getElementById('hamburgerBtn');
    if (!btn) return;
    btn.style.display = window.innerWidth <= MOBILE_MAX ? 'flex' : 'none';
}

// ====================== НИЖНЯ НАВІГАЦІЯ (телефон) ======================
function initMobileNav() {
    if (document.getElementById('mobileNav')) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    if (page === 'admin.html') return;
    const items = [
        ['index.html', 'ti-help-circle', 'Питання', ['index.html', 'question.html']],
        ['garage.html', 'ti-car', 'Гараж', ['garage.html', 'car.html']],
        ['masters.html', 'ti-map-pin', 'Майстри', ['masters.html']],
        ['forum.html', 'ti-messages', 'Форум', ['forum.html', 'topic.html']]
    ];
    const nav = document.createElement('nav');
    nav.id = 'mobileNav';
    nav.className = 'mobile-nav';
    nav.setAttribute('aria-label', 'Основна навігація');
    nav.innerHTML = items.map(([href, icon, label, pages]) => {
        const active = pages.includes(page);
        return `<a href="${href}" class="mobile-nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}><i class="ti ${icon}"></i><span>${label}</span></a>`;
    }).join('');
    document.body.appendChild(nav);
}

// ====================== ФУТЕР (підвал сайту) ======================
// Посилання, які ще не готові, лишай порожніми: у футері показуються лише заповнені.
const SITE_LINKS = {
    contactEmail: '',   // 'пошта@проєкту' → зʼявиться «Зв'язатися з розробником»
    donateUrl: '',      // посилання на донат/«банку» → зʼявиться «Підтримати проєкт»
    aboutPage: '',      // 'about.html' → «Про проєкт» і «Команда та модератори»
    rulesPage: '',      // 'rules.html' → «Правила спільноти»
    privacyPage: ''     // 'privacy.html' → «Конфіденційність і cookie»
};

function initFooter() {
    if (document.getElementById('siteFooter')) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    if (page === 'masters.html' || page === 'admin.html') return;   // на мапі й в адмінці футер не потрібен
    const L = SITE_LINKS;
    const col = (title, items) => {
        const links = items.filter(Boolean);
        return links.length ? `<div class="sf-col"><h4>${title}</h4>${links.join('')}</div>` : '';
    };
    const a = (href, text, extra) => href ? `<a href="${escapeHtml(href)}"${extra || ''}>${text}</a>` : '';
    const community = col('Спільнота', [
        a('index.html', 'Питання'), a('garage.html', 'Гараж'), a('masters.html', 'Майстри'), a('forum.html', 'Форум')
    ]);
    const project = col('Проєкт', [
        a(L.aboutPage, 'Про проєкт'),
        L.aboutPage ? a(L.aboutPage + '#team', 'Команда та модератори') : '',
        L.contactEmail ? a('mailto:' + L.contactEmail, 'Зв\'язатися з розробником') : '',
        L.donateUrl ? a(L.donateUrl, 'Підтримати проєкт', ' target="_blank" rel="noopener"') : ''
    ]);
    const rules = col('Правила', [
        a(L.rulesPage, 'Правила спільноти'), a(L.privacyPage, 'Конфіденційність і cookie')
    ]);
    const footer = document.createElement('footer');
    footer.id = 'siteFooter';
    footer.className = 'site-footer';
    footer.innerHTML = `
        <div class="site-footer-inner">
            <div class="sf-brand"><b>АвтоСпільнота</b><span>Спільнота автомобілістів: питання, гараж, СТО й форум українською.</span></div>
            ${community}${project}${rules}
        </div>
        <div class="sf-bottom">© ${new Date().getFullYear()} АвтоСпільнота</div>`;
    document.body.appendChild(footer);
}

let currentFilter = 'all';
let currentCategory = '';
let currentSearchQuery = '';

const QUESTION_CATEGORIES = {
    'Двигун': { avatar: 'blue' },
    'Кузов та підвіска': { avatar: 'green' },
    'Електрика': { avatar: 'amber' },
    'Клімат': { avatar: 'blue' },
    'Паливна система': { avatar: 'red' },
    'АКПП / КПП': { avatar: 'green' },
    'ТО і обслуговування': { avatar: 'amber' },
    'Документи / право': { avatar: 'red' }
};

// ====================== МАЙСТРИ (MASTERS) ======================
const MASTER_SPECIALIZATIONS = [
    'Двигун', 'Електрика', 'АКПП / КПП', 'Кузов та підвіска',
    'Шиномонтаж', 'Малярка', 'Розвал-сходження', 'Діагностика'
];

// ====================== БАЗА ДАНИХ (QUESTIONS) ======================

// ====================== ПИТАННЯ (головна): дані з бекенду ======================
// GET /questions (category, search, sort=hot, status=solved|unanswered, limit, offset),
// POST /questions, POST /questions/{id}/like, GET /questions/stats, GET /users/me/stats
const QUESTIONS_PAGE_SIZE = 15;
let questionsList = [];
let questionsHasMore = false;
let questionsLoading = false;
let questionsError = '';
let questionsRequestId = 0;   // щоб відповідь на застарілий запит не перезаписала свіжу

// У формі лише одне поле тексту, тому заголовок беремо з першого рядка
function makeQuestionTitle(text) {
    const first = text.split('\n')[0].trim();
    return first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first;
}

// Публікує питання на сервері. Кидає ApiError із зрозумілим повідомленням.
async function publishQuestion(text, category) {
    const clean = text.trim();
    if (clean.length < 5) throw new ApiError('Опишіть проблему детальніше (хоча б кілька слів)', 0);
    const q = await api('POST', '/questions', {
        title: makeQuestionTitle(clean),
        text: clean,
        category: category || 'Без категорії'
    });
    if (document.getElementById('questionsList')) {
        loadQuestions(true);
        updateStats();
        updateMyActivity();
    }
    return q;
}

function questionsQuery(offset) {
    const p = new URLSearchParams({ limit: String(QUESTIONS_PAGE_SIZE), offset: String(offset) });
    if (currentCategory) p.set('category', currentCategory);
    if (currentSearchQuery.trim()) p.set('search', currentSearchQuery.trim());
    if (currentFilter === 'hot') p.set('sort', 'hot');
    else if (currentFilter === 'solved') p.set('status', 'solved');
    else if (currentFilter === 'unanswered') p.set('status', 'unanswered');
    return '/questions?' + p.toString();
}

async function loadQuestions(reset) {
    const myRequest = ++questionsRequestId;
    if (reset) {
        questionsList = [];
        questionsHasMore = false;
    }
    questionsError = '';
    questionsLoading = true;
    renderQuestions();

    try {
        const data = await api('GET', questionsQuery(reset ? 0 : questionsList.length));
        if (myRequest !== questionsRequestId) return;
        questionsList = reset ? data : questionsList.concat(data);
        questionsHasMore = data.length === QUESTIONS_PAGE_SIZE;
    } catch (e) {
        if (myRequest !== questionsRequestId) return;
        questionsError = e.message;
    }
    questionsLoading = false;
    renderQuestions();
}

function renderQuestions() {
    const list = document.getElementById('questionsList');
    if (!list) return;

    if (questionsError && questionsList.length === 0) {
        list.innerHTML = `<div style="text-align:center; padding:36px 16px; color:var(--text-muted); background:var(--bg-card); border:1px solid var(--border); border-radius:14px;">
            <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Не вдалося завантажити питання</div>
            <div style="margin-bottom:14px;">${escapeHtml(questionsError)}</div>
            <button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button>
        </div>`;
        return;
    }

    if (questionsLoading && questionsList.length === 0) {
        list.innerHTML = '<div class="q-skeleton"></div>'.repeat(5);
        return;
    }

    if (questionsList.length === 0) {
        const filtered = currentCategory || currentSearchQuery.trim() || currentFilter !== 'all';
        list.innerHTML = `<div style="color:var(--text-hint); padding:40px 0; text-align:center;">${filtered ? 'Нічого не знайдено. Спробуйте змінити фільтр.' : 'Питань поки немає. Будьте першим!'}</div>`;
        return;
    }

    let html = questionsList.map(q => {
        const meta = QUESTION_CATEGORIES[q.category] || { avatar: 'blue' };
        const badge = q.solved
            ? `<span class="badge-solved"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span>`
            : `<span class="badge-open">Шукаємо рішення</span>`;

        return `
            <div class="q-card" data-id="${q.id}">
                <div class="q-top">
                    <div class="avatar av-${meta.avatar}">${escapeHtml(getInitials(q.author))}</div>
                    <div class="q-body">
                        <div class="q-title">${escapeHtml(q.title)}</div>
                        <div class="q-meta">${escapeHtml(q.author)} · ${timeAgo(q.timestamp)} · ${q.views || 0} переглядів</div>
                        <div class="q-tags">${q.category ? `<span class="tag">${escapeHtml(q.category)}</span>` : ''}</div>
                    </div>
                </div>
                <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-message-circle"></i> ${q.answers_count || 0} відповідей</span>
                    <span class="q-stat like-btn" data-id="${q.id}" style="cursor:pointer;">
                        <i class="ti ti-thumb-up${q.liked_by_me ? '-filled' : ''}"></i>
                        ${q.likes || 0}
                    </span>
                    <span class="q-stat"><i class="ti ti-eye"></i> ${q.views || 0}</span>
                    ${badge}
                </div>
            </div>
        `;
    }).join('');

    if (questionsError) {
        html += `<div style="text-align:center; padding:16px; color:var(--text-muted);">${escapeHtml(questionsError)}
            <div style="margin-top:10px;"><button class="btn-red" data-action="more">Спробувати ще</button></div></div>`;
    } else if (questionsHasMore) {
        html += `<div style="display:flex; justify-content:center; padding:6px 0 14px;">
            <button class="btn-more-q" data-action="more" ${questionsLoading ? 'disabled' : ''}>${questionsLoading ? 'Завантаження...' : 'Показати ще'}</button>
        </div>`;
    }
    list.innerHTML = html;
}

// Лайк питання: поставити або зняти (один лайк на користувача, перевіряє сервер)
async function toggleLike(id) {
    if (!appState.isLoggedIn) {
        showToast('Щоб лайкнути, потрібно увійти в акаунт', 'error');
        openAuthModal();
        return;
    }
    const q = questionsList.find(x => x.id === id);
    if (!q || q._busy) return;
    q._busy = true;
    try {
        const res = await api('POST', `/questions/${id}/like`, { vote: q.liked_by_me ? 0 : 1 });
        q.likes = res.score;
        q.liked_by_me = res.my_vote > 0;
        renderQuestions();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        q._busy = false;
    }
}

// ====================== ГАРАЖ (CARS) ======================

const ENTRY_TYPES = {
    repair:  { label: 'Ремонт', icon: 'ti-tool',   upLabel: 'Корисно' },
    tuning:  { label: 'Тюнінг', icon: 'ti-bolt',   upLabel: 'Круто' },
    project: { label: 'Проєкт', icon: 'ti-rocket', upLabel: 'Круто' }
};

function getEntryType(e) {
    return ENTRY_TYPES[e.type] ? e.type : 'repair';
}

// ====================== СПІЛЬНЕ ГОЛОСУВАННЯ ▲/▼ (гараж, форум) ======================

// Пілюля ▲ рахунок ▼. opts: { score, up, down, attrs (рядок data-атрибутів), upLabel }
function voteButtonsHtml(opts) {
    const cls = opts.score > 0 ? 'pos' : (opts.score < 0 ? 'neg' : '');
    return `<div class="vote-pill ${opts.cls || ''}">
        <button class="vote-btn ${opts.up ? 'active-up' : ''}" data-vote="1" ${opts.attrs} title="${opts.upLabel}" aria-label="${opts.upLabel}"><i class="ti ti-chevron-up"></i></button>
        <span class="vote-score ${cls}">${opts.score}</span>
        <button class="vote-btn ${opts.down ? 'active-down' : ''}" data-vote="-1" ${opts.attrs} title="Не зайшло" aria-label="Не зайшло"><i class="ti ti-chevron-down"></i></button>
    </div>`;
}

// ====================== ФОРУМ (TOPICS) ======================
const FORUM_CATEGORIES = [
    { name: 'Техніка', subcategories: ['Двигун', 'Електрика', 'Підвіска', 'АКПП/КПП', 'Гальма'] },
    { name: 'Тюнінг', subcategories: ['Стайлінг', 'Підвіска', 'Двигун', 'Аудіо'] },
    { name: 'Поїздки', subcategories: ['Україна', 'Європа', 'Далекі поїздки'] },
    { name: 'Досвід і поради', subcategories: [] },
    { name: 'Офтопік', subcategories: [] }
];

function extractYouTubeId(url) {
    if (!url) return '';
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
}

function resizeImageFile(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / img.width);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
// ====================== ДОПОМІЖНІ ФУНКЦІЇ ======================
function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'щойно';
    if (diff < 3600) return Math.floor(diff / 60) + ' хв тому';
    if (diff < 86400) return Math.floor(diff / 3600) + ' год тому';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' дн тому';
    return new Date(timestamp).toLocaleDateString('uk-UA');
}

// ====================== СТАТИСТИКА ======================
async function updateStats() {
    const totalEl = document.getElementById('statTotal');
    const solvedEl = document.getElementById('statSolved');
    const usersEl = document.getElementById('statUsers');
    if (!totalEl || !solvedEl || !usersEl) return;
    try {
        const s = await api('GET', '/questions/stats');
        totalEl.textContent = s.total;
        solvedEl.textContent = s.solved_percent + '%';
        usersEl.textContent = s.users;
    } catch (e) {
        /* лишаємо попередні значення */
    }
}

async function updateMyActivity() {
    const myQuestionsEl = document.getElementById('myQuestionsCount');
    const myAnswersEl = document.getElementById('myAnswersCount');
    if (!myQuestionsEl || !myAnswersEl) return;

    if (!appState.isLoggedIn) {
        myQuestionsEl.textContent = '0';
        myAnswersEl.textContent = '0';
        return;
    }
    try {
        const s = await api('GET', '/users/me/stats');
        myQuestionsEl.textContent = s.questions;
        myAnswersEl.textContent = s.answers;
    } catch (e) {
        /* лишаємо попередні значення */
    }
}
// ====================== ЧАТ ======================

// ====================== АВТОРИЗАЦІЯ (AUTH) ======================
function saveAuthState() {
    localStorage.setItem('autospilnota_user', appState.isLoggedIn ? appState.currentUser : '');
}

function restoreAuthState() {
    // Вважаємо користувача увійшовшим лише якщо є токен; ім'я беремо з кешу, потім уточнюємо запитом /auth/me
    const saved = localStorage.getItem('autospilnota_user');
    if (saved && getToken()) {
        appState.isLoggedIn = true;
        appState.currentUser = saved;
    }
}

// Перевіряє токен на сервері й оновлює ім'я (якщо токен недійсний, api() сам виконає вихід)
async function verifySession() {
    if (!getToken()) return;
    try {
        const me = await api('GET', '/auth/me');
        if (me && me.name && (me.name !== appState.currentUser || (me.role || 'user') !== appState.role)) {
            appState.currentUser = me.name;
            appState.role = me.role || 'user';
            appState.isLoggedIn = true;
            saveAuthState();
            updateAuthUI();
        }
    } catch (e) {
        /* мережева помилка: лишаємо кешований стан */
    }
}

// Помилка під формою входу/реєстрації
function showAuthError(text) {
    ['loginForm', 'registerForm'].forEach(id => {
        const form = document.getElementById(id);
        if (!form) return;
        let box = form.querySelector('.auth-error');
        if (!box) {
            box = document.createElement('div');
            box.className = 'auth-error';
            box.setAttribute('role', 'alert');
            box.style.cssText = 'color: var(--red-dark, #A32D2D); font-size: 13px; margin-top: 8px; display: none;';
            form.appendChild(box);
        }
        box.textContent = text || '';
        box.style.display = text ? 'block' : 'none';
    });
}

async function submitLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return showAuthError('Заповніть email та пароль');
    showAuthError('');
    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    try {
        const res = await api('POST', '/auth/login', { email, password });
        setToken(res.access_token);
        loginUser(res.user.name, res.user.role);
    } catch (e) {
        showAuthError(e.message);
    } finally {
        btn.disabled = false;
    }
}

async function submitRegister() {
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!name) return showAuthError("Вкажіть ім'я");
    if (!email) return showAuthError('Вкажіть email');
    if (password.length < 6) return showAuthError('Пароль має містити щонайменше 6 символів');
    showAuthError('');
    const btn = document.getElementById('registerBtn');
    btn.disabled = true;
    try {
        const res = await api('POST', '/auth/register', { name, email, password });
        setToken(res.access_token);
        loginUser(res.user.name, res.user.role);
    } catch (e) {
        showAuthError(e.message);
    } finally {
        btn.disabled = false;
    }
}

function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.add('show');
        switchAuthTab('login');
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('show');
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (!loginForm || !registerForm) return;

    document.querySelectorAll('.auth-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    loginForm.style.display = tab === 'login' ? 'block' : 'none';
    registerForm.style.display = tab === 'register' ? 'block' : 'none';

    const helpText = document.getElementById('authHelpText');
    const switchLink = document.getElementById('switchLink');
    if (helpText && switchLink) {
        if (tab === 'login') {
            helpText.textContent = 'Немає акаунту?';
            switchLink.textContent = 'Зареєструватися';
        } else {
            helpText.textContent = 'Вже є акаунт?';
            switchLink.textContent = 'Увійти';
        }
    }

    if (tab === 'login') {
        document.getElementById('loginEmail').focus();
    } else {
        document.getElementById('registerName').focus();
    }
}

function openNewQuestionModal() {
    const modal = document.getElementById('newQuestionModal');
    if (modal) {
        modal.classList.add('show');
        document.getElementById('modalQuestionText').focus();
    }
}

function closeNewQuestionModal() {
    const modal = document.getElementById('newQuestionModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            document.getElementById('modalQuestionText').value = '';
            const select = document.getElementById('modalCategory');
            if (select) select.value = '';
        }, 300);
    }
}

function updateAuthUI() {
    const myActivity = document.getElementById('myActivitySection');
    if (myActivity) {
        myActivity.style.display = appState.isLoggedIn ? 'block' : 'none';
    }

    const triggerBtn = document.getElementById('authTriggerBtn');
    const dropdown = document.getElementById('profileDropdown');
    const logoutHeaderBtn = document.getElementById('logoutBtn');

    if (triggerBtn) {
        if (appState.isLoggedIn) {
            triggerBtn.innerHTML = `
                <span class="header-avatar">${getInitials(appState.currentUser)}</span>
                <span class="header-name">${escapeHtml(appState.currentUser.split(' ')[0])}</span>
                <i class="ti ti-chevron-down" style="font-size:12px;"></i>
            `;
        } else {
            triggerBtn.innerHTML = `<i class="ti ti-user"></i> Увійти`;
        }
    }

    if (dropdown) {
        if (appState.isLoggedIn) {
            dropdown.innerHTML = `
                <a href="profile.html" class="profile-dropdown-item">
                    <i class="ti ti-user-circle"></i> Мій профіль
                </a>
                <a href="profile.html?tab=questions" class="profile-dropdown-item">
                    <i class="ti ti-help-circle"></i> Мої питання
                </a>
                <a href="profile.html?tab=answers" class="profile-dropdown-item">
                    <i class="ti ti-message-circle"></i> Мої відповіді
                </a>
                <a href="profile.html?tab=topics" class="profile-dropdown-item">
                    <i class="ti ti-messages"></i> Мої теми
                </a>
                <a href="profile.html?tab=settings" class="profile-dropdown-item">
                    <i class="ti ti-settings"></i> Налаштування
                </a>
                ${(appState.role === 'owner' || appState.role === 'moderator')
                    ? '<a href="admin.html" class="profile-dropdown-item"><i class="ti ti-shield-lock"></i> Адмінка</a>' : ''}
                <button type="button" class="profile-dropdown-item danger" id="dropdownLogoutBtn">
                    <i class="ti ti-logout"></i> Вийти
                </button>
            `;
            const dropdownLogout = document.getElementById('dropdownLogoutBtn');
            if (dropdownLogout) dropdownLogout.addEventListener('click', logoutUser);
        } else {
            dropdown.innerHTML = '';
            dropdown.classList.remove('show');
        }
    }

    if (logoutHeaderBtn) {
        logoutHeaderBtn.style.display = appState.isLoggedIn ? 'flex' : 'none';
    }

    updateMyActivity();
    document.dispatchEvent(new CustomEvent('autospilnota:auth'));
}

// Позиціонує dropdown під кнопкою профілю (position:fixed, щоб не обрізався overflow:hidden хедера)
function positionProfileDropdown() {
    const triggerBtn = document.getElementById('authTriggerBtn');
    const dropdown = document.getElementById('profileDropdown');
    if (!triggerBtn || !dropdown) return;
    const rect = triggerBtn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
}

// Після входу чи закриття вікна не лишаємо в полях пароль та старі дані
function clearAuthForms() {
    ['loginEmail', 'loginPassword', 'registerName', 'registerEmail', 'registerPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    showAuthError('');
}

function loginUser(name, role) {
    appState.isLoggedIn = true;
    appState.currentUser = name;
    appState.role = role || 'user';
    saveAuthState();
    updateAuthUI();
    clearAuthForms();
    closeAuthModal();
    showToast(`Вітаємо, ${name.split(' ')[0]}!`);
}

function logoutUser() {
    setToken('');
    appState.isLoggedIn = false;
    appState.currentUser = null;
    appState.role = 'user';
    saveAuthState();
    updateAuthUI();
}
// ====================== ЗАГАЛЬНІ СЛУХАЧІ ПОДІЙ ======================
document.addEventListener('DOMContentLoaded', () => {
    restoreAuthState();
    updateAuthUI();
    verifySession();

    updateHamburgerVisibility();
    window.addEventListener('resize', updateHamburgerVisibility);
    initMobileNav();
    initFooter();

    // Якщо ми на головній сторінці — рендеримо питання
    if (document.getElementById('questionsList')) {
        loadQuestions(true);
        updateStats();
        updateMyActivity();

        // Кліки по стрічці питань: лайк, «Показати ще»/«Спробувати ще», перехід у питання
        document.getElementById('questionsList').addEventListener('click', (e) => {
            const likeEl = e.target.closest('.like-btn');
            if (likeEl) {
                e.stopPropagation();
                toggleLike(parseInt(likeEl.dataset.id, 10));
                return;
            }
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                if (actionEl.dataset.action === 'retry') loadQuestions(true);
                else if (actionEl.dataset.action === 'more') loadQuestions(false);
                return;
            }
            const card = e.target.closest('.q-card[data-id]');
            if (card) window.location.href = `question.html?id=${card.dataset.id}`;
        });

        // Після входу чи виходу «мої» лайки змінюються
        let questionsAuthTimer = null;
        document.addEventListener('autospilnota:auth', () => {
            clearTimeout(questionsAuthTimer);
            questionsAuthTimer = setTimeout(() => loadQuestions(true), 50);
        });

        // Стилі станів стрічки (додаємо тут, щоб не чіпати style.css)
        if (!document.getElementById('questionsStateStyles')) {
            const st = document.createElement('style');
            st.id = 'questionsStateStyles';
            st.textContent = `
                .q-skeleton { height: 120px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 10px;
                    background: linear-gradient(90deg, var(--bg-card) 25%, #eceae4 50%, var(--bg-card) 75%);
                    background-size: 200% 100%; animation: qShimmer 1.3s infinite linear; }
                @keyframes qShimmer { to { background-position: -200% 0; } }
                .btn-more-q { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: 20px; padding: 10px 26px;
                    font-size: 13.5px; font-weight: 600; font-family: 'Manrope', sans-serif; color: var(--text); cursor: pointer; }
                .btn-more-q:hover:not(:disabled) { background: var(--text); color: #fff; border-color: var(--text); }
                .btn-more-q:disabled { opacity: 0.6; cursor: default; }
            `;
            document.head.appendChild(st);
        }
    }

// Мобільний гамбургер-сайдбар
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (hamburgerBtn && sidebar && sidebarOverlay) {
        hamburgerBtn.addEventListener('click', () => {
            sidebar.classList.add('mobile-open');
            sidebarOverlay.classList.add('show');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            sidebarOverlay.classList.remove('show');
        });
        // Закриваємо сайдбар при виборі категорії на мобільному
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.addEventListener('click', () => {
                sidebar.classList.remove('mobile-open');
                sidebarOverlay.classList.remove('show');
            });
        });
    }

    // Кнопка входу / меню профілю в шапці (працює на всіх сторінках)
    const authTriggerBtn = document.getElementById('authTriggerBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    if (authTriggerBtn) {
        authTriggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!appState.isLoggedIn) {
                openAuthModal();
                return;
            }
            if (!profileDropdown) return;
            const willShow = !profileDropdown.classList.contains('show');
            if (willShow) positionProfileDropdown();
            profileDropdown.classList.toggle('show', willShow);
        });
    }
    // Закриваємо dropdown при кліку поза ним і при ресайзі вікна
    document.addEventListener('click', (e) => {
        if (profileDropdown && !profileDropdown.contains(e.target) && e.target !== authTriggerBtn) {
            profileDropdown.classList.remove('show');
        }
    });
    window.addEventListener('resize', () => {
        if (profileDropdown && profileDropdown.classList.contains('show')) {
            positionProfileDropdown();
        }
    });

    // Кнопка "Вийти" окремо в хедері, поруч з профілем
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (profileDropdown) profileDropdown.classList.remove('show');
            logoutUser();
        });
    }

    // Закриття модалки авторизації
    const closeAuthBtn = document.getElementById('closeAuthModal');
    if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);

    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeAuthModal();
        });
    }

    // Вкладки входу/реєстрації
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    const switchLinkBtn = document.getElementById('switchLink');
    if (switchLinkBtn) {
        switchLinkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const currentlyLogin = document.getElementById('loginForm').style.display !== 'none';
            switchAuthTab(currentlyLogin ? 'register' : 'login');
        });
    }

    // Логін та реєстрація
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', submitLogin);

    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) registerBtn.addEventListener('click', submitRegister);

    // Enter у полях форми відправляє її
    [['loginEmail', submitLogin], ['loginPassword', submitLogin],
     ['registerName', submitRegister], ['registerEmail', submitRegister], ['registerPassword', submitRegister]].forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
    });

    // === КНОПКИ ДЛЯ СТВОРЕННЯ ПИТАНЬ (Тільки на головній) ===
    const askHeaderBtn = document.querySelector('.header-actions .btn-red');
    if (askHeaderBtn) {
        askHeaderBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                showToast('Щоб задати питання, потрібно увійти', 'error');
                openAuthModal();
                return;
            }
            openNewQuestionModal();
        });
    }

    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeNewQuestionModal);

    const newQuestionModal = document.getElementById('newQuestionModal');
    if (newQuestionModal) {
        newQuestionModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeNewQuestionModal();
        });
    }

    const submitNewQuestion = document.getElementById('submitNewQuestion');
    if (submitNewQuestion) {
        submitNewQuestion.addEventListener('click', async () => {
            const text = document.getElementById('modalQuestionText').value.trim();
            const category = document.getElementById('modalCategory').value;
            if (!text) return showToast('Напишіть текст питання', 'error');
            submitNewQuestion.disabled = true;
            try {
                await publishQuestion(text, category);
                showToast('Питання опубліковано');
                closeNewQuestionModal();
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                submitNewQuestion.disabled = false;
            }
        });
    }

    const askBoxSubmit = document.getElementById('askBoxSubmit');
    if (askBoxSubmit) {
        askBoxSubmit.addEventListener('click', async () => {
            if (!appState.isLoggedIn) {
                showToast('Щоб задати питання, потрібно увійти', 'error');
                openAuthModal();
                return;
            }
            const text = document.getElementById('askBoxText').value.trim();
            const category = document.getElementById('askBoxCategory').value;
            if (!text) return showToast('Опишіть проблему', 'error');
            askBoxSubmit.disabled = true;
            try {
                await publishQuestion(text, category);
                document.getElementById('askBoxText').value = '';
                document.getElementById('askBoxCategory').value = '';
                showToast('Питання опубліковано');
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                askBoxSubmit.disabled = false;
            }
        });
    }

    // === ЧАТ (Тільки на головній) ===
    // === ФІЛЬТРИ (Тільки на головній) ===
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const label = btn.textContent.trim().toLowerCase();
            if (label.includes('нові')) currentFilter = 'all';
            else if (label.includes('гарячі')) currentFilter = 'hot';
            else if (label.includes('без відповіді')) currentFilter = 'unanswered';
            else if (label.includes('вирішені')) currentFilter = 'solved';
            loadQuestions(true);
        });
    });

    // === КАТЕГОРІЇ В САЙДБАРІ ===
    document.querySelectorAll('.sidebar-item[data-category]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.sidebar-item[data-category]').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentCategory = item.dataset.category;
            loadQuestions(true);
        });
    });

    // === ПОШУК У ХЕДЕРІ ===
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            currentSearchQuery = searchInput.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadQuestions(true), 300);   // не шлемо запит на кожну літеру
        });
    }
    console.log('✅ Ядро АвтоСпільноти (main.js) запущено!');
});

// ====================== ПРОФІЛЬ КОРИСТУВАЧА ======================

// ====================== ЧАТ: підключаємо chat.js на всіх сторінках ======================
(function loadChat() {
    if (window.__autospilnotaChatLoaded) return;
    const sc = document.createElement('script');
    sc.src = 'chat.js';
    document.body.appendChild(sc);
})();
