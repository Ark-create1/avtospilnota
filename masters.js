// masters.js — сторінка Майстрів (карта + фільтри + додавання СТО).
// Дані з бекенду: GET /masters, POST /masters, DELETE /masters/{id}

let mastersMap = null;
let mastersMarkersLayer = null;
let mastersMarkersById = {};
let placingMode = false;
let pendingCoords = null;
let activeSpecFilters = [];
let mastersData = [];          // усі СТО з сервера (фільтруємо на клієнті — карта реагує миттєво)
let mastersLoaded = false;
let mastersError = '';

document.addEventListener('DOMContentLoaded', () => {
    initMastersMap();
    renderSpecFilters();
    renderSpecPicker();
    initRail();
    initLocate();
    loadMasters();

    // Повторна спроба після помилки завантаження
    const listEl = document.getElementById('mastersList');
    if (listEl) {
        listEl.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="retry"]')) loadMasters();
        });
    }

    // Після входу чи виходу змінюється, кому показувати кнопку «Видалити» у спливаючому вікні
    document.addEventListener('autospilnota:auth', () => renderMastersOnMap());

    // Кнопка «Видалити» у спливаючому вікні. Слухач на document у фазі перехоплення: Leaflet зупиняє
    // спливання кліків усередині вікна й перемальовує його вміст, тому прив'язка до самої кнопки ненадійна.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.mp-delete');
        if (btn) deleteMaster(parseInt(btn.dataset.id, 10));
    }, true);

    const searchInput = document.getElementById('masterSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderMastersList();
            renderMastersOnMap();
        });
    }

    const addMasterBtn = document.getElementById('addMasterBtn');
    if (addMasterBtn) {
        addMasterBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                showToast('Щоб додати СТО, потрібно увійти', 'error');
                openAuthModal();
                return;
            }
            startPlacingMode();
        });
    }

    const addMasterManualBtn = document.getElementById('addMasterManualBtn');
    if (addMasterManualBtn) {
        addMasterManualBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                showToast('Щоб додати СТО, потрібно увійти', 'error');
                openAuthModal();
                return;
            }
            pendingCoords = null;
            openMasterModal();
        });
    }

    const pickOnMapBtn = document.getElementById('pickOnMapBtn');
    if (pickOnMapBtn) {
        pickOnMapBtn.addEventListener('click', () => {
            closeMasterModal();
            startPlacingMode();
        });
    }

    const closeMasterModalBtn = document.getElementById('closeMasterModal');
    if (closeMasterModalBtn) closeMasterModalBtn.addEventListener('click', closeMasterModal);

    const masterModal = document.getElementById('masterModal');
    if (masterModal) {
        masterModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeMasterModal();
        });
    }

    const saveMasterBtn = document.getElementById('saveMasterBtn');
    if (saveMasterBtn) {
        saveMasterBtn.addEventListener('click', saveNewMaster);
    }
});

function initMastersMap() {
    mastersMap = L.map('mastersMap', { zoomControl: false }).setView([48.6, 31.2], 6); // вся Україна, поки позиція невідома
    L.control.zoom({ position: 'topright' }).addTo(mastersMap);

    L.maplibreGL({
        style: 'https://tiles.openfreemap.org/styles/liberty'
    }).addTo(mastersMap);

    mastersMarkersLayer = L.layerGroup().addTo(mastersMap);

    mastersMap.on('click', (e) => {
        if (!placingMode) return;
        pendingCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
        placingMode = false;
        document.getElementById('mastersMap').style.cursor = '';
        openMasterModal();
    });
}

let myLocationMarker = null;

// silent=true: автоматичний виклик (без повідомлень про помилки). Координати нікуди не надсилаються.
function locateMe(silent) {
    if (!navigator.geolocation) {
        if (!silent) showToast('Цей браузер не підтримує геолокацію', 'error');
        return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        mastersMap.setView(ll, 13);
        if (myLocationMarker) {
            myLocationMarker.setLatLng(ll);
        } else {
            myLocationMarker = L.circleMarker(ll, {
                radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1
            }).addTo(mastersMap);
        }
    }, err => {
        if (silent) return;
        showToast(err.code === 1
            ? 'Доступ до геолокації заборонено. Дозвольте його в налаштуваннях браузера'
            : 'Не вдалося визначити позицію', 'error');
    }, { timeout: 10000, maximumAge: 300000 });
}

