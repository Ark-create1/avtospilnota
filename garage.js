// garage.js — вітрина білдів і ремонтів. Дані беремо з бекенду:
//   GET /garage/feed, /garage/build-of-week, /garage/tags, /garage/stats
//   POST /cars, POST /cars/{id}/entries/{id}/vote
// Потребує з main.js: api, showToast, appState, openAuthModal, ENTRY_TYPES, escapeHtml, timeAgo, getInitials

const PAGE_SIZE = 12;

let currentSort = 'new';   // new | week | month | all
let currentType = 'all';   // all | repair | tuning | project
let activeTag = '';
let searchQuery = '';

let items = [];            // записи стрічки (нормалізовані)
let buildOfWeek = null;
let hasMore = false;
let loadingFeed = false;
let feedError = '';
let feedRequestId = 0;     // щоб відповідь на застарілий запит не перезаписала свіжу

// Перетворюємо відповідь сервера на зручний для шаблонів вигляд
function norm(i) {
    return {
        id: i.id,
        carId: i.car_id,
        carMake: i.car_make || '',
        carModel: i.car_model || '',
        carName: `${i.car_make} ${i.car_model}`,
        engineCode: i.engine_code || '',
        owner: i.owner,
        type: i.type || 'repair',
        title: i.title,
        text: i.text || '',
        cover: i.cover || '',
        tags: i.tags || [],
        timestamp: i.timestamp,
        score: i.score || 0,
        myVote: i.my_vote || 0
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const addCarBtn = document.getElementById('addCarBtn');
    if (addCarBtn) addCarBtn.addEventListener('click', handleAddCarClick);

    const closeCarModalBtn = document.getElementById('closeCarModal');
    if (closeCarModalBtn) closeCarModalBtn.addEventListener('click', closeCarModal);

    const carModal = document.getElementById('carModal');
    if (carModal) {
        carModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeCarModal();
        });
    }

    const saveCarBtn = document.getElementById('saveCarBtn');
    if (saveCarBtn) saveCarBtn.addEventListener('click', saveCar);

    // Сортування / топ за період
    const sortContainer = document.getElementById('sortFilters');
    if (sortContainer) {
        sortContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-btn');
            if (!btn) return;
            sortContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            loadFeed(true);
        });
    }

    // Тип запису: усе / ремонт / тюнінг / проєкти
    const typeContainer = document.getElementById('typeFilters');
    if (typeContainer) {
        typeContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.type-tab');
            if (!btn) return;
            typeContainer.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.type;
            loadFeed(true);
        });
    }

    // Пошук з невеликою затримкою, щоб не слати запит на кожну літеру
    const searchInput = document.getElementById('garageSearchInput');
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                searchQuery = searchInput.value.trim();
                loadFeed(true);
            }, 300);
        });
    }

    ['garageList', 'buildOfWeek'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handleFeedClick);
    });

    // Після входу чи виходу «мої» голоси змінюються — перезавантажуємо стрічку
    let authTimer = null;
    document.addEventListener('autospilnota:auth', () => {
        clearTimeout(authTimer);
        authTimer = setTimeout(() => { loadBuildOfWeek(); loadFeed(true); }, 50);
    });

    loadStats();
    loadTags();
    loadBuildOfWeek();
    loadFeed(true);
});

// ====================== ЗАВАНТАЖЕННЯ ДАНИХ ======================
async function loadStats() {
    const el = document.getElementById('garageStats');
    if (!el) return;
    try {
        const s = await api('GET', '/garage/stats');
        el.innerHTML =
            `<span class="stat-pill"><i class="ti ti-notes"></i> Записів <b>${s.entries}</b></span>` +
            `<span class="stat-pill"><i class="ti ti-car"></i> Авто <b>${s.cars}</b></span>` +
            `<span class="stat-pill"><i class="ti ti-users"></i> Власників <b>${s.owners}</b></span>`;
    } catch (e) {
        el.innerHTML = '';
    }
}

