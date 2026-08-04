// AdminApp — Blog management system
const AdminApp = {
    posts: [], editingPostId: null, fileSha: null,
    _authenticated: false, _authToken: null, _oauthError: null,
    TOKEN_KEY: '_s_a_t', STORAGE_KEY: '_s_s_m', LOCAL_POSTS: '_s_p_l',

    init() {
        try { this._initInternal(); }
        catch (err) {
            console.error('Admin init error:', err);
            const loginEl = document.getElementById('login-view');
            if (loginEl) {
                loginEl.innerHTML = `<div class="login-card" style="color: var(--danger); text-align: center;"><h2 style="margin-bottom: 1rem;">⚠️ 页面初始化失败</h2><p style="font-size: 0.9rem; margin-bottom: 1rem;">错误：${this.escapeHtml(err.message)}</p><p style="font-size: 0.8rem; color: var(--text-dim);">请尝试强制刷新（Ctrl+Shift+R）或使用无痕模式打开。</p><button class="btn btn-primary" style="margin-top: 1rem;" onclick="location.reload(true)">重新加载</button></div>`;
            }
        }
    },

    _initInternal() {
        document.getElementById('login-btn').addEventListener('click', () => this.loginWithGitHub());
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this._authenticated) return;
                const view = btn.dataset.view;
                if (view === 'post-editor' && btn.dataset.mode === 'new') this.showEditor('new');
                else this.showView(view);
            });
        });
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('storage-mode-select').value = this.getStorageMode();
        this._handleAuthRedirect();
        this._checkAuthAndRender();
    },

    _handleAuthRedirect() {
        const hash = window.location.hash;
        if (hash.startsWith('#token=')) {
            const token = hash.substring(7);
            sessionStorage.setItem(this.TOKEN_KEY, token);
            this._authToken = token;
            window.history.replaceState({}, '', '/admin.html');
        }
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            const messages = {
                'state_mismatch':  '安全验证失败，请重试。',
                'token_failed':    'GitHub 认证失败，请重试。',
                'forbidden':       '你没有权限访问此管理面板。',
                'worker_config':   '❌ Worker 环境变量未配置完成。请在 Cloudflare Worker 面板检查所有必填变量。',
            };
            this._oauthError = messages[error] || '认证错误，请重试。';
            window.history.replaceState({}, '', '/admin.html');
        }
    },

    async _checkAuthAndRender() {
        this._authToken = sessionStorage.getItem(this.TOKEN_KEY);
        if (!this._authToken) { this._showLoginView(); return; }
        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/auth/check`, {
                headers: { 'Authorization': `Bearer ${this._authToken}` },
            });
            const data = await res.json();
            if (data.authenticated) {
                this._authenticated = true;
                this.showDashboard();
            } else {
                sessionStorage.removeItem(this.TOKEN_KEY);
                this._authToken = null;
                const reasonMap = {
                    'missing_secret': '❌ Worker 未配置 SESSION_SECRET 环境变量。请在 Cloudflare Worker 面板添加此变量。',
                    'expired':       '会话已过期，请重新登录。',
                    'bad_signature': '登录签名验证失败 — Worker 的 SESSION_SECRET 可能已更改，请重新登录。',
                    'malformed':     'Token 格式错误，请重新登录。',
                };
                this._showLoginView(reasonMap[data.reason] || data.message || '认证失败，请重新登录。');
            }
        } catch {
            this._showLoginView('无法连接到认证服务器。请检查网络或稍后重试。');
        }
    },

    _showLoginView(errorMessage = null) {
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
        const errorEl = document.getElementById('login-error');
        const msg = errorMessage || this._oauthError;
        if (msg) { errorEl.textContent = msg; errorEl.classList.add('visible'); }
        else { errorEl.classList.remove('visible'); }
    },

    loginWithGitHub() { window.location.href = `${CONFIG.WORKER_URL}/auth/login`; },

    async logout() {
        if (this._authToken) {
            try {
                await fetch(`${CONFIG.WORKER_URL}/auth/logout`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${this._authToken}` },
                });
            } catch {}
        }
        sessionStorage.removeItem(this.TOKEN_KEY);
        this._authToken = null;
        this._authenticated = false;
        this._showLoginView();
    },

    showDashboard() {
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'grid';
        this.updateStorageBadges();
        this.loadPosts();
    },

    showView(viewName) {
        document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');
        const view = document.getElementById(`view-${viewName}`);
        if (view) view.style.display = 'block';
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });
        if (viewName === 'posts-list') this.loadPosts();
    },

    showEditor(mode, postId = null) {
        this.showView('post-editor');
        const titleEl = document.getElementById('editor-title');
        const deleteBtn = document.getElementById('delete-btn');
        if (mode === 'edit' && postId) {
            const post = this.posts.find(p => p.id === postId);
            if (!post) { this.showToast('文章未找到', 'error'); this.showView('posts-list'); return; }
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

    getStorageMode() { return localStorage.getItem(this.STORAGE_KEY) || 'github'; },
    changeStorageMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
        this.updateStorageBadges();
        this.showToast(`已切换到${mode === 'github' ? 'GitHub' : '本地'}存储模式`, 'success');
        this.loadPosts();
    },
    updateStorageBadges() {
        const mode = this.getStorageMode();
        [document.getElementById('storage-mode-badge'), document.getElementById('settings-storage-badge')].forEach(badge => {
            if (!badge) return;
            badge.textContent = mode === 'github' ? 'GitHub' : '本地';
            badge.classList.toggle('local', mode === 'local');
        });
    },

    async loadPosts() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);"><span class="spinner"></span></div>';
        const mode = this.getStorageMode();
        try {
            if (mode === 'github') await this.loadPostsFromGitHub();
            else this.loadPostsFromLocal();
            this.renderPostList();
        } catch (err) {
            container.innerHTML = `<div style="text-align: center; padding: 3rem; color: var(--danger);"><p style="margin-bottom: 0.5rem;">加载文章失败</p><p style="font-size: 0.85rem; color: var(--text-dim); white-space: pre-line; line-height: 1.6;">${this.escapeHtml(err.message)}</p></div>`;
        }
    },

    loadPostsFromLocal() {
        const data = localStorage.getItem(this.LOCAL_POSTS);
        if (data) {
            try { const parsed = JSON.parse(data); this.posts = parsed.posts || []; }
            catch { this.posts = []; }
        } else { this.posts = []; }
        this.fileSha = null;
    },

    async loadPostsFromGitHub() {
        if (!this._authToken) throw new Error('未认证，请登录。');
        const res = await fetch(`${CONFIG.WORKER_URL}/api/posts`, {
            headers: { 'Authorization': `Bearer ${this._authToken}` },
        });
        if (res.status === 401) {
            sessionStorage.removeItem(this.TOKEN_KEY);
            this._authToken = null;
            this._authenticated = false;
            this._showLoginView('会话已过期，请重新登录。');
            throw new Error('Session expired');
        }
        if (res.status === 404) {
            throw new Error('Worker 返回 404：找不到文章文件。请检查 Cloudflare Worker 环境变量是否正确。');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        this.posts = data.posts || [];
        this.fileSha = data.sha || null;
    },

    async savePosts() {
        const mode = this.getStorageMode();
        if (mode === 'github') await this.savePostsToGitHub();
        else this.savePostsToLocal();
    },

    savePostsToLocal() {
        localStorage.setItem(this.LOCAL_POSTS, JSON.stringify({ posts: this.posts }, null, 2));
    },

    async savePostsToGitHub() {
        if (!this._authToken) throw new Error('未认证，请登录。');
        const body = {
            posts: this.posts,
            sha: this.fileSha,
            message: this.editingPostId
                ? `Update post: ${this.getEditingTitle()}`
                : `Create new post: ${this.getEditingTitle()}`,
        };
        const res = await fetch(`${CONFIG.WORKER_URL}/api/posts`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${this._authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 401) {
            sessionStorage.removeItem(this.TOKEN_KEY);
            this._authToken = null;
            this._authenticated = false;
            this._showLoginView('会话已过期，请重新登录。');
            throw new Error('Session expired');
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `API error: ${res.status}`);
        }
        const data = await res.json();
        this.fileSha = data.sha;
    },

    getEditingTitle() { return document.getElementById('post-title').value || '无标题'; },

    async savePost() {
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value.trim();
        const tagsStr = document.getElementById('post-tags').value.trim();
        const excerpt = document.getElementById('post-excerpt').value.trim();
        const date = document.getElementById('post-date').value || new Date().toISOString().split('T')[0];
        if (!title) { this.showToast('请输入标题', 'error'); document.getElementById('post-title').focus(); return; }
        if (!content) { this.showToast('请输入正文内容', 'error'); document.getElementById('post-content').focus(); return; }
        const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
        const finalExcerpt = excerpt || this.generateExcerpt(content);
        const btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 保存中...';
        try {
            if (this.editingPostId) {
                const index = this.posts.findIndex(p => p.id === this.editingPostId);
                if (index !== -1) {
                    this.posts[index] = { ...this.posts[index], title, content, tags, excerpt: finalExcerpt, date };
                }
            } else {
                let id = this.slugify(title), uniqueId = id, counter = 1;
                while (this.posts.some(p => p.id === uniqueId)) { uniqueId = `${id}-${counter}`; counter++; }
                this.posts.unshift({ id: uniqueId, title, content, tags, excerpt: finalExcerpt, date });
            }
            this.posts.sort((a, b) => new Date(b.date) - new Date(a.date));
            await this.savePosts();
            this.showToast(this.editingPostId ? '文章更新成功！' : '文章发布成功！', 'success');
            this.showView('posts-list');
        } catch (err) { this.showToast(`保存失败：${err.message}`, 'error'); }
        btn.disabled = false; btn.textContent = '保存并发布';
    },

    async deleteCurrentPost() {
        if (!this.editingPostId) return;
        if (!confirm('确定要删除这篇文章吗？此操作不可撤销。')) return;
        try { this.posts = this.posts.filter(p => p.id !== this.editingPostId); await this.savePosts(); this.showToast('文章已删除', 'success'); this.showView('posts-list'); }
        catch (err) { this.showToast(`删除失败：${err.message}`, 'error'); }
    },

    async deletePost(postId) {
        const post = this.posts.find(p => p.id === postId);
        if (!post) return;
        if (!confirm(`删除「${post.title}」？此操作不可撤销。`)) return;
        try { this.posts = this.posts.filter(p => p.id !== postId); await this.savePosts(); this.showToast('文章已删除', 'success'); this.renderPostList(); }
        catch (err) { this.showToast(`删除失败：${err.message}`, 'error'); }
    },

    renderPostList() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;
        if (this.posts.length === 0) {
            const storageMode = this.getStorageMode();
            const fileNotFound = storageMode === 'github' && !this.fileSha;
            container.innerHTML = `<div style="text-align: center; padding: 3rem; color: var(--text-dim);"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><h3 style="color: var(--text-muted); margin-bottom: 0.3rem;">暂无文章</h3><p style="font-size: 0.85rem; margin-bottom: 1rem;">创建你的第一篇博客文章吧。</p><button class="btn btn-primary btn-sm" onclick="AdminApp.showEditor('new')">创建文章</button>${fileNotFound ? `<div style="max-width: 560px; margin: 2rem auto 0; text-align: left; padding: 1rem; border: 1px solid #fbbf24; background: rgba(251, 191, 36, 0.08); border-radius: 8px; color: #92400e; font-size: 0.85rem; line-height: 1.6;"><div style="font-weight: 600; margin-bottom: 0.3rem;">⚠️ Worker 未读取到 posts.json 文件</div>如果公网首页已经能显示文章，但管理后台这里为空，说明 Cloudflare Worker 的环境变量配置有误。<br>请去 Cloudflare Worker 面板检查 <b>Settings → Variables</b>，确保这三项的值正确：<ul style="margin: 0.5rem 0 0 1.2rem; padding: 0; list-style: disc;"><li><b>POSTS_FILE_PATH</b> → <code>data/posts.json</code></li><li><b>GITHUB_REPO</b> → <code>hysquib/hysquib.github.io</code></li><li><b>GITHUB_BRANCH</b> → <code>main</code></li></ul>改完后一定要点击 <b>Save and Deploy</b> 重新部署 Worker，然后刷新本页。</div>` : ''}</div>`;
            return;
        }
        container.innerHTML = this.posts.map(post => `
            <div class="admin-post-row">
                <div class="admin-post-info">
                    <div class="admin-post-title">${this.escapeHtml(post.title)}</div>
                    <div class="admin-post-meta">${this.formatDate(post.date)}${post.tags && post.tags.length ? ' · ' + post.tags.map(t => '#' + this.escapeHtml(t)).join(' ') : ''}</div>
                </div>
                <div class="admin-post-actions">
                    <a href="/post.html?id=${encodeURIComponent(post.id)}" target="_blank" class="icon-btn" title="查看"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
                    <button class="icon-btn" title="编辑" onclick="AdminApp.showEditor('edit', '${this.escapeHtml(post.id)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button class="icon-btn danger" title="删除" onclick="AdminApp.deletePost('${this.escapeHtml(post.id)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            </div>
        `).join('');
    },

    updatePreview() {
        const content = document.getElementById('post-content').value;
        const preview = document.getElementById('post-preview');
        if (!content.trim()) { preview.innerHTML = '<p style="color: var(--text-dim);">预览将显示在这里...</p>'; return; }
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            let html = marked.parse(content);
            if (typeof DOMPurify !== 'undefined') html = DOMPurify.sanitize(html);
            preview.innerHTML = html;
        } else { preview.innerHTML = `<p>${this.escapeHtml(content)}</p>`; }
    },

    exportData() {
        const data = JSON.stringify({ posts: this.posts }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `blog-posts-${new Date().toISOString().split('T')[0]}.json`; a.click();
        URL.revokeObjectURL(url); this.showToast('文章已导出', 'success');
    },

    async importData(event) {
        const file = event.target.files[0]; if (!file) return;
        try {
            const text = await file.text(); const data = JSON.parse(text);
            if (!data.posts || !Array.isArray(data.posts)) throw new Error('文件格式无效');
            if (!confirm(`导入 ${data.posts.length} 篇文章？这将替换当前的本地文章。`)) return;
            this.posts = data.posts; this.savePostsToLocal(); this.renderPostList();
            this.showToast(`已导入 ${data.posts.length} 篇文章`, 'success');
        } catch (err) { this.showToast(`导入失败：${err.message}`, 'error'); }
        event.target.value = '';
    },

    async runDiagnostics() {
        const resultEl = document.getElementById('diagnostic-result');
        const btn = document.getElementById('diagnose-btn');
        btn.disabled = true; btn.textContent = '检查中...';
        resultEl.style.display = 'block';
        resultEl.textContent = '正在连接 Worker 健康检查接口...';
        try {
            const res = await fetch(`${CONFIG.WORKER_URL}/health`);
            const data = await res.json();
            let output = '';
            if (data.env_configured) {
                output += '✅ Worker 环境变量已全部配置\n';
                output += `  • SESSION_SECRET: 已设置 (${data.session_secret_len} 位)\n`;
            } else {
                output += '❌ Worker 环境变量缺失：\n';
                output += '  缺少: ' + (data.missing_env_vars || []).join(', ') + '\n\n';
                output += '请前往 Cloudflare Worker → Settings → Variables 添加以上变量。\n';
                output += 'Worker 地址：' + CONFIG.WORKER_URL + '\n';
                output += '健康检查接口：' + CONFIG.WORKER_URL + '/health';
            }
            if (data.blog_url) output += `\n✅ BLOG_URL: ${data.blog_url}\n`;
            if (data.github_repo) output += `✅ GITHUB_REPO: ${data.github_repo}\n`;
            if (data.github_branch) output += `✅ GITHUB_BRANCH: ${data.github_branch}\n`;
            if (data.posts_file_path) output += `✅ POSTS_FILE_PATH: ${data.posts_file_path}\n`;
            resultEl.textContent = output;
            resultEl.style.background = data.env_configured ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
            resultEl.style.color = data.env_configured ? '#065f46' : '#991b1b';
        } catch (err) {
            resultEl.textContent = `❌ 无法连接到 Worker：${err.message}\n\n请检查 Worker URL 是否正确：\n${CONFIG.WORKER_URL}`;
            resultEl.style.background = 'rgba(239, 68, 68, 0.1)'; resultEl.style.color = '#991b1b';
        }
        btn.disabled = false; btn.textContent = '🔍 重新诊断';
    },

    slugify(text) { return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, ''); },
    generateExcerpt(content) { const plain = content.replace(/^#+\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1').replace(/!\[.*?\]\(.+?\)/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '').replace(/>\s+/gm, '').replace(/```[\s\S]*?```/g, '').replace(/\n{2,}/g, '\n').trim(); return plain.length > 150 ? plain.substring(0, 150).trim() + '...' : plain; },
    formatDate(dateStr) { const d = new Date(dateStr); return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }); },
    escapeHtml(str) { const div = document.createElement('div'); div.textContent = String(str); return div.innerHTML; },
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container'); const toast = document.createElement('div');
        toast.className = `toast ${type}`; toast.textContent = message; container.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; toast.style.transition = 'all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3500);
    },
};
(function bootstrap() { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AdminApp.init()); else AdminApp.init(); })();
