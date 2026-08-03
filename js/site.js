/**
 * SiteApp — 站点内容渲染
 * -----------------------------------------------------------------------------
 * 从 /data/site.json 加载所有可编辑的站点内容（首页文案、关于、社交链接等），
 * 并填充到所有页面的对应位置。
 *
 * 关键设计：站点 JSON 中的空字符串字段会被自动忽略，保留 HTML 中的默认内容作为兜底。
 * 这样即使管理台意外提交了空值，前台也不会变空白。
 *
 * 数据可在管理台 "站点内容" 视图中编辑。
 */

const SiteApp = {

    data: null,

    /**
     * 异步加载站点数据。带缓存。
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

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    },

    getYear() { return new Date().getFullYear(); },

    /**
     * 判断值是否是有效（非空非 null）字符串 —— 空字符串不覆盖默认 HTML。
     */
    isNonEmpty(v) { return typeof v === 'string' && v.trim() !== ''; },

    // ── 页面标题 / 描述 ─────────────────────────────────────────────────────
    applyMeta(site) {
        if (!site) return;
        if (this.isNonEmpty(site.name) && this.isNonEmpty(site.tagline)) {
            document.title = `${site.name} — ${site.tagline}`;
        } else if (this.isNonEmpty(site.tagline)) {
            // 仅标签非空时不覆盖 document title，由 html <title> 静态值兜底
        }
        const descMeta = document.querySelector('meta[name="description"]');
        if (descMeta && this.isNonEmpty(site.description)) {
            descMeta.setAttribute('content', site.description);
        }
    },

    // ── 导航栏 ──────────────────────────────────────────────────────────────
    renderNav(nav) {
        if (!nav) return;
        const links = document.querySelectorAll('.nav-links a');
        const labels = [nav.home, nav.blog, nav.about, nav.admin];
        links.forEach((a, i) => {
            if (this.isNonEmpty(labels[i])) a.textContent = labels[i];
        });
    },

    // ── 社交链接 ────────────────────────────────────────────────────────────
    renderSocial(social) {
        if (!social) return;
        const containers = document.querySelectorAll('.footer-social');
        const links = [];
        const addLink = (url, title, svg) => {
            if (!this.isNonEmpty(url)) return;
            links.push(`<a href="${this.escapeHtml(url)}" title="${title}" aria-label="${title}" target="_blank" rel="noopener">${svg}</a>`);
        };

        addLink(social.github, 'GitHub',
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`);
        addLink(social.twitter, 'Twitter',
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`);
        addLink(social.email, '邮箱',
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>`);
        addLink(social.rss, 'RSS',
            `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 012.18 2.18C8.36 19 7.38 20 6.18 20A2.18 2.18 0 014 17.82a2.18 2.18 0 012.18-2.18M4 4.44A15.56 15.56 0 0119.56 20h-2.83A12.73 12.73 0 004 7.27V4.44m0 5.66a9.9 9.9 0 019.9 9.9h-2.83A7.07 7.07 0 004 12.93V10.1z"/></svg>`);

        // 仅当至少有一个链接时才替换（否则保留可能已存在的默认内容）
        if (links.length > 0) {
            containers.forEach(c => { c.innerHTML = links.join(''); });
        }
    },

    // ── 页脚版权 ────────────────────────────────────────────────────────────
    renderFooter(footer) {
        const template = (footer && this.isNonEmpty(footer.copyright_template))
            ? footer.copyright_template
            : '© {year} hysquib. 用心构建。';
        const text = template.replace('{year}', this.getYear());
        document.querySelectorAll('.footer-copy').forEach(el => {
            el.textContent = text;
        });
        const yearSpans = document.querySelectorAll('#year, .year');
        yearSpans.forEach(s => { s.textContent = this.getYear(); });
    },

    // ── Hero 区域 ────────────────────────────────────────────────────────────
    renderHero(hero) {
        if (!hero) return;

        // 问候语
        const greeting = document.querySelector('.hero-greeting');
        if (greeting && this.isNonEmpty(hero.greeting)) {
            greeting.textContent = hero.greeting;
        }

        // Hero 标题（name + <br> + accent）
        const h1 = document.querySelector('.hero h1');
        if (h1 && this.isNonEmpty(hero.name)) {
            const nameText = hero.name;
            const accentText = this.isNonEmpty(hero.accent) ? hero.accent : null;
            // 仅当 name 有效时重建内容；accent 为空时不显示 accent 行
            const accentHtml = accentText
                ? `<span class="accent">${this.escapeHtml(accentText)}</span>`
                : '';
            h1.innerHTML = this.escapeHtml(nameText)
                + (accentText ? '<br>' + accentHtml : '');
        } else if (h1 && !this.isNonEmpty(hero.name) && this.isNonEmpty(hero.accent)) {
            // name 空但 accent 非空 — 追加 accent 到现有 h1
            const existingAccent = h1.querySelector('.accent');
            if (existingAccent) {
                existingAccent.textContent = hero.accent;
            } else {
                const span = document.createElement('span');
                span.className = 'accent';
                span.textContent = hero.accent;
                if (h1.querySelector('br')) {
                    h1.appendChild(span);
                } else {
                    h1.appendChild(document.createElement('br'));
                    h1.appendChild(span);
                }
            }
        }

        // 标语段落
        if (this.isNonEmpty(hero.tagline)) {
            const tag = document.querySelector('.hero-tagline');
            if (tag) tag.textContent = hero.tagline;
        }

        // 主按钮
        const primaryBtn = document.querySelector('.hero-actions .btn-primary');
        if (primaryBtn) {
            if (this.isNonEmpty(hero.primary_button_text)) {
                const svg = primaryBtn.querySelector('svg');
                primaryBtn.textContent = hero.primary_button_text;
                if (svg) primaryBtn.appendChild(svg);
            }
            if (this.isNonEmpty(hero.primary_button_link)) primaryBtn.href = hero.primary_button_link;
        }
        // 次按钮
        const secondaryBtn = document.querySelector('.hero-actions .btn:not(.btn-primary)');
        if (secondaryBtn) {
            if (this.isNonEmpty(hero.secondary_button_text)) secondaryBtn.textContent = hero.secondary_button_text;
            if (this.isNonEmpty(hero.secondary_button_link)) secondaryBtn.href = hero.secondary_button_link;
        }
    },

    // ── 关于区域 ────────────────────────────────────────────────────────────
    renderAbout(about) {
        if (!about) return;

        const label = document.querySelector('.about-label');
        if (label && this.isNonEmpty(about.label)) label.textContent = about.label;

        // 仅当 paragraphs 非空时才覆盖（否则保留默认 HTML 段落）
        if (Array.isArray(about.paragraphs) && about.paragraphs.filter(p => this.isNonEmpty(p)).length > 0) {
            const textContainer = document.querySelector('.about-text');
            if (textContainer) {
                textContainer.innerHTML = about.paragraphs
                    .filter(p => this.isNonEmpty(p))
                    .map(p => `<p>${this.escapeHtml(p)}</p>`)
                    .join('');
            }
        }
    },

    // ── 区块标题 ────────────────────────────────────────────────────────────
    renderLatestPostsSection(sections) {
        if (!sections) return;
        const eyebrow = document.querySelector('.section-header .eyebrow');
        if (eyebrow && this.isNonEmpty(sections.latest_posts_eyebrow)) eyebrow.textContent = sections.latest_posts_eyebrow;
        const title = document.querySelector('.section-header h2');
        if (title && this.isNonEmpty(sections.latest_posts_title)) title.textContent = sections.latest_posts_title;
        const link = document.querySelector('.section-link');
        if (link && this.isNonEmpty(sections.latest_posts_link)) link.textContent = sections.latest_posts_link;
    },

    renderBlogHeader(sections) {
        if (!sections) return;
        const eyebrow = document.querySelector('.page-header .eyebrow');
        if (eyebrow && this.isNonEmpty(sections.blog_eyebrow)) eyebrow.textContent = sections.blog_eyebrow;
        const h1 = document.querySelector('.page-header h1');
        if (h1 && this.isNonEmpty(sections.blog_title)) h1.textContent = sections.blog_title;
        const p = document.querySelector('.page-header p');
        if (p && this.isNonEmpty(sections.blog_subtitle)) p.textContent = sections.blog_subtitle;
    },

    // ── 入口 ─────────────────────────────────────────────────────────────────
    async init(opts = {}) {
        const data = await this.load();
        if (!data) return;

        const {
            meta = true, nav = true, social = true, footer = true,
            hero = false, about = false, latestPostsSection = false, blogHeader = false,
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
