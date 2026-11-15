// forum.js — стрічка тем форуму + створення нової теми.
// Дані з бекенду: GET /topics, POST /topics, POST /topics/{id}/vote

let currentForumCategory = '';
let currentForumSubcategory = '';
let pendingTopicPhoto = ''; // dataURL (файл) або URL — те, що реально піде в тему
let pendingTopicYoutubeId = '';
let currentForumSort = 'new'; // new | week | month | all
const FORUM_PAGE_SIZE = 15;

let topics = [];              // теми, завантажені з сервера
let topicsHasMore = false;
let topicsLoading = false;
let topicsError = '';
let topicsRequestId = 0;      // щоб відповідь на застарілий запит не перезаписала свіжу

document.addEventListener('DOMContentLoaded', () => {
    loadTopics(true);

    // Сортування: нові / топ за період
    const sortWrap = document.getElementById('forumSort');
    if (sortWrap) {
        sortWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-btn');
            if (!btn) return;
            sortWrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentForumSort = btn.dataset.sort;
            loadTopics(true);
        });
    }

    // Кліки по стрічці тем (делегування): голосування або перехід у тему
    const topicsListEl = document.getElementById('topicsList');
    if (topicsListEl) {
        topicsListEl.addEventListener('click', (e) => {
            const voteBtn = e.target.closest('.vote-btn');
            if (voteBtn) {
                handleTopicVote(voteBtn);
                return;
            }
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                if (actionEl.dataset.action === 'retry') loadTopics(true);
                else if (actionEl.dataset.action === 'more') loadTopics(false);
                return;
            }
            if (e.target.closest('a')) return;
            const card = e.target.closest('.q-card[data-id]');
            if (card) window.location.href = `topic.html?id=${encodeURIComponent(card.dataset.id)}`;
        });
    }

    // Після входу чи виходу «мої» голоси змінюються — перезавантажуємо стрічку
    let authTimer = null;
    document.addEventListener('autospilnota:auth', () => {
        clearTimeout(authTimer);
        authTimer = setTimeout(() => loadTopics(true), 50);
    });

    // Категорії верхнього рівня
    document.querySelectorAll('.forum-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.forum-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentForumCategory = btn.dataset.category || '';
            currentForumSubcategory = '';
            renderSubcatFilters();
            loadTopics(true);
        });
    });

    const newTopicBtn = document.getElementById('newTopicBtn');
    if (newTopicBtn) {
        newTopicBtn.addEventListener('click', () => {
            if (!appState.isLoggedIn) {
                showToast('Щоб створити тему, потрібно увійти', 'error');
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

    // Категорія в модалці → показуємо підкатегорії, якщо це "Техніка"
    const topicCategorySelect = document.getElementById('topicCategory');
    if (topicCategorySelect) {
        topicCategorySelect.addEventListener('change', () => {
            fillSubcategorySelect(topicCategorySelect.value);
        });
    }

    // Фото: URL
    const topicPhotoUrl = document.getElementById('topicPhotoUrl');
    if (topicPhotoUrl) {
        topicPhotoUrl.addEventListener('input', () => {
            if (topicPhotoUrl.value.trim()) {
                document.getElementById('topicPhotoFile').value = '';
                pendingTopicPhoto = topicPhotoUrl.value.trim();
                renderMediaPreview('topicPhotoPreview', 'photo', pendingTopicPhoto);
            } else if (!document.getElementById('topicPhotoFile').files.length) {
                pendingTopicPhoto = '';
                document.getElementById('topicPhotoPreview').innerHTML = '';
            }
        });
    }

    // Фото: файл (стискається перед збереженням)
    const topicPhotoFile = document.getElementById('topicPhotoFile');
    if (topicPhotoFile) {
        topicPhotoFile.addEventListener('change', async () => {
            const file = topicPhotoFile.files[0];
            if (!file) return;
            topicPhotoUrl.value = '';
            document.getElementById('topicPhotoPreview').innerHTML = `<div style="font-size:12px; color:var(--text-hint);">Обробка фото...</div>`;
            try {
                pendingTopicPhoto = await resizeImageFile(file, 900, 0.6);
                renderMediaPreview('topicPhotoPreview', 'photo', pendingTopicPhoto);
            } catch (err) {
                showToast('Не вдалось обробити фото, спробуйте інше', 'error');
                pendingTopicPhoto = '';
            }
        });
    }

    // YouTube
    const topicYoutubeUrl = document.getElementById('topicYoutubeUrl');
    if (topicYoutubeUrl) {
        topicYoutubeUrl.addEventListener('input', () => {
            const id = extractYouTubeId(topicYoutubeUrl.value.trim());
            pendingTopicYoutubeId = id || '';
            const preview = document.getElementById('topicYoutubePreview');
            preview.innerHTML = id
                ? `<div class="yt-embed"><iframe src="https://www.youtube.com/embed/${id}"></iframe></div>`
                : '';
        });
    }

    const saveTopicBtn = document.getElementById('saveTopicBtn');
    if (saveTopicBtn) {
        saveTopicBtn.addEventListener('click', async () => {
            const title = document.getElementById('topicTitle').value.trim();
            const category = document.getElementById('topicCategory').value;
            const subcategory = document.getElementById('topicSubcategory').value;
            const text = document.getElementById('topicText').value.trim();

            if (!title) return showToast('Вкажіть назву теми', 'error');
            if (!category) return showToast('Оберіть категорію', 'error');
            if (!text) return showToast('Напишіть текст повідомлення', 'error');

            saveTopicBtn.disabled = true;
            try {
                const topic = await api('POST', '/topics', {
                    title,
                    category,
                    subcategory,
                    text,
                    photo_url: pendingTopicPhoto,
                    youtube_id: pendingTopicYoutubeId
                });
                closeTopicModal();
                window.location.href = `topic.html?id=${topic.id}`;
            } catch (e) {
                showToast(e.message, 'error');
            } finally {
                saveTopicBtn.disabled = false;
            }
        });
    }
});

function fillSubcategorySelect(categoryName) {
    const select = document.getElementById('topicSubcategory');
    const cat = FORUM_CATEGORIES.find(c => c.name === categoryName);
    if (cat && cat.subcategories) {
        select.innerHTML = `<option value="">Підкатегорія (опційно)</option>` +
            cat.subcategories.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        select.style.display = 'block';
    } else {
        select.innerHTML = '';
        select.style.display = 'none';
    }
}

function renderSubcatFilters() {
    const wrap = document.getElementById('forumSubcats');
    const cat = FORUM_CATEGORIES.find(c => c.name === currentForumCategory);

    if (!cat || !cat.subcategories) {
        wrap.classList.remove('show');
        wrap.innerHTML = '';
        return;
    }

    wrap.innerHTML = cat.subcategories.map(s =>
        `<span class="forum-subcat-btn" data-sub="${escapeHtml(s)}">${escapeHtml(s)}</span>`
    ).join('');
    wrap.classList.add('show');

    wrap.querySelectorAll('.forum-subcat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('active');
            wrap.querySelectorAll('.forum-subcat-btn').forEach(b => b.classList.remove('active'));
            if (!isActive) {
                btn.classList.add('active');
                currentForumSubcategory = btn.dataset.sub;
            } else {
                currentForumSubcategory = '';
            }
            loadTopics(true);
        });
    });
}

