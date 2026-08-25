// question.js — суто логіка відображення конкретного питання та відповідей

document.addEventListener('DOMContentLoaded', () => {
    // Отримуємо ID з URL
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
        document.getElementById('qTitle').textContent = 'Питання не знайдено';
        return;
    }

    // getQuestionById оголошена глобально в main.js
    const question = getQuestionById(id);
    if (!question) {
        document.getElementById('qTitle').textContent = 'Питання не знайдено';
        return;
    }

    // Збільшуємо кількість переглядів
    question.views = (question.views || 0) + 1;
    updateQuestion(question); // Функція також глобальна в main.js

    // Рендеримо контент питання
    const meta = QUESTION_CATEGORIES[question.category] || { avatar: 'blue' };
    document.getElementById('qTitle').textContent = question.title;
    document.getElementById('qAvatar').textContent = getInitials(question.author);
    document.getElementById('qMeta').textContent = `${question.author} · ${timeAgo(question.timestamp)} · ${question.views} переглядів`;
    document.getElementById('qText').textContent = question.text;
    document.getElementById('qTags').innerHTML = question.category
        ? `<span class="tag">${escapeHtml(question.category)}</span>`
        : '';

// Кнопка "Позначити вирішеним" — тільки для автора, і тільки якщо ще не вирішено
    const markSolvedWrap = document.getElementById('markSolvedWrap');
    const markSolvedBtn = document.getElementById('markSolvedBtn');
    if (markSolvedWrap && markSolvedBtn) {
        if (appState.isLoggedIn && appState.currentUser === question.author && !question.solved) {
            markSolvedWrap.style.display = 'block';
            markSolvedBtn.addEventListener('click', () => {
                const q = getQuestionById(id);
                if (!q) return;
                q.solved = true;
                updateQuestion(q);
                markSolvedWrap.style.display = 'none';
                document.getElementById('qMeta').insertAdjacentHTML('afterend',
                    `<div style="margin-top:6px;"><span class="badge-solved" style="display:inline-flex;"><i class="ti ti-check" style="font-size:11px;"></i> Вирішено</span></div>`
                );
            });
        }
    }
    // Рендеримо список відповідей
    renderQuestionAnswers(question.answers || []);

    // Додавання відповіді
    const answerSubmit = document.getElementById('answerSubmit');
    if (answerSubmit) {
        answerSubmit.addEventListener('click', () => {
            // appState та openAuthModal доступні глобально з main.js
            if (!appState.isLoggedIn) {
                alert("Увійдіть, щоб відповісти");
                openAuthModal();
                return;
            }
            
            const textEl = document.getElementById('answerText');
            const text = textEl.value.trim();
            if (!text) return alert("Напишіть відповідь!");

            const q = getQuestionById(id);
            if (!q) return;
            if (!q.answers) q.answers = [];
            
            q.answers.push({
                author: appState.currentUser,
                text: text,
                timestamp: Date.now()
            });
            
            updateQuestion(q);
            textEl.value = '';
            
            // Миттєво оновлюємо UI без повної перезагрузки сторінки!
            renderQuestionAnswers(q.answers);
        });
    }
});

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
                <div class="avatar av-${['blue','green','amber','red'][i % 4]}">${getInitials(a.author)}</div>
                <div class="q-body">
                    <div class="q-meta" style="margin-bottom:6px;">${escapeHtml(a.author)} · ${timeAgo(a.timestamp)}</div>
                    <div style="font-size:14px; line-height:1.6;">${escapeHtml(a.text)}</div>
                </div>
            </div>
        </div>
    `).join('');
}