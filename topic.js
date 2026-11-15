// topic.js — сторінка однієї теми форуму: тема + відповіді-бульбашки, цитування, лайки, фото/YouTube.
// Дані з бекенду: GET /topics/{id}, POST /topics/{id}/posts, POST /topics/{id}/vote,
// POST /topics/{id}/posts/{post}/like

let currentTopicId = null;
let currentTopic = null;
let pendingQuote = null;       // { author, text }
let pendingPostPhoto = '';     // dataURL (файл) або URL
let pendingPostYoutubeId = '';

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id || !/^\d+$/.test(id)) {
        document.getElementById('topicTitle').textContent = 'Тему не знайдено';
        return;
    }
    currentTopicId = id;
    loadTopic();

    // Оцінка теми ▲/▼
    const voteBox = document.getElementById('topicVote');
    if (voteBox) {
        voteBox.addEventListener('click', (e) => {
            const btn = e.target.closest('.vote-btn');
            if (btn) handleTopicVote(btn);
        });
    }

    // Лайки, цитування й повторна спроба — делегуємо, бо відповіді перемальовуються
    const postsList = document.getElementById('postsList');
    if (postsList) {
        postsList.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="retry"]')) {
                loadTopic();
                return;
            }
            const likeBtn = e.target.closest('[data-like]');
            if (likeBtn) {
                handleLike(likeBtn);
                return;
            }
            const quoteBtn = e.target.closest('[data-quote]');
            if (quoteBtn) {
                const post = ((currentTopic && currentTopic.posts) || []).find(p => String(p.id) === quoteBtn.dataset.quote);
                if (!post) return;
                pendingQuote = { author: post.author, text: (post.text || '').slice(0, 120) };
                renderQuotePreview();
                const ta = document.getElementById('postText');
                ta.focus();
                ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    // Після входу чи виходу змінюються «мої» голоси й лайки
    document.addEventListener('autospilnota:auth', () => loadTopic());

    setupReplyForm();
});

// ====================== ЗАВАНТАЖЕННЯ ======================
async function loadTopic() {
    try {
        currentTopic = await api('GET', `/topics/${currentTopicId}`);
    } catch (e) {
        if (e.status === 404) {
            document.getElementById('topicTitle').textContent = 'Тему не знайдено';
            return;
        }
        if (!currentTopic) {
            document.getElementById('postsList').innerHTML =
                `<div style="color:var(--text-hint); padding:16px 0; text-align:center;">${escapeHtml(e.message)}
                    <div style="margin-top:12px;"><button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button></div>
                </div>`;
        }
        return;
    }
    renderTopicHeader(currentTopic);
    renderTopicVote(currentTopic);
    renderPosts(currentTopic.posts || []);

    const closed = !!currentTopic.closed;
    const replyBox = document.getElementById('replyBox');
    const closedMsg = document.getElementById('topicClosedMsg');
    if (replyBox) replyBox.style.display = closed ? 'none' : '';
    if (closedMsg) closedMsg.style.display = closed ? 'block' : 'none';
}

// Один користувач — один голос. Якщо голос уже є, будь-який клік лише знімає його.
async function handleTopicVote(btn) {
    if (btn.dataset.busy) return;
    if (!appState.isLoggedIn) {
        showToast('Щоб голосувати, потрібно увійти', 'error');
        openAuthModal();
        return;
    }
    if (!currentTopic) return;
    const dir = parseInt(btn.dataset.vote, 10);
    const next = (currentTopic.my_vote || 0) !== 0 ? 0 : dir;
    btn.dataset.busy = '1';
    try {
        const res = await api('POST', `/topics/${currentTopicId}/vote`, { vote: next });
        currentTopic.score = res.score;
        currentTopic.my_vote = res.my_vote;
        renderTopicVote(currentTopic);
    } catch (e) {
        showToast(e.message, 'error');
        delete btn.dataset.busy;
    }
}