async function loadTags() {
    const wrap = document.getElementById('tagFilters');
    if (!wrap) return;
    try {
        const tags = await api('GET', '/garage/tags?limit=20');
        wrap.innerHTML = tags.map(t =>
            `<span class="tag-chip${t === activeTag ? ' active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`
        ).join('');
        wrap.querySelectorAll('.tag-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const tag = chip.dataset.tag;
                activeTag = activeTag === tag ? '' : tag;
                wrap.querySelectorAll('.tag-chip').forEach(c => c.classList.toggle('active', c.dataset.tag === activeTag));
                loadFeed(true);
            });
        });
    } catch (e) {
        wrap.innerHTML = '';
    }
}

async function loadBuildOfWeek() {
    try {
        const data = await api('GET', '/garage/build-of-week');
        buildOfWeek = data ? norm(data) : null;
    } catch (e) {
        buildOfWeek = null;
    }
    renderBuildOfWeek();
}

function feedQuery(offset) {
    const p = new URLSearchParams({ sort: currentSort, limit: String(PAGE_SIZE), offset: String(offset) });
    if (currentType !== 'all') p.set('type', currentType);
    if (searchQuery) p.set('search', searchQuery);
    if (activeTag) p.set('tag', activeTag);
    return '/garage/feed?' + p.toString();
}

async function loadFeed(reset) {
    const myRequest = ++feedRequestId;
    if (reset) {
        items = [];
        hasMore = false;
        renderBuildOfWeek();
    }
    feedError = '';
    loadingFeed = true;
    renderFeed();

    try {
        const data = await api('GET', feedQuery(reset ? 0 : items.length));
        if (myRequest !== feedRequestId) return;
        const mapped = data.map(norm);
        items = reset ? mapped : items.concat(mapped);
        hasMore = data.length === PAGE_SIZE;
    } catch (e) {
        if (myRequest !== feedRequestId) return;
        feedError = e.message;
    }
    loadingFeed = false;
    renderFeed();
}

// ====================== ДІЇ ======================
function handleAddCarClick() {
    if (!appState.isLoggedIn) {
        showToast('Щоб додати авто, потрібно увійти', 'error');
        openAuthModal();
        return;
    }
    openCarModal();
}

function openCarModal() {
    const modal = document.getElementById('carModal');
    if (modal) modal.classList.add('show');
}

