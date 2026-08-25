// main.js — Глобальне ядро АвтоСпільноти (localStorage, Auth, Global UI)

const appState = {
    isLoggedIn: false,
    currentUser: null
};

// ====================== ГАМБУРГЕР — ВИДИМІСТЬ ======================
function updateHamburgerVisibility() {
    const btn = document.getElementById('hamburgerBtn');
    if (!btn) return;
    btn.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
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

function getMasters() {
    try {
        const data = localStorage.getItem('autospilnota_masters');
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveMasters(masters) {
    localStorage.setItem('autospilnota_masters', JSON.stringify(masters));
}

function addMaster(masterData) {
    const masters = getMasters();
    const newMaster = {
        id: generateId(),
        name: masterData.name,
        address: masterData.address,
        phone: masterData.phone || '',
        specialization: masterData.specialization || [],
        description: masterData.description || '',
        lat: masterData.lat,
        lng: masterData.lng,
        addedBy: appState.currentUser || 'Гість',
        createdAt: Date.now()
    };
    masters.unshift(newMaster);
    saveMasters(masters);
    return newMaster;
}

// ====================== БАЗА ДАНИХ (QUESTIONS) ======================
function getQuestions() {
    try {
        const data = localStorage.getItem('autospilnota_questions');
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveQuestions(questions) {
    localStorage.setItem('autospilnota_questions', JSON.stringify(questions));
}

function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function publishQuestion(text, category) {
    const questions = getQuestions();
    const newQ = {
        id: generateId(),
        title: text,
        text: text,
        author: appState.currentUser || 'Гість',
        category: category || 'Без категорії',
        timestamp: Date.now(),
        answers: [],
        views: 0,
        likes: 0,
        solved: false
    };
    questions.unshift(newQ);
    saveQuestions(questions);

    // Оновлюємо список, тільки якщо ми на головній сторінці (де є questionsList)
    if (document.getElementById('questionsList')) {
        renderQuestions();
        updateStats();
        updateMyActivity();
    }
}

function renderQuestions() {
    const list = document.getElementById('questionsList');
    if (!list) return;

    const questions = getQuestions();
    let filtered = [...questions];

    // Фільтр за статусом
    if (currentFilter === 'solved') {
        filtered = filtered.filter(q => q.solved);
    } else if (currentFilter === 'unsolved') {
        filtered = filtered.filter(q => !q.solved);
    }

    // Фільтр за категорією
    if (currentCategory) {
        filtered = filtered.filter(q => q.category === currentCategory);
    }

    // Пошук за текстом
    if (currentSearchQuery.trim()) {
        const q = currentSearchQuery.trim().toLowerCase();
        filtered = filtered.filter(item =>
            (item.title && item.title.toLowerCase().includes(q)) ||
            (item.text && item.text.toLowerCase().includes(q)) ||
            (item.category && item.category.toLowerCase().includes(q))
        );
    }

    // Сортування: "Гарячі" — за активністю, інакше — за новизною
    if (currentFilter === 'hot') {
        filtered.sort((a, b) => {
            const scoreA = (a.likes || 0) + (a.answers ? a.answers.length : 0) * 2;
            const scoreB = (b.likes || 0) + (b.answers ? b.answers.length : 0) * 2;
            return scoreB - scoreA;
        });
    } else {
        filtered.sort((a, b) => b.timestamp - a.timestamp);
    }

    if (filtered.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:40px 0; text-align:center;">Питань поки немає. Будьте першим!</div>`;
        return;
    }

    list.innerHTML = filtered.map(q => {
        const meta = QUESTION_CATEGORIES[q.category] || { avatar: 'blue' };
        const initials = getInitials(q.author);
        const answersCount = q.answers ? q.answers.length : 0;
        const badge = q.solved
            ? `<span class="badge-solved"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span>`
            : `<span class="badge-open">Шукаємо рішення</span>`;

        return `
            <div class="q-card" data-id="${q.id}">
                <div class="q-top">
                    <div class="avatar av-${meta.avatar}">${initials}</div>
                    <div class="q-body">
                        <div class="q-title">${escapeHtml(q.title)}</div>
                        <div class="q-meta">${escapeHtml(q.author)} · ${timeAgo(q.timestamp)} · ${q.views || 0} переглядів</div>
                        <div class="q-tags">${q.category ? `<span class="tag">${escapeHtml(q.category)}</span>` : ''}</div>
                    </div>
                </div>
               <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-message-circle"></i> ${answersCount} відповідей</span>
                    <span class="q-stat like-btn" data-id="${q.id}" style="cursor:pointer;">
                        <i class="ti ti-thumb-up${(q.likedBy || []).includes(appState.currentUser) ? '-filled' : ''}"></i>
                        ${(q.likedBy || []).length}
                    </span>
                    <span class="q-stat"><i class="ti ti-eye"></i> ${q.views || 0}</span>
                    ${badge}
                </div>
            </div>
        `;
    }).join('');

// Прив'язуємо кліки для переходу
    document.querySelectorAll('.q-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            if (id) window.location.href = `question.html?id=${id}`;
        });
    });

    // Прив'язуємо кліки по лайку (окремо, зі stopPropagation щоб не тригерити перехід на картку)
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(btn.dataset.id);
        });
    });
}

