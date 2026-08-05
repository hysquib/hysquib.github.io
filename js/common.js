// 公共初始化逻辑：年份、footer social links、页面特定渲染、站点内容加载
document.addEventListener('DOMContentLoaded', () => {
    // 设置年份
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // 渲染 footer social links
    const socialContainer = document.getElementById('footer-social');
    if (socialContainer && typeof CONFIG !== 'undefined') {
        const social = CONFIG.SOCIAL;
        const links = [];
        if (social.github) links.push(`<a href="${social.github}" title="GitHub" aria-label="GitHub"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>`);
        if (social.twitter) links.push(`<a href="${social.twitter}" title="Twitter" aria-label="Twitter"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>`);
        if (social.email) links.push(`<a href="${social.email}" title="Email" aria-label="Email"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg></a>`);
        if (social.rss) links.push(`<a href="${social.rss}" title="RSS" aria-label="RSS"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 012.18 2.18C8.36 19 7.38 20 6.18 20A2.18 2.18 0 014 17.82a2.18 2.18 0 012.18-2.18M4 4.44A15.56 15.56 0 0119.56 20h-2.83A12.73 12.73 0 004 7.27V4.44m0 5.66a9.9 9.9 0 019.9 9.9h-2.83A7.07 7.07 0 004 12.93V10.1z"/></svg></a>`);
        socialContainer.innerHTML = links.join('');
    }

    // 加载站点内容并应用到页面
    SiteContentLoader.load();

    // 页面特定渲染
    if (typeof BlogApp !== 'undefined') {
        if (document.getElementById('latest-posts')) {
            BlogApp.renderLatestPosts('latest-posts', 3);
        }
        if (document.getElementById('blog-list')) {
            BlogApp.renderAllPosts('blog-list');
        }
        if (document.getElementById('post-content')) {
            BlogApp.renderSinglePost('post-content');
        }
    }

    // Scroll reveal animation (index.html)
    const revealElements = document.querySelectorAll('.reveal');
    if (revealElements.length > 0) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1 });
        revealElements.forEach(el => observer.observe(el));
    }
});

// ── 站点内容加载器 ──────────────────────────────────────────────────────
const SiteContentLoader = {
    async load() {
        try {
            const url = `/data/site.json?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            this.applyToPage(data);
        } catch (err) {
            console.warn('无法加载站点内容，使用默认文本：', err.message);
        }
    },

    applyToPage(data) {
        // 文档标题和描述
        if (data.site) {
            if (data.site.title) document.title = data.site.title;
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc && data.site.description) metaDesc.setAttribute('content', data.site.description);
            if (data.site.lang) document.documentElement.lang = data.site.lang;
        }

        // 导航链接
        if (data.nav) {
            this.setTextByDataAttr('nav-home-text', data.nav.home);
            this.setTextByDataAttr('nav-blog-text', data.nav.blog);
            this.setTextByDataAttr('nav-about-text', data.nav.about);
        }

        // Hero 区域 (首页)
        if (data.hero && document.querySelector('.hero-content')) {
            const hero = data.hero;
            this.setTextByClass('hero-greeting', hero.greeting);
            this.setTextByClass('hero-name', hero.name);
            this.setTextByClass('hero-tagline', hero.tagline);
            this.setTextByClass('hero-description', hero.description);
            this.setTextByClass('hero-cta-primary', hero.ctaPrimary);
            this.setTextByClass('hero-cta-secondary', hero.ctaSecondary);
        }

        // 关于页
        if (data.about && document.querySelector('#about')) {
            const about = data.about;
            this.setTextByClass('about-label', about.label);
            const textContainer = document.querySelector('.about-text');
            if (textContainer && about.paragraphs) {
                textContainer.innerHTML = about.paragraphs
                    .map(p => `<p>${p}</p>`)
                    .join('');
            }
        }

        // 首页文章区域
        if (data.home) {
            this.setTextByClass('section-eyebrow', data.home.writingLabel);
            this.setTextByClass('section-title', data.home.latestTitle);
            this.setTextByClass('section-link', data.home.viewAll);
        }

        // 博客列表页
        if (data.blog) {
            this.setTextByClass('page-eyebrow', data.blog.pageEyebrow);
            this.setTextByClass('page-title', data.blog.pageTitle);
            this.setTextByClass('page-description', data.blog.pageDescription);
        }

        // 文章详情页
        if (data.post) {
            // post.html 的文本在 blog.js 中动态渲染
            document.documentElement.dataset.postBack = data.post.backLink || '';
            document.documentElement.dataset.postLoading = data.post.loading || '';
            document.documentElement.dataset.postReading = data.post.readingTime || '';
            document.documentElement.dataset.postNotFound = data.post.notFound || '';
            document.documentElement.dataset.postNotFoundDesc = data.post.notFoundDesc || '';
            document.documentElement.dataset.postBrowseAll = data.post.browseAll || '';
            document.documentElement.dataset.postNoId = data.post.noId || '';

            // post.html 静态元素
            this.setTextByClass('post-back-text', data.post.backLink);
            this.setTextByClass('post-loading-text', data.post.loading);
        }

        // 页脚
        if (data.footer) {
            this.setTextByClass('footer-copy-text', data.footer.copyright);
        }
    },

    setTextByClass(className, text) {
        if (!text) return;
        const els = document.getElementsByClassName(className);
        for (let el of els) {
            if (el.textContent) el.textContent = text;
        }
    },

    setTextByDataAttr(attrName, text) {
        if (!text) return;
        const els = document.querySelectorAll(`[data-${attrName}]`);
        els.forEach(el => { if (el.textContent) el.textContent = text; });
    },
};
