// profile.js — профіль користувача. Дані з бекенду:
//   GET /users/{name}/profile (усе для сторінки одним запитом), GET /users/me, PATCH /users/me

const PROFILE_TABS = ['garage', 'service', 'questions', 'answers', 'topics', 'settings'];
const TAB_PANES = {
    garage: 'tabPaneGarage', service: 'tabPaneService', questions: 'tabPaneQuestions',
    answers: 'tabPaneAnswers', topics: 'tabPaneTopics', settings: 'tabPaneSettings'
};
const LIST_LIMIT = 50;   // стільки елементів у кожній вкладці віддає сервер

let viewedUser = null;
let isOwn = false;
let activeTab = 'garage';
let profile = null;      // відповідь GET /users/{name}/profile

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    viewedUser = params.get('user') || (appState.isLoggedIn ? appState.currentUser : null);

    const unauthBlock = document.getElementById('unauthProfileBlock');
    const authBlock = document.getElementById('authProfileBlock');

    if (!viewedUser) {
        unauthBlock.style.display = 'block';
        authBlock.style.display = 'none';
        const loginBtn = document.getElementById('unauthLoginBtn');
        if (loginBtn) loginBtn.addEventListener('click', () => openAuthModal());
        // після входу показуємо власний профіль
        document.addEventListener('autospilnota:auth', () => {
            if (appState.isLoggedIn) location.reload();
        });
        return;
    }

    unauthBlock.style.display = 'none';
    authBlock.style.display = 'block';

    isOwn = appState.isLoggedIn && appState.currentUser === viewedUser;
    const tabParam = params.get('tab');
    activeTab = PROFILE_TABS.includes(tabParam) ? tabParam : 'garage';
    if (activeTab === 'settings' && !isOwn) activeTab = 'garage';

    // Вкладки перемикаємо без перезавантаження сторінки
    document.querySelectorAll('.profile-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Після входу/виходу змінюється, чи це «мій» профіль
    document.addEventListener('autospilnota:auth', () => {
        const nowOwn = appState.isLoggedIn && appState.currentUser === viewedUser;
        if (nowOwn !== isOwn) location.reload();
    });

    // Вкладки списків: перехід на питання/тему/авто
    authBlock.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        if (e.target.closest('[data-action="retry"]')) { loadProfile(); return; }
        const card = e.target.closest('[data-href]');
        if (card) window.location.href = card.dataset.href;
    });

    const saveBtn = document.getElementById('saveProfileSettingsBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);

    document.getElementById('profileName').textContent = viewedUser;
    document.getElementById('profileAvatarLarge').textContent = getInitials(viewedUser);
    showTab(activeTab);
    loadProfile();
});

// ====================== ДАНІ ======================
async function loadProfile() {
    try {
        profile = await api('GET', `/users/${encodeURIComponent(viewedUser)}/profile`);
    } catch (e) {
        if (e.status === 404) {
            document.getElementById('profileName').textContent = 'Користувача не знайдено';
            document.getElementById('profileMetaRow').innerHTML = '';
            document.getElementById('profileBio').textContent = '';
            document.getElementById('profileOwnerActions').innerHTML = '';
            return;
        }
        if (!profile) {
            document.getElementById('profileBio').innerHTML =
                `${escapeHtml(e.message)} <button class="btn-red" data-action="retry" style="font-size:12px; padding:5px 12px; margin-left:8px;"><i class="ti ti-refresh"></i> Спробувати ще</button>`;
        }
        return;
    }
    renderProfile();

    // Для власного профілю налаштування беремо з /users/me (там телефон і прапорець показу без приховування)
    if (isOwn) {
        try {
            renderSettingsTab(await api('GET', '/users/me'));
        } catch (e) { /* лишаємо форму порожньою */ }
    }
}

function rankFor(reputation) {
    if (reputation >= 200) return { label: 'Майстер', icon: 'ti-trophy' };
    if (reputation >= 50) return { label: 'Досвідчений', icon: 'ti-award' };
    if (reputation >= 10) return { label: 'Учасник', icon: 'ti-user-check' };
    return { label: 'Новачок', icon: 'ti-user' };
}

