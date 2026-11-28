# MCP操作対応表

関連Issueは [#387](https://github.com/n624-dev/latex-renderer/issues/387) です。表はコードの対応状況です。各接続先で実際に使えるツールは、サーバーの版・設定、認可、クライアントが取得したツール一覧で確認します。

- **○** は対応、**×** はその名前のツールなし。別の操作で代替できる場合は補足に記載します。
- **Local MCP** はstdioとAPIキーを使います。追加操作は対応サーバーと下表の明示権限が必要です。Project履歴の表示と、独立した別キーで受理したJobへの操作権限は別です。
- **直接Remote MCP** はRendererのOAuthを使います。**公開MCP** はゲートウェイと選択したRendererの両方の認可に従います。公開MCPからRendererに接続するHTTPS方式と外向きエージェント方式は同じカタログを使います。

## 接続・ガイド・環境

| ツール                        | 操作                                   | Local MCP | 直接Remote MCP | 公開MCP | 権限・補足                                                              |
| ----------------------------- | -------------------------------------- | :-------: | :------------: | :-----: | ----------------------------------------------------------------------- |
| `get_profile`                 | 接続中の利用者ID                       |     ×     |       ○        |    ○    | 直接Remoteは利用者ID、公開MCPは接続プロファイルID                       |
| `get_authoring_guide`         | 制作ガイド                             |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Localは同梱版を読む                                |
| `get_renderer_capabilities`   | エンジン・出力・制限・添付対応         |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`（Localの添付取り込みは無効） |
| `list_authoring_profiles`     | 制作プロファイル一覧                   |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `check_packages`              | 指定パッケージの有無                   |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `search_packages`             | パッケージ検索                         |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `check_fonts`                 | 指定フォントの有無                     |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `search_fonts`                | フォント検索                           |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `check_document_requirements` | クラス・パッケージ・フォントの要件確認 |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:create`                              |
| `probe_document_requirements` | 検証用文書を描画して要件確認           |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:create`                            |

## 入力ファイル

| ツール                              | 操作                                        | Local MCP | 直接Remote MCP | 公開MCP | 権限・補足                                                                               |
| ----------------------------------- | ------------------------------------------- | :-------: | :------------: | :-----: | ---------------------------------------------------------------------------------------- |
| `upload_source`                     | ローカルのフォルダーまたはZIPをアップロード |     ○     |       ×        |    ×    | —                                                                                        |
| `create_source`                     | テキスト・小さなファイルからSourceを作成    |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `begin_source_upload`               | ZIPの分割アップロード開始                   |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `upload_source_chunk`               | ZIPのチャンクを送信                         |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `get_source_upload_status`          | アップロード進捗と再開位置                  |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `finalize_source_upload`            | ZIPを検証・確定                             |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `create_source_ref`                 | 別の接続へ渡すSource参照を発行              |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `update_source_file`                | ファイルの追加・更新から新しいSourceを作成  |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `delete_source_file`                | ファイルを除いた新しいSourceを作成          |     ×     |       ○        |    ○    | Remote系 `mcp:render`                                                                    |
| `import_source_attachment`          | チャット添付をSourceに取り込み              |     ×     |       ○        |    ○    | Remote系 `mcp:render`。接続先の添付設定が必要。公開MCPのカタログには設定にかかわらず掲載 |
| `verify_attachment_delivery_origin` | 添付の配布元を確認                          |     ×     |       ○        |    ×    | 直接Remote `mcp:read`。直接Remoteの指定済み検証アカウントのみ                            |

## Project・保存版・共有下書き

| ツール                               | 操作                             | Local MCP | 直接Remote MCP | 公開MCP | 権限・補足                                                                                                 |
| ------------------------------------ | -------------------------------- | :-------: | :------------: | :-----: | ---------------------------------------------------------------------------------------------------------- |
| `list_projects`                      | 保存Project一覧                  |     ○     |       ○        |    ○    | Remote系 `mcp:read`                                                                                        |
| `get_project`                        | Project詳細と保存版一覧          |     ○     |       ○        |    ○    | Remote系 `mcp:read`                                                                                        |
| `create_project`                     | Projectを作成                    |     ○     |       ○        |    ○    | Remote系 `mcp:render`                                                                                      |
| `rename_project`                     | Projectを改名                    |     ○     |       ○        |    ○    | Remote系 `mcp:render`                                                                                      |
| `delete_project`                     | Projectを削除                    |     ○     |       ○        |    ○    | Remote系 `mcp:delete`                                                                                      |
| `attach_project_revision`            | 既存Sourceを保存版にする         |     ○     |       ○        |    ○    | Remote系 `mcp:render`                                                                                      |
| `get_project_revision_jobs`          | 保存版のJob履歴                  |     ○     |       ○        |    ○    | Remote系 `mcp:read`                                                                                        |
| `list_project_revision_files`        | 保存版のファイル一覧             |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:read`                                                           |
| `get_project_revision_file`          | 保存版のテキスト本文             |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:read`                                                           |
| `get_project_revision_downloads`     | 保存版のSource ZIPを取得      |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:read` でZIPをローカル保存。Remote系はZIPと任意のPDFのリンクを返す                      |
| `update_project_file`                | ファイルを更新して次の版を作成   |     ×     |       ○        |    ○    | Remote系 `mcp:render`。Localは共有下書きを編集してから保存可                                               |
| `delete_project_file`                | ファイルを除いて次の版を作成     |     ×     |       ○        |    ○    | Remote系 `mcp:render`。Localは共有下書きから削除してから保存可                                             |
| `open_project_draft`                 | 共有下書きを開く・起点を選ぶ     |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:draft:write`                                                          |
| `get_project_draft`                  | 共有下書きの状態                 |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:draft:read`                                                             |
| `get_project_draft_file`             | 共有下書きのファイル本文         |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:draft:read`                                                             |
| `apply_project_changes`              | 共有下書きを版確認付きで一括変更 |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:draft:write`                                                          |
| `render_project_draft`               | 共有下書きを試し描画             |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Localは `render:create` と `render:draft:write`。共有プレビューの取得は読み取り専用 |
| `save_project_draft`                 | 共有下書きを履歴へ保存           |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:draft:write`                                                          |
| `get_project_document_state`         | 文書条件と採用版                 |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:state:read`                                                      |
| `update_project_document_conditions` | 文書条件を編集                   |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:project:state:write`                                                   |
| `adopt_project_revision`             | 採用する保存版を指定             |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:project:state:write`                                                   |
| `record_project_pdf_review`          | PDFの確認記録を保存              |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:project:state:write`                                                   |
| `list_project_pdf_reviews`           | PDFの確認記録一覧                |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:state:read`                                                      |
| `get_project_storage_usage`          | Projectの保存量                  |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:read`                                                            |
| `protect_project_revision`           | 保存版の保護を設定               |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:create`                                                                |
| `plan_project_revision_cleanup`      | 保存版整理の候補を確認           |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:project:read`                                                            |
| `apply_project_revision_cleanup`     | 確認済みの保存版整理を実行       |     ○     |       ○        |    ○    | Remote系 `mcp:delete`。Local `render:project:delete`                                                        |

## 描画・成果物・プレビュー

| ツール                      | 操作                                               | Local MCP | 直接Remote MCP | 公開MCP | 権限・補足                                                                                    |
| --------------------------- | -------------------------------------------------- | :-------: | :------------: | :-----: | --------------------------------------------------------------------------------------------- |
| `render_project`            | 手元の入力から描画して成果物を直接保存             |     ○     |       ×        |    ×    | —                                                                                             |
| `create_render_job`         | アップロード済みSourceから描画Jobを作るLocalの操作 |     ○     |       ×        |    ×    | Remoteの対応操作は `create_render`                                                            |
| `create_render`             | テキスト・Source等から描画Jobを作るRemoteの操作    |     ×     |       ○        |    ○    | Remote系 `mcp:render`。Localの対応操作は `create_render_job`。再送キーなど引数に差がある      |
| `render_project_revision`   | 保存版を指定して描画                               |     ○     |       ○        |    ○    | Remote系 `mcp:render`                                                                         |
| `get_render_status`         | Jobの状態                                          |     ○     |       ○        |    ○    | Remote系 `mcp:read`                                                                           |
| `retry_render`              | 描画を再試行                                       |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:create`                                                  |
| `retry_svg_render`          | 確定済みPDFを保持してSVGだけ再試行                 |     ○     |       ○        |    ○    | Remote系 `mcp:render`。Local `render:create`                                                  |
| `cancel_render`             | 描画を取り消す                                     |     ○     |       ○        |    ○    | Remote系 `mcp:cancel`                                                                         |
| `delete_render`             | 終了済みJobを削除                                  |     ○     |       ○        |    ○    | Remote系 `mcp:delete`                                                                         |
| `get_render_diagnostics`    | 診断一覧とページング                               |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:read:own`                                                  |
| `read_render_log`           | ログの範囲読み取り                                 |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:read:own`                                                  |
| `get_render_manifest`       | 描画のマニフェスト                                 |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:read:own`。Localの成果物取得は `download_render_artifacts` |
| `get_render_artifacts`      | 成果物情報と取得用参照                             |     ×     |       ○        |    ○    | Remote系 `mcp:read`。Localは `download_render_artifacts` で直接保存                           |
| `download_render_artifacts` | ローカルにPDF・SVG・ログ・指定PNGを保存            |     ○     |       ×        |    ×    | —                                                                                             |
| `get_render_preview`        | 個別のページプレビュー                             |     ×     |       ○        |    ○    | Remote系 `mcp:read`。Localは成果物ダウンロードで指定ページのPNGを保存可                       |
| `get_render_preview_pages`  | 指定ページ群のプレビュー                           |     ×     |       ○        |    ○    | Remote系 `mcp:read`                                                                           |
| `get_render_preview_crop`   | ページの指定領域を拡大                             |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                               |
| `get_render_preview_sheet`  | 複数ページを並べたプレビュー                       |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                               |
| `locate_render_source`      | プレビュー位置に対応するTeXソース候補              |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                               |

## PDF品質検査

| ツール                            | 操作                        | Local MCP | 直接Remote MCP | 公開MCP | 権限・補足                                                                               |
| --------------------------------- | --------------------------- | :-------: | :------------: | :-----: | ---------------------------------------------------------------------------------------- |
| `request_render_quality_report`   | 描画済みPDFの検査を要求     |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                          |
| `get_render_quality_report`       | 描画済みPDFの検査結果       |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                          |
| `compare_render_quality`          | PDF同士の見た目を比較       |     ○     |       ○        |    ○    | Remote系 `mcp:read`。Local `render:pdf:inspect`                                          |
| `request_attached_pdf_inspection` | チャット添付PDFの検査を要求 |     ×     |       ○        |    ○    | Remote系 `mcp:render`。接続先の添付設定が必要。公開MCPのカタログには設定にかかわらず掲載 |
| `get_attached_pdf_inspection`     | 添付PDFの検査結果・領域拡大 |     ×     |       ○        |    ○    | Remote系 `mcp:read`。接続先の添付設定が必要。公開MCPのカタログには設定にかかわらず掲載   |

## リソースと成果物の受け取り

| 操作                                                  | Local MCP | 直接Remote MCP | 公開MCP | 補足                                             |
| ----------------------------------------------------- | :-------: | :------------: | :-----: | ------------------------------------------------ |
| `resources/list` で制作ガイドを列挙                   |     ×     |       ○        |    ○    | Localはガイドツールで取得。                      |
| `resources/templates/list` で成果物テンプレートを取得 |     ×     |       ○        |    ×    | 公開MCPのメソッドは空一覧を返す。                |
| `resources/read` でガイド・認可済み参照を読み取る     |     ×     |       ○        |    ○    | 公開MCPは返却された保護済み参照を使う。          |
| 指定先へ成果物を直接保存                              |     ○     |       ×        |    ×    | Remote系はリソースやダウンロードリンクから取得。 |
| 公開ゲートウェイの短期ダウンロードURL                 |     ×     |       ×        |    ○    | 接続先で許可された成果物が対象。                 |

## 更新手順

ツールの追加・削除、引数・権限、戻り値、リソース、接続方式ごとの制約が変わる変更では、同じPRで該当行と確認基準を更新します。共通機能を **×** から **○** にする場合は、正規の接続経路で登録と実行を確認します。固有機能や代替手順は該当行に残します。

- [Local MCPの登録](../apps/mcp-server/src/server.ts)
- [直接Remote MCPの登録](../apps/remote-mcp/src/mcp.ts)
- [公開MCPの登録](../apps/public-mcp-gateway/src/public-mcp.ts) · [公開ツールの選定](../apps/public-mcp-gateway/src/renderer-dispatch.ts)
- [共通ツール定義](../packages/contracts/src/renderer-mcp-definitions.ts) · [OAuthスコープ](../packages/contracts/src/renderer-mcp.ts)