function initLocate() {
    const btn = document.getElementById('locateBtn');
    if (btn) btn.addEventListener('click', () => locateMe(false));
    // Якщо дозвіл уже надано раніше — центруємо карту автоматично, інакше чекаємо кнопку.
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then(r => { if (r.state === 'granted') locateMe(true); })
            .catch(() => {});
    }
}

function startPlacingMode() {
    placingMode = true;
    document.getElementById('mastersMap').style.cursor = 'crosshair';
    showToast('Клікніть на карті в тому місці, де знаходиться СТО');
}

function openMasterModal() {
    const modal = document.getElementById('masterModal');
    if (modal) modal.classList.add('show');
    document.getElementById('masterLat').value = pendingCoords ? pendingCoords.lat.toFixed(6) : '';
    document.getElementById('masterLng').value = pendingCoords ? pendingCoords.lng.toFixed(6) : '';
}

function closeMasterModal() {
    const modal = document.getElementById('masterModal');
    if (modal) modal.classList.remove('show');
    placingMode = false;
    pendingCoords = null;
    document.getElementById('mastersMap').style.cursor = '';
    ['masterName', 'masterAddress', 'masterPhone', 'masterDescription', 'masterLat', 'masterLng'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.querySelectorAll('#masterSpecPicker .spec-chip').forEach(c => c.classList.remove('active'));
}

function renderSpecFilters() {
    const wrap = document.getElementById('specFilters');
    if (!wrap) return;
    wrap.innerHTML = MASTER_SPECIALIZATIONS.map(spec =>
        `<span class="spec-chip" data-spec="${escapeHtml(spec)}">${escapeHtml(spec)}</span>`
    ).join('');

    wrap.querySelectorAll('.spec-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const spec = chip.dataset.spec;
            chip.classList.toggle('active');
            if (activeSpecFilters.includes(spec)) {
                activeSpecFilters = activeSpecFilters.filter(s => s !== spec);
            } else {
                activeSpecFilters.push(spec);
            }
            renderMastersList();
            renderMastersOnMap();
        });
    });
}

function renderSpecPicker() {
    const wrap = document.getElementById('masterSpecPicker');
    if (!wrap) return;
    wrap.innerHTML = MASTER_SPECIALIZATIONS.map(spec =>
        `<span class="spec-chip" data-spec="${escapeHtml(spec)}">${escapeHtml(spec)}</span>`
    ).join('');

    wrap.querySelectorAll('.spec-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
        });
    });
}

function getFilteredMasters() {
    const query = (document.getElementById('masterSearchInput')?.value || '').trim().toLowerCase();
    let masters = mastersData.slice();

    if (query) {
        masters = masters.filter(m =>
            m.name.toLowerCase().includes(query) || m.address.toLowerCase().includes(query)
        );
    }

    if (activeSpecFilters.length > 0) {
        masters = masters.filter(m =>
            (m.specialization || []).some(s => activeSpecFilters.includes(s))
        );
    }

    return masters;
}

