import { escapeHtml, shell } from "./templates-shared.js";
import type { StatusSnapshot } from "./status-probe.js";

export function homePage(): string {
  return shell(
    "ホーム",
    `<div class="hero"><p class="eyebrow">LaTeX文書のPDF変換</p><h1>LaTeXをPDFに変換</h1><p>日本語・英語のLaTeXプロジェクトを、ブラウザ、Windows・Linux・macOSクライアント、CLI、Codex、Claude CodeなどからPDFへ変換できます。</p><div class="actions"><a class="button" href="/app/">ブラウザで変換</a><a class="button secondary" href="/downloads/">クライアントをダウンロード</a><a class="button ghost" href="/docs/">使い方を見る</a></div></div><section><h2>できること</h2><div class="grid"><article><h3>プロジェクトをまとめて変換</h3><p>画像、参考文献、スタイルファイルを含むプロジェクトからPDFを作成します。</p></article><article><h3>日本語文書に対応</h3><p>LuaLaTeXを利用した日本語・英語の文書を処理します。</p></article><article><h3>エラーを確認</h3><p>失敗した場合は、ログと整理されたエラー情報を取得できます。</p></article><article><h3>複数の利用方法</h3><p>ブラウザ、各OSのCLI、API、AIツール向け連携から利用できます。</p></article></div></section><section><h2>ブラウザで始める</h2><ol><li>管理者から利用者として招待を受ける</li><li>Webアプリへログインする</li><li>TeXまたはZIPを選んで変換する</li></ol></section>`,
  );
}

export function loginPage(): string {
  return shell(
    "ログイン",
    `<section class="login-panel"><h1>ログイン</h1><p id="login-message" role="alert"></p><form id="password-login" class="stack" hidden><label>ログイン名<input name="loginName" autocomplete="username" required minlength="3" maxlength="64" autofocus></label><label>パスワード<input name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="1024"></label><button type="submit">ログイン</button></form><button id="external-login" type="button" hidden>ログインを続ける</button></section><script data-cfasync="false" type="module" src="/assets/login.js"></script>`,
  );
}

export function downloadsPage(
  version: string,
  archiveName: string,
  mcpbName?: string,
): string {
  return shell(
    "ダウンロード",
    `<div class="hero"><p class="eyebrow">クロスプラットフォームクライアント ${escapeHtml(version)}</p><h1>ダウンロード</h1><p>Windows、Linux、macOSとNode.js 24以降に対応しています。OSを自動判定してCLI、MCP、AI向けSkillを導入します。</p><div class="actions"><a class="button" href="/downloads/client/install.mjs" download>共通インストーラーを取得</a><a class="button secondary" href="/downloads/client/latest.zip" download>最新版ZIPを取得</a>${mcpbName === undefined ? "" : `<a class="button ghost" href="/downloads/mcpb/latest.mcpb" download>Claude Desktop拡張を取得</a>`}</div></div><section><h2>Linux / macOS</h2><pre><code>curl -fsSLo /tmp/install-latex-renderer.mjs https://latex-render.n624.jp/downloads/client/install.mjs
node /tmp/install-latex-renderer.mjs</code></pre></section><section><h2>Windows</h2><pre><code>Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-latex-renderer.ps1</code></pre><p>PowerShell用入口も同じNodeインストーラーを利用し、APIキーをWindows DPAPIで暗号化して保存します。</p></section><section><h2>最初の変換</h2><pre><code>latex-render auth status
latex-render render /path/to/project</code></pre></section><section><h2>更新・診断・削除</h2><pre><code>latex-render setup
latex-render doctor --json
latex-render setup remove --yes</code></pre><p>管理状態を確認できる設定だけを更新・修復・削除します。変更されたSkill、既存コマンド、別のMCP登録は上書き・削除しません。詳しくは<a href="/docs/client/">クライアントの手順</a>を確認してください。</p></section><section><h2>手動ダウンロード</h2><p>配布ファイル：<a href="/downloads/client/${encodeURIComponent(archiveName)}" download>${escapeHtml(archiveName)}</a>${mcpbName === undefined ? "" : ` / <a href="/downloads/mcpb/${encodeURIComponent(mcpbName)}" download>${escapeHtml(mcpbName)}</a>`}</p></section>`,
  );
}

export function statusPage(status: StatusSnapshot): string {
  const item = (label: string, available: boolean) =>
    `<p><span class="status ${available ? "active" : "failed"}">${label}：${available ? "応答中" : "停止または確認不可"}</span></p>`;
  return shell(
    "稼働状況",
    `<div class="hero"><p class="eyebrow">サービス情報</p><h1>稼働状況</h1><p>利用者向け機能の応答をその場で確認しています。</p></div><section>${item("Webサイト", true)}${item("API", status.api)}${item("レンダリング処理", status.rendering)}${item("ダウンロード", status.downloads)}<p class="muted">最終更新：<time datetime="${escapeHtml(status.checkedAt)}">${escapeHtml(new Date(status.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))}</time></p></section><section><h2>変換できない場合</h2><ol><li>APIキーを確認する</li><li>少し時間を置いて再実行する</li><li>ジョブIDとエラーコードを管理者へ伝える</li></ol></section>`,
  );
}

export function publicPage404(): string {
  return shell(
    "ページが見つかりません",
    `<section><h1>ページが見つかりません</h1><p>URLを確認するか、<a href="/">ホームへ戻ってください</a>。</p></section>`,
  );
}
