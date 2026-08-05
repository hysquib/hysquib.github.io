/**
 * AdminApp — 博客管理系统
 * -----------------------------------------------------------------------------
 * 处理管理员 OAuth 认证、文章 CRUD 和存储管理。
 *
 * 存储模式：
 *   1. "local"  — 文章保存到浏览器 localStorage（默认，无需设置）
 *   2. "github" — 通过 Cloudflare Worker 代理发布到 GitHub 仓库
 *
 * 认证：GitHub OAuth（通过 Worker 代理）
 *   前端不存储任何密码或令牌，敏感凭证由 Worker 环境变量管理。
 */

const AdminApp = {

    // ── 状态 ────────────────────────────────────────────────────────────────
    posts: [],
    editingPostId: null,
    fileSha: null,

    // 会话键
    AUTH_KEY:     'blog_admin_session',
    TOKEN_KEY:    'blog_admin_token',
    STORAGE_KEY:  'blog_storage_mode',
    LOCAL_POSTS:  'blog_posts_local',

    // ── 初始化 ───────────────────────────────────────────────────────────────
    init() {
        // 检查 URL hash 中是否有 OAuth 回调的 token
        this.handleOAuthCallback();

        // 检查是否已认证
        const token = this.getSessionToken();
        if (token) {
            this.showDashboard();
        }

        // GitHub 登录按钮
        document.getElementById('login-btn').addEventListener('click', () => {
            window.location.href = `${CONFIG.WORKER_URL}/auth/login`;
        });

        // 通行密钥登录按钮
        const passkeyLoginBtn = document.getElementById('passkey-login-btn');
        if (passkeyLoginBtn) {
            passkeyLoginBtn.addEventListener('click', () => this.loginWithPasskey());
        }

        // 诊断按钮（如果存在）
        const diagnoseBtn = document.getElementById('diagnose-btn');
        if (diagnoseBtn) {
            // 已在 HTML 中绑定 onclick，这里不需要额外处理
        }

        // 侧边栏导航
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                const mode = btn.dataset.mode;
                if (view === 'post-editor' && mode === 'new') {
                    this.showEditor('new');
                } else {
                    this.showView(view);
                }
            });
        });

        // 退出登录
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // 设置存储模式选择器
        const mode = this.getStorageMode();
        const modeSelect = document.getElementById('storage-mode-select');
        if (modeSelect) {
            modeSelect.value = mode;
        }
    },

    // ── 认证 ───────────────────────────────────────────────────────────────

    /**
     * 处理 OAuth 回调（从 URL hash 中提取 token）
     */
    handleOAuthCallback() {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#token=')) {
            const token = decodeURIComponent(hash.substring(7));
            if (token) {
                sessionStorage.setItem(this.TOKEN_KEY, token);
                sessionStorage.setItem(this.AUTH_KEY, 'true');
                // 清除 URL hash
                history.replaceState(null, '', window.location.pathname);
            }
        }

        // 检查 URL 查询参数中的错误
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            history.replaceState(null, '', window.location.pathname);
            const errorEl = document.getElementById('login-error');
            const errorMessages = {
                'worker_config': 'Worker 环境变量未配置，请联系管理员检查 Cloudflare Worker 设置。',
                'state_mismatch': '会话状态校验失败，请重试登录。',
                'token_failed': 'GitHub 授权令牌获取失败，请重试。',
                'forbidden': '抱歉，您没有访问此管理后台的权限。',
            };
            errorEl.textContent = errorMessages[error] || `登录失败：${error}`;
            errorEl.style.display = 'block';
        }
    },

    getSessionToken() {
        return sessionStorage.getItem(this.TOKEN_KEY) || '';
    },

    /**
     * 退出登录
     */
    logout() {
        sessionStorage.removeItem(this.AUTH_KEY);
        sessionStorage.removeItem(this.TOKEN_KEY);
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
        this.showToast('已退出登录', 'info');
    },

    /**
     * 验证 token 并显示仪表板
     */
    async showDashboard() {
        const token = this.getSessionToken();
        if (!token) {
            this.showLoginView('会话已过期，请重新登录。');
            return;
        }

        // 尝试通过 Worker 验证 token
        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/auth/check`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!data.authenticated) {
                const reasons = {
                    'expired': '会话已过期，请重新登录。',
                    'bad_signature': '会话签名无效，请重新登录。',
                    'malformed': '会话格式错误，请重新登录。',
                    'missing_secret': 'Worker 配置错误，请联系管理员。',
                };
                this.showLoginView(reasons[data.reason] || data.message || '认证失败，请重新登录。');
                return;
            }
        } catch (err) {
            // 网络错误时仍然尝试显示仪表板（降级处理）
            console.warn('无法连接 Worker 验证会话，尝试显示仪表板...', err);
        }

        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'grid';
        this.updateStorageBadges();
        this.loadPosts();
    },

    showLoginView(message) {
        sessionStorage.removeItem(this.AUTH_KEY);
        sessionStorage.removeItem(this.TOKEN_KEY);
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
        const errorEl = document.getElementById('login-error');
        if (message && errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    },

    /**
     * 诊断连接问题
     */
    async runDiagnostics() {
        const resultEl = document.getElementById('diagnostic-result');
        const btn = document.getElementById('diagnose-btn');
        if (!resultEl) return;

        resultEl.style.display = 'block';
        resultEl.textContent = '正在诊断...';
        btn.style.display = 'none';

        const results = [];
        const workerUrl = CONFIG.WORKER_URL;

        // 1. 检查 Worker 健康状态
        try {
            const healthRes = await fetch(`${workerUrl}/health`);
            const health = await healthRes.json();
            results.push(`✅ Worker 连接成功 (${workerUrl}/health)`);
            results.push(`   状态: ${health.status}`);
            if (health.missing_env_vars && health.missing_env_vars.length > 0) {
                results.push(`   ⚠️  缺少环境变量: ${health.missing_env_vars.join(', ')}`);
                results.push(`   → 请在 Cloudflare Worker Settings → Variables 中添加`);
            } else {
                results.push(`   ✅ 所有环境变量已配置`);
            }
            if (health.worker_custom_domain) {
                results.push(`   自定义域名: ${health.worker_custom_domain}`);
            }
        } catch (err) {
            results.push(`❌ 无法连接到 Worker: ${err.message}`);
            results.push(`   → 请检查 Worker 是否部署，以及自定义域名 adminblog.hysquib.cn 是否已绑定`);
        }

        resultEl.textContent = results.join('\n');
        btn.style.display = 'inline-flex';
        btn.textContent = '🔍 再次诊断';
    },

    // ── 视图管理 ─────────────────────────────────────────────────────────────

    showView(viewName) {
        document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');
        const view = document.getElementById(`view-${viewName}`);
        if (view) view.style.display = 'block';

        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });

        if (viewName === 'posts-list') {
            this.loadPosts();
        } else if (viewName === 'settings') {
            this.updateStorageBadges();
        } else if (viewName === 'passkey') {
            this.checkPasskeyStatus();
        }
    },

    showEditor(mode, postId = null) {
        this.showView('post-editor');
        const titleEl = document.getElementById('editor-title');
        const deleteBtn = document.getElementById('delete-btn');

        if (mode === 'edit' && postId) {
            const post = this.posts.find(p => p.id === postId);
            if (!post) {
                this.showToast('文章未找到', 'error');
                this.showView('posts-list');
                return;
            }
            this.editingPostId = postId;
            titleEl.textContent = '编辑文章';
            deleteBtn.style.display = 'inline-flex';

            document.getElementById('post-title').value = post.title || '';
            document.getElementById('post-content').value = post.content || '';
            document.getElementById('post-tags').value = (post.tags || []).join(', ');
            document.getElementById('post-excerpt').value = post.excerpt || '';
            document.getElementById('post-date').value = post.date || '';
        } else {
            this.editingPostId = null;
            titleEl.textContent = '新建文章';
            deleteBtn.style.display = 'none';

            document.getElementById('post-title').value = '';
            document.getElementById('post-content').value = '';
            document.getElementById('post-tags').value = '';
            document.getElementById('post-excerpt').value = '';
            document.getElementById('post-date').value = new Date().toISOString().split('T')[0];
        }

        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'post-editor');
        });

        this.updatePreview();
    },

    // ── 存储模式 ─────────────────────────────────────────────────────────────

    getStorageMode() {
        return localStorage.getItem(this.STORAGE_KEY) || 'local';
    },

    changeStorageMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
        this.updateStorageBadges();
        this.showToast(`已切换到${mode === 'github' ? 'GitHub' : '本地'}存储模式`, 'success');
        this.loadPosts();
    },

    updateStorageBadges() {
        const mode = this.getStorageMode();
        const badge1 = document.getElementById('storage-mode-badge');
        const badge2 = document.getElementById('settings-storage-badge');

        [badge1, badge2].forEach(badge => {
            if (!badge) return;
            badge.textContent = mode === 'github' ? 'GitHub' : '本地';
            badge.classList.toggle('local', mode === 'local');
        });
    },

    // ── 加载文章 ─────────────────────────────────────────────────────────────

    async loadPosts() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);"><span class="spinner"></span></div>';

        const mode = this.getStorageMode();

        try {
            if (mode === 'github') {
                await this.loadPostsFromGitHub();
            } else {
                this.loadPostsFromLocal();
            }
            this.renderPostList();
        } catch (err) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--danger);">
                    <p style="margin-bottom: 0.5rem;">加载文章失败</p>
                    <p style="font-size: 0.85rem; color: var(--text-dim);">${this.escapeHtml(err.message)}</p>
                </div>
            `;
        }
    },

    loadPostsFromLocal() {
        const data = localStorage.getItem(this.LOCAL_POSTS);
        if (data) {
            try {
                const parsed = JSON.parse(data);
                this.posts = parsed.posts || [];
            } catch {
                this.posts = [];
            }
        } else {
            this.posts = [];
        }
        this.fileSha = null;
    },

    async loadPostsFromGitHub() {
        const token = this.getSessionToken();
        if (!token) {
            throw new Error('未登录，请先使用 GitHub 登录。');
        }

        const res = await fetch(`${CONFIG.WORKER_URL}/api/posts`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (res.status === 401) {
            const err = await res.json().catch(() => ({}));
            // 区分：会话 token 过期 vs GitHub PAT 无效
            if (err.error === 'Bad credentials') {
                throw new Error('Worker 的 GITHUB_TOKEN 已失效，请在 Cloudflare Worker 设置中更新 GitHub Personal Access Token。');
            }
            throw new Error('会话已过期，请重新登录。');
        }

        if (res.status === 404) {
            throw new Error(`仓库中未找到 data/posts.json 文件，请先在 GitHub 仓库创建该文件。`);
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || err.message || `加载失败：${res.status}`);
        }

        const data = await res.json();
        this.fileSha = null;
        this.posts = data.posts || [];
    },

    // ── 保存文章 ─────────────────────────────────────────────────────────────

    async savePosts() {
        const mode = this.getStorageMode();
        if (mode === 'github') {
            await this.savePostsToGitHub();
        } else {
            this.savePostsToLocal();
        }
    },

    savePostsToLocal() {
        const data = { posts: this.posts };
        localStorage.setItem(this.LOCAL_POSTS, JSON.stringify(data, null, 2));
    },

    async savePostsToGitHub() {
        const token = this.getSessionToken();
        if (!token) {
            throw new Error('未登录，请先使用 GitHub 登录。');
        }

        const body = {
            posts: this.posts,
            message: this.editingPostId
                ? `更新文章：${this.getEditingTitle()}`
                : `创建文章：${this.getEditingTitle()}`,
        };

        const res = await fetch(`${CONFIG.WORKER_URL}/api/posts`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (res.status === 401) {
            const err = await res.json().catch(() => ({}));
            if (err.error === 'Bad credentials') {
                throw new Error('Worker 的 GITHUB_TOKEN 已失效，请在 Cloudflare 更新。');
            }
            throw new Error('会话已过期，请重新登录。');
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || err.message || `保存失败：${res.status}`);
        }

        const data = await res.json();
        this.fileSha = null;
    },

    getEditingTitle() {
        return document.getElementById('post-title').value || '未命名';
    },

    // ── 文章 CRUD ────────────────────────────────────────────────────────────

    async savePost() {
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value.trim();
        const tagsStr = document.getElementById('post-tags').value.trim();
        const excerpt = document.getElementById('post-excerpt').value.trim();
        const date = document.getElementById('post-date').value || new Date().toISOString().split('T')[0];

        if (!title) {
            this.showToast('请输入标题', 'error');
            document.getElementById('post-title').focus();
            return;
        }
        if (!content) {
            this.showToast('请输入文章内容', 'error');
            document.getElementById('post-content').focus();
            return;
        }

        const tags = tagsStr
            ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
            : [];

        const finalExcerpt = excerpt || this.generateExcerpt(content);

        const btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 保存中...';

        try {
            if (this.editingPostId) {
                const index = this.posts.findIndex(p => p.id === this.editingPostId);
                if (index !== -1) {
                    this.posts[index] = {
                        ...this.posts[index],
                        title,
                        content,
                        tags,
                        excerpt: finalExcerpt,
                        date,
                    };
                }
            } else {
                const id = this.slugify(title);
                let uniqueId = id;
                let counter = 1;
                while (this.posts.some(p => p.id === uniqueId)) {
                    uniqueId = `${id}-${counter}`;
                    counter++;
                }

                this.posts.unshift({
                    id: uniqueId,
                    title,
                    content,
                    tags,
                    excerpt: finalExcerpt,
                    date,
                });
            }

            this.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
            await this.savePosts();

            this.showToast(
                this.editingPostId ? '文章已更新！' : '文章已发布！',
                'success'
            );

            this.showView('posts-list');
        } catch (err) {
            this.showToast(`保存失败：${err.message}`, 'error');
        }

        btn.disabled = false;
        btn.textContent = '保存并发布';
    },

    async deleteCurrentPost() {
        if (!this.editingPostId) return;
        if (!confirm('确定要删除这篇文章吗？此操作无法撤销。')) return;

        try {
            this.posts = this.posts.filter(p => p.id !== this.editingPostId);
            await this.savePosts();
            this.showToast('文章已删除', 'success');
            this.showView('posts-list');
        } catch (err) {
            this.showToast(`删除失败：${err.message}`, 'error');
        }
    },

    async deletePost(postId) {
        const post = this.posts.find(p => p.id === postId);
        if (!post) return;
        if (!confirm(`确定要删除"${post.title}"吗？此操作无法撤销。`)) return;

        try {
            this.posts = this.posts.filter(p => p.id !== postId);
            await this.savePosts();
            this.showToast('文章已删除', 'success');
            this.renderPostList();
        } catch (err) {
            this.showToast(`删除失败：${err.message}`, 'error');
        }
    },

    // ── 渲染文章列表 ────────────────────────────────────────────────────────

    renderPostList() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        if (this.posts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-dim);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <h3 style="color: var(--text-muted); margin-bottom: 0.3rem;">暂无文章</h3>
                    <p style="font-size: 0.85rem; margin-bottom: 1rem;">创建你的第一篇博客文章吧。</p>
                    <button class="btn btn-primary btn-sm" onclick="AdminApp.showEditor('new')">新建文章</button>
                </div>
            `;
            return;
        }

        container.innerHTML = this.posts.map(post => `
            <div class="admin-post-row">
                <div class="admin-post-info">
                    <div class="admin-post-title">${this.escapeHtml(post.title)}</div>
                    <div class="admin-post-meta">
                        ${this.formatDate(post.date)}
                        ${post.tags && post.tags.length ? ' · ' + post.tags.map(t => '#' + this.escapeHtml(t)).join(' ') : ''}
                    </div>
                </div>
                <div class="admin-post-actions">
                    <a href="/post.html?id=${encodeURIComponent(post.id)}" target="_blank" class="icon-btn" title="查看文章">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                    <button class="icon-btn" title="编辑" data-action="edit" data-post-id="${this.escapeHtml(post.id)}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="icon-btn danger" title="删除" data-action="delete" data-post-id="${this.escapeHtml(post.id)}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');

        // 事件委托：避免 inline onclick 的 XSS 风险
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const postId = btn.dataset.postId;
                if (action === 'edit') {
                    this.showEditor('edit', postId);
                } else if (action === 'delete') {
                    this.deletePost(postId);
                }
            });
        });
    },

    // ── 实时预览 ─────────────────────────────────────────────────────────────

    updatePreview() {
        const content = document.getElementById('post-content').value;
        const preview = document.getElementById('post-preview');

        if (!content.trim()) {
            preview.innerHTML = '<p style="color: var(--text-dim);">预览将显示在这里...</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            const rawHTML = marked.parse(content);
            preview.innerHTML = typeof DOMPurify !== 'undefined'
                ? DOMPurify.sanitize(rawHTML)
                : rawHTML;
        } else {
            preview.innerHTML = `<p>${this.escapeHtml(content)}</p>`;
        }
    },

    // ── 导出 / 导入 ──────────────────────────────────────────────────────

    exportData() {
        const data = JSON.stringify({ posts: this.posts }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `blog-posts-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('文章已导出', 'success');
    },

    async importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.posts || !Array.isArray(data.posts)) {
                throw new Error('文件格式无效');
            }
            if (!confirm(`导入 ${data.posts.length} 篇文章？这将替换当前本地文章。`)) return;

            this.posts = data.posts;
            this.savePostsToLocal();
            this.renderPostList();
            this.showToast(`已导入 ${data.posts.length} 篇文章`, 'success');
        } catch (err) {
            this.showToast(`导入失败：${err.message}`, 'error');
        }
        event.target.value = '';
    },

    // ── 工具函数 ────────────────────────────────────────────────────────────

    slugify(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    generateExcerpt(content) {
        const plain = content
            .replace(/^#+\s+/gm, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/`(.+?)`/g, '$1')
            .replace(/\[(.+?)\]\(.+?\)/g, '$1')
            .replace(!\[.*?\]\(.+?\)/g, '')
            .replace(/^\s*[-*]\s+/gm, '')
            .replace(/^\s*\d+\.\s+/gm, '')
            .replace(/>\s+/gm, '')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim();

        return plain.length > 150
            ? plain.substring(0, 150).trim() + '...'
            : plain;
    },

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    },

    // ── Toast 通知 ──────────────────────────────────────────────────────────

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    },

    // ── 通行密钥（Passkey） ──────────────────────────────────────────────────

    /**
     * 检查浏览器是否支持 WebAuthn
     */
    isPasskeySupported() {
        return typeof window.PublicKeyCredential !== 'undefined' &&
               typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
    },

    /**
     * 检查通行密钥注册状态
     */
    async checkPasskeyStatus() {
        const statusEl = document.getElementById('passkey-status');
        const registerBtn = document.getElementById('passkey-register-btn');
        const removeBtn = document.getElementById('passkey-remove-btn');
        if (!statusEl) return;

        if (!this.isPasskeySupported()) {
            statusEl.textContent = '当前浏览器不支持通行密钥。请使用最新版 Safari、Chrome 或 Edge。';
            statusEl.style.background = 'rgba(185, 28, 28, 0.1)';
            if (registerBtn) registerBtn.disabled = true;
            return;
        }

        try {
            const token = this.getSessionToken();
            const res = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/status`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();

            if (data.registered) {
                statusEl.innerHTML = '✅ 已注册通行密钥。你可以在登录页面使用 Face ID / Touch ID 快速登录。';
                statusEl.style.background = 'rgba(22, 163, 74, 0.1)';
                if (registerBtn) registerBtn.style.display = 'none';
                if (removeBtn) removeBtn.style.display = 'inline-flex';
            } else {
                statusEl.innerHTML = 'ⓘ 尚未注册通行密钥。点击下方按钮注册，注册后可用设备生物识别快速登录。';
                statusEl.style.background = 'rgba(0,0,0,0.05)';
                if (registerBtn) registerBtn.style.display = 'inline-flex';
                if (removeBtn) removeBtn.style.display = 'none';
            }
        } catch (err) {
            statusEl.textContent = `检查状态失败：${err.message}`;
            statusEl.style.background = 'rgba(185, 28, 28, 0.1)';
        }
    },

    /**
     * 注册通行密钥
     */
    async registerPasskey() {
        if (!this.isPasskeySupported()) {
            this.showToast('当前浏览器不支持通行密钥', 'error');
            return;
        }

        try {
            const token = this.getSessionToken();

            // 1. 从 Worker 获取注册 challenge
            const beginRes = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/register/begin`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            const beginData = await beginRes.json();

            if (beginData.error) {
                this.showToast(beginData.error, 'error');
                return;
            }

            // 2. 调用浏览器 WebAuthn API 创建凭证
            const publicKey = {
                challenge: Uint8Array.from(beginData.challenge, c => c.charCodeAt(0)),
                rp: beginData.rp,
                user: {
                    id: Uint8Array.from(beginData.user.id, c => c.charCodeAt(0)),
                    name: beginData.user.name,
                    displayName: beginData.user.displayName,
                },
                pubKeyCredParams: beginData.pubKeyCredParams,
                timeout: beginData.timeout,
                attestation: beginData.attestation,
                authenticatorSelection: beginData.authenticatorSelection,
            };

            const credential = await navigator.credentials.create({ publicKey });
            if (!credential) {
                this.showToast('注册失败：未创建凭证', 'error');
                return;
            }

            // 3. 提取公钥（使用 WebAuthn 标准 API）
            let publicKeyJwk;
            if (credential.response.getPublicKey) {
                const publicKeyBuffer = credential.response.getPublicKey();
                const cryptoKey = await crypto.subtle.importKey(
                    'spki',
                    publicKeyBuffer,
                    { name: 'ECDSA', namedCurve: 'P-256' },
                    false,
                    ['verify'],
                );
                publicKeyJwk = await crypto.subtle.exportKey('jwk', cryptoKey);
            } else {
                publicKeyJwk = await this.extractPublicKeyFromAttestation(credential.response);
            }

            // 4. 发送给 Worker 完成
            const finishRes = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/register/finish`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    challenge: beginData.challenge,
                    credential: {
                        id: credential.id,
                        publicKey: publicKeyJwk,
                        counter: 0,
                    },
                }),
            });
            const finishData = await finishRes.json();

            if (finishData.success) {
                this.showToast('通行密钥注册成功！', 'success');
                this.checkPasskeyStatus();
            } else {
                this.showToast(finishData.error || '注册失败', 'error');
            }
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                this.showToast('注册已取消', 'info');
            } else {
                this.showToast(`注册失败：${err.message}`, 'error');
            }
        }
    },

    /**
     * 从 attestation 中提取公钥（JWK 格式）
     */
    async extractPublicKeyFromAttestation(response) {
        // 获取 authData
        const attestationObject = new Uint8Array(response.attestationObject);

        // 解析 CBOR attestationObject — 简化版解析
        // attestationObject = { fmt, attStmt, authData }
        // authData 结构：rpIdHash(32) + flags(1) + signCount(4) + [attestedCredentialData]
        // attestedCredentialData = aaguid(16) + credIdLen(2) + credId + credPublicKey(COSE)

        // 使用 CBOR 解码 — 浏览器不内置 CBOR，手动解析
        const decoded = this.decodeCBOR(attestationObject);
        const authData = new Uint8Array(decoded.authData);

        // 跳过 rpIdHash(32) + flags(1) + signCount(4) = 37 bytes
        const hasAttested = (authData[32] & 0x40) !== 0;
        if (!hasAttested) throw new Error('authData 中没有 attestedCredentialData');

        let offset = 37;
        // 跳过 aaguid(16)
        offset += 16;
        // 读取 credId 长度（2 bytes big-endian）
        const credIdLen = (authData[offset] << 8) | authData[offset + 1];
        offset += 2 + credIdLen;

        // 剩余就是 COSE 公钥
        const cosePublicKey = authData.slice(offset);

        // 将 COSE 公钥转换为 JWK
        const coseDecoded = this.decodeCBOR(cosePublicKey);

        // COSE Key 格式 (EC2 P-256):
        // 1: kty (2 = EC2), -1: crv (1 = P-256), -2: x, -3: y
        const x = this.arrayBufferToBase64url(coseDecoded[-2]);
        const y = this.arrayBufferToBase64url(coseDecoded[-3]);

        return {
            kty: 'EC',
            crv: 'P-256',
            x: x,
            y: y,
            ext: true,
        };
    },

    /**
     * 简易 CBOR 解码器（仅支持 Map 和已知类型）
     */
    decodeCBOR(bytes) {
        let offset = 0;

        function readByte() { return bytes[offset++]; }

        function readUint(len) {
            let val = 0;
            for (let i = 0; i < len; i++) val = (val << 8) | bytes[offset++];
            return val;
        }

        function readArg(ai) {
            if (ai < 24) return ai;
            if (ai === 24) return readUint(1);
            if (ai === 25) return readUint(2);
            if (ai === 26) return readUint(4);
            if (ai === 27) return readUint(8);
            throw new Error(`CBOR: 不支持的 ai ${ai}`);
        }

        function readItem() {
            const firstByte = readByte();
            const majorType = firstByte >> 5;
            const ai = firstByte & 0x1f;

            switch (majorType) {
                case 0: // uint
                    return readArg(ai);
                case 1: // negative int
                    return -1 - readArg(ai);
                case 2: { // byte string
                    const len = readArg(ai);
                    const buf = bytes.slice(offset, offset + len);
                    offset += len;
                    return buf;
                }
                case 3: { // text string
                    const len = readArg(ai);
                    const buf = bytes.slice(offset, offset + len);
                    offset += len;
                    return new TextDecoder().decode(buf);
                }
                case 4: { // array
                    const len = readArg(ai);
                    const arr = [];
                    for (let i = 0; i < len; i++) arr.push(readItem());
                    return arr;
                }
                case 5: { // map
                    const len = readArg(ai);
                    const map = {};
                    for (let i = 0; i < len; i++) {
                        const key = readItem();
                        map[key] = readItem();
                    }
                    return map;
                }
                case 7: // simple/float
                    if (ai === 20) return false;
                    if (ai === 21) return true;
                    if (ai === 22) return null;
                    return readArg(ai);
                default:
                    throw new Error(`CBOR: 不支持的 major type ${majorType}`);
            }
        }

        return readItem();
    },

    arrayBufferToBase64url(buf) {
        const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    },

    /**
     * 使用通行密钥登录
     */
    async loginWithPasskey() {
        if (!this.isPasskeySupported()) {
            this.showToast('当前浏览器不支持通行密钥', 'error');
            return;
        }

        try {
            // 1. 从 Worker 获取登录 challenge
            const beginRes = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/login/begin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            const beginData = await beginRes.json();

            if (beginData.error) {
                this.showLoginError(beginData.error);
                return;
            }

            // 2. 调用浏览器 WebAuthn API 验证
            const publicKey = {
                challenge: Uint8Array.from(beginData.challenge, c => c.charCodeAt(0)),
                rpId: beginData.rpId || 'hysquib.cn',
                timeout: beginData.timeout,
                userVerification: beginData.userVerification,
            };

            // 尝试 discoverable credential（无需指定 credentialId）
            const assertion = await navigator.credentials.get({ publicKey });
            if (!assertion) {
                this.showLoginError('登录失败：未获取凭证');
                return;
            }

            // 3. 提取签名数据发给 Worker
            const authenticatorData = this.arrayBufferToBase64url(assertion.response.authenticatorData);
            const clientDataJSON = this.arrayBufferToBase64url(assertion.response.clientDataJSON);
            const signature = this.arrayBufferToBase64url(assertion.response.signature);

            const finishRes = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/login/finish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challenge: beginData.challenge,
                    credential: {
                        id: assertion.id,
                        authenticatorData,
                        clientDataJSON,
                        signature,
                        counter: 0,
                    },
                }),
            });
            const finishData = await finishRes.json();

            if (finishData.token) {
                sessionStorage.setItem(this.TOKEN_KEY, finishData.token);
                sessionStorage.setItem(this.AUTH_KEY, 'true');
                this.showToast('通行密钥登录成功！', 'success');
                this.showDashboard();
            } else {
                this.showLoginError(finishData.error || '通行密钥验证失败');
            }
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                // 用户取消，不显示错误
            } else {
                this.showLoginError(`登录失败：${err.message}`);
            }
        }
    },

    showLoginError(message) {
        const errorEl = document.getElementById('login-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    },

    /**
     * 删除通行密钥
     */
    async removePasskey() {
        if (!confirm('确定要删除已注册的通行密钥吗？删除后需要重新注册才能使用。')) return;

        try {
            const token = this.getSessionToken();
            const res = await fetch(`${CONFIG.WORKER_URL}/auth/passkey/unregister`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();

            if (data.success) {
                this.showToast('通行密钥已删除', 'success');
                this.checkPasskeyStatus();
            } else {
                this.showToast(data.error || '删除失败', 'error');
            }
        } catch (err) {
            this.showToast(`删除失败：${err.message}`, 'error');
        }
    },
};

// 初始化
document.addEventListener('DOMContentLoaded', () => AdminApp.init());
