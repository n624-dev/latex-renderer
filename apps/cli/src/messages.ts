import { setupDiagnosticCatalog } from "@latex-renderer/setup-core";
import type { ClientCoreEvent } from "@latex-renderer/client-core";
import {
  terminalDisplayLocale,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";

const english = {
  configuredIntegration: "Configured: {item}",
  preservedIntegration: "Preserved: {item}",
  sourceUploaded: "Source {id} uploaded.",
  sourceReused: "Source {id} reused.",
  projectDeleted: "{id} deleted.",
  renderEnded: "Render ended with {status}",
  inputUploaded: "{id} uploaded.",
  inputReused: "{id} reused.",
  jobReserved: "reserved",
  jobUploading: "uploading",
  jobWaiting: "queued",
  jobValidating: "validating",
  jobRunning: "running",
  jobSucceeded: "succeeded",
  jobFailed: "failed",
  jobTimeout: "timeout",
  jobCanceled: "canceled",
  jobRejected: "rejected",
  jobDeleting: "deleting",
  jobDeleted: "deleted",
  jobExpired: "expired",
  cancelRequested: "Cancel requested for {id}.",
  deleteRequested: "Delete requested for {id}.",
  jobQueued: "Job {id} queued.",
  downloadComplete: "Artifacts downloaded to {directory}.",
  setupStatus: "Setup status: {status}",
  repairedItems: "Repaired {count} managed item(s).",
  preservedItems: "Preserved {count} unowned or modified item(s).",
  setupGuiCannotBeCombinedWith: "setup --gui cannot be combined with --json",
  setupGuiCannotBeCombinedWith2:
    "setup --gui cannot be combined with --api-key-stdin",
  credentialStored: "Credential stored.",
  credentialIsConfigured: "Credential is configured.",
  connectionStatus: "Connection origin: {origin}\nCredential source: {source}",
  noCredentialSource: "none",
  credentialRemoved: "Credential removed.",
  svgRetrySucceededOriginalPdfRetained:
    "SVG retry succeeded; original PDF retained.",
  partialSuccessOriginalPdfRetainedSvg:
    "Partial success: original PDF retained; SVG retry failed.",
  specifyEitherAProjectPathOr:
    "Specify either a project path or --source, not both",
  thePackageLauncherMustSupplyAbsolute:
    "The package launcher must supply absolute paths",
  inputIsNotARenderApi: "Input is not a render API key",
  compileADocumentN624LatexMain: "Compile a document: n624-latex main.tex",
  projectDirectoryOrZip: "project directory or ZIP",
  writeOneStructuredJsonResultTo: "write one structured JSON result to stdout",
  compileATexDocumentWithThis: "compile a TeX document with this engine",
  writeThePdfToThisPath: "write the PDF to this path",
  runN624LatexSetupToConfigure:
    "Run n624-latex setup to configure the renderer client",
  removeTheStoredApiKey: "remove the stored API key",
  installOrUpdateTheManagedCross:
    "install or update the managed cross-platform client",
  clientDistributionBaseUrl: "client distribution base URL",
  managedInstallationDirectory: "managed installation directory",
  commandLauncherDirectory: "command launcher directory",
  storeARenderApiKeyRead: "store a render API key read from standard input",
  openTheLoopbackOnlyLocalSetup: "open the loopback-only Local Setup Web UI",
  skillTarget: "skill target",
  mcpTarget: "MCP target",
  configureAiIntegrationsForAWinget:
    "configure AI integrations for a WinGet or Homebrew installation",
  thisCommandIsForWingetOr:
    "This command is for WinGet or Homebrew installations",
  inspectTheManagedClientWithoutChanging:
    "inspect the managed client without changing it",
  repairOnlySettingsOwnedByThis:
    "repair only settings owned by this installation",
  removeTheManagedClientAndOwned:
    "remove the managed client and owned integrations",
  confirmRemoval: "confirm removal",
  keepTheStoredRenderApiKey: "keep the stored render API key",
  keepInstalledCodexAndClaudeSkills: "keep installed Codex and Claude skills",
  managedClientIsNotInstalled: "Managed client is not installed.",
  diagnoseRuntimeInstallationCredentialSkillAnd:
    "diagnose runtime, installation, credential, Skill, and MCP setup",
  reuseAnUploadedSource: "reuse an uploaded Source",
  texEntrypoint: "TeX entrypoint",
  outputDirectory: "output directory",
  alsoExportEachOutermostMathAnd:
    "also export each outermost math and TikZ object as SVG",
  openThePdfAfterSuccess: "open the PDF after success",
  pdfWasSavedButOpeningIt:
    "PDF was saved, but opening it failed. Open the saved PDF manually.",
  manageSavedProjectsSharedWithWeb:
    "manage saved Projects shared with Web and MCP",
  revisionDisplayName: "revision display name",
  usePdfAndSvgAsInitial: "use PDF and SVG as initial output defaults",
  queueAJobForAnExact: "queue a Job for an exact saved revision",
  usePdfAndSvgInsteadOf: "use PDF and SVG instead of the revision defaults",
  uploadALocalSourceAndAttach:
    "upload a local Source and attach an immutable Project revision",
  downloadTheCommittedPdfWithoutWaiting:
    "download the committed PDF without waiting for SVG",
  generateSelectedPreviewPages1100:
    "generate selected preview pages (1..100), not every page",
  thisInstallationDoesNotContainThe:
    "This installation does not contain the Admin CLI.",
  partialSuccessPdfAndPreviewsWere:
    "Partial success: PDF and previews were saved. SVG failed; use jobs retry-svg to retry SVG without recompiling the PDF.",
} as const;
type Message = keyof typeof english;
type Catalog = Readonly<Record<Message, string>>;
const locale = terminalDisplayLocale(process.env);
const select: Partial<Record<DisplayLocale, () => Catalog>> = {
  ja: () => ({
    configuredIntegration: "設定済み：{item}",
    preservedIntegration: "保持：{item}",
    sourceUploaded: "入力 {id} をアップロードしました。",
    sourceReused: "入力 {id} を再利用しました。",
    projectDeleted: "プロジェクト {id} を削除しました。",
    renderEnded: "変換が終了しました（{status}）。",
    inputUploaded: "入力 {id} をアップロードしました。",
    inputReused: "入力 {id} を再利用しました。",
    jobReserved: "予約済み",
    jobUploading: "送信中",
    jobWaiting: "待機中",
    jobValidating: "確認中",
    jobRunning: "変換中",
    jobSucceeded: "変換成功",
    jobFailed: "変換失敗",
    jobTimeout: "時間切れ",
    jobCanceled: "中止",
    jobRejected: "受付不可",
    jobDeleting: "削除中",
    jobDeleted: "削除済み",
    jobExpired: "保存期限切れ",
    cancelRequested: "{id}：中止を要求しました。",
    deleteRequested: "{id}：削除を要求しました。",
    jobQueued: "ジョブ {id}：待ち行列に追加しました。",
    downloadComplete: "成果物のダウンロード先：{directory}",
    setupStatus: "セットアップの状態：{status}",
    repairedItems: "修復した管理対象の項目数：{count}",
    preservedItems: "所有範囲外または変更済みのため保持した項目数：{count}",
    setupGuiCannotBeCombinedWith: "setup --gui と --json は併用できません。",
    setupGuiCannotBeCombinedWith2:
      "setup --gui と --api-key-stdin は併用できません。",
    credentialStored: "認証情報：保存しました。",
    credentialIsConfigured: "認証情報：設定済みです。",
    connectionStatus: "接続先オリジン：{origin}\n認証情報の取得元：{source}",
    noCredentialSource: "なし",
    credentialRemoved: "認証情報：削除しました。",
    svgRetrySucceededOriginalPdfRetained:
      "SVGの再実行に成功しました。元のPDFは保持されます。",
    partialSuccessOriginalPdfRetainedSvg:
      "部分成功：SVGの再実行に失敗しました。元のPDFは保持されます。",
    specifyEitherAProjectPathOr:
      "プロジェクトのパス と --source のいずれか1つだけを指定してください。",
    thePackageLauncherMustSupplyAbsolute:
      "パッケージランチャー：絶対パスが必要です。",
    inputIsNotARenderApi: "入力はレンダリング用APIキーではありません。",
    compileADocumentN624LatexMain: "文書をコンパイル：n624-latex main.tex",
    projectDirectoryOrZip: "プロジェクトのディレクトリまたは.zipファイル",
    writeOneStructuredJsonResultTo:
      "構造化したJSON結果を1件、標準出力に書き込みます",
    compileATexDocumentWithThis: "このエンジンでTeX文書をコンパイルします",
    writeThePdfToThisPath: "このパスにPDFを書き込みます",
    runN624LatexSetupToConfigure:
      "n624-latex setup を実行してレンダリングクライアントを設定してください。",
    removeTheStoredApiKey: "保存済みのAPIキーを削除します",
    installOrUpdateTheManagedCross:
      "管理対象のクロスプラットフォームクライアントをインストールまたは更新します",
    clientDistributionBaseUrl: "クライアント配布元のベースURL",
    managedInstallationDirectory: "管理対象のインストールディレクトリ",
    commandLauncherDirectory: "コマンドランチャーのディレクトリ",
    storeARenderApiKeyRead:
      "標準入力から読み込んだレンダリング用APIキーを保存します",
    openTheLoopbackOnlyLocalSetup:
      "ループバック限定のローカルセットアップWeb画面を開きます",
    skillTarget: "スキルのインストール先",
    mcpTarget: "MCPの登録先",
    configureAiIntegrationsForAWinget:
      "WinGetまたはHomebrewでインストールしたクライアントのAI連携を設定します",
    thisCommandIsForWingetOr:
      "このコマンドはWinGetまたはHomebrewでのインストール用です。",
    inspectTheManagedClientWithoutChanging:
      "管理対象のクライアントを変更せずに点検します",
    repairOnlySettingsOwnedByThis:
      "このインストールが所有する設定だけを修復します",
    removeTheManagedClientAndOwned:
      "管理対象クライアントと、このインストールが所有する連携を削除します",
    confirmRemoval: "削除を確定します",
    keepTheStoredRenderApiKey: "保存済みのレンダリング用APIキーを保持します",
    keepInstalledCodexAndClaudeSkills:
      "インストール済みのCodex・Claude用スキルを保持します",
    managedClientIsNotInstalled:
      "管理対象のクライアントはインストールされていません。",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "実行環境、インストール、認証情報、スキル、MCP設定を診断します",
    reuseAnUploadedSource: "アップロード済みの入力を再利用します",
    texEntrypoint: "TeXエントリーポイント",
    outputDirectory: "出力ディレクトリ",
    alsoExportEachOutermostMathAnd:
      "最外層の数式・TikZオブジェクトをそれぞれSVGにも出力します",
    openThePdfAfterSuccess: "成功後にPDFを開きます",
    pdfWasSavedButOpeningIt:
      "PDFは保存されましたが開けませんでした。保存したPDFを手動で開いてください。",
    manageSavedProjectsSharedWithWeb:
      "Web・MCPと共用の保存済みプロジェクトを管理します",
    revisionDisplayName: "リビジョンの表示名",
    usePdfAndSvgAsInitial: "初期の出力設定をPDFとSVGにします",
    queueAJobForAnExact:
      "指定した保存済みリビジョンのジョブを待ち行列に追加します",
    usePdfAndSvgInsteadOf: "リビジョンの既定値の代わりにPDFとSVGを使用します",
    uploadALocalSourceAndAttach:
      "ローカルソースをアップロードし、不変のプロジェクトリビジョンとして追加",
    downloadTheCommittedPdfWithoutWaiting:
      "SVGを待たずに確定済みPDFをダウンロード",
    generateSelectedPreviewPages1100:
      "選択したページ（1～100）のみプレビューを生成",
    thisInstallationDoesNotContainThe:
      "このインストールには管理CLIが含まれていません。",
    partialSuccessPdfAndPreviewsWere:
      "一部成功：PDFとプレビューを保存しました。SVGは失敗しました。jobs retry-svg でPDFを再コンパイルせずにSVGを再試行できます。",
  }),
  "zh-CN": () => ({
    configuredIntegration: "已配置：{item}",
    preservedIntegration: "已保留：{item}",
    sourceUploaded: "已上传源文件 {id}。",
    sourceReused: "已复用源文件 {id}。",
    projectDeleted: "已删除项目 {id}。",
    renderEnded: "转换结束（{status}）。",
    inputUploaded: "已上传源文件 {id}。",
    inputReused: "已复用源文件 {id}。",
    jobReserved: "已预约",
    jobUploading: "上传中",
    jobWaiting: "排队中",
    jobValidating: "验证中",
    jobRunning: "转换中",
    jobSucceeded: "转换成功",
    jobFailed: "转换失败",
    jobTimeout: "超时",
    jobCanceled: "已中止",
    jobRejected: "已拒绝",
    jobDeleting: "删除中",
    jobDeleted: "已删除",
    jobExpired: "已过期",
    cancelRequested: "{id}：已请求取消。",
    deleteRequested: "{id}：已请求删除。",
    jobQueued: "任务 {id}：已加入队列。",
    downloadComplete: "产物下载位置：{directory}",
    setupStatus: "设置状态：{status}",
    repairedItems: "已修复的受管理项数：{count}",
    preservedItems: "已保留的不属于本安装或已修改的项目数：{count}",
    setupGuiCannotBeCombinedWith: "setup --gui 不能与 --json 同时使用。",
    setupGuiCannotBeCombinedWith2:
      "setup --gui 不能与 --api-key-stdin 同时使用。",
    credentialStored: "凭据：已保存。",
    credentialIsConfigured: "凭据：已配置。",
    connectionStatus: "连接源站：{origin}\n凭据来源：{source}",
    noCredentialSource: "无",
    credentialRemoved: "凭据：已移除。",
    svgRetrySucceededOriginalPdfRetained: "SVG 重试成功。原 PDF 保留。",
    partialSuccessOriginalPdfRetainedSvg:
      "部分成功：SVG 重试失败。原 PDF 保留。",
    specifyEitherAProjectPathOr:
      "请从 项目路径 和 --source 中选择且仅选择一项。",
    thePackageLauncherMustSupplyAbsolute: "包启动器：需要绝对路径。",
    inputIsNotARenderApi: "输入不是渲染 API 密钥。",
    compileADocumentN624LatexMain: "编译文档：n624-latex main.tex",
    projectDirectoryOrZip: "项目目录或 .zip 文件",
    writeOneStructuredJsonResultTo: "向标准输出写入一个结构化 JSON 结果",
    compileATexDocumentWithThis: "使用此引擎编译 TeX 文档",
    writeThePdfToThisPath: "将 PDF 写入此路径",
    runN624LatexSetupToConfigure: "运行 n624-latex setup 配置渲染客户端。",
    removeTheStoredApiKey: "删除已保存的 API 密钥",
    installOrUpdateTheManagedCross: "安装或更新受管理的跨平台客户端",
    clientDistributionBaseUrl: "客户端分发基础 URL",
    managedInstallationDirectory: "受管理的安装目录",
    commandLauncherDirectory: "命令启动器目录",
    storeARenderApiKeyRead: "保存从标准输入读取的渲染 API 密钥",
    openTheLoopbackOnlyLocalSetup: "打开仅限回环访问的本地设置网页",
    skillTarget: "技能安装目标",
    mcpTarget: "MCP 注册目标",
    configureAiIntegrationsForAWinget: "为 WinGet 或 Homebrew 安装配置 AI 集成",
    thisCommandIsForWingetOr: "此命令适用于 WinGet 或 Homebrew 安装。",
    inspectTheManagedClientWithoutChanging: "检查受管理的客户端而不进行更改",
    repairOnlySettingsOwnedByThis: "仅修复属于本安装的设置",
    removeTheManagedClientAndOwned: "移除受管理的客户端及属于本安装的集成",
    confirmRemoval: "确认移除",
    keepTheStoredRenderApiKey: "保留已保存的渲染 API 密钥",
    keepInstalledCodexAndClaudeSkills: "保留已安装的 Codex 和 Claude 技能",
    managedClientIsNotInstalled: "尚未安装受管理的客户端。",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "诊断运行环境、安装、凭据、技能和 MCP 设置",
    reuseAnUploadedSource: "复用已上传的输入",
    texEntrypoint: "TeX 入口文件",
    outputDirectory: "输出目录",
    alsoExportEachOutermostMathAnd:
      "还将每个最外层数学公式和 TikZ 对象分别导出为 SVG",
    openThePdfAfterSuccess: "成功后打开 PDF",
    pdfWasSavedButOpeningIt: "PDF 已保存，但无法打开。请手动打开已保存的 PDF。",
    manageSavedProjectsSharedWithWeb: "管理与 Web 和 MCP 共用的已保存项目",
    revisionDisplayName: "修订显示名称",
    usePdfAndSvgAsInitial: "将 PDF 和 SVG 设为初始默认输出",
    queueAJobForAnExact: "将指定已保存修订的任务加入队列",
    usePdfAndSvgInsteadOf: "使用 PDF 和 SVG 替代修订的默认输出",
    uploadALocalSourceAndAttach: "上传本地源文件并附加不可变的项目修订",
    downloadTheCommittedPdfWithoutWaiting: "无需等待 SVG，下载已提交的 PDF",
    generateSelectedPreviewPages1100: "仅为选定页（1–100）生成预览",
    thisInstallationDoesNotContainThe: "此安装不包含管理 CLI。",
    partialSuccessPdfAndPreviewsWere:
      "部分成功：已保存 PDF 和预览。SVG 失败；使用 jobs retry-svg 重试 SVG，无需重新编译 PDF。",
  }),
  ko: () => ({
    configuredIntegration: "설정 완료: {item}",
    preservedIntegration: "유지: {item}",
    sourceUploaded: "입력 {id}을(를) 업로드했습니다.",
    sourceReused: "입력 {id}을(를) 재사용했습니다.",
    projectDeleted: "프로젝트 {id}을(를) 삭제했습니다.",
    renderEnded: "변환이 종료되었습니다({status}).",
    inputUploaded: "입력 {id}을(를) 업로드했습니다.",
    inputReused: "입력 {id}을(를) 재사용했습니다.",
    jobReserved: "예약됨",
    jobUploading: "전송 중",
    jobWaiting: "대기 중",
    jobValidating: "확인 중",
    jobRunning: "변환 중",
    jobSucceeded: "변환 성공",
    jobFailed: "변환 실패",
    jobTimeout: "시간 초과",
    jobCanceled: "중지됨",
    jobRejected: "접수 불가",
    jobDeleting: "삭제 중",
    jobDeleted: "삭제됨",
    jobExpired: "보관 기한 만료",
    cancelRequested: "{id}: 취소를 요청했습니다.",
    deleteRequested: "{id}: 삭제를 요청했습니다.",
    jobQueued: "작업 {id}: 대기열에 추가했습니다.",
    downloadComplete: "결과물 다운로드 위치: {directory}",
    setupStatus: "설정 상태: {status}",
    repairedItems: "복구한 관리 항목 수: {count}",
    preservedItems: "이 설치 소유가 아니거나 변경되어 보존된 항목 수: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui 및 --json은(는) 함께 사용할 수 없습니다.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui 및 --api-key-stdin은(는) 함께 사용할 수 없습니다.",
    credentialStored: "자격 증명: 저장했습니다.",
    credentialIsConfigured: "자격 증명: 설정되었습니다.",
    connectionStatus: "연결 오리진: {origin}\n자격 증명 출처: {source}",
    noCredentialSource: "없음",
    credentialRemoved: "자격 증명: 삭제했습니다.",
    svgRetrySucceededOriginalPdfRetained:
      "SVG 재시도에 성공했습니다. 원본 PDF는 유지됩니다.",
    partialSuccessOriginalPdfRetainedSvg:
      "부분 성공: SVG 재시도에 실패했습니다. 원본 PDF는 유지됩니다.",
    specifyEitherAProjectPathOr:
      "프로젝트 경로, --source 중 하나만 지정하세요.",
    thePackageLauncherMustSupplyAbsolute:
      "패키지 실행기: 필요한 항목 — 절대 경로",
    inputIsNotARenderApi: "입력값이 렌더링 API 키 형식이 아닙니다.",
    compileADocumentN624LatexMain: "문서 컴파일: n624-latex main.tex",
    projectDirectoryOrZip: "프로젝트 디렉터리 또는 .zip 파일",
    writeOneStructuredJsonResultTo:
      "구조화된 JSON 결과 하나를 표준 출력에 기록",
    compileATexDocumentWithThis: "이 엔진으로 TeX 문서 컴파일",
    writeThePdfToThisPath: "이 경로에 PDF 쓰기",
    runN624LatexSetupToConfigure:
      "n624-latex setup을 실행하여 렌더러 클라이언트를 설정하세요.",
    removeTheStoredApiKey: "저장된 API 키 제거",
    installOrUpdateTheManagedCross:
      "관리형 크로스 플랫폼 클라이언트 설치 또는 업데이트",
    clientDistributionBaseUrl: "클라이언트 배포 기본 URL",
    managedInstallationDirectory: "관리형 설치 디렉터리",
    commandLauncherDirectory: "명령 실행기 디렉터리",
    storeARenderApiKeyRead: "표준 입력에서 읽은 렌더링 API 키 저장",
    openTheLoopbackOnlyLocalSetup: "루프백 전용 로컬 설정 웹 화면 열기",
    skillTarget: "스킬 설치 대상",
    mcpTarget: "MCP 등록 대상",
    configureAiIntegrationsForAWinget:
      "WinGet 또는 Homebrew 설치의 AI 연동 설정",
    thisCommandIsForWingetOr: "이 명령은 WinGet 또는 Homebrew 설치용입니다.",
    inspectTheManagedClientWithoutChanging:
      "관리형 클라이언트를 변경하지 않고 점검",
    repairOnlySettingsOwnedByThis: "이 설치가 소유한 설정만 복구",
    removeTheManagedClientAndOwned:
      "관리형 클라이언트와 이 설치가 소유한 연동 제거",
    confirmRemoval: "제거 확인",
    keepTheStoredRenderApiKey: "저장된 렌더링 API 키 유지",
    keepInstalledCodexAndClaudeSkills: "설치된 Codex 및 Claude 스킬 유지",
    managedClientIsNotInstalled: "관리형 클라이언트가 설치되어 있지 않습니다.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "런타임, 설치, 자격 증명, 스킬 및 MCP 설정 진단",
    reuseAnUploadedSource: "업로드된 입력 재사용",
    texEntrypoint: "TeX 진입점",
    outputDirectory: "출력 디렉터리",
    alsoExportEachOutermostMathAnd:
      "각 최외곽 수식 및 TikZ 객체를 SVG로도 내보내기",
    openThePdfAfterSuccess: "성공 후 PDF 열기",
    pdfWasSavedButOpeningIt:
      "PDF는 저장했지만 열지 못했습니다. 저장된 PDF를 직접 여세요.",
    manageSavedProjectsSharedWithWeb: "웹 및 MCP와 공유되는 저장 프로젝트 관리",
    revisionDisplayName: "리비전 표시 이름",
    usePdfAndSvgAsInitial: "초기 기본 출력을 PDF와 SVG로 설정",
    queueAJobForAnExact: "지정한 저장 리비전의 작업을 대기열에 추가",
    usePdfAndSvgInsteadOf: "리비전 기본값 대신 PDF와 SVG 사용",
    uploadALocalSourceAndAttach:
      "로컬 소스를 업로드하고 변경 불가능한 프로젝트 리비전을 연결",
    downloadTheCommittedPdfWithoutWaiting:
      "SVG를 기다리지 않고 확정된 PDF 다운로드",
    generateSelectedPreviewPages1100: "선택한 페이지(1~100)만 미리보기 생성",
    thisInstallationDoesNotContainThe:
      "이 설치에는 관리자 CLI가 포함되어 있지 않습니다.",
    partialSuccessPdfAndPreviewsWere:
      "부분 성공: PDF와 미리보기를 저장했습니다. SVG는 실패했습니다. jobs retry-svg로 PDF를 다시 컴파일하지 않고 SVG만 재시도하세요.",
  }),
  es: () => ({
    configuredIntegration: "Configurado: {item}",
    preservedIntegration: "Conservado: {item}",
    sourceUploaded: "Se subió la fuente {id}.",
    sourceReused: "Se reutilizó la fuente {id}.",
    projectDeleted: "Se eliminó el proyecto {id}.",
    renderEnded: "La conversión terminó ({status}).",
    inputUploaded: "Se subió la fuente {id}.",
    inputReused: "Se reutilizó la fuente {id}.",
    jobReserved: "Reservado",
    jobUploading: "Subiendo",
    jobWaiting: "En cola",
    jobValidating: "Validando",
    jobRunning: "Convirtiendo",
    jobSucceeded: "Completado",
    jobFailed: "Fallido",
    jobTimeout: "Tiempo agotado",
    jobCanceled: "Cancelado",
    jobRejected: "Rechazado",
    jobDeleting: "Eliminando",
    jobDeleted: "Eliminado",
    jobExpired: "Caducado",
    cancelRequested: "{id}: se ha solicitado la cancelación.",
    deleteRequested: "{id}: se ha solicitado la eliminación.",
    jobQueued: "Trabajo {id}: en cola.",
    downloadComplete: "Destino de la descarga de artefactos: {directory}",
    setupStatus: "Estado de la configuración: {status}",
    repairedItems: "Elementos gestionados reparados: {count}",
    preservedItems:
      "Elementos ajenos a la instalación o modificados que se conservaron: {count}",
    setupGuiCannotBeCombinedWith: "No se pueden combinar setup --gui y --json.",
    setupGuiCannotBeCombinedWith2:
      "No se pueden combinar setup --gui y --api-key-stdin.",
    credentialStored: "Credencial: se ha guardado.",
    credentialIsConfigured: "Credencial: configuración completada.",
    connectionStatus:
      "Origen de la conexión: {origin}\nOrigen de la credencial: {source}",
    noCredentialSource: "ninguno",
    credentialRemoved: "Credencial: se ha eliminado.",
    svgRetrySucceededOriginalPdfRetained:
      "El reintento de SVG ha terminado correctamente. Se conserva el PDF original.",
    partialSuccessOriginalPdfRetainedSvg:
      "Éxito parcial. El reintento de SVG ha fallado. Se conserva el PDF original.",
    specifyEitherAProjectPathOr:
      "Especifique exactamente una opción: ruta del proyecto o --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Lanzador del paquete. Requisito: rutas absolutas.",
    inputIsNotARenderApi:
      "La entrada no corresponde a una clave de la API de renderizado.",
    compileADocumentN624LatexMain: "Compilar un documento: n624-latex main.tex",
    projectDirectoryOrZip: "directorio de proyecto o archivo .zip",
    writeOneStructuredJsonResultTo:
      "Escribir un resultado JSON estructurado en la salida estándar",
    compileATexDocumentWithThis: "Compilar un documento TeX con este motor",
    writeThePdfToThisPath: "Escribir el PDF en esta ruta",
    runN624LatexSetupToConfigure:
      "Ejecute n624-latex setup para configurar el cliente de renderizado.",
    removeTheStoredApiKey: "Eliminar la clave de API guardada",
    installOrUpdateTheManagedCross:
      "Instalar o actualizar el cliente multiplataforma gestionado",
    clientDistributionBaseUrl: "URL base de distribución del cliente",
    managedInstallationDirectory: "Directorio de instalación gestionado",
    commandLauncherDirectory: "Directorio de lanzadores de comandos",
    storeARenderApiKeyRead:
      "Guardar una clave de API de renderizado leída de la entrada estándar",
    openTheLoopbackOnlyLocalSetup:
      "Abrir la interfaz web de configuración local limitada a loopback",
    skillTarget: "Destino de las habilidades",
    mcpTarget: "Destino de registro MCP",
    configureAiIntegrationsForAWinget:
      "Configurar las integraciones de IA de una instalación WinGet o Homebrew",
    thisCommandIsForWingetOr:
      "Este comando es para instalaciones con WinGet o Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Inspeccionar el cliente gestionado sin modificarlo",
    repairOnlySettingsOwnedByThis:
      "Reparar solo la configuración que pertenece a esta instalación",
    removeTheManagedClientAndOwned:
      "Eliminar el cliente gestionado y las integraciones que le pertenecen",
    confirmRemoval: "Confirmar la eliminación",
    keepTheStoredRenderApiKey:
      "Conservar la clave de API de renderizado guardada",
    keepInstalledCodexAndClaudeSkills:
      "Conservar las habilidades instaladas de Codex y Claude",
    managedClientIsNotInstalled: "El cliente gestionado no está instalado.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnosticar el entorno de ejecución, la instalación, las credenciales, las habilidades y MCP",
    reuseAnUploadedSource: "Reutilizar una entrada ya subida",
    texEntrypoint: "Punto de entrada TeX",
    outputDirectory: "Directorio de salida",
    alsoExportEachOutermostMathAnd:
      "Exportar también como SVG cada objeto matemático y TikZ de nivel exterior",
    openThePdfAfterSuccess: "Abrir el PDF al finalizar correctamente",
    pdfWasSavedButOpeningIt:
      "El PDF se guardó, pero no se pudo abrir. Abra manualmente el PDF guardado.",
    manageSavedProjectsSharedWithWeb:
      "Gestionar proyectos guardados compartidos con Web y MCP",
    revisionDisplayName: "Nombre visible de la revisión",
    usePdfAndSvgAsInitial:
      "Usar PDF y SVG como salidas predeterminadas iniciales",
    queueAJobForAnExact:
      "Poner en cola un trabajo para una revisión guardada concreta",
    usePdfAndSvgInsteadOf:
      "Usar PDF y SVG en lugar de las salidas predeterminadas de la revisión",
    uploadALocalSourceAndAttach:
      "subir un origen local y adjuntar una revisión inmutable del proyecto",
    downloadTheCommittedPdfWithoutWaiting:
      "descargar el PDF confirmado sin esperar al SVG",
    generateSelectedPreviewPages1100:
      "generar vistas previas solo de las páginas seleccionadas (1–100)",
    thisInstallationDoesNotContainThe:
      "Esta instalación no incluye la CLI de administración.",
    partialSuccessPdfAndPreviewsWere:
      "Éxito parcial: se guardaron el PDF y las vistas previas. Falló SVG. Use jobs retry-svg para reintentarlo sin recompilar el PDF.",
  }),
  pt: () => ({
    configuredIntegration: "Configurado: {item}",
    preservedIntegration: "Preservado: {item}",
    sourceUploaded: "A fonte {id} foi enviada.",
    sourceReused: "A fonte {id} foi reutilizada.",
    projectDeleted: "O projeto {id} foi excluído.",
    renderEnded: "A conversão terminou ({status}).",
    inputUploaded: "A fonte {id} foi enviada.",
    inputReused: "A fonte {id} foi reutilizada.",
    jobReserved: "Reservado",
    jobUploading: "Enviando",
    jobWaiting: "Na fila",
    jobValidating: "Validando",
    jobRunning: "Convertendo",
    jobSucceeded: "Concluído",
    jobFailed: "Falhou",
    jobTimeout: "Tempo esgotado",
    jobCanceled: "Cancelado",
    jobRejected: "Rejeitado",
    jobDeleting: "Excluindo",
    jobDeleted: "Excluído",
    jobExpired: "Expirado",
    cancelRequested: "{id}: foi pedido o cancelamento.",
    deleteRequested: "{id}: foi pedida a eliminação.",
    jobQueued: "Tarefa {id}: na fila de espera.",
    downloadComplete: "Destino da transferência dos artefactos: {directory}",
    setupStatus: "Estado da configuração: {status}",
    repairedItems: "Itens geridos reparados: {count}",
    preservedItems:
      "Itens fora da gestão da instalação ou alterados que foram preservados: {count}",
    setupGuiCannotBeCombinedWith:
      "Não é possível combinar setup --gui e --json.",
    setupGuiCannotBeCombinedWith2:
      "Não é possível combinar setup --gui e --api-key-stdin.",
    credentialStored: "Credencial: guardado com êxito.",
    credentialIsConfigured: "Credencial: configuração efetuada.",
    connectionStatus:
      "Origem da conexão: {origin}\nOrigem da credencial: {source}",
    noCredentialSource: "nenhuma",
    credentialRemoved: "Credencial: remoção concluída.",
    svgRetrySucceededOriginalPdfRetained:
      "A nova tentativa de SVG foi bem-sucedida. O PDF original é mantido.",
    partialSuccessOriginalPdfRetainedSvg:
      "Êxito parcial. A nova tentativa de SVG falhou. O PDF original é mantido.",
    specifyEitherAProjectPathOr:
      "Indique exatamente uma opção: caminho do projeto ou --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Lançador do pacote. Requisito: caminhos absolutos.",
    inputIsNotARenderApi:
      "A entrada não corresponde a uma chave da API de renderização.",
    compileADocumentN624LatexMain: "Compilar um documento: n624-latex main.tex",
    projectDirectoryOrZip: "diretório do projeto ou ficheiro .zip",
    writeOneStructuredJsonResultTo:
      "Escrever um resultado JSON estruturado na saída padrão",
    compileATexDocumentWithThis: "Compilar um documento TeX com este motor",
    writeThePdfToThisPath: "Escrever o PDF neste caminho",
    runN624LatexSetupToConfigure:
      "Execute n624-latex setup para configurar o cliente de renderização.",
    removeTheStoredApiKey: "Remover a chave de API guardada",
    installOrUpdateTheManagedCross:
      "Instalar ou atualizar o cliente multiplataforma gerido",
    clientDistributionBaseUrl: "URL base da distribuição do cliente",
    managedInstallationDirectory: "Diretório de instalação gerido",
    commandLauncherDirectory: "Diretório dos lançadores de comandos",
    storeARenderApiKeyRead:
      "Guardar uma chave de API de renderização lida da entrada padrão",
    openTheLoopbackOnlyLocalSetup:
      "Abrir a interface Web de configuração local limitada a loopback",
    skillTarget: "Destino das competências",
    mcpTarget: "Destino de registo MCP",
    configureAiIntegrationsForAWinget:
      "Configurar integrações de IA para uma instalação WinGet ou Homebrew",
    thisCommandIsForWingetOr:
      "Este comando destina-se a instalações WinGet ou Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Inspecionar o cliente gerido sem o alterar",
    repairOnlySettingsOwnedByThis:
      "Reparar apenas as definições pertencentes a esta instalação",
    removeTheManagedClientAndOwned:
      "Remover o cliente gerido e as integrações que lhe pertencem",
    confirmRemoval: "Confirmar a remoção",
    keepTheStoredRenderApiKey: "Manter a chave de API de renderização guardada",
    keepInstalledCodexAndClaudeSkills:
      "Manter as competências instaladas do Codex e do Claude",
    managedClientIsNotInstalled: "O cliente gerido não está instalado.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnosticar o ambiente de execução, a instalação, as credenciais, as competências e o MCP",
    reuseAnUploadedSource: "Reutilizar uma entrada já enviada",
    texEntrypoint: "Ponto de entrada TeX",
    outputDirectory: "Diretório de saída",
    alsoExportEachOutermostMathAnd:
      "Exportar também como SVG cada objeto matemático e TikZ do nível exterior",
    openThePdfAfterSuccess: "Abrir o PDF após a conclusão com êxito",
    pdfWasSavedButOpeningIt:
      "O PDF foi guardado, mas não foi possível abri-lo. Abra manualmente o PDF guardado.",
    manageSavedProjectsSharedWithWeb:
      "Gerir projetos guardados partilhados com Web e MCP",
    revisionDisplayName: "Nome de apresentação da revisão",
    usePdfAndSvgAsInitial: "Usar PDF e SVG como saídas iniciais predefinidas",
    queueAJobForAnExact:
      "Colocar na fila uma tarefa para uma revisão guardada específica",
    usePdfAndSvgInsteadOf:
      "Usar PDF e SVG em vez das saídas predefinidas da revisão",
    uploadALocalSourceAndAttach:
      "enviar uma fonte local e anexar uma revisão imutável do projeto",
    downloadTheCommittedPdfWithoutWaiting:
      "baixar o PDF já confirmado sem aguardar o SVG",
    generateSelectedPreviewPages1100:
      "gerar prévias apenas das páginas selecionadas (1–100)",
    thisInstallationDoesNotContainThe:
      "Esta instalação não inclui a CLI de administração.",
    partialSuccessPdfAndPreviewsWere:
      "Sucesso parcial: o PDF e as prévias foram salvos. O SVG falhou. Use jobs retry-svg para tentar novamente sem recompilar o PDF.",
  }),
  fr: () => ({
    configuredIntegration: "Configuré : {item}",
    preservedIntegration: "Conservé : {item}",
    sourceUploaded: "La source {id} a été téléversée.",
    sourceReused: "La source {id} a été réutilisée.",
    projectDeleted: "Le projet {id} a été supprimé.",
    renderEnded: "La conversion est terminée ({status}).",
    inputUploaded: "La source {id} a été téléversée.",
    inputReused: "La source {id} a été réutilisée.",
    jobReserved: "Réservé",
    jobUploading: "Envoi en cours",
    jobWaiting: "En file d'attente",
    jobValidating: "Validation",
    jobRunning: "Conversion",
    jobSucceeded: "Réussi",
    jobFailed: "Échec",
    jobTimeout: "Délai dépassé",
    jobCanceled: "Annulé",
    jobRejected: "Refusé",
    jobDeleting: "Suppression",
    jobDeleted: "Supprimé",
    jobExpired: "Expiré",
    cancelRequested: "{id} : annulation demandée.",
    deleteRequested: "{id} : suppression demandée.",
    jobQueued: "Tâche {id} : en file d’attente.",
    downloadComplete:
      "Destination du téléchargement des artefacts : {directory}",
    setupStatus: "État de la configuration : {status}",
    repairedItems: "Éléments gérés réparés : {count}",
    preservedItems:
      "Éléments non gérés par cette installation ou modifiés qui ont été conservés : {count}",
    setupGuiCannotBeCombinedWith:
      "Impossible de combiner setup --gui et --json.",
    setupGuiCannotBeCombinedWith2:
      "Impossible de combiner setup --gui et --api-key-stdin.",
    credentialStored: "Identifiant d’accès : enregistrement effectué.",
    credentialIsConfigured: "Identifiant d’accès : configuration effectuée.",
    connectionStatus:
      "Origine de la connexion : {origin}\nSource de l’identifiant : {source}",
    noCredentialSource: "aucune",
    credentialRemoved: "Identifiant d’accès : suppression effectuée.",
    svgRetrySucceededOriginalPdfRetained:
      "La nouvelle tentative SVG a réussi. Le PDF d’origine est conservé.",
    partialSuccessOriginalPdfRetainedSvg:
      "Réussite partielle. La nouvelle tentative SVG a échoué. Le PDF d’origine est conservé.",
    specifyEitherAProjectPathOr:
      "Indiquez exactement une option parmi chemin du projet et --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Lanceur du paquet — Condition requise : chemins absolus.",
    inputIsNotARenderApi:
      "La valeur saisie ne correspond pas à une clé d’API de rendu.",
    compileADocumentN624LatexMain: "Compiler un document : n624-latex main.tex",
    projectDirectoryOrZip: "répertoire de projet ou fichier .zip",
    writeOneStructuredJsonResultTo:
      "Écrire un résultat JSON structuré sur la sortie standard",
    compileATexDocumentWithThis: "Compiler un document TeX avec ce moteur",
    writeThePdfToThisPath: "Écrire le PDF à ce chemin",
    runN624LatexSetupToConfigure:
      "Exécutez n624-latex setup pour configurer le client de rendu.",
    removeTheStoredApiKey: "Supprimer la clé d’API enregistrée",
    installOrUpdateTheManagedCross:
      "Installer ou mettre à jour le client multiplateforme géré",
    clientDistributionBaseUrl: "URL de base de la distribution du client",
    managedInstallationDirectory: "Répertoire d’installation géré",
    commandLauncherDirectory: "Répertoire des lanceurs de commandes",
    storeARenderApiKeyRead:
      "Enregistrer une clé d’API de rendu lue sur l’entrée standard",
    openTheLoopbackOnlyLocalSetup:
      "Ouvrir l’interface web de configuration locale limitée au bouclage",
    skillTarget: "Cible d’installation des compétences",
    mcpTarget: "Cible d’enregistrement MCP",
    configureAiIntegrationsForAWinget:
      "Configurer les intégrations IA d’une installation WinGet ou Homebrew",
    thisCommandIsForWingetOr:
      "Cette commande est réservée aux installations WinGet ou Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Inspecter le client géré sans le modifier",
    repairOnlySettingsOwnedByThis:
      "Réparer uniquement les paramètres appartenant à cette installation",
    removeTheManagedClientAndOwned:
      "Supprimer le client géré et les intégrations qu’il possède",
    confirmRemoval: "Confirmer la suppression",
    keepTheStoredRenderApiKey: "Conserver la clé d’API de rendu enregistrée",
    keepInstalledCodexAndClaudeSkills:
      "Conserver les compétences Codex et Claude installées",
    managedClientIsNotInstalled: "Le client géré n’est pas installé.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnostiquer l’environnement d’exécution, l’installation, les identifiants, les compétences et la configuration MCP",
    reuseAnUploadedSource: "Réutiliser une source déjà téléversée",
    texEntrypoint: "Point d’entrée TeX",
    outputDirectory: "Répertoire de sortie",
    alsoExportEachOutermostMathAnd:
      "Exporter aussi en SVG chaque objet mathématique et TikZ du niveau le plus externe",
    openThePdfAfterSuccess: "Ouvrir le PDF en cas de réussite",
    pdfWasSavedButOpeningIt:
      "Le PDF a été enregistré, mais son ouverture a échoué. Ouvrez manuellement le fichier enregistré.",
    manageSavedProjectsSharedWithWeb:
      "Gérer les projets enregistrés partagés avec le Web et MCP",
    revisionDisplayName: "Nom affiché de la révision",
    usePdfAndSvgAsInitial:
      "Utiliser PDF et SVG comme sorties initiales par défaut",
    queueAJobForAnExact:
      "Mettre en file une tâche pour une révision enregistrée précise",
    usePdfAndSvgInsteadOf:
      "Utiliser PDF et SVG à la place des sorties par défaut de la révision",
    uploadALocalSourceAndAttach:
      "téléverser une source locale et joindre une révision immuable du projet",
    downloadTheCommittedPdfWithoutWaiting:
      "télécharger le PDF finalisé sans attendre le SVG",
    generateSelectedPreviewPages1100:
      "générer des aperçus pour les seules pages choisies (1 à 100)",
    thisInstallationDoesNotContainThe:
      "Cette installation ne contient pas la CLI d’administration.",
    partialSuccessPdfAndPreviewsWere:
      "Réussite partielle : PDF et aperçus enregistrés. Échec du SVG. Utilisez jobs retry-svg pour réessayer sans recompiler le PDF.",
  }),
  de: () => ({
    configuredIntegration: "Konfiguriert: {item}",
    preservedIntegration: "Beibehalten: {item}",
    sourceUploaded: "Quelle {id} wurde hochgeladen.",
    sourceReused: "Quelle {id} wurde erneut verwendet.",
    projectDeleted: "Projekt {id} wurde gelöscht.",
    renderEnded: "Die Konvertierung wurde beendet ({status}).",
    inputUploaded: "Quelle {id} wurde hochgeladen.",
    inputReused: "Quelle {id} wurde erneut verwendet.",
    jobReserved: "Reserviert",
    jobUploading: "Wird hochgeladen",
    jobWaiting: "In Warteschlange",
    jobValidating: "Wird geprüft",
    jobRunning: "Wird umgewandelt",
    jobSucceeded: "Erfolgreich",
    jobFailed: "Fehlgeschlagen",
    jobTimeout: "Zeitüberschreitung",
    jobCanceled: "Abgebrochen",
    jobRejected: "Abgelehnt",
    jobDeleting: "Wird gelöscht",
    jobDeleted: "Gelöscht",
    jobExpired: "Abgelaufen",
    cancelRequested: "{id}: Abbruch angefordert.",
    deleteRequested: "{id}: Löschung angefordert.",
    jobQueued: "Auftrag {id}: eingereiht.",
    downloadComplete:
      "Speicherort der heruntergeladenen Artefakte: {directory}",
    setupStatus: "Einrichtungsstatus: {status}",
    repairedItems: "Reparierte verwaltete Elemente: {count}",
    preservedItems: "Beibehaltene fremde oder geänderte Elemente: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui und --json können nicht kombiniert werden.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui und --api-key-stdin können nicht kombiniert werden.",
    credentialStored: "Zugangsdaten: gespeichert.",
    credentialIsConfigured: "Zugangsdaten: konfiguriert.",
    connectionStatus:
      "Verbindungsursprung: {origin}\nQuelle der Zugangsdaten: {source}",
    noCredentialSource: "keine",
    credentialRemoved: "Zugangsdaten: entfernt.",
    svgRetrySucceededOriginalPdfRetained:
      "Der erneute SVG-Versuch war erfolgreich. Die ursprüngliche PDF bleibt erhalten.",
    partialSuccessOriginalPdfRetainedSvg:
      "Teilerfolg. Der erneute SVG-Versuch ist fehlgeschlagen. Die ursprüngliche PDF bleibt erhalten.",
    specifyEitherAProjectPathOr:
      "Wählen Sie genau eine Option: Projektpfad oder --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Paketstarter – erforderlich: absolute Pfade.",
    inputIsNotARenderApi:
      "Eingabe entspricht nicht dem erwarteten Typ: Render-API-Schlüssel.",
    compileADocumentN624LatexMain: "Dokument kompilieren: n624-latex main.tex",
    projectDirectoryOrZip: "Projektverzeichnis oder .zip-Datei",
    writeOneStructuredJsonResultTo:
      "Ein strukturiertes JSON-Ergebnis auf die Standardausgabe schreiben",
    compileATexDocumentWithThis: "TeX-Dokument mit dieser Engine kompilieren",
    writeThePdfToThisPath: "PDF unter diesem Pfad speichern",
    runN624LatexSetupToConfigure:
      "Führen Sie n624-latex setup aus, um den Renderer-Client einzurichten.",
    removeTheStoredApiKey: "Gespeicherten API-Schlüssel entfernen",
    installOrUpdateTheManagedCross:
      "Verwalteten plattformübergreifenden Client installieren oder aktualisieren",
    clientDistributionBaseUrl: "Basis-URL der Clientdistribution",
    managedInstallationDirectory: "Verwaltetes Installationsverzeichnis",
    commandLauncherDirectory: "Verzeichnis der Befehlsstarter",
    storeARenderApiKeyRead:
      "Render-API-Schlüssel von der Standardeingabe lesen und speichern",
    openTheLoopbackOnlyLocalSetup:
      "Nur über Loopback erreichbare lokale Einrichtungsoberfläche öffnen",
    skillTarget: "Installationsziel für Skills",
    mcpTarget: "MCP-Registrierungsziel",
    configureAiIntegrationsForAWinget:
      "KI-Anbindungen für eine WinGet- oder Homebrew-Installation einrichten",
    thisCommandIsForWingetOr:
      "Dieser Befehl ist für Installationen mit WinGet oder Homebrew vorgesehen.",
    inspectTheManagedClientWithoutChanging:
      "Verwalteten Client ohne Änderungen prüfen",
    repairOnlySettingsOwnedByThis:
      "Nur Einstellungen dieser Installation reparieren",
    removeTheManagedClientAndOwned:
      "Verwalteten Client und seine eigenen Integrationen entfernen",
    confirmRemoval: "Entfernen bestätigen",
    keepTheStoredRenderApiKey: "Gespeicherten Render-API-Schlüssel behalten",
    keepInstalledCodexAndClaudeSkills:
      "Installierte Skills für Codex und Claude behalten",
    managedClientIsNotInstalled: "Der verwaltete Client ist nicht installiert.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Laufzeitumgebung, Installation, Zugangsdaten, Skills und MCP-Einrichtung prüfen",
    reuseAnUploadedSource: "Hochgeladene Quelle wiederverwenden",
    texEntrypoint: "TeX-Einstiegspunkt",
    outputDirectory: "Ausgabeverzeichnis",
    alsoExportEachOutermostMathAnd:
      "Zusätzlich jedes äußerste Mathematik- und TikZ-Objekt als SVG exportieren",
    openThePdfAfterSuccess: "PDF nach Erfolg öffnen",
    pdfWasSavedButOpeningIt:
      "Die PDF wurde gespeichert, konnte aber nicht geöffnet werden. Öffnen Sie die gespeicherte Datei manuell.",
    manageSavedProjectsSharedWithWeb:
      "Mit Web und MCP gemeinsam genutzte gespeicherte Projekte verwalten",
    revisionDisplayName: "Anzeigename der Revision",
    usePdfAndSvgAsInitial:
      "PDF und SVG als anfängliche Standardausgaben verwenden",
    queueAJobForAnExact:
      "Auftrag für eine bestimmte gespeicherte Revision einreihen",
    usePdfAndSvgInsteadOf:
      "PDF und SVG anstelle der Standardausgaben der Revision verwenden",
    uploadALocalSourceAndAttach:
      "lokale Quelle hochladen und unveränderliche Projektrevision anhängen",
    downloadTheCommittedPdfWithoutWaiting:
      "fertiggestelltes PDF herunterladen, ohne auf SVG zu warten",
    generateSelectedPreviewPages1100:
      "Vorschauen nur für ausgewählte Seiten (1–100) erzeugen",
    thisInstallationDoesNotContainThe:
      "Diese Installation enthält keine Admin-CLI.",
    partialSuccessPdfAndPreviewsWere:
      "Teilerfolg: PDF und Vorschauen gespeichert. SVG fehlgeschlagen. SVG mit jobs retry-svg erneut versuchen, ohne das PDF neu zu kompilieren.",
  }),
  it: () => ({
    configuredIntegration: "Configurato: {item}",
    preservedIntegration: "Conservato: {item}",
    sourceUploaded: "La sorgente {id} è stata caricata.",
    sourceReused: "La sorgente {id} è stata riutilizzata.",
    projectDeleted: "Il progetto {id} è stato eliminato.",
    renderEnded: "La conversione è terminata ({status}).",
    inputUploaded: "La sorgente {id} è stata caricata.",
    inputReused: "La sorgente {id} è stata riutilizzata.",
    jobReserved: "Riservato",
    jobUploading: "Caricamento",
    jobWaiting: "In coda",
    jobValidating: "Verifica in corso",
    jobRunning: "Conversione",
    jobSucceeded: "Completato",
    jobFailed: "Non riuscito",
    jobTimeout: "Tempo scaduto",
    jobCanceled: "Annullato",
    jobRejected: "Rifiutato",
    jobDeleting: "Eliminazione",
    jobDeleted: "Eliminato",
    jobExpired: "Scaduto",
    cancelRequested: "{id}: annullamento richiesto.",
    deleteRequested: "{id}: eliminazione richiesta.",
    jobQueued: "Processo {id}: in coda.",
    downloadComplete: "Destinazione degli artefatti scaricati: {directory}",
    setupStatus: "Stato della configurazione: {status}",
    repairedItems: "Elementi gestiti riparati: {count}",
    preservedItems:
      "Elementi esterni all’installazione o modificati che sono stati conservati: {count}",
    setupGuiCannotBeCombinedWith: "Impossibile combinare setup --gui e --json.",
    setupGuiCannotBeCombinedWith2:
      "Impossibile combinare setup --gui e --api-key-stdin.",
    credentialStored: "Credenziale: salvataggio completato.",
    credentialIsConfigured: "Credenziale: configurazione completata.",
    connectionStatus:
      "Origine della connessione: {origin}\nOrigine della credenziale: {source}",
    noCredentialSource: "nessuna",
    credentialRemoved: "Credenziale: rimozione completata.",
    svgRetrySucceededOriginalPdfRetained:
      "Il nuovo tentativo SVG è riuscito. Il PDF originale viene conservato.",
    partialSuccessOriginalPdfRetainedSvg:
      "Successo parziale. Il nuovo tentativo SVG non è riuscito. Il PDF originale viene conservato.",
    specifyEitherAProjectPathOr:
      "Specificare una sola opzione: percorso del progetto o --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Programma di avvio del pacchetto. Requisito: percorsi assoluti.",
    inputIsNotARenderApi:
      "Il valore inserito non corrisponde a una chiave API di rendering.",
    compileADocumentN624LatexMain: "Compila un documento: n624-latex main.tex",
    projectDirectoryOrZip: "directory del progetto o file .zip",
    writeOneStructuredJsonResultTo:
      "Scrivi un risultato JSON strutturato sullo standard output",
    compileATexDocumentWithThis: "Compila un documento TeX con questo motore",
    writeThePdfToThisPath: "Scrivi il PDF in questo percorso",
    runN624LatexSetupToConfigure:
      "Esegui n624-latex setup per configurare il client di rendering.",
    removeTheStoredApiKey: "Rimuovi la chiave API salvata",
    installOrUpdateTheManagedCross:
      "Installa o aggiorna il client multipiattaforma gestito",
    clientDistributionBaseUrl: "URL di base della distribuzione del client",
    managedInstallationDirectory: "Directory di installazione gestita",
    commandLauncherDirectory: "Directory dei programmi di avvio dei comandi",
    storeARenderApiKeyRead:
      "Salva una chiave API di rendering letta dallo standard input",
    openTheLoopbackOnlyLocalSetup:
      "Apri l’interfaccia web di configurazione locale limitata al loopback",
    skillTarget: "Destinazione delle abilità",
    mcpTarget: "Destinazione di registrazione MCP",
    configureAiIntegrationsForAWinget:
      "Configura le integrazioni IA per un’installazione WinGet o Homebrew",
    thisCommandIsForWingetOr:
      "Questo comando è per installazioni WinGet o Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Ispeziona il client gestito senza modificarlo",
    repairOnlySettingsOwnedByThis:
      "Ripara solo le impostazioni appartenenti a questa installazione",
    removeTheManagedClientAndOwned:
      "Rimuovi il client gestito e le sue integrazioni",
    confirmRemoval: "Conferma rimozione",
    keepTheStoredRenderApiKey: "Conserva la chiave API di rendering salvata",
    keepInstalledCodexAndClaudeSkills:
      "Conserva le abilità installate per Codex e Claude",
    managedClientIsNotInstalled: "Il client gestito non è installato.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Esegui la diagnostica di runtime, installazione, credenziali, abilità e configurazione MCP",
    reuseAnUploadedSource: "Riutilizza una sorgente già caricata",
    texEntrypoint: "Punto di ingresso TeX",
    outputDirectory: "Directory di output",
    alsoExportEachOutermostMathAnd:
      "Esporta in SVG anche ogni oggetto matematico e TikZ di livello più esterno",
    openThePdfAfterSuccess: "Apri il PDF in caso di successo",
    pdfWasSavedButOpeningIt:
      "Il PDF è stato salvato, ma l’apertura non è riuscita. Apri manualmente il PDF salvato.",
    manageSavedProjectsSharedWithWeb:
      "Gestisci i progetti salvati condivisi con Web e MCP",
    revisionDisplayName: "Nome visualizzato della revisione",
    usePdfAndSvgAsInitial: "Usa PDF e SVG come output iniziali predefiniti",
    queueAJobForAnExact:
      "Accoda un processo per una specifica revisione salvata",
    usePdfAndSvgInsteadOf:
      "Usa PDF e SVG al posto dei valori predefiniti della revisione",
    uploadALocalSourceAndAttach:
      "caricare una sorgente locale e collegare una revisione immutabile del progetto",
    downloadTheCommittedPdfWithoutWaiting:
      "scaricare il PDF confermato senza attendere SVG",
    generateSelectedPreviewPages1100:
      "generare anteprime solo per le pagine scelte (1–100)",
    thisInstallationDoesNotContainThe:
      "Questa installazione non include la CLI amministrativa.",
    partialSuccessPdfAndPreviewsWere:
      "Successo parziale: PDF e anteprime salvati. SVG non riuscito. Usare jobs retry-svg per riprovare senza ricompilare il PDF.",
  }),
  ru: () => ({
    configuredIntegration: "Настроено: {item}",
    preservedIntegration: "Сохранено: {item}",
    sourceUploaded: "Источник {id} загружен.",
    sourceReused: "Источник {id} использован повторно.",
    projectDeleted: "Проект {id} удалён.",
    renderEnded: "Преобразование завершено ({status}).",
    inputUploaded: "Источник {id} загружен.",
    inputReused: "Источник {id} использован повторно.",
    jobReserved: "Зарезервировано",
    jobUploading: "Отправка",
    jobWaiting: "В очереди",
    jobValidating: "Проверка",
    jobRunning: "Конвертация",
    jobSucceeded: "Успешно",
    jobFailed: "Ошибка",
    jobTimeout: "Превышено время",
    jobCanceled: "Отменено",
    jobRejected: "Отклонено",
    jobDeleting: "Удаление",
    jobDeleted: "Удалено",
    jobExpired: "Истёк срок",
    cancelRequested: "{id}: запрошена отмена.",
    deleteRequested: "{id}: запрошено удаление.",
    jobQueued: "Задание {id}: поставлено в очередь.",
    downloadComplete: "Место сохранения скачанных артефактов: {directory}",
    setupStatus: "Состояние настройки: {status}",
    repairedItems: "Исправлено управляемых элементов: {count}",
    preservedItems:
      "Сохранено изменённых или не принадлежащих установке элементов: {count}",
    setupGuiCannotBeCombinedWith:
      "Нельзя одновременно использовать setup --gui и --json.",
    setupGuiCannotBeCombinedWith2:
      "Нельзя одновременно использовать setup --gui и --api-key-stdin.",
    credentialStored: "Учётные данные: сохранено.",
    credentialIsConfigured: "Учётные данные: настроено.",
    connectionStatus:
      "Адрес подключения: {origin}\nИсточник учётных данных: {source}",
    noCredentialSource: "отсутствует",
    credentialRemoved: "Учётные данные: удалено.",
    svgRetrySucceededOriginalPdfRetained:
      "Повторная обработка SVG выполнена успешно. Исходный PDF сохраняется.",
    partialSuccessOriginalPdfRetainedSvg:
      "Частичный успех. Повторная обработка SVG не удалась. Исходный PDF сохраняется.",
    specifyEitherAProjectPathOr:
      "Укажите ровно один вариант: путь проекта или --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Средство запуска пакета. Требуется: абсолютные пути.",
    inputIsNotARenderApi:
      "Введено не то значение. Ожидается: ключ API рендеринга.",
    compileADocumentN624LatexMain:
      "Скомпилировать документ: n624-latex main.tex",
    projectDirectoryOrZip: "каталог проекта или файл .zip",
    writeOneStructuredJsonResultTo:
      "Записать один структурированный результат JSON в stdout",
    compileATexDocumentWithThis: "Скомпилировать документ TeX этим движком",
    writeThePdfToThisPath: "Записать PDF по этому пути",
    runN624LatexSetupToConfigure:
      "Запустите n624-latex setup, чтобы настроить клиент рендеринга.",
    removeTheStoredApiKey: "Удалить сохранённый ключ API",
    installOrUpdateTheManagedCross:
      "Установить или обновить управляемый кроссплатформенный клиент",
    clientDistributionBaseUrl: "Базовый URL дистрибутива клиента",
    managedInstallationDirectory: "Каталог управляемой установки",
    commandLauncherDirectory: "Каталог средств запуска команд",
    storeARenderApiKeyRead:
      "Сохранить ключ API рендеринга, прочитанный из stdin",
    openTheLoopbackOnlyLocalSetup:
      "Открыть локальный веб-интерфейс настройки, доступный только через loopback",
    skillTarget: "Цель установки навыков",
    mcpTarget: "Цель регистрации MCP",
    configureAiIntegrationsForAWinget:
      "Настроить интеграции с ИИ для установки через WinGet или Homebrew",
    thisCommandIsForWingetOr:
      "Эта команда предназначена для установок через WinGet или Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Проверить управляемый клиент без изменений",
    repairOnlySettingsOwnedByThis:
      "Восстановить только настройки, принадлежащие этой установке",
    removeTheManagedClientAndOwned:
      "Удалить управляемый клиент и принадлежащие установке интеграции",
    confirmRemoval: "Подтвердить удаление",
    keepTheStoredRenderApiKey: "Сохранить имеющийся ключ API рендеринга",
    keepInstalledCodexAndClaudeSkills:
      "Сохранить установленные навыки Codex и Claude",
    managedClientIsNotInstalled: "Управляемый клиент не установлен.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Диагностировать среду выполнения, установку, учётные данные, навыки и настройку MCP",
    reuseAnUploadedSource: "Повторно использовать загруженный источник",
    texEntrypoint: "Точка входа TeX",
    outputDirectory: "Каталог вывода",
    alsoExportEachOutermostMathAnd:
      "Также экспортировать каждый объект формулы и TikZ внешнего уровня в SVG",
    openThePdfAfterSuccess: "Открыть PDF после успешного завершения",
    pdfWasSavedButOpeningIt:
      "PDF сохранён, но открыть его не удалось. Откройте сохранённый PDF вручную.",
    manageSavedProjectsSharedWithWeb:
      "Управлять сохранёнными проектами, общими с веб-приложением и MCP",
    revisionDisplayName: "Отображаемое имя ревизии",
    usePdfAndSvgAsInitial:
      "Использовать PDF и SVG как исходные форматы вывода по умолчанию",
    queueAJobForAnExact:
      "Поставить в очередь задание для конкретной сохранённой ревизии",
    usePdfAndSvgInsteadOf:
      "Использовать PDF и SVG вместо форматов ревизии по умолчанию",
    uploadALocalSourceAndAttach:
      "загрузить локальные исходники и привязать неизменяемую ревизию проекта",
    downloadTheCommittedPdfWithoutWaiting:
      "скачать зафиксированный PDF, не ожидая SVG",
    generateSelectedPreviewPages1100:
      "создать предпросмотр только выбранных страниц (1–100)",
    thisInstallationDoesNotContainThe:
      "В этой установке нет CLI администратора.",
    partialSuccessPdfAndPreviewsWere:
      "Частичный успех: PDF и предпросмотры сохранены. Сбой SVG. Повторите SVG через jobs retry-svg без перекомпиляции PDF.",
  }),
  tr: () => ({
    configuredIntegration: "Yapılandırıldı: {item}",
    preservedIntegration: "Korundu: {item}",
    sourceUploaded: "{id} kaynağı yüklendi.",
    sourceReused: "{id} kaynağı yeniden kullanıldı.",
    projectDeleted: "{id} projesi silindi.",
    renderEnded: "Dönüştürme sona erdi ({status}).",
    inputUploaded: "{id} kaynağı yüklendi.",
    inputReused: "{id} kaynağı yeniden kullanıldı.",
    jobReserved: "Ayrıldı",
    jobUploading: "Yükleniyor",
    jobWaiting: "Sırada",
    jobValidating: "Doğrulanıyor",
    jobRunning: "Dönüştürülüyor",
    jobSucceeded: "Başarılı",
    jobFailed: "Başarısız",
    jobTimeout: "Zaman aşımı",
    jobCanceled: "İptal edildi",
    jobRejected: "Reddedildi",
    jobDeleting: "Siliniyor",
    jobDeleted: "Silindi",
    jobExpired: "Süresi doldu",
    cancelRequested: "{id}: iptal istendi.",
    deleteRequested: "{id}: silme istendi.",
    jobQueued: "İş {id}: kuyruğa alındı.",
    downloadComplete: "İndirilen çıktıların konumu: {directory}",
    setupStatus: "Kurulum durumu: {status}",
    repairedItems: "Onarılan yönetilen öğe sayısı: {count}",
    preservedItems:
      "Korunan, kuruluma ait olmayan veya değiştirilmiş öğe sayısı: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui ve --json birlikte kullanılamaz.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui ve --api-key-stdin birlikte kullanılamaz.",
    credentialStored: "Kimlik bilgisi: kaydedildi.",
    credentialIsConfigured: "Kimlik bilgisi: yapılandırıldı.",
    connectionStatus:
      "Bağlantı adresi: {origin}\nKimlik bilgisi kaynağı: {source}",
    noCredentialSource: "yok",
    credentialRemoved: "Kimlik bilgisi: kaldırıldı.",
    svgRetrySucceededOriginalPdfRetained:
      "SVG yeniden denemesi başarılı oldu. Özgün PDF korunur.",
    partialSuccessOriginalPdfRetainedSvg:
      "Kısmi başarı. SVG yeniden denemesi başarısız oldu. Özgün PDF korunur.",
    specifyEitherAProjectPathOr: "Tam birini seçin: proje yolu veya --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Paket başlatıcısı — Gereken: mutlak yollar.",
    inputIsNotARenderApi: "Girdi beklenen türde değil: işleme API anahtarı.",
    compileADocumentN624LatexMain: "Belge derle: n624-latex main.tex",
    projectDirectoryOrZip: "proje dizini veya .zip dosyası",
    writeOneStructuredJsonResultTo:
      "Standart çıktıya yapılandırılmış tek bir JSON sonucu yaz",
    compileATexDocumentWithThis: "TeX belgesini bu motorla derle",
    writeThePdfToThisPath: "PDF’yi bu yola yaz",
    runN624LatexSetupToConfigure:
      "İşleme istemcisini yapılandırmak için n624-latex setup komutunu çalıştırın.",
    removeTheStoredApiKey: "Kayıtlı API anahtarını kaldır",
    installOrUpdateTheManagedCross:
      "Yönetilen çok platformlu istemciyi yükle veya güncelle",
    clientDistributionBaseUrl: "İstemci dağıtımının temel URL’si",
    managedInstallationDirectory: "Yönetilen kurulum dizini",
    commandLauncherDirectory: "Komut başlatıcıları dizini",
    storeARenderApiKeyRead:
      "Standart girdiden okunan işleme API anahtarını sakla",
    openTheLoopbackOnlyLocalSetup:
      "Yalnızca geri döngüden erişilen yerel kurulum web arayüzünü aç",
    skillTarget: "Becerilerin kurulum hedefi",
    mcpTarget: "MCP kayıt hedefi",
    configureAiIntegrationsForAWinget:
      "WinGet veya Homebrew kurulumu için yapay zekâ entegrasyonlarını yapılandır",
    thisCommandIsForWingetOr:
      "Bu komut WinGet veya Homebrew kurulumları içindir.",
    inspectTheManagedClientWithoutChanging:
      "Yönetilen istemciyi değiştirmeden incele",
    repairOnlySettingsOwnedByThis: "Yalnızca bu kuruluma ait ayarları onar",
    removeTheManagedClientAndOwned:
      "Yönetilen istemciyi ve bu kuruluma ait entegrasyonları kaldır",
    confirmRemoval: "Kaldırmayı onayla",
    keepTheStoredRenderApiKey: "Kayıtlı işleme API anahtarını koru",
    keepInstalledCodexAndClaudeSkills:
      "Yüklü Codex ve Claude becerilerini koru",
    managedClientIsNotInstalled: "Yönetilen istemci yüklü değil.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Çalışma ortamını, kurulumu, kimlik bilgilerini, becerileri ve MCP ayarlarını tanıla",
    reuseAnUploadedSource: "Yüklenmiş kaynağı yeniden kullan",
    texEntrypoint: "TeX giriş noktası",
    outputDirectory: "Çıktı dizini",
    alsoExportEachOutermostMathAnd:
      "En dış düzeydeki her matematik ve TikZ nesnesini ayrıca SVG olarak dışa aktar",
    openThePdfAfterSuccess: "Başarılı olunca PDF’yi aç",
    pdfWasSavedButOpeningIt:
      "PDF kaydedildi ancak açılamadı. Kaydedilen PDF’yi elle açın.",
    manageSavedProjectsSharedWithWeb:
      "Web ve MCP ile paylaşılan kayıtlı projeleri yönet",
    revisionDisplayName: "Revizyonun görünen adı",
    usePdfAndSvgAsInitial: "İlk varsayılan çıktılar olarak PDF ve SVG kullan",
    queueAJobForAnExact: "Belirli bir kayıtlı revizyon için işi kuyruğa ekle",
    usePdfAndSvgInsteadOf:
      "Revizyonun varsayılan çıktıları yerine PDF ve SVG kullan",
    uploadALocalSourceAndAttach:
      "yerel kaynağı yükle ve değişmez proje revizyonunu iliştir",
    downloadTheCommittedPdfWithoutWaiting:
      "SVG’yi beklemeden kesinleşen PDF’yi indir",
    generateSelectedPreviewPages1100:
      "yalnızca seçilen sayfalar (1–100) için önizleme oluştur",
    thisInstallationDoesNotContainThe:
      "Bu kurulum yönetici CLI’sini içermiyor.",
    partialSuccessPdfAndPreviewsWere:
      "Kısmi başarı: PDF ve önizlemeler kaydedildi. SVG başarısız oldu. PDF’yi yeniden derlemeden SVG’yi yeniden denemek için jobs retry-svg kullanın.",
  }),
  pl: () => ({
    configuredIntegration: "Skonfigurowano: {item}",
    preservedIntegration: "Zachowano: {item}",
    sourceUploaded: "Przesłano źródło {id}.",
    sourceReused: "Ponownie użyto źródła {id}.",
    projectDeleted: "Usunięto projekt {id}.",
    renderEnded: "Konwersja została zakończona ({status}).",
    inputUploaded: "Przesłano źródło {id}.",
    inputReused: "Ponownie użyto źródła {id}.",
    jobReserved: "Zarezerwowano",
    jobUploading: "Wysyłanie",
    jobWaiting: "W kolejce",
    jobValidating: "Weryfikacja",
    jobRunning: "Konwertowanie",
    jobSucceeded: "Zakończono",
    jobFailed: "Błąd konwersji",
    jobTimeout: "Przekroczono czas",
    jobCanceled: "Anulowano",
    jobRejected: "Odrzucono",
    jobDeleting: "Usuwanie",
    jobDeleted: "Usunięto",
    jobExpired: "Wygasło",
    cancelRequested: "{id}: zażądano anulowania.",
    deleteRequested: "{id}: zażądano usunięcia.",
    jobQueued: "Zadanie {id}: dodano do kolejki.",
    downloadComplete: "Miejsce zapisu pobranych artefaktów: {directory}",
    setupStatus: "Stan konfiguracji: {status}",
    repairedItems: "Naprawione zarządzane elementy: {count}",
    preservedItems:
      "Zachowane elementy zmienione lub nienależące do instalacji: {count}",
    setupGuiCannotBeCombinedWith: "Nie można łączyć setup --gui i --json.",
    setupGuiCannotBeCombinedWith2:
      "Nie można łączyć setup --gui i --api-key-stdin.",
    credentialStored: "Dane uwierzytelniające: zapisano.",
    credentialIsConfigured: "Dane uwierzytelniające: skonfigurowano.",
    connectionStatus:
      "Adres połączenia: {origin}\nŹródło danych uwierzytelniających: {source}",
    noCredentialSource: "brak",
    credentialRemoved: "Dane uwierzytelniające: usunięto.",
    svgRetrySucceededOriginalPdfRetained:
      "Ponowienie SVG powiodło się. Oryginalny PDF zostaje zachowany.",
    partialSuccessOriginalPdfRetainedSvg:
      "Częściowy sukces. Ponowienie SVG nie powiodło się. Oryginalny PDF zostaje zachowany.",
    specifyEitherAProjectPathOr:
      "Wybierz dokładnie jedną opcję: ścieżka projektu lub --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Program uruchamiający pakiet — wymagane: ścieżki bezwzględne.",
    inputIsNotARenderApi:
      "Wartość wejściowa nie odpowiada typowi: klucz API renderowania.",
    compileADocumentN624LatexMain: "Skompiluj dokument: n624-latex main.tex",
    projectDirectoryOrZip: "katalog projektu lub plik .zip",
    writeOneStructuredJsonResultTo:
      "Zapisz jeden ustrukturyzowany wynik JSON na standardowym wyjściu",
    compileATexDocumentWithThis: "Skompiluj dokument TeX tym silnikiem",
    writeThePdfToThisPath: "Zapisz PDF pod tą ścieżką",
    runN624LatexSetupToConfigure:
      "Uruchom n624-latex setup, aby skonfigurować klienta renderowania.",
    removeTheStoredApiKey: "Usuń zapisany klucz API",
    installOrUpdateTheManagedCross:
      "Zainstaluj lub zaktualizuj zarządzanego klienta wieloplatformowego",
    clientDistributionBaseUrl: "Bazowy URL dystrybucji klienta",
    managedInstallationDirectory: "Katalog zarządzanej instalacji",
    commandLauncherDirectory: "Katalog programów uruchamiających polecenia",
    storeARenderApiKeyRead:
      "Zapisz klucz API renderowania ze standardowego wejścia",
    openTheLoopbackOnlyLocalSetup:
      "Otwórz lokalny interfejs konfiguracji dostępny tylko przez pętlę zwrotną",
    skillTarget: "Miejsce instalacji umiejętności",
    mcpTarget: "Miejsce rejestracji MCP",
    configureAiIntegrationsForAWinget:
      "Skonfiguruj integracje z AI dla instalacji przez WinGet lub Homebrew",
    thisCommandIsForWingetOr:
      "To polecenie jest przeznaczone dla instalacji przez WinGet lub Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Sprawdź zarządzanego klienta bez wprowadzania zmian",
    repairOnlySettingsOwnedByThis:
      "Napraw tylko ustawienia należące do tej instalacji",
    removeTheManagedClientAndOwned:
      "Usuń zarządzanego klienta i należące do instalacji integracje",
    confirmRemoval: "Potwierdź usunięcie",
    keepTheStoredRenderApiKey: "Zachowaj zapisany klucz API renderowania",
    keepInstalledCodexAndClaudeSkills:
      "Zachowaj zainstalowane umiejętności Codex i Claude",
    managedClientIsNotInstalled: "Zarządzany klient nie jest zainstalowany.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Zdiagnozuj środowisko wykonawcze, instalację, dane uwierzytelniające, umiejętności i konfigurację MCP",
    reuseAnUploadedSource: "Użyj ponownie przesłanego źródła",
    texEntrypoint: "Punkt wejścia TeX",
    outputDirectory: "Katalog wyjściowy",
    alsoExportEachOutermostMathAnd:
      "Eksportuj także każdy zewnętrzny obiekt matematyczny i TikZ jako osobny SVG",
    openThePdfAfterSuccess: "Otwórz PDF po pomyślnym zakończeniu",
    pdfWasSavedButOpeningIt:
      "Zapisano PDF, ale nie udało się go otworzyć. Otwórz zapisany PDF ręcznie.",
    manageSavedProjectsSharedWithWeb:
      "Zarządzaj zapisanymi projektami wspólnymi dla Web i MCP",
    revisionDisplayName: "Nazwa wyświetlana rewizji",
    usePdfAndSvgAsInitial:
      "Użyj PDF i SVG jako początkowych domyślnych formatów wyjścia",
    queueAJobForAnExact:
      "Dodaj do kolejki zadanie dla konkretnej zapisanej rewizji",
    usePdfAndSvgInsteadOf: "Użyj PDF i SVG zamiast domyślnych formatów rewizji",
    uploadALocalSourceAndAttach:
      "prześlij lokalne źródło i dołącz niezmienną rewizję projektu",
    downloadTheCommittedPdfWithoutWaiting:
      "pobierz zatwierdzony PDF bez czekania na SVG",
    generateSelectedPreviewPages1100:
      "wygeneruj podgląd tylko wybranych stron (1–100)",
    thisInstallationDoesNotContainThe:
      "Ta instalacja nie zawiera administracyjnego CLI.",
    partialSuccessPdfAndPreviewsWere:
      "Częściowy sukces: zapisano PDF i podglądy. SVG nie powiodło się. Użyj jobs retry-svg, aby ponowić SVG bez rekompilacji PDF.",
  }),
  cs: () => ({
    configuredIntegration: "Nakonfigurováno: {item}",
    preservedIntegration: "Zachováno: {item}",
    sourceUploaded: "Zdroj {id} byl nahrán.",
    sourceReused: "Zdroj {id} byl použit znovu.",
    projectDeleted: "Projekt {id} byl odstraněn.",
    renderEnded: "Převod skončil ({status}).",
    inputUploaded: "Zdroj {id} byl nahrán.",
    inputReused: "Zdroj {id} byl použit znovu.",
    jobReserved: "Rezervováno",
    jobUploading: "Nahrávání",
    jobWaiting: "Ve frontě",
    jobValidating: "Ověřování",
    jobRunning: "Převádění",
    jobSucceeded: "Úspěšné",
    jobFailed: "Selhalo",
    jobTimeout: "Vypršel čas",
    jobCanceled: "Zrušeno",
    jobRejected: "Odmítnuto",
    jobDeleting: "Mazání",
    jobDeleted: "Smazáno",
    jobExpired: "Vypršelo",
    cancelRequested: "{id}: vyžádáno zrušení.",
    deleteRequested: "{id}: vyžádáno odstranění.",
    jobQueued: "Úloha {id}: zařazeno do fronty.",
    downloadComplete: "Umístění stažených artefaktů: {directory}",
    setupStatus: "Stav nastavení: {status}",
    repairedItems: "Opravené spravované položky: {count}",
    preservedItems:
      "Zachované položky změněné nebo nepatřící instalaci: {count}",
    setupGuiCannotBeCombinedWith: "Nelze kombinovat setup --gui a --json.",
    setupGuiCannotBeCombinedWith2:
      "Nelze kombinovat setup --gui a --api-key-stdin.",
    credentialStored: "Přihlašovací údaj: uloženo.",
    credentialIsConfigured: "Přihlašovací údaj: nastaveno.",
    connectionStatus:
      "Adresa připojení: {origin}\nZdroj přihlašovacích údajů: {source}",
    noCredentialSource: "žádný",
    credentialRemoved: "Přihlašovací údaj: odstraněno.",
    svgRetrySucceededOriginalPdfRetained:
      "Opakování SVG bylo úspěšné. Původní PDF zůstane zachováno.",
    partialSuccessOriginalPdfRetainedSvg:
      "Částečný úspěch. Opakování SVG se nezdařilo. Původní PDF zůstane zachováno.",
    specifyEitherAProjectPathOr:
      "Zadejte právě jednu možnost: cesta projektu nebo --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Spouštěč balíčku – vyžaduje se: absolutní cesty.",
    inputIsNotARenderApi:
      "Zadaná hodnota neodpovídá typu: klíč API pro vykreslování.",
    compileADocumentN624LatexMain: "Zkompilovat dokument: n624-latex main.tex",
    projectDirectoryOrZip: "adresář projektu nebo soubor .zip",
    writeOneStructuredJsonResultTo:
      "Vypsat jeden strukturovaný výsledek JSON na standardní výstup",
    compileATexDocumentWithThis: "Zkompilovat dokument TeXu tímto enginem",
    writeThePdfToThisPath: "Zapsat PDF na tuto cestu",
    runN624LatexSetupToConfigure:
      "Spuštěním n624-latex setup nastavte klienta vykreslování.",
    removeTheStoredApiKey: "Odebrat uložený klíč API",
    installOrUpdateTheManagedCross:
      "Nainstalovat nebo aktualizovat spravovaného multiplatformního klienta",
    clientDistributionBaseUrl: "Základní URL distribuce klienta",
    managedInstallationDirectory: "Adresář spravované instalace",
    commandLauncherDirectory: "Adresář spouštěčů příkazů",
    storeARenderApiKeyRead:
      "Uložit klíč API pro vykreslování přečtený ze standardního vstupu",
    openTheLoopbackOnlyLocalSetup:
      "Otevřít místní webové nastavení dostupné jen přes zpětnou smyčku",
    skillTarget: "Cíl instalace dovedností",
    mcpTarget: "Cíl registrace MCP",
    configureAiIntegrationsForAWinget:
      "Nastavit integrace s AI pro instalaci přes WinGet nebo Homebrew",
    thisCommandIsForWingetOr:
      "Tento příkaz je určen pro instalace přes WinGet nebo Homebrew.",
    inspectTheManagedClientWithoutChanging:
      "Prověřit spravovaného klienta bez změn",
    repairOnlySettingsOwnedByThis:
      "Opravit jen nastavení patřící této instalaci",
    removeTheManagedClientAndOwned:
      "Odebrat spravovaného klienta a integrace, které mu patří",
    confirmRemoval: "Potvrdit odebrání",
    keepTheStoredRenderApiKey: "Zachovat uložený klíč API pro vykreslování",
    keepInstalledCodexAndClaudeSkills:
      "Zachovat nainstalované dovednosti pro Codex a Claude",
    managedClientIsNotInstalled: "Spravovaný klient není nainstalován.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnostikovat běhové prostředí, instalaci, přihlašovací údaje, dovednosti a nastavení MCP",
    reuseAnUploadedSource: "Znovu použít nahraný zdroj",
    texEntrypoint: "Vstupní bod TeXu",
    outputDirectory: "Výstupní adresář",
    alsoExportEachOutermostMathAnd:
      "Exportovat také každý matematický a TikZ objekt na nejvyšší úrovni do SVG",
    openThePdfAfterSuccess: "Po úspěchu otevřít PDF",
    pdfWasSavedButOpeningIt:
      "PDF bylo uloženo, ale nepodařilo se jej otevřít. Otevřete uložené PDF ručně.",
    manageSavedProjectsSharedWithWeb:
      "Spravovat uložené projekty sdílené s webem a MCP",
    revisionDisplayName: "Zobrazovaný název revize",
    usePdfAndSvgAsInitial: "Použít PDF a SVG jako počáteční výchozí výstupy",
    queueAJobForAnExact: "Zařadit do fronty úlohu pro přesnou uloženou revizi",
    usePdfAndSvgInsteadOf: "Použít PDF a SVG místo výchozích výstupů revize",
    uploadALocalSourceAndAttach:
      "nahrát místní zdroj a připojit neměnnou revizi projektu",
    downloadTheCommittedPdfWithoutWaiting:
      "stáhnout uložené PDF bez čekání na SVG",
    generateSelectedPreviewPages1100:
      "vygenerovat náhledy pouze vybraných stran (1–100)",
    thisInstallationDoesNotContainThe:
      "Tato instalace neobsahuje správcovské CLI.",
    partialSuccessPdfAndPreviewsWere:
      "Částečný úspěch: PDF a náhledy jsou uloženy. SVG selhalo. Pomocí jobs retry-svg zopakujte SVG bez opětovné kompilace PDF.",
  }),
  nl: () => ({
    configuredIntegration: "Geconfigureerd: {item}",
    preservedIntegration: "Behouden: {item}",
    sourceUploaded: "Bron {id} is geüpload.",
    sourceReused: "Bron {id} is opnieuw gebruikt.",
    projectDeleted: "Project {id} is verwijderd.",
    renderEnded: "De conversie is beëindigd ({status}).",
    inputUploaded: "Bron {id} is geüpload.",
    inputReused: "Bron {id} is opnieuw gebruikt.",
    jobReserved: "Gereserveerd",
    jobUploading: "Uploaden",
    jobWaiting: "In wachtrij",
    jobValidating: "Valideren",
    jobRunning: "Converteren",
    jobSucceeded: "Geslaagd",
    jobFailed: "Mislukt",
    jobTimeout: "Time-out",
    jobCanceled: "Geannuleerd",
    jobRejected: "Geweigerd",
    jobDeleting: "Verwijderen",
    jobDeleted: "Verwijderd",
    jobExpired: "Verlopen",
    cancelRequested: "{id}: annulering aangevraagd.",
    deleteRequested: "{id}: verwijdering aangevraagd.",
    jobQueued: "Taak {id}: in de wachtrij geplaatst.",
    downloadComplete: "Bestemming van de gedownloade artefacten: {directory}",
    setupStatus: "Installatiestatus: {status}",
    repairedItems: "Herstelde beheerde items: {count}",
    preservedItems:
      "Behouden gewijzigde items of items die niet van de installatie zijn: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui en --json kunnen niet samen worden gebruikt.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui en --api-key-stdin kunnen niet samen worden gebruikt.",
    credentialStored: "Inloggegevens: opgeslagen.",
    credentialIsConfigured: "Inloggegevens: geconfigureerd.",
    connectionStatus:
      "Oorsprong van de verbinding: {origin}\nBron van inloggegevens: {source}",
    noCredentialSource: "geen",
    credentialRemoved: "Inloggegevens: verwijderd.",
    svgRetrySucceededOriginalPdfRetained:
      "De nieuwe SVG-poging is geslaagd. De oorspronkelijke PDF blijft behouden.",
    partialSuccessOriginalPdfRetainedSvg:
      "Gedeeltelijk geslaagd. De nieuwe SVG-poging is mislukt. De oorspronkelijke PDF blijft behouden.",
    specifyEitherAProjectPathOr:
      "Geef precies één optie op: projectpad of --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Pakketstarter – vereist: absolute paden.",
    inputIsNotARenderApi:
      "De invoer is niet van het verwachte type: render-API-sleutel.",
    compileADocumentN624LatexMain: "Document compileren: n624-latex main.tex",
    projectDirectoryOrZip: "projectmap of .zip-bestand",
    writeOneStructuredJsonResultTo:
      "Eén gestructureerd JSON-resultaat naar standaarduitvoer schrijven",
    compileATexDocumentWithThis: "Een TeX-document compileren met deze engine",
    writeThePdfToThisPath: "PDF naar dit pad schrijven",
    runN624LatexSetupToConfigure:
      "Voer n624-latex setup uit om de renderclient in te stellen.",
    removeTheStoredApiKey: "Opgeslagen API-sleutel verwijderen",
    installOrUpdateTheManagedCross:
      "Beheerde platformonafhankelijke client installeren of bijwerken",
    clientDistributionBaseUrl: "Basis-URL van de clientdistributie",
    managedInstallationDirectory: "Beheerde installatiemap",
    commandLauncherDirectory: "Map voor opdrachtstarters",
    storeARenderApiKeyRead: "Render-API-sleutel uit de standaardinvoer opslaan",
    openTheLoopbackOnlyLocalSetup:
      "Lokale webinstallatie openen die alleen via loopback bereikbaar is",
    skillTarget: "Doel voor vaardigheden",
    mcpTarget: "Doel voor MCP-registratie",
    configureAiIntegrationsForAWinget:
      "AI-integraties instellen voor een WinGet- of Homebrew-installatie",
    thisCommandIsForWingetOr:
      "Deze opdracht is voor WinGet- of Homebrew-installaties.",
    inspectTheManagedClientWithoutChanging:
      "Beheerde client inspecteren zonder deze te wijzigen",
    repairOnlySettingsOwnedByThis:
      "Alleen instellingen van deze installatie herstellen",
    removeTheManagedClientAndOwned:
      "Beheerde client en bijbehorende integraties verwijderen",
    confirmRemoval: "Verwijdering bevestigen",
    keepTheStoredRenderApiKey: "Opgeslagen render-API-sleutel behouden",
    keepInstalledCodexAndClaudeSkills:
      "Geïnstalleerde Codex- en Claude-vaardigheden behouden",
    managedClientIsNotInstalled: "De beheerde client is niet geïnstalleerd.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Runtime, installatie, inloggegevens, vaardigheden en MCP-configuratie diagnosticeren",
    reuseAnUploadedSource: "Geüploade bron hergebruiken",
    texEntrypoint: "TeX-ingangspunt",
    outputDirectory: "Uitvoermap",
    alsoExportEachOutermostMathAnd:
      "Elk buitenste wiskunde- en TikZ-object ook als SVG exporteren",
    openThePdfAfterSuccess: "PDF openen na voltooiing",
    pdfWasSavedButOpeningIt:
      "De PDF is opgeslagen maar kon niet worden geopend. Open de opgeslagen PDF handmatig.",
    manageSavedProjectsSharedWithWeb:
      "Opgeslagen projecten beheren die met Web en MCP worden gedeeld",
    revisionDisplayName: "Weergavenaam van de revisie",
    usePdfAndSvgAsInitial: "PDF en SVG als eerste standaarduitvoer gebruiken",
    queueAJobForAnExact:
      "Een taak voor de opgegeven opgeslagen revisie in de wachtrij zetten",
    usePdfAndSvgInsteadOf:
      "PDF en SVG gebruiken in plaats van de standaarduitvoer van de revisie",
    uploadALocalSourceAndAttach:
      "lokale bron uploaden en een onveranderlijke projectrevisie koppelen",
    downloadTheCommittedPdfWithoutWaiting:
      "de vastgelegde PDF downloaden zonder op SVG te wachten",
    generateSelectedPreviewPages1100:
      "alleen voorbeelden voor geselecteerde pagina’s (1–100) genereren",
    thisInstallationDoesNotContainThe:
      "Deze installatie bevat geen beheer-CLI.",
    partialSuccessPdfAndPreviewsWere:
      "Gedeeltelijk geslaagd: PDF en voorbeelden zijn opgeslagen. SVG is mislukt. Probeer SVG opnieuw met jobs retry-svg zonder de PDF opnieuw te compileren.",
  }),
  sv: () => ({
    configuredIntegration: "Konfigurerat: {item}",
    preservedIntegration: "Bevarat: {item}",
    sourceUploaded: "Källa {id} laddades upp.",
    sourceReused: "Källa {id} återanvändes.",
    projectDeleted: "Projekt {id} raderades.",
    renderEnded: "Konverteringen avslutades ({status}).",
    inputUploaded: "Källa {id} laddades upp.",
    inputReused: "Källa {id} återanvändes.",
    jobReserved: "Reserverad",
    jobUploading: "Laddar upp",
    jobWaiting: "I kö",
    jobValidating: "Kontrollerar",
    jobRunning: "Konverterar",
    jobSucceeded: "Slutförd",
    jobFailed: "Misslyckades",
    jobTimeout: "Tidsgräns nådd",
    jobCanceled: "Avbruten",
    jobRejected: "Avvisad",
    jobDeleting: "Tar bort",
    jobDeleted: "Borttagen",
    jobExpired: "Utgången",
    cancelRequested: "{id}: avbrott begärt.",
    deleteRequested: "{id}: borttagning begärd.",
    jobQueued: "Jobb {id}: köat.",
    downloadComplete: "Plats för hämtade artefakter: {directory}",
    setupStatus: "Konfigurationsstatus: {status}",
    repairedItems: "Reparerade hanterade objekt: {count}",
    preservedItems:
      "Bevarade objekt som ändrats eller inte tillhör installationen: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui och --json kan inte användas tillsammans.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui och --api-key-stdin kan inte användas tillsammans.",
    credentialStored: "Inloggningsuppgift: sparat.",
    credentialIsConfigured: "Inloggningsuppgift: konfigurerat.",
    connectionStatus:
      "Anslutningens ursprung: {origin}\nKälla för inloggningsuppgifter: {source}",
    noCredentialSource: "ingen",
    credentialRemoved: "Inloggningsuppgift: borttaget.",
    svgRetrySucceededOriginalPdfRetained:
      "Det nya SVG-försöket lyckades. Den ursprungliga PDF-filen behålls.",
    partialSuccessOriginalPdfRetainedSvg:
      "Delvis lyckat. Det nya SVG-försöket misslyckades. Den ursprungliga PDF-filen behålls.",
    specifyEitherAProjectPathOr:
      "Ange exakt ett alternativ: projektsökväg eller --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Paketstartare – kräver: absoluta sökvägar.",
    inputIsNotARenderApi:
      "Indata har inte förväntad typ: API-nyckel för rendering.",
    compileADocumentN624LatexMain:
      "Kompilera ett dokument: n624-latex main.tex",
    projectDirectoryOrZip: "projektkatalog eller .zip-fil",
    writeOneStructuredJsonResultTo:
      "Skriv ett strukturerat JSON-resultat till standardutmatningen",
    compileATexDocumentWithThis: "Kompilera ett TeX-dokument med denna motor",
    writeThePdfToThisPath: "Skriv PDF-filen till denna sökväg",
    runN624LatexSetupToConfigure:
      "Kör n624-latex setup för att konfigurera renderingsklienten.",
    removeTheStoredApiKey: "Ta bort sparad API-nyckel",
    installOrUpdateTheManagedCross:
      "Installera eller uppdatera den hanterade plattformsoberoende klienten",
    clientDistributionBaseUrl: "Bas-URL till klientdistributionen",
    managedInstallationDirectory: "Hanterad installationskatalog",
    commandLauncherDirectory: "Katalog för kommandostartare",
    storeARenderApiKeyRead:
      "Spara en API-nyckel för rendering från standardinmatningen",
    openTheLoopbackOnlyLocalSetup:
      "Öppna det lokala konfigurationsgränssnittet som endast nås via loopback",
    skillTarget: "Installationsmål för färdigheter",
    mcpTarget: "Mål för MCP-registrering",
    configureAiIntegrationsForAWinget:
      "Konfigurera AI-integreringar för en WinGet- eller Homebrew-installation",
    thisCommandIsForWingetOr:
      "Det här kommandot är avsett för WinGet- eller Homebrew-installationer.",
    inspectTheManagedClientWithoutChanging:
      "Inspektera den hanterade klienten utan att ändra den",
    repairOnlySettingsOwnedByThis:
      "Reparera endast inställningar som tillhör denna installation",
    removeTheManagedClientAndOwned:
      "Ta bort den hanterade klienten och de integreringar som tillhör installationen",
    confirmRemoval: "Bekräfta borttagning",
    keepTheStoredRenderApiKey: "Behåll den sparade API-nyckeln för rendering",
    keepInstalledCodexAndClaudeSkills:
      "Behåll installerade färdigheter för Codex och Claude",
    managedClientIsNotInstalled: "Den hanterade klienten är inte installerad.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnostisera körmiljö, installation, inloggningsuppgifter, färdigheter och MCP-konfiguration",
    reuseAnUploadedSource: "Återanvänd en uppladdad källa",
    texEntrypoint: "TeX-startfil",
    outputDirectory: "Utdatakatalog",
    alsoExportEachOutermostMathAnd:
      "Exportera även varje matematik- och TikZ-objekt på yttersta nivån som SVG",
    openThePdfAfterSuccess: "Öppna PDF-filen vid lyckat resultat",
    pdfWasSavedButOpeningIt:
      "PDF-filen sparades men kunde inte öppnas. Öppna den sparade PDF-filen manuellt.",
    manageSavedProjectsSharedWithWeb:
      "Hantera sparade projekt som delas med webb och MCP",
    revisionDisplayName: "Revisionens visningsnamn",
    usePdfAndSvgAsInitial: "Använd PDF och SVG som inledande standardutdata",
    queueAJobForAnExact: "Köa ett jobb för en bestämd sparad revision",
    usePdfAndSvgInsteadOf:
      "Använd PDF och SVG i stället för revisionens standardutdata",
    uploadALocalSourceAndAttach:
      "ladda upp en lokal källa och koppla en oföränderlig projektrevision",
    downloadTheCommittedPdfWithoutWaiting:
      "hämta den fastställda PDF-filen utan att vänta på SVG",
    generateSelectedPreviewPages1100:
      "skapa förhandsvisningar enbart av valda sidor (1–100)",
    thisInstallationDoesNotContainThe:
      "Installationen innehåller inget administratörs-CLI.",
    partialSuccessPdfAndPreviewsWere:
      "Delvis lyckat: PDF och förhandsvisningar sparades. SVG misslyckades. Försök igen med jobs retry-svg utan att kompilera om PDF-filen.",
  }),
  no: () => ({
    configuredIntegration: "Konfigurert: {item}",
    preservedIntegration: "Beholdt: {item}",
    sourceUploaded: "Kilden {id} ble lastet opp.",
    sourceReused: "Kilden {id} ble brukt på nytt.",
    projectDeleted: "Prosjektet {id} ble slettet.",
    renderEnded: "Konverteringen ble avsluttet ({status}).",
    inputUploaded: "Kilden {id} ble lastet opp.",
    inputReused: "Kilden {id} ble brukt på nytt.",
    jobReserved: "Reservert",
    jobUploading: "Laster opp",
    jobWaiting: "I kø",
    jobValidating: "Kontrollerer",
    jobRunning: "Konverterer",
    jobSucceeded: "Fullført",
    jobFailed: "Mislyktes",
    jobTimeout: "Tidsavbrudd",
    jobCanceled: "Avbrutt",
    jobRejected: "Avvist",
    jobDeleting: "Sletter",
    jobDeleted: "Slettet",
    jobExpired: "Utløpt",
    cancelRequested: "{id}: avbrudd forespurt.",
    deleteRequested: "{id}: sletting forespurt.",
    jobQueued: "Jobb {id}: lagt i kø.",
    downloadComplete: "Plassering for nedlastede artefakter: {directory}",
    setupStatus: "Oppsettsstatus: {status}",
    repairedItems: "Reparerte administrerte elementer: {count}",
    preservedItems:
      "Beholdte elementer som er endret eller ikke tilhører installasjonen: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui og --json kan ikke brukes sammen.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui og --api-key-stdin kan ikke brukes sammen.",
    credentialStored: "Påloggingsinformasjon: lagret.",
    credentialIsConfigured: "Påloggingsinformasjon: konfigurert.",
    connectionStatus:
      "Tilkoblingens opprinnelse: {origin}\nKilde til påloggingsinformasjon: {source}",
    noCredentialSource: "ingen",
    credentialRemoved: "Påloggingsinformasjon: fjernet.",
    svgRetrySucceededOriginalPdfRetained:
      "Det nye SVG-forsøket lyktes. Den opprinnelige PDF-filen beholdes.",
    partialSuccessOriginalPdfRetainedSvg:
      "Delvis suksess. Det nye SVG-forsøket mislyktes. Den opprinnelige PDF-filen beholdes.",
    specifyEitherAProjectPathOr:
      "Angi nøyaktig ett alternativ: prosjektsti eller --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Pakkestarter – krever: absolutte stier.",
    inputIsNotARenderApi:
      "Inndataene har ikke forventet type: API-nøkkel for gjengivelse.",
    compileADocumentN624LatexMain: "Kompiler et dokument: n624-latex main.tex",
    projectDirectoryOrZip: "prosjektmappe eller .zip-fil",
    writeOneStructuredJsonResultTo:
      "Skriv ett strukturert JSON-resultat til standard utdata",
    compileATexDocumentWithThis: "Kompiler et TeX-dokument med denne motoren",
    writeThePdfToThisPath: "Skriv PDF-filen til denne stien",
    runN624LatexSetupToConfigure:
      "Kjør n624-latex setup for å konfigurere gjengivelsesklienten.",
    removeTheStoredApiKey: "Fjern lagret API-nøkkel",
    installOrUpdateTheManagedCross:
      "Installer eller oppdater den administrerte klienten for flere plattformer",
    clientDistributionBaseUrl: "Basis-URL for klientdistribusjonen",
    managedInstallationDirectory: "Administrert installasjonsmappe",
    commandLauncherDirectory: "Mappe for kommandostartere",
    storeARenderApiKeyRead:
      "Lagre en API-nøkkel for gjengivelse fra standard inndata",
    openTheLoopbackOnlyLocalSetup:
      "Åpne det lokale weboppsettet som kun nås via loopback",
    skillTarget: "Installasjonsmål for ferdigheter",
    mcpTarget: "Mål for MCP-registrering",
    configureAiIntegrationsForAWinget:
      "Konfigurer KI-integrasjoner for en WinGet- eller Homebrew-installasjon",
    thisCommandIsForWingetOr:
      "Denne kommandoen er for WinGet- eller Homebrew-installasjoner.",
    inspectTheManagedClientWithoutChanging:
      "Inspiser den administrerte klienten uten å endre den",
    repairOnlySettingsOwnedByThis:
      "Reparer bare innstillinger som tilhører denne installasjonen",
    removeTheManagedClientAndOwned:
      "Fjern den administrerte klienten og integrasjonene som tilhører installasjonen",
    confirmRemoval: "Bekreft fjerning",
    keepTheStoredRenderApiKey:
      "Behold den lagrede API-nøkkelen for gjengivelse",
    keepInstalledCodexAndClaudeSkills:
      "Behold installerte ferdigheter for Codex og Claude",
    managedClientIsNotInstalled:
      "Den administrerte klienten er ikke installert.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnostiser kjøremiljø, installasjon, påloggingsinformasjon, ferdigheter og MCP-oppsett",
    reuseAnUploadedSource: "Gjenbruk en opplastet kilde",
    texEntrypoint: "TeX-startfil",
    outputDirectory: "Utdatamappe",
    alsoExportEachOutermostMathAnd:
      "Eksporter også hvert matematikk- og TikZ-objekt på ytterste nivå som SVG",
    openThePdfAfterSuccess: "Åpne PDF-filen ved suksess",
    pdfWasSavedButOpeningIt:
      "PDF-filen ble lagret, men kunne ikke åpnes. Åpne den lagrede PDF-filen manuelt.",
    manageSavedProjectsSharedWithWeb:
      "Administrer lagrede prosjekter delt med nett og MCP",
    revisionDisplayName: "Revisjonens visningsnavn",
    usePdfAndSvgAsInitial: "Bruk PDF og SVG som opprinnelige standardutdata",
    queueAJobForAnExact: "Legg en jobb for en bestemt lagret revisjon i kø",
    usePdfAndSvgInsteadOf:
      "Bruk PDF og SVG i stedet for revisjonens standardutdata",
    uploadALocalSourceAndAttach:
      "last opp en lokal kilde og knytt til en uforanderlig prosjektrevisjon",
    downloadTheCommittedPdfWithoutWaiting:
      "last ned den ferdiglagrede PDF-en uten å vente på SVG",
    generateSelectedPreviewPages1100:
      "lag forhåndsvisninger bare av valgte sider (1–100)",
    thisInstallationDoesNotContainThe:
      "Denne installasjonen inneholder ikke administrasjons-CLI-et.",
    partialSuccessPdfAndPreviewsWere:
      "Delvis vellykket: PDF og forhåndsvisninger ble lagret. SVG mislyktes. Prøv SVG på nytt med jobs retry-svg uten å kompilere PDF-en på nytt.",
  }),
  da: () => ({
    configuredIntegration: "Konfigureret: {item}",
    preservedIntegration: "Bevaret: {item}",
    sourceUploaded: "Kilden {id} blev uploadet.",
    sourceReused: "Kilden {id} blev genbrugt.",
    projectDeleted: "Projektet {id} blev slettet.",
    renderEnded: "Konverteringen blev afsluttet ({status}).",
    inputUploaded: "Kilden {id} blev uploadet.",
    inputReused: "Kilden {id} blev genbrugt.",
    jobReserved: "Reserveret",
    jobUploading: "Uploader",
    jobWaiting: "I kø",
    jobValidating: "Kontrollerer",
    jobRunning: "Konverterer",
    jobSucceeded: "Gennemført",
    jobFailed: "Mislykkedes",
    jobTimeout: "Timeout",
    jobCanceled: "Annulleret",
    jobRejected: "Afvist",
    jobDeleting: "Sletter",
    jobDeleted: "Slettet",
    jobExpired: "Udløbet",
    cancelRequested: "{id}: annullering anmodet.",
    deleteRequested: "{id}: sletning anmodet.",
    jobQueued: "Job {id}: sat i kø.",
    downloadComplete: "Placering af hentede artefakter: {directory}",
    setupStatus: "Opsætningsstatus: {status}",
    repairedItems: "Reparerede administrerede elementer: {count}",
    preservedItems:
      "Bevarede elementer, som er ændret eller ikke tilhører installationen: {count}",
    setupGuiCannotBeCombinedWith:
      "setup --gui og --json kan ikke bruges sammen.",
    setupGuiCannotBeCombinedWith2:
      "setup --gui og --api-key-stdin kan ikke bruges sammen.",
    credentialStored: "Legitimationsoplysning: gemt.",
    credentialIsConfigured: "Legitimationsoplysning: konfigureret.",
    connectionStatus:
      "Forbindelsens oprindelse: {origin}\nKilde til legitimationsoplysninger: {source}",
    noCredentialSource: "ingen",
    credentialRemoved: "Legitimationsoplysning: fjernet.",
    svgRetrySucceededOriginalPdfRetained:
      "Det nye SVG-forsøg lykkedes. Den oprindelige PDF bevares.",
    partialSuccessOriginalPdfRetainedSvg:
      "Delvist fuldført. Det nye SVG-forsøg mislykkedes. Den oprindelige PDF bevares.",
    specifyEitherAProjectPathOr:
      "Angiv præcis én mulighed: projektsti eller --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Pakkestarter – kræver: absolutte stier.",
    inputIsNotARenderApi:
      "Input har ikke den forventede type: API-nøgle til gengivelse.",
    compileADocumentN624LatexMain: "Kompilér et dokument: n624-latex main.tex",
    projectDirectoryOrZip: "projektmappe eller .zip-fil",
    writeOneStructuredJsonResultTo:
      "Skriv ét struktureret JSON-resultat til standardoutput",
    compileATexDocumentWithThis: "Kompilér et TeX-dokument med denne motor",
    writeThePdfToThisPath: "Skriv PDF-filen til denne sti",
    runN624LatexSetupToConfigure:
      "Kør n624-latex setup for at konfigurere gengivelsesklienten.",
    removeTheStoredApiKey: "Fjern gemt API-nøgle",
    installOrUpdateTheManagedCross:
      "Installér eller opdatér den administrerede klient til flere platforme",
    clientDistributionBaseUrl: "Basis-URL til klientdistributionen",
    managedInstallationDirectory: "Administreret installationsmappe",
    commandLauncherDirectory: "Mappe til kommandostartere",
    storeARenderApiKeyRead: "Gem en API-nøgle til gengivelse fra standardinput",
    openTheLoopbackOnlyLocalSetup:
      "Åbn den lokale webopsætning, som kun er tilgængelig via loopback",
    skillTarget: "Installationsmål for færdigheder",
    mcpTarget: "Mål for MCP-registrering",
    configureAiIntegrationsForAWinget:
      "Konfigurér AI-integrationer til en WinGet- eller Homebrew-installation",
    thisCommandIsForWingetOr:
      "Denne kommando er til WinGet- eller Homebrew-installationer.",
    inspectTheManagedClientWithoutChanging:
      "Undersøg den administrerede klient uden at ændre den",
    repairOnlySettingsOwnedByThis:
      "Reparér kun indstillinger, der tilhører denne installation",
    removeTheManagedClientAndOwned:
      "Fjern den administrerede klient og de integrationer, den ejer",
    confirmRemoval: "Bekræft fjernelse",
    keepTheStoredRenderApiKey: "Behold den gemte API-nøgle til gengivelse",
    keepInstalledCodexAndClaudeSkills:
      "Behold installerede færdigheder til Codex og Claude",
    managedClientIsNotInstalled:
      "Den administrerede klient er ikke installeret.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Diagnosticér kørselsmiljø, installation, legitimationsoplysninger, færdigheder og MCP-opsætning",
    reuseAnUploadedSource: "Genbrug en uploadet kilde",
    texEntrypoint: "TeX-startfil",
    outputDirectory: "Outputmappe",
    alsoExportEachOutermostMathAnd:
      "Eksportér også hvert matematik- og TikZ-objekt på yderste niveau som SVG",
    openThePdfAfterSuccess: "Åbn PDF-filen ved succes",
    pdfWasSavedButOpeningIt:
      "PDF-filen blev gemt, men kunne ikke åbnes. Åbn den gemte PDF-fil manuelt.",
    manageSavedProjectsSharedWithWeb:
      "Administrér gemte projekter, som deles med web og MCP",
    revisionDisplayName: "Revisionens viste navn",
    usePdfAndSvgAsInitial: "Brug PDF og SVG som oprindeligt standardoutput",
    queueAJobForAnExact: "Sæt et job for en bestemt gemt revision i kø",
    usePdfAndSvgInsteadOf:
      "Brug PDF og SVG i stedet for revisionens standardoutput",
    uploadALocalSourceAndAttach:
      "upload en lokal kilde, og tilknyt en uforanderlig projektrevision",
    downloadTheCommittedPdfWithoutWaiting:
      "hent den gemte PDF uden at vente på SVG",
    generateSelectedPreviewPages1100:
      "opret kun forhåndsvisninger af valgte sider (1–100)",
    thisInstallationDoesNotContainThe:
      "Denne installation indeholder ikke administrations-CLI’en.",
    partialSuccessPdfAndPreviewsWere:
      "Delvist gennemført: PDF og forhåndsvisninger er gemt. SVG mislykkedes. Prøv SVG igen med jobs retry-svg uden at kompilere PDF’en igen.",
  }),
  fi: () => ({
    configuredIntegration: "Määritetty: {item}",
    preservedIntegration: "Säilytetty: {item}",
    sourceUploaded: "Lähde {id} lähetettiin.",
    sourceReused: "Lähdettä {id} käytettiin uudelleen.",
    projectDeleted: "Projekti {id} poistettiin.",
    renderEnded: "Muunnos päättyi ({status}).",
    inputUploaded: "Lähde {id} lähetettiin.",
    inputReused: "Lähdettä {id} käytettiin uudelleen.",
    jobReserved: "Varattu",
    jobUploading: "Lähetetään",
    jobWaiting: "Jonossa",
    jobValidating: "Tarkistetaan",
    jobRunning: "Muunnetaan",
    jobSucceeded: "Onnistui",
    jobFailed: "Epäonnistui",
    jobTimeout: "Aikakatkaisu",
    jobCanceled: "Keskeytetty",
    jobRejected: "Hylätty",
    jobDeleting: "Poistetaan",
    jobDeleted: "Poistettu",
    jobExpired: "Vanhentunut",
    cancelRequested: "{id}: peruutusta pyydetty.",
    deleteRequested: "{id}: poistoa pyydetty.",
    jobQueued: "Työ {id}: lisätty jonoon.",
    downloadComplete: "Ladattujen tulostiedostojen sijainti: {directory}",
    setupStatus: "Asetusten tila: {status}",
    repairedItems: "Korjattuja hallittuja kohteita: {count}",
    preservedItems:
      "Säilytettyjä muutettuja tai asennukseen kuulumattomia kohteita: {count}",
    setupGuiCannotBeCombinedWith:
      "Vaihtoehtoja setup --gui ja --json ei voi yhdistää.",
    setupGuiCannotBeCombinedWith2:
      "Vaihtoehtoja setup --gui ja --api-key-stdin ei voi yhdistää.",
    credentialStored: "Tunnistetieto: tallennettu.",
    credentialIsConfigured: "Tunnistetieto: määritetty.",
    connectionStatus:
      "Yhteyden osoite: {origin}\nTunnistetiedon lähde: {source}",
    noCredentialSource: "ei mitään",
    credentialRemoved: "Tunnistetieto: poistettu.",
    svgRetrySucceededOriginalPdfRetained:
      "SVG:n uusintayritys onnistui. Alkuperäinen PDF säilyy.",
    partialSuccessOriginalPdfRetainedSvg:
      "Osittainen onnistuminen. SVG:n uusintayritys epäonnistui. Alkuperäinen PDF säilyy.",
    specifyEitherAProjectPathOr:
      "Anna täsmälleen yksi vaihtoehdoista projektin polku ja --source.",
    thePackageLauncherMustSupplyAbsolute:
      "Paketin käynnistin – vaaditaan: absoluuttiset polut.",
    inputIsNotARenderApi:
      "Syöte ei vastaa odotettua tyyppiä: renderöinnin API-avain.",
    compileADocumentN624LatexMain: "Käännä asiakirja: n624-latex main.tex",
    projectDirectoryOrZip: "projektihakemisto tai .zip-tiedosto",
    writeOneStructuredJsonResultTo:
      "Kirjoita yksi rakenteinen JSON-tulos vakiotulosteeseen",
    compileATexDocumentWithThis: "Käännä TeX-asiakirja tällä moottorilla",
    writeThePdfToThisPath: "Kirjoita PDF tähän polkuun",
    runN624LatexSetupToConfigure:
      "Määritä renderöintiasiakas komennolla n624-latex setup.",
    removeTheStoredApiKey: "Poista tallennettu API-avain",
    installOrUpdateTheManagedCross:
      "Asenna tai päivitä hallittu monialustainen asiakasohjelma",
    clientDistributionBaseUrl: "Asiakasohjelman jakelun perus-URL",
    managedInstallationDirectory: "Hallitun asennuksen hakemisto",
    commandLauncherDirectory: "Komentokäynnistinten hakemisto",
    storeARenderApiKeyRead:
      "Tallenna vakiosyötteestä luettu renderöinnin API-avain",
    openTheLoopbackOnlyLocalSetup:
      "Avaa vain loopback-osoitteessa toimiva paikallinen asennussivu",
    skillTarget: "Taitojen asennuskohde",
    mcpTarget: "MCP-rekisteröinnin kohde",
    configureAiIntegrationsForAWinget:
      "Määritä WinGet- tai Homebrew-asennuksen tekoälyintegraatiot",
    thisCommandIsForWingetOr:
      "Tämä komento on tarkoitettu WinGet- tai Homebrew-asennuksille.",
    inspectTheManagedClientWithoutChanging:
      "Tarkista hallittu asiakasohjelma muuttamatta sitä",
    repairOnlySettingsOwnedByThis:
      "Korjaa vain tämän asennuksen omistamat asetukset",
    removeTheManagedClientAndOwned:
      "Poista hallittu asiakasohjelma ja sen omistamat integraatiot",
    confirmRemoval: "Vahvista poisto",
    keepTheStoredRenderApiKey: "Säilytä tallennettu renderöinnin API-avain",
    keepInstalledCodexAndClaudeSkills:
      "Säilytä asennetut Codex- ja Claude-taidot",
    managedClientIsNotInstalled: "Hallittua asiakasohjelmaa ei ole asennettu.",
    diagnoseRuntimeInstallationCredentialSkillAnd:
      "Tarkista suoritusympäristö, asennus, tunnistetiedot, taidot ja MCP-asetukset",
    reuseAnUploadedSource: "Käytä lähetettyä lähdettä uudelleen",
    texEntrypoint: "TeX-aloitustiedosto",
    outputDirectory: "Tulostushakemisto",
    alsoExportEachOutermostMathAnd:
      "Vie myös kukin uloimman tason kaava ja TikZ-objekti SVG-tiedostoksi",
    openThePdfAfterSuccess: "Avaa PDF onnistumisen jälkeen",
    pdfWasSavedButOpeningIt:
      "PDF tallennettiin, mutta sen avaaminen epäonnistui. Avaa tallennettu PDF käsin.",
    manageSavedProjectsSharedWithWeb:
      "Hallitse verkkosovelluksen ja MCP:n kanssa yhteisiä tallennettuja projekteja",
    revisionDisplayName: "Version näyttönimi",
    usePdfAndSvgAsInitial:
      "Käytä PDF:ää ja SVG:tä alkuperäisinä oletustulosteina",
    queueAJobForAnExact:
      "Lisää jonoon työ täsmälliselle tallennetulle versiolle",
    usePdfAndSvgInsteadOf:
      "Käytä PDF:ää ja SVG:tä version oletustulosteiden sijaan",
    uploadALocalSourceAndAttach:
      "lähetä paikallinen lähde ja liitä muuttumaton projektin versio",
    downloadTheCommittedPdfWithoutWaiting:
      "lataa vahvistettu PDF odottamatta SVG:tä",
    generateSelectedPreviewPages1100:
      "luo esikatselut vain valituista sivuista (1–100)",
    thisInstallationDoesNotContainThe:
      "Tämä asennus ei sisällä ylläpidon komentorivityökalua.",
    partialSuccessPdfAndPreviewsWere:
      "Onnistui osittain: PDF ja esikatselut tallennettiin. SVG epäonnistui. Yritä SVG:tä uudelleen komennolla jobs retry-svg kääntämättä PDF:ää uudelleen.",
  }),
};
const catalog = select[locale]?.() ?? english;
const setupDiagnostics = setupDiagnosticCatalog(locale);

type JobStatus = Extract<ClientCoreEvent, { type: "job.status" }>["status"];
const jobStatusMessages: Readonly<Record<JobStatus, Message>> = {
  reserved: "jobReserved",
  uploading: "jobUploading",
  queued: "jobWaiting",
  validating: "jobValidating",
  running: "jobRunning",
  succeeded: "jobSucceeded",
  failed: "jobFailed",
  timeout: "jobTimeout",
  canceled: "jobCanceled",
  rejected: "jobRejected",
  deleting: "jobDeleting",
  deleted: "jobDeleted",
  expired: "jobExpired",
};

export function humanJobStatus(status: JobStatus): string {
  return catalog[jobStatusMessages[status]];
}

export function humanText(
  key: Message,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return catalog[key].replaceAll(
    /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
    (match, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

const diagnostics: Readonly<Record<string, Message>> = {
  "setup --gui cannot be combined with --json": "setupGuiCannotBeCombinedWith",
  "setup --gui cannot be combined with --api-key-stdin":
    "setupGuiCannotBeCombinedWith2",
  "Specify either a project path or --source, not both":
    "specifyEitherAProjectPathOr",
  "The package launcher must supply absolute paths":
    "thePackageLauncherMustSupplyAbsolute",
  "Input is not a render API key": "inputIsNotARenderApi",
  "Run n624-latex setup to configure the renderer client":
    "runN624LatexSetupToConfigure",
  "skill target": "skillTarget",
  "MCP target": "mcpTarget",
  "This command is for WinGet or Homebrew installations":
    "thisCommandIsForWingetOr",
  "confirm removal": "confirmRemoval",
};

export function humanDiagnostic(message: string): string {
  const key = Object.hasOwn(diagnostics, message)
    ? diagnostics[message]
    : undefined;
  if (key !== undefined) return humanText(key);
  return Object.hasOwn(setupDiagnostics, message)
    ? (setupDiagnostics[message] ?? message)
    : message;
}
