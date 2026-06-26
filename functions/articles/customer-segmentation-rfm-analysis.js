/**
 * Cloudflare Pages Function — server-side password gate
 * Route: /articles/customer-segmentation-rfm-analysis
 *
 * GET  (no cookie)  → return login page
 * GET  (valid cookie) → call next() → serve actual Astro page
 * POST (correct pw)  → set HttpOnly cookie, redirect to GET
 * POST (wrong pw)    → return login page with error
 */

const CORRECT_HASH = "3912b8eb4f96c22c9157a0757f2e3b10b6c9ab26c24bf6e1a8363a213b4a7950";
const COOKIE_NAME  = "rfm_auth";
const COOKIE_VALUE = "granted";

// ── helpers ──────────────────────────────────────────────────────────────────

async function sha256hex(str) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v ?? "";
  }
  return null;
}

function loginPage(errorMsg = "") {
  const error = errorMsg
    ? `<p class="error">${errorMsg}</p>`
    : `<p class="hint">This content is restricted.</p>`;

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Required · Christine Cheong</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100svh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f1117;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #e8eaf0;
      padding: 24px;
    }
    .card {
      background: #181c2a;
      border: 1px solid #2a2f45;
      border-radius: 16px;
      padding: 44px 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 48px rgba(0,0,0,.45);
    }
    .lock { font-size: 44px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 10px; }
    .hint { font-size: 15px; color: #8b93b0; line-height: 1.6; margin-bottom: 28px; }
    .error { font-size: 14px; color: #f87171; margin-bottom: 24px; }
    .row { display: flex; gap: 10px; }
    input[type="password"] {
      flex: 1;
      padding: 11px 14px;
      background: #0f1117;
      border: 1px solid #2a2f45;
      border-radius: 8px;
      color: #e8eaf0;
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: border-color .2s;
    }
    input[type="password"]:focus { border-color: #5b7cf6; }
    button {
      padding: 11px 22px;
      background: #5b7cf6;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      white-space: nowrap;
      transition: opacity .2s;
    }
    button:hover { opacity: .85; }
    .back { display: inline-block; margin-top: 24px; font-size: 13px; color: #8b93b0; text-decoration: none; transition: color .2s; }
    .back:hover { color: #5b7cf6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="lock">🔒</div>
    <h1>Password Required</h1>
    ${error}
    <form method="POST">
      <div class="row">
        <input type="password" name="password" placeholder="Enter password" autocomplete="current-password" autofocus />
        <button type="submit">Unlock</button>
      </div>
    </form>
    <a href="/articles" class="back">← All Articles</a>
  </div>
</body>
</html>`,
    {
      status: errorMsg ? 403 : 401,
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    }
  );
}

// ── main handler ─────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, next } = context;
  const method = request.method.toUpperCase();

  // ── POST: verify password ─────────────────────────────────────────────────
  if (method === "POST") {
    let password = "";
    try {
      const formData = await request.formData();
      password = (formData.get("password") || "").trim();
    } catch {
      return loginPage("Could not read form data.");
    }

    const hash = await sha256hex(password);

    if (hash !== CORRECT_HASH) {
      return loginPage("Incorrect password. Please try again.");
    }

    // Correct — set cookie and redirect back to GET
    const url = new URL(request.url);
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname,
        "Set-Cookie": [
          `${COOKIE_NAME}=${COOKIE_VALUE}`,
          "Path=/articles/customer-segmentation-rfm-analysis",
          "HttpOnly",
          "SameSite=Strict",
          "Secure",
          "Max-Age=28800",   // 8 hours
        ].join("; "),
      },
    });
  }

  // ── GET: check cookie ─────────────────────────────────────────────────────
  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie === COOKIE_VALUE) {
    return next(); // authenticated — serve the Astro page
  }

  return loginPage();
}