function renderMastersList() {
    const list = document.getElementById('mastersList');
    const countEl = document.getElementById('mastersCount');
    if (!list || !countEl) return;

    if (!mastersLoaded) {
        countEl.textContent = '0';
        list.innerHTML = mastersError
            ? `<div style="color:var(--text-muted); font-size:12px; padding:10px 0;">${escapeHtml(mastersError)}
                <div style="margin-top:8px;"><button class="btn-red" data-action="retry" style="padding:6px 12px; font-size:12px;"><i class="ti ti-refresh"></i> Спробувати ще</button></div></div>`
            : `<div style="color:var(--text-hint); font-size:12px; padding:10px 0;">Завантаження...</div>`;
        return;
    }

    const masters = getFilteredMasters();
    countEl.textContent = masters.length;

    if (masters.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); font-size:12px; padding:10px 0;">${mastersData.length ? 'Нічого не знайдено' : 'СТО поки немає. Додайте перше!'}</div>`;
        return;
    }

    list.innerHTML = masters.map(m => `
        <div class="master-item sidebar-item" data-id="${m.id}">
            <div class="master-item-icon"><i class="ti ti-tool"></i></div>
            <div>
                <div class="master-item-name">${escapeHtml(m.name)}</div>
                <div class="master-item-addr">${escapeHtml(m.address)}</div>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.master-item').forEach(item => {
        item.addEventListener('click', () => {
            list.querySelectorAll('.master-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            const master = mastersData.find(m => String(m.id) === item.dataset.id);
            if (!master) return;
            mastersMap.setView([master.lat, master.lng], 15);

            const marker = mastersMarkersById[master.id];
            if (marker) marker.openPopup();
        });
    });
}

function renderMastersOnMap() {
    if (!mastersMarkersLayer) return;
    mastersMarkersLayer.clearLayers();
    mastersMarkersById = {};

    const masters = getFilteredMasters();
    masters.forEach(m => {
        const popupHtml = `
            <div class="master-popup">
                <div class="mp-name">${escapeHtml(m.name)}</div>
                <div class="mp-addr"><i class="ti ti-map-pin"></i> ${escapeHtml(m.address)}</div>
                ${m.phone ? `<div class="mp-phone"><i class="ti ti-phone"></i> ${escapeHtml(m.phone)}</div>` : ''}
                ${m.description ? `<div class="mp-desc">${escapeHtml(m.description)}</div>` : ''}
                <div class="mp-tags">
                    ${(m.specialization || []).map(s => `<span class="mp-tag">${escapeHtml(s)}</span>`).join('')}
                </div>
                ${m.added_by ? `<div class="mp-added-by">Додав: ${escapeHtml(m.added_by)}</div>` : ''}
                ${canDelete(m) ? `<button type="button" class="mp-delete" data-id="${m.id}" style="margin-top:8px; background:none; border:none; color:#A32D2D; font-size:12px; cursor:pointer; padding:0; text-decoration:underline;">Видалити</button>` : ''}
            </div>
        `;
        const marker = L.marker([m.lat, m.lng]).bindPopup(popupHtml).addTo(mastersMarkersLayer);
        mastersMarkersById[m.id] = marker;
    });
}

async function saveNewMaster() {
    const lat = parseFloat(document.getElementById('masterLat').value);
    const lng = parseFloat(document.getElementById('masterLng').value);

    if (isNaN(lat) || isNaN(lng)) {
        return showToast('Вкажіть координати: клікніть на карті або введіть вручну', 'error');
    }

    const name = document.getElementById('masterName').value.trim();
    const address = document.getElementById('masterAddress').value.trim();
    const phone = document.getElementById('masterPhone').value.trim();
    const description = document.getElementById('masterDescription').value.trim();
    const specialization = Array.from(document.querySelectorAll('#masterSpecPicker .spec-chip.active'))
        .map(c => c.dataset.spec);

    if (!name || !address) return showToast('Вкажіть хоча б назву і адресу', 'error');

    const btn = document.getElementById('saveMasterBtn');
    btn.disabled = true;
    try {
        const created = await api('POST', '/masters', { name, address, phone, description, specialization, lat, lng });
        closeMasterModal();
        mastersData.unshift(created);
        mastersLoaded = true;
        renderMastersList();
        renderMastersOnMap();
        mastersMap.setView([created.lat, created.lng], 15);
        const marker = mastersMarkersById[created.id];
        if (marker) marker.openPopup();
        showToast('СТО додано на карту');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// Видаляти може той, хто додав (адмін — через API)
function canDelete(m) {
    return appState.isLoggedIn && m.added_by && appState.currentUser === m.added_by;
}

async function deleteMaster(id) {
    if (!confirm('Видалити це СТО з карти?')) return;
    try {
        await api('DELETE', `/masters/${id}`);
        mastersData = mastersData.filter(m => m.id !== id);
        mastersMap.closePopup();
        renderMastersList();
        renderMastersOnMap();
        showToast('СТО видалено');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadMasters() {
    mastersError = '';
    renderMastersList();
    try {
        mastersData = await api('GET', '/masters?limit=500');
        mastersLoaded = true;
    } catch (e) {
        mastersError = e.message;
        mastersLoaded = false;
    }
    renderMastersList();
    renderMastersOnMap();
}

function initRail() {
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            const panel = btn.dataset.panel;
            const flyoutBody = document.getElementById('flyoutBody');

            if (btn.classList.contains('active')) {
                btn.classList.remove('active');
                flyoutBody.classList.remove('show');
                return;
            }

            document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.flyout-panel').forEach(p => p.style.display = 'none');

            btn.classList.add('active');
            document.getElementById('panel' + panel.charAt(0).toUpperCase() + panel.slice(1)).style.display = 'block';
            flyoutBody.classList.add('show');
        });
    });
}