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
 *
 * KV Namespace binding (Worker → Settings → KV Namespace Bindings):
 *   PASSKEY_KV           — Stores registered passkey credentials        (KV)
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

      // ── Passkey: Register (begin) ───────────────────────────────────────
      if (url.pathname === '/auth/passkey/register/begin' && request.method === 'POST') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: '请先使用 GitHub 登录后再注册通行密钥' }, corsHeaders, 401);
        }

        const challenge = randomString(32);
        const challengeKey = `challenge_register:${result.user}:${challenge}`;

        if (env.PASSKEY_KV) {
          await env.PASSKEY_KV.put(challengeKey, result.user, { expirationTtl: 300 });
        }

        return json({
          challenge,
          rp: {
            name: '博客管理后台',
            id: 'hysquib.cn',
          },
          user: {
            id: result.user,
            name: result.user,
            displayName: result.user,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'preferred',
          },
        }, corsHeaders);
      }

      // ── Passkey: Register (finish) ──────────────────────────────────────
      if (url.pathname === '/auth/passkey/register/finish' && request.method === 'POST') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: '请先使用 GitHub 登录后再注册通行密钥' }, corsHeaders, 401);
        }

        const body = await request.json();
        const { challenge, credential } = body;

        if (!challenge || !credential || !credential.id || !credential.publicKey) {
          return json({ error: '缺少必要的注册数据' }, corsHeaders, 400);
        }

        const challengeKey = `challenge_register:${result.user}:${challenge}`;
        if (env.PASSKEY_KV) {
          const stored = await env.PASSKEY_KV.get(challengeKey);
          if (!stored) {
            return json({ error: '注册请求已过期，请重试' }, corsHeaders, 400);
          }
          await env.PASSKEY_KV.delete(challengeKey);
        }

        const credKey = `passkey:${result.user}:${credential.id}`;
        if (env.PASSKEY_KV) {
          await env.PASSKEY_KV.put(credKey, JSON.stringify({
            publicKey: credential.publicKey,
            counter: credential.counter || 0,
            created: Date.now(),
          }));
        } else {
          return json({ error: 'KV 存储未配置，无法保存通行密钥' }, corsHeaders, 500);
        }

        return json({ success: true, message: '通行密钥注册成功' }, corsHeaders);
      }

      // ── Passkey: Login (begin) ──────────────────────────────────────────
      if (url.pathname === '/auth/passkey/login/begin' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const username = body.username || env.ALLOWED_USER;

        let hasPasskey = false;
        if (env.PASSKEY_KV) {
          const listResult = await env.PASSKEY_KV.list({ prefix: `passkey:${username}:` });
          hasPasskey = listResult.keys.length > 0;
        }

        if (!hasPasskey) {
          return json({ error: '尚未注册通行密钥，请先用 GitHub 登录后注册' }, corsHeaders, 400);
        }

        const challenge = randomString(32);
        const challengeKey = `challenge_login:${username}:${challenge}`;
        if (env.PASSKEY_KV) {
          await env.PASSKEY_KV.put(challengeKey, username, { expirationTtl: 300 });
        }

        return json({
          challenge,
          rpId: 'hysquib.cn',
          userVerification: 'preferred',
          timeout: 60000,
        }, corsHeaders);
      }

      // ── Passkey: Login (finish) ─────────────────────────────────────────
      if (url.pathname === '/auth/passkey/login/finish' && request.method === 'POST') {
        const body = await request.json();
        const { challenge, credential } = body;

        if (!challenge || !credential || !credential.id || !credential.signature || !credential.authenticatorData) {
          return json({ error: '缺少必要的登录数据' }, corsHeaders, 400);
        }

        const username = body.username || env.ALLOWED_USER;

        const challengeKey = `challenge_login:${username}:${challenge}`;
        if (!env.PASSKEY_KV) {
          return json({ error: 'KV 存储未配置' }, corsHeaders, 500);
        }
        const storedUser = await env.PASSKEY_KV.get(challengeKey);
        if (!storedUser) {
          return json({ error: '登录请求已过期，请重试' }, corsHeaders, 400);
        }
        await env.PASSKEY_KV.delete(challengeKey);

        const credKey = `passkey:${username}:${credential.id}`;
        const storedCred = await env.PASSKEY_KV.get(credKey);
        if (!storedCred) {
          return json({ error: '通行密钥未找到，请重新注册' }, corsHeaders, 400);
        }

        const credData = JSON.parse(storedCred);
        const isValid = await verifyPasskeySignature(
          credential,
          credData.publicKey,
          challenge,
        );

        if (!isValid) {
          return json({ error: '通行密钥验证失败' }, corsHeaders, 401);
        }

        credData.counter = Math.max(credData.counter || 0, credential.counter || 0) + 1;
        await env.PASSKEY_KV.put(credKey, JSON.stringify(credData));

        const expiry = Date.now() + 8 * 60 * 60 * 1000;
        const payload = `${username}:${expiry}`;
        const signature = await hmacSign(payload, env.SESSION_SECRET);
        const sessionToken = `${base64url(payload)}.${signature}`;

        return json({ token: sessionToken, user: username }, corsHeaders);
      }

      // ── Passkey: Check registration status ──────────────────────────────
      if (url.pathname === '/auth/passkey/status' && request.method === 'GET') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: '未认证' }, corsHeaders, 401);
        }

        let registered = false;
        if (env.PASSKEY_KV) {
          const listResult = await env.PASSKEY_KV.list({ prefix: `passkey:${result.user}:` });
          registered = listResult.keys.length > 0;
        }

        return json({ registered, user: result.user }, corsHeaders);
      }

      // ── Passkey: Unregister ─────────────────────────────────────────────
      if (url.pathname === '/auth/passkey/unregister' && request.method === 'POST') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: '未认证' }, corsHeaders, 401);
        }

        if (env.PASSKEY_KV) {
          const listResult = await env.PASSKEY_KV.list({ prefix: `passkey:${result.user}:` });
          for (const key of listResult.keys) {
            await env.PASSKEY_KV.delete(key.name);
          }
        }

        return json({ success: true, message: '通行密钥已删除' }, corsHeaders);
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

