import { endpoint, shell } from "./templates-shared.js";

const docsNav = `<nav class="docs-nav" aria-label="ドキュメント内ナビゲーション"><a href="/docs/">はじめに</a><a href="/docs/windows/">Windows</a><a href="/docs/cli/">CLI</a><a href="/docs/integrations/">AI連携</a><a href="/docs/projects/">プロジェクト</a><a href="/docs/troubleshooting/">問題解決</a><a href="/docs/api/">API</a></nav>`;

function docsShell(title: string, intro: string, body: string): string {
  return shell(
    title,
    `${docsNav}<div class="hero docs-hero"><p class="eyebrow">利用ガイド</p><h1>${title}</h1><p>${intro}</p></div>${body}`,
  );
}

export function legacyDocsPage(): string {
  return docsShell(
    "はじめに",
    "APIキーを登録し、最初のPDFを作成するまでの最短手順です。",
    `<section><h2>利用方法を選ぶ</h2><div class="grid"><article><h3><a href="/docs/client/">クライアント</a></h3><p>Windows、Linux、macOSへCLI、MCP、AI向けSkillをまとめて導入します。</p></article><article><h3><a href="/docs/cli/">CLI</a></h3><p>ターミナルから変換、状態確認、キャンセル、成果物取得を行います。</p></article><article><h3><a href="/docs/integrations/">Codex・Claude Code・MCP</a></h3><p>APIキーを会話へ渡さず、ローカルのCLI経由で安全に操作します。</p></article><article><h3><a href="/docs/api/">公開API</a></h3><p>独自アプリケーションからHTTP APIを利用します。</p></article></div></section><section><h2>必要なもの</h2><ul><li>管理者から発行された <code>lrk_</code> で始まるレンダリング用APIキー</li><li>ルートに <code>main.tex</code> があるLaTeXプロジェクト</li><li>Node.js 24以降</li></ul><div class="notice warning"><strong>APIキーを会話、ソースコード、Git、ログへ貼り付けないでください。</strong> 漏えいした可能性がある場合は管理者へ失効と再発行を依頼します。</div></section><section><h2>最短でPDFを作る</h2><ol><li><a href="/downloads/">クライアントをインストール</a>する</li><li>APIキーを標準入力から登録する</li><li>新しいターミナルを開き、プロジェクトを指定する</li></ol><pre><code>latex-render auth status
latex-render render C:\\path\\to\\project --open</code></pre><p>結果はプロジェクト内の <code>.render</code> に保存されます。失敗時は最初に <code>.render/errors.json</code> を確認してください。</p></section>`,
  );
}

export function legacyWindowsDocsPage(): string {
  return docsShell(
    "Windowsクライアント",
    "インストール、APIキー登録、更新、削除の手順です。",
    `<section><h2>インストール</h2><p>PowerShellで次を実行します。配布ZIPのサイズとSHA-256はインストーラーが検証します。</p><pre><code>Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\install-latex-renderer.ps1</code></pre><p>APIキーは画面に表示されない入力欄へ貼り付け、Windows DPAPIで現在のWindowsユーザーに紐づけて保存します。完了後は新しいPowerShellを開きます。</p></section><section><h2>最初の変換</h2><pre><code>latex-render auth status
latex-render render C:\\Users\\you\\Documents\\latex-project --open</code></pre><p><code>--open</code> を付けると成功後にPDFを開きます。成果物は指定したプロジェクトの <code>.render</code> フォルダへ保存されます。</p></section><section><h2>更新</h2><p>インストールコマンドを再実行します。以前のクライアントは日時付きのバックアップフォルダへ移動します。</p></section><section><h2>APIキーだけを削除</h2><pre><code>latex-render auth logout</code></pre></section><section><h2>アンインストール</h2><pre><code>Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\uninstall-latex-renderer.ps1</code></pre><p>既定ではクライアント、保存済みAPIキー、Codex・ClaudeのSkillを削除します。<code>-KeepCredential</code> または <code>-KeepSkills</code> でそれぞれ保持できます。</p></section>`,
  );
}

