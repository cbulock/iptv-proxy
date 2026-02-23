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
      *, *::before, *::after { box-sizing: border-box; }
      body {
        background: #111;
        color: #eee;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        margin: 0;
      }
      .card {
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 8px;
        padding: 2rem;
        width: 100%;
        max-width: 360px;
      }
      h1 { margin: 0 0 1.5rem; font-size: 1.4rem; }
      label { display: block; margin-bottom: .25rem; opacity: .8; font-size: .9rem; }
      input[type="text"], input[type="password"] {
        display: block;
        width: 100%;
        padding: .6rem .75rem;
        margin-bottom: 1rem;
        background: #2a2a2a;
        border: 1px solid #444;
        border-radius: 4px;
        color: #eee;
        font-size: 1rem;
      }
      input:focus { outline: none; border-color: #63e2b7; }
      button {
        width: 100%;
        padding: .75rem;
        background: #63e2b7;
        color: #111;
        border: none;
        border-radius: 4px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled { opacity: .6; cursor: not-allowed; }
      .error { color: #d9534f; margin-bottom: 1rem; font-size: .9rem; min-height: 1.2em; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>IPTV Proxy Admin</h1>
      <div id="error" class="error"></div>
      <label for="username">Username</label>
      <input type="text" id="username" autocomplete="username" />
      <label for="password">Password</label>
      <input type="password" id="password" autocomplete="current-password" />
      <button id="submit" onclick="login()">Sign In</button>
    </div>
    <script>
      async function login() {
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
          const isValidRedirect =
            redirect.startsWith('/') &&
            !redirect.startsWith('//') &&
            !redirect.includes('://');
          window.location.href = isValidRedirect ? redirect : '/admin';
        } catch (e) {
          errorEl.textContent = e.message || 'Login failed';
        } finally {
          btn.disabled = false;
        }
      }
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) login(); });
    </script>
  </body>
</html>`;
}