// ── Passkey 辅助函数 ──────────────────────────────────────────────────────────

function base64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function verifyPasskeySignature(credential, publicKeyJwk, expectedChallenge) {
  try {
    // 1. 验证 clientDataJSON 中的 challenge
    const clientDataJSON = new TextDecoder().decode(base64urlToBuffer(credential.clientDataJSON));
    const clientData = JSON.parse(clientDataJSON);

    // 浏览器将 challenge 字节数组进行 base64url 编码后存入 clientDataJSON
    // Worker 生成的是原始字符串，需要做同样的编码后再比较
    const challengeBytes = new Uint8Array(expectedChallenge.length);
    for (let i = 0; i < expectedChallenge.length; i++) {
      challengeBytes[i] = expectedChallenge.charCodeAt(i);
    }
    const expectedChallengeB64url = bufferToBase64url(challengeBytes.buffer);

    console.log('Challenge compare:', clientData.challenge?.substring(0, 20), 'vs', expectedChallengeB64url?.substring(0, 20));

    if (clientData.challenge !== expectedChallengeB64url) {
      console.log('Challenge mismatch!');
      return false;
    }
    if (clientData.type !== 'webauthn.get') {
      console.log('Type mismatch! Got:', clientData.type);
      return false;
    }

    // 2. 根据公钥类型选择算法（EC 或 RSA）
    const isRSA = publicKeyJwk.kty === 'RSA';
    const keyAlgorithm = isRSA
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };

    const key = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      keyAlgorithm,
      false,
      ['verify'],
    );

    // 3. 构造验证数据：authenticatorData + SHA256(clientDataJSON)
    const authData = base64urlToBuffer(credential.authenticatorData);
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', base64urlToBuffer(credential.clientDataJSON)),
    );

    const verificationData = new Uint8Array(authData.byteLength + clientDataHash.byteLength);
    verificationData.set(new Uint8Array(authData), 0);
    verificationData.set(clientDataHash, authData.byteLength);

    // 4. 验证签名
    const signature = base64urlToBuffer(credential.signature);
    const verifyAlgorithm = isRSA
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' };

    const result = await crypto.subtle.verify(
      verifyAlgorithm,
      key,
      signature,
      verificationData,
    );
    console.log('Passkey verify result:', result);
    return result;
  } catch (err) {
    console.error('Passkey verification error:', err);
    return false;
  }
}