export function legacyCliDocsPage(): string {
  return docsShell(
    "CLI",
    "実装済みのコマンドと保存される成果物を説明します。",
    `<section><h2>認証</h2><pre><code>$env:LATEX_RENDER_API_KEY | latex-render auth login --api-key-stdin
latex-render auth status
latex-render auth logout</code></pre><p><code>login</code> は標準入力だけを受け付けます。コマンドライン引数へAPIキーを含めないでください。環境変数 <code>LATEX_RENDER_API_KEY</code> が設定されている間は、保存済み資格情報より優先されます。</p></section><section><h2>レンダリング</h2><pre><code>latex-render render [directory] [--open]</code></pre><p>ディレクトリを省略すると現在のフォルダを使います。ルートの <code>main.tex</code> と最大500ファイルを送信し、終了状態まで待ちます。</p></section><section><h2>ジョブ操作</h2><pre><code>latex-render jobs get &lt;jobId&gt;
latex-render jobs cancel &lt;jobId&gt;
latex-render jobs download &lt;jobId&gt; --output .render
latex-render jobs delete &lt;jobId&gt; --yes</code></pre><p>ジョブ操作時はAPIキーで操作用トークンを更新します。削除は終了済みジョブだけが対象です。</p></section><section><h2>成果物</h2><div class="table-wrap"><table><thead><tr><th>パス</th><th>内容</th></tr></thead><tbody><tr><td><code>.render/result.pdf</code></td><td>成功時のPDF</td></tr><tr><td><code>.render/compile.log</code></td><td>コンパイルログ</td></tr><tr><td><code>.render/errors.json</code></td><td>構造化されたエラー</td></tr><tr><td><code>.render/job.json</code></td><td>最終ジョブ状態</td></tr><tr><td><code>.render/previews/page-N.png</code></td><td>最大100ページのプレビュー</td></tr></tbody></table></div></section>`,
  );
}

export function legacyIntegrationsDocsPage(): string {
  return docsShell(
    "Codex・Claude Code・MCP",
    "ローカルに保存した資格情報をCLIとMCPから共通利用します。",
    `<section><h2>Skillの導入</h2><p>共通インストーラーはOSを自動判定し、Codexは <code>~/.agents/skills/latex-renderer</code>、Claude Codeは <code>~/.claude/skills/latex-renderer</code> へSkillを導入します。変更済みの同名Skillは上書きしません。</p></section><section><h2>MCPの登録</h2><pre><code>codex mcp add latex-renderer -- latex-renderer-mcp
claude mcp add --scope user latex-renderer -- latex-renderer-mcp</code></pre><p>MCPツールは <code>render_project</code>、<code>get_render_status</code>、<code>download_render_artifacts</code>、<code>cancel_render</code>、<code>delete_render</code> を提供します。</p></section><section><h2>依頼例</h2><ul><li>「このフォルダの <code>main.tex</code> を確認してレンダリングして」</li><li>「構造化エラーを確認し、該当するTeXだけを修正して再実行して」</li><li>「生成したPDFとページプレビューを確認して」</li></ul></section><section><h2>安全な使い方</h2><div class="notice warning"><strong>APIキーをプロンプト、MCP引数、プロジェクトファイルへ含めないでください。</strong> MCPはCLIの保護された資格情報保存へ処理を委譲します。</div></section>`,
  );
}

export function legacyProjectsDocsPage(): string {
  return docsShell(
    "対応するプロジェクト",
    "送信対象、制限、LuaLaTeX向けの最小構成を説明します。",
    `<section><h2>構成</h2><p>プロジェクトのルートに <code>main.tex</code> が必要です。画像、BibTeXデータ、ローカルのスタイルやクラスファイルは参照関係を保ったまま含めます。</p><pre><code>project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty</code></pre></section><section><h2>日本語の最小例</h2><pre><code>\\documentclass{ltjsarticle}
\\begin{document}
日本語とEnglishを含む文書です。
\\end{document}</code></pre><p>レンダラーはLuaLaTeXを使用します。利用可能なパッケージとフォントは配布環境に依存するため、不足が出た場合は <code>compile.log</code> のメッセージを管理者へ伝えてください。</p></section><section><h2>送信から除外されるもの</h2><p><code>.git</code>、<code>.render</code>、LaTeXが生成した補助ファイルはクライアントが除外します。<code>node_modules</code> など、その他の不要なフォルダはプロジェクト外へ移してから実行してください。シンボリックリンクは受け付けません。</p></section><section><h2>制限</h2><ul><li>最大500ファイル</li><li>ZIP送信サイズは最大20 MiB</li><li>エントリーファイルはプロジェクト直下の <code>main.tex</code></li><li>シェルエスケープと外部コマンド実行は利用不可</li><li>処理時間、保存容量、保持期間には管理者設定の上限あり</li></ul></section>`,
  );
}