function closeCarModal() {
    const modal = document.getElementById('carModal');
    if (modal) {
        modal.classList.remove('show');
        ['carMake', 'carModel', 'carEngineCode', 'carYear', 'carMileage'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }
}

async function saveCar() {
    const make = document.getElementById('carMake').value.trim();
    const model = document.getElementById('carModel').value.trim();
    const engineCode = document.getElementById('carEngineCode').value.trim();
    const year = parseInt(document.getElementById('carYear').value, 10) || null;
    const mileage = parseInt(document.getElementById('carMileage').value, 10) || 0;

    if (!make || !model) return showToast('Вкажіть хоча б марку і модель', 'error');

    const btn = document.getElementById('saveCarBtn');
    btn.disabled = true;
    try {
        const car = await api('POST', '/cars', { make, model, engine_code: engineCode, year, mileage });
        closeCarModal();
        window.location.href = `car.html?id=${car.id}`;
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

function handleFeedClick(e) {
    const voteBtn = e.target.closest('.vote-btn');
    if (voteBtn) {
        handleVote(voteBtn);
        return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
        const action = actionEl.dataset.action;
        if (action === 'add-car') handleAddCarClick();
        else if (action === 'retry') loadFeed(true);
        else if (action === 'more') loadFeed(false);
        return;
    }
    const go = e.target.closest('[data-go-car]');
    if (go) window.location.href = `car.html?id=${encodeURIComponent(go.dataset.goCar)}`;
}

function findEntry(id) {
    if (buildOfWeek && buildOfWeek.id === id) return buildOfWeek;
    return items.find(p => p.id === id) || null;
}

// Один користувач — один голос. Якщо голос уже є, будь-який клік лише знімає його.
async function handleVote(btn) {
    if (btn.dataset.busy) return;
    if (!appState.isLoggedIn) {
        showToast('Щоб голосувати, потрібно увійти', 'error');
        openAuthModal();
        return;
    }
    const entryId = parseInt(btn.dataset.entryId, 10);
    const carId = parseInt(btn.dataset.carId, 10);
    const dir = parseInt(btn.dataset.vote, 10);
    const entry = findEntry(entryId);
    if (!entry) return;

    const next = entry.myVote !== 0 ? 0 : dir;
    btn.dataset.busy = '1';
    try {
        const res = await api('POST', `/cars/${carId}/entries/${entryId}/vote`, { vote: next });
        // оновлюємо запис скрізь, де він показаний (зокрема й у блоці «Білд тижня»)
        [buildOfWeek, ...items].forEach(p => {
            if (p && p.id === entryId) { p.score = res.score; p.myVote = res.my_vote; }
        });
        refreshEntryPills(entryId);
    } catch (e) {
        showToast(e.message, 'error');
        delete btn.dataset.busy;
    }
}

function refreshEntryPills(entryId) {
    const entry = findEntry(entryId);
    if (!entry) return;
    const typeInfo = ENTRY_TYPES[entry.type] || ENTRY_TYPES.repair;
    const pills = new Set();
    document.querySelectorAll(`.vote-btn[data-entry-id="${entryId}"]`).forEach(b => {
        const pill = b.closest('.vote-pill');
        if (pill) pills.add(pill);
    });
    pills.forEach(pill => { pill.outerHTML = votePillHtml(entry, typeInfo); });
}

// ====================== ВІДОБРАЖЕННЯ ======================
function renderBuildOfWeek() {
    const el = document.getElementById('buildOfWeek');
    if (!el) return;
    const filtersActive = searchQuery || activeTag || currentType === 'repair';
    el.innerHTML = (buildOfWeek && !filtersActive) ? heroHtml(buildOfWeek) : '';
}

function renderFeed() {
    const list = document.getElementById('garageList');
    if (!list) return;

    if (feedError && items.length === 0) {
        list.innerHTML = `<div class="garage-error">
            <div class="garage-empty-title">Не вдалося завантажити стрічку</div>
            <div class="garage-empty-text">${escapeHtml(feedError)}</div>
            <button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button>
        </div>`;
        return;
    }

    if (loadingFeed && items.length === 0) {
        list.innerHTML = '<div class="garage-skeleton"></div>'.repeat(6);
        return;
    }

    if (items.length === 0) {
        const noFilters = !searchQuery && !activeTag && currentType === 'all' && currentSort === 'new';
        list.innerHTML = noFilters
            ? `<div class="garage-empty">
                <div class="garage-empty-icon">🔧</div>
                <div class="garage-empty-title">Тут поки порожньо</div>
                <div class="garage-empty-text">Додай своє авто й розкажи, що з ним робиш: звичайний ремонт чи божевільний білд.</div>
                <button class="btn-red" data-action="add-car"><i class="ti ti-plus"></i> Додати авто</button>
            </div>`
            : `<div class="garage-empty">
                <div class="garage-empty-title">Нічого не знайдено</div>
                <div class="garage-empty-text">Спробуй інший тип, період або прибери фільтри.</div>
            </div>`;
        return;
    }

    let html = items.map(cardHtml).join('');
    if (feedError) {
        html += `<div class="garage-error">${escapeHtml(feedError)}
            <div style="margin-top:10px;"><button class="btn-red" data-action="more">Спробувати ще</button></div></div>`;
    } else if (hasMore) {
        html += `<div class="garage-more">
            <button class="btn-more" data-action="more" ${loadingFeed ? 'disabled' : ''}>${loadingFeed ? 'Завантаження...' : 'Показати ще'}</button>
        </div>`;
    }
    list.innerHTML = html;
}

function isSafeImageUrl(url) {
    return typeof url === 'string' && /^(https?:\/\/|data:image\/)/i.test(url);
}

// Колір заглушки залежить від марки, щоб стрічка без фото теж виглядала різноманітно
const PLACEHOLDER_HUES = [215, 355, 160, 265, 195, 25];
function brandHue(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return PLACEHOLDER_HUES[h % PLACEHOLDER_HUES.length];
}

// Фото запису або градієнтна заглушка з маркою/моделлю
function mediaInnerHtml(p, typeInfo) {
    if (isSafeImageUrl(p.cover)) {
        return `<img class="work-post-img" src="${escapeHtml(p.cover)}" alt="" loading="lazy" onerror="this.remove()">`;
    }
    return `<div class="work-post-ph" style="--h:${brandHue(p.carMake || p.carName)}">
        <i class="ti ${typeInfo.icon} ph-icon"></i>
        <span class="ph-make">${escapeHtml(p.carMake || p.carName)}</span>
        <span class="ph-model">${escapeHtml(p.carModel)}</span>
    </div>`;
}

// Пілюля голосування ▲ рахунок ▼ (вертикальна, збоку)
function votePillHtml(p, typeInfo) {
    const scoreClass = p.score > 0 ? 'pos' : (p.score < 0 ? 'neg' : '');
    const ids = `data-car-id="${p.carId}" data-entry-id="${p.id}"`;
    return `<div class="vote-pill vote-pill-v">
        <button class="vote-btn ${p.myVote > 0 ? 'active-up' : ''}" data-vote="1" ${ids} title="${typeInfo.upLabel}" aria-label="${typeInfo.upLabel}"><i class="ti ti-chevron-up"></i></button>
        <span class="vote-score ${scoreClass}">${p.score}</span>
        <button class="vote-btn ${p.myVote < 0 ? 'active-down' : ''}" data-vote="-1" ${ids} title="Не зайшло" aria-label="Не зайшло"><i class="ti ti-chevron-down"></i></button>
    </div>`;
}

// Велика картка "Білд тижня"
function heroHtml(p) {
    const typeInfo = ENTRY_TYPES[p.type] || ENTRY_TYPES.repair;
    return `
        <article class="work-post featured">
            <div class="hero-media" data-go-car="${p.carId}">${mediaInnerHtml(p, typeInfo)}<div class="hero-shade"></div></div>
            ${votePillHtml(p, typeInfo)}
            <div class="hero-content">
                <div class="featured-label"><i class="ti ti-trophy"></i> Білд тижня</div>
                <h2 class="work-post-title hero-title" data-go-car="${p.carId}">${escapeHtml(p.title)}</h2>
                <div class="hero-meta">
                    <span class="type-badge type-${p.type}"><i class="ti ${typeInfo.icon}"></i> ${typeInfo.label}</span>
                    <span class="hero-car">${escapeHtml(p.carName)}</span>
                    ${p.engineCode ? `<span class="engine-chip">${escapeHtml(p.engineCode)}</span>` : ''}
                    <a href="profile.html?user=${encodeURIComponent(p.owner)}" class="hero-author">${escapeHtml(p.owner)}</a>
                </div>
            </div>
        </article>
    `;
}

// Картка у сітці: збоку колонка голосування, праворуч фото, текст і автор
function cardHtml(p) {
    const typeInfo = ENTRY_TYPES[p.type] || ENTRY_TYPES.repair;
    const tags = (p.tags || []).slice(0, 3);

    return `
        <article class="work-post">
            <div class="work-post-votecol">${votePillHtml(p, typeInfo)}</div>
            <div class="work-post-main">
                <div class="work-post-media" data-go-car="${p.carId}">
                    ${mediaInnerHtml(p, typeInfo)}
                    <span class="type-badge type-${p.type}"><i class="ti ${typeInfo.icon}"></i> ${typeInfo.label}</span>
                </div>
                <div class="work-post-body">
                    <div class="work-post-carrow">
                        <a href="car.html?id=${p.carId}" class="work-post-car">${escapeHtml(p.carName)}</a>
                        ${p.engineCode ? `<span class="engine-chip">${escapeHtml(p.engineCode)}</span>` : ''}
                    </div>
                    <div class="work-post-title" data-go-car="${p.carId}">${escapeHtml(p.title)}</div>
                    ${p.text ? `<div class="work-post-text">${escapeHtml(p.text)}</div>` : ''}
                    ${tags.length ? `<div class="work-post-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="work-post-foot">
                    <a href="profile.html?user=${encodeURIComponent(p.owner)}" class="work-post-author">
                        <span class="mini-avatar">${escapeHtml(getInitials(p.owner))}</span>
                        <span class="author-name">${escapeHtml(p.owner)}</span>
                        <span class="work-post-date">· ${timeAgo(p.timestamp)}</span>
                    </a>
                </div>
            </div>
        </article>
    `;
}
