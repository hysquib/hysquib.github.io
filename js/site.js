/**
 * SiteApp — 站点内容渲染
 * -----------------------------------------------------------------------------
 * 从 /data/site.json 加载所有可编辑的站点内容（首页文案、关于、社交链接等），
 * 并填充到所有页面的对应位置。
 *
 * 数据可在管理台 "站点" 视图中编辑。
 */

const SiteApp = {

    data: null,

    /**
     * 异步加载站点数据。带缓存。
     * @param {boolean} forceRefresh — 跳过缓存强制刷新
     */
    async load(forceRefresh = false) {
        if (this.data && !forceRefresh) return this.data;

        try {
            const url = `/data/site.json?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.data = await res.json();
            return this.data;
        } catch (err) {
            console.error('加载站点数据失败:', err);
            return null;
        }
    },

    /**
     * HTML 转义。
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    },

    /**
     * 获取当前年份用于页脚。
     */
    getYear() {
        return new Date().getFullYear();
    },

    /**
     * 应用站点元数据（页面标题、描述）。
     */
    applyMeta(site) {
        if (!site) return;
        if (site.tagline) {
            document.title = `${site.name} — ${site.tagline}`;
        }
        const descMeta = document.querySelector('meta[name="description"]');
        if (descMeta && site.description) {
            descMeta.setAttribute('content', site.description);
        }
    },

    /**
     * 渲染导航栏。
     */
    renderNav(nav) {
        if (!nav) return;
        const links = document.querySelectorAll('.nav-links a');
        const labels = [nav.home, nav.blog, nav.about, nav.admin];
        links.forEach((a, i) => {
            if (labels[i]) a.textContent = labels[i];
        });
    },

    /**
     * 渲染社交链接到页脚。
     */
    renderSocial(social) {
        if (!social) return;
        const containers = document.querySelectorAll('.footer-social');
        const links = [];

        if (social.github) {
            links.push(`<a href="${this.escapeHtml(social.github)}" title="GitHub" aria-label="GitHub" target="_blank" rel="noopener">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </a>`);
        }
        if (social.twitter) {
            links.push(`<a href="${this.escapeHtml(social.twitter)}" title="Twitter" aria-label="Twitter" target="_blank" rel="noopener">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>`);
        }
        if (social.email) {
            links.push(`<a href="${this.escapeHtml(social.email)}" title="邮箱" aria-label="邮箱">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
            </a>`);
        }
        if (social.rss) {
            links.push(`<a href="${this.escapeHtml(social.rss)}" title="RSS" aria-label="RSS">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 012.18 2.18C8.36 19 7.38 20 6.18 20A2.18 2.18 0 014 17.82a2.18 2.18 0 012.18-2.18M4 4.44A15.56 15.56 0 0119.56 20h-2.83A12.73 12.73 0 004 7.27V4.44m0 5.66a9.9 9.9 0 019.9 9.9h-2.83A7.07 7.07 0 004 12.93V10.1z"/></svg>
            </a>`);
        }

        containers.forEach(c => { c.innerHTML = links.join(''); });
    },

    /**
     * 渲染页脚版权。
     */
    renderFooter(footer) {
        if (!footer) return;
        const template = footer.copyright_template || '© {year} hysquib.';
        const text = template.replace('{year}', this.getYear());
        document.querySelectorAll('.footer-copy').forEach(el => {
            el.textContent = text;
        });
        // 同时处理任何已存在的 year span
        const yearSpans = document.querySelectorAll('#year, .year');
        yearSpans.forEach(s => { s.textContent = this.getYear(); });
    },

    /**
     * 渲染首页 Hero 区域。
     */
    renderHero(hero) {
        if (!hero) return;
        const set = (selector, prop, value) => {
            const el = document.querySelector(selector);
            if (el && value != null) el[prop] = value;
        };

        set('.hero-greeting', 'textContent', hero.greeting);

        // Hero 标题特殊处理：name + <br> + accent
        const h1 = document.querySelector('.hero h1');
        if (h1 && hero.name != null) {
            const accentSpan = h1.querySelector('.accent');
            h1.innerHTML = this.escapeHtml(hero.name) + '<br>';
            if (accentSpan && hero.accent != null) {
                accentSpan.textContent = hero.accent;
                h1.appendChild(accentSpan);
            } else if (hero.accent != null) {
                const span = document.createElement('span');
                span.className = 'accent';
                span.textContent = hero.accent;
                h1.appendChild(span);
            }
        }

        set('.hero-tagline', 'textContent', hero.tagline);

        // 按钮
        const primaryBtn = document.querySelector('.hero-actions .btn-primary');
        if (primaryBtn) {
            if (hero.primary_button_text) {
                // 保留 SVG，更新文字节点
                const svg = primaryBtn.querySelector('svg');
                primaryBtn.textContent = hero.primary_button_text;
                if (svg) primaryBtn.appendChild(svg);
            }
            if (hero.primary_button_link) primaryBtn.href = hero.primary_button_link;
        }

        const secondaryBtn = document.querySelector('.hero-actions .btn:not(.btn-primary)');
        if (secondaryBtn) {
            if (hero.secondary_button_text) secondaryBtn.textContent = hero.secondary_button_text;
            if (hero.secondary_button_link) secondaryBtn.href = hero.secondary_button_link;
        }
    },

    /**
     * 渲染关于区域。
     */
    renderAbout(about) {
        if (!about) return;

        const label = document.querySelector('.about-label');
        if (label && about.label) label.textContent = about.label;

        const textContainer = document.querySelector('.about-text');
        if (textContainer && Array.isArray(about.paragraphs)) {
            textContainer.innerHTML = about.paragraphs
                .map(p => `<p>${this.escapeHtml(p)}</p>`)
                .join('');
        }
    },

    /**
     * 渲染首页"最新文章"区域标题。
     */
    renderLatestPostsSection(sections) {
        if (!sections) return;
        const eyebrow = document.querySelector('.section-header .eyebrow');
        if (eyebrow && sections.latest_posts_eyebrow) eyebrow.textContent = sections.latest_posts_eyebrow;

        const title = document.querySelector('.section-header h2');
        if (title && sections.latest_posts_title) title.textContent = sections.latest_posts_title;

        const link = document.querySelector('.section-link');
        if (link && sections.latest_posts_link) link.textContent = sections.latest_posts_link;
    },

    /**
     * 渲染博客列表页头部。
     */
    renderBlogHeader(sections) {
        if (!sections) return;
        const eyebrow = document.querySelector('.page-header .eyebrow');
        if (eyebrow && sections.blog_eyebrow) eyebrow.textContent = sections.blog_eyebrow;

        const h1 = document.querySelector('.page-header h1');
        if (h1 && sections.blog_title) h1.textContent = sections.blog_title;

        const p = document.querySelector('.page-header p');
        if (p && sections.blog_subtitle) p.textContent = sections.blog_subtitle;
    },

    /**
     * 初始化：加载站点数据并应用到当前页面。
     * @param {Object} opts — 指定要渲染哪些部分
     */
    async init(opts = {}) {
        const data = await this.load();
        if (!data) return;

        const {
            meta = true,
            nav = true,
            social = true,
            footer = true,
            hero = false,
            about = false,
            latestPostsSection = false,
            blogHeader = false,
        } = opts;

        if (meta) this.applyMeta(data.site);
        if (nav) this.renderNav(data.nav);
        if (social) this.renderSocial(data.social);
        if (footer) this.renderFooter(data.footer);
        if (hero) this.renderHero(data.hero);
        if (about) this.renderAbout(data.about);
        if (latestPostsSection) this.renderLatestPostsSection(data.sections);
        if (blogHeader) this.renderBlogHeader(data.sections);
    },
};
