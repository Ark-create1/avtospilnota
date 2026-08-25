// garage.js — суто логіка публічної стрічки гаража (список авто + додавання)

document.addEventListener('DOMContentLoaded', () => {
    renderGarageFeed();

    const addCarBtn = document.getElementById('addCarBtn');
    if (addCarBtn) {
        addCarBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert("Щоб додати авто, потрібно увійти");
                openAuthModal();
                return;
            }
            openCarModal();
        });
    }

    const closeCarModalBtn = document.getElementById('closeCarModal');
    if (closeCarModalBtn) closeCarModalBtn.addEventListener('click', closeCarModal);

    const carModal = document.getElementById('carModal');
    if (carModal) {
        carModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeCarModal();
        });
    }

    const saveCarBtn = document.getElementById('saveCarBtn');
    if (saveCarBtn) {
        saveCarBtn.addEventListener('click', () => {
            const make = document.getElementById('carMake').value.trim();
            const model = document.getElementById('carModel').value.trim();
            const engineCode = document.getElementById('carEngineCode').value.trim();
            const year = parseInt(document.getElementById('carYear').value) || null;
            const mileage = parseInt(document.getElementById('carMileage').value) || 0;

            if (!make || !model) return alert("Вкажіть хоча б марку і модель");

            addCar({ make, model, engineCode, year, mileage });
            closeCarModal();
            renderGarageFeed();
        });
    }
});

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

function renderGarageFeed() {
    const list = document.getElementById('garageList');
    if (!list) return;

    const cars = getCars().slice().sort((a, b) => b.createdAt - a.createdAt);

    if (cars.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:40px 0; text-align:center;">
            У гаражі поки що немає жодного авто. Додайте перше!
        </div>`;
        return;
    }

    list.innerHTML = cars.map(car => {
        const entriesCount = car.entries ? car.entries.length : 0;
        return `
            <div class="q-card" data-id="${car.id}">
                <div class="q-top">
                    <div class="avatar av-blue"><i class="ti ti-car car-icon"></i></div>
                    <div class="q-body">
                        <div class="q-title">${escapeHtml(car.make)} ${escapeHtml(car.model)}${car.year ? ' (' + car.year + ')' : ''}</div>
                        <div class="q-meta">${escapeHtml(car.owner)} · ${timeAgo(car.createdAt)}${car.mileage ? ' · ' + car.mileage.toLocaleString('uk-UA') + ' км' : ''}</div>
                        <div class="car-tags">
                            ${car.engineCode ? `<span class="tag">${escapeHtml(car.engineCode)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-notes"></i> ${entriesCount} записів у бортжурналі</span>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('#garageList .q-card').forEach(card => {
        card.addEventListener('click', () => {
            window.location.href = `car.html?id=${card.dataset.id}`;
        });
    });
}