// ====================== ВІДОБРАЖЕННЯ ======================
function renderProfile() {
    const u = profile.user;
    const st = profile.stats;

    document.getElementById('profileAvatarLarge').textContent = getInitials(u.name);
    document.getElementById('profileName').textContent = u.name;
    document.title = `${u.name} — АвтоСпільнота`;

    const metaParts = [];
    metaParts.push(`<span><i class="ti ti-map-pin"></i> ${u.city ? escapeHtml(u.city) : 'Місто не вказане'}</span>`);
    metaParts.push(`<span><i class="ti ti-steering-wheel"></i> ${u.experience ? escapeHtml(u.experience) : 'Стаж не вказано'}</span>`);
    if (u.phone) metaParts.push(`<span><i class="ti ti-phone"></i> ${escapeHtml(u.phone)}</span>`);
    document.getElementById('profileMetaRow').innerHTML = metaParts.join('<span>·</span>');
    document.getElementById('profileBio').textContent = u.bio || 'Ще не розповів(-ла) про себе.';

    document.getElementById('pStatCars').textContent = st.cars;
    document.getElementById('pStatEntries').textContent = st.entries;
    document.getElementById('pStatQuestions').textContent = st.questions;
    document.getElementById('pStatAnswers').textContent = st.answers;
    document.getElementById('pStatTopics').textContent = st.topics;
    document.getElementById('pStatReputation').textContent = st.reputation;

    const rank = rankFor(st.reputation);
    document.getElementById('profileBadgeWrap').innerHTML =
        `<span class="profile-rank-badge"><i class="ti ${rank.icon}"></i> ${rank.label}${u.is_admin ? ' · Адмін' : ''}</span>`;

    document.getElementById('tabCountCars').textContent = st.cars;
    document.getElementById('tabCountEntries').textContent = st.entries;
    document.getElementById('tabCountQuestions').textContent = st.questions;
    document.getElementById('tabCountAnswers').textContent = st.answers;
    document.getElementById('tabCountTopics').textContent = st.topics;

    // Дії власника (тільки на своєму профілі)
    const ownerActions = document.getElementById('profileOwnerActions');
    const settingsTabBtn = document.getElementById('settingsTabBtn');
    if (isOwn) {
        ownerActions.innerHTML = `
            <button class="btn-ghost" id="profileEditBtn" style="font-size:13px; padding:7px 14px;"><i class="ti ti-edit"></i> Редагувати</button>
            <a href="garage.html" class="btn-red" style="font-size:13px; padding:7px 14px; text-decoration:none; display:inline-flex; align-items:center; gap:5px;">
                <i class="ti ti-car-plus"></i> Додати авто
            </a>
        `;
        settingsTabBtn.style.display = 'flex';
        document.getElementById('profileEditBtn').addEventListener('click', () => switchTab('settings'));
    } else {
        ownerActions.innerHTML = '';
        settingsTabBtn.style.display = 'none';
    }

    renderGarageTab(profile.cars, st.cars);
    renderServiceTab(profile.entries, profile.cars, st.entries);
    renderQuestionsTab(profile.questions, st.questions);
    renderAnswersTab(profile.answers, st.answers);
    renderTopicsTab(profile.topics, st.topics);
}

function switchTab(tab) {
    if (!PROFILE_TABS.includes(tab) || (tab === 'settings' && !isOwn)) return;
    activeTab = tab;
    history.replaceState(null, '', `profile.html?user=${encodeURIComponent(viewedUser)}&tab=${tab}`);
    showTab(tab);
}