export function legacyTroubleshootingDocsPage(): string {
  const entries = [
    [
      "APIキーが無効",
      "保存したキーを latex-render auth logout で削除し、再発行されたキーを登録します。",
    ],
    [
      "APIキーの権限不足",
      "ジョブ作成にはrender:create、状態確認・成果物取得・中止・削除用の短時間トークン更新にはrender:read:ownが必要です。管理者へキーのスコープを確認します。",
    ],
    [
      "ファイルサイズ超過",
      "生成済みPDF、大きな画像、ログ、不要なデータを除外します。",
    ],
    [
      "キュー満杯",
      "少し時間を置いて再試行します。同じAPIリクエストを再送する場合は同じIdempotency-Keyを使います。",
    ],
    [
      "LaTeXコンパイルエラー",
      ".render/errors.jsonを先に読み、ファイル名と行番号を修正します。情報が不足する場合だけcompile.logを確認します。",
    ],
    [
      "タイムアウト",
      "無限ループ、極端に大きな図、重いマクロを確認し、プロジェクトを小さくして再試行します。",
    ],
    [
      "元データの有効期限切れ",
      "古いジョブの再実行ではなく、プロジェクトをもう一度アップロードします。",
    ],
    ["保存容量不足", "不要な終了済みジョブを削除し、反映後に再試行します。"],
    [
      "ネットワークエラー",
      "稼働状況と端末の接続を確認します。作成済みjobIdがある場合は新規作成前に状態を確認します。",
    ],
    [
      "成果物が見つからない",
      "ジョブがsucceededか、成果物名がresult.pdf・compile.log・errors.jsonのいずれかかを確認します。",
    ],
  ];
  return docsShell(
    "問題解決",
    "エラーコード、jobId、構造化エラーを使って原因を切り分けます。",
    `<section><h2>確認する順序</h2><ol><li>CLIの終了メッセージとjobIdを控える</li><li><code>.render/errors.json</code> を確認する</li><li>必要な場合だけ <code>.render/compile.log</code> を確認する</li><li><a href="/status/">稼働状況</a>を確認する</li><li>解決しなければjobIdとエラーコードを管理者へ伝える</li></ol></section><section><h2>代表的な問題</h2>${entries.map(([title, body]) => `<details><summary>${title}</summary><p>${body}</p></details>`).join("")}</section>`,
  );
}

