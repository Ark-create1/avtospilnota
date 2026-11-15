// car.js — сторінка одного авто: банер, статистика, бортжурнал із голосуванням.
// Дані з бекенду: GET /cars/{id}, POST /cars/{id}/entries, POST /cars/{id}/entries/{entry}/vote

let currentCarId = null;
let currentCar = null;

const PLACEHOLDER_HUES = [215, 355, 160, 265, 195, 25];
function brandHue(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return PLACEHOLDER_HUES[h % PLACEHOLDER_HUES.length];
}

function isSafeImageUrl(url) {
    return typeof url === 'string' && /^(https?:\/\/|data:image\/)/i.test(url);
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id || !/^\d+$/.test(id)) {
        document.getElementById('carTitle').textContent = 'Авто не знайдено';
        return;
    }
    currentCarId = id;
    loadCar();

    // Після входу чи виходу змінюються «мої» голоси й право додавати записи
    document.addEventListener('autospilnota:auth', () => loadCar());

    // Голосування за записи та повторна спроба: оновлюємо лише пілюлю й статистику, стрічка не стрибає
    const entriesListEl = document.getElementById('entriesList');
    if (entriesListEl) {
        entriesListEl.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="retry"]')) {
                loadCar();
                return;
            }
            const btn = e.target.closest('.vote-btn');
            if (btn) handleVote(btn);
        });
    }

    // Обкладинка запису: фото з пристрою (стискається) або посилання
    let pendingCover = '';
    const coverFile = document.getElementById('entryCoverFile');
    const coverUrl = document.getElementById('entryCover');
    const coverPreview = document.getElementById('entryCoverPreview');

    function showCoverPreview() {
        if (!coverPreview) return;
        coverPreview.innerHTML = pendingCover
            ? `<div class="cover-preview"><img src="${escapeHtml(pendingCover)}" alt=""><button type="button" class="cover-preview-clear" id="entryCoverClear" aria-label="Прибрати фото">&times;</button></div>`
            : '';
        const clearBtn = document.getElementById('entryCoverClear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                pendingCover = '';
                coverFile.value = '';
                showCoverPreview();
            });
        }
    }

    if (coverFile) {
        coverFile.addEventListener('change', async () => {
            const file = coverFile.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                coverFile.value = '';
                return showToast('Оберіть файл-зображення', 'error');
            }
            coverUrl.value = '';
            coverPreview.innerHTML = '<div style="font-size:12px; color:var(--text-hint);">Обробка фото...</div>';
            try {
                pendingCover = await resizeImageFile(file, 900, 0.6);
                showCoverPreview();
            } catch (err) {
                showToast('Не вдалось обробити фото, спробуйте інше', 'error');
                pendingCover = '';
                coverFile.value = '';
                showCoverPreview();
            }
        });
    }

    // Якщо ввели посилання — прибираємо вибране з пристрою
    if (coverUrl) {
        coverUrl.addEventListener('input', () => {
            if (coverUrl.value.trim() && pendingCover) {
                pendingCover = '';
                coverFile.value = '';
                showCoverPreview();
            }
        });
    }

    const entrySubmit = document.getElementById('entrySubmit');
    if (entrySubmit) {
        entrySubmit.addEventListener('click', async () => {
            if (!appState.isLoggedIn) {
                showToast('Увійдіть, щоб додати запис', 'error');
                openAuthModal();
                return;
            }

            const title = document.getElementById('entryTitle').value.trim();
            const text = document.getElementById('entryText').value.trim();
            const tagsRaw = document.getElementById('entryTags').value.trim();
            const type = document.getElementById('entryType').value;
            const urlCover = document.getElementById('entryCover').value.trim();
            if (urlCover && !/^https?:\/\//i.test(urlCover)) {
                return showToast('Посилання на фото має починатися з http:// або https://', 'error');
            }
            const cover = pendingCover || urlCover;

            if (!title) return showToast('Напишіть заголовок запису', 'error');

            const tags = tagsRaw
                ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
                : [];

            entrySubmit.disabled = true;
            try {
                await api('POST', `/cars/${currentCarId}/entries`, { type, title, text, cover, tags });
                document.getElementById('entryTitle').value = '';
                document.getElementById('entryText').value = '';
                document.getElementById('entryTags').value = '';
                document.getElementById('entryCover').value = '';
                pendingCover = '';
                document.getElementById('entryCoverFile').value = '';
                showCoverPreview();
                showToast('Запис додано');
                await loadCar();
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                entrySubmit.disabled = false;
            }
        });
    }
});

// ====================== ЗАВАНТАЖЕННЯ ======================
async function loadCar() {
    try {
        currentCar = await api('GET', `/cars/${currentCarId}`);
    } catch (e) {
        if (e.status === 404) {
            document.getElementById('carTitle').textContent = 'Авто не знайдено';
            return;
        }
        if (!currentCar) {
            document.getElementById('entriesList').innerHTML =
                `<div class="entries-empty">${escapeHtml(e.message)}
                    <div style="margin-top:12px;"><button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button></div>
                </div>`;
        }
        return;
    }
    renderCarHeader(currentCar);
    renderEntries(currentCar.entries || []);
    updateOwnerBox();
}

