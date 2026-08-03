/**
 * BlogApp — 博客前台渲染逻辑
 * 负责获取文章数据，并在首页、博客列表页和文章详情页进行渲染。
 */

const BlogApp = {

    /**
     * 从 JSON 数据文件获取所有文章。
     * @returns {Promise<Array>} 按日期倒序排列的文章数组
     */
    async fetchPosts() {
        try {
            // 添加时间戳参数，确保 GitHub Pages 重建后获取最新内容
            const url = `/data/posts.json?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const posts = data.posts || [];
            // 按日期倒序排列（最新在前）
            return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
        } catch (err) {
            console.error('获取文章失败:', err);
            return [];
        }
    },

    /**
     * 将 ISO 日期字符串格式化为完整中文格式。
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
     * 短日期格式（用于文章卡片）。
     */
    formatDateShort(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    },

    /**
     * 根据内容估算阅读时间。
     */
    readingTime(content) {
        // 中文按字符数估算，约 300 字/分钟
        const chars = content.replace(/\s/g, '').length;
        return Math.max(1, Math.ceil(chars / 300));
    },

    /**
     * HTML 转义，防止 XSS。
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * 生成单篇文章卡片的 HTML。
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
     * 渲染最新 N 篇文章（用于首页）。
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
     * 渲染所有文章（用于博客列表页）。
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
     * 渲染单篇文章（用于 post.html，从 URL 读取 ?id=）。
     */
    async renderSinglePost(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const postId = params.get('id');

        if (!postId) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>文章未找到</h3>
                    <p>未指定文章 ID。<a href="/blog.html" style="color: var(--accent);">浏览所有文章 →</a></p>
                </div>
            `;
            return;
        }

        const posts = await this.fetchPosts();
        const post = posts.find(p => p.id === postId);

        if (!post) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>文章未找到</h3>
                    <p>该文章不存在或可能已被删除。<a href="/blog.html" style="color: var(--accent);">浏览所有文章 →</a></p>
                </div>
            `;
            return;
        }

        // 设置页面标题
        document.title = `${post.title} — hysquib`;

        // 查找相邻文章用于导航
        const index = posts.indexOf(post);
        const prevPost = posts[index + 1]; // 更早的文章（倒序排列）
        const nextPost = posts[index - 1]; // 更新的文章

        // 解析 Markdown
        let contentHTML;
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
            contentHTML = marked.parse(post.content || '');
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
                    <span>阅读约 ${this.readingTime(post.content)} 分钟</span>
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

        // 滚动到顶部
        window.scrollTo(0, 0);
    },
};
