/**
 * Mode C browser pages after /oauth/callback.
 * Visual shell mirrors qobrix-crm-mcp-oauth login-page.ts (duplicated CSS —
 * no cross-repo import).
 */

const SHELL_CSS = `
    :root {
      --bg: #f8fafc;
      --overlay: rgba(0,0,0,.45);
      --card: #ffffff;
      --fg: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --ring: #6366f1;
      --err: #dc2626;
      --err-bg: #fef2f2;
      --err-border: #fecaca;
      --ok: #0a7a3e;
      --ok-bg: #f0fdf4;
      --ok-border: #bbf7d0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      color: var(--fg);
      background:
        linear-gradient(var(--overlay), var(--overlay)),
        radial-gradient(1200px 600px at 50% -10%, #c7d2fe 0%, transparent 55%),
        var(--bg);
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12);
    }
    .header { text-align: center; margin-bottom: 1.5rem; }
    .logo { display: block; width: 40px; height: 40px; margin: 0 auto 1rem; object-fit: contain; }
    h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; margin: 0 0 0.35rem; }
    .subtitle { margin: 0; color: var(--muted); font-size: 0.925rem; line-height: 1.45; }
    .client-brand {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
      margin-top: 0.65rem; font-size: 0.95rem; font-weight: 600; color: var(--fg);
    }
    .client-brand img {
      width: 28px; height: 28px; border-radius: 6px; object-fit: contain;
      background: #fff; border: 1px solid var(--border);
    }
    .body { display: flex; flex-direction: column; gap: 1rem; }
    .alert {
      display: flex; gap: 0.5rem; align-items: flex-start;
      padding: 0.75rem; border-radius: 0.5rem;
      font-size: 0.875rem; line-height: 1.35;
    }
    .alert .icon { width: 1rem; height: 1rem; flex-shrink: 0; margin-top: 0.1rem; }
    .alert-ok {
      background: var(--ok-bg); border: 1px solid var(--ok-border); color: var(--ok);
    }
    .alert-err {
      background: var(--err-bg); border: 1px solid var(--err-border); color: var(--err);
    }
    .hint { margin: 0; color: var(--muted); font-size: 0.8rem; line-height: 1.45; text-align: center; }
    .btn {
      width: 100%; height: 2.75rem; border-radius: 0.5rem; border: 0;
      font-size: 0.95rem; font-weight: 600; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
    }
    .btn-primary {
      color: #fff;
      background: linear-gradient(90deg, #4f46e5, #9333ea);
      box-shadow: 0 10px 20px rgba(99, 102, 241, 0.25);
    }
    .btn-primary:hover { background: linear-gradient(90deg, #4338ca, #7e22ce); }
`;

const HEADER = `
    <div class="header">
      <img class="logo" src="https://humaticai.com/logo.png" alt="HumaticAI" width="40" height="40" />
      <h1>__TITLE__</h1>
      <p class="subtitle">__SUBTITLE__</p>
      <div class="client-brand">
        <img src="https://framerusercontent.com/images/WxaZNtyO1nDu7UmyK648dCQqg.png?scale-down-to=512&amp;width=1000&amp;height=1000" alt="" width="28" height="28" />
        <span>Qobrix Real Estate CRM</span>
      </div>
    </div>
`;

const CLOSE_SCRIPT = `
<script>
(function () {
  var btn = document.getElementById("close-btn");
  var hint = document.getElementById("close-hint");
  if (!btn) return;
  btn.addEventListener("click", function () {
    window.close();
    if (hint) hint.hidden = false;
  });
})();
</script>
`;

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] || c)
  );
}

function shellPage(opts: {
  title: string;
  h1: string;
  subtitle: string;
  bodyHtml: string;
}): string {
  const header = HEADER.replace("__TITLE__", escapeHtml(opts.h1)).replace(
    "__SUBTITLE__",
    escapeHtml(opts.subtitle)
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <style>${SHELL_CSS}</style>
</head>
<body>
  <main class="card">
    ${header}
    <div class="body">
      ${opts.bodyHtml}
      <button type="button" class="btn btn-primary" id="close-btn">Close</button>
      <p class="hint" id="close-hint" hidden>If this window does not close, close it manually and return to the chat.</p>
    </div>
  </main>
  ${CLOSE_SCRIPT}
</body>
</html>`;
}

/** Successful Mode C callback — vault written. */
export function successHtml(subject?: string): string {
  const who =
    subject && subject.trim()
      ? `<p class="hint">Session subject ${escapeHtml(subject.slice(0, 12))}…</p>`
      : "";
  return shellPage({
    title: "Connected — HumaticAI",
    h1: "Connected",
    subtitle: "Authorization completed",
    bodyHtml: `
      <div class="alert alert-ok" role="status">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>You can close this window and return to the chat to continue.</span>
      </div>
      ${who}`,
  });
}

/** Failed Mode C callback or /connect error. */
export function errorHtml(message: string): string {
  return shellPage({
    title: "Authorization failed — HumaticAI",
    h1: "Authorization failed",
    subtitle: "Something went wrong while connecting to Qobrix",
    bodyHtml: `
      <div class="alert alert-err" role="alert">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escapeHtml(message)}</span>
      </div>
      <p class="hint">Return to the chat and try Sign In again.</p>`,
  });
}
