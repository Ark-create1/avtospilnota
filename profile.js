// profile.js — суто логіка сторінки профілю (мої питання / мої відповіді)

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('profileContent');
    if (!container) return;

    if (!appState.isLoggedIn) {
        renderLoggedOut(container);
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const activeTab = params.get('tab') === 'answers' ? 'answers' : 'questions';
    renderProfile(container, activeTab);
});

function renderLoggedOut(container) {
    container.innerHTML = `
        <div class="profile-empty">
            <i class="ti ti-user-circle"></i>
            <div style="font-size:15px; color:var(--text); margin-bottom:14px;">Увійдіть, щоб побачити свій профіль</div>
            <button class="btn-red" id="profileLoginBtn"><i class="ti ti-user"></i> Увійти</button>
        </div>
    `;

    const btn = document.getElementById('profileLoginBtn');
    if (btn) btn.addEventListener('click', () => openAuthModal());

    // Якщо людина увійшла через модалку прямо на цій сторінці — перерендерюємо профіль
    const authModal = document.getElementById('authModal');
    if (authModal) {
        const observer = new MutationObserver(() => {
            if (!authModal.classList.contains('show') && appState.isLoggedIn) {
                observer.disconnect();
                location.reload();
            }
        });
        observer.observe(authModal, { attributes: true, attributeFilter: ['class'] });
    }
}

function renderProfile(container, activeTab) {
    const questions = getQuestions();

    const myQuestions = questions
        .filter(q => q.author === appState.currentUser)
        .sort((a, b) => b.timestamp - a.timestamp);

    const myAnswers = [];
    questions.forEach(q => {
        (q.answers || []).forEach(a => {
            if (a.author === appState.currentUser) {
                myAnswers.push({ ...a, questionId: q.id, questionTitle: q.title });
            }
        });
    });
    myAnswers.sort((a, b) => b.timestamp - a.timestamp);

    container.innerHTML = `
        <div class="profile-header">
            <div class="profile-avatar">${getInitials(appState.currentUser)}</div>
            <div>
                <div class="profile-name">${escapeHtml(appState.currentUser)}</div>
                <div class="profile-stats">
                    <span><b>${myQuestions.length}</b> питань</span>
                    <span><b>${myAnswers.length}</b> відповідей</span>
                </div>
            </div>
        </div>

        <div class="profile-tabs">
            <button class="filter-btn ${activeTab === 'questions' ? 'active' : ''}" data-tab="questions">
                Мої питання (${myQuestions.length})
            </button>
            <button class="filter-btn ${activeTab === 'answers' ? 'active' : ''}" data-tab="answers">
                Мої відповіді (${myAnswers.length})
            </button>
        </div>

        <div id="profileList" style="display:flex; flex-direction:column; gap:12px;"></div>
    `;

    document.querySelectorAll('.profile-tabs .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-tabs .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            history.replaceState(null, '', `profile.html?tab=${tab}`);
            renderList(tab, myQuestions, myAnswers);
        });
    });

    renderList(activeTab, myQuestions, myAnswers);
}

function renderList(tab, myQuestions, myAnswers) {
    const list = document.getElementById('profileList');
    if (!list) return;

    if (tab === 'questions') {
        if (myQuestions.length === 0) {
            list.innerHTML = `
                <div class="profile-empty">
                    <i class="ti ti-help-circle"></i>
                    Ви ще не задали жодного питання
                </div>`;
            return;
        }

        list.innerHTML = myQuestions.map(q => {
            const answersCount = q.answers ? q.answers.length : 0;
            const badge = q.solved
                ? `<span class="badge-solved"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span>`
                : `<span class="badge-open">Шукаємо рішення</span>`;

            return `
                <div class="q-card" data-id="${q.id}">
                    <div class="q-top">
                        <div class="avatar av-blue">${getInitials(q.author)}</div>
                        <div class="q-body">
                            <div class="q-title">${escapeHtml(q.title)}</div>
                            <div class="q-meta">${timeAgo(q.timestamp)} · ${q.views || 0} переглядів</div>
                            <div class="q-tags">${q.category ? `<span class="tag">${escapeHtml(q.category)}</span>` : ''}</div>
                        </div>
                    </div>
                    <div class="q-footer">
                        <span class="q-stat"><i class="ti ti-message-circle"></i> ${answersCount} відповідей</span>
                        <span class="q-stat"><i class="ti ti-thumb-up"></i> ${(q.likedBy || []).length}</span>
                        <span class="q-stat"><i class="ti ti-eye"></i> ${q.views || 0}</span>
                        ${badge}
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.q-card').forEach(card => {
            card.addEventListener('click', () => {
                window.location.href = `question.html?id=${card.dataset.id}`;
            });
        });

    } else {
        if (myAnswers.length === 0) {
            list.innerHTML = `
                <div class="profile-empty">
                    <i class="ti ti-message-circle"></i>
                    Ви ще не залишили жодної відповіді
                </div>`;
            return;
        }

        list.innerHTML = myAnswers.map(a => `
            <div class="q-card" style="cursor:default;">
                <div class="q-top">
                    <div class="avatar av-green">${getInitials(appState.currentUser)}</div>
                    <div class="q-body">
                        <div class="q-meta" style="margin-bottom:6px;">${timeAgo(a.timestamp)}</div>
                        <div style="font-size:14px; line-height:1.6;">${escapeHtml(a.text)}</div>
                        <div class="answer-source">
                            <i class="ti ti-corner-down-right"></i>
                            До питання: <a href="question.html?id=${a.questionId}">${escapeHtml(a.questionTitle)}</a>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
}