// Лайк відповіді: поставити або зняти
async function handleLike(btn) {
    if (btn.dataset.busy) return;
    if (!appState.isLoggedIn) {
        showToast('Щоб ставити лайки, потрібно увійти', 'error');
        openAuthModal();
        return;
    }
    const post = ((currentTopic && currentTopic.posts) || []).find(p => String(p.id) === btn.dataset.like);
    if (!post) return;
    btn.dataset.busy = '1';
    try {
        const res = await api('POST', `/topics/${currentTopicId}/posts/${post.id}/like`, { vote: post.liked_by_me ? 0 : 1 });
        post.likes_count = res.score;
        post.liked_by_me = res.my_vote > 0;
        renderPosts(currentTopic.posts);
    } catch (e) {
        showToast(e.message, 'error');
        delete btn.dataset.busy;
    }
}

// ====================== ВІДОБРАЖЕННЯ ======================
function mediaHtml(photoUrl, youtubeId) {
    let html = '';
    if (photoUrl && /^(https?:\/\/|data:image\/)/i.test(photoUrl)) html += `<img src="${escapeHtml(photoUrl)}" alt="">`;
    if (youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) html += `<div class="yt-embed"><iframe src="https://www.youtube.com/embed/${youtubeId}" allowfullscreen></iframe></div>`;
    return html;
}

function renderTopicHeader(topic) {
    document.getElementById('topicTitle').textContent = topic.title;
    document.title = `${topic.title} — АвтоСпільнота`;
    document.getElementById('topicAvatar').textContent = getInitials(topic.author);
    document.getElementById('topicMeta').innerHTML =
        `<a href="profile.html?user=${encodeURIComponent(topic.author)}" style="color:inherit;">${escapeHtml(topic.author)}</a> · ${timeAgo(topic.timestamp)} · ${topic.views || 0} переглядів`;
    document.getElementById('topicTags').innerHTML =
        `<span class="tag">${escapeHtml(topic.category)}</span>` +
        (topic.subcategory ? `<span class="tag">${escapeHtml(topic.subcategory)}</span>` : '');
    document.getElementById('topicText').textContent = topic.text;
    document.getElementById('topicMedia').innerHTML = mediaHtml(topic.photo_url, topic.youtube_id);
}

