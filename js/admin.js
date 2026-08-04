/**
 * AdminApp — Blog management system
 * -----------------------------------------------------------------------------
 * Handles admin authentication, post CRUD operations, and storage management.
 *
 * Storage modes:
 *   1. "local"  — Posts saved to browser localStorage (default, no setup needed)
 *   2. "github" — Posts published to GitHub repo via Contents API (live updates)
 *
 * SECURITY: Client-side password is a UI gatekeeper. Actual writes require
 *           a valid GitHub Personal Access Token stored only in sessionStorage.
 */

const AdminApp = {

    // ── State ────────────────────────────────────────────────────────────────
    posts: [],
    editingPostId: null,
    fileSha: null,        // GitHub file SHA (needed for API updates)
    _authenticated: false,

    // Session keys — deliberately cryptic to reduce risk of trivial bypass
    AUTH_KEY:     '_s_a_k',
    AUTH_TS:      '_s_a_t',
    TOKEN_KEY:    '_s_g_t',
    STORAGE_KEY:  '_s_s_m',
    LOCAL_POSTS:  '_s_p_l',

    // ── Initialization ───────────────────────────────────────────────────────
    init() {
        // Enforce auth check on every view switch
        this._enforceAuthGuard();

        // Check if already authenticated
        if (this._checkAuth()) {
            this._authenticated = true;
            this.showDashboard();
        }

        // Login form handler
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleLogin();
        });

        // Sidebar navigation — wrapped with auth guard
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!this._checkAuth()) return;
                const view = btn.dataset.view;
                const mode = btn.dataset.mode;
                if (view === 'post-editor' && mode === 'new') {
                    this.showEditor('new');
                } else {
                    this.showView(view);
                }
            });
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        // Set storage mode select
        const mode = this.getStorageMode();
        document.getElementById('storage-mode-select').value = mode;
    },

    // ── Authentication (hardened) ────────────────────────────────────────────

    /**
     * Performs a robust auth check: verifies the session key AND its timestamp
     * AND derives a fingerprint from the PASSWORD_HASH. Without access to the
     * config's PASSWORD_HASH value, a simple `setItem('...', true)` won't pass.
     */
    _checkAuth() {
        const key = sessionStorage.getItem(this.AUTH_KEY);
        const ts  = sessionStorage.getItem(this.AUTH_TS);
        if (!key || !ts) return false;

        // Time bound: session expires after 8h
        const ageMs = Date.now() - parseInt(ts, 10);
        if (ageMs < 0 || ageMs > 1000 * 60 * 60 * 8) return false;

        // Fingerprint check — must match the derived value
        try {
            const expected = this._deriveFingerprint();
            return key === expected;
        } catch {
            return false;
        }
    },

    /**
     * Derive a stored "fingerprint" from the config hash so that simply writing
     * `sessionStorage.setItem('...', 'true')` is insufficient to bypass.
     */
    _deriveFingerprint() {
        const h = CONFIG.PASSWORD_HASH || '';
        const src = 'site_admin_' + h.substring(0, 16) + '_ok';
        let hash = 0;
        for (let i = 0; i < src.length; i++) {
            hash = ((hash << 5) - hash) + src.charCodeAt(i);
            hash |= 0;
        }
        return 'v2_' + Math.abs(hash).toString(36);
    },

    _enforceAuthGuard() {
        const originalShowView = this._showView.bind(this);
        this.showView = (name) => {
            if (!this._checkAuth()) {
                this.logout();
                return;
            }
            originalShowView(name);
        };

        const originalShowEditor = this._showEditor.bind(this);
        this.showEditor = (mode, id) => {
            if (!this._checkAuth()) {
                this.logout();
                return;
            }
            originalShowEditor(mode, id);
        };
    },

    /**
     * Hash a password using SHA-256 (Web Crypto API).
     */
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    /**
     * Handle login form submission.
     */
    async handleLogin() {
        const input = document.getElementById('login-password');
        const errorEl = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');
        const password = input.value;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Verifying...';
        errorEl.classList.remove('visible');

        // Simple throttling: delay response slightly to slow down brute force
        await new Promise(r => setTimeout(r, 400));

        try {
            const hash = await this.hashPassword(password);
            if (hash === CONFIG.PASSWORD_HASH) {
                // Auth success — write fingerprint + timestamp
                sessionStorage.setItem(this.AUTH_KEY, this._deriveFingerprint());
                sessionStorage.setItem(this.AUTH_TS, String(Date.now()));
                this._authenticated = true;
                input.value = '';
                this.showDashboard();
            } else {
                errorEl.classList.add('visible');
                input.value = '';
                input.focus();
            }
        } catch (err) {
            errorEl.textContent = 'An error occurred. Please try again.';
            errorEl.classList.add('visible');
            console.error(err);
        }

        btn.disabled = false;
        btn.textContent = 'Unlock Dashboard';
    },

    /**
     * Log out and clear session.
     */
    logout() {
        sessionStorage.removeItem(this.AUTH_KEY);
        sessionStorage.removeItem(this.AUTH_TS);
        sessionStorage.removeItem(this.TOKEN_KEY);
        this._authenticated = false;
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'flex';
    },

    /**
     * Show the dashboard after successful authentication.
     */
    showDashboard() {
        if (!this._checkAuth()) {
            this.logout();
            return;
        }
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'grid';
        this.updateStorageBadges();
        this.loadPosts();
    },

    // ── View Management ──────────────────────────────────────────────────────

    /**
     * Switch between dashboard views.
     */
    _showView(viewName) {
        // Hide all views
        document.querySelectorAll('.admin-view').forEach(v => v.style.display = 'none');

        // Show selected view
        const view = document.getElementById(`view-${viewName}`);
        if (view) view.style.display = 'block';

        // Update sidebar active state
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });

        // Load data for specific views
        if (viewName === 'posts-list') {
            this.loadPosts();
        } else if (viewName === 'settings') {
            this.updateTokenField();
        }
    },

    /**
     * Show the post editor for creating or editing.
     */
    _showEditor(mode, postId = null) {
        this._showView('post-editor');

        const titleEl = document.getElementById('editor-title');
        const deleteBtn = document.getElementById('delete-btn');

        if (mode === 'edit' && postId) {
            const post = this.posts.find(p => p.id === postId);
            if (!post) {
                this.showToast('Post not found', 'error');
                this._showView('posts-list');
                return;
            }
            this.editingPostId = postId;
            titleEl.textContent = 'Edit Post';
            deleteBtn.style.display = 'inline-flex';

            document.getElementById('post-title').value = post.title || '';
            document.getElementById('post-content').value = post.content || '';
            document.getElementById('post-tags').value = (post.tags || []).join(', ');
            document.getElementById('post-excerpt').value = post.excerpt || '';
            document.getElementById('post-date').value = post.date || '';
        } else {
            this.editingPostId = null;
            titleEl.textContent = 'New Post';
            deleteBtn.style.display = 'none';

            document.getElementById('post-title').value = '';
            document.getElementById('post-content').value = '';
            document.getElementById('post-tags').value = '';
            document.getElementById('post-excerpt').value = '';
            document.getElementById('post-date').value = new Date().toISOString().split('T')[0];
        }

        // Update active nav state
        document.querySelectorAll('.admin-nav-item[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'post-editor');
        });

        this.updatePreview();
    },

    // ── Storage Mode ─────────────────────────────────────────────────────────

    getStorageMode() {
        return localStorage.getItem(this.STORAGE_KEY) || 'local';
    },

    changeStorageMode(mode) {
        localStorage.setItem(this.STORAGE_KEY, mode);
        this.updateStorageBadges();
        this.showToast(`Switched to ${mode === 'github' ? 'GitHub' : 'Local'} storage mode`, 'success');
        this.loadPosts();
    },

    updateStorageBadges() {
        const mode = this.getStorageMode();
        const badge1 = document.getElementById('storage-mode-badge');
        const badge2 = document.getElementById('settings-storage-badge');

        [badge1, badge2].forEach(badge => {
            if (!badge) return;
            badge.textContent = mode === 'github' ? 'GitHub' : 'Local';
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
            this.showToast('Please enter a token', 'error');
            return;
        }
        sessionStorage.setItem(this.TOKEN_KEY, token);
        input.value = '';
        this.showToast('Token saved for this session', 'success');
        // Verify token by attempting to load
        this.loadPosts();
    },

    updateTokenField() {
        const hasToken = !!this.getGitHubToken();
        const input = document.getElementById('github-token');
        if (input) {
            input.placeholder = hasToken ? 'Token saved (enter new to replace)' : 'ghp_xxxxxxxxxxxx...';
        }
    },

    // ── Load Posts ───────────────────────────────────────────────────────────

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
                    <p style="margin-bottom: 0.5rem;">Failed to load posts</p>
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
            throw new Error('No GitHub token. Add one in Settings.');
        }

        const url = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}/contents/${CONFIG.POSTS_FILE_PATH}?ref=${CONFIG.GITHUB_BRANCH}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
            },
        });

        if (res.status === 404) {
            // File doesn't exist yet — start with empty posts
            this.posts = [];
            this.fileSha = null;
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `GitHub API error: ${res.status}`);
        }

        const data = await res.json();
        this.fileSha = data.sha;

        // Decode base64 content
        const content = atob(data.content.replace(/\n/g, ''));
        try {
            const parsed = JSON.parse(content);
            this.posts = parsed.posts || [];
        } catch {
            this.posts = [];
        }
    },

    // ── Save Posts ───────────────────────────────────────────────────────────

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
            throw new Error('No GitHub token. Add one in Settings.');
        }

        const content = JSON.stringify({ posts: this.posts }, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        const body = {
            message: this.editingPostId
                ? `Update post: ${this.getEditingTitle()}`
                : `Create new post: ${this.getEditingTitle()}`,
            content: base64Content,
            branch: CONFIG.GITHUB_BRANCH,
        };

        // Include SHA if file exists (required for updates)
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
            throw new Error(err.message || `GitHub API error: ${res.status}`);
        }

        const data = await res.json();
        this.fileSha = data.content.sha;
    },

    getEditingTitle() {
        return document.getElementById('post-title').value || 'Untitled';
    },

    // ── Post CRUD ────────────────────────────────────────────────────────────

    async savePost() {
        const title = document.getElementById('post-title').value.trim();
        const content = document.getElementById('post-content').value.trim();
        const tagsStr = document.getElementById('post-tags').value.trim();
        const excerpt = document.getElementById('post-excerpt').value.trim();
        const date = document.getElementById('post-date').value || new Date().toISOString().split('T')[0];

        // Validation
        if (!title) {
            this.showToast('Please enter a title', 'error');
            document.getElementById('post-title').focus();
            return;
        }
        if (!content) {
            this.showToast('Please enter some content', 'error');
            document.getElementById('post-content').focus();
            return;
        }

        const tags = tagsStr
            ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
            : [];

        const finalExcerpt = excerpt || this.generateExcerpt(content);

        const btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Saving...';

        try {
            if (this.editingPostId) {
                // Update existing post
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
                // Create new post
                const id = this.slugify(title);
                // Ensure unique ID
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

            // Sort by date descending
            this.posts.sort((a, b) => new Date(b.date) - new Date(a.date));

            await this.savePosts();

            this.showToast(
                this.editingPostId ? 'Post updated successfully!' : 'Post published successfully!',
                'success'
            );

            this._showView('posts-list');
        } catch (err) {
            this.showToast(`Save failed: ${err.message}`, 'error');
        }

        btn.disabled = false;
        btn.textContent = 'Save & Publish';
    },

    async deleteCurrentPost() {
        if (!this.editingPostId) return;

        if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) {
            return;
        }

        try {
            this.posts = this.posts.filter(p => p.id !== this.editingPostId);
            await this.savePosts();
            this.showToast('Post deleted', 'success');
            this._showView('posts-list');
        } catch (err) {
            this.showToast(`Delete failed: ${err.message}`, 'error');
        }
    },

    async deletePost(postId) {
        const post = this.posts.find(p => p.id === postId);
        if (!post) return;

        if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;

        try {
            this.posts = this.posts.filter(p => p.id !== postId);
            await this.savePosts();
            this.showToast('Post deleted', 'success');
            this.renderPostList();
        } catch (err) {
            this.showToast(`Delete failed: ${err.message}`, 'error');
        }
    },

    // ── Render Post List ─────────────────────────────────────────────────────

    renderPostList() {
        const container = document.getElementById('admin-post-list');
        if (!container) return;

        if (this.posts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-dim);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.3; margin-bottom: 1rem;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <h3 style="color: var(--text-muted); margin-bottom: 0.3rem;">No posts yet</h3>
                    <p style="font-size: 0.85rem; margin-bottom: 1rem;">Create your first blog post to get started.</p>
                    <button class="btn btn-primary btn-sm" onclick="AdminApp.showEditor('new')">Create Post</button>
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
                    <a href="/post.html?id=${encodeURIComponent(post.id)}" target="_blank" class="icon-btn" title="View post">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                    <button class="icon-btn" title="Edit" onclick="AdminApp.showEditor('edit', '${this.escapeHtml(post.id)}')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="icon-btn danger" title="Delete" onclick="AdminApp.deletePost('${this.escapeHtml(post.id)}')">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    // ── Live Preview ─────────────────────────────────────────────────────────

    updatePreview() {
        const content = document.getElementById('post-content').value;
        const preview = document.getElementById('post-preview');

        if (!content.trim()) {
            preview.innerHTML = '<p style="color: var(--text-dim);">Preview will appear here...</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            let html = marked.parse(content);
            if (typeof DOMPurify !== 'undefined') {
                html = DOMPurify.sanitize(html);
            }
            preview.innerHTML = html;
        } else {
            preview.innerHTML = `<p>${this.escapeHtml(content)}</p>`;
        }
    },

    // ── Export / Import ──────────────────────────────────────────────────────

    exportData() {
        const data = JSON.stringify({ posts: this.posts }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `blog-posts-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Posts exported', 'success');
    },

    async importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.posts || !Array.isArray(data.posts)) {
                throw new Error('Invalid file format');
            }

            if (!confirm(`Import ${data.posts.length} posts? This will replace your current local posts.`)) {
                return;
            }

            this.posts = data.posts;
            this.savePostsToLocal();
            this.renderPostList();
            this.showToast(`Imported ${data.posts.length} posts`, 'success');
        } catch (err) {
            this.showToast(`Import failed: ${err.message}`, 'error');
        }

        event.target.value = '';
    },

    // ── Utilities ────────────────────────────────────────────────────────────

    slugify(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')     // Remove non-word chars
            .replace(/[\s_-]+/g, '-')      // Replace spaces/underscores with hyphens
            .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens
    },

    generateExcerpt(content) {
        // Strip markdown syntax and get first ~150 chars
        const plain = content
            .replace(/^#+\s+/gm, '')       // Headers
            .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
            .replace(/\*(.+?)\*/g, '$1')     // Italic
            .replace(/`(.+?)`/g, '$1')       // Inline code
            .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Links
            .replace(/!\[.*?\]\(.+?\)/g, '')   // Images
            .replace(/^\s*[-*]\s+/gm, '')     // List items
            .replace(/^\s*\d+\.\s+/gm, '')    // Numbered lists
            .replace(/>\s+/gm, '')            // Blockquotes
            .replace(/```[\s\S]*?```/g, '')   // Code blocks
            .replace(/\n{2,}/g, '\n')         // Multiple newlines
            .trim();

        return plain.length > 150
            ? plain.substring(0, 150).trim() + '...'
            : plain;
    },

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
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

    // ── Toast Notifications ──────────────────────────────────────────────────

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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => AdminApp.init());
