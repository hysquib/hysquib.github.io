/**
 * AdminApp — 博客管理系统
 * -----------------------------------------------------------------------------
 * 负责管理认证、文章 CRUD 操作和存储管理。
 *
 * 存储模式：
 *   1. "local"  — 文章保存到浏览器 localStorage（默认，无需配置）
 *   2. "github" — 文章通过 Contents API 发布到 GitHub 仓库（实时更新）
 *
 * 安全说明：密码是客户端守门人（SHA-256 哈希校验）。
 * 若需真正的写入保护，请使用 GitHub 模式配合 Personal Access Token。
 */

const AdminApp = {

    // ── 状态 ────────────────────────────────────────────────────────────────
    posts: [],
    editingPostId: null,
    fileSha: null,        // GitHub 文件 SHA（API 更新时需要）
    siteData: null,       // 站点内容数据
    siteFileSha: null,    // site.json 的 GitHub SHA

    // 会话键
    AUTH_KEY:     'blog_admin_auth',
    TOKEN_KEY:    'blog_github_token',
    STORAGE_KEY:  'blog_storage_mode',
    LOCAL_POSTS:  'blog_posts_local',
    LOCAL_SITE:   'blog_site_local',

    // ── 初始化 ───────────────────────────────────────────────────────────────
    init() {
        // 检查是否已认证
        if (sessionStorage.getItem(this.AUTH_KEY) === 'true') {
            this.showDashboard();
        }

        // 登录表单处理
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleLogin();
        });

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

        // 填充配置显示
        document.getElementById('config-repo').textContent = CONFIG.GITHUB_REPO;
        document.getElementById('config-branch').textContent = CONFIG.GITHUB_BRANCH;
        document.getElementById('config-file').textContent = CONFIG.POSTS_FILE_PATH;

        // 设置存储模式下拉框
        const mode = this.getStorageMode();
        document.getElementById('storage-mode-select').value = mode;
    },

    // ── 认证 ─────────────────────────────────────────────────────────────────

    /**
     * 使用 SHA-256 哈希密码（Web Crypto API）。
     */
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    /**
     * 处理登录表单提交。
     */
    async handleLogin() {
        const input = document.getElementById('login-password');
        const errorEl = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');
        const password = input.value;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 验证中...';
        errorEl.classList.remove('visible');

        try {
            const hash = await this.hashPassword(password);
            if (hash === CONFIG.PASSWORD_HASH) {
                sessionStorage.setItem(this.AUTH_KEY, 'true');
                input.value = '';
                this.showDashboard();
            } else {
                errorEl.classList.add('visible');
                input.value = '';
                input.focus();
            }
        } catch (err) {
            errorEl.textContent = '发生错误，请重试。';
            errorEl.classList.add('visible');
            console.error(err);
        }

        btn.disabled = false;
        btn.textContent = '解锁控制台';
    },

    /**
     * 退出登录并清除会话。
     */
    logout() {
        sessionStorage.removeItem(this.AUTH_KEY);
        sessionStorage.removeItem(this.TOKEN_KEY);
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
    },

    /**
     * 认证成功后显示控制台。
     */
    showDashboard() {
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'grid';
        this.updateStorageBadges();
        this.loadPosts();
    },

    // ── 视图管理 ──────────────────────────────────────────────────────────────

    /**
     * 切换控制台视图。
     */
    showView(viewName) {
        // 隐藏所有视图
        document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');

        // 显示选定视图
        const view = document.getElementById(`view-${viewName}`);
        if (view) view.style.display = 'block';

        // 更新侧边栏激活状态
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });

        // 为特定视图加载数据
        if (viewName === 'posts-list') {
            this.loadPosts();
        } else if (viewName === 'settings') {
            this.updateTokenField();
        } else if (viewName === 'site') {
            this.loadSiteContentIntoForm();
        }
    },

    /**
     * 显示文章编辑器（新建或编辑）。
     */
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

        // 更新导航激活状态
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'post-editor');
        });

        this.updatePreview();
    },

    // ── 存储模式 ─────────────────────────────────────────────────────────────────

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

    // ── GitHub Token ─────────────────────────────────────────────────────────

    getGitHubToken() {
        return sessionStorage.getItem(this.TOKEN_KEY) || '';
    },

    saveGitHubToken() {
        const input = document.getElementById('github-token');
        const token = input.value.trim();
        if (!token) {
            this.showToast('请输入令牌', 'error');
            return;
        }
        sessionStorage.setItem(this.TOKEN_KEY, token);
        input.value = '';
        this.showToast('令牌已保存至当前会话', 'success');
        // 通过尝试加载来验证令牌
        this.loadPosts();
    },

    updateTokenField() {
        const hasToken = !!this.getGitHubToken();
        const input = document.getElementById('github-token');
        if (input) {
            input.placeholder = hasToken ? '令牌已保存（输入新令牌可替换）' : 'ghp_xxxxxxxxxxxx...';
        }
    },

    // ── 加载文章 ───────────────────────────────────────────────────────────

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
        const token = this.getGitHubToken();
        if (!token) {
            throw new Error('未设置 GitHub 令牌，请在设置中添加。');
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${CONFIG.POSTS_FILE_PATH}?ref=${CONFIG.GITHUB_BRANCH}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
            },
        });

        if (res.status === 404) {
            // 文件不存在 — 从空文章开始
            this.posts = [];
            this.fileSha = null;
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API 错误：${res.status}`);
        }

        const data = await res.json();
        this.fileSha = data.sha;

        // 解码 base64 内容
        const content = atob(data.content.replace(/\n/g, ''));
        try {
            const parsed = JSON.parse(content);
            this.posts = parsed.posts || [];
        } catch {
            this.posts = [];
        }
    },

    // ── 保存文章 ───────────────────────────────────────────────────────────

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
        const token = this.getGitHubToken();
        if (!token) {
            throw new Error('未设置 GitHub 令牌，请在设置中添加。');
        }

        const content = JSON.stringify({ posts: this.posts }, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        const body = {
            message: this.editingPostId
                ? `更新文章：${this.getEditingTitle()}`
                : `新建文章：${this.getEditingTitle()}`,
            content: base64Content,
            branch: CONFIG.GITHUB_BRANCH,
        };

        // 如果文件存在则包含 SHA（更新时必需）
        if (this.fileSha) {
            body.sha = this.fileSha;
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${CONFIG.POSTS_FILE_PATH}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API 错误：${res.status}`);
        }

        const data = await res.json();
        this.fileSha = data.content.sha;
    },

    getEditingTitle() {
        return document.getElementById('post-title').value || '无标题';
    },

    // ── 文章 CRUD ────────────────────────────────────────────────────────────

    async savePost() {
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value.trim();
        const tagsStr = document.getElementById('post-tags').value.trim();
        const excerpt = document.getElementById('post-excerpt').value.trim();
        const date = document.getElementById('post-date').value || new Date().toISOString().split('T')[0];

        // 验证
        if (!title) {
            this.showToast('请输入标题', 'error');
            document.getElementById('post-title').focus();
            return;
        }
        if (!content) {
            this.showToast('请输入正文内容', 'error');
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
                // 更新现有文章
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
                // 新建文章
                const id = this.slugify(title);
                // 确保 ID 唯一
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

            // 按日期倒序排列
            this.posts.sort((a, b) => new Date(b.date) - new Date(a.date));

            await this.savePosts();

            this.showToast(
                this.editingPostId ? '文章更新成功！' : '文章发布成功！',
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

        if (!confirm('确定要删除这篇文章吗？此操作不可撤销。')) {
            return;
        }

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

        if (!confirm(`删除「${post.title}」？此操作不可撤销。`)) return;

        try {
            this.posts = this.posts.filter(p => p.id !== postId);
            await this.savePosts();
            this.showToast('文章已删除', 'success');
            this.renderPostList();
        } catch (err) {
            this.showToast(`删除失败：${err.message}`, 'error');
        }
    },

    // ── 渲染文章列表 ─────────────────────────────────────────────────────────

    renderPostList() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        if (this.posts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-dim);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <h3 style="color: var(--text-muted); margin-bottom: 0.3rem;">暂无文章</h3>
                    <p style="font-size: 0.85rem; margin-bottom: 1rem;">创建你的第一篇博客文章开始吧。</p>
                    <button class="btn btn-primary btn-sm" onclick="AdminApp.showEditor('new')">创建文章</button>
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

    // ── 实时预览 ─────────────────────────────────────────────────────────────────

    updatePreview() {
        const content = document.getElementById('post-content').value;
        const preview = document.getElementById('post-preview');

        if (!content.trim()) {
            preview.innerHTML = '<p style="color: var(--text-dim);">预览将在此处显示...</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            preview.innerHTML = marked.parse(content);
        } else {
            preview.innerHTML = `<p>${this.escapeHtml(content)}</p>`;
        }
    },

    // ── 站点内容管理 ────────────────────────────────────────────────────────────

    /**
     * 加载站点内容数据（本地或 GitHub）。
     */
    async loadSiteData() {
        const mode = this.getStorageMode();

        if (mode === 'github') {
            await this.loadSiteFromGitHub();
        } else {
            this.loadSiteFromLocal();
        }
        return this.siteData;
    },

    loadSiteFromLocal() {
        const data = localStorage.getItem(this.LOCAL_SITE);
        if (data) {
            try {
                this.siteData = JSON.parse(data);
            } catch {
                this.siteData = null;
            }
        } else {
            this.siteData = null;
        }
        this.siteFileSha = null;
    },

    async loadSiteFromGitHub() {
        const token = this.getGitHubToken();
        if (!token) {
            throw new Error('未设置 GitHub 令牌，请在设置中添加。');
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/data/site.json?ref=${CONFIG.GITHUB_BRANCH}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
            },
        });

        if (res.status === 404) {
            this.siteData = null;
            this.siteFileSha = null;
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API 错误：${res.status}`);
        }

        const data = await res.json();
        this.siteFileSha = data.sha;

        const content = atob(data.content.replace(/\n/g, ''));
        try {
            this.siteData = JSON.parse(content);
        } catch {
            this.siteData = null;
        }
    },

    /**
     * 从远端加载最新的站点内容到表单（管理台用）。
     * 如果 GitHub 模式无令牌或加载失败，回退到 fetch 公开文件。
     */
    async loadSiteContentIntoForm() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        try {
            const mode = this.getStorageMode();
            let data;

            if (mode === 'github') {
                try {
                    data = await this.loadSiteFromGitHub();
                } catch (err) {
                    // 令牌问题等 — 回退到公开文件
                    data = await this.fetchPublicSiteData();
                }
            } else {
                this.loadSiteFromLocal();
                data = this.siteData;
                if (!data) {
                    // 本地无数据 — 回退到公开文件
                    data = await this.fetchPublicSiteData();
                }
            }

            if (!data) {
                this.showToast('未能加载站点内容', 'error');
                return;
            }

            const s = data.site || {};
            const h = data.hero || {};
            const a = data.about || {};
            const sec = data.sections || {};
            const nav = data.nav || {};
            const soc = data.social || {};
            const foot = data.footer || {};

            setVal('site-name', s.name);
            setVal('site-tagline', s.tagline);
            setVal('site-description', s.description);

            setVal('hero-greeting', h.greeting);
            setVal('hero-name', h.name);
            setVal('hero-accent', h.accent);
            setVal('hero-tagline', h.tagline);
            setVal('hero-primary-text', h.primary_button_text);
            setVal('hero-primary-link', h.primary_button_link);
            setVal('hero-secondary-text', h.secondary_button_text);
            setVal('hero-secondary-link', h.secondary_button_link);

            setVal('about-label', a.label);
            setVal('about-paragraphs', Array.isArray(a.paragraphs) ? a.paragraphs.join('\n') : '');

            setVal('sec-latest-eyebrow', sec.latest_posts_eyebrow);
            setVal('sec-latest-title', sec.latest_posts_title);
            setVal('sec-latest-link', sec.latest_posts_link);
            setVal('sec-blog-eyebrow', sec.blog_eyebrow);
            setVal('sec-blog-title', sec.blog_title);
            setVal('sec-blog-subtitle', sec.blog_subtitle);

            setVal('nav-home', nav.home);
            setVal('nav-blog', nav.blog);
            setVal('nav-about', nav.about);
            setVal('nav-admin', nav.admin);

            setVal('social-github', soc.github);
            setVal('social-twitter', soc.twitter);
            setVal('social-email', soc.email);
            setVal('social-rss', soc.rss);

            setVal('footer-copyright', foot.copyright_template);
        } catch (err) {
            this.showToast(`加载站点内容失败：${err.message}`, 'error');
        }
    },

    /**
     * 从公开 URL 获取 site.json（用于回退）。
     */
    async fetchPublicSiteData() {
        try {
            const res = await fetch(`/data/site.json?t=${Date.now()}`);
            if (!res.ok) return null;
            const data = await res.json();
            this.siteData = data;
            return data;
        } catch {
            return null;
        }
    },

    /**
     * 从表单收集站点内容数据。
     */
    collectSiteDataFromForm() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };

        const paragraphs = getVal('about-paragraphs')
            .split('\n')
            .map(s => s.trim())
            // 保留空行作为段落（用户可能想要空段），但去除尾部空行
            .filter((line, i, arr) => !(line === '' && i === arr.length - 1));

        return {
            site: {
                name: getVal('site-name'),
                tagline: getVal('site-tagline'),
                description: getVal('site-description'),
            },
            hero: {
                greeting: getVal('hero-greeting'),
                name: getVal('hero-name'),
                accent: getVal('hero-accent'),
                tagline: getVal('hero-tagline'),
                primary_button_text: getVal('hero-primary-text'),
                primary_button_link: getVal('hero-primary-link'),
                secondary_button_text: getVal('hero-secondary-text'),
                secondary_button_link: getVal('hero-secondary-link'),
            },
            about: {
                label: getVal('about-label'),
                paragraphs: paragraphs,
            },
            sections: {
                latest_posts_eyebrow: getVal('sec-latest-eyebrow'),
                latest_posts_title: getVal('sec-latest-title'),
                latest_posts_link: getVal('sec-latest-link'),
                blog_eyebrow: getVal('sec-blog-eyebrow'),
                blog_title: getVal('sec-blog-title'),
                blog_subtitle: getVal('sec-blog-subtitle'),
            },
            nav: {
                home: getVal('nav-home'),
                blog: getVal('nav-blog'),
                about: getVal('nav-about'),
                admin: getVal('nav-admin'),
            },
            social: {
                github: getVal('social-github'),
                twitter: getVal('social-twitter'),
                email: getVal('social-email'),
                rss: getVal('social-rss'),
            },
            footer: {
                copyright_template: getVal('footer-copyright'),
            },
        };
    },

    /**
     * 保存站点内容。
     */
    async saveSiteContent() {
        const btn = document.getElementById('site-save-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 保存中...';
        }

        try {
            const data = this.collectSiteDataFromForm();
            this.siteData = data;

            const mode = this.getStorageMode();
            if (mode === 'github') {
                await this.saveSiteToGitHub(data);
            } else {
                this.saveSiteToLocal(data);
            }

            this.showToast('站点内容已保存！', 'success');

            // 刷新 SiteApp 缓存
            if (typeof SiteApp !== 'undefined') {
                SiteApp.data = data;
            }
        } catch (err) {
            this.showToast(`保存失败：${err.message}`, 'error');
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = '保存站点内容';
        }
    },

    saveSiteToLocal(data) {
        localStorage.setItem(this.LOCAL_SITE, JSON.stringify(data, null, 2));
    },

    async saveSiteToGitHub(data) {
        const token = this.getGitHubToken();
        if (!token) {
            throw new Error('未设置 GitHub 令牌，请在设置中添加。');
        }

        const content = JSON.stringify(data, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        const body = {
            message: '更新站点内容',
            content: base64Content,
            branch: CONFIG.GITHUB_BRANCH,
        };

        if (this.siteFileSha) {
            body.sha = this.siteFileSha;
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/data/site.json`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API 错误：${res.status}`);
        }

        const resData = await res.json();
        this.siteFileSha = resData.content.sha;
    },

    // ── 导出 / 导入 ──────────────────────────────────────────────────────────────

    exportData() {
        const data = JSON.stringify({ posts: this.posts }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `博客文章-${new Date().toISOString().split('T')[0]}.json`;
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

            if (!confirm(`导入 ${data.posts.length} 篇文章？这将替换当前本地文章。`)) {
                return;
            }

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
        // 中文标题使用时间戳生成 ID，避免乱码
        const ts = Date.now().toString(36);
        // 尝试提取英文/数字部分
        const englishPart = text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return englishPart || `post-${ts}`;
    },

    generateExcerpt(content) {
        // 去除 Markdown 语法并取前约 100 字
        const plain = content
            .replace(/^#+\s+/gm, '')       // 标题
            .replace(/\*\*(.+?)\*\*/g, '$1') // 粗体
            .replace(/\*(.+?)\*/g, '$1')     // 斜体
            .replace(/`(.+?)`/g, '$1')       // 行内代码
            .replace(/\[(.+?)\]\(.+?\)/g, '$1') // 链接
            .replace(/!\[.*?\]\(.+?\)/g, '')   // 图片
            .replace(/^\s*[-*]\s+/gm, '')     // 列表项
            .replace(/^\s*\d+\.\s+/gm, '')    // 有序列表
            .replace(/>\s+/gm, '')            // 引用
            .replace(/```[\s\S]*?```/g, '')   // 代码块
            .replace(/\n{2,}/g, '\n')         // 多个换行
            .trim();

        return plain.length > 100
            ? plain.substring(0, 100).trim() + '...'
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

    // ── 提示通知 ──────────────────────────────────────────────────────────

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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => AdminApp.init());