// Форма нового запису — лише для власника авто
function updateOwnerBox() {
    const box = document.getElementById('addEntryBox');
    if (!box || !currentCar) return;
    const isOwner = appState.isLoggedIn && appState.currentUser === currentCar.owner;
    box.style.display = isOwner ? 'block' : 'none';
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
    const dir = parseInt(btn.dataset.vote, 10);
    const entry = (currentCar.entries || []).find(e => e.id === entryId);
    if (!entry) return;

    const next = (entry.my_vote || 0) !== 0 ? 0 : dir;
    btn.dataset.busy = '1';
    try {
        const res = await api('POST', `/cars/${currentCarId}/entries/${entryId}/vote`, { vote: next });
        entry.score = res.score;
        entry.my_vote = res.my_vote;
        refreshEntryVote(entryId);
        renderCarStats(currentCar);
    } catch (e) {
        showToast(e.message, 'error');
        delete btn.dataset.busy;
    }
}

// ====================== ВІДОБРАЖЕННЯ ======================
function renderCarHeader(car) {
    const hero = document.getElementById('carHero');
    if (hero) hero.style.setProperty('--h', brandHue(car.make));

    // Фон банера: найновіше фото з бортжурналу або градієнт за маркою
    const bg = document.getElementById('carHeroBg');
    if (bg) {
        const withCover = (car.entries || []).find(e => isSafeImageUrl(e.cover));
        bg.innerHTML = withCover
            ? `<img src="${escapeHtml(withCover.cover)}" alt="" onerror="this.remove()">`
            : '';
    }

    document.getElementById('carTitle').textContent = `${car.make} ${car.model}`;
    document.title = `${car.make} ${car.model} — АвтоСпільнота`;

    const chips = [];
    if (car.year) chips.push(`<span class="hero-chip">${escapeHtml(String(car.year))}</span>`);
    if (car.engine_code) chips.push(`<span class="hero-chip mono">${escapeHtml(car.engine_code)}</span>`);
    if (car.mileage) chips.push(`<span class="hero-chip">${escapeHtml(car.mileage.toLocaleString('uk-UA'))} км</span>`);
    document.getElementById('carChips').innerHTML = chips.join('');

    document.getElementById('carMeta').innerHTML =
        `Власник: <a href="profile.html?user=${encodeURIComponent(car.owner)}">${escapeHtml(car.owner)}</a>` +
        (car.created_at ? ` · додано ${timeAgo(car.created_at)}` : '');

    renderCarStats(car);
}

function renderCarStats(car) {
    const el = document.getElementById('carStats');
    if (!el || !car) return;
    const entries = car.entries || [];
    const total = entries.reduce((sum, e) => sum + (e.score || 0), 0);
    el.innerHTML =
        `<span class="stat-pill"><i class="ti ti-notes"></i> Записів <b>${entries.length}</b></span>` +
        `<span class="stat-pill"><i class="ti ti-star"></i> Рейтинг <b>${total > 0 ? '+' : ''}${total}</b></span>`;
}

function entryVoteHtml(carId, e) {
    const info = ENTRY_TYPES[getEntryType(e)];
    const mine = e.my_vote || 0;
    return voteButtonsHtml({
        score: e.score || 0,
        up: mine > 0,
        down: mine < 0,
        attrs: `data-car-id="${escapeHtml(String(carId))}" data-entry-id="${escapeHtml(String(e.id))}"`,
        upLabel: info.upLabel,
        cls: 'vote-pill-v'
    });
}

// Оновлюємо лише пілюлю одного запису
function refreshEntryVote(entryId) {
    if (!currentCar) return;
    const entry = (currentCar.entries || []).find(e => e.id === entryId);
    if (!entry) return;
    document.querySelectorAll('#entriesList .entry-card').forEach(card => {
        if (card.dataset.entryId !== String(entryId)) return;
        const old = card.querySelector('.vote-pill');
        if (old) old.outerHTML = entryVoteHtml(currentCar.id, entry);
    });
}

function renderEntries(entries) {
    const list = document.getElementById('entriesList');
    const countEl = document.getElementById('entriesCount');
    if (!list || !countEl) return;

    countEl.textContent = entries.length;

    if (entries.length === 0) {
        list.innerHTML = `<div class="entries-empty">Записів у бортжурналі поки немає.</div>`;
        return;
    }

    list.innerHTML = entries.map(e => {
        const type = getEntryType(e);
        const info = ENTRY_TYPES[type];
        const cover = isSafeImageUrl(e.cover)
            ? `<img class="entry-cover" src="${escapeHtml(e.cover)}" alt="" loading="lazy" onerror="this.remove()">`
            : '';
        return `
            <article class="entry-card" data-entry-id="${escapeHtml(String(e.id))}">
                <div class="entry-votecol">${entryVoteHtml(currentCar.id, e)}</div>
                <div class="entry-main">
                    ${cover}
                    <div class="entry-head">
                        <span class="type-badge type-${type}"><i class="ti ${info.icon}"></i> ${info.label}</span>
                        <span class="entry-time">${timeAgo(e.timestamp)}</span>
                    </div>
                    <h3 class="entry-title">${escapeHtml(e.title)}</h3>
                    ${e.text ? `<div class="entry-text">${escapeHtml(e.text)}</div>` : ''}
                    ${(e.tags || []).length ? `<div class="entry-tags">${e.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                </div>
            </article>
        `;
    }).join('');
}
