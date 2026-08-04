/**
 * Cloudflare Worker — Blog Admin API
 * -----------------------------------------------------------------------------
 * Provides GitHub OAuth authentication and proxies GitHub Contents API.
 * Sensitive credentials (PAT, OAuth secrets) are stored as environment
 * variables — never exposed to the frontend.
 *
 * Required environment variables (set in Cloudflare dashboard):
 *   GITHUB_TOKEN         — GitHub PAT with repo scope
 *   OAUTH_CLIENT_ID      — GitHub OAuth App Client ID
 *   OAUTH_CLIENT_SECRET  — GitHub OAuth App Client Secret
 *   SESSION_SECRET       — Random 32+ char string for signing tokens
 *   GITHUB_REPO          — e.g. 'hysquib/hysquib.github.io'
 *   GITHUB_BRANCH        — e.g. 'main'
 *   POSTS_FILE_PATH      — e.g. 'data/posts.json'
 *   BLOG_URL             — e.g. 'https://blog.hysquib.cn'
 *   ALLOWED_USER         — GitHub username allowed to login
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS ──────────────────────────────────────────────────────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── Auth: Login — redirect to GitHub OAuth ───────────────────────────
      if (url.pathname === '/auth/login') {
        const state = randomString(32);
        const params = new URLSearchParams({
          client_id: env.OAUTH_CLIENT_ID,
          redirect_uri: `${url.origin}/auth/callback`,
          scope: 'read:user',
          state,
        });
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://github.com/login/oauth/authorize?${params}`,
            'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          },
        });
      }

      // ── Auth: Callback — exchange code, verify user, issue token ─────────
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const cookies = parseCookies(request.headers.get('Cookie') || '');

        if (!code || !state || state !== cookies.oauth_state) {
          return redirect(`${env.BLOG_URL}/admin.html?error=state_mismatch`);
        }

        // Exchange code for access token
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'blog-worker',
          },
          body: JSON.stringify({
            client_id: env.OAUTH_CLIENT_ID,
            client_secret: env.OAUTH_CLIENT_SECRET,
            code,
          }),
        });
        const tokenData = await tokenRes.json();

        if (tokenData.error || !tokenData.access_token) {
          return redirect(`${env.BLOG_URL}/admin.html?error=token_failed`);
        }

        // Get GitHub user info
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'User-Agent': 'blog-worker',
          },
        });
        const userData = await userRes.json();

        // Verify user is allowed
        if (userData.login !== env.ALLOWED_USER) {
          return redirect(`${env.BLOG_URL}/admin.html?error=forbidden`);
        }

        // Create signed session token
        const expiry = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
        const payload = `${userData.login}:${expiry}`;
        const signature = await hmacSign(payload, env.SESSION_SECRET);
        const sessionToken = `${base64url(payload)}.${signature}`;

        // Redirect to blog with token in URL hash (not sent to servers)
        return redirect(`${env.BLOG_URL}/admin.html#token=${sessionToken}`);
      }

      // ── Auth: Check — verify token ───────────────────────────────────────
      if (url.pathname === '/auth/check') {
        const token = getBearerToken(request);
        const session = token && await verifyToken(token, env);
        return json({
          authenticated: !!session,
          user: session ? session.user : null,
        }, corsHeaders);
      }

      // ── Auth: Logout ─────────────────────────────────────────────────────
      if (url.pathname === '/auth/logout') {
        return json({ success: true }, corsHeaders);
      }

      // ── API: Get Posts ───────────────────────────────────────────────────
      if (url.pathname === '/api/posts' && request.method === 'GET') {
        const res = await githubFetch(env, `/contents/${env.POSTS_FILE_PATH}?ref=${env.GITHUB_BRANCH}`);

        if (!res.ok) {
          if (res.status === 404) {
            // Return HTTP 404 so admin can differentiate between "no posts yet" vs "file path misconfigured"
            // (public site has posts, admin shows empty → env vars wrong).
            return json(
              { error: `POSTS_FILE_PATH "${env.POSTS_FILE_PATH}" not found in repo ${env.GITHUB_REPO}@${env.GITHUB_BRANCH}` },
              corsHeaders,
              404,
            );
          }
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }

        const data = await res.json();
        const content = atob(data.content.replace(/\n/g, ''));
        const parsed = JSON.parse(content);
        return json({ ...parsed, sha: data.sha }, corsHeaders);
      }

      // ── API: Save Posts (requires auth) ──────────────────────────────────
      if (url.pathname === '/api/posts' && request.method === 'PUT') {
        const token = getBearerToken(request);
        const session = token && await verifyToken(token, env);

        if (!session) {
          return json({ error: 'Unauthorized' }, corsHeaders, 401);
        }

        const body = await request.json();
        const content = JSON.stringify({ posts: body.posts }, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        const githubBody = {
          message: body.message || 'Update blog posts',
          content: base64Content,
          branch: env.GITHUB_BRANCH,
        };

        if (body.sha) {
          githubBody.sha = body.sha;
        }

        const res = await githubFetch(env, `/contents/${env.POSTS_FILE_PATH}`, 'PUT', githubBody);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }

        const data = await res.json();
        return json({ sha: data.content.sha, success: true }, corsHeaders);
      }

      // ── 404 ──────────────────────────────────────────────────────────────
      return json({ error: 'Not found' }, corsHeaders, 404);

    } catch (err) {
      return json({ error: err.message }, corsHeaders, 500);
    }
  },
};

// ── Helper Functions ─────────────────────────────────────────────────────────

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}

async function githubFetch(env, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'blog-worker',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, opts);
}

function parseCookies(header) {
  const cookies = {};
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k] = v.join('=');
  });
  return cookies;
}

function getBearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

async function verifyToken(token, env) {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  try {
    const payload = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const [user, expiryStr] = payload.split(':');
    const expiry = parseInt(expiryStr, 10);

    if (Date.now() > expiry) return null;

    const expected = await hmacSign(payload, env.SESSION_SECRET);
    if (expected !== signature) return null;

    return { user, expiry };
  } catch {
    return null;
  }
}

async function hmacSign(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

function base64url(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[arr[i] % chars.length];
  }
  return result;
}
