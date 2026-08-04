/**
 * Site Configuration
 * -----------------------------------------------------------------------------
 * Edit this file to customize your site. After changing, commit to GitHub
 * and GitHub Pages will rebuild automatically.
 */

const CONFIG = {
    // ── Admin Password Hash ─────────────────────────────────────────────────
    // SHA-256 hash of the admin login password (NOT stored as plaintext).
    //
    // To set your own password:
    //   1. Run in a terminal:
    //        echo -n "your_password" | sha256sum
    //   2. Paste the 64-character hex output below.
    //   3. Commit & push to GitHub.
    //
    // NOTE: This is client-side authentication — it only prevents accidental
    // access. For true write security, all changes require a GitHub PAT.
    PASSWORD_HASH: '04f449c3889bb43663231a12b5174cb178c9b53ab24eaf2ea2e46bcf7ebbd2cd',

    // ── GitHub Repository ───────────────────────────────────────────────────
    // Used by the admin panel to publish posts back to your repo.
    GITHUB_REPO: 'hysquib/hysquib.github.io',
    GITHUB_BRANCH: 'main',
    POSTS_FILE_PATH: 'data/posts.json',
    SITE_FILE_PATH: 'data/site.json',

    // ── Site Identity ───────────────────────────────────────────────────────
    SITE_NAME: 'hysquib',
    SITE_AUTHOR: 'hysquib',
    SITE_TAGLINE: 'Builder · Writer · Thinker',
    SITE_DESCRIPTION: 'Personal thoughts on technology, design, and the craft of building things that matter.',

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