function getQuestionById(id) {
    const questions = getQuestions();
    return questions.find(q => q.id === id) || null;
}
function toggleLike(id) {
    if (!appState.isLoggedIn) {
        alert("Щоб лайкнути, потрібно увійти в акаунт");
        openAuthModal();
        return;
    }
    const q = getQuestionById(id);
    if (!q) return;
    if (!q.likedBy) q.likedBy = [];

    const idx = q.likedBy.indexOf(appState.currentUser);
    if (idx === -1) {
        q.likedBy.push(appState.currentUser);
    } else {
        q.likedBy.splice(idx, 1);
    }
    q.likes = q.likedBy.length;
    updateQuestion(q);
    renderQuestions();
}

function updateQuestion(updated) {
    const questions = getQuestions();
    const idx = questions.findIndex(q => q.id === updated.id);
    if (idx !== -1) {
        questions[idx] = updated;
        saveQuestions(questions);
    }
}

// ====================== ГАРАЖ (CARS) ======================
function getCars() {
    try {
        const data = localStorage.getItem('autospilnota_cars');
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveCars(cars) {
    localStorage.setItem('autospilnota_cars', JSON.stringify(cars));
}

function addCar(carData) {
    const cars = getCars();
    const newCar = {
        id: generateId(),
        owner: appState.currentUser || 'Гість',
        make: carData.make,
        model: carData.model,
        engineCode: carData.engineCode || '',
        year: carData.year || null,
        mileage: carData.mileage || 0,
        createdAt: Date.now(),
        entries: []
    };
    cars.unshift(newCar);
    saveCars(cars);
    return newCar;
}

function getCarById(id) {
    const cars = getCars();
    return cars.find(c => c.id === id) || null;
}

function updateCar(updated) {
    const cars = getCars();
    const idx = cars.findIndex(c => c.id === updated.id);
    if (idx !== -1) {
        cars[idx] = updated;
        saveCars(cars);
    }
}
// ====================== ФОРУМ (TOPICS) ======================
const FORUM_CATEGORIES = [
    'Техніка',
    'Тюнінг',
    'Поїздки',
    'Досвід і поради',
    'Офтопік'
];

function getTopics() {
    try {
        const data = localStorage.getItem('autospilnota_topics');
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveTopics(topics) {
    localStorage.setItem('autospilnota_topics', JSON.stringify(topics));
}

function addTopic(topicData) {
    const topics = getTopics();
    const newTopic = {
        id: generateId(),
        title: topicData.title,
        text: topicData.text,
        author: appState.currentUser || 'Гість',
        category: topicData.category || 'Офтопік',
        timestamp: Date.now(),
        pinned: false,
        closed: false,
        views: 0,
        posts: []
    };
    topics.unshift(newTopic);
    saveTopics(topics);
    return newTopic;
}

function getTopicById(id) {
    const topics = getTopics();
    return topics.find(t => t.id === id) || null;
}

function updateTopic(updated) {
    const topics = getTopics();
    const idx = topics.findIndex(t => t.id === updated.id);
    if (idx !== -1) {
        topics[idx] = updated;
        saveTopics(topics);
    }
}
// ====================== ДОПОМІЖНІ ФУНКЦІЇ ======================
function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
function updateStats() {
    const totalEl = document.getElementById('statTotal');
    const solvedEl = document.getElementById('statSolved');
    const usersEl = document.getElementById('statUsers');
    if (!totalEl || !solvedEl || !usersEl) return;

    const questions = getQuestions();
    const total = questions.length;
    const solvedCount = questions.filter(q => q.solved).length;
    const solvedPercent = total > 0 ? Math.round((solvedCount / total) * 100) : 0;

    // Унікальні автори питань + відповідей — найближче до "учасників", яке маємо з даних
    const authorsSet = new Set();
    questions.forEach(q => {
        if (q.author) authorsSet.add(q.author);
        (q.answers || []).forEach(a => { if (a.author) authorsSet.add(a.author); });
    });

    totalEl.textContent = total;
    solvedEl.textContent = solvedPercent + '%';
    usersEl.textContent = authorsSet.size;
}

function updateMyActivity() {
    const myQuestionsEl = document.getElementById('myQuestionsCount');
    const myAnswersEl = document.getElementById('myAnswersCount');
    if (!myQuestionsEl || !myAnswersEl) return;

    if (!appState.isLoggedIn) {
        myQuestionsEl.textContent = '0';
        myAnswersEl.textContent = '0';
        return;
    }

    const questions = getQuestions();
    const myQuestions = questions.filter(q => q.author === appState.currentUser).length;
    let myAnswers = 0;
    questions.forEach(q => {
        (q.answers || []).forEach(a => {
            if (a.author === appState.currentUser) myAnswers++;
        });
    });

    myQuestionsEl.textContent = myQuestions;
    myAnswersEl.textContent = myAnswers;
}
// ====================== ЧАТ ======================
function sendMessage() {
    const input = document.getElementById('chatInput');
    const msgsContainer = document.getElementById('chatMsgs');
    if (!input || !msgsContainer) return;
    const text = input.value.trim();
    if (!text) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap me';
    wrap.innerHTML = `
        <div class="msg-author" style="text-align:right;">Ви</div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    msgsContainer.appendChild(wrap);
    input.value = '';
    msgsContainer.scrollTop = msgsContainer.scrollHeight;
}

// ====================== АВТОРИЗАЦІЯ (AUTH) ======================
function saveAuthState() {
    localStorage.setItem('autospilnota_user', appState.isLoggedIn ? appState.currentUser : '');
}

function restoreAuthState() {
    const saved = localStorage.getItem('autospilnota_user');
    if (saved) {
        appState.isLoggedIn = true;
        appState.currentUser = saved;
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
                ${escapeHtml(appState.currentUser.split(' ')[0])}
                <i class="ti ti-chevron-down" style="font-size:12px;"></i>
            `;
        } else {
            triggerBtn.innerHTML = `<i class="ti ti-user"></i> Увійти`;
        }
    }

    if (dropdown) {
        if (appState.isLoggedIn) {
            dropdown.innerHTML = `
                <a href="profile.html?tab=questions" class="profile-dropdown-item">
                    <i class="ti ti-help-circle"></i> Мої питання
                </a>
                <a href="profile.html?tab=answers" class="profile-dropdown-item">
                    <i class="ti ti-message-circle"></i> Мої відповіді
                </a>
            `;
        } else {
            dropdown.innerHTML = '';
            dropdown.classList.remove('show');
        }
    }

    if (logoutHeaderBtn) {
        logoutHeaderBtn.style.display = appState.isLoggedIn ? 'flex' : 'none';
    }

    updateMyActivity();
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

function loginUser(name) {
    appState.isLoggedIn = true;
    appState.currentUser = name;
    saveAuthState();
    updateAuthUI();
    closeAuthModal();
    alert(`✅ Вітаємо, ${name.split(' ')[0]}!`);
}

function logoutUser() {
    appState.isLoggedIn = false;
    appState.currentUser = null;
    saveAuthState();
    updateAuthUI();
}
updateHamburgerVisibility();
    window.addEventListener('resize', updateHamburgerVisibility);

    // Мобільний гамбургер-сайдбар
    const hamburgerBtn = document.getElementById('hamburgerBtn');
// ====================== ЗАГАЛЬНІ СЛУХАЧІ ПОДІЙ ======================
document.addEventListener('DOMContentLoaded', () => {
    restoreAuthState();
    updateAuthUI();

 // Якщо ми на головній сторінці — рендеримо питання
    if (document.getElementById('questionsList')) {
        renderQuestions();
        updateStats();
        updateMyActivity();
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
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value.trim();
            if (!email || !password) return alert("Заповніть email та пароль");
            loginUser("Василь Петренко");
        });
    }

    const registerBtn = document.getElementById('registerBtn');
    if (registerBtn) {
        registerBtn.addEventListener('click', () => {
            const name = document.getElementById('registerName').value.trim();
            if (!name) return alert("Заповніть ім'я");
            loginUser(name);
        });
    }

    // === КНОПКИ ДЛЯ СТВОРЕННЯ ПИТАНЬ (Тільки на головній) ===
    const askHeaderBtn = document.querySelector('.header-actions .btn-red');
    if (askHeaderBtn) {
        askHeaderBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert("Щоб задати питання, потрібно увійти");
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
        submitNewQuestion.addEventListener('click', () => {
            const text = document.getElementById('modalQuestionText').value.trim();
            const category = document.getElementById('modalCategory').value;
            if (!text) return alert("Напишіть текст питання!");
            publishQuestion(text, category);
            alert("✅ Питання опубліковано!");
            closeNewQuestionModal();
        });
    }

    const askBoxSubmit = document.getElementById('askBoxSubmit');
    if (askBoxSubmit) {
        askBoxSubmit.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert("Щоб задати питання, потрібно увійти");
                openAuthModal();
                return;
            }
            const text = document.getElementById('askBoxText').value.trim();
            const category = document.getElementById('askBoxCategory').value;
            if (!text) return alert("Опишіть проблему!");
            publishQuestion(text, category);
            document.getElementById('askBoxText').value = '';
            document.getElementById('askBoxCategory').value = '';
        });
    }

    // === ЧАТ (Тільки на головній) ===
    const chatSendBtn = document.querySelector('.chat-send');
    const chatInputEl = document.getElementById('chatInput');
    if (chatSendBtn) chatSendBtn.addEventListener('click', sendMessage);
    if (chatInputEl) chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // === ФІЛЬТРИ (Тільки на головній) ===
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const label = btn.textContent.trim().toLowerCase();
            if (label.includes('нові')) currentFilter = 'all';
            else if (label.includes('гарячі')) currentFilter = 'hot';
            else if (label.includes('без відповіді')) currentFilter = 'unsolved';
            else if (label.includes('вирішені')) currentFilter = 'solved';
            renderQuestions();
        });
    });

    // === КАТЕГОРІЇ В САЙДБАРІ ===
    document.querySelectorAll('.sidebar-item[data-category]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.sidebar-item[data-category]').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentCategory = item.dataset.category;
            renderQuestions();
        });
    });

    // === ПОШУК У ХЕДЕРІ ===
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentSearchQuery = searchInput.value;
            renderQuestions();
        });
    }
    console.log('✅ Ядро АвтоСпільноти (main.js) запущено!');
});