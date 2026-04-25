/**
 * Returns the HTML for the standalone admin login page.
 * Kept as a module so it can be unit-tested independently.
 */
export function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IPTV Proxy Admin – Sign In</title>
      <style>
        :root {
          --bg: #0f0e0c;
          --surface: #161512;
          --surface-raised: #1d1c19;
          --fg: #f3f1ec;
          --fg-muted: #b8b3a2;
          --fg-subtle: #878273;
          --border: #2c2a26;
          --accent: #e07d2c;
          --accent-hover: #ec9f59;
          --danger: #b91c1c;
          --success: #7ac74f;
          --font-sans: "Mona Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        }
        *, *::before, *::after { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          color: var(--fg);
          font-family: var(--font-sans);
          background:
            radial-gradient(circle at top, rgba(224, 125, 44, 0.12), transparent 30%),
            linear-gradient(180deg, rgba(243, 241, 236, 0.02), transparent 35%),
            var(--bg);
        }
        .shell {
          width: 100%;
          max-width: 440px;
        }
        .eyebrow {
          display: inline-flex;
          margin-bottom: 12px;
          padding-left: 10px;
          border-left: 2px solid var(--accent);
          color: var(--fg);
          font-size: 13px;
          font-weight: 600;
          line-height: 1.3;
        }
        .card {
          background: rgba(22, 21, 18, 0.96);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 28px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 18px;
        }
        .mark {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          background: linear-gradient(135deg, #c2410c 0%, #7a2a09 100%);
          color: #fff;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.1;
        }
        .lede {
          margin: 10px 0 0;
          color: var(--fg-muted);
          font-size: 14px;
          line-height: 1.55;
        }
        form {
          margin-top: 22px;
        }
        label {
          display: block;
          margin-bottom: 6px;
          color: var(--fg-muted);
          font-size: 12px;
          font-family: var(--font-mono);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        input[type="text"], input[type="password"] {
          display: block;
          width: 100%;
          height: 40px;
          margin-bottom: 16px;
          padding: 0 12px;
          background: var(--surface-raised);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--fg);
          font: inherit;
        }
        input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(224, 125, 44, 0.18);
        }
        button {
          width: 100%;
          height: 40px;
          padding: 0 16px;
          background: var(--accent);
          color: #fff;
          border: 1px solid var(--accent);
          border-radius: 4px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.005em;
          cursor: pointer;
          transition: background 150ms cubic-bezier(0.2, 0, 0, 1), border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        button:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
        button:disabled { opacity: .6; cursor: not-allowed; }
        .error {
          color: var(--danger);
          margin-bottom: 16px;
          min-height: 1.2em;
          font-size: 13px;
        }
        .meta {
          margin-top: 18px;
          color: var(--fg-subtle);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
      </style>
  </head>
  <body>
    <div class="shell">
      <div class="eyebrow">AUTH · ADMIN</div>
      <div class="card">
        <div class="brand">
          <div class="mark">IP</div>
          <div>
            <h1>IPTV Proxy Admin</h1>
            <p class="lede">Sign in to manage sources, mappings, backups, and live channel health.</p>
          </div>
        </div>
      <div id="error" class="error"></div>
      <form id="loginForm" onsubmit="login(event)">
        <label for="username">Username</label>
        <input type="text" id="username" autocomplete="username" />
        <label for="password">Password</label>
        <input type="password" id="password" autocomplete="current-password" />
        <button id="submit" type="submit">Sign In</button>
      </form>
        <div class="meta">session auth · local control surface</div>
      </div>
    </div>
    <script>
      async function login(e) {
        if (e) e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('error');
        const btn = document.getElementById('submit');
        errorEl.textContent = '';
        btn.disabled = true;
        try {
          const r = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });
          const j = await r.json();
          if (!r.ok) {
            errorEl.textContent = j.error || 'Login failed';
            return;
          }
          const params = new URLSearchParams(window.location.search);
          const redirect = params.get('redirect') || '/admin';
          // Validate redirect to prevent open redirect attacks (must be same-origin relative path)
          const safeRedirect =
            redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.includes('://')
              ? redirect
              : '/admin';
          window.location.href = safeRedirect;
        } catch (e) {
          errorEl.textContent = e.message || 'Login failed';
        } finally {
          btn.disabled = false;
        }
      }
    </script>
  </body>
</html>`;
}
