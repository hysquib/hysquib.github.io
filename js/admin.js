/**
 * AdminApp — 博客管理系统
 * -----------------------------------------------------------------------------
 * 负责管理认证、文章 CRUD 操作和站点内容管理。
 *
 * 所有更改通过 GitHub Contents API 直接发布到仓库，GitHub Pages 自动重建后上线。
 *
 * 安全说明：密码是客户端守门人（SHA-256 哈希校验）。
 * 写入操作通过 GitHub Personal Access Token 鉴权。
 */

const AdminApp = {

    // ── 状态 ────────────────────────────────────────────────────────────────
    posts: [],
    editingPostId: null,
    fileSha: null,        // posts.json 的 GitHub SHA
    siteData: null,       // 站点内容数据
    siteFileSha: null,    // site.json 的 GitHub SHA

    // 会话键
    AUTH_KEY:     'blog_admin_auth',
    TOKEN_KEY:    'blog_github_token',

    // 站点内容默认值，当远端空 / 首次使用时作为兜底和用户友好的恢复源
    DEFAULT_SITE_DATA: {
        site: {
            name: 'hysquib',
            tagline: '构建者 · 写作者 · 思考者',
            description: '关于技术、设计与构建有意义之物的个人思考。',
        },
        hero: {
            greeting: '你好，我是',
            name: 'hysquib',
            accent: '用心构建，用爱分享。',
            tagline: '一名热爱开源与写作的开发者，在这里记录我的思考、学习与创造。',
            primary_button_text: '查看我的博客',
            primary_button_link: '/blog.html',
            secondary_button_text: '关于我',
            secondary_button_link: '#about',
        },
        about: {
            label: '关于我',
            paragraphs: [
                '我是 hysquib — 一名工程师、构建者，同时也是一个写作者。',
                '我相信好的作品来自对细节的打磨，对用户的尊重，以及持续不断的学习。',
                '这里是我的个人空间，用来记录技术笔记、项目思考和偶尔的个人随想。',
            ],
        },
        sections: {
            latest_posts_eyebrow: '最新文章',
            latest_posts_title: '近期写作',
            latest_posts_link: '查看全部 →',
            blog_eyebrow: '博客',
            blog_title: '所有文章',
            blog_subtitle: '记录想法、分享经验、留下成长痕迹。',
        },
        nav: {
            home: '首页',
            blog: '博客',
            about: '关于',
            admin: '管理',
        },
        social: {
            github: 'https://github.com/hysquib',
            twitter: '',
            email: 'mailto:hello@hysquib.cn',
            rss: '/data/posts.json',
        },
        footer: {
            copyright_template: '© {year} hysquib. 用心构建。',
        },
    },

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
        this.loadPosts();
    },

    // ── 视图管理 ──────────────────────────────────────────────────────────────

    /**
     * 切换控制台视图。
     */
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

        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'post-editor');
        });

        this.updatePreview();
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
        this.updateTokenField();
        this.loadPosts();
    },

    updateTokenField() {
        const hasToken = !!this.getGitHubToken();
        const input = document.getElementById('github-token');
        const status = document.getElementById('token-status');
        if (input) {
            input.placeholder = hasToken ? '令牌已保存（输入新令牌可替换）' : 'ghp_xxxxxxxxxxxx...';
            input.value = '';
        }
        if (status) {
            status.textContent = hasToken ? '✓ 令牌已设置，可以发布更改' : '⚠ 尚未设置令牌，无法发布';
            status.style.color = hasToken ? 'var(--success, #4ade80)' : 'var(--text-dim)';
        }
    },

    /**
     * 检查是否设置了 GitHub 令牌，否则提示用户。
     */
    requireToken() {
        const token = this.getGitHubToken();
        if (!token) {
            this.showToast('请先在设置中添加 GitHub 令牌', 'error');
            this.showView('settings');
            return false;
        }
        return true;
    },

    // ── 加载文章 ───────────────────────────────────────────────────────────

    async loadPosts() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);"><span class="spinner"></span></div>';

        try {
            await this.loadPostsFromGitHub();
            this.renderPostList();
        } catch (err) {
            // 令牌问题 — 回退到公开文件（只读视图）
            if (!this.getGitHubToken()) {
                await this.loadPostsFromPublic();
                this.renderPostList(true);
            } else {
                container.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: var(--danger);">
                        <p style="margin-bottom: 0.5rem;">加载文章失败</p>
                        <p style="font-size: 0.85rem; color: var(--text-dim);">${this.escapeHtml(err.message)}</p>
                    </div>
                `;
            }
        }
    },

    async loadPostsFromPublic() {
        const res = await fetch(`/data/posts.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.posts = data.posts || [];
        this.fileSha = null;
    },

    async loadPostsFromGitHub() {
        const token = this.getGitHubToken();
        if (!token) {
            throw new Error('未设置 GitHub 令牌');
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${CONFIG.POSTS_FILE_PATH}?ref=${CONFIG.GITHUB_BRANCH}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
            },
        });

        if (res.status === 404) {
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
        await this.savePostsToGitHub();
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
        if (!this.requireToken()) return;

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
        btn.innerHTML = '<span class="spinner"></span> 发布中...';

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
                this.editingPostId ? '文章更新成功！约1分钟内上线。' : '文章发布成功！约1分钟内上线。',
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
        if (!this.requireToken()) return;

        if (!confirm('确定要删除这篇文章吗？此操作不可撤销。')) return;

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
        if (!this.requireToken()) return;

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

    renderPostList(readOnly = false) {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        if (this.posts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-dim);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <h3 style="color: var(--text-muted); margin-bottom: 0.3rem;">暂无文章</h3>
                    <p style="font-size: 0.85rem; margin-bottom: 1rem;">创建你的第一篇博客文章开始吧。</p>
                    ${readOnly
                        ? '<p style="font-size: 0.8rem; color: var(--text-dim);">⚠ 请先在设置中添加 GitHub 令牌以启用编辑</p>'
                        : '<button class="btn btn-primary btn-sm" onclick="AdminApp.showEditor(\'new\')">创建文章</button>'}
                </div>
            `;
            return;
        }

        const readOnlyBanner = readOnly
            ? `<div style="padding: 0.8rem 1rem; background: var(--bg-elevated); border-radius: var(--radius); margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-dim);">
                ⚠ 只读模式 — 请在设置中添加 GitHub 令牌以启用编辑和发布
            </div>`
            : '';

        container.innerHTML = readOnlyBanner + this.posts.map(post => `
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
     * 判断给定的 site 数据是不是全空（所有关键文字字段都是空字符串或无意义）
     */
    isSiteDataEmpty(data) {
        if (!data) return true;
        const emptyStr = (v) => !(typeof v === 'string' && v.trim() !== '');

        const s = data.site || {};
        const h = data.hero || {};
        const a = data.about || {};
        const sec = data.sections || {};
        const nav = data.nav || {};

        // 关键字段全空则认为是"空数据"，需要兜底
        return (
            emptyStr(s.name) && emptyStr(s.tagline) && emptyStr(s.description) &&
            emptyStr(h.greeting) && emptyStr(h.name) && emptyStr(h.accent) && emptyStr(h.tagline) &&
            emptyStr(a.label) && (!Array.isArray(a.paragraphs) || a.paragraphs.every(emptyStr)) &&
            emptyStr(sec.latest_posts_title) && emptyStr(sec.blog_title) &&
            emptyStr(nav.home) && emptyStr(nav.blog)
        );
    },

    /**
     * 从远端加载站点内容到表单。
     * 优先用 GitHub API（有令牌时），否则回退到公开文件。
     * 当远端内容全空或加载失败时，使用 DEFAULT_SITE_DATA 兜底填充表单。
     */
    async loadSiteContentIntoForm() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };

        try {
            let data;

            if (this.getGitHubToken()) {
                try {
                    await this.loadSiteFromGitHub();
                    data = this.siteData;
                } catch {
                    data = await this.fetchPublicSiteData();
                }
            } else {
                data = await this.fetchPublicSiteData();
            }

            // 如果全空 — 使用内置默认值
            if (this.isSiteDataEmpty(data)) {
                data = JSON.parse(JSON.stringify(this.DEFAULT_SITE_DATA));
                if (!this.siteData) this.siteData = data;
                this.showToast('已填充默认站点内容，修改后点击保存即可发布。', 'info');
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
            // 出错兜底：还是用默认值填充，避免表单全空
            const data = JSON.parse(JSON.stringify(this.DEFAULT_SITE_DATA));
            this.siteData = data;
            const s = data.site, h = data.hero, a = data.about, sec = data.sections;
            const nav = data.nav, soc = data.social, foot = data.footer;
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
            setVal('site-name', s.name); setVal('site-tagline', s.tagline); setVal('site-description', s.description);
            setVal('hero-greeting', h.greeting); setVal('hero-name', h.name); setVal('hero-accent', h.accent); setVal('hero-tagline', h.tagline);
            setVal('hero-primary-text', h.primary_button_text); setVal('hero-primary-link', h.primary_button_link);
            setVal('hero-secondary-text', h.secondary_button_text); setVal('hero-secondary-link', h.secondary_button_link);
            setVal('about-label', a.label); setVal('about-paragraphs', Array.isArray(a.paragraphs) ? a.paragraphs.join('\n') : '');
            setVal('sec-latest-eyebrow', sec.latest_posts_eyebrow); setVal('sec-latest-title', sec.latest_posts_title); setVal('sec-latest-link', sec.latest_posts_link);
            setVal('sec-blog-eyebrow', sec.blog_eyebrow); setVal('sec-blog-title', sec.blog_title); setVal('sec-blog-subtitle', sec.blog_subtitle);
            setVal('nav-home', nav.home); setVal('nav-blog', nav.blog); setVal('nav-about', nav.about); setVal('nav-admin', nav.admin);
            setVal('social-github', soc.github); setVal('social-twitter', soc.twitter); setVal('social-email', soc.email); setVal('social-rss', soc.rss);
            setVal('footer-copyright', foot.copyright_template);

            this.showToast(`加载失败，已恢复默认内容：${err.message}`, 'error');
        }
    },

    /**
     * 一键将表单恢复为默认站点内容（不保存，仅填充）。
     */
    resetSiteFormToDefaults() {
        if (!confirm('确定要将所有站点内容恢复为默认值吗？（你还需要手动点击"保存"才会真正发布）')) return;
        this.siteData = JSON.parse(JSON.stringify(this.DEFAULT_SITE_DATA));
        // 直接模拟一次"成功加载"流程
        this.showToast('已恢复默认内容（尚未保存）', 'success');
        this.loadSiteContentIntoForm.__cachedData = this.siteData;
        const data = this.siteData;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        setVal('site-name', data.site.name); setVal('site-tagline', data.site.tagline); setVal('site-description', data.site.description);
        setVal('hero-greeting', data.hero.greeting); setVal('hero-name', data.hero.name); setVal('hero-accent', data.hero.accent); setVal('hero-tagline', data.hero.tagline);
        setVal('hero-primary-text', data.hero.primary_button_text); setVal('hero-primary-link', data.hero.primary_button_link);
        setVal('hero-secondary-text', data.hero.secondary_button_text); setVal('hero-secondary-link', data.hero.secondary_button_link);
        setVal('about-label', data.about.label); setVal('about-paragraphs', data.about.paragraphs.join('\n'));
        setVal('sec-latest-eyebrow', data.sections.latest_posts_eyebrow); setVal('sec-latest-title', data.sections.latest_posts_title); setVal('sec-latest-link', data.sections.latest_posts_link);
        setVal('sec-blog-eyebrow', data.sections.blog_eyebrow); setVal('sec-blog-title', data.sections.blog_title); setVal('sec-blog-subtitle', data.sections.blog_subtitle);
        setVal('nav-home', data.nav.home); setVal('nav-blog', data.nav.blog); setVal('nav-about', data.nav.about); setVal('nav-admin', data.nav.admin);
        setVal('social-github', data.social.github); setVal('social-twitter', data.social.twitter); setVal('social-email', data.social.email); setVal('social-rss', data.social.rss);
        setVal('footer-copyright', data.footer.copyright_template);
    },

    async loadSiteFromGitHub() {
        const token = this.getGitHubToken();
        if (!token) throw new Error('未设置 GitHub 令牌');

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

    collectSiteDataFromForm() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };

        const paragraphs = getVal('about-paragraphs')
            .split('\n')
            .map(s => s.trim())
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
     * 深度合并表单数据与原有 siteData：
     * - 如果表单里的字段不是空字符串，使用表单值；
     * - 如果表单里的字段是空字符串，但原 siteData 中对应字段有值 → 保留原值（避免误清空）；
     * - 如果两者都空，保留空字符串（由前台 render 兜底不覆盖默认 HTML）。
     *
     * 注意：about.paragraphs 用户主动全部清空时（文本框无任何文字），视为真正清空。
     */
    mergeSiteDataWithExisting(formData, existing) {
        if (!existing) return formData;

        const keepExisting = (formVal, existVal) => {
            // 针对字符串：表单为空 且 原有非空 → 保留原有
            if (typeof existVal === 'string' && existVal.trim() !== '') {
                if (typeof formVal === 'string' && formVal.trim() === '') return existVal;
            }
            return formVal;
        };

        return {
            site: {
                name: keepExisting(formData.site.name, existing.site?.name),
                tagline: keepExisting(formData.site.tagline, existing.site?.tagline),
                description: keepExisting(formData.site.description, existing.site?.description),
            },
            hero: {
                greeting: keepExisting(formData.hero.greeting, existing.hero?.greeting),
                name: keepExisting(formData.hero.name, existing.hero?.name),
                accent: keepExisting(formData.hero.accent, existing.hero?.accent),
                tagline: keepExisting(formData.hero.tagline, existing.hero?.tagline),
                primary_button_text: keepExisting(formData.hero.primary_button_text, existing.hero?.primary_button_text),
                primary_button_link: keepExisting(formData.hero.primary_button_link, existing.hero?.primary_button_link),
                secondary_button_text: keepExisting(formData.hero.secondary_button_text, existing.hero?.secondary_button_text),
                secondary_button_link: keepExisting(formData.hero.secondary_button_link, existing.hero?.secondary_button_link),
            },
            about: {
                label: keepExisting(formData.about.label, existing.about?.label),
                // paragraphs：只有表单输入不是空数组（文本框里有任何内容）才用表单值
                paragraphs: Array.isArray(formData.about.paragraphs) && formData.about.paragraphs.filter(p => p.trim() !== '').length > 0
                    ? formData.about.paragraphs
                    : (existing.about?.paragraphs ?? formData.about.paragraphs),
            },
            sections: {
                latest_posts_eyebrow: keepExisting(formData.sections.latest_posts_eyebrow, existing.sections?.latest_posts_eyebrow),
                latest_posts_title: keepExisting(formData.sections.latest_posts_title, existing.sections?.latest_posts_title),
                latest_posts_link: keepExisting(formData.sections.latest_posts_link, existing.sections?.latest_posts_link),
                blog_eyebrow: keepExisting(formData.sections.blog_eyebrow, existing.sections?.blog_eyebrow),
                blog_title: keepExisting(formData.sections.blog_title, existing.sections?.blog_title),
                blog_subtitle: keepExisting(formData.sections.blog_subtitle, existing.sections?.blog_subtitle),
            },
            nav: {
                home: keepExisting(formData.nav.home, existing.nav?.home),
                blog: keepExisting(formData.nav.blog, existing.nav?.blog),
                about: keepExisting(formData.nav.about, existing.nav?.about),
                admin: keepExisting(formData.nav.admin, existing.nav?.admin),
            },
            social: {
                github: keepExisting(formData.social.github, existing.social?.github),
                twitter: keepExisting(formData.social.twitter, existing.social?.twitter),
                email: keepExisting(formData.social.email, existing.social?.email),
                rss: keepExisting(formData.social.rss, existing.social?.rss),
            },
            footer: {
                copyright_template: keepExisting(formData.footer.copyright_template, existing.footer?.copyright_template),
            },
        };
    },

    async saveSiteContent() {
        if (!this.requireToken()) return;

        const btn = document.getElementById('site-save-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 发布中...';
        }

        try {
            const formData = this.collectSiteDataFromForm();

            // 1. 关键校验：至少要有一个最核心的内容，不允许发布一个"彻底空"的站点数据
            const criticalEmpty = [
                formData.site.name, formData.site.tagline,
                formData.hero.name, formData.hero.tagline,
            ].every(v => !(typeof v === 'string' && v.trim() !== ''));
            // 只有当 merge 后依然全空才拦截
            const existing = this.siteData;
            const willPublishEmpty = criticalEmpty && this.isSiteDataEmpty(existing);
            if (willPublishEmpty && !confirm('检测到关键字段（站点名/标语、Hero 名字/标语）都为空。\n继续发布可能导致主页不显示任何文字，确定要继续吗？')) {
                if (btn) { btn.disabled = false; btn.textContent = '保存站点内容'; }
                return;
            }

            // 2. 与原有数据合并，避免误清空
            const mergedData = this.mergeSiteDataWithExisting(formData, existing);
            this.siteData = mergedData;

            await this.saveSiteToGitHub(mergedData);

            this.showToast('站点内容已发布！约1分钟内上线。', 'success');

            if (typeof SiteApp !== 'undefined') {
                SiteApp.data = mergedData;
            }
        } catch (err) {
            this.showToast(`保存失败：${err.message}`, 'error');
        }

        if (btn) {
            btn.disabled = false;
            btn.textContent = '保存站点内容';
        }
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

    // ── 工具函数 ────────────────────────────────────────────────────────────

    slugify(text) {
        const ts = Date.now().toString(36);
        const englishPart = text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return englishPart || `post-${ts}`;
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
