// masters.js — суто логіка сторінки Майстрів (карта + фільтри + додавання СТО)

let mastersMap = null;
let mastersMarkersLayer = null;
let mastersMarkersById = {};
let placingMode = false;
let pendingCoords = null;
let activeSpecFilters = [];

document.addEventListener('DOMContentLoaded', () => {
    initMastersMap();
    renderSpecFilters();
    renderSpecPicker();
    renderMastersList();
    renderMastersOnMap();

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
                alert("Щоб додати СТО, потрібно увійти");
                openAuthModal();
                return;
            }
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
    mastersMap = L.map('mastersMap').setView([49.2331, 28.4682], 12); // Вінниця за замовчуванням

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

function startPlacingMode() {
    placingMode = true;
    document.getElementById('mastersMap').style.cursor = 'crosshair';
    alert("Клікніть на карті в тому місці, де знаходиться СТО");
}

function openMasterModal() {
    const modal = document.getElementById('masterModal');
    if (modal) modal.classList.add('show');
}

function closeMasterModal() {
    const modal = document.getElementById('masterModal');
    if (modal) modal.classList.remove('show');
    placingMode = false;
    pendingCoords = null;
    document.getElementById('mastersMap').style.cursor = '';
    ['masterName', 'masterAddress', 'masterPhone', 'masterDescription'].forEach(id => {
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
    let masters = getMasters();

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

    const masters = getFilteredMasters();
    countEl.textContent = masters.length;

    if (masters.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); font-size:12px; padding:10px 0;">Нічого не знайдено</div>`;
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

            const master = getMasters().find(m => m.id === item.dataset.id);
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
            </div>
        `;
        const marker = L.marker([m.lat, m.lng]).bindPopup(popupHtml).addTo(mastersMarkersLayer);
        mastersMarkersById[m.id] = marker;
    });
}

function saveNewMaster() {
    if (!pendingCoords) {
        alert("Спочатку клікніть на карті, щоб вказати місце СТО");
        return;
    }

    const name = document.getElementById('masterName').value.trim();
    const address = document.getElementById('masterAddress').value.trim();
    const phone = document.getElementById('masterPhone').value.trim();
    const description = document.getElementById('masterDescription').value.trim();
    const specialization = Array.from(document.querySelectorAll('#masterSpecPicker .spec-chip.active'))
        .map(c => c.dataset.spec);

    if (!name || !address) return alert("Вкажіть хоча б назву і адресу");

    addMaster({
        name,
        address,
        phone,
        description,
        specialization,
        lat: pendingCoords.lat,
        lng: pendingCoords.lng
    });

    closeMasterModal();
    renderMastersList();
    renderMastersOnMap();
}
