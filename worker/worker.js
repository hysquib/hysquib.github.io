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
  'POSTS_FILE_PATH', 'SITE_FILE_PATH', 'BLOG_URL', 'ALLOWED_USER',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': env.BLOG_URL || 'https://blog.hysquib.cn',
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
          env_configured: missing.length === 0,
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
        return json(parsed, corsHeaders);
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

        // Worker 自行查询当前文件 sha，不依赖前端传入
        const checkRes = await githubFetch(env, `/contents/${env.POSTS_FILE_PATH}?ref=${env.GITHUB_BRANCH}`);
        let currentSha = null;
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          currentSha = checkData.sha;
        }

        const githubBody = {
          message: body.message || 'Update blog posts',
          content: base64Content,
          branch: env.GITHUB_BRANCH,
        };
        if (currentSha) githubBody.sha = currentSha;
        const res = await githubFetch(env, `/contents/${env.POSTS_FILE_PATH}`, 'PUT', githubBody);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }
        return json({ success: true }, corsHeaders);
      }

      // ── API: Get Site Content ────────────────────────────────────────────
      if (url.pathname === '/api/site' && request.method === 'GET') {
        const res = await githubFetch(env, `/contents/${env.SITE_FILE_PATH}?ref=${env.GITHUB_BRANCH}`);
        if (!res.ok) {
          if (res.status === 404) {
            return json({ error: `SITE_FILE_PATH "${env.SITE_FILE_PATH}" not found` }, corsHeaders, 404);
          }
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }
        const data = await res.json();
        const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
        const parsed = JSON.parse(content);
        return json(parsed, corsHeaders);
      }

      // ── API: Save Site Content ───────────────────────────────────────────
      if (url.pathname === '/api/site' && request.method === 'PUT') {
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: 'Unauthorized', reason: result.reason, message: result.message }, corsHeaders, 401);
        }
        const body = await request.json();
        const content = JSON.stringify(body.site, null, 2);
        const base64Content = btoa(unescape(encodeURIComponent(content)));

        // Worker 自行查询当前文件 sha
        const checkRes = await githubFetch(env, `/contents/${env.SITE_FILE_PATH}?ref=${env.GITHUB_BRANCH}`);
        let currentSha = null;
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          currentSha = checkData.sha;
        }

        const githubBody = {
          message: body.message || '更新站点内容',
          content: base64Content,
          branch: env.GITHUB_BRANCH,
        };
        if (currentSha) githubBody.sha = currentSha;
        const res = await githubFetch(env, `/contents/${env.SITE_FILE_PATH}`, 'PUT', githubBody);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return json({ error: err.message || 'GitHub API error' }, corsHeaders, res.status);
        }
        return json({ success: true }, corsHeaders);
      }

      // ── Passkey: Register (begin) ───────────────────────────────────────
      if (url.pathname === '/auth/passkey/register/begin' && request.method === 'POST') {
        // 需要先通过 GitHub 认证才能注册 Passkey
        const token = getBearerToken(request);
        const result = await verifyToken(token, env);
        if (!result.ok) {
          return json({ error: '请先使用 GitHub 登录后再注册通行密钥' }, corsHeaders, 401);
        }

        const challenge = randomString(32);
        const challengeKey = `challenge_register:${result.user}:${challenge}`;

        // 存储 challenge 到 KV，5 分钟过期
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
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }, // RS256
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

        // 验证 challenge
        const challengeKey = `challenge_register:${result.user}:${challenge}`;
        if (env.PASSKEY_KV) {
          const stored = await env.PASSKEY_KV.get(challengeKey);
          if (!stored) {
            return json({ error: '注册请求已过期，请重试' }, corsHeaders, 400);
          }
          await env.PASSKEY_KV.delete(challengeKey);
        }

        // 存储通行密钥
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

        // 检查是否有已注册的通行密钥
        let hasPasskey = false;
        if (env.PASSKEY_KV) {
          const listResult = await env.PASSKEY_KV.list({ prefix: `passkey:${username}:` });
          hasPasskey = listResult.keys.length > 0;
        }

        if (!hasPasskey) {
          return json({ error: '通行密钥登录不可用，请使用 GitHub 登录' }, corsHeaders, 400);
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

        // 验证 challenge
        const challengeKey = `challenge_login:${username}:${challenge}`;
        if (!env.PASSKEY_KV) {
          return json({ error: 'KV 存储未配置' }, corsHeaders, 500);
        }
        const storedUser = await env.PASSKEY_KV.get(challengeKey);
        if (!storedUser) {
          return json({ error: '登录请求已过期，请重试' }, corsHeaders, 400);
        }
        await env.PASSKEY_KV.delete(challengeKey);

        // 获取存储的公钥
        const credKey = `passkey:${username}:${credential.id}`;
        const storedCred = await env.PASSKEY_KV.get(credKey);
        if (!storedCred) {
          return json({ error: '通行密钥未找到，请重新注册' }, corsHeaders, 400);
        }

        // 验证签名（使用 Web Crypto API）
        const credData = JSON.parse(storedCred);
        const verifyResult = await verifyPasskeySignature(
          credential,
          credData.publicKey,
          challenge,
        );

        if (verifyResult !== true) {
          return json({ error: `验证失败：${verifyResult}` }, corsHeaders, 401);
        }

        // 更新计数器
        credData.counter = Math.max(credData.counter || 0, credential.counter || 0) + 1;
        await env.PASSKEY_KV.put(credKey, JSON.stringify(credData));

        // 签发会话 token
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
      console.error('Worker error:', err);
      return json({ error: '服务器内部错误' }, corsHeaders, 500);
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

/**
 * ECDSA 签名格式转换：ASN.1 DER → IEEE P1363 raw (r||s)
 * WebAuthn authenticators 返回 DER 格式，Web Crypto API 只接受 raw 格式
 */
function derToRawSignature(derSig) {
  try {
    // DER structure: 0x30 <len> 0x02 <rLen> <r...> 0x02 <sLen> <s...>
    let offset = 0;
    if (derSig[offset] !== 0x30) return null;
    offset++;
    // Skip outer length (may be > 0x7F, multi-byte)
    if (derSig[offset] & 0x80) offset += 1 + (derSig[offset] & 0x7F);
    else offset++;

    if (derSig[offset] !== 0x02) return null;
    offset++;
    const rLen = derSig[offset]; offset++;
    // Skip leading 0x00 padding (DER pads positive integers with leading 0x00 if high bit set)
    let rOffset = offset;
    let rLenActual = rLen;
    if (derSig[rOffset] === 0x00 && rLen > 1) {
      rOffset++; rLenActual--;
    }
    offset += rLen;

    if (derSig[offset] !== 0x02) return null;
    offset++;
    const sLen = derSig[offset]; offset++;
    let sOffset = offset;
    let sLenActual = sLen;
    if (derSig[sOffset] === 0x00 && sLen > 1) {
      sOffset++; sLenActual--;
    }

    // P-256: r and s are each 32 bytes
    const raw = new Uint8Array(64);
    raw.set(derSig.subarray(rOffset, rOffset + rLenActual), 32 - rLenActual);
    raw.set(derSig.subarray(sOffset, sOffset + sLenActual), 64 - sLenActual);
    return raw;
  } catch {
    return null;
  }
}

/**
 * 验证 Passkey 签名
 * credential: { id, authenticatorData, clientDataJSON, signature, userHandle }
 * publicKeyJwk: 存储的 JWK 公钥
 * expectedChallenge: 服务端生成的 challenge
 */
async function verifyPasskeySignature(credential, publicKeyJwk, expectedChallenge) {
  try {
    // 1. 验证 clientDataJSON 中的 challenge
    const clientDataJSON = new TextDecoder().decode(base64urlToBuffer(credential.clientDataJSON));
    const clientData = JSON.parse(clientDataJSON);

    const challengeBytes = new Uint8Array(expectedChallenge.length);
    for (let i = 0; i < expectedChallenge.length; i++) {
      challengeBytes[i] = expectedChallenge.charCodeAt(i);
    }
    const expectedChallengeB64url = bufferToBase64url(challengeBytes.buffer);

    if (clientData.challenge !== expectedChallengeB64url) {
      return `challenge不匹配 (期望=${expectedChallengeB64url?.substring(0, 15)}..., 实际=${clientData.challenge?.substring(0, 15)}...)`;
    }
    if (clientData.type !== 'webauthn.get') {
      return `类型错误 (期望=webauthn.get, 实际=${clientData.type})`;
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
    let signature = base64urlToBuffer(credential.signature);
    const verifyAlgorithm = isRSA
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' };

    // ECDSA 签名格式转换：WebAuthn 使用 DER 编码，Web Crypto 需要 raw (r||s) 格式
    if (!isRSA) {
      const converted = derToRawSignature(new Uint8Array(signature));
      if (converted) signature = converted.buffer;
    }

    const result = await crypto.subtle.verify(
      verifyAlgorithm,
      key,
      signature,
      verificationData,
    );

    if (result === true) return true;
    return `签名验证失败 (算法=${isRSA ? 'RSA' : 'ECDSA'}, 公钥类型=${publicKeyJwk.kty}, 签名长度=${signature.byteLength})`;
  } catch (err) {
    return `异常: ${err.message}`;
  }
}