function renderTopicVote(topic) {
    const box = document.getElementById('topicVote');
    if (!box || !topic) return;
    const mine = topic.my_vote || 0;
    box.innerHTML = voteButtonsHtml({
        score: topic.score || 0,
        up: mine > 0,
        down: mine < 0,
        attrs: `data-topic-id="${topic.id}"`,
        upLabel: 'Цікава тема'
    }) + `<span class="topic-vote-hint">Оцініть тему</span>`;
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

    list.innerHTML = posts.map((p, i) => {
        const likesCount = p.likes_count || 0;
        const isLiked = !!p.liked_by_me;
        return `
            <div class="reply-item">
                <div class="avatar av-${['blue','green','amber','red'][i % 4]}" style="width:36px; height:36px; flex-shrink:0;">${escapeHtml(getInitials(p.author))}</div>
                <div class="reply-bubble">
                    <div class="reply-head">
                        <a class="reply-author" href="profile.html?user=${encodeURIComponent(p.author)}">${escapeHtml(p.author)}</a>
                        <span class="reply-time">${timeAgo(p.timestamp)}</span>
                    </div>
                    ${p.quote_author ? `<div class="reply-quote"><b>${escapeHtml(p.quote_author)}:</b> ${escapeHtml(p.quote_text)}</div>` : ''}
                    <div class="reply-text">${escapeHtml(p.text)}</div>
                    <div class="post-media">${mediaHtml(p.photo_url, p.youtube_id)}</div>
                    <div class="reply-actions">
                        <button class="reply-action-btn ${isLiked ? 'liked' : ''}" data-like="${p.id}">
                            <i class="ti ${isLiked ? 'ti-thumb-up-filled' : 'ti-thumb-up'}"></i> ${likesCount}
                        </button>
                        <button class="reply-action-btn" data-quote="${p.id}">
                            <i class="ti ti-quote"></i> Цитувати
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderQuotePreview() {
    const el = document.getElementById('quotePreview');
    if (!pendingQuote) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="reply-quote" style="margin-bottom:8px; display:flex; justify-content:space-between; gap:8px;">
            <span><b>${escapeHtml(pendingQuote.author)}:</b> ${escapeHtml(pendingQuote.text)}</span>
            <span class="remove-media" id="removeQuote" style="cursor:pointer;">✕</span>
        </div>`;
    document.getElementById('removeQuote').addEventListener('click', () => {
        pendingQuote = null;
        renderQuotePreview();
    });
}

// ====================== ФОРМА ВІДПОВІДІ ======================
function setupReplyForm() {
    const photoUrl = document.getElementById('postPhotoUrl');
    const photoFile = document.getElementById('postPhotoFile');
    const photoPreview = document.getElementById('postPhotoPreview');
    const ytInput = document.getElementById('postYoutubeUrl');
    const ytPreview = document.getElementById('postYoutubePreview');

    const showPhotoPreview = () => {
        if (!pendingPostPhoto) { photoPreview.innerHTML = ''; return; }
        photoPreview.innerHTML = `<img src="${escapeHtml(pendingPostPhoto)}" alt=""><span class="remove-media" id="removePostPhoto">Прибрати фото</span>`;
        document.getElementById('removePostPhoto').addEventListener('click', () => {
            pendingPostPhoto = '';
            photoUrl.value = '';
            photoFile.value = '';
            photoPreview.innerHTML = '';
        });
    };

    photoUrl.addEventListener('input', () => {
        if (photoUrl.value.trim()) {
            photoFile.value = '';
            pendingPostPhoto = photoUrl.value.trim();
        } else if (!photoFile.files.length) {
            pendingPostPhoto = '';
        }
        showPhotoPreview();
    });

    photoFile.addEventListener('change', async () => {
        const file = photoFile.files[0];
        if (!file) return;
        photoUrl.value = '';
        photoPreview.innerHTML = `<div style="font-size:12px; color:var(--text-hint);">Обробка фото...</div>`;
        try {
            pendingPostPhoto = await resizeImageFile(file, 900, 0.6);
            showPhotoPreview();
        } catch (err) {
            showToast('Не вдалось обробити фото, спробуйте інше', 'error');
            pendingPostPhoto = '';
            photoPreview.innerHTML = '';
        }
    });

    ytInput.addEventListener('input', () => {
        const id = extractYouTubeId(ytInput.value.trim());
        pendingPostYoutubeId = id || '';
        ytPreview.innerHTML = id
            ? `<div class="yt-embed"><iframe src="https://www.youtube.com/embed/${id}"></iframe></div>`
            : '';
    });

    const submit = document.getElementById('postSubmit');
    submit.addEventListener('click', async () => {
        if (!appState.isLoggedIn) {
            showToast('Увійдіть, щоб відповісти', 'error');
            openAuthModal();
            return;
        }
        if (currentTopic && currentTopic.closed) return showToast('Тема закрита', 'error');

        const text = document.getElementById('postText').value.trim();
        if (!text && !pendingPostPhoto && !pendingPostYoutubeId) return showToast('Напишіть відповідь', 'error');

        submit.disabled = true;
        try {
            currentTopic = await api('POST', `/topics/${currentTopicId}/posts`, {
                text,
                quote_author: pendingQuote ? pendingQuote.author : '',
                quote_text: pendingQuote ? pendingQuote.text : '',
                photo_url: pendingPostPhoto,
                youtube_id: pendingPostYoutubeId
            });

            document.getElementById('postText').value = '';
            photoUrl.value = '';
            photoFile.value = '';
            ytInput.value = '';
            photoPreview.innerHTML = '';
            ytPreview.innerHTML = '';
            pendingQuote = null;
            pendingPostPhoto = '';
            pendingPostYoutubeId = '';
            renderQuotePreview();
            renderPosts(currentTopic.posts || []);
            showToast('Відповідь додано');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            submit.disabled = false;
        }
    });
}
