// forum.js — стрічка тем форуму + створення нової теми

let currentForumCategory = '';

document.addEventListener('DOMContentLoaded', () => {
    renderTopicsFeed();

    document.querySelectorAll('.forum-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.forum-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentForumCategory = btn.dataset.category || '';
            renderTopicsFeed();
        });
    });

    const newTopicBtn = document.getElementById('newTopicBtn');
    if (newTopicBtn) {
        newTopicBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert('Щоб створити тему, потрібно увійти');
                openAuthModal();
                return;
            }
            openTopicModal();
        });
    }

    const closeTopicModalBtn = document.getElementById('closeTopicModal');
    if (closeTopicModalBtn) closeTopicModalBtn.addEventListener('click', closeTopicModal);

    const topicModal = document.getElementById('topicModal');
    if (topicModal) {
        topicModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeTopicModal();
        });
    }

    const saveTopicBtn = document.getElementById('saveTopicBtn');
    if (saveTopicBtn) {
        saveTopicBtn.addEventListener('click', () => {
            const title = document.getElementById('topicTitle').value.trim();
            const category = document.getElementById('topicCategory').value;
            const text = document.getElementById('topicText').value.trim();

            if (!title) return alert('Вкажіть назву теми');
            if (!category) return alert('Оберіть категорію');
            if (!text) return alert('Напишіть текст повідомлення');

            const topic = addTopic({ title, category, text });
            closeTopicModal();
            window.location.href = `topic.html?id=${topic.id}`;
        });
    }
});

function openTopicModal() {
    const modal = document.getElementById('topicModal');
    if (modal) modal.classList.add('show');
}

function closeTopicModal() {
    const modal = document.getElementById('topicModal');
    if (modal) {
        modal.classList.remove('show');
        ['topicTitle', 'topicCategory', 'topicText'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }
}

function renderTopicsFeed() {
    const list = document.getElementById('topicsList');
    if (!list) return;

    let topics = getTopics().slice();

    if (currentForumCategory) {
        topics = topics.filter(t => t.category === currentForumCategory);
    }

    topics.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.timestamp - a.timestamp;
    });

    if (topics.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:40px 0; text-align:center;">
            Тем поки немає. Створіть першу!
        </div>`;
        return;
    }

    list.innerHTML = topics.map(t => {
        const postsCount = t.posts ? t.posts.length : 0;
        const lastActivity = postsCount > 0 ? t.posts[t.posts.length - 1].timestamp : t.timestamp;
        const lastAuthor = postsCount > 0 ? t.posts[t.posts.length - 1].author : t.author;

        return `
            <div class="q-card" data-id="${t.id}">
                <div class="q-top">
                    <div class="avatar av-blue">${getInitials(t.author)}</div>
                    <div class="q-body">
                        <div class="q-title" style="white-space:normal;">
                            ${t.pinned ? '📌 ' : ''}${escapeHtml(t.title)}
                        </div>
                        <div class="q-meta">
                            ${escapeHtml(t.author)} · ${timeAgo(t.timestamp)}
                            ${t.closed ? ' · 🔒 Закрито' : ''}
                        </div>
                        <div class="q-tags">
                            <span class="tag">${escapeHtml(t.category)}</span>
                        </div>
                    </div>
                </div>
                <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-message-circle"></i> ${postsCount} відповідей</span>
                    <span class="q-stat"><i class="ti ti-eye"></i> ${t.views || 0}</span>
                    <span class="q-stat" style="margin-left:auto; font-size:11px;">
                        Останнє: ${escapeHtml(lastAuthor)} · ${timeAgo(lastActivity)}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('#topicsList .q-card').forEach(card => {
        card.addEventListener('click', () => {
            window.location.href = `topic.html?id=${card.dataset.id}`;
        });
    });
}