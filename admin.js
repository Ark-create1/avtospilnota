/* Адмінка. Окрема сторінка: нічого з цього коду не підключається на публічних сторінках.
   Безпека тут лише на сервері (роль перевіряється в API); інтерфейс просто ховає зайве.
   Із main.js використовуємо тільки спільне: api(), escapeHtml(), showToast(), getToken(), openAuthModal(). */
(function () {
    'use strict';

    const root = document.getElementById('adminRoot');
    let me = null;
    let tab = 'stats';
    let userSearchTimer = null;

    const ROLE_LABEL = { owner: 'Власник', moderator: 'Модератор', user: 'Користувач' };
    const KIND_LABEL = { question: 'Питання', answer: 'Відповіді', topic: 'Теми', post: 'Відповіді в темах', chat: 'Чат' };
    const ACTION_LABEL = { ban: 'Блокування', unban: 'Розблокування', set_role: 'Зміна ролі', delete: 'Видалення' };

    const fmt = ts => ts ? new Date(ts).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const isOwner = () => me && me.role === 'owner';

    function gate(title, text, withLogin) {
        root.innerHTML = `
            <div class="adm-card" style="text-align:center; padding:40px 20px;">
                <div style="font-size:18px; font-weight:700; margin-bottom:8px;">${escapeHtml(title)}</div>
                <div style="color:var(--text-muted); font-size:14px; margin-bottom:16px;">${escapeHtml(text)}</div>
                ${withLogin ? '<button class="btn-red" id="admLoginBtn">Увійти</button>' : '<a class="btn-ghost" href="index.html" style="display:inline-block; text-decoration:none;">На головну</a>'}
            </div>`;
        const b = document.getElementById('admLoginBtn');
        if (b) b.addEventListener('click', () => openAuthModal());
    }

    async function init() {
        if (!getToken()) return gate('Потрібен вхід', 'Увійдіть в акаунт власника або модератора.', true);
        try {
            me = await api('GET', '/auth/me');
        } catch (e) {
            return gate('Не вдалося перевірити доступ', e.message, false);
        }
        if (me.role !== 'owner' && me.role !== 'moderator') {
            return gate('Немає доступу', 'Ця сторінка лише для модераторів сайту.', false);
        }
        shell();
        show('stats');
    }

    function shell() {
        const tabs = [['stats', 'Статистика'], ['users', 'Користувачі'], ['content', 'Контент']];
        if (isOwner()) tabs.push(['audit', 'Журнал']);
        root.innerHTML = `
            <div class="adm-head">
                <h1 class="adm-title">Адмінка</h1>
                <span class="adm-badge ${me.role}">${escapeHtml(ROLE_LABEL[me.role])}</span>
            </div>
            <div class="adm-tabs" id="admTabs">
                ${tabs.map(([k, l]) => `<button type="button" class="adm-tab" data-tab="${k}">${l}</button>`).join('')}
            </div>
            <div id="admPanel"></div>`;
        document.getElementById('admTabs').addEventListener('click', e => {
            const b = e.target.closest('.adm-tab');
            if (b) show(b.dataset.tab);
        });
        document.getElementById('admPanel').addEventListener('click', onPanelClick);
        document.getElementById('admPanel').addEventListener('change', onPanelChange);
        document.getElementById('admPanel').addEventListener('input', onPanelInput);
    }

    function show(name) {
        tab = name;
        document.querySelectorAll('.adm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        if (name === 'stats') loadStats();
        else if (name === 'users') loadUsers('');
        else if (name === 'content') loadContent('question');
        else if (name === 'audit') loadAudit();
    }

    const panel = () => document.getElementById('admPanel');
    function loading() { panel().innerHTML = '<div class="adm-muted">Завантаження…</div>'; }
    function failed(e) { panel().innerHTML = `<div class="adm-card adm-muted">${escapeHtml(e.message || 'Помилка')}</div>`; }

    // ---------- Статистика ----------
    async function loadStats() {
        loading();
        try {
            const s = await api('GET', '/admin/stats');
            const card = (title, main, rows) => `
                <div class="adm-card">
                    <div class="adm-muted" style="font-size:12px;">${title}</div>
                    <div class="adm-num">${main}</div>
                    <div class="adm-muted" style="font-size:12px;">${rows.join(' · ')}</div>
                </div>`;
            const cats = s.top_categories.length
                ? s.top_categories.map(c => `<div class="adm-row"><span>${escapeHtml(c.category)}</span><b>${c.count}</b></div>`).join('')
                : '<div class="adm-muted">Поки немає питань</div>';
            panel().innerHTML = `
                <div class="adm-grid">
                    ${card('Користувачі', s.users_total, [`+${s.users_24h} за добу`, `+${s.users_7d} за тиждень`, `заблоковано ${s.banned}`])}
                    ${card('Питання', s.questions_total, [`+${s.questions_24h} за добу`, `без відповіді ${s.questions_unanswered}`])}
                    ${card('Відповіді', s.answers_total, [`+${s.answers_24h} за добу`])}
                    ${card('Теми форуму', s.topics_total, [`+${s.topics_24h} за добу`, `повідомлень ${s.posts_total}`])}
                    ${card('Чат', s.chat_total, [`+${s.chat_24h} за добу`])}
                    ${card('Гараж', s.cars_total, [`записів ${s.entries_total}`, `СТО на мапі ${s.masters_total}`])}
                </div>
                <div class="adm-card" style="margin-top:12px;">
                    <div class="adm-muted" style="font-size:12px; margin-bottom:6px;">Популярні категорії питань</div>
                    ${cats}
                </div>`;
        } catch (e) { failed(e); }
    }

    // ---------- Користувачі ----------
    function canBan(u) {
        return u.id !== me.id && u.role !== 'owner' && (isOwner() || u.role === 'user');
    }
    function canSetRole(u) {
        return isOwner() && u.id !== me.id && u.role !== 'owner';
    }

    function userRow(u) {
        const email = isOwner() ? `<div class="adm-muted" style="font-size:12px;">${escapeHtml(u.email)}</div>` : '';
        const roleSel = canSetRole(u)
            ? `<select data-act="role" data-id="${u.id}" class="adm-select">
                   <option value="user"${u.role === 'user' ? ' selected' : ''}>Користувач</option>
                   <option value="moderator"${u.role === 'moderator' ? ' selected' : ''}>Модератор</option>
               </select>`
            : `<span class="adm-badge ${u.role}">${escapeHtml(ROLE_LABEL[u.role] || u.role)}</span>`;
        const ban = !canBan(u) ? '' : (u.is_banned
            ? `<button type="button" class="btn-ghost adm-btn" data-act="unban" data-id="${u.id}">Розблокувати</button>`
            : `<button type="button" class="btn-ghost adm-btn adm-danger" data-act="ban" data-id="${u.id}">Заблокувати</button>`);
        return `
            <div class="adm-card adm-user">
                <div style="min-width:0; flex:1;">
                    <div><a href="profile.html?user=${encodeURIComponent(u.name)}" style="font-weight:600; color:inherit;">${escapeHtml(u.name)}</a>
                        ${u.is_banned ? '<span class="adm-badge banned">заблоковано</span>' : ''}</div>
                    ${email}
                    <div class="adm-muted" style="font-size:12px;">id ${u.id} · з ${fmt(u.created_at)}</div>
                </div>
                <div class="adm-actions">${roleSel}${ban}</div>
            </div>`;
    }

    async function loadUsers(search) {
        const p = panel();
        if (!document.getElementById('admUserSearch')) {
            p.innerHTML = `
                <input type="search" id="admUserSearch" class="adm-input" placeholder="${isOwner() ? 'Пошук за іменем або email' : 'Пошук за іменем'}" autocomplete="off">
                <div id="admUserList" style="margin-top:10px;"></div>`;
        }
        const list = document.getElementById('admUserList');
        try {
            const users = await api('GET', '/admin/users?limit=100&search=' + encodeURIComponent(search));
            list.innerHTML = users.length ? users.map(userRow).join('') : '<div class="adm-muted">Нікого не знайдено</div>';
        } catch (e) { list.innerHTML = `<div class="adm-muted">${escapeHtml(e.message)}</div>`; }
    }

    // ---------- Контент ----------
    async function loadContent(kind) {
        panel().innerHTML = `
            <select id="admKind" class="adm-select" style="margin-bottom:10px;">
                ${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <div id="admContentList"><div class="adm-muted">Завантаження…</div></div>`;
        const list = document.getElementById('admContentList');
        try {
            const items = await api('GET', '/admin/recent?limit=40&kind=' + encodeURIComponent(kind));
            list.innerHTML = items.length ? items.map(it => `
                <div class="adm-card adm-user">
                    <div style="min-width:0; flex:1;">
                        ${it.title ? `<div style="font-weight:600;">${escapeHtml(it.title)}</div>` : ''}
                        <div style="font-size:13px; white-space:pre-wrap; word-break:break-word;">${escapeHtml(it.text)}</div>
                        <div class="adm-muted" style="font-size:12px; margin-top:4px;">${escapeHtml(it.author)} · ${fmt(it.timestamp)} · id ${it.id}</div>
                    </div>
                    <div class="adm-actions">
                        <button type="button" class="btn-ghost adm-btn adm-danger" data-act="delete" data-kind="${it.kind}" data-id="${it.id}">Видалити</button>
                    </div>
                </div>`).join('') : '<div class="adm-muted">Порожньо</div>';
        } catch (e) { list.innerHTML = `<div class="adm-muted">${escapeHtml(e.message)}</div>`; }
    }

    // ---------- Журнал ----------
    async function loadAudit() {
        loading();
        try {
            const rows = await api('GET', '/admin/audit?limit=100');
            panel().innerHTML = rows.length ? rows.map(r => `
                <div class="adm-card" style="font-size:13px;">
                    <b>${escapeHtml(r.actor)}</b> · ${escapeHtml(ACTION_LABEL[r.action] || r.action)} · ${escapeHtml(r.target_type)} #${r.target_id}
                    <span class="adm-muted"> · ${fmt(r.timestamp)}</span>
                    ${r.detail ? `<div class="adm-muted" style="margin-top:2px; word-break:break-word;">${escapeHtml(r.detail)}</div>` : ''}
                </div>`).join('') : '<div class="adm-muted">Журнал порожній</div>';
        } catch (e) { failed(e); }
    }

    // ---------- Дії ----------
    async function onPanelClick(e) {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act, id = parseInt(b.dataset.id, 10);
        try {
            if (act === 'ban') {
                const reason = prompt('Причина блокування (необов\'язково):', '');
                if (reason === null) return;
                await api('POST', `/admin/users/${id}/ban`, { reason });
                showToast('Користувача заблоковано');
                loadUsers(document.getElementById('admUserSearch').value);
            } else if (act === 'unban') {
                await api('POST', `/admin/users/${id}/unban`);
                showToast('Користувача розблоковано');
                loadUsers(document.getElementById('admUserSearch').value);
            } else if (act === 'delete') {
                if (!confirm('Видалити безповоротно? Дію буде записано в журнал.')) return;
                await api('DELETE', `/admin/content/${b.dataset.kind}/${id}`);
                showToast('Видалено');
                b.closest('.adm-card').remove();
            }
        } catch (err) { showToast(err.message, 'error'); }
    }

    async function onPanelChange(e) {
        const t = e.target;
        if (t.id === 'admKind') return loadContent(t.value);
        if (t.dataset && t.dataset.act === 'role') {
            try {
                await api('POST', `/admin/users/${t.dataset.id}/role`, { role: t.value });
                showToast('Роль змінено');
            } catch (err) {
                showToast(err.message, 'error');
                loadUsers(document.getElementById('admUserSearch').value);
            }
        }
    }

    function onPanelInput(e) {
        if (e.target.id !== 'admUserSearch') return;
        clearTimeout(userSearchTimer);
        userSearchTimer = setTimeout(() => loadUsers(e.target.value.trim()), 300);
    }

    document.addEventListener('autospilnota:auth', init);
    document.addEventListener('DOMContentLoaded', init);
})();
