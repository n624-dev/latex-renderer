# PDFの先行公開とSVGのみの再試行

PDF-onlyのJobは従来どおり処理します。新しいPDF+SVGのJobでは、PDFと必要な
プレビューを検証してから不変の世代として確定し、その後に別コンテナでSVGを処理します。
SVG側からは確定PDFとSyncTeXを読み取り専用で参照します。

## 状態と互換性

既存のJob `status` は要求した出力全体の成否を表します。新しいJob状態は追加しません。
独立処理対象のJobには任意項目 `stages` が加わります。

- `stages.pdf`: 個別の `status`、`completedAt`、`errorCode`、`errorMessage`、確定PDFの `sha256`。
- `stages.svg`: 個別の `status`、`completedAt`、`errorCode`、`errorMessage`、`attempt`。

PDF成功・SVG失敗ではJob全体は失敗ですが、PDFとプレビューは取得できます。
新しいWeb・CLI・Remote MCPはこの部分成功を区別します。古いクライアントは
個別状態を認識せず、従来どおりJob失敗と表示する場合があります。
旧版で完了したJobには過去の処理を推測したcheckpointを追加しません。

SVG処理中でも、通常の所有者認証とダウンロードleaseを通じて確定PDFを取得できます。
PDFのログは従来の `compile.log` / `errors.json`、SVGのログは
`svg/compile.log` / `svg/errors.json` です。再試行中は前の試行のSVG成果物を隠します。

## SVGのみを再試行する

SVGが失敗・タイムアウト・キャンセルとなり、元Sourceと確定PDFが利用できる間だけ
再試行できます。同じJob IDを使い、PDFの内容・SHA-256・最初の公開時刻を保持します。
初回を含め最大8回です。SVG抽出用のLuaLaTeXは実行しますが、PDF本体の `latexmk` は
実行しません。従来の「Job全体を再実行」は別の新しいJobを作ります。

確定PDFと同じ不変Runtimeで処理します。Runtimeが更新されている場合は
`SVG_RUNTIME_CHANGED` として停止し、Job全体の再実行を案内します。サーバーの更新を
固定したり、削除済みの旧Runtimeを自動取得したりはしません。

- Web: 結果画面の「SVGだけ再試行」。
- CLI: `latex-render jobs retry-svg JOB_ID --output .render`。
- Remote MCP: `retry_svg_render`（`jobId` と16〜200文字の `idempotencyKey`）。
- 公開API: 既存の `POST /api/v1/render-tickets` へ
  `{"retrySvgJobId":"job_..."}` と `Idempotency-Key` を送信。同じJob用ticketを返します。
- Web/Admin API: Job経路配下の `POST .../jobs/JOB_ID/retry-svg`。

応答を取り逃した再送には同じキーを使い、別の試行を開始する場合だけ新しいキーを
使います。読取専用のJob ticketだけで再試行はできません。認可・保守モード・キュー・
容量制限は新規レンダリングと共通です。

`latex-render jobs download JOB_ID --pdf-only` はPDF確定まで待ってから取得します。
通常の `jobs download` は従来どおりJob全体の終了を待ちます。SVG失敗の場合でも
PDFを保存し、SVGの診断は別ファイルに保存します。ローカル成果物は従来の
一式の原子的な切替・復旧方式を維持します。

## 公開・保持・障害時

Source ZIP、確定PDF、SyncTeXのハッシュを照合します。SVGマニフェストの `document` に
Job ID、Source/PDFのSHA-256、entrypoint、SVG試行番号を付記します。
SVG本体とmanifestの検証や外部参照の禁止は緩めません。

完成した世代を移動し、同じDBトランザクションで所有leaseと世代を再確認して成果物を
登録します。未確定世代は公開しません。SVGの失敗、OOM、時間超過、キャンセル、
lease喪失は確定PDFを上書きしません。停止を確認できないコンテナの作業領域は
消さず復旧処理へ引き継ぎます。

保持期限はPDFの最初の確定時刻から数え、再試行で延ばしません。期限切れ・削除処理と
ダウンロードleaseの保護を維持します。旧試行の世代も使用量へ含め、Jobの出力上限と
試行数上限を回避できないようにします。

この機能はフォントの変更やメモリ上限の引上げを必要としません。PDF本体とSVG抽出用の
複数TeXパス間の参照一致を新たに保証する機能ではありません。
