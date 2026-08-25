// topic.js — сторінка однієї теми форуму + відповіді

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) {
        document.getElementById('topicTitle').textContent = 'Тему не знайдено';
        return;
    }

    const topic = getTopicById(id);
    if (!topic) {
        document.getElementById('topicTitle').textContent = 'Тему не знайдено';
        return;
    }

    topic.views = (topic.views || 0) + 1;
    updateTopic(topic);

    renderTopicHeader(topic);
    renderPosts(topic.posts || []);

    if (topic.closed) {
        const replyBox = document.getElementById('replyBox');
        const closedMsg = document.getElementById('topicClosedMsg');
        if (replyBox) replyBox.style.display = 'none';
        if (closedMsg) closedMsg.style.display = 'block';
    }

    const postSubmit = document.getElementById('postSubmit');
    if (postSubmit) {
        postSubmit.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                alert('Увійдіть, щоб відповісти');
                openAuthModal();
                return;
            }

            const t = getTopicById(id);
            if (!t) return;
            if (t.closed) return alert('Тема закрита');

            const text = document.getElementById('postText').value.trim();
            if (!text) return alert('Напишіть відповідь');

            if (!t.posts) t.posts = [];
            t.posts.push({
                id: generateId(),
                author: appState.currentUser,
                text,
                timestamp: Date.now()
            });

            updateTopic(t);
            document.getElementById('postText').value = '';
            renderPosts(t.posts);
        });
    }
});

function renderTopicHeader(topic) {
    document.getElementById('topicTitle').textContent = topic.title;
    document.getElementById('topicAvatar').textContent = getInitials(topic.author);
    document.getElementById('topicMeta').textContent =
        `${topic.author} · ${timeAgo(topic.timestamp)} · ${topic.views || 0} переглядів`;
    document.getElementById('topicTags').innerHTML =
        `<span class="tag">${escapeHtml(topic.category)}</span>`;
    document.getElementById('topicText').textContent = topic.text;
}

function renderPosts(posts) {
    const list = document.getElementById('postsList');
    const countEl = document.getElementById('postsCount');
    if (!list || !countEl) return;

    countEl.textContent = posts.length;

    if (posts.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:16px 0;">Поки немає відповідей. Будьте першим!</div>`;
        return;
    }

    list.innerHTML = posts.map((p, i) => `
        <div class="q-card" style="cursor:default;">
            <div class="q-top">
                <div class="avatar av-${['blue','green','amber','red'][i % 4]}">${getInitials(p.author)}</div>
                <div class="q-body">
                    <div class="q-meta" style="margin-bottom:6px;">${escapeHtml(p.author)} · ${timeAgo(p.timestamp)}</div>
                    <div style="font-size:14px; line-height:1.6;">${escapeHtml(p.text)}</div>
                </div>
            </div>
        </div>
    `).join('');
}