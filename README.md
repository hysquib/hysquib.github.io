# hysquib — Personal Homepage & Blog

A static personal homepage with blog, deployable on GitHub Pages, featuring a password-protected admin panel for managing blog posts.

## Features

- **Static site** — Pure HTML/CSS/JS, no build step, no server required
- **GitHub Pages** — Free hosting, automatic rebuilds on push
- **Custom domain** — Pre-configured for `blog.hysquib.cn`
- **Admin panel** — Password-protected dashboard at `/admin.html`
- **Markdown blog** — Write posts in Markdown with live preview
- **Two storage modes:**
  - **Local** — Posts saved in browser localStorage (default, zero setup)
  - **GitHub** — Posts published directly to your repo via GitHub API (live updates)
- **Responsive design** — Editorial dark theme with warm gold accents
- **SEO-friendly** — Clean URLs, semantic HTML, meta tags

## Quick Start

### 1. Create a GitHub Repository

Create a new repository named `hysquib.github.io` (or any name you prefer).

### 2. Upload Files

Upload all files from this project to the repository:

```
├── index.html          # Homepage
├── blog.html           # Blog listing
├── post.html           # Individual post viewer
├── admin.html          # Admin panel
├── CNAME               # Custom domain config
├── .nojekyll           # Disables Jekyll processing
├── css/style.css       # All styles
├── js/config.js        # Site configuration
├── js/blog.js          # Public blog rendering
├── js/admin.js         # Admin panel logic
└── data/posts.json     # Blog posts data
```

### 3. Enable GitHub Pages

1. Go to **Settings → Pages** in your repository
2. Source: **Deploy from a branch**
3. Branch: **main** / **root**
4. Save

Your site will be live at `https://hysquib.github.io` (or your repo name).

### 4. Connect Custom Domain

1. In **Settings → Pages → Custom domain**, enter: `blog.hysquib.cn`
2. **Enable "Enforce HTTPS"** (recommended)
3. Add DNS records with your domain provider:

   **Option A — A Records (recommended):**
   ```
   Type: A
   Name: blog (or @)
   Value: 185.199.108.153
   Value: 185.199.109.153
   Value: 185.199.110.153
   Value: 185.199.111.153
   ```

   **Option B — CNAME:**
   ```
   Type: CNAME
   Name: blog
   Value: hysquib.github.io
   ```

4. Wait for DNS propagation (can take up to 24 hours, usually faster)

### 5. Configure the Site

Edit `js/config.js` to customize:

- **Password** — Change `PASSWORD_HASH` (see below)
- **Repository** — Set `GITHUB_REPO` to `your-username/your-repo`
- **Site info** — Name, tagline, description, social links

### 6. Change Admin Password

The default password is `admin123`. **Change it immediately:**

```bash
# Generate a SHA-256 hash of your new password
echo -n "your_new_password" | sha256sum
```

Paste the output hash into `js/config.js`:

```javascript
PASSWORD_HASH: 'your_hash_output_here',
```

Commit and push to GitHub.

## Using the Admin Panel

### Access

Navigate to `https://blog.hysquib.cn/admin.html` and enter your password.

### Storage Modes

#### Local Mode (default)

- Posts are saved in your browser's localStorage
- **No setup required**
- Posts only exist in the browser you created them in
- Use **Settings → Export** to back up posts as a JSON file
- Use **Settings → Import** to restore posts

#### GitHub Mode (recommended for live publishing)

- Posts are committed directly to your repository
- Changes appear on the live site after GitHub Pages rebuilds (~1 minute)
- Requires a **Personal Access Token** (PAT)

**To set up GitHub mode:**

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens/new)
2. Create a new token with the **`repo`** scope
3. Copy the token
4. In Admin → Settings → GitHub Personal Access Token, paste the token
5. Switch Storage Mode to "GitHub Repository"

The token is stored in your browser's sessionStorage only — it's cleared when you close the tab.

### Writing Posts

1. Click **New Post** in the sidebar
2. Enter a **title** and write content in **Markdown**
3. Add **tags** (comma-separated)
4. The **excerpt** auto-generates from content if left empty
5. Set the **date** (defaults to today)
6. Click **Save & Publish**

A live preview renders on the right side as you type.

## Customization

### Site Identity

Edit `js/config.js`:
- `SITE_NAME`, `SITE_AUTHOR`, `SITE_TAGLINE`, `SITE_DESCRIPTION`
- `SOCIAL` links (GitHub, Twitter, Email, RSS)

### Homepage Content

Edit `index.html` — the About section and hero text are directly in the HTML.

### Styling

Edit `css/style.css` — all design tokens are CSS variables at the top:

```css
:root {
    --bg: #0b0b0c;        /* Background */
    --accent: #c9a96e;     /* Accent color */
    --text: #e9e6e0;       /* Text color */
    /* ... etc */
}
```

### Fonts

The site uses [Fraunces](https://fonts.google.com/specimen/Fraunces) (display) and [Manrope](https://fonts.google.com/specimen/Manrope) (body) from Google Fonts. Change them in the `<head>` of each HTML file.

## Security Notes

- The admin password is a **client-side gatekeeper** (SHA-256 hash comparison). It prevents casual access but is not cryptographically secure against a determined attacker who inspects the source code.
- For real write protection, use **GitHub mode** with a Personal Access Token. The token is never persisted to disk — it lives only in the browser session.
- Never commit your PAT to the repository.

## Tech Stack

- **Hosting:** GitHub Pages (free, static)
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)
- **Markdown:** [marked.js](https://marked.js.org/) via CDN
- **Fonts:** Google Fonts (Fraunces + Manrope + JetBrains Mono)
- **API:** GitHub Contents API (for GitHub storage mode)

## License

This project is yours to use and modify freely.
