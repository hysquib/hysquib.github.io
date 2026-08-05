/**
 * BlogApp — Public blog rendering logic
 * Handles fetching posts and rendering them on homepage, blog list, and single post pages.
 */

const BlogApp = {

    /**
     * Fetch all posts from the JSON data file.
     * @returns {Promise<Array>} Sorted array of post objects
     */
    async fetchPosts() {
        try {
            // Cache-busting query param to ensure fresh content after GitHub Pages rebuild
            const url = `/data/posts.json?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const posts = data.posts || [];
            // Sort by date descending (newest first)
            return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (err) {
            console.error('Failed to fetch posts:', err);
            return [];
        }
    },

    /**
     * Read a data attribute from documentElement, falling back to default.
     */
    getSiteText(key, fallback) {
        const val = document.documentElement?.dataset?.[key];
        return val || fallback;
    },

    /**
     * Format an ISO date string into a human-readable format.
     */
    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    },

    /**
     * Format date short (for post cards).
     */
    formatDateShort(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    },

    /**
     * Estimate reading time from markdown content.
     */
    readingTime(content) {
        const words = content.trim().split(/\s+/).length;
        return Math.max(1, Math.ceil(words / 200));
    },

    /**
     * Escape HTML to prevent XSS in user-generated content titles/excerpts.
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Generate HTML for a single post card.
     */
    postCardHTML(post) {
        const tags = (post.tags || [])
            .map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`)
            .join('');

        return `
            <a href="/post.html?id=${encodeURIComponent(post.id)}" class="post-card">
                <div class="post-card-date">${this.formatDateShort(post.date)}</div>
                <h3>${this.escapeHtml(post.title)}</h3>
                <p class="post-card-excerpt">${this.escapeHtml(post.excerpt || '')}</p>
                ${tags ? `<div class="post-card-tags">${tags}</div>` : ''}
            </a>
        `;
    },

    /**
     * Render the latest N posts (for homepage).
     */
    async renderLatestPosts(containerId, count = 3) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const posts = await this.fetchPosts();
        const latest = posts.slice(0, count);

        if (latest.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <h3>暂无文章</h3>
                    <p>敬请期待新内容。</p>
                </div>
            `;
            return;
        }

        container.innerHTML = latest
            .map(p => this.postCardHTML(p))
            .join('');
    },

    /**
     * Render all posts (for blog listing page).
     */
    async renderAllPosts(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const posts = await this.fetchPosts();

        if (posts.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1;">
                    <h3>暂无文章</h3>
                    <p>敬请期待新内容。</p>
                </div>
            `;
            return;
        }

        container.innerHTML = posts
            .map(p => this.postCardHTML(p))
            .join('');
    },

    /**
     * Render a single post (for post.html, reads ?id= from URL).
     */
    async renderSinglePost(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const postId = params.get('id');

        const backLink = this.getSiteText('postBack', '返回博客');
        const loading = this.getSiteText('postLoading', '正在加载文章...');
        const readingTime = this.getSiteText('postReading', '分钟阅读');
        const notFound = this.getSiteText('postNotFound', '未找到文章');
        const notFoundDesc = this.getSiteText('postNotFoundDesc', '这篇文章可能已被删除。');
        const browseAll = this.getSiteText('postBrowseAll', '浏览全部文章 →');

        if (!postId) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>${notFound}</h3>
                    <p>${this.getSiteText('postNoId', '未指定文章 ID。')}<a href="/blog.html" style="color: var(--accent);">${browseAll}</a></p>
                </div>
            `;
            return;
        }

        const posts = await this.fetchPosts();
        const post = posts.find(p => p.id === postId);

        if (!post) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>${notFound}</h3>
                    <p>${notFoundDesc}<a href="/blog.html" style="color: var(--accent);">${browseAll}</a></p>
                </div>
            `;
            return;
        }

        // Set page title
        document.title = `${post.title} — hysquib`;

        // Find adjacent posts for navigation
        const index = posts.indexOf(post);
        const prevPost = posts[index + 1]; // older (since sorted desc)
        const nextPost = posts[index - 1]; // newer

        // Parse markdown
        let contentHTML;
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            const rawHTML = marked.parse(post.content || '');
            // Sanitize with DOMPurify to prevent XSS
            contentHTML = typeof DOMPurify !== 'undefined'
                ? DOMPurify.sanitize(rawHTML)
                : rawHTML;
        } else {
            contentHTML = `<p>${this.escapeHtml(post.content || '')}</p>`;
        }

        const tags = (post.tags || [])
            .map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`)
            .join('');

        container.innerHTML = `
            <header class="post-view-header">
                <div class="post-view-meta">
                    <span>${this.formatDate(post.date)}</span>
                    <span class="dot"></span>
                    <span>${this.readingTime(post.content)} ${readingTime}</span>
                </div>
                <h1>${this.escapeHtml(post.title)}</h1>
                ${tags ? `<div class="post-view-tags">${tags}</div>` : ''}
            </header>
            <div class="post-view-body">
                ${contentHTML}
            </div>
            <nav class="post-nav">
                ${prevPost
                    ? `<a href="/post.html?id=${encodeURIComponent(prevPost.id)}" class="post-back">← ${this.escapeHtml(prevPost.title)}</a>`
                    : '<span></span>'}
                ${nextPost
                    ? `<a href="/post.html?id=${encodeURIComponent(nextPost.id)}" class="post-back" style="text-align: right;">${this.escapeHtml(nextPost.title)} →</a>`
                    : '<span></span>'}
            </nav>
        `;

        // Scroll to top
        window.scrollTo(0, 0);
    },
};
