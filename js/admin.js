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
        this.fileSha = data.sha || null;
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
        if (this.fileSha) {
            body.sha = this.fileSha;
        }

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
        this.fileSha = data.sha || null;
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
                    <button class="icon-btn" title="编辑" onclick="AdminApp.showEditor('edit', '${this.escapeHtml(post.id)}')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="icon-btn danger" title="删除" onclick="AdminApp.deletePost('${this.escapeHtml(post.id)}')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');
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
            preview.innerHTML = marked.parse(content);
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
            .replace(/!\[.*?\]\(.+?\)/g, '')
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
};

// 初始化
document.addEventListener('DOMContentLoaded', () => AdminApp.init());