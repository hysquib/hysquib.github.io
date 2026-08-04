/**
 * Site Configuration
 * -----------------------------------------------------------------------------
 * Edit this file to customize your site. After changing, commit to GitHub
 * and GitHub Pages will rebuild automatically.
 *
 * SECURITY: No passwords, tokens, or repository info are stored here.
 *           All sensitive configuration is handled by the Cloudflare Worker.
 */

const CONFIG = {
    // ── Worker API ──────────────────────────────────────────────────────────
    // Cloudflare Worker URL for admin authentication and GitHub API proxy.
    // The Worker stores all sensitive credentials (PAT, OAuth secrets) as
    // environment variables — they are never exposed to the frontend.
    WORKER_URL: 'https://blog-admin-api.nzp5y2tsp7.workers.dev',

    // ── Site Identity ───────────────────────────────────────────────────────
    SITE_NAME: 'hysquib',
    SITE_AUTHOR: 'hysquib',
    SITE_TAGLINE: '构建者 · 写作者 · 思考者',
    SITE_DESCRIPTION: '关于技术、设计和构建有意义事物的个人思考。',

    // ── Social Links ────────────────────────────────────────────────────────
    SOCIAL: {
        github:   'https://github.com/hysquib',
        twitter:  '',
        email:    'mailto:hello@hysquib.cn',
        rss:      '/data/posts.json',
    },

    // ── Posts per page ──────────────────────────────────────────────────────
    POSTS_PER_PAGE: 6,
};