function renderMediaPreview(containerId, type, value) {
    const el = document.getElementById(containerId);
    if (!value) { el.innerHTML = ''; return; }
    if (type === 'photo') {
        el.innerHTML = `<img src="${escapeHtml(value)}" alt=""><span class="remove-media" id="${containerId}Remove">Прибрати фото</span>`;
        document.getElementById(containerId + 'Remove').addEventListener('click', () => {
            pendingTopicPhoto = '';
            document.getElementById('topicPhotoUrl').value = '';
            document.getElementById('topicPhotoFile').value = '';
            el.innerHTML = '';
        });
    }
}

function openTopicModal() {
    const modal = document.getElementById('topicModal');
    if (modal) modal.classList.add('show');
}

function closeTopicModal() {
    const modal = document.getElementById('topicModal');
    if (modal) {
        modal.classList.remove('show');
        ['topicTitle', 'topicCategory', 'topicText', 'topicPhotoUrl', 'topicYoutubeUrl'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('topicPhotoFile').value = '';
        document.getElementById('topicSubcategory').innerHTML = '';
        document.getElementById('topicSubcategory').style.display = 'none';
        document.getElementById('topicPhotoPreview').innerHTML = '';
        document.getElementById('topicYoutubePreview').innerHTML = '';
        pendingTopicPhoto = '';
        pendingTopicYoutubeId = '';
    }
}

// Пілюля голосування для теми (вертикальна, збоку картки)
function topicVoteHtml(t) {
    const mine = t.my_vote || 0;
    return voteButtonsHtml({
        score: t.score || 0,
        up: mine > 0,
        down: mine < 0,
        attrs: `data-topic-id="${t.id}"`,
        upLabel: 'Цікава тема',
        cls: 'vote-pill-v'
    });
}

// Після голосу оновлюємо лише пілюлю цієї теми — стрічка не пересортовується й не стрибає під курсором
function refreshTopicVote(topicId) {
    const t = topics.find(x => x.id === topicId);
    if (!t) return;
    document.querySelectorAll('#topicsList .q-card').forEach(card => {
        if (card.dataset.id !== String(topicId)) return;
        const old = card.querySelector('.vote-pill');
        if (old) old.outerHTML = topicVoteHtml(t);
    });
}

// Один користувач — один голос. Якщо голос уже є, будь-який клік лише знімає його.
async function handleTopicVote(btn) {
    if (btn.dataset.busy) return;
    if (!appState.isLoggedIn) {
        showToast('Щоб голосувати, потрібно увійти', 'error');
        openAuthModal();
        return;
    }
    const topicId = parseInt(btn.dataset.topicId, 10);
    const dir = parseInt(btn.dataset.vote, 10);
    const t = topics.find(x => x.id === topicId);
    if (!t) return;

    const next = (t.my_vote || 0) !== 0 ? 0 : dir;
    btn.dataset.busy = '1';
    try {
        const res = await api('POST', `/topics/${topicId}/vote`, { vote: next });
        t.score = res.score;
        t.my_vote = res.my_vote;
        refreshTopicVote(topicId);
    } catch (e) {
        showToast(e.message, 'error');
        delete btn.dataset.busy;
    }
}

function forumQuery(offset) {
    const p = new URLSearchParams({ sort: currentForumSort, limit: String(FORUM_PAGE_SIZE), offset: String(offset) });
    if (currentForumCategory) p.set('category', currentForumCategory);
    if (currentForumSubcategory) p.set('subcategory', currentForumSubcategory);
    return '/topics?' + p.toString();
}

async function loadTopics(reset) {
    const myRequest = ++topicsRequestId;
    if (reset) {
        topics = [];
        topicsHasMore = false;
    }
    topicsError = '';
    topicsLoading = true;
    renderTopicsFeed();

    try {
        const data = await api('GET', forumQuery(reset ? 0 : topics.length));
        if (myRequest !== topicsRequestId) return;
        topics = reset ? data : topics.concat(data);
        topicsHasMore = data.length === FORUM_PAGE_SIZE;
    } catch (e) {
        if (myRequest !== topicsRequestId) return;
        topicsError = e.message;
    }
    topicsLoading = false;
    renderTopicsFeed();
}

function renderTopicsFeed() {
    const list = document.getElementById('topicsList');
    if (!list) return;

    if (topicsError && topics.length === 0) {
        list.innerHTML = `<div class="forum-error">
            <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Не вдалося завантажити теми</div>
            <div style="margin-bottom:14px;">${escapeHtml(topicsError)}</div>
            <button class="btn-red" data-action="retry"><i class="ti ti-refresh"></i> Спробувати ще</button>
        </div>`;
        return;
    }

    if (topicsLoading && topics.length === 0) {
        list.innerHTML = '<div class="forum-skeleton"></div>'.repeat(5);
        return;
    }

    if (topics.length === 0) {
        list.innerHTML = `<div style="color:var(--text-hint); padding:40px 0; text-align:center;">
            Тем поки немає. Створіть першу, або змініть фільтр!
        </div>`;
        return;
    }

    let html = topics.map(t => {
        const participants = (t.participants && t.participants.length) ? t.participants : [t.author];
        const lastAuthor = t.last_post_author || t.author;
        const lastText = t.last_post_author ? t.last_post_text : t.text;

        return `
            <div class="q-card topic-card" data-id="${t.id}">
                <div class="topic-votecol">${topicVoteHtml(t)}</div>
                <div class="topic-main">
                <div class="q-top">
                    <div class="avatar av-blue">${escapeHtml(getInitials(t.author))}</div>
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
                            ${t.subcategory ? `<span class="tag">${escapeHtml(t.subcategory)}</span>` : ''}
                            ${t.photo_url ? `<span class="tag"><i class="ti ti-photo"></i></span>` : ''}
                            ${t.youtube_id ? `<span class="tag"><i class="ti ti-brand-youtube"></i></span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="q-footer">
                    <span class="q-stat"><i class="ti ti-message-circle"></i> ${t.posts_count || 0} відповідей</span>
                    <span class="q-stat"><i class="ti ti-eye"></i> ${t.views || 0}</span>
                    <div class="avatar-stack" style="margin-left:auto;">
                        ${participants.map((p, i) => `<div class="avatar av-${['blue','green','amber','red'][i % 4]}" title="${escapeHtml(p)}">${escapeHtml(getInitials(p))}</div>`).join('')}
                    </div>
                    <span class="last-reply-preview">${escapeHtml(lastAuthor)}: ${escapeHtml((lastText || '').slice(0, 60))}</span>
                </div>
                </div>
            </div>
        `;
    }).join('');

    if (topicsError) {
        html += `<div class="forum-error">${escapeHtml(topicsError)}
            <div style="margin-top:10px;"><button class="btn-red" data-action="more">Спробувати ще</button></div></div>`;
    } else if (topicsHasMore) {
        html += `<div class="forum-more">
            <button class="btn-more" data-action="more" ${topicsLoading ? 'disabled' : ''}>${topicsLoading ? 'Завантаження...' : 'Показати ще'}</button>
        </div>`;
    }
    list.innerHTML = html;
}
