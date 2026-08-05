/**
 * Cloudflare Worker — Blog Admin API
 * -----------------------------------------------------------------------------
 * Custom domain (recommended): adminblog.hysquib.cn
 *   Configure via Cloudflare Dashboard → Worker → Triggers → Custom Domains
 * Pages domain (frontend):     blog.hysquib.cn (GitHub Pages / Cloudflare Pages)
 *
 * Required environment variables (Worker → Settings → Variables):
 *   GITHUB_TOKEN         — GitHub PAT with repo scope                  (Secret)
 *   OAUTH_CLIENT_ID      — GitHub OAuth App Client ID                 (Text)
 *   OAUTH_CLIENT_SECRET  — GitHub OAuth App Client Secret             (Secret)
 *   SESSION_SECRET       — Random 32+ char string for HMAC signing    (Secret)
 *   GITHUB_REPO          — hysquib/hysquib.github.io                  (Text)
 *   GITHUB_BRANCH        — main                                       (Text)
 *   POSTS_FILE_PATH      — data/posts.json                            (Text)
 *   BLOG_URL             — https://blog.hysquib.cn                    (Text)
 *   ALLOWED_USER         — hysquib                                    (Text)
 */

const REQUIRED_VARS = [
  'SESSION_SECRET', 'GITHUB_TOKEN', 'OAUTH_CLIENT_ID',
  'OAUTH_CLIENT_SECRET', 'GITHUB_REPO', 'GITHUB_BRANCH',
  'POSTS_FILE_PATH', 'BLOG_URL', 'ALLOWED_USER',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── Health / Config check ────────────────────────────────────────────
      if (url.pathname === '/health') {
        const missing = REQUIRED_VARS.filter(v => !env[v]);
        return json({
          status: 'ok',
          missing_env_vars: missing,
          env_configured: missing.length === 0,
          session_secret_len: env.SESSION_SECRET ? env.SESSION_SECRET.length : 0,
          github_repo: env.GITHUB_REPO || null,
          github_branch: env.GITHUB_BRANCH || null,
          posts_file_path: env.POSTS_FILE_PATH || null,
          blog_url: env.BLOG_URL || null,
          worker_custom_domain: 'https://adminblog.hysquib.cn',
        }, corsHeaders);
      }

      // ── Auth: Login ──────────────────────────────────────────────────────
      if (url.pathname === '/auth/login') {
        const missing = REQUIRED_VARS.filter(v => !env[v]);
        if (missing.length > 0) {
          return json({ error: 'Worker 环境变量未配置', missing: missing }, corsHeaders, 500);
        }

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

      // ── Auth: Callback ──────────────────────────────────────────────────
      if (url.pathname === '/auth/callback') {
        const missing = REQUIRED_VARS.filter(v => !env[v]);
        if (missing.length > 0) {
          return redirect(`${env.BLOG_URL}/admin.html?error=worker_config`);
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const cookies = parseCookies(request.headers.get('Cookie') || '');
        if (!code || !state || state !== cookies.oauth_state) {
          return redirect(`${env.BLOG_URL}/admin.html?error=state_mismatch`);
        }
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'blog-worker' },
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
        const userRes = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'blog-worker' },
        });
        const userData = await userRes.json();
        if (userData.login !== env.ALLOWED_USER) {
          return redirect(`${env.BLOG_URL}/admin.html?error=forbidden`);
        }
        const expiry = Date.now() + 8 * 60 * 60 * 1000;
        const payload = `${userData.login}:${expiry}`;
        const signature = await hmacSign(payload, env.SESSION_SECRET);
        const sessionToken = `${base64url(payload)}.${signature}`;
        return redirect(`${env.BLOG_URL}/admin.html#token=${sessionToken}`);
      }

      // ── Auth: Check ─────────────────────────────────────────────────────
      if (url.pathname === '/auth/check') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (result.ok) {
          return json({ authenticated: true, user: result.user }, corsHeaders);
        } else {
          return json({ authenticated: false, reason: result.reason, message: result.message }, corsHeaders);
        }
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
            return json(
              { error: `POSTS_FILE_PATH "${env.POSTS_FILE_PATH}" not found in repo ${env.GITHUB_REPO}@${env.GITHUB_BRANCH}` },
              corsHeaders, 404,
            );
          }
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }
        const data = await res.json();
        const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
        const parsed = JSON.parse(content);
        return json({ ...parsed, sha: data.sha }, corsHeaders);
      }

      // ── API: Save Posts ──────────────────────────────────────────────────
      if (url.pathname === '/api/posts' && request.method === 'PUT') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: 'Unauthorized', reason: result.reason, message: result.message }, corsHeaders, 401);
        }
        const body = await request.json();
        const content = JSON.stringify({ posts: body.posts }, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));
        const githubBody = {
          message: body.message || 'Update blog posts',
          content: base64Content,
          branch: env.GITHUB_BRANCH,
        };
        if (body.sha) githubBody.sha = body.sha;
        const res = await githubFetch(env, `/contents/${env.POSTS_FILE_PATH}`, 'PUT', githubBody);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }
        const data = await res.json();
        return json({ sha: data.content.sha, success: true }, corsHeaders);
      }

      return json({ error: 'Not found' }, corsHeaders, 404);
    } catch (err) {
      return json({ error: err.message, stack: err.stack }, corsHeaders, 500);
    }
  },
};

// ── Helper Functions ─────────────────────────────────────────────────────────

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
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
  if (!env.SESSION_SECRET) return { ok: false, reason: 'missing_secret', message: 'Worker 未配置 SESSION_SECRET 环境变量' };
  if (!token) return { ok: false, reason: 'malformed', message: '未提供 token' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed', message: 'Token 格式错误' };
  const [payloadB64, signature] = parts;
  let payload;
  try { payload = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')); }
  catch { return { ok: false, reason: 'malformed', message: 'Token 无法解码' }; }
  const colonIdx = payload.indexOf(':');
  if (colonIdx === -1) return { ok: false, reason: 'malformed', message: 'Token payload 格式错误' };
  const user = payload.substring(0, colonIdx);
  const expiry = parseInt(payload.substring(colonIdx + 1), 10);
  if (isNaN(expiry)) return { ok: false, reason: 'malformed', message: 'Token 过期时间无效' };
  if (Date.now() > expiry) return { ok: false, reason: 'expired', message: '会话已过期，请重新登录' };
  const expected = await hmacSign(payload, env.SESSION_SECRET);
  if (expected !== signature) return { ok: false, reason: 'bad_signature', message: '签名验证失败 — Worker SESSION_SECRET 可能已更改' };
  return { ok: true, user, expiry };
}

async function hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

function base64url(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let result = '';
  for (let i = 0; i < len; i++) result += chars[arr[i] % chars.length];
  return result;
}