export function legacyApiDocsPage(): string {
  return docsShell(
    "公開API",
    "ジョブ作成、ZIPアップロード、状態確認、成果物取得をHTTPから行います。",
    `<section><h2>利用の流れ</h2><ol><li>ZIPのバイト数とSHA-256を計算する</li><li>APIキーでジョブを作成する</li><li>返されたURLへZIPをアップロードする</li><li>ジョブ状態を確認する</li><li>成果物を取得し、不要になったジョブを削除する</li></ol><p><a href="/openapi/gateway.openapi.yaml">ジョブ作成API仕様</a> / <a href="/openapi/renderer.openapi.yaml">アップロード・結果取得API仕様</a></p></section><section><h2>認証とスコープ</h2><p>ジョブ作成と操作用トークン更新はAPIキー、アップロードとジョブ操作は応答で返された短時間トークンをBearer認証で送ります。</p><pre><code>Authorization: Bearer &lt;TOKEN&gt;</code></pre><ul><li><code>render:create</code>：ジョブ作成</li><li><code>render:read:own</code>：自分のジョブ用短時間トークンの更新。更新したトークンで状態確認、成果物取得、キャンセル、削除を行います。</li></ul></section>${endpoint(
      "POST",
      "/api/v1/render-tickets",
      "ZIPのサイズとSHA-256を送り、jobId、uploadTicket、jobTicket、uploadUrl、expiresAtを取得します。",
      `Authorization: Bearer &lt;API_KEY&gt;
Content-Type: application/json
Idempotency-Key: &lt;16〜200文字&gt;`,
      `{"size":12345,"sha256":"64文字の小文字16進値"}`,
    )}${endpoint("POST", "/api/v1/job-tickets/{jobId}", "APIキーを使い、所有するジョブの操作用トークンを更新します。", `Authorization: Bearer &lt;API_KEY&gt;`)}${endpoint(
      "PUT",
      "/api/v1/jobs/{jobId}/source",
      "uploadUrlへZIPを送信します。Content-Lengthと予約時のサイズ・SHA-256が一致する必要があります。正常時はHTTP 204です。",
      `Authorization: Bearer &lt;UPLOAD_TICKET&gt;
Content-Type: application/zip
Content-Length: &lt;ZIPサイズ&gt;`,
    )}${endpoint("GET", "/api/v1/jobs/{jobId}", "状態、作成・更新日時、エラーコードとメッセージを取得します。", `Authorization: Bearer &lt;JOB_TICKET&gt;`)}${endpoint("POST", "/api/v1/jobs/{jobId}/cancel", "待機中または処理中のジョブへキャンセルを要求します。", `Authorization: Bearer &lt;JOB_TICKET&gt;`)}${endpoint("GET", "/api/v1/jobs/{jobId}/artifacts/{name}", "result.pdf、compile.log、errors.jsonを取得します。存在しない成果物は404です。", `Authorization: Bearer &lt;JOB_TICKET&gt;`)}${endpoint("GET", "/api/v1/jobs/{jobId}/previews/page-1.png", "指定ページのimage/pngプレビューを取得します。", `Authorization: Bearer &lt;JOB_TICKET&gt;`)}${endpoint("DELETE", "/api/v1/jobs/{jobId}", "終了済みジョブを削除対象へ移します。正常時はHTTP 202です。", `Authorization: Bearer &lt;JOB_TICKET&gt;`)}<section><h2>ジョブ状態</h2><div class="table-wrap"><table><thead><tr><th>状態</th><th>意味</th><th>利用者の対応</th></tr></thead><tbody><tr><td>reserved / uploading</td><td>予約済み・アップロード中</td><td>期限内にZIPを送信する</td></tr><tr><td>queued / validating / running</td><td>待機・検証・変換中</td><td>状態を間隔を空けて確認する</td></tr><tr><td>succeeded</td><td>成功</td><td>PDFと必要な成果物を取得する</td></tr><tr><td>failed / timeout / rejected</td><td>失敗・時間超過・受付拒否</td><td>エラー情報を確認して修正する</td></tr><tr><td>canceled</td><td>キャンセル済み</td><td>必要なら新しいジョブを作る</td></tr><tr><td>deleting / deleted / expired</td><td>削除中・削除済み・期限切れ</td><td>必要なら元プロジェクトから再作成する</td></tr></tbody></table></div></section><section><h2>共通エラー</h2><pre><code>{"error":{"code":"ERROR_CODE","message":"説明","requestId":"任意"}}</code></pre><div class="table-wrap"><table><thead><tr><th>HTTP</th><th>意味</th><th>再試行</th></tr></thead><tbody><tr><td>400</td><td>入力、ヘッダー、ZIPが不正</td><td>修正後</td></tr><tr><td>401 / 403</td><td>トークン不正または権限不足</td><td>資格情報確認後</td></tr><tr><td>404 / 410</td><td>ジョブ・成果物なし、元データ期限切れ</td><td>必要なら再作成</td></tr><tr><td>409</td><td>状態またはIdempotency-Key競合</td><td>状態確認後</td></tr><tr><td>429 / 503</td><td>容量、キュー、メンテナンス</td><td>時間を置いて可</td></tr></tbody></table></div></section><section><h2>一連のコード例</h2><details><summary>curl</summary><pre><code>SIZE=$(wc -c &lt; source.zip)
SHA=$(sha256sum source.zip | cut -d' ' -f1)
curl -sS -X POST https://latex-render.n624.jp/api/v1/render-tickets \\
  -H "Authorization: Bearer $LATEX_RENDER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"size":'$SIZE',"sha256":"'$SHA'"}'</code></pre></details><details><summary>PowerShell</summary><pre><code>$zip = Resolve-Path .\\source.zip
$bytes = [IO.File]::ReadAllBytes($zip)
$sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
$headers = @{ Authorization = "Bearer $env:LATEX_RENDER_API_KEY"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$ticket = Invoke-RestMethod -Method Post -Uri https://latex-render.n624.jp/api/v1/render-tickets -Headers $headers -ContentType application/json -Body (@{size=$bytes.Length;sha256=$sha}|ConvertTo-Json)
Invoke-WebRequest -Method Put -Uri $ticket.uploadUrl -Headers @{Authorization="Bearer $($ticket.uploadTicket)"} -ContentType application/zip -InFile $zip</code></pre></details><details><summary>JavaScript / TypeScript</summary><pre><code>const zip = await readFile("source.zip");
const sha256 = createHash("sha256").update(zip).digest("hex");
const response = await fetch("https://latex-render.n624.jp/api/v1/render-tickets", {
  method: "POST",
  headers: { Authorization: "Bearer " + process.env.LATEX_RENDER_API_KEY,
    "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({ size: zip.length, sha256 })
});
const ticket = await response.json();
await fetch(ticket.uploadUrl, { method: "PUT",
  headers: { Authorization: "Bearer " + ticket.uploadTicket, "Content-Type": "application/zip" }, body: zip });</code></pre></details><details><summary>Python</summary><pre><code>data = pathlib.Path("source.zip").read_bytes()
headers = {"Authorization": "Bearer " + os.environ["LATEX_RENDER_API_KEY"], "Idempotency-Key": str(uuid.uuid4())}
ticket = requests.post("https://latex-render.n624.jp/api/v1/render-tickets", headers=headers,
    json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}).json()
requests.put(ticket["uploadUrl"], headers={"Authorization": "Bearer " + ticket["uploadTicket"],
    "Content-Type": "application/zip"}, data=data).raise_for_status()</code></pre></details></section>`,
  );
}
