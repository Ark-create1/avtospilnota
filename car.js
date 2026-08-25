// car.js — суто логіка сторінки одного авто (картка + бортжурнал)

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
        document.getElementById('carTitle').textContent = 'Авто не знайдено';
        return;
    }

    const car = getCarById(id);
    if (!car) {
        document.getElementById('carTitle').textContent = 'Авто не знайдено';
        return;
    }

    renderCarHeader(car);
    renderEntries(car.entries || []);

    // Форма нового запису — тільки для власника авто
    const addEntryBox = document.getElementById('addEntryBox');
    if (addEntryBox && appState.isLoggedIn && appState.currentUser === car.owner) {
        addEntryBox.style.display = 'block';
    }

    const entrySubmit = document.getElementById('entrySubmit');
    if (entrySubmit) {
        entrySubmit.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert("Увійдіть, щоб додати запис");
                openAuthModal();
                return;
            }

            const title = document.getElementById('entryTitle').value.trim();
            const text = document.getElementById('entryText').value.trim();
            const tagsRaw = document.getElementById('entryTags').value.trim();

            if (!title) return alert("Напишіть заголовок запису!");

            const tags = tagsRaw
                ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
                : [];

            const updatedCar = getCarById(id);
            if (!updatedCar) return;
            if (!updatedCar.entries) updatedCar.entries = [];

            updatedCar.entries.unshift({
                id: generateId(),
                title,
                text,
                tags,
                timestamp: Date.now(),
                likes: []
            });

            updateCar(updatedCar);

            document.getElementById('entryTitle').value = '';
            document.getElementById('entryText').value = '';
            document.getElementById('entryTags').value = '';

            renderEntries(updatedCar.entries);
        });
    }
});

function renderCarHeader(car) {
    document.getElementById('carTitle').textContent = `${car.make} ${car.model}${car.year ? ' (' + car.year + ')' : ''}`;
    document.getElementById('carMeta').textContent =
        `${car.owner} · ${timeAgo(car.createdAt)}${car.mileage ? ' · ' + car.mileage.toLocaleString('uk-UA') + ' км' : ''}`;
    document.getElementById('carTags').innerHTML = car.engineCode
        ? `<span class="tag">${escapeHtml(car.engineCode)}</span>`
        : '';
}

function renderEntries(entries) {
    const list = document.getElementById('entriesList');
    const countEl = document.getElementById('entriesCount');
    if (!list || !countEl) return;

    countEl.textContent = entries.length;

    if (entries.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:16px 0;">Записів у бортжурналі поки немає.</div>`;
        return;
    }

    list.innerHTML = entries.map(e => `
        <div class="q-card" style="cursor:default;">
            <div class="q-body">
                <div class="q-title" style="white-space:normal;">${escapeHtml(e.title)}</div>
                <div class="q-meta">${timeAgo(e.timestamp)}</div>
                ${e.text ? `<div style="font-size:14px; line-height:1.6; margin-top:8px;">${escapeHtml(e.text)}</div>` : ''}
                <div class="entry-tags">
                    ${(e.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>
        </div>
    `).join('');
}
