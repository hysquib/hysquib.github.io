/**
 * Site Configuration
 * -----------------------------------------------------------------------------
 * Edit this file to customize your site. After changing, commit to GitHub
 * and GitHub Pages will rebuild automatically.
 */

const CONFIG = {
    // ── Admin Password ──────────────────────────────────────────────────────
    // SHA-256 hash of the admin login password.
    // Default password is: Mty103015.
    //
    // To set your own password, run this in a terminal:
    //   echo -n "your_password" | sha256sum
    // Then paste the output hash below.
    PASSWORD_HASH: '04f449c3889bb43663231a12b5174cb178c9b53ab24eaf2ea2e46bcf7ebbd2cd',

    // ── GitHub Repository ───────────────────────────────────────────────────
    // Used by the admin panel to publish posts back to your repo.
    // Format: "owner/repo-name"
    GITHUB_REPO: 'hysquib/hysquib.github.io',

    // Branch to commit blog post changes to
    GITHUB_BRANCH: 'main',

    // Path to the posts JSON file within the repo
    POSTS_FILE_PATH: 'data/posts.json',

    // ── Site Identity ───────────────────────────────────────────────────────
    SITE_NAME: 'hysquib',
    SITE_AUTHOR: 'hysquib',
    SITE_TAGLINE: 'Builder · Writer · Thinker',
    SITE_DESCRIPTION: 'Personal thoughts on technology, design, and the craft of building things that matter.',

    // ── Social Links ────────────────────────────────────────────────────────
    // Leave empty ('') to hide a link from the homepage.
    SOCIAL: {
        github:   'https://github.com/hysquib',
        twitter:  '',
        email:    'mailto:hello@hysquib.cn',
        rss:      '/data/posts.json',
    },

    // ── Posts per page ──────────────────────────────────────────────────────
    POSTS_PER_PAGE: 6,
};
