// chat.js — загальний чат АвтоСпільноти.
//
// Дані: повідомлення живуть на сервері (GET /chat, POST /chat). Поки що чат працює опитуванням
// (кожні кілька секунд питаємо лише нові повідомлення), пізніше це можна замінити на WebSocket,
// змінивши лише шар `chatApi` нижче. Ліміти частоти й довжини перевіряє сервер.
//
// Потребує з main.js: api, appState, openAuthModal, escapeHtml, getInitials.
// Підключається автоматично з main.js на всіх сторінках.

(function () {
    'use strict';

    if (window.__autospilnotaChatLoaded) return;
    window.__autospilnotaChatLoaded = true;

    const SEEN_KEY = 'autospilnota_chat_seen';
    const MAX_LEN = 500;             // максимальна довжина повідомлення
    const POLL_VISIBLE_MS = 4000;    // як часто питаємо нові повідомлення, коли вкладка відкрита
    const POLL_HIDDEN_MS = 20000;    // ... і коли вкладка у фоні
    const GROUP_GAP_MS = 5 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Де показувати іконку чату:
    //   'auto'   — у шапці на десктопі, плаваюча кнопка на телефоні (рекомендовано)
    //   'header' — завжди в шапці
    //   'fab'    — завжди плаваюча кнопка збоку
    const CHAT_ICON_MODE = 'auto';

    // ====================== ШАР ДАНИХ (chatApi): HTTP до бекенду ======================
    const subscribers = [];
    let cache = [];          // повідомлення, відсортовані за id
    let lastId = 0;
    let loaded = false;
    let loadError = '';
    let pollTimer = null;
    let polling = false;

    function notify() {
        subscribers.forEach(cb => { try { cb(); } catch (e) { /* ignore */ } });
    }

    function mergeMessages(msgs) {
        let changed = false;
        msgs.forEach(m => {
            if (!cache.some(x => x.id === m.id)) {
                cache.push(m);
                changed = true;
            }
            if (m.id > lastId) lastId = m.id;
        });
        if (changed) cache.sort((a, b) => a.id - b.id);
        return changed;
    }

    async function pollOnce() {
        if (polling) return;
        polling = true;
        try {
            const path = lastId ? `/chat?after_id=${lastId}&limit=100` : '/chat?limit=100';
            const msgs = await api('GET', path);
            const hadError = !!loadError;
            loadError = '';
            const firstLoad = !loaded;
            loaded = true;
            if (mergeMessages(msgs) || firstLoad || hadError) notify();
        } catch (e) {
            const changed = loadError !== e.message;
            loadError = e.message;
            if (changed) notify();
        } finally {
            polling = false;
        }
    }

    function schedulePoll() {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(async () => {
            await pollOnce();
            schedulePoll();
        }, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    }

    const chatApi = {
        getMessages() { return cache; },
        isLoaded() { return loaded; },
        getError() { return loadError; },

        // Повертає { ok: true } або { ok: false, error: '...' }
        async send(rawText) {
            const text = String(rawText || '').replace(/\s+/g, ' ').trim();
            if (!text) return { ok: false, error: 'Напишіть повідомлення' };
            if (text.length > MAX_LEN) return { ok: false, error: `Не більше ${MAX_LEN} символів` };
            try {
                const msg = await api('POST', '/chat', { text });
                mergeMessages([msg]);
                notify();
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        refresh() { return pollOnce(); },

        subscribe(cb) {
            subscribers.push(cb);
            return () => {
                const i = subscribers.indexOf(cb);
                if (i >= 0) subscribers.splice(i, 1);
            };
        },

        getSeen() {
            const v = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
            return isNaN(v) ? 0 : v;
        },

        markSeen() {
            if (!lastId) return;
            try { localStorage.setItem(SEEN_KEY, String(lastId)); } catch (e) { /* ignore */ }
        }
    };

    // ====================== ДОПОМІЖНЕ ======================
    function currentUser() {
        return appState.isLoggedIn ? appState.currentUser : null;
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function formatTime(ts) {
        const d = new Date(ts);
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function dayKey(ts) {
        const d = new Date(ts);
        return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    function dayLabel(ts) {
        const today = new Date();
        const yesterday = new Date(Date.now() - DAY_MS);
        const k = dayKey(ts);
        if (k === dayKey(today.getTime())) return 'Сьогодні';
        if (k === dayKey(yesterday.getTime())) return 'Вчора';
        const d = new Date(ts);
        return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    // ====================== СТИЛІ ======================
    function injectStyles() {
        if (document.getElementById('chatStyles')) return;
        const css = `
            .chat-dock { }
            .chat-list { overscroll-behavior: contain; }
            .chat-list .msg-bubble { overflow-wrap: anywhere; word-break: break-word; }
            .chat-list .msg-wrap.grouped { margin-top: -6px; }
            .chat-day { display: flex; align-items: center; justify-content: center; margin: 4px 0; }
            .chat-day span {
                font-size: 10.5px; color: var(--text-hint); background: var(--bg);
                border-radius: 20px; padding: 2px 10px;
            }
            .chat-empty { text-align: center; color: var(--text-hint); font-size: 12.5px; padding: 24px 12px; }
            .chat-hint { min-height: 0; font-size: 11.5px; color: var(--red); padding: 0 14px; }
            .chat-hint:not(:empty) { padding: 4px 14px 0; }
            .chat-newbtn {
                align-self: center; margin: 0 0 6px; border: none; cursor: pointer;
                background: var(--text); color: #fff; font-size: 11.5px; font-weight: 600;
                font-family: 'Manrope', sans-serif; padding: 5px 12px; border-radius: 20px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            }

            /* Плаваюча панель чату (усі сторінки, крім головної на десктопі) */
            .chat-float {
                position: fixed; right: 20px; bottom: 88px; z-index: 1250;
                width: 360px; height: min(560px, calc(100vh - 120px));
                display: none; flex-direction: column;
                background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px;
                box-shadow: 0 16px 48px rgba(0,0,0,0.22); overflow: hidden;
            }
            .chat-float.open { display: flex; }
            .chat-float .chat-msgs { max-height: none; flex: 1 1 auto; min-height: 0; }
            .chat-float .chat-close-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 36px; margin-left: auto; }
            .chat-fab-live { display: flex; bottom: 24px; z-index: 1200; }
            @media (max-width: 900px) { .chat-fab-live { bottom: calc(74px + env(safe-area-inset-bottom, 0px)); } }
            .chat-sheet-overlay { z-index: 1240; }
            body.has-chat-dock .chat-fab-live { display: none; }

            /* Розгорнутий чат: вікно по центру поверх сторінки (лише ПК) */
            .chat-expand-btn {
                display: none; margin-left: 8px; align-items: center; justify-content: center;
                width: 30px; height: 30px; border: none; border-radius: 8px; cursor: pointer;
                background: none; color: var(--text-muted); font-size: 16px;
            }
            .chat-expand-btn:hover { background: var(--bg); color: var(--text); }
            .chat-expanded-backdrop { display: none; position: fixed; inset: 0; z-index: 1255; background: rgba(20,20,20,0.45); }
            .chat-expanded-backdrop.show { display: block; }
            .chat-expanded {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1260;
                width: min(960px, 92vw); height: min(760px, 86vh);
                display: none; flex-direction: column;
                background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px;
                box-shadow: 0 24px 64px rgba(0,0,0,0.3); overflow: hidden;
            }
            .chat-expanded.open { display: flex; animation: chatExpandIn 0.16s ease-out; }
            .chat-expanded .chat-msgs { max-height: none; flex: 1 1 auto; min-height: 0; padding: 16px 24px; }
            .chat-expanded .chat-input-area { padding-left: 24px; padding-right: 24px; }
            .chat-expanded .chat-close-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 36px; margin-left: 8px; }
            @keyframes chatExpandIn { from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
            @media (prefers-reduced-motion: reduce) { .chat-expanded.open { animation: none; } }
            @media (min-width: 901px) {
                .chat-expand-btn { display: inline-flex; }
                .chat-head .chat-expand-btn + .chat-close-btn { margin-left: 4px; }
            }
            @media (max-width: 900px) { .chat-expanded, .chat-expanded-backdrop { display: none !important; } }

            /* Іконка чату в шапці */
            .chat-header-btn { display: none; position: relative; min-width: 40px; align-items: center; justify-content: center; }
            .chat-header-badge {
                position: absolute; top: -5px; right: -5px; min-width: 17px; height: 17px; padding: 0 4px;
                border-radius: 9px; background: var(--red); color: #fff; font-size: 10px; font-weight: 700;
                align-items: center; justify-content: center; box-sizing: border-box;
            }
            body.chat-icon-header .chat-header-btn { display: inline-flex; }
            body.chat-icon-header .chat-fab-live { display: none !important; }
            body.chat-icon-fab .chat-header-btn { display: none !important; }

            @media (min-width: 901px) {
                .chat-sheet-overlay { display: none !important; }
                body.chat-icon-auto .chat-header-btn { display: inline-flex; }
                body.chat-icon-auto .chat-fab-live { display: none !important; }
                /* на головній чат і так стоїть у колонці */
                body.has-chat-dock .chat-header-btn { display: none !important; }
                /* з шапки панель випадає під іконкою */
                body.chat-icon-header .chat-float, body.chat-icon-auto .chat-float {
                    top: 64px; bottom: auto; right: 20px; height: min(560px, calc(100vh - 90px));
                }
            }

            /* Телефон: чат — нижня шторка */
            @media (max-width: 900px) {
                body.has-chat-dock .chat-fab-live { display: flex; }
                .chat-dock { display: none !important; }
                .chat-float {
                    left: 0; right: 0; bottom: 0; width: auto;
                    height: 78vh; height: 78dvh; max-height: calc(100vh - 56px);
                    border-radius: 16px 16px 0 0; border-left: none; border-right: none; border-bottom: none;
                }
                .chat-float .chat-input-area { padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
            }
        `;
        const style = document.createElement('style');
        style.id = 'chatStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ====================== ІНТЕРФЕЙС ======================
    class ChatView {
        constructor(root, opts) {
            this.root = root;
            this.opts = opts || {};
            this.firstRender = true;
            this.lastCount = 0;
            this.pending = 0;
            this.hintTimer = null;
            this.build();
            this.unsubscribe = chatApi.subscribe(() => this.render());
            this.render();
        }

        build() {
            this.root.innerHTML = `
                <div class="chat-head">
                    <i class="ti ti-messages" style="font-size:17px; color:var(--red);"></i>
                    Онлайн-чат
                    <div class="online-count" title="Учасників, що писали за останню добу">
                        <div class="online-dot"></div><span class="chat-active-count">0</span> за добу
                    </div>
                    ${this.opts.onExpand ? '<button class="chat-expand-btn" type="button" aria-label="Розгорнути чат" title="Розгорнути"><i class="ti ti-arrows-maximize"></i></button>' : ''}
                    ${this.opts.closable ? '<button class="chat-sheet-close chat-close-btn" type="button" aria-label="Закрити чат"><i class="ti ti-x"></i></button>' : ''}
                </div>
                <div class="chat-msgs chat-list" role="log" aria-live="polite"></div>
                <button class="chat-newbtn" type="button" style="display:none;"></button>
                <div class="chat-hint" role="status"></div>
                <div class="chat-input-area">
                    <input type="text" class="chat-text" maxlength="${MAX_LEN}" placeholder="Написати повідомлення..." autocomplete="off">
                    <button class="chat-send chat-send-btn" type="button" aria-label="Надіслати"><i class="ti ti-send"></i></button>
                </div>
            `;
            this.list = this.root.querySelector('.chat-list');
            this.input = this.root.querySelector('.chat-text');
            this.sendBtn = this.root.querySelector('.chat-send-btn');
            this.hintEl = this.root.querySelector('.chat-hint');
            this.newBtn = this.root.querySelector('.chat-newbtn');
            this.countEl = this.root.querySelector('.chat-active-count');

            this.sendBtn.addEventListener('click', () => this.send());
            this.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.isComposing) {
                    e.preventDefault();
                    this.send();
                }
            });
            this.newBtn.addEventListener('click', () => this.scrollToBottom());
            this.list.addEventListener('scroll', () => {
                if (this.nearBottom()) this.hideNewBtn();
            });
            const closeBtn = this.root.querySelector('.chat-close-btn');
            if (closeBtn && this.opts.onClose) closeBtn.addEventListener('click', this.opts.onClose);
            const expandBtn = this.root.querySelector('.chat-expand-btn');
            if (expandBtn && this.opts.onExpand) expandBtn.addEventListener('click', this.opts.onExpand);
        }

        nearBottom() {
            return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 60;
        }

        scrollToBottom() {
            this.list.scrollTop = this.list.scrollHeight;
            this.hideNewBtn();
        }

        hideNewBtn() {
            this.pending = 0;
            this.newBtn.style.display = 'none';
        }

        setHint(text) {
            const stick = this.nearBottom();
            this.hintEl.textContent = text;
            if (stick) this.list.scrollTop = this.list.scrollHeight;
        }

        hint(text) {
            this.setHint(text);
            clearTimeout(this.hintTimer);
            this.hintTimer = setTimeout(() => this.setHint(''), 3500);
        }

        async send() {
            if (!appState.isLoggedIn) {
                this.hint('Увійдіть, щоб писати в чаті');
                openAuthModal();
                return;
            }
            if (this.sending) return;
            this.sending = true;
            this.sendBtn.disabled = true;
            const res = await chatApi.send(this.input.value);
            this.sending = false;
            this.sendBtn.disabled = false;
            if (!res.ok) {
                this.hint(res.error);
                return;
            }
            this.input.value = '';
            this.setHint('');
            this.forceStick = true;
            this.render();
            this.scrollToBottom();
        }

        render() {
            if (!chatApi.isLoaded()) {
                const err = chatApi.getError();
                this.list.innerHTML = `<div class="chat-empty">${err ? escapeHtml(err) + '<br>Повторюємо спробу...' : 'Завантаження чату...'}</div>`;
                this.countEl.textContent = '0';
                return;
            }
            const msgs = chatApi.getMessages();
            const me = currentUser();
            const wasNearBottom = this.firstRender || this.nearBottom();

            let html = '';
            let prev = null;
            msgs.forEach(m => {
                const sameDay = prev && dayKey(prev.timestamp) === dayKey(m.timestamp);
                if (!sameDay) html += `<div class="chat-day"><span>${escapeHtml(dayLabel(m.timestamp))}</span></div>`;
                const grouped = sameDay && prev.author === m.author && m.timestamp - prev.timestamp < GROUP_GAP_MS;
                const mine = me && m.author === me;
                html += `<div class="msg-wrap${mine ? ' me' : ''}${grouped ? ' grouped' : ''}">` +
                    (grouped ? '' : `<div class="msg-author"${mine ? ' style="text-align:right;"' : ''}>${mine ? 'Ви' : escapeHtml(m.author)} · ${formatTime(m.timestamp)}</div>`) +
                    `<div class="msg-bubble">${escapeHtml(m.text)}</div></div>`;
                prev = m;
            });
            if (!msgs.length) html = '<div class="chat-empty">Повідомлень поки немає. Напишіть першим!</div>';
            this.list.innerHTML = html;

            // Лічильник активних за добу
            const now = Date.now();
            this.countEl.textContent = new Set(msgs.filter(m => now - m.timestamp < DAY_MS).map(m => m.author)).size;

            // Прокрутка: до низу, якщо ми були внизу; інакше показуємо кнопку "нові"
            const added = msgs.length - this.lastCount;
            if (wasNearBottom || this.forceStick) {
                this.scrollToBottom();
            } else if (added > 0) {
                this.pending += added;
                this.newBtn.textContent = `↓ Нові повідомлення (${this.pending})`;
                this.newBtn.style.display = 'block';
            }
            this.forceStick = false;
            this.firstRender = false;
            this.lastCount = msgs.length;
        }

        focusInput() {
            this.input.focus();
        }
    }

    // ====================== МОНТУВАННЯ ======================
    function init() {
        injectStyles();

        const dock = document.getElementById('chatDock');
        let dockView = null;
        if (dock) {
            document.body.classList.add('has-chat-dock');
            dock.classList.add('chat-dock');
            dockView = new ChatView(dock, { closable: false, onExpand: () => openBig() });
        }

        // Плаваюча кнопка + панель (на головній видима лише на телефоні)
        const overlay = document.createElement('div');
        overlay.className = 'chat-sheet-overlay';
        const panel = document.createElement('div');
        panel.className = 'chat-float';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Чат');
        const fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'chat-fab chat-fab-live';
        fab.setAttribute('aria-label', 'Відкрити чат');
        fab.innerHTML = '<i class="ti ti-messages"></i><span class="chat-fab-badge" style="display:none;">0</span>';
        document.body.appendChild(overlay);
        document.body.appendChild(panel);
        document.body.appendChild(fab);

        // Іконка в шапці (якщо шапки немає — лишається плаваюча кнопка)
        const headerActions = document.querySelector('.header-actions');
        const mode = (CHAT_ICON_MODE === 'fab' || !headerActions) ? 'fab' : CHAT_ICON_MODE;
        document.body.classList.add('chat-icon-' + mode);
        let headerBtn = null;
        if (mode !== 'fab') {
            headerBtn = document.createElement('button');
            headerBtn.type = 'button';
            headerBtn.className = 'btn-ghost chat-header-btn';
            headerBtn.setAttribute('aria-label', 'Чат');
            headerBtn.innerHTML = '<i class="ti ti-messages"></i><span class="chat-header-badge" style="display:none;">0</span>';
            headerActions.insertBefore(headerBtn, headerActions.firstChild);
        }

        let isOpen = false;
        const badge = fab.querySelector('.chat-fab-badge');
        const headerBadge = headerBtn ? headerBtn.querySelector('.chat-header-badge') : null;

        function setBadge(text) {
            [badge, headerBadge].forEach(b => {
                if (!b) return;
                b.textContent = text;
                b.style.display = text ? 'flex' : 'none';
            });
        }

        function dockVisible() {
            return !!dockView && window.innerWidth > MOBILE_MAX && !document.hidden;
        }

        function updateBadge() {
            if (isOpen || bigOpen) {
                setBadge('');
                return;
            }
            const seen = chatApi.getSeen();
            const me = currentUser();
            const unread = chatApi.getMessages().filter(m => m.id > seen && m.author !== me).length;
            setBadge(unread > 9 ? '9+' : (unread > 0 ? String(unread) : ''));
        }

        const floatView = new ChatView(panel, {
            closable: true,
            onClose: () => close(),
            onExpand: () => openBig()
        });

        // Розгорнутий чат — окреме вікно по центру (лише ПК), той самий ChatView
        let bigOpen = false;
        const bigBackdrop = document.createElement('div');
        bigBackdrop.className = 'chat-expanded-backdrop';
        const big = document.createElement('div');
        big.className = 'chat-expanded';
        big.setAttribute('role', 'dialog');
        big.setAttribute('aria-label', 'Чат');
        document.body.appendChild(bigBackdrop);
        document.body.appendChild(big);
        const bigView = new ChatView(big, { closable: true, onClose: () => closeBig() });

        function openBig() {
            if (window.innerWidth <= MOBILE_MAX) return;
            if (isOpen) close();
            bigOpen = true;
            big.classList.add('open');
            bigBackdrop.classList.add('show');
            chatApi.markSeen();
            updateBadge();
            bigView.scrollToBottom();
            bigView.focusInput();
        }

        function closeBig() {
            bigOpen = false;
            big.classList.remove('open');
            bigBackdrop.classList.remove('show');
            updateBadge();
        }
        bigBackdrop.addEventListener('click', closeBig);

        function open() {
            isOpen = true;
            panel.classList.add('open');
            overlay.classList.add('show');
            chatApi.markSeen();
            updateBadge();
            floatView.scrollToBottom();
            if (window.innerWidth > MOBILE_MAX) floatView.focusInput();
        }

        function close() {
            isOpen = false;
            panel.classList.remove('open');
            overlay.classList.remove('show');
            updateBadge();
        }

        const toggle = () => (isOpen ? close() : open());
        fab.addEventListener('click', toggle);
        if (headerBtn) headerBtn.addEventListener('click', toggle);
        overlay.addEventListener('click', close);
        // На десктопі клік повз панель закриває її
        document.addEventListener('mousedown', (e) => {
            if (!isOpen || window.innerWidth <= MOBILE_MAX) return;
            if (panel.contains(e.target) || e.target.closest('.chat-fab-live, .chat-header-btn, .modal')) return;
            close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && bigOpen) closeBig();
            else if (e.key === 'Escape' && isOpen) close();
        });

        chatApi.subscribe(() => {
            if (isOpen || bigOpen || dockVisible()) chatApi.markSeen();
            updateBadge();
        });
        document.addEventListener('visibilitychange', () => {
            if (dockVisible()) chatApi.markSeen();
            updateBadge();
        });

        // Запуск опитування сервера
        pollOnce();
        schedulePoll();
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) pollOnce();
            schedulePoll();
        });
        // Після входу чи виходу «свої» повідомлення мають змінити вигляд
        document.addEventListener('autospilnota:auth', () => notify());

        if (dockVisible()) chatApi.markSeen();
        updateBadge();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
