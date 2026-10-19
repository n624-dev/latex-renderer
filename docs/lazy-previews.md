# 必要時のPDFプレビュー生成

新しいRuntimeはPDF完成時に150 DPIの1ページ目だけをPNG化します。
残りは既存の `GET .../jobs/:id/previews/page-n.png` で取得できます。
ページ数上限は100で、PDF・SVGの内容、SHA-256、Job状態や保存期限は変えません。
旧Runtimeと既存Jobの一括生成済みPNGもそのまま利用できます。

## 取得と互換性

- Renderer APIの `previewPageCount`、管理APIの `preview_page_count` は、
  検証済みPDFに固定した総ページ数です。`previews` は**生成済み実体だけ**を返し、
  未生成ページのサイズやchecksumは捏造しません。
- Web/Appと管理画面ではページを選択できます。未生成ページの変換はWorkerが行い、
  HTTPプロセスは短時間待つだけです。12秒以内に完成しなければ
  `503 PREVIEW_PENDING` と `Retry-After: 2` を返します。
  Webは回数を制限して再取得し、完了しなければ再試行を案内します。
- Remote MCPは有効な全ページ番号とPDFの総ページ数を返し、
  `get_render_preview`／preview resourceの明示的取得時だけ生成します。
- CLIの通常ダウンロードとLocal MCPは生成済みPNGだけを保存します。
  `latex-render jobs download JOB --preview-page 2 5`、または
  `download_render_artifacts` の `previewPages: [2, 5]` で追加要求できます。
  取得後に実際の成果物メタデータを再読込し、従来のサイズ・SHA-256照合を行います。
- ZIP取得はその時点の生成済み成果物一式です。全ページを暗黙に生成しません。
  旧クライアントでも既存PDFと生成済みPNGは取得できます。

## 排他・容量・復旧

同じページの要求は永続キューで重複を排除します。待機要求は全体32件・ユーザー8件、
HTTP待機はプロセスごと32件に制限します。失敗は60秒以上空けて最大3回まで再試行可能です。
通常JobとPNG変換は同じDB内で排他し、待機している両者を交互に扱います。
PNG変換は256MiB・swapなし・networkなし・read-only PDFの独立コンテナで実行し、
通常の1GiBレンダリング開始条件を下げることはありません。
小変換でも空きメモリ384MiBと既存のmemory/IO pressure検査が必要です。

1ページにつき最大10MiBかつJobの残り出力予算までをユーザー容量へ予約します。
単一ファイルにはカーネルのfile-size上限も適用します。
作業前にはOSの最低空きに加え、PNG・変換ログ・コピーの3倍とmetadata余裕も確認します。
公開は停止確認・PNG形式/SHA検証後の独立した不変世代をDBへ原子的に登録します。
予約は実際のPNGサイズへ置き換え、PDFと他ページを上書きしません。

タイムアウト／Worker停止時は、lease切れだけで次の変換を開始しません。
旧publisherをfenceし、正確な名前のコンテナ停止を確認してから未公開データを回収します。
Dockerの状態が不明なら、実行中状態と容量予約を残して新規I/Oを止めます。
期限切れ・削除要求のPDFは新規変換できず、処理中も再確認します。
GCは実行中の変換と転送leaseを保護し、Job保存期限後に関連キューも回収します。

## 検証と計測

通常の自動テストは小さなPNG/PDF fixtureで認可、競合、checksum、容量予約、
ENOSPC注入、停止不明、fencing、再起動後回収、PDF・期限不変を検証します。
fixtureの変換成功は実TeXや本番での性能合格とは区別します。

`renderer-image` の `io_benchmark: true` では使い捨てRunner上の
1/10/50/100ページ・PDF/PDF+SVGを比較します。同一PDFで従来の全ページ変換も実行し、
初回と任意ページのPNGをバイト比較します。CPU・時間・メモリ高水位・出力量を記録します。
比較結果が確認されるまでは、一定の高速化率や本番検証完了を主張しません。
詳細は [I/O計測](renderer-io-performance.md) を参照してください。
