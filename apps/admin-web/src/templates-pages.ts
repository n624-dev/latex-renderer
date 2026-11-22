import { escapeHtml, shell } from "./templates-shared.js";
import type { StatusSnapshot } from "./status-probe.js";

export function homePage(): string {
  return shell(
    "ホーム",
    `<div class="hero"><h1>LaTeXをPDFに変換</h1><p>日本語・英語の文書を、画像や参考文献もまとめて変換できます。</p><div class="actions"><a class="button" href="/app/">ブラウザで変換</a><a class="button secondary" href="/downloads/">クライアントをダウンロード</a><a class="button ghost" href="/docs/">使い方を見る</a></div></div><section><h2>利用を始める</h2><p>ブラウザで使う場合は、管理者が用意したアカウントでログインします。<a href="/docs/web/">ブラウザでの使い方</a>、<a href="/docs/mcp/">AI連携</a>、<a href="/docs/api/">API</a>から利用方法を選べます。</p><p>変換に失敗した場合も、ログとエラー情報を確認できます。</p></section>`,
  );
}

export function loginPage(): string {
  return shell(
    "ログイン",
    `<section class="login-panel"><h1>ログイン</h1><p id="login-message" role="alert">ログイン方式を確認しています。</p><div id="login-methods" class="stack"></div><noscript>ログインにはJavaScriptを有効にしてください。</noscript></section><script data-cfasync="false" type="module" src="/assets/login.js"></script>`,
  );
}

export function downloadsPage(
  version: string,
  archiveName: string,
  mcpbName?: string,
): string {
  return shell(
    "ダウンロード",
    `<div class="page-heading"><div><h1>ダウンロード</h1><p>クライアント ${escapeHtml(version)} / Node.js 24 以降</p></div></div>
    <section><h2>CLI をインストール</h2><p>OS に合う手順でインストールし、管理者から受け取った API キーを登録します。</p>
    <div class="actions"><a class="button" href="/docs/windows/">Windows の手順</a><a class="button secondary" href="/docs/client/#linux-macos">Linux・macOS の手順</a></div></section>
    ${mcpbName === undefined ? "" : '<section><h2>Claude Desktop 拡張</h2><p>手元のフォルダを指定して変換するための拡張です。<a href="/docs/mcp/#ローカルファイルを直接扱う">セットアップ手順</a>を参照してください。</p><a class="button secondary" href="/downloads/mcpb/latest.mcpb" download>Claude Desktop拡張を取得</a></section>'}
    <details><summary>配布ファイルを直接取得</summary><div class="actions"><a class="button secondary" href="/downloads/client/install.mjs" download>共通インストーラー</a><a class="button secondary" href="/downloads/client/latest.zip" download>最新版ZIPを取得</a></div><p><a href="/downloads/client/${encodeURIComponent(archiveName)}" download>${escapeHtml(archiveName)}</a>${mcpbName === undefined ? "" : ` / <a href="/downloads/mcpb/${encodeURIComponent(mcpbName)}" download>${escapeHtml(mcpbName)}</a>`}</p></details>`,
  );
}

export function statusPage(status: StatusSnapshot): string {
  const item = (label: string, available: boolean, idle = false) =>
    `<p><span class="status ${available ? "active" : "failed"}">${label}：${idle ? "待機中（アクセス時に起動）" : available ? "応答中" : "停止または確認不可"}</span></p>`;
  return shell(
    "稼働状況",
    `<div class="page-heading"><h1>稼働状況</h1></div><section>${item("Webサイト", true)}${item("API", status.api, status.apiIdle)}${item("レンダリング処理", status.rendering)}${item("ダウンロード", status.downloads)}<p class="muted">最終更新：<time datetime="${escapeHtml(status.checkedAt)}">${escapeHtml(new Date(status.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))}</time></p></section><p>変換できない場合は<a href="/docs/troubleshooting/">問題解決の手順</a>を確認してください。</p>`,
  );
}

export function publicPage404(): string {
  return shell(
    "ページが見つかりません",
    `<section><h1>ページが見つかりません</h1><p>URLを確認するか、<a href="/">ホームへ戻ってください</a>。</p></section>`,
  );
}
