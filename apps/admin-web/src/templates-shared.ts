const publicNav = `<nav aria-label="メインナビゲーション"><a href="/">ホーム</a><a href="/docs/">使い方</a><a href="/docs/api/">API</a><a href="/downloads/">ダウンロード</a><a href="/status/">稼働状況</a></nav>`;

export function shell(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} | LaTeX Renderer</title><link rel="stylesheet" href="/assets/styles.css"><script data-cfasync="false" src="/assets/site.js"></script></head><body><header class="site-header"><strong><a href="/">LaTeX Renderer</a></strong>${publicNav}<div class="header-meta"><button type="button" class="secondary" data-theme-toggle>表示: システム</button></div></header><main>${body}</main></body></html>`;
}

export function endpoint(
  method: string,
  path: string,
  description: string,
  headers: string,
  request = "",
): string {
  return `<section class="endpoint"><h2><code>${method} ${path}</code></h2><p>${description}</p><pre><code>${headers}</code></pre>${request ? `<h3>リクエスト</h3><pre><code>${request}</code></pre>` : ""}</section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