function showTab(tab) {
    document.querySelectorAll('.profile-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.style.display = 'none');
    const pane = document.getElementById(TAB_PANES[tab]);
    if (pane) pane.style.display = 'block';
}

// Якщо елементів більше, ніж показано, пояснюємо це
function truncatedNote(total, shown) {
    return total > shown
        ? `<div class="profile-empty" style="grid-column:1/-1;">Показано останні ${shown} із ${total}</div>`
        : '';
}

function renderGarageTab(cars, total) {
    const grid = document.getElementById('profileCarsGrid');
    if (!grid) return;

    if (cars.length === 0) {
        grid.innerHTML = isOwn
            ? `<a href="garage.html" class="add-tile" style="grid-column:1/-1;"><i class="ti ti-plus"></i></a>`
            : `<div class="profile-empty" style="grid-column:1/-1;">Гараж поки порожній</div>`;
        return;
    }

    grid.innerHTML = cars.map(car => `
        <div class="pcar-card" data-href="car.html?id=${car.id}">
            <div class="pcar-banner"><i class="ti ti-car"></i></div>
            <div class="pcar-body">
                <div class="pcar-title">${escapeHtml(car.make)} ${escapeHtml(car.model)}</div>
                <div class="pcar-specs">
                    <div>
                        <div class="pcar-spec-lbl">Рік</div>
                        <div class="pcar-spec-val">${car.year || '—'}</div>
                    </div>
                    <div>
                        <div class="pcar-spec-lbl">Пробіг</div>
                        <div class="pcar-spec-val">${car.mileage ? Number(car.mileage).toLocaleString('uk-UA') : '—'}</div>
                    </div>
                    <div>
                        <div class="pcar-spec-lbl">Двигун</div>
                        <div class="pcar-spec-val">${escapeHtml(car.engine_code || '—')}</div>
                    </div>
                </div>
                <div class="pcar-foot">
                    <i class="ti ti-notes"></i> ${car.entries_count || 0} записів у бортжурналі
                </div>
            </div>
        </div>
    `).join('') + truncatedNote(total, cars.length);
}

function renderServiceTab(entries, cars, total) {
    document.getElementById('userSumSpend').textContent = '0 ₴';
    document.getElementById('userSumEntries').textContent = total + ' робіт';

    const list = document.getElementById('userServiceLogList');
    if (!list) return;

    if (entries.length === 0) {
        if (isOwn) {
            const href = cars.length > 0 ? `car.html?id=${cars[0].id}` : 'garage.html';
            list.innerHTML = `<a href="${href}" class="add-tile"><i class="ti ti-plus"></i></a>`;
        } else {
            list.innerHTML = `<div class="profile-empty">Бортжурнал поки порожній</div>`;
        }
        return;
    }

    list.innerHTML = entries.map(e => `
        <div class="plog-item" data-href="car.html?id=${e.car_id}">
            <div class="plog-top">
                <span class="plog-car"><i class="ti ti-car"></i> ${escapeHtml(e.car_name)}</span>
                <span class="plog-date">${timeAgo(e.timestamp)}</span>
            </div>
            <div class="plog-title">${escapeHtml(e.title)}</div>
            ${e.text ? `<div class="plog-text">${escapeHtml(e.text)}</div>` : ''}
            ${(e.tags && e.tags.length) ? `<div class="plog-tags">${e.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
    `).join('') + truncatedNote(total, entries.length);
}

function renderQuestionsTab(questions, total) {
    const list = document.getElementById('profileQuestionsList');
    if (!list) return;

    if (questions.length === 0) {
        list.innerHTML = isOwn
            ? `<a href="index.html" class="add-tile"><i class="ti ti-plus"></i></a>`
            : `<div class="profile-empty">Питань ще немає</div>`;
        return;
    }

    list.innerHTML = questions.map(q => {
        const badge = q.solved
            ? `<span class="badge-solved"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span>`
            : `<span class="badge-open">Шукаємо рішення</span>`;
        return `
            <div class="q-card" data-href="question.html?id=${q.id}">
                <div class="q-top">
                    <div class="avatar av-blue">${escapeHtml(getInitials(viewedUser))}</div>
                    <div class="q-body">
                        <div class="q-title">${escapeHtml(q.title)}</div>
                        <div class="q-meta">${timeAgo(q.timestamp)} · ${q.views || 0} переглядів</div>
                        <div class="q-tags">${q.category ? `<span class="tag">${escapeHtml(q.category)}</span>` : ''}</div>
                    </div>
                </div>
                <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-message-circle"></i> ${q.answers_count || 0} відповідей</span>
                    <span class="q-stat"><i class="ti ti-thumb-up"></i> ${q.likes || 0}</span>
                    <span class="q-stat"><i class="ti ti-eye"></i> ${q.views || 0}</span>
                    ${badge}
                </div>
            </div>
        `;
    }).join('') + truncatedNote(total, questions.length);
}

function renderAnswersTab(answers, total) {
    const list = document.getElementById('profileAnswersList');
    if (!list) return;

    if (answers.length === 0) {
        list.innerHTML = isOwn
            ? `<a href="index.html" class="add-tile"><i class="ti ti-plus"></i></a>`
            : `<div class="profile-empty">Відповідей ще немає</div>`;
        return;
    }

    list.innerHTML = answers.map(a => `
        <div class="q-card" style="cursor:default;">
            <div class="q-top">
                <div class="avatar av-green">${escapeHtml(getInitials(viewedUser))}</div>
                <div class="q-body">
                    <div class="q-meta" style="margin-bottom:6px;">${timeAgo(a.timestamp)}</div>
                    <div style="font-size:14px; line-height:1.6; white-space:pre-line; word-break:break-word;">${escapeHtml(a.text)}</div>
                    <div class="answer-source">
                        <i class="ti ti-corner-down-right"></i>
                        До питання: <a href="question.html?id=${a.question_id}">${escapeHtml(a.question_title)}</a>
                    </div>
                </div>
            </div>
        </div>
    `).join('') + truncatedNote(total, answers.length);
}

function renderTopicsTab(topics, total) {
    const list = document.getElementById('profileTopicsList');
    if (!list) return;

    if (topics.length === 0) {
        list.innerHTML = isOwn
            ? `<a href="forum.html" class="add-tile"><i class="ti ti-plus"></i></a>`
            : `<div class="profile-empty">Тем ще немає</div>`;
        return;
    }

    list.innerHTML = topics.map(t => `
        <div class="plog-item" data-href="topic.html?id=${t.id}">
            <div class="plog-top">
                <span class="plog-car" style="background:var(--red-light); color:var(--red-dark);">
                    ${escapeHtml(t.category)}
                </span>
                <span class="plog-date">${timeAgo(t.timestamp)}${t.closed ? ' · 🔒' : ''}</span>
            </div>
            <div class="plog-title">${t.pinned ? '📌 ' : ''}${escapeHtml(t.title)}</div>
            ${t.text ? `<div class="plog-text">${escapeHtml(t.text.slice(0, 160))}${t.text.length > 160 ? '…' : ''}</div>` : ''}
            <div class="ptopic-stats">
                <span><i class="ti ti-message-circle"></i> ${t.posts_count || 0} відповідей</span>
                <span><i class="ti ti-eye"></i> ${t.views || 0}</span>
                <span><i class="ti ti-chevron-up"></i> ${t.score || 0}</span>
            </div>
        </div>
    `).join('') + truncatedNote(total, topics.length);
}

// ====================== НАЛАШТУВАННЯ ======================
function renderSettingsTab(me) {
    document.getElementById('editCity').value = me.city || '';
    document.getElementById('editExp').value = me.experience || '';
    document.getElementById('editPhone').value = me.phone || '';
    document.getElementById('editShowPhone').checked = !!me.show_phone;
    document.getElementById('editBio').value = me.bio || '';
}

async function saveSettings() {
    const btn = document.getElementById('saveProfileSettingsBtn');
    btn.disabled = true;
    try {
        await api('PATCH', '/users/me', {
            city: document.getElementById('editCity').value.trim(),
            experience: document.getElementById('editExp').value.trim(),
            phone: document.getElementById('editPhone').value.trim(),
            show_phone: document.getElementById('editShowPhone').checked,
            bio: document.getElementById('editBio').value.trim()
        });
        showToast('Профіль збережено');
        await loadProfile();   // оновлюємо шапку без перезавантаження сторінки
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}
