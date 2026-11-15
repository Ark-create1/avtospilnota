// question.js — сторінка одного питання та відповідей.
// Дані з бекенду: GET /questions/{id}, POST /questions/{id}/answers, POST /questions/{id}/solve

let currentQuestionId = null;
let currentQuestion = null;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id || !/^\d+$/.test(id)) {
        document.getElementById('qTitle').textContent = 'Питання не знайдено';
        return;
    }
    currentQuestionId = id;
    loadQuestion();

    // Повторна спроба після помилки мережі
    const answersList = document.getElementById('answersList');
    if (answersList) {
        answersList.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="retry"]')) loadQuestion();
        });
    }

    // Після входу чи виходу змінюється, чи показувати кнопку «Позначити вирішеним»
    document.addEventListener('autospilnota:auth', () => loadQuestion());

    // Кнопка «Позначити вирішеним» — лише для автора і лише якщо ще не вирішено
    const markSolvedBtn = document.getElementById('markSolvedBtn');
    if (markSolvedBtn) {
        markSolvedBtn.addEventListener('click', async () => {
            markSolvedBtn.disabled = true;
            try {
                currentQuestion = await api('POST', `/questions/${currentQuestionId}/solve`);
                renderQuestion(currentQuestion);
                updateSolvedControls();
                showToast('Питання позначено вирішеним');
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                markSolvedBtn.disabled = false;
            }
        });
    }

    // Додавання відповіді
    const answerSubmit = document.getElementById('answerSubmit');
    if (answerSubmit) {
        answerSubmit.addEventListener('click', async () => {
            if (!appState.isLoggedIn) {
                showToast('Увійдіть, щоб відповісти', 'error');
                openAuthModal();
                return;
            }
            const textEl = document.getElementById('answerText');
            const text = textEl.value.trim();
            if (!text) return showToast('Напишіть відповідь', 'error');

            answerSubmit.disabled = true;
            try {
                currentQuestion = await api('POST', `/questions/${currentQuestionId}/answers`, { text });
                textEl.value = '';
                renderQuestionAnswers(currentQuestion.answers || []);
                showToast('Відповідь додано');
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                answerSubmit.disabled = false;
            }
        });
    }
});

async function loadQuestion() {
    try {
        currentQuestion = await api('GET', `/questions/${currentQuestionId}`);
    } catch (e) {
        if (e.status === 404) {
            document.getElementById('qTitle').textContent = 'Питання не знайдено';
            return;
        }
        if (!currentQuestion) {
            document.getElementById('qTitle').textContent = 'Не вдалося завантажити питання';
            document.getElementById('answersList').innerHTML =
                `<div style="color:var(--text-hint); padding:16px 0; text-align:center;">${escapeHtml(e.message)}
                    <div style="margin-top:12px;"><button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button></div>
                </div>`;
        }
        return;
    }
    renderQuestion(currentQuestion);
    renderQuestionAnswers(currentQuestion.answers || []);
    updateSolvedControls();
}

function renderQuestion(q) {
    document.getElementById('qTitle').textContent = q.title;
    document.title = `${q.title} — АвтоСпільнота`;
    document.getElementById('qAvatar').textContent = getInitials(q.author);
    document.getElementById('qMeta').textContent = `${q.author} · ${timeAgo(q.timestamp)} · ${q.views} переглядів`;
    // Повний текст показуємо, лише якщо він відрізняється від заголовка
    document.getElementById('qText').textContent = q.text === q.title ? '' : q.text;
    document.getElementById('qTags').innerHTML = q.category
        ? `<span class="tag">${escapeHtml(q.category)}</span>`
        : '';
}

// Бейдж «Вирішено» і кнопка для автора
function updateSolvedControls() {
    const q = currentQuestion;
    if (!q) return;

    let badge = document.getElementById('qSolvedBadge');
    if (q.solved && !badge) {
        badge = document.createElement('div');
        badge.id = 'qSolvedBadge';
        badge.style.marginTop = '6px';
        badge.innerHTML = `<span class="badge-solved" style="display:inline-flex;"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span>`;
        document.getElementById('qMeta').insertAdjacentElement('afterend', badge);
    } else if (!q.solved && badge) {
        badge.remove();
    }

    const wrap = document.getElementById('markSolvedWrap');
    if (wrap) {
        const canSolve = appState.isLoggedIn && appState.currentUser === q.author && !q.solved;
        wrap.style.display = canSolve ? 'block' : 'none';
    }
}

function renderQuestionAnswers(answers) {
    const list = document.getElementById('answersList');
    const countEl = document.getElementById('answersCount');
    if (!list || !countEl) return;

    countEl.textContent = answers.length;

    if (answers.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:16px 0;">Поки що немає відповідей. Будьте першим!</div>`;
        return;
    }

    list.innerHTML = answers.map((a, i) => `
        <div class="q-card" style="cursor:default;">
            <div class="q-top">
                <div class="avatar av-${['blue','green','amber','red'][i % 4]}">${escapeHtml(getInitials(a.author))}</div>
                <div class="q-body">
                    <div class="q-meta" style="margin-bottom:6px;">
                        <a href="profile.html?user=${encodeURIComponent(a.author)}" style="color:inherit;">${escapeHtml(a.author)}</a> · ${timeAgo(a.timestamp)}
                    </div>
                    <div style="font-size:14px; line-height:1.6; white-space:pre-line; word-break:break-word;">${escapeHtml(a.text)}</div>
                </div>
            </div>
        </div>
    `).join('');
}
