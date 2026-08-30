import { escapeHtml } from "./templates-shared.js";

const links = [
  ["render", "PDFに変換", "/app/"],
  ["history", "履歴", "/app/history/"],
  ["projects", "プロジェクト", "/app/projects/"],
  ["environment", "レンダリング環境", "/app/environment/"],
];

function appHeader(page: string): string {
  return `<header class="site-header"><strong><a href="/app/">LaTeX Renderer</a></strong><nav class="admin-nav" aria-label="アプリナビゲーション">${links.map(([id, label, url]) => `<a href="${url}"${id === page ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav><div class="header-meta"><a id="admin-link" class="button secondary" href="/admin/" hidden>管理</a><button type="button" class="secondary" data-theme-toggle>表示: システム</button><button id="app-logout" type="button" class="secondary">ログアウト</button></div></header>`;
}

function shell(page: string, title: string, content: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} | LaTeX Renderer</title><link rel="stylesheet" href="/app/assets/styles.css"><script data-cfasync="false" src="/app/assets/site.js"></script></head><body data-app-page="${escapeHtml(page)}">${appHeader(page)}<main><p id="app-error" role="alert"></p><p id="app-status" role="status" aria-live="polite"></p>${content}</main><script data-cfasync="false" type="module" src="/app/assets/app.js"></script></body></html>`;
}

export function appRenderPage(): string {
  return shell(
    "render",
    "PDFに変換",
    `<div class="hero render-hero"><h1>LaTeXをPDFに変換</h1><p>TeXファイルまたはZIPを選ぶだけで変換できます。</p></div><section><form id="app-render-form" class="stack"><label class="file-picker drop-zone" id="app-drop-zone" for="app-files"><strong>TeX / ZIPをここにドロップ</strong><span>またはクリックしてファイルを選択（最大20 MiB）</span><input id="app-files" type="file" accept=".zip,.tex,application/zip" multiple required></label><label>保存先<select id="app-project-select"><option value="">新しいプロジェクト</option></select></label><label id="app-project-name-field">新しいプロジェクト名<input id="app-project-name" maxlength="200" placeholder="ファイル名から自動入力"></label><div id="app-entrypoints" class="stack" hidden></div><label><input id="app-render-svg" type="checkbox"> 数式とTikZをSVGでも出力</label><div class="actions"><button id="app-render-start" type="submit" disabled>PDFに変換</button></div></form></section><section id="app-render-results" hidden><h2>変換状況</h2><div id="app-render-items" class="stack"></div></section><section><h2>最近の変換</h2><div id="app-recent-jobs">読み込み中…</div></section>`,
  );
}

export function appHistoryPage(): string {
  return shell(
    "history",
    "変換履歴",
    `<div class="hero"><h1>変換履歴</h1><p>保存期間内のPDFやログを開けます。</p></div><section><div id="app-history">読み込み中…</div></section>`,
  );
}

export function appProjectsPage(): string {
  return shell(
    "projects",
    "プロジェクト",
    `<div class="hero"><h1>プロジェクト</h1><p>文書ごとの改訂と変換履歴を確認できます。</p></div><section><form id="app-project-create" class="inline-form"><label>新しいプロジェクト名<input name="displayName" maxlength="200" required></label><button type="submit">作成</button></form></section><section><div id="app-projects">読み込み中…</div></section>`,
  );
}

export function appProjectPage(): string {
  return shell(
    "projects",
    "プロジェクト詳細",
    `<div id="app-project-detail">読み込み中…</div>`,
  );
}

export function appJobPage(): string {
  return shell(
    "history",
    "変換結果",
    `<div id="app-job-detail">読み込み中…</div>`,
  );
}

export function appEnvironmentPage(): string {
  return shell(
    "environment",
    "レンダリング環境",
    `<div class="hero"><h1>レンダリング環境</h1><p>利用できるエンジン、パッケージ、フォントを事前に確認できます。</p></div><section id="app-environment-summary">読み込み中…</section><div class="grid"><section><h2>パッケージを確認</h2><form id="app-package-search" class="inline-form"><label>名前<input name="query" maxlength="100" placeholder="tikz" required></label><button type="submit">検索</button></form><div id="app-package-results"></div></section><section><h2>フォントを確認</h2><form id="app-font-search" class="inline-form"><label>名前<input name="query" maxlength="100" placeholder="Harano Aji" required></label><button type="submit">検索</button></form><div id="app-font-results"></div></section></div>`,
  );
}
