import type { DisplayLocale } from "@latex-renderer/shared/locale";
type Catalog = Readonly<Record<string, string>>;
const translations: Partial<Record<DisplayLocale, () => Catalog>> = {
  ja: () => ({
    "A setup operation is already running":
      "ローカルセットアップの処理 はすでに進行中です。",
    "Bootstrap token is invalid or already used":
      "初期化トークンが無効か、すでに使用されています。",
    "CSRF token is invalid": "不正な値：CSRFトークン",
    "Client archive SHA-256 verification failed":
      "クライアントアーカイブのSHA-256の検証：処理に失敗しました。",
    "Client archive central directory is malformed":
      "ZIPの中央ディレクトリ が破損しています。",
    "Client archive central directory size is invalid":
      "不正な値：クライアントアーカイブの中央ディレクトリのサイズ",
    "Client archive data is truncated":
      "クライアントアーカイブの内容 が途中で切れています。",
    "Client archive end record was not found":
      "見つかりません：クライアントアーカイブの終端レコード",
    "Client archive entry is truncated":
      "クライアントアーカイブの項目 が途中で切れています。",
    "Client archive expanded size is invalid":
      "不正な値：展開後のクライアントアーカイブサイズ",
    "Client archive has too many entries":
      "クライアントアーカイブ：項目数が多すぎます。",
    "Client archive local and central headers do not match":
      "ZIPのローカルヘッダー と ZIPの中央ディレクトリヘッダー が一致しません。",
    "Client archive local header is malformed":
      "ZIPのローカルヘッダー が破損しています。",
    "Client archive payload is incomplete":
      "クライアントアーカイブの内容 が不完全です。",
    "Client archive size verification failed":
      "クライアントアーカイブのサイズの検証：処理に失敗しました。",
    "Client manifest is invalid": "不正な値：クライアントマニフェスト",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "現在のPATHにコマンドディレクトリがありません。新しいターミナルを開くか、PATHに追加してください。",
    "Command directory is present in PATH":
      "コマンドディレクトリはPATHに含まれています。",
    "Command launcher is installed": "コマンドランチャー：存在します。",
    "Command launcher is missing": "不足：コマンドランチャー",
    "Command launcher is not owned by this installation":
      "コマンドランチャーはこのインストールの所有物ではありません。",
    "Content-Type must be application/json":
      "Content-Type は application/json で指定してください。",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "認証情報 は現在のユーザーが所有し、モード0600の通常ファイルでなければなりません。",
    "Credential file permissions must be 0600":
      "認証情報ファイルのパーミッション は 0600 で指定してください。",
    "Credential path is not a regular file":
      "認証情報のパス は通常のファイルではありません。",
    "Cross-site requests are not allowed":
      "クロスサイトリクエスト は許可されていません。",
    "DPAPI credential can be decrypted by the current Windows account":
      "現在のWindowsアカウントでDPAPI認証情報を復号できます。",
    "Encrypted ZIP entries are not supported":
      "暗号化されたZIPエントリ はサポートされていません。",
    "Host header does not match the local listener":
      "Hostヘッダー と ローカルリスナー が一致しません。",
    "Input is not a render API key":
      "入力はレンダリング用APIキーではありません。",
    "Installation directory exists without managed state and will be preserved":
      "既存のインストールディレクトリに管理状態がありません。そのまま保持します。",
    "Installation failed; the previous client was restored.":
      "インストールに失敗し、以前のクライアントを復元しました。",
    "Installed client payload is incomplete; run setup to reinstall it":
      "クライアントのインストール内容が不完全です。setupを実行して再インストールしてください。",
    "Installed payload is missing":
      "インストール済みのクライアントファイル：見つかりません。",
    "Installed payload is present":
      "インストール済みのクライアントファイル：存在します。",
    "LaTeX Renderer client was removed.":
      "LaTeX Rendererクライアントを削除しました。",
    "Local setup endpoint was not found":
      "見つかりません：ローカルセットアップのエンドポイント",
    "Local setup operation failed":
      "ローカルセットアップ：処理に失敗しました。",
    "Local setup session is required": "必須：ローカルセットアップのセッション",
    "Loopback access is required": "必須：ループバック経由のアクセス",
    "Managed command launcher is current":
      "管理対象のコマンドランチャー：最新の状態です。",
    "Managed installation state has an unsupported format":
      "管理下のインストール状態：認識できない形式です。",
    "Managed installation state is not a regular file":
      "管理下のインストール状態 は通常のファイルではありません。",
    "Managed installation state is not valid JSON":
      "管理下のインストール状態 は 有効なJSON で指定してください。",
    "Managed installation state must be owned by the current user and not group/world writable":
      "管理下のインストール状態 は現在のユーザーが所有し、グループや他のユーザーに書き込みを許可しないでください。",
    "Managed installation state was not found":
      "管理下のインストール状態：見つかりません。",
    "Multi-disk or malformed ZIP archives are not supported":
      "分割ZIPや形式が不正なZIPには対応していません",
    "No stored DPAPI credential file was found":
      "見つかりません：保存済みのDPAPI認証情報ファイル",
    "Only local POST API requests are allowed":
      "ローカルからのPOST APIリクエストのみ許可されます。",
    "Open client settings with: n624-latex setup":
      "クライアント設定を開くコマンド：n624-latex setup",
    "Origin does not match the local setup UI":
      "Originヘッダー と ローカル設定画面 が一致しません。",
    "Protected credential file is present":
      "保護された認証情報ファイル：存在します。",
    "Render API credential is not configured": "未設定：Render APIの認証情報",
    "Render API credential is provided by the environment":
      "レンダリング用APIの認証情報は環境変数から取得します。",
    "Request URL is invalid": "不正な値：リクエストURL",
    "Request body is not valid JSON":
      "リクエスト本文 は 有効なJSON で指定してください。",
    "Request body is too large": "サイズ上限超過：リクエスト本文",
    "Request body must be a JSON object":
      "リクエスト本文 は JSONオブジェクト で指定してください。",
    "Setup Web UI did not receive a TCP address":
      "セットアップのWeb画面にTCPアドレスが割り当てられませんでした。",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "このWindowsアカウントでは保存済みのDPAPI認証情報を復号できませんでした。",
    "The stored DPAPI credential file could not be read":
      "保存済みのDPAPI認証情報ファイルを読み込めませんでした。",
    "Windows DPAPI credential storage failed":
      "Windows DPAPI認証情報の保存：処理に失敗しました。",
    "Windows DPAPI credential verification failed":
      "Windows DPAPI認証情報の検証：処理に失敗しました。",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShellでDPAPIの処理を初期化または完了できませんでした。",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windowsのインストール先とbinディレクトリには、引用符・セミコロン・制御文字を含まない絶対パスを使用してください。",
  }),
  "zh-CN": () => ({
    "A setup operation is already running": "本地设置操作 已在进行中。",
    "Bootstrap token is invalid or already used": "引导令牌无效或已使用。",
    "CSRF token is invalid": "无效值：CSRF 令牌",
    "Client archive SHA-256 verification failed":
      "客户端归档的 SHA-256验证：操作失败。",
    "Client archive central directory is malformed": "ZIP 中央目录 已损坏。",
    "Client archive central directory size is invalid":
      "无效值：客户端归档中央目录大小",
    "Client archive data is truncated": "客户端归档内容 已被截断。",
    "Client archive end record was not found": "未找到：客户端归档结束记录",
    "Client archive entry is truncated": "客户端归档条目 已被截断。",
    "Client archive expanded size is invalid": "无效值：客户端归档解压后大小",
    "Client archive has too many entries": "客户端归档：条目过多。",
    "Client archive local and central headers do not match":
      "ZIP 本地文件头 与 ZIP 中央目录文件头 不匹配。",
    "Client archive local header is malformed": "ZIP 本地文件头 已损坏。",
    "Client archive payload is incomplete": "客户端归档内容 不完整。",
    "Client archive size verification failed": "客户端归档大小验证：操作失败。",
    "Client manifest is invalid": "无效值：客户端清单",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "当前 PATH 中没有命令目录。请打开新终端或将目录加入 PATH。",
    "Command directory is present in PATH": "命令目录已在 PATH 中。",
    "Command launcher is installed": "命令启动器：已存在。",
    "Command launcher is missing": "缺少：命令启动器",
    "Command launcher is not owned by this installation":
      "该命令启动器不属于本安装。",
    "Content-Type must be application/json":
      "Content-Type：应为application/json。",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "凭据 必须是当前用户拥有且权限为 0600 的普通文件。",
    "Credential file permissions must be 0600": "凭据文件权限：应为0600。",
    "Credential path is not a regular file": "凭据路径 不是普通文件。",
    "Cross-site requests are not allowed": "不允许：跨站请求。",
    "DPAPI credential can be decrypted by the current Windows account":
      "当前 Windows 账号可以解密 DPAPI 凭据。",
    "Encrypted ZIP entries are not supported": "不支持：加密的 ZIP 条目。",
    "Host header does not match the local listener":
      "Host 请求头 与 本地监听器 不匹配。",
    "Input is not a render API key": "输入不是渲染 API 密钥。",
    "Installation directory exists without managed state and will be preserved":
      "现有安装目录没有受管理状态，将予以保留。",
    "Installation failed; the previous client was restored.":
      "安装失败，已恢复之前的客户端。",
    "Installed client payload is incomplete; run setup to reinstall it":
      "已安装的客户端内容不完整。请运行 setup 重新安装。",
    "Installed payload is missing": "已安装的客户端文件：未找到。",
    "Installed payload is present": "已安装的客户端文件：已存在。",
    "LaTeX Renderer client was removed.": "已移除 LaTeX Renderer 客户端。",
    "Local setup endpoint was not found": "未找到：本地设置端点",
    "Local setup operation failed": "本地设置：操作失败。",
    "Local setup session is required": "必填项：本地设置会话",
    "Loopback access is required": "必填项：回环访问",
    "Managed command launcher is current": "受管理的命令启动器：已是最新版本。",
    "Managed installation state has an unsupported format":
      "受管理的安装状态：格式无法识别。",
    "Managed installation state is not a regular file":
      "受管理的安装状态 不是普通文件。",
    "Managed installation state is not valid JSON":
      "受管理的安装状态：应为有效的 JSON。",
    "Managed installation state must be owned by the current user and not group/world writable":
      "受管理的安装状态 必须由当前用户拥有，且组和其他用户均不可写。",
    "Managed installation state was not found": "受管理的安装状态：未找到。",
    "Multi-disk or malformed ZIP archives are not supported":
      "不支持分卷或格式错误的 ZIP",
    "No stored DPAPI credential file was found":
      "未找到：已保存的 DPAPI 凭据文件",
    "Only local POST API requests are allowed": "只允许本地 POST API 请求。",
    "Open client settings with: n624-latex setup":
      "打开客户端设置的命令：n624-latex setup",
    "Origin does not match the local setup UI":
      "Origin 请求头 与 本地设置界面 不匹配。",
    "Protected credential file is present": "受保护的凭据文件：已存在。",
    "Render API credential is not configured": "未配置：Render API 凭据",
    "Render API credential is provided by the environment":
      "渲染 API 凭据由环境变量提供。",
    "Request URL is invalid": "无效值：请求 URL",
    "Request body is not valid JSON": "请求正文：应为有效的 JSON。",
    "Request body is too large": "超出大小限制：请求正文",
    "Request body must be a JSON object": "请求正文：应为JSON 对象。",
    "Setup Web UI did not receive a TCP address": "设置网页未获得 TCP 地址。",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "此 Windows 账号无法解密已保存的 DPAPI 凭据。",
    "The stored DPAPI credential file could not be read":
      "无法读取已保存的 DPAPI 凭据文件。",
    "Windows DPAPI credential storage failed":
      "存储Windows DPAPI 凭据：操作失败。",
    "Windows DPAPI credential verification failed":
      "Windows DPAPI 凭据验证：操作失败。",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell 无法初始化或完成 DPAPI 操作。",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windows 安装目录和 bin 目录必须是绝对路径，不得包含引号、分号或控制字符。",
  }),
  ko: () => ({
    "A setup operation is already running":
      "로컬 설정 작업: 이미 진행 중입니다.",
    "Bootstrap token is invalid or already used":
      "부트스트랩 토큰이 유효하지 않거나 이미 사용되었습니다.",
    "CSRF token is invalid": "잘못된 값: CSRF 토큰",
    "Client archive SHA-256 verification failed":
      "클라이언트 아카이브 SHA-256 검증: 작업이 실패했습니다.",
    "Client archive central directory is malformed":
      "ZIP 중앙 디렉터리: 손상되었습니다.",
    "Client archive central directory size is invalid":
      "잘못된 값: 클라이언트 아카이브 중앙 디렉터리 크기",
    "Client archive data is truncated":
      "클라이언트 아카이브 내용: 중간에 잘렸습니다.",
    "Client archive end record was not found":
      "찾을 수 없음: 클라이언트 아카이브 끝 레코드",
    "Client archive entry is truncated":
      "클라이언트 아카이브 항목: 중간에 잘렸습니다.",
    "Client archive expanded size is invalid":
      "잘못된 값: 클라이언트 아카이브 압축 해제 후 크기",
    "Client archive has too many entries":
      "클라이언트 아카이브: 항목이 너무 많습니다.",
    "Client archive local and central headers do not match":
      "불일치: ZIP 로컬 헤더 / ZIP 중앙 헤더.",
    "Client archive local header is malformed":
      "ZIP 로컬 헤더: 손상되었습니다.",
    "Client archive payload is incomplete":
      "클라이언트 아카이브 내용: 불완전합니다.",
    "Client archive size verification failed":
      "클라이언트 아카이브 크기 검증: 작업이 실패했습니다.",
    "Client manifest is invalid": "잘못된 값: 클라이언트 매니페스트",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "현재 PATH에 명령 디렉터리가 없습니다. 새 터미널을 열거나 디렉터리를 추가하세요.",
    "Command directory is present in PATH": "명령 디렉터리가 PATH에 있습니다.",
    "Command launcher is installed": "명령 실행기: 있습니다.",
    "Command launcher is missing": "누락: 명령 실행기",
    "Command launcher is not owned by this installation":
      "명령 실행기는 이 설치의 소유가 아닙니다.",
    "Content-Type must be application/json":
      "Content-Type: 필요한 형식 — application/json",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "자격 증명: 현재 사용자 소유의 권한 0600인 일반 파일이어야 합니다.",
    "Credential file permissions must be 0600":
      "자격 증명 파일 권한: 필요한 형식 — 0600",
    "Credential path is not a regular file":
      "자격 증명 경로: 일반 파일이 아닙니다.",
    "Cross-site requests are not allowed": "허용되지 않음: 교차 사이트 요청.",
    "DPAPI credential can be decrypted by the current Windows account":
      "현재 Windows 계정으로 DPAPI 자격 증명을 복호화할 수 있습니다.",
    "Encrypted ZIP entries are not supported":
      "지원되지 않음: 암호화된 ZIP 항목.",
    "Host header does not match the local listener":
      "불일치: Host 헤더 / 로컬 리스너.",
    "Input is not a render API key": "입력값이 렌더링 API 키 형식이 아닙니다.",
    "Installation directory exists without managed state and will be preserved":
      "기존 설치 디렉터리에 관리 상태가 없으므로 그대로 보존합니다.",
    "Installation failed; the previous client was restored.":
      "설치에 실패하여 이전 클라이언트를 복원했습니다.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "설치된 클라이언트 파일이 불완전합니다. setup을 실행하여 다시 설치하세요.",
    "Installed payload is missing": "설치된 클라이언트 파일: 찾을 수 없습니다.",
    "Installed payload is present": "설치된 클라이언트 파일: 있습니다.",
    "LaTeX Renderer client was removed.":
      "LaTeX Renderer 클라이언트를 제거했습니다.",
    "Local setup endpoint was not found": "찾을 수 없음: 로컬 설정 엔드포인트",
    "Local setup operation failed": "로컬 설정: 작업이 실패했습니다.",
    "Local setup session is required": "필수: 로컬 설정 세션",
    "Loopback access is required": "필수: 루프백 접근",
    "Managed command launcher is current":
      "관리되는 명령 실행기: 최신 상태입니다.",
    "Managed installation state has an unsupported format":
      "관리형 설치 상태: 인식할 수 없는 형식입니다.",
    "Managed installation state is not a regular file":
      "관리형 설치 상태: 일반 파일이 아닙니다.",
    "Managed installation state is not valid JSON":
      "관리형 설치 상태: 필요한 형식 — 유효한 JSON",
    "Managed installation state must be owned by the current user and not group/world writable":
      "관리형 설치 상태: 현재 사용자 소유여야 하며 그룹이나 다른 사용자에게 쓰기 권한이 없어야 합니다.",
    "Managed installation state was not found":
      "관리형 설치 상태: 찾을 수 없습니다.",
    "Multi-disk or malformed ZIP archives are not supported":
      "분할 ZIP 또는 잘못된 형식의 ZIP은 지원하지 않습니다",
    "No stored DPAPI credential file was found":
      "찾을 수 없음: 저장된 DPAPI 자격 증명 파일",
    "Only local POST API requests are allowed":
      "로컬 POST API 요청만 허용됩니다.",
    "Open client settings with: n624-latex setup":
      "클라이언트 설정을 여는 명령: n624-latex setup",
    "Origin does not match the local setup UI":
      "불일치: Origin 헤더 / 로컬 설정 화면.",
    "Protected credential file is present": "보호된 자격 증명 파일: 있습니다.",
    "Render API credential is not configured":
      "설정되지 않음: Render API 자격 증명",
    "Render API credential is provided by the environment":
      "렌더링 API 자격 증명은 환경에서 제공됩니다.",
    "Request URL is invalid": "잘못된 값: 요청 URL",
    "Request body is not valid JSON": "요청 본문: 필요한 형식 — 유효한 JSON",
    "Request body is too large": "크기 제한 초과: 요청 본문",
    "Request body must be a JSON object": "요청 본문: 필요한 형식 — JSON 객체",
    "Setup Web UI did not receive a TCP address":
      "설정 웹 UI가 TCP 주소를 받지 못했습니다.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "이 Windows 계정으로 저장된 DPAPI 자격 증명을 복호화하지 못했습니다.",
    "The stored DPAPI credential file could not be read":
      "저장된 DPAPI 자격 증명 파일을 읽지 못했습니다.",
    "Windows DPAPI credential storage failed":
      "Windows DPAPI 자격 증명 저장: 작업이 실패했습니다.",
    "Windows DPAPI credential verification failed":
      "Windows DPAPI 자격 증명 검증: 작업이 실패했습니다.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell에서 DPAPI 작업을 초기화하거나 완료하지 못했습니다.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windows 설치 및 bin 디렉터리는 따옴표, 세미콜론, 제어 문자가 없는 절대 경로여야 합니다.",
  }),
  es: () => ({
    "A setup operation is already running":
      "Operación de configuración local: ya está en curso.",
    "Bootstrap token is invalid or already used":
      "El token de arranque no es válido o ya se utilizó.",
    "CSRF token is invalid": "Valor no válido: token CSRF",
    "Client archive SHA-256 verification failed":
      "verificación de SHA-256 del archivo comprimido del cliente: la operación ha fallado.",
    "Client archive central directory is malformed":
      "directorio central ZIP: datos dañados.",
    "Client archive central directory size is invalid":
      "Valor no válido: tamaño del directorio central del archivo del cliente",
    "Client archive data is truncated":
      "Contenido del archivo del cliente: datos truncados.",
    "Client archive end record was not found":
      "No se encuentra: registro final del archivo del cliente",
    "Client archive entry is truncated":
      "Entrada del archivo del cliente: datos truncados.",
    "Client archive expanded size is invalid":
      "Valor no válido: tamaño descomprimido del archivo del cliente",
    "Client archive has too many entries":
      "Archivo del cliente: demasiadas entradas.",
    "Client archive local and central headers do not match":
      "No coinciden: cabecera local ZIP y cabecera central ZIP.",
    "Client archive local header is malformed":
      "cabecera local ZIP: datos dañados.",
    "Client archive payload is incomplete":
      "Contenido del archivo del cliente: datos incompletos.",
    "Client archive size verification failed":
      "verificación de tamaño del archivo comprimido del cliente: la operación ha fallado.",
    "Client manifest is invalid": "Valor no válido: manifiesto del cliente",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "El directorio de comandos no está en el PATH actual. Abra un terminal nuevo o añádalo.",
    "Command directory is present in PATH":
      "El directorio de comandos está en PATH.",
    "Command launcher is installed": "lanzador de comandos: presente.",
    "Command launcher is missing": "Falta: lanzador de comandos",
    "Command launcher is not owned by this installation":
      "El lanzador de comandos no pertenece a esta instalación.",
    "Content-Type must be application/json":
      "Content-Type: se esperaba application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Credencial: se requiere un archivo normal del usuario actual con permisos 0600.",
    "Credential file permissions must be 0600":
      "Permisos del archivo de credenciales: se esperaba 0600.",
    "Credential path is not a regular file":
      "Ruta de credenciales: no es un archivo normal.",
    "Cross-site requests are not allowed":
      "No se permite: Solicitudes entre sitios.",
    "DPAPI credential can be decrypted by the current Windows account":
      "La cuenta de Windows actual puede descifrar la credencial DPAPI.",
    "Encrypted ZIP entries are not supported":
      "No se admite: entradas ZIP cifradas.",
    "Host header does not match the local listener":
      "No coinciden: Cabecera Host y listener local.",
    "Input is not a render API key":
      "La entrada no corresponde a una clave de la API de renderizado.",
    "Installation directory exists without managed state and will be preserved":
      "El directorio de instalación existe sin estado gestionado y se conservará.",
    "Installation failed; the previous client was restored.":
      "La instalación falló. Se restauró el cliente anterior.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "La instalación del cliente está incompleta. Ejecute setup para reinstalarlo.",
    "Installed payload is missing":
      "Archivos del cliente instalado: no se encuentra.",
    "Installed payload is present": "Archivos del cliente instalado: presente.",
    "LaTeX Renderer client was removed.":
      "Se eliminó el cliente LaTeX Renderer.",
    "Local setup endpoint was not found":
      "No se encuentra: endpoint de configuración local",
    "Local setup operation failed":
      "Configuración local: la operación ha fallado.",
    "Local setup session is required":
      "Se requiere: sesión de configuración local",
    "Loopback access is required": "Se requiere: acceso por loopback",
    "Managed command launcher is current":
      "lanzador de comandos administrado: ya está al día.",
    "Managed installation state has an unsupported format":
      "Estado de instalación gestionado: formato no reconocido.",
    "Managed installation state is not a regular file":
      "Estado de instalación gestionado: no es un archivo normal.",
    "Managed installation state is not valid JSON":
      "Estado de instalación gestionado: se esperaba JSON válido.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Estado de instalación gestionado: debe pertenecer al usuario actual y no permitir escritura al grupo ni a otros usuarios.",
    "Managed installation state was not found":
      "Estado de instalación gestionado: no se encuentra.",
    "Multi-disk or malformed ZIP archives are not supported":
      "No se admiten archivos ZIP divididos o malformados",
    "No stored DPAPI credential file was found":
      "No se encuentra: archivo de credenciales DPAPI guardado",
    "Only local POST API requests are allowed":
      "Solo se permiten solicitudes POST locales a la API.",
    "Open client settings with: n624-latex setup":
      "Comando para abrir la configuración del cliente: n624-latex setup",
    "Origin does not match the local setup UI":
      "No coinciden: Cabecera Origin y interfaz de configuración local.",
    "Protected credential file is present":
      "archivo de credenciales protegido: presente.",
    "Render API credential is not configured":
      "Sin configurar: credenciales de la Render API",
    "Render API credential is provided by the environment":
      "La credencial de la API de renderizado se proporciona mediante el entorno.",
    "Request URL is invalid": "Valor no válido: URL de la solicitud",
    "Request body is not valid JSON":
      "Cuerpo de la solicitud: se esperaba JSON válido.",
    "Request body is too large":
      "Se supera el límite de tamaño: cuerpo de la solicitud",
    "Request body must be a JSON object":
      "Cuerpo de la solicitud: se esperaba un objeto JSON.",
    "Setup Web UI did not receive a TCP address":
      "La interfaz web de configuración no recibió una dirección TCP.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Esta cuenta de Windows no pudo descifrar la credencial DPAPI guardada.",
    "The stored DPAPI credential file could not be read":
      "No se pudo leer el archivo de credenciales DPAPI guardado.",
    "Windows DPAPI credential storage failed":
      "almacenamiento de credenciales de Windows DPAPI: la operación ha fallado.",
    "Windows DPAPI credential verification failed":
      "verificación de credenciales de Windows DPAPI: la operación ha fallado.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell no pudo iniciar o completar la operación DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "En Windows, use rutas absolutas sin comillas, puntos y coma ni caracteres de control para la instalación y el directorio bin.",
  }),
  pt: () => ({
    "A setup operation is already running":
      "Operação de configuração local: já está em curso.",
    "Bootstrap token is invalid or already used":
      "O token inicial é inválido ou já foi usado.",
    "CSRF token is invalid": "Valor inválido: token CSRF",
    "Client archive SHA-256 verification failed":
      "verificação de SHA-256 do arquivo compactado do cliente: a operação falhou.",
    "Client archive central directory is malformed":
      "diretório central ZIP: dados danificados.",
    "Client archive central directory size is invalid":
      "Valor inválido: tamanho do diretório central do arquivo do cliente",
    "Client archive data is truncated":
      "Conteúdo do arquivo do cliente: dados truncados.",
    "Client archive end record was not found":
      "Não foi possível encontrar: registo final do arquivo do cliente",
    "Client archive entry is truncated":
      "Entrada do arquivo do cliente: dados truncados.",
    "Client archive expanded size is invalid":
      "Valor inválido: tamanho descomprimido do arquivo do cliente",
    "Client archive has too many entries":
      "Arquivo do cliente: demasiadas entradas.",
    "Client archive local and central headers do not match":
      "Não correspondem: cabeçalho local ZIP e cabeçalho central ZIP.",
    "Client archive local header is malformed":
      "cabeçalho local ZIP: dados danificados.",
    "Client archive payload is incomplete":
      "Conteúdo do arquivo do cliente: dados incompletos.",
    "Client archive size verification failed":
      "verificação de tamanho do arquivo compactado do cliente: a operação falhou.",
    "Client manifest is invalid": "Valor inválido: manifesto do cliente",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "O diretório de comandos não está no PATH atual. Abra um novo terminal ou adicione-o.",
    "Command directory is present in PATH":
      "O diretório de comandos está em PATH.",
    "Command launcher is installed": "inicializador de comandos: presente.",
    "Command launcher is missing": "Em falta: lançador de comandos",
    "Command launcher is not owned by this installation":
      "O lançador de comandos não pertence a esta instalação.",
    "Content-Type must be application/json":
      "Content-Type: valor esperado: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Credencial: é necessário um ficheiro normal do utilizador atual com permissões 0600.",
    "Credential file permissions must be 0600":
      "Permissões do ficheiro de credenciais: valor esperado: 0600.",
    "Credential path is not a regular file":
      "Caminho das credenciais: não é um ficheiro normal.",
    "Cross-site requests are not allowed":
      "Não é permitido: Pedidos entre sites.",
    "DPAPI credential can be decrypted by the current Windows account":
      "A conta Windows atual pode decifrar a credencial DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Sem suporte: entradas ZIP criptografadas.",
    "Host header does not match the local listener":
      "Não correspondem: Cabeçalho Host e listener local.",
    "Input is not a render API key":
      "A entrada não corresponde a uma chave da API de renderização.",
    "Installation directory exists without managed state and will be preserved":
      "O diretório de instalação existe sem estado gerido e será preservado.",
    "Installation failed; the previous client was restored.":
      "A instalação falhou. O cliente anterior foi restaurado.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "A instalação do cliente está incompleta. Execute setup para a reinstalar.",
    "Installed payload is missing":
      "Ficheiros do cliente instalado: não encontrado.",
    "Installed payload is present": "Ficheiros do cliente instalado: presente.",
    "LaTeX Renderer client was removed.":
      "O cliente LaTeX Renderer foi removido.",
    "Local setup endpoint was not found":
      "Não foi possível encontrar: endpoint de configuração local",
    "Local setup operation failed": "Configuração local: a operação falhou.",
    "Local setup session is required":
      "Obrigatório: sessão de configuração local",
    "Loopback access is required": "Obrigatório: acesso por loopback",
    "Managed command launcher is current":
      "inicializador de comandos gerenciado: já está atualizado.",
    "Managed installation state has an unsupported format":
      "Estado da instalação gerida: formato não reconhecido.",
    "Managed installation state is not a regular file":
      "Estado da instalação gerida: não é um ficheiro normal.",
    "Managed installation state is not valid JSON":
      "Estado da instalação gerida: valor esperado: JSON válido.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Estado da instalação gerida: deve pertencer ao utilizador atual e impedir a escrita pelo grupo e por outros utilizadores.",
    "Managed installation state was not found":
      "Estado da instalação gerida: não encontrado.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Arquivos ZIP divididos ou malformados não são aceitos",
    "No stored DPAPI credential file was found":
      "Não foi possível encontrar: ficheiro de credenciais DPAPI guardado",
    "Only local POST API requests are allowed":
      "Só são permitidos pedidos POST locais à API.",
    "Open client settings with: n624-latex setup":
      "Comando para abrir as definições do cliente: n624-latex setup",
    "Origin does not match the local setup UI":
      "Não correspondem: Cabeçalho Origin e interface de configuração local.",
    "Protected credential file is present":
      "arquivo de credenciais protegido: presente.",
    "Render API credential is not configured":
      "Por configurar: credenciais da Render API",
    "Render API credential is provided by the environment":
      "A credencial da API de renderização é fornecida pelo ambiente.",
    "Request URL is invalid": "Valor inválido: URL do pedido",
    "Request body is not valid JSON":
      "Corpo do pedido: valor esperado: JSON válido.",
    "Request body is too large": "Limite de tamanho excedido: corpo do pedido",
    "Request body must be a JSON object":
      "Corpo do pedido: valor esperado: um objeto JSON.",
    "Setup Web UI did not receive a TCP address":
      "A interface Web de configuração não recebeu um endereço TCP.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Esta conta Windows não conseguiu decifrar a credencial DPAPI guardada.",
    "The stored DPAPI credential file could not be read":
      "Não foi possível ler o ficheiro de credenciais DPAPI guardado.",
    "Windows DPAPI credential storage failed":
      "armazenamento de credenciais do Windows DPAPI: a operação falhou.",
    "Windows DPAPI credential verification failed":
      "verificação de credenciais do Windows DPAPI: a operação falhou.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "O Windows PowerShell não conseguiu iniciar ou concluir a operação DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "No Windows, os diretórios de instalação e bin têm de ser caminhos absolutos sem aspas, pontos e vírgulas ou caracteres de controlo.",
  }),
  fr: () => ({
    "A setup operation is already running":
      "Opération de configuration locale : déjà en cours.",
    "Bootstrap token is invalid or already used":
      "Le jeton d’amorçage est invalide ou déjà utilisé.",
    "CSRF token is invalid": "Valeur incorrecte : jeton CSRF",
    "Client archive SHA-256 verification failed":
      "vérification de SHA-256 de l’archive client : échec de l’opération.",
    "Client archive central directory is malformed":
      "répertoire central ZIP : données corrompues.",
    "Client archive central directory size is invalid":
      "Valeur incorrecte : taille du répertoire central de l’archive du client",
    "Client archive data is truncated":
      "Contenu de l’archive du client : données tronquées.",
    "Client archive end record was not found":
      "Introuvable : enregistrement de fin de l’archive du client",
    "Client archive entry is truncated":
      "Entrée de l’archive du client : données tronquées.",
    "Client archive expanded size is invalid":
      "Valeur incorrecte : taille décompressée de l’archive du client",
    "Client archive has too many entries":
      "Archive du client : trop d’entrées.",
    "Client archive local and central headers do not match":
      "Incohérence entre en-tête local ZIP et en-tête central ZIP.",
    "Client archive local header is malformed":
      "en-tête local ZIP : données corrompues.",
    "Client archive payload is incomplete":
      "Contenu de l’archive du client : données incomplètes.",
    "Client archive size verification failed":
      "vérification de taille de l’archive client : échec de l’opération.",
    "Client manifest is invalid": "Valeur incorrecte : manifeste du client",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Le répertoire de commandes est absent du PATH actuel. Ouvrez un nouveau terminal ou ajoutez-le.",
    "Command directory is present in PATH":
      "Le répertoire de commandes figure dans PATH.",
    "Command launcher is installed":
      "lanceur de commandes : présence confirmée.",
    "Command launcher is missing": "Élément manquant : lanceur de commandes",
    "Command launcher is not owned by this installation":
      "Le lanceur de commandes n’appartient pas à cette installation.",
    "Content-Type must be application/json":
      "Content-Type : valeur attendue : application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Identifiant d’accès : fichier ordinaire appartenant à l’utilisateur actuel, avec les permissions 0600 requises.",
    "Credential file permissions must be 0600":
      "Permissions du fichier d’identifiants : valeur attendue : 0600.",
    "Credential path is not a regular file":
      "Chemin du fichier d’identifiants : ce n’est pas un fichier ordinaire.",
    "Cross-site requests are not allowed":
      "Non autorisé : Requêtes intersites.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Le compte Windows actuel peut déchiffrer l’identifiant DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Non pris en charge : entrées ZIP chiffrées.",
    "Host header does not match the local listener":
      "Incohérence entre En-tête Host et point d’écoute local.",
    "Input is not a render API key":
      "La valeur saisie ne correspond pas à une clé d’API de rendu.",
    "Installation directory exists without managed state and will be preserved":
      "Le répertoire d’installation existe sans état géré et sera conservé.",
    "Installation failed; the previous client was restored.":
      "L’installation a échoué. Le client précédent a été restauré.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "L’installation du client est incomplète. Exécutez setup pour le réinstaller.",
    "Installed payload is missing":
      "Fichiers du client installé : introuvable.",
    "Installed payload is present":
      "Fichiers du client installé : présence confirmée.",
    "LaTeX Renderer client was removed.":
      "Le client LaTeX Renderer a été supprimé.",
    "Local setup endpoint was not found":
      "Introuvable : point de terminaison de configuration locale",
    "Local setup operation failed":
      "Configuration locale : échec de l’opération.",
    "Local setup session is required":
      "Élément requis : session de configuration locale",
    "Loopback access is required":
      "Élément requis : accès par l’interface de bouclage",
    "Managed command launcher is current":
      "lanceur de commandes géré : déjà à jour.",
    "Managed installation state has an unsupported format":
      "État de l’installation gérée : format non reconnu.",
    "Managed installation state is not a regular file":
      "État de l’installation gérée : ce n’est pas un fichier ordinaire.",
    "Managed installation state is not valid JSON":
      "État de l’installation gérée : valeur attendue : du JSON valide.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "État de l’installation gérée : doit appartenir à l’utilisateur actuel et interdire l’écriture au groupe et aux autres utilisateurs.",
    "Managed installation state was not found":
      "État de l’installation gérée : introuvable.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Les ZIP multivolumes ou mal formés ne sont pas pris en charge",
    "No stored DPAPI credential file was found":
      "Introuvable : fichier d’identifiants DPAPI enregistré",
    "Only local POST API requests are allowed":
      "Seules les requêtes POST locales vers l’API sont autorisées.",
    "Open client settings with: n624-latex setup":
      "Commande pour ouvrir les paramètres du client : n624-latex setup",
    "Origin does not match the local setup UI":
      "Incohérence entre En-tête Origin et interface locale de configuration.",
    "Protected credential file is present":
      "fichier d’identifiants protégé : présence confirmée.",
    "Render API credential is not configured":
      "Configuration manquante : identifiants de la Render API",
    "Render API credential is provided by the environment":
      "L’identifiant de l’API de rendu est fourni par l’environnement.",
    "Request URL is invalid": "Valeur incorrecte : URL de la requête",
    "Request body is not valid JSON":
      "Corps de la requête : valeur attendue : du JSON valide.",
    "Request body is too large":
      "Taille maximale dépassée : corps de la requête",
    "Request body must be a JSON object":
      "Corps de la requête : valeur attendue : un objet JSON.",
    "Setup Web UI did not receive a TCP address":
      "L’interface web de configuration n’a reçu aucune adresse TCP.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Ce compte Windows n’a pas pu déchiffrer l’identifiant DPAPI enregistré.",
    "The stored DPAPI credential file could not be read":
      "Impossible de lire le fichier d’identifiants DPAPI enregistré.",
    "Windows DPAPI credential storage failed":
      "stockage des identifiants Windows DPAPI : échec de l’opération.",
    "Windows DPAPI credential verification failed":
      "La vérification des identifiants Windows DPAPI a échoué.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell n’a pas pu initialiser ou terminer l’opération DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Sous Windows, les répertoires d’installation et bin doivent être des chemins absolus sans guillemets, points-virgules ni caractères de contrôle.",
  }),
  de: () => ({
    "A setup operation is already running":
      "Lokaler Einrichtungsvorgang: läuft bereits.",
    "Bootstrap token is invalid or already used":
      "Das Bootstrap-Token ist ungültig oder wurde bereits verwendet.",
    "CSRF token is invalid": "Ungültiger Wert: CSRF-Token",
    "Client archive SHA-256 verification failed":
      "Prüfung von SHA-256 des Clientarchivs: Vorgang fehlgeschlagen.",
    "Client archive central directory is malformed":
      "ZIP-Zentralverzeichnis: Daten beschädigt.",
    "Client archive central directory size is invalid":
      "Ungültiger Wert: Größe des Zentralverzeichnisses im Clientarchiv",
    "Client archive data is truncated":
      "Inhalt des Clientarchivs: Daten abgeschnitten.",
    "Client archive end record was not found":
      "Nicht gefunden: Enddatensatz des Clientarchivs",
    "Client archive entry is truncated":
      "Eintrag im Clientarchiv: Daten abgeschnitten.",
    "Client archive expanded size is invalid":
      "Ungültiger Wert: entpackte Größe des Clientarchivs",
    "Client archive has too many entries": "Clientarchiv: zu viele Einträge.",
    "Client archive local and central headers do not match":
      "Keine Übereinstimmung: lokaler ZIP-Header und zentraler ZIP-Header.",
    "Client archive local header is malformed":
      "lokaler ZIP-Header: Daten beschädigt.",
    "Client archive payload is incomplete":
      "Inhalt des Clientarchivs: unvollständig.",
    "Client archive size verification failed":
      "Prüfung von Größe des Clientarchivs: Vorgang fehlgeschlagen.",
    "Client manifest is invalid": "Ungültiger Wert: Clientmanifest",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Das Befehlsverzeichnis fehlt im aktuellen PATH. Öffnen Sie ein neues Terminal oder fügen Sie es hinzu.",
    "Command directory is present in PATH":
      "Das Befehlsverzeichnis ist in PATH enthalten.",
    "Command launcher is installed": "Befehlsstarter: vorhanden.",
    "Command launcher is missing": "Fehlt: Befehlsstarter",
    "Command launcher is not owned by this installation":
      "Der Befehlsstarter gehört nicht zu dieser Installation.",
    "Content-Type must be application/json":
      "Content-Type: Erwartet wird application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Zugangsdaten: reguläre Datei im Besitz des aktuellen Benutzers mit Modus 0600 erforderlich.",
    "Credential file permissions must be 0600":
      "Berechtigungen der Zugangsdaten-Datei: Erwartet wird 0600.",
    "Credential path is not a regular file":
      "Pfad der Zugangsdaten: keine reguläre Datei.",
    "Cross-site requests are not allowed":
      "Nicht zulässig: Websiteübergreifende Anfragen.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Das aktuelle Windows-Konto kann die DPAPI-Zugangsdaten entschlüsseln.",
    "Encrypted ZIP entries are not supported":
      "Nicht unterstützt: verschlüsselte ZIP-Einträge.",
    "Host header does not match the local listener":
      "Keine Übereinstimmung: Host-Header und lokaler Listener.",
    "Input is not a render API key":
      "Eingabe entspricht nicht dem erwarteten Typ: Render-API-Schlüssel.",
    "Installation directory exists without managed state and will be preserved":
      "Das Installationsverzeichnis ist ohne verwalteten Zustand vorhanden und bleibt erhalten.",
    "Installation failed; the previous client was restored.":
      "Installation fehlgeschlagen. Der vorherige Client wurde wiederhergestellt.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Die Clientinstallation ist unvollständig. Führen Sie setup zur Neuinstallation aus.",
    "Installed payload is missing": "Installierte Client-Dateien: fehlt.",
    "Installed payload is present": "Installierte Client-Dateien: vorhanden.",
    "LaTeX Renderer client was removed.":
      "Der LaTeX Renderer-Client wurde entfernt.",
    "Local setup endpoint was not found":
      "Nicht gefunden: Endpunkt der lokalen Einrichtung",
    "Local setup operation failed":
      "Lokale Einrichtung: Vorgang fehlgeschlagen.",
    "Local setup session is required":
      "Erforderlich: Sitzung der lokalen Einrichtung",
    "Loopback access is required": "Erforderlich: Zugriff über Loopback",
    "Managed command launcher is current":
      "verwalteter Befehlsstarter: bereits aktuell.",
    "Managed installation state has an unsupported format":
      "Status der verwalteten Installation: unbekanntes Format.",
    "Managed installation state is not a regular file":
      "Status der verwalteten Installation: keine reguläre Datei.",
    "Managed installation state is not valid JSON":
      "Status der verwalteten Installation: Erwartet wird gültiges JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Status der verwalteten Installation: Muss dem aktuellen Benutzer gehören und darf für Gruppe und andere nicht beschreibbar sein.",
    "Managed installation state was not found":
      "Status der verwalteten Installation: fehlt.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Mehrteilige oder fehlerhafte ZIP-Archive werden nicht unterstützt",
    "No stored DPAPI credential file was found":
      "Nicht gefunden: gespeicherte DPAPI-Zugangsdaten-Datei",
    "Only local POST API requests are allowed":
      "Nur lokale POST-Anfragen an die API sind zulässig.",
    "Open client settings with: n624-latex setup":
      "Befehl zum Öffnen der Clienteinstellungen: n624-latex setup",
    "Origin does not match the local setup UI":
      "Keine Übereinstimmung: Origin-Header und lokale Einrichtungsoberfläche.",
    "Protected credential file is present":
      "geschützte Anmeldedatendatei: vorhanden.",
    "Render API credential is not configured":
      "Nicht konfiguriert: Zugangsdaten für die Render API",
    "Render API credential is provided by the environment":
      "Die Zugangsdaten für die Render API werden aus der Umgebung bezogen.",
    "Request URL is invalid": "Ungültiger Wert: Anfrage-URL",
    "Request body is not valid JSON":
      "Anfragetext: Erwartet wird gültiges JSON.",
    "Request body is too large": "Größenlimit überschritten: Anfragetext",
    "Request body must be a JSON object":
      "Anfragetext: Erwartet wird ein JSON-Objekt.",
    "Setup Web UI did not receive a TCP address":
      "Die Weboberfläche zur Einrichtung hat keine TCP-Adresse erhalten.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Dieses Windows-Konto konnte die gespeicherten DPAPI-Zugangsdaten nicht entschlüsseln.",
    "The stored DPAPI credential file could not be read":
      "Die gespeicherte DPAPI-Zugangsdaten-Datei konnte nicht gelesen werden.",
    "Windows DPAPI credential storage failed":
      "Speicherung von Windows-DPAPI-Anmeldedaten: Vorgang fehlgeschlagen.",
    "Windows DPAPI credential verification failed":
      "Prüfung von Windows-DPAPI-Anmeldedaten: Vorgang fehlgeschlagen.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell konnte den DPAPI-Vorgang nicht initialisieren oder abschließen.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Unter Windows müssen Installations- und bin-Verzeichnis absolute Pfade ohne Anführungszeichen, Semikolons oder Steuerzeichen sein.",
  }),
  it: () => ({
    "A setup operation is already running":
      "Operazione di configurazione locale: già in corso.",
    "Bootstrap token is invalid or already used":
      "Il token di bootstrap non è valido o è già stato usato.",
    "CSRF token is invalid": "Valore non valido: token CSRF",
    "Client archive SHA-256 verification failed":
      "verifica di SHA-256 dell’archivio del client: operazione non riuscita.",
    "Client archive central directory is malformed":
      "directory centrale ZIP: dati danneggiati.",
    "Client archive central directory size is invalid":
      "Valore non valido: dimensione della directory centrale dell’archivio del client",
    "Client archive data is truncated":
      "Contenuto dell’archivio del client: dati troncati.",
    "Client archive end record was not found":
      "Impossibile trovare: record finale dell’archivio del client",
    "Client archive entry is truncated":
      "Voce dell’archivio del client: dati troncati.",
    "Client archive expanded size is invalid":
      "Valore non valido: dimensione decompressa dell’archivio del client",
    "Client archive has too many entries": "Archivio del client: troppe voci.",
    "Client archive local and central headers do not match":
      "Mancata corrispondenza: intestazione locale ZIP e intestazione centrale ZIP.",
    "Client archive local header is malformed":
      "intestazione locale ZIP: dati danneggiati.",
    "Client archive payload is incomplete":
      "Contenuto dell’archivio del client: dati incompleti.",
    "Client archive size verification failed":
      "verifica di dimensione dell’archivio del client: operazione non riuscita.",
    "Client manifest is invalid": "Valore non valido: manifesto del client",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "La directory dei comandi non è nel PATH attuale. Apri un nuovo terminale o aggiungila.",
    "Command directory is present in PATH":
      "La directory dei comandi è in PATH.",
    "Command launcher is installed": "lanciatore di comandi: presente.",
    "Command launcher is missing":
      "Elemento mancante: programma di avvio dei comandi",
    "Command launcher is not owned by this installation":
      "Il programma di avvio dei comandi non appartiene a questa installazione.",
    "Content-Type must be application/json":
      "Content-Type: valore previsto: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Credenziale: è richiesto un file normale di proprietà dell’utente corrente con permessi 0600.",
    "Credential file permissions must be 0600":
      "Permessi del file delle credenziali: valore previsto: 0600.",
    "Credential path is not a regular file":
      "Percorso delle credenziali: non è un file normale.",
    "Cross-site requests are not allowed":
      "Non consentito: Richieste tra siti.",
    "DPAPI credential can be decrypted by the current Windows account":
      "L’account Windows corrente può decifrare le credenziali DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Non supportato: voci ZIP cifrate.",
    "Host header does not match the local listener":
      "Mancata corrispondenza: Intestazione Host e listener locale.",
    "Input is not a render API key":
      "Il valore inserito non corrisponde a una chiave API di rendering.",
    "Installation directory exists without managed state and will be preserved":
      "La directory di installazione esiste senza uno stato gestito e verrà conservata.",
    "Installation failed; the previous client was restored.":
      "Installazione non riuscita. Il client precedente è stato ripristinato.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "L’installazione del client è incompleta. Esegui setup per reinstallarlo.",
    "Installed payload is missing": "File del client installato: non trovato.",
    "Installed payload is present": "File del client installato: presente.",
    "LaTeX Renderer client was removed.":
      "Il client LaTeX Renderer è stato rimosso.",
    "Local setup endpoint was not found":
      "Impossibile trovare: endpoint di configurazione locale",
    "Local setup operation failed":
      "Configurazione locale: operazione non riuscita.",
    "Local setup session is required":
      "Elemento richiesto: sessione di configurazione locale",
    "Loopback access is required":
      "Elemento richiesto: accesso tramite loopback",
    "Managed command launcher is current":
      "lanciatore di comandi gestito: già aggiornato.",
    "Managed installation state has an unsupported format":
      "Stato dell’installazione gestita: formato non riconosciuto.",
    "Managed installation state is not a regular file":
      "Stato dell’installazione gestita: non è un file normale.",
    "Managed installation state is not valid JSON":
      "Stato dell’installazione gestita: valore previsto: JSON valido.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Stato dell’installazione gestita: deve appartenere all’utente corrente e impedire la scrittura al gruppo e agli altri utenti.",
    "Managed installation state was not found":
      "Stato dell’installazione gestita: non trovato.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Gli archivi ZIP suddivisi o malformati non sono supportati",
    "No stored DPAPI credential file was found":
      "Impossibile trovare: file delle credenziali DPAPI salvato",
    "Only local POST API requests are allowed":
      "Sono consentite solo richieste POST locali all’API.",
    "Open client settings with: n624-latex setup":
      "Comando per aprire le impostazioni del client: n624-latex setup",
    "Origin does not match the local setup UI":
      "Mancata corrispondenza: Intestazione Origin e interfaccia di configurazione locale.",
    "Protected credential file is present":
      "file delle credenziali protetto: presente.",
    "Render API credential is not configured":
      "Configurazione mancante: credenziali della Render API",
    "Render API credential is provided by the environment":
      "Le credenziali dell’API di rendering provengono dall’ambiente.",
    "Request URL is invalid": "Valore non valido: URL della richiesta",
    "Request body is not valid JSON":
      "Corpo della richiesta: valore previsto: JSON valido.",
    "Request body is too large":
      "Limite di dimensione superato: corpo della richiesta",
    "Request body must be a JSON object":
      "Corpo della richiesta: valore previsto: un oggetto JSON.",
    "Setup Web UI did not receive a TCP address":
      "L’interfaccia web di configurazione non ha ricevuto un indirizzo TCP.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Questo account Windows non ha potuto decifrare le credenziali DPAPI salvate.",
    "The stored DPAPI credential file could not be read":
      "Impossibile leggere il file delle credenziali DPAPI salvato.",
    "Windows DPAPI credential storage failed":
      "archiviazione delle credenziali Windows DPAPI: operazione non riuscita.",
    "Windows DPAPI credential verification failed":
      "Verifica delle credenziali Windows DPAPI non riuscita.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell non ha potuto inizializzare o completare l’operazione DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "In Windows le directory di installazione e bin richiedono percorsi assoluti senza virgolette, punti e virgola o caratteri di controllo.",
  }),
  ru: () => ({
    "A setup operation is already running":
      "Операция локальной настройки: уже выполняется.",
    "Bootstrap token is invalid or already used":
      "Начальный токен недействителен или уже использован.",
    "CSRF token is invalid": "Недопустимое значение: CSRF-токен",
    "Client archive SHA-256 verification failed":
      "проверка SHA-256 архива клиента: операция не выполнена.",
    "Client archive central directory is malformed":
      "центральный каталог ZIP: данные повреждены.",
    "Client archive central directory size is invalid":
      "Недопустимое значение: размер центрального каталога архива клиента",
    "Client archive data is truncated":
      "Содержимое архива клиента: данные обрезаны.",
    "Client archive end record was not found":
      "Не найдено: конечная запись архива клиента",
    "Client archive entry is truncated":
      "Элемент архива клиента: данные обрезаны.",
    "Client archive expanded size is invalid":
      "Недопустимое значение: размер распакованного архива клиента",
    "Client archive has too many entries":
      "Архив клиента: слишком много записей.",
    "Client archive local and central headers do not match":
      "Несоответствие: локальный заголовок ZIP и центральный заголовок ZIP.",
    "Client archive local header is malformed":
      "локальный заголовок ZIP: данные повреждены.",
    "Client archive payload is incomplete":
      "Содержимое архива клиента: неполные данные.",
    "Client archive size verification failed":
      "проверка размера архива клиента: операция не выполнена.",
    "Client manifest is invalid": "Недопустимое значение: манифест клиента",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Каталог команд отсутствует в текущем PATH. Откройте новый терминал или добавьте каталог.",
    "Command directory is present in PATH": "Каталог команд включён в PATH.",
    "Command launcher is installed": "средство запуска команд: имеется.",
    "Command launcher is missing": "Отсутствует: средство запуска команд",
    "Command launcher is not owned by this installation":
      "Средство запуска команд не принадлежит этой установке.",
    "Content-Type must be application/json":
      "Content-Type: ожидается application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Учётные данные: требуется обычный файл текущего пользователя с правами 0600.",
    "Credential file permissions must be 0600":
      "Права файла учётных данных: ожидается 0600.",
    "Credential path is not a regular file":
      "Путь к учётным данным: не является обычным файлом.",
    "Cross-site requests are not allowed": "Не разрешено: Межсайтовые запросы.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Текущая учётная запись Windows может расшифровать учётные данные DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Не поддерживается: зашифрованные записи ZIP.",
    "Host header does not match the local listener":
      "Несоответствие: Заголовок Host и локальный слушатель.",
    "Input is not a render API key":
      "Введено не то значение. Ожидается: ключ API рендеринга.",
    "Installation directory exists without managed state and will be preserved":
      "Существующий каталог установки не имеет состояния управления и будет сохранён.",
    "Installation failed; the previous client was restored.":
      "Установка не удалась. Предыдущий клиент восстановлен.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Установка клиента неполна. Запустите setup для переустановки.",
    "Installed payload is missing": "Установленные файлы клиента: не найдено.",
    "Installed payload is present": "Установленные файлы клиента: имеется.",
    "LaTeX Renderer client was removed.": "Клиент LaTeX Renderer удалён.",
    "Local setup endpoint was not found":
      "Не найдено: конечная точка локальной настройки",
    "Local setup operation failed":
      "Локальная настройка: операция не выполнена.",
    "Local setup session is required": "Требуется: сеанс локальной настройки",
    "Loopback access is required": "Требуется: доступ через петлевой интерфейс",
    "Managed command launcher is current":
      "управляемое средство запуска команд: уже используется актуальная версия.",
    "Managed installation state has an unsupported format":
      "Состояние управляемой установки: неизвестный формат.",
    "Managed installation state is not a regular file":
      "Состояние управляемой установки: не является обычным файлом.",
    "Managed installation state is not valid JSON":
      "Состояние управляемой установки: ожидается корректный JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Состояние управляемой установки: владельцем должен быть текущий пользователь, запись для группы и остальных запрещена.",
    "Managed installation state was not found":
      "Состояние управляемой установки: не найдено.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Многотомные и некорректные ZIP-архивы не поддерживаются",
    "No stored DPAPI credential file was found":
      "Не найдено: сохранённый файл учётных данных DPAPI",
    "Only local POST API requests are allowed":
      "Разрешены только локальные POST-запросы к API.",
    "Open client settings with: n624-latex setup":
      "Команда для открытия настроек клиента: n624-latex setup",
    "Origin does not match the local setup UI":
      "Несоответствие: Заголовок Origin и локальный интерфейс настройки.",
    "Protected credential file is present":
      "защищённый файл учётных данных: имеется.",
    "Render API credential is not configured":
      "Не настроено: учётные данные Render API",
    "Render API credential is provided by the environment":
      "Учётные данные API рендеринга получены из окружения.",
    "Request URL is invalid": "Недопустимое значение: URL запроса",
    "Request body is not valid JSON":
      "Тело запроса: ожидается корректный JSON.",
    "Request body is too large": "Превышен допустимый размер: тело запроса",
    "Request body must be a JSON object":
      "Тело запроса: ожидается объект JSON.",
    "Setup Web UI did not receive a TCP address":
      "Веб-интерфейс настройки не получил TCP-адрес.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Эта учётная запись Windows не смогла расшифровать сохранённые учётные данные DPAPI.",
    "The stored DPAPI credential file could not be read":
      "Не удалось прочитать сохранённый файл учётных данных DPAPI.",
    "Windows DPAPI credential storage failed":
      "хранение учётных данных Windows DPAPI: операция не выполнена.",
    "Windows DPAPI credential verification failed":
      "проверка учётных данных Windows DPAPI: операция не выполнена.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell не удалось инициализировать или завершить операцию DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "В Windows каталоги установки и bin должны задаваться абсолютными путями без кавычек, точек с запятой и управляющих символов.",
  }),
  tr: () => ({
    "A setup operation is already running":
      "Yerel kurulum işlemi: zaten sürüyor.",
    "Bootstrap token is invalid or already used":
      "Başlangıç belirteci geçersiz veya zaten kullanılmış.",
    "CSRF token is invalid": "Geçersiz değer: CSRF belirteci",
    "Client archive SHA-256 verification failed":
      "istemci arşivinin SHA-256 değeri doğrulaması: işlem başarısız oldu.",
    "Client archive central directory is malformed":
      "ZIP merkez dizini: veriler bozuk.",
    "Client archive central directory size is invalid":
      "Geçersiz değer: istemci arşivi merkez dizininin boyutu",
    "Client archive data is truncated":
      "İstemci arşivinin içeriği: veriler kesilmiş.",
    "Client archive end record was not found":
      "Bulunamadı: istemci arşivinin son kaydı",
    "Client archive entry is truncated":
      "İstemci arşivi girdisi: veriler kesilmiş.",
    "Client archive expanded size is invalid":
      "Geçersiz değer: açılmış istemci arşivinin boyutu",
    "Client archive has too many entries":
      "İstemci arşivi: çok fazla kayıt var.",
    "Client archive local and central headers do not match":
      "Eşleşmiyor: ZIP yerel başlığı / ZIP merkez başlığı.",
    "Client archive local header is malformed":
      "ZIP yerel başlığı: veriler bozuk.",
    "Client archive payload is incomplete":
      "İstemci arşivinin içeriği: veriler eksik.",
    "Client archive size verification failed":
      "istemci arşivi boyutu doğrulaması: işlem başarısız oldu.",
    "Client manifest is invalid": "Geçersiz değer: istemci bildirimi",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Komut dizini mevcut PATH içinde değil. Yeni bir terminal açın veya dizini ekleyin.",
    "Command directory is present in PATH": "Komut dizini PATH içinde mevcut.",
    "Command launcher is installed": "komut başlatıcı: mevcut.",
    "Command launcher is missing": "Eksik: komut başlatıcısı",
    "Command launcher is not owned by this installation":
      "Komut başlatıcısı bu kuruluma ait değil.",
    "Content-Type must be application/json":
      "Content-Type: beklenen değer: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Kimlik bilgisi: geçerli kullanıcının sahip olduğu, 0600 izinli normal dosya gerekli.",
    "Credential file permissions must be 0600":
      "Kimlik bilgisi dosyasının izinleri: beklenen değer: 0600.",
    "Credential path is not a regular file":
      "Kimlik bilgisi yolu: normal dosya değil.",
    "Cross-site requests are not allowed":
      "İzin verilmiyor: Siteler arası istekler.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Geçerli Windows hesabı DPAPI kimlik bilgisinin şifresini çözebilir.",
    "Encrypted ZIP entries are not supported":
      "Desteklenmiyor: şifrelenmiş ZIP girdileri.",
    "Host header does not match the local listener":
      "Eşleşmiyor: Host üstbilgisi / yerel dinleyici.",
    "Input is not a render API key":
      "Girdi beklenen türde değil: işleme API anahtarı.",
    "Installation directory exists without managed state and will be preserved":
      "Kurulum dizini yönetilen durum olmadan mevcut ve korunacak.",
    "Installation failed; the previous client was restored.":
      "Kurulum başarısız oldu. Önceki istemci geri yüklendi.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Yüklü istemci dosyaları eksik. Yeniden yüklemek için setup komutunu çalıştırın.",
    "Installed payload is missing": "Yüklü istemci dosyaları: bulunamadı.",
    "Installed payload is present": "Yüklü istemci dosyaları: mevcut.",
    "LaTeX Renderer client was removed.":
      "LaTeX Renderer istemcisi kaldırıldı.",
    "Local setup endpoint was not found":
      "Bulunamadı: yerel kurulum uç noktası",
    "Local setup operation failed": "Yerel kurulum: işlem başarısız oldu.",
    "Local setup session is required": "Gerekli: yerel kurulum oturumu",
    "Loopback access is required":
      "Gerekli: geri döngü arabirimi üzerinden erişim",
    "Managed command launcher is current":
      "yönetilen komut başlatıcı: zaten güncel.",
    "Managed installation state has an unsupported format":
      "Yönetilen kurulum durumu: biçim tanınmadı.",
    "Managed installation state is not a regular file":
      "Yönetilen kurulum durumu: normal dosya değil.",
    "Managed installation state is not valid JSON":
      "Yönetilen kurulum durumu: beklenen değer: geçerli JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Yönetilen kurulum durumu: geçerli kullanıcıya ait olmalı, grup ve diğer kullanıcılar tarafından yazılabilir olmamalıdır.",
    "Managed installation state was not found":
      "Yönetilen kurulum durumu: bulunamadı.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Çok parçalı veya hatalı ZIP arşivleri desteklenmez",
    "No stored DPAPI credential file was found":
      "Bulunamadı: kayıtlı DPAPI kimlik bilgisi dosyası",
    "Only local POST API requests are allowed":
      "Yalnızca yerel POST API isteklerine izin verilir.",
    "Open client settings with: n624-latex setup":
      "İstemci ayarlarını açma komutu: n624-latex setup",
    "Origin does not match the local setup UI":
      "Eşleşmiyor: Origin üstbilgisi / yerel kurulum arayüzü.",
    "Protected credential file is present":
      "korumalı kimlik bilgisi dosyası: mevcut.",
    "Render API credential is not configured":
      "Yapılandırılmamış: Render API kimlik bilgileri",
    "Render API credential is provided by the environment":
      "İşleme API kimlik bilgisi ortamdan sağlanıyor.",
    "Request URL is invalid": "Geçersiz değer: istek URL’si",
    "Request body is not valid JSON":
      "İstek gövdesi: beklenen değer: geçerli JSON.",
    "Request body is too large": "Boyut sınırı aşıldı: istek gövdesi",
    "Request body must be a JSON object":
      "İstek gövdesi: beklenen değer: JSON nesnesi.",
    "Setup Web UI did not receive a TCP address":
      "Kurulum web arayüzüne TCP adresi verilmedi.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Kayıtlı DPAPI kimlik bilgisinin şifresi bu Windows hesabıyla çözülemedi.",
    "The stored DPAPI credential file could not be read":
      "Kayıtlı DPAPI kimlik bilgisi dosyası okunamadı.",
    "Windows DPAPI credential storage failed":
      "Windows DPAPI kimlik bilgileri depolama: işlem başarısız oldu.",
    "Windows DPAPI credential verification failed":
      "Windows DPAPI kimlik bilgileri doğrulaması: işlem başarısız oldu.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell DPAPI işlemini başlatamadı veya tamamlayamadı.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windows’ta kurulum ve bin dizinleri tırnak, noktalı virgül veya kontrol karakteri içermeyen mutlak yollar olmalıdır.",
  }),
  pl: () => ({
    "A setup operation is already running":
      "Operacja konfiguracji lokalnej: już w toku.",
    "Bootstrap token is invalid or already used":
      "Token startowy jest nieprawidłowy lub został już użyty.",
    "CSRF token is invalid": "Nieprawidłowa wartość: token CSRF",
    "Client archive SHA-256 verification failed":
      "weryfikacja (SHA-256 archiwum klienta): operacja nie powiodła się.",
    "Client archive central directory is malformed":
      "katalog centralny ZIP: uszkodzone dane.",
    "Client archive central directory size is invalid":
      "Nieprawidłowa wartość: rozmiar głównego katalogu archiwum klienta",
    "Client archive data is truncated":
      "Zawartość archiwum klienta: obcięte dane.",
    "Client archive end record was not found":
      "Nie znaleziono: rekord końcowy archiwum klienta",
    "Client archive entry is truncated":
      "Pozycja archiwum klienta: obcięte dane.",
    "Client archive expanded size is invalid":
      "Nieprawidłowa wartość: rozmiar archiwum klienta po rozpakowaniu",
    "Client archive has too many entries": "Archiwum klienta: za dużo wpisów.",
    "Client archive local and central headers do not match":
      "Niezgodność: lokalny nagłówek ZIP i centralny nagłówek ZIP.",
    "Client archive local header is malformed":
      "lokalny nagłówek ZIP: uszkodzone dane.",
    "Client archive payload is incomplete":
      "Zawartość archiwum klienta: niepełne dane.",
    "Client archive size verification failed":
      "weryfikacja (rozmiaru archiwum klienta): operacja nie powiodła się.",
    "Client manifest is invalid": "Nieprawidłowa wartość: manifest klienta",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Katalogu poleceń nie ma w bieżącym PATH. Otwórz nowy terminal lub dodaj katalog.",
    "Command directory is present in PATH": "Katalog poleceń jest w PATH.",
    "Command launcher is installed":
      "program uruchamiający polecenia: znaleziono.",
    "Command launcher is missing": "Brak: program uruchamiający polecenia",
    "Command launcher is not owned by this installation":
      "Program uruchamiający polecenia nie należy do tej instalacji.",
    "Content-Type must be application/json":
      "Content-Type: oczekiwana wartość: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Dane uwierzytelniające: wymagany zwykły plik bieżącego użytkownika z uprawnieniami 0600.",
    "Credential file permissions must be 0600":
      "Uprawnienia pliku danych uwierzytelniających: oczekiwana wartość: 0600.",
    "Credential path is not a regular file":
      "Ścieżka danych uwierzytelniających: nie jest zwykłym plikiem.",
    "Cross-site requests are not allowed":
      "Niedozwolone: Żądania między witrynami.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Bieżące konto Windows może odszyfrować dane uwierzytelniające DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Nieobsługiwane: zaszyfrowane wpisy ZIP.",
    "Host header does not match the local listener":
      "Niezgodność: Nagłówek Host i lokalny nasłuch.",
    "Input is not a render API key":
      "Wartość wejściowa nie odpowiada typowi: klucz API renderowania.",
    "Installation directory exists without managed state and will be preserved":
      "Istniejący katalog instalacji nie ma stanu zarządzania i zostanie zachowany.",
    "Installation failed; the previous client was restored.":
      "Instalacja nie powiodła się. Przywrócono poprzedniego klienta.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Pliki zainstalowanego klienta są niekompletne. Uruchom setup, aby zainstalować go ponownie.",
    "Installed payload is missing":
      "Pliki zainstalowanego klienta: nie znaleziono.",
    "Installed payload is present":
      "Pliki zainstalowanego klienta: znaleziono.",
    "LaTeX Renderer client was removed.": "Usunięto klienta LaTeX Renderer.",
    "Local setup endpoint was not found":
      "Nie znaleziono: punkt końcowy konfiguracji lokalnej",
    "Local setup operation failed":
      "Konfiguracja lokalna: operacja nie powiodła się.",
    "Local setup session is required": "Wymagane: sesja konfiguracji lokalnej",
    "Loopback access is required":
      "Wymagane: dostęp przez interfejs pętli zwrotnej",
    "Managed command launcher is current":
      "zarządzany program uruchamiający polecenia: wersja aktualna.",
    "Managed installation state has an unsupported format":
      "Stan zarządzanej instalacji: nierozpoznany format.",
    "Managed installation state is not a regular file":
      "Stan zarządzanej instalacji: nie jest zwykłym plikiem.",
    "Managed installation state is not valid JSON":
      "Stan zarządzanej instalacji: oczekiwana wartość: poprawny JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Stan zarządzanej instalacji: musi należeć do bieżącego użytkownika, bez prawa zapisu dla grupy i innych użytkowników.",
    "Managed installation state was not found":
      "Stan zarządzanej instalacji: nie znaleziono.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Wieloczęściowe lub uszkodzone archiwa ZIP nie są obsługiwane",
    "No stored DPAPI credential file was found":
      "Nie znaleziono: zapisany plik danych uwierzytelniających DPAPI",
    "Only local POST API requests are allowed":
      "Dozwolone są tylko lokalne żądania POST do API.",
    "Open client settings with: n624-latex setup":
      "Polecenie otwierające ustawienia klienta: n624-latex setup",
    "Origin does not match the local setup UI":
      "Niezgodność: Nagłówek Origin i lokalny interfejs konfiguracji.",
    "Protected credential file is present":
      "chroniony plik poświadczeń: znaleziono.",
    "Render API credential is not configured":
      "Nie skonfigurowano: dane uwierzytelniające Render API",
    "Render API credential is provided by the environment":
      "Dane uwierzytelniające API renderowania pochodzą ze środowiska.",
    "Request URL is invalid": "Nieprawidłowa wartość: URL żądania",
    "Request body is not valid JSON":
      "Treść żądania: oczekiwana wartość: poprawny JSON.",
    "Request body is too large": "Przekroczono limit rozmiaru: treść żądania",
    "Request body must be a JSON object":
      "Treść żądania: oczekiwana wartość: obiekt JSON.",
    "Setup Web UI did not receive a TCP address":
      "Interfejs konfiguracji WWW nie otrzymał adresu TCP.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Nie udało się odszyfrować zapisanych danych DPAPI za pomocą tego konta Windows.",
    "The stored DPAPI credential file could not be read":
      "Nie można odczytać zapisanego pliku danych uwierzytelniających DPAPI.",
    "Windows DPAPI credential storage failed":
      "zapis (poświadczeń Windows DPAPI): operacja nie powiodła się.",
    "Windows DPAPI credential verification failed":
      "weryfikacja (poświadczeń Windows DPAPI): operacja nie powiodła się.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell nie zainicjował lub nie ukończył operacji DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "W Windows katalogi instalacji i bin muszą mieć ścieżki bezwzględne bez cudzysłowów, średników i znaków sterujących.",
  }),
  cs: () => ({
    "A setup operation is already running":
      "Operace místního nastavení: již probíhá.",
    "Bootstrap token is invalid or already used":
      "Zaváděcí token je neplatný nebo již byl použit.",
    "CSRF token is invalid": "Neplatná hodnota: token CSRF",
    "Client archive SHA-256 verification failed":
      "ověření (SHA-256 archivu klienta): operace se nezdařila.",
    "Client archive central directory is malformed":
      "centrální adresář ZIP: poškozená data.",
    "Client archive central directory size is invalid":
      "Neplatná hodnota: velikost centrálního adresáře archivu klienta",
    "Client archive data is truncated": "Obsah archivu klienta: zkrácená data.",
    "Client archive end record was not found":
      "Nenalezeno: koncový záznam archivu klienta",
    "Client archive entry is truncated":
      "Položka archivu klienta: zkrácená data.",
    "Client archive expanded size is invalid":
      "Neplatná hodnota: rozbalená velikost archivu klienta",
    "Client archive has too many entries":
      "Archiv klienta: příliš mnoho položek.",
    "Client archive local and central headers do not match":
      "Neshoda: místní hlavička ZIP a centrální hlavička ZIP.",
    "Client archive local header is malformed":
      "místní hlavička ZIP: poškozená data.",
    "Client archive payload is incomplete":
      "Obsah archivu klienta: neúplné údaje.",
    "Client archive size verification failed":
      "ověření (velikosti archivu klienta): operace se nezdařila.",
    "Client manifest is invalid": "Neplatná hodnota: manifest klienta",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Adresář příkazů není v aktuální PATH. Otevřete nový terminál nebo jej přidejte.",
    "Command directory is present in PATH": "Adresář příkazů je v PATH.",
    "Command launcher is installed": "spouštěč příkazů: nalezeno.",
    "Command launcher is missing": "Chybí: spouštěč příkazů",
    "Command launcher is not owned by this installation":
      "Spouštěč příkazů nepatří této instalaci.",
    "Content-Type must be application/json":
      "Content-Type: očekávaná hodnota: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Přihlašovací údaj: musí jít o běžný soubor aktuálního uživatele s oprávněními 0600.",
    "Credential file permissions must be 0600":
      "Oprávnění souboru přihlašovacích údajů: očekávaná hodnota: 0600.",
    "Credential path is not a regular file":
      "Cesta k přihlašovacím údajům: nejde o běžný soubor.",
    "Cross-site requests are not allowed":
      "Není povoleno: Požadavky mezi weby.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Aktuální účet Windows může dešifrovat přihlašovací údaje DPAPI.",
    "Encrypted ZIP entries are not supported":
      "Nepodporováno: šifrované položky ZIP.",
    "Host header does not match the local listener":
      "Neshoda: Hlavička Host a místní posluchač.",
    "Input is not a render API key":
      "Zadaná hodnota neodpovídá typu: klíč API pro vykreslování.",
    "Installation directory exists without managed state and will be preserved":
      "Instalační adresář obsahuje instalaci bez spravovaného stavu a zůstane zachován.",
    "Installation failed; the previous client was restored.":
      "Instalace se nezdařila. Předchozí klient byl obnoven.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Instalace klienta je neúplná. Spusťte setup a nainstalujte klienta znovu.",
    "Installed payload is missing":
      "Soubory nainstalovaného klienta: nenalezeno.",
    "Installed payload is present":
      "Soubory nainstalovaného klienta: nalezeno.",
    "LaTeX Renderer client was removed.": "Klient LaTeX Renderer byl odebrán.",
    "Local setup endpoint was not found":
      "Nenalezeno: koncový bod místního nastavení",
    "Local setup operation failed": "Místní nastavení: operace se nezdařila.",
    "Local setup session is required": "Vyžaduje se: relace místního nastavení",
    "Loopback access is required":
      "Vyžaduje se: přístup přes rozhraní zpětné smyčky",
    "Managed command launcher is current":
      "spravovaný spouštěč příkazů: již aktuální.",
    "Managed installation state has an unsupported format":
      "Stav spravované instalace: nerozpoznaný formát.",
    "Managed installation state is not a regular file":
      "Stav spravované instalace: nejde o běžný soubor.",
    "Managed installation state is not valid JSON":
      "Stav spravované instalace: očekávaná hodnota: platný JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Stav spravované instalace: vlastníkem musí být aktuální uživatel, skupina a ostatní nesmějí mít právo zápisu.",
    "Managed installation state was not found":
      "Stav spravované instalace: nenalezeno.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Vícedílné ani chybně vytvořené archivy ZIP nejsou podporovány",
    "No stored DPAPI credential file was found":
      "Nenalezeno: uložený soubor přihlašovacích údajů DPAPI",
    "Only local POST API requests are allowed":
      "Jsou povoleny pouze místní požadavky POST na API.",
    "Open client settings with: n624-latex setup":
      "Příkaz k otevření nastavení klienta: n624-latex setup",
    "Origin does not match the local setup UI":
      "Neshoda: Hlavička Origin a místní rozhraní nastavení.",
    "Protected credential file is present":
      "chráněný soubor přihlašovacích údajů: nalezeno.",
    "Render API credential is not configured":
      "Nenastaveno: přihlašovací údaje Render API",
    "Render API credential is provided by the environment":
      "Přihlašovací údaj k API vykreslování pochází z prostředí.",
    "Request URL is invalid": "Neplatná hodnota: URL požadavku",
    "Request body is not valid JSON":
      "Tělo požadavku: očekávaná hodnota: platný JSON.",
    "Request body is too large": "Překročen limit velikosti: tělo požadavku",
    "Request body must be a JSON object":
      "Tělo požadavku: očekávaná hodnota: objekt JSON.",
    "Setup Web UI did not receive a TCP address":
      "Webové rozhraní nastavení nezískalo TCP adresu.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Tímto účtem Windows se nepodařilo dešifrovat uložené přihlašovací údaje DPAPI.",
    "The stored DPAPI credential file could not be read":
      "Uložený soubor přihlašovacích údajů DPAPI nelze přečíst.",
    "Windows DPAPI credential storage failed":
      "uložení (přihlašovacích údajů Windows DPAPI): operace se nezdařila.",
    "Windows DPAPI credential verification failed":
      "ověření (přihlašovacích údajů Windows DPAPI): operace se nezdařila.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell nedokázal inicializovat nebo dokončit operaci DPAPI.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Ve Windows musí být instalační adresář a adresář bin zadány absolutními cestami bez uvozovek, středníků a řídicích znaků.",
  }),
  nl: () => ({
    "A setup operation is already running":
      "Lokale installatiebewerking: al bezig.",
    "Bootstrap token is invalid or already used":
      "Het bootstraptoken is ongeldig of al gebruikt.",
    "CSRF token is invalid": "Ongeldige waarde: CSRF-token",
    "Client archive SHA-256 verification failed":
      "verificatie van SHA-256 van het clientarchief: bewerking mislukt.",
    "Client archive central directory is malformed":
      "centrale ZIP-directory: beschadigde gegevens.",
    "Client archive central directory size is invalid":
      "Ongeldige waarde: grootte van de centrale directory van het clientarchief",
    "Client archive data is truncated":
      "Inhoud van het clientarchief: afgekapt.",
    "Client archive end record was not found":
      "Niet gevonden: eindrecord van het clientarchief",
    "Client archive entry is truncated": "Item in het clientarchief: afgekapt.",
    "Client archive expanded size is invalid":
      "Ongeldige waarde: uitgepakte grootte van het clientarchief",
    "Client archive has too many entries":
      "Clientarchief: te veel vermeldingen.",
    "Client archive local and central headers do not match":
      "Komen niet overeen: lokale ZIP-header en centrale ZIP-header.",
    "Client archive local header is malformed":
      "lokale ZIP-header: beschadigde gegevens.",
    "Client archive payload is incomplete":
      "Inhoud van het clientarchief: onvolledig.",
    "Client archive size verification failed":
      "verificatie van grootte van het clientarchief: bewerking mislukt.",
    "Client manifest is invalid": "Ongeldige waarde: clientmanifest",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "De opdrachtenmap staat niet in de huidige PATH. Open een nieuwe terminal of voeg de map toe.",
    "Command directory is present in PATH": "De opdrachtenmap staat in PATH.",
    "Command launcher is installed": "opdrachtstarter: aanwezig.",
    "Command launcher is missing": "Ontbreekt: opdrachtstarter",
    "Command launcher is not owned by this installation":
      "De opdrachtstarter is niet van deze installatie.",
    "Content-Type must be application/json":
      "Content-Type: verwachte waarde: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Inloggegevens: regulier bestand van de huidige gebruiker met modus 0600 vereist.",
    "Credential file permissions must be 0600":
      "Rechten van het inloggegevensbestand: verwachte waarde: 0600.",
    "Credential path is not a regular file":
      "Pad voor inloggegevens: geen regulier bestand.",
    "Cross-site requests are not allowed":
      "Niet toegestaan: Siteoverschrijdende verzoeken.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Het huidige Windows-account kan de DPAPI-inloggegevens ontsleutelen.",
    "Encrypted ZIP entries are not supported":
      "Niet ondersteund: versleutelde ZIP-items.",
    "Host header does not match the local listener":
      "Komen niet overeen: Host-header en lokale listener.",
    "Input is not a render API key":
      "De invoer is niet van het verwachte type: render-API-sleutel.",
    "Installation directory exists without managed state and will be preserved":
      "De installatiemap bestaat zonder beheerstatus en blijft behouden.",
    "Installation failed; the previous client was restored.":
      "De installatie is mislukt. De vorige client is hersteld.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "De clientinstallatie is onvolledig. Voer setup uit om de client opnieuw te installeren.",
    "Installed payload is missing":
      "Geïnstalleerde clientbestanden: ontbreekt.",
    "Installed payload is present": "Geïnstalleerde clientbestanden: aanwezig.",
    "LaTeX Renderer client was removed.":
      "De LaTeX Renderer-client is verwijderd.",
    "Local setup endpoint was not found":
      "Niet gevonden: eindpunt voor lokale installatie",
    "Local setup operation failed": "Lokale installatie: bewerking mislukt.",
    "Local setup session is required": "Vereist: lokale installatiesessie",
    "Loopback access is required": "Vereist: toegang via loopback",
    "Managed command launcher is current":
      "beheerde opdrachtstarter: al actueel.",
    "Managed installation state has an unsupported format":
      "Status van de beheerde installatie: niet-herkende indeling.",
    "Managed installation state is not a regular file":
      "Status van de beheerde installatie: geen regulier bestand.",
    "Managed installation state is not valid JSON":
      "Status van de beheerde installatie: verwachte waarde: geldige JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Status van de beheerde installatie: moet eigendom zijn van de huidige gebruiker en mag niet beschrijfbaar zijn voor de groep of anderen.",
    "Managed installation state was not found":
      "Status van de beheerde installatie: ontbreekt.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Meerdelige of ongeldige ZIP-archieven worden niet ondersteund",
    "No stored DPAPI credential file was found":
      "Niet gevonden: opgeslagen DPAPI-inloggegevensbestand",
    "Only local POST API requests are allowed":
      "Alleen lokale POST-verzoeken aan de API zijn toegestaan.",
    "Open client settings with: n624-latex setup":
      "Opdracht om clientinstellingen te openen: n624-latex setup",
    "Origin does not match the local setup UI":
      "Komen niet overeen: Origin-header en lokale instelinterface.",
    "Protected credential file is present":
      "beveiligd bestand met aanmeldgegevens: aanwezig.",
    "Render API credential is not configured":
      "Niet ingesteld: inloggegevens voor de Render API",
    "Render API credential is provided by the environment":
      "De inloggegevens voor de render-API komen uit de omgeving.",
    "Request URL is invalid": "Ongeldige waarde: verzoek-URL",
    "Request body is not valid JSON":
      "Verzoekinhoud: verwachte waarde: geldige JSON.",
    "Request body is too large": "Groottelimiet overschreden: verzoekinhoud",
    "Request body must be a JSON object":
      "Verzoekinhoud: verwachte waarde: een JSON-object.",
    "Setup Web UI did not receive a TCP address":
      "De webinterface voor installatie heeft geen TCP-adres ontvangen.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Dit Windows-account kon de opgeslagen DPAPI-inloggegevens niet ontsleutelen.",
    "The stored DPAPI credential file could not be read":
      "Het opgeslagen DPAPI-inloggegevensbestand kon niet worden gelezen.",
    "Windows DPAPI credential storage failed":
      "opslag van Windows DPAPI-aanmeldgegevens: bewerking mislukt.",
    "Windows DPAPI credential verification failed":
      "verificatie van Windows DPAPI-aanmeldgegevens: bewerking mislukt.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell kon de DPAPI-bewerking niet initialiseren of voltooien.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windows-installatie- en bin-mappen moeten absolute paden zijn zonder aanhalingstekens, puntkomma’s of stuurtekens.",
  }),
  sv: () => ({
    "A setup operation is already running":
      "Lokal konfigurationsåtgärd: pågår redan.",
    "Bootstrap token is invalid or already used":
      "Starttoken är ogiltig eller redan använd.",
    "CSRF token is invalid": "Ogiltigt värde: CSRF-token",
    "Client archive SHA-256 verification failed":
      "kontroll av klientarkivets SHA-256: åtgärden misslyckades.",
    "Client archive central directory is malformed":
      "centralkatalog för ZIP: skadade data.",
    "Client archive central directory size is invalid":
      "Ogiltigt värde: storlek på klientarkivets centralkatalog",
    "Client archive data is truncated":
      "Klientarkivets innehåll: data avkortade.",
    "Client archive end record was not found":
      "Hittades inte: klientarkivets slutpost",
    "Client archive entry is truncated":
      "Post i klientarkivet: data avkortade.",
    "Client archive expanded size is invalid":
      "Ogiltigt värde: klientarkivets uppackade storlek",
    "Client archive has too many entries": "Klientarkiv: för många poster.",
    "Client archive local and central headers do not match":
      "Stämmer inte överens: lokalt ZIP-huvud och centralt ZIP-huvud.",
    "Client archive local header is malformed":
      "lokalt ZIP-huvud: skadade data.",
    "Client archive payload is incomplete":
      "Klientarkivets innehåll: ofullständiga data.",
    "Client archive size verification failed":
      "kontroll av klientarkivets storlek: åtgärden misslyckades.",
    "Client manifest is invalid": "Ogiltigt värde: klientmanifest",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Kommandokatalogen finns inte i nuvarande PATH. Öppna en ny terminal eller lägg till den.",
    "Command directory is present in PATH": "Kommandokatalogen finns i PATH.",
    "Command launcher is installed": "kommandostartare: finns.",
    "Command launcher is missing": "Saknas: kommandostartare",
    "Command launcher is not owned by this installation":
      "Kommandostartaren tillhör inte denna installation.",
    "Content-Type must be application/json":
      "Content-Type: förväntat värde: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Inloggningsuppgift: måste vara en vanlig fil som ägs av aktuell användare med läget 0600.",
    "Credential file permissions must be 0600":
      "Behörigheter för filen med inloggningsuppgifter: förväntat värde: 0600.",
    "Credential path is not a regular file":
      "Sökväg till inloggningsuppgifter: är inte en vanlig fil.",
    "Cross-site requests are not allowed":
      "Tillåts inte: Begäranden mellan webbplatser.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Det aktuella Windows-kontot kan dekryptera DPAPI-inloggningsuppgiften.",
    "Encrypted ZIP entries are not supported":
      "Stöds inte: krypterade ZIP-poster.",
    "Host header does not match the local listener":
      "Stämmer inte överens: Host-huvud och lokal lyssnare.",
    "Input is not a render API key":
      "Indata har inte förväntad typ: API-nyckel för rendering.",
    "Installation directory exists without managed state and will be preserved":
      "Installationskatalogen finns utan hanterat tillstånd och kommer att behållas.",
    "Installation failed; the previous client was restored.":
      "Installationen misslyckades. Den tidigare klienten återställdes.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Klientinstallationen är ofullständig. Kör setup för att installera om klienten.",
    "Installed payload is missing": "Installerade klientfiler: saknas.",
    "Installed payload is present": "Installerade klientfiler: finns.",
    "LaTeX Renderer client was removed.": "LaTeX Renderer-klienten togs bort.",
    "Local setup endpoint was not found":
      "Hittades inte: slutpunkt för lokal konfiguration",
    "Local setup operation failed":
      "Lokal konfiguration: åtgärden misslyckades.",
    "Local setup session is required": "Krävs: lokal konfigurationssession",
    "Loopback access is required": "Krävs: åtkomst via loopback",
    "Managed command launcher is current":
      "hanterad kommandostartare: redan uppdaterat.",
    "Managed installation state has an unsupported format":
      "Hanterat installationstillstånd: okänt format.",
    "Managed installation state is not a regular file":
      "Hanterat installationstillstånd: är inte en vanlig fil.",
    "Managed installation state is not valid JSON":
      "Hanterat installationstillstånd: förväntat värde: giltig JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Hanterat installationstillstånd: måste ägas av aktuell användare och får inte vara skrivbar för gruppen eller andra.",
    "Managed installation state was not found":
      "Hanterat installationstillstånd: saknas.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Uppdelade eller felaktiga ZIP-arkiv stöds inte",
    "No stored DPAPI credential file was found":
      "Hittades inte: sparad fil med DPAPI-inloggningsuppgifter",
    "Only local POST API requests are allowed":
      "Endast lokala POST-anrop till API:et tillåts.",
    "Open client settings with: n624-latex setup":
      "Kommando för att öppna klientinställningar: n624-latex setup",
    "Origin does not match the local setup UI":
      "Stämmer inte överens: Origin-huvud och lokalt konfigurationsgränssnitt.",
    "Protected credential file is present":
      "skyddad fil med autentiseringsuppgifter: finns.",
    "Render API credential is not configured":
      "Inte konfigurerat: inloggningsuppgifter för Render API",
    "Render API credential is provided by the environment":
      "Inloggningsuppgiften för renderings-API:et hämtas från miljön.",
    "Request URL is invalid": "Ogiltigt värde: begärans URL",
    "Request body is not valid JSON":
      "Begärans innehåll: förväntat värde: giltig JSON.",
    "Request body is too large":
      "Storleksgränsen har överskridits: begärans innehåll",
    "Request body must be a JSON object":
      "Begärans innehåll: förväntat värde: ett JSON-objekt.",
    "Setup Web UI did not receive a TCP address":
      "Webbgränssnittet för konfiguration fick ingen TCP-adress.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Det här Windows-kontot kunde inte dekryptera den sparade DPAPI-inloggningsuppgiften.",
    "The stored DPAPI credential file could not be read":
      "Den sparade filen med DPAPI-inloggningsuppgifter kunde inte läsas.",
    "Windows DPAPI credential storage failed":
      "lagring av Windows DPAPI-autentiseringsuppgifter: åtgärden misslyckades.",
    "Windows DPAPI credential verification failed":
      "kontroll av Windows DPAPI-autentiseringsuppgifter: åtgärden misslyckades.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell kunde inte initiera eller slutföra DPAPI-åtgärden.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "I Windows måste installations- och bin-katalogerna vara absoluta sökvägar utan citattecken, semikolon eller styrtecken.",
  }),
  no: () => ({
    "A setup operation is already running":
      "Lokal oppsettsoperasjon: pågår allerede.",
    "Bootstrap token is invalid or already used":
      "Oppstartstokenet er ugyldig eller allerede brukt.",
    "CSRF token is invalid": "Ugyldig verdi: CSRF-token",
    "Client archive SHA-256 verification failed":
      "kontroll av klientarkivets SHA-256: operasjonen mislyktes.",
    "Client archive central directory is malformed":
      "sentralkatalog i ZIP: skadede data.",
    "Client archive central directory size is invalid":
      "Ugyldig verdi: størrelsen på sentralkatalogen i klientarkivet",
    "Client archive data is truncated":
      "Klientarkivets innhold: avkortede data.",
    "Client archive end record was not found":
      "Fant ikke: sluttpost i klientarkivet",
    "Client archive entry is truncated":
      "Oppføring i klientarkivet: avkortede data.",
    "Client archive expanded size is invalid":
      "Ugyldig verdi: utpakket størrelse på klientarkivet",
    "Client archive has too many entries":
      "Klientarkiv: for mange oppføringer.",
    "Client archive local and central headers do not match":
      "Stemmer ikke overens: lokalt ZIP-hode og sentralt ZIP-hode.",
    "Client archive local header is malformed":
      "lokalt ZIP-hode: skadede data.",
    "Client archive payload is incomplete":
      "Klientarkivets innhold: ufullstendige data.",
    "Client archive size verification failed":
      "kontroll av klientarkivets størrelse: operasjonen mislyktes.",
    "Client manifest is invalid": "Ugyldig verdi: klientmanifest",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Kommandomappen finnes ikke i gjeldende PATH. Åpne en ny terminal eller legg den til.",
    "Command directory is present in PATH": "Kommandomappen finnes i PATH.",
    "Command launcher is installed": "kommandostarter: finnes.",
    "Command launcher is missing": "Mangler: kommandostarter",
    "Command launcher is not owned by this installation":
      "Kommandostarteren tilhører ikke denne installasjonen.",
    "Content-Type must be application/json":
      "Content-Type: forventet verdi: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Påloggingsinformasjon: må være en vanlig fil eid av gjeldende bruker med modus 0600.",
    "Credential file permissions must be 0600":
      "Tillatelser for filen med påloggingsinformasjon: forventet verdi: 0600.",
    "Credential path is not a regular file":
      "Sti til påloggingsinformasjon: er ikke en vanlig fil.",
    "Cross-site requests are not allowed":
      "Ikke tillatt: Forespørsler mellom nettsteder.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Gjeldende Windows-konto kan dekryptere DPAPI-påloggingsinformasjonen.",
    "Encrypted ZIP entries are not supported":
      "Støttes ikke: krypterte ZIP-oppføringer.",
    "Host header does not match the local listener":
      "Stemmer ikke overens: Host-hode og lokal lytter.",
    "Input is not a render API key":
      "Inndataene har ikke forventet type: API-nøkkel for gjengivelse.",
    "Installation directory exists without managed state and will be preserved":
      "Installasjonsmappen finnes uten administrert tilstand og beholdes.",
    "Installation failed; the previous client was restored.":
      "Installasjonen mislyktes. Den forrige klienten ble gjenopprettet.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Klientinstallasjonen er ufullstendig. Kjør setup for å installere på nytt.",
    "Installed payload is missing": "Installerte klientfiler: mangler.",
    "Installed payload is present": "Installerte klientfiler: finnes.",
    "LaTeX Renderer client was removed.":
      "LaTeX Renderer-klienten ble fjernet.",
    "Local setup endpoint was not found":
      "Fant ikke: endepunkt for lokalt oppsett",
    "Local setup operation failed": "Lokalt oppsett: operasjonen mislyktes.",
    "Local setup session is required": "Påkrevd: lokal oppsettsøkt",
    "Loopback access is required": "Påkrevd: tilgang via loopback",
    "Managed command launcher is current":
      "administrert kommandostarter: allerede oppdatert.",
    "Managed installation state has an unsupported format":
      "Tilstanden for den administrerte installasjonen: ukjent format.",
    "Managed installation state is not a regular file":
      "Tilstanden for den administrerte installasjonen: er ikke en vanlig fil.",
    "Managed installation state is not valid JSON":
      "Tilstanden for den administrerte installasjonen: forventet verdi: gyldig JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Tilstanden for den administrerte installasjonen: må eies av gjeldende bruker og kan ikke være skrivbar for gruppen eller andre.",
    "Managed installation state was not found":
      "Tilstanden for den administrerte installasjonen: mangler.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Oppdelte eller feilformede ZIP-arkiver støttes ikke",
    "No stored DPAPI credential file was found":
      "Fant ikke: lagret fil med DPAPI-påloggingsinformasjon",
    "Only local POST API requests are allowed":
      "Bare lokale POST-forespørsler til API-et tillates.",
    "Open client settings with: n624-latex setup":
      "Kommando for å åpne klientinnstillingene: n624-latex setup",
    "Origin does not match the local setup UI":
      "Stemmer ikke overens: Origin-hode og lokalt oppsettsgrensesnitt.",
    "Protected credential file is present":
      "beskyttet fil med påloggingsopplysninger: finnes.",
    "Render API credential is not configured":
      "Ikke konfigurert: påloggingsinformasjon for Render API",
    "Render API credential is provided by the environment":
      "Påloggingsinformasjon for gjengivelses-API-et kommer fra miljøet.",
    "Request URL is invalid": "Ugyldig verdi: forespørselens URL",
    "Request body is not valid JSON":
      "Forespørselsinnhold: forventet verdi: gyldig JSON.",
    "Request body is too large":
      "Størrelsesgrensen er overskredet: forespørselsinnhold",
    "Request body must be a JSON object":
      "Forespørselsinnhold: forventet verdi: et JSON-objekt.",
    "Setup Web UI did not receive a TCP address":
      "Webgrensesnittet for oppsett fikk ingen TCP-adresse.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Denne Windows-kontoen kunne ikke dekryptere den lagrede DPAPI-påloggingsinformasjonen.",
    "The stored DPAPI credential file could not be read":
      "Kunne ikke lese den lagrede filen med DPAPI-påloggingsinformasjon.",
    "Windows DPAPI credential storage failed":
      "lagring av Windows DPAPI-påloggingsopplysninger: operasjonen mislyktes.",
    "Windows DPAPI credential verification failed":
      "kontroll av Windows DPAPI-påloggingsopplysninger: operasjonen mislyktes.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell kunne ikke initialisere eller fullføre DPAPI-operasjonen.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "I Windows må installasjons- og bin-mappene ha absolutte stier uten anførselstegn, semikolon eller kontrolltegn.",
  }),
  da: () => ({
    "A setup operation is already running":
      "Lokal opsætningshandling: er allerede i gang.",
    "Bootstrap token is invalid or already used":
      "Opstartstokenet er ugyldigt eller allerede brugt.",
    "CSRF token is invalid": "Ugyldig værdi: CSRF-token",
    "Client archive SHA-256 verification failed":
      "kontrol af klientarkivets SHA-256: handlingen mislykkedes.",
    "Client archive central directory is malformed":
      "centralt ZIP-katalog: beskadigede data.",
    "Client archive central directory size is invalid":
      "Ugyldig værdi: størrelsen af klientarkivets centralmappe",
    "Client archive data is truncated":
      "Klientarkivets indhold: afkortede data.",
    "Client archive end record was not found":
      "Ikke fundet: klientarkivets slutpost",
    "Client archive entry is truncated":
      "Post i klientarkivet: afkortede data.",
    "Client archive expanded size is invalid":
      "Ugyldig værdi: klientarkivets udpakkede størrelse",
    "Client archive has too many entries": "Klientarkiv: for mange poster.",
    "Client archive local and central headers do not match":
      "Stemmer ikke overens: lokalt ZIP-headerfelt og centralt ZIP-headerfelt.",
    "Client archive local header is malformed":
      "lokalt ZIP-headerfelt: beskadigede data.",
    "Client archive payload is incomplete":
      "Klientarkivets indhold: ufuldstændige data.",
    "Client archive size verification failed":
      "kontrol af klientarkivets størrelse: handlingen mislykkedes.",
    "Client manifest is invalid": "Ugyldig værdi: klientmanifest",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Kommandomappen findes ikke i den aktuelle PATH. Åbn en ny terminal, eller tilføj den.",
    "Command directory is present in PATH": "Kommandomappen findes i PATH.",
    "Command launcher is installed": "kommandostarter: findes.",
    "Command launcher is missing": "Mangler: kommandostarter",
    "Command launcher is not owned by this installation":
      "Kommandostarteren tilhører ikke denne installation.",
    "Content-Type must be application/json":
      "Content-Type: forventet værdi: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Legitimationsoplysning: skal være en almindelig fil ejet af den aktuelle bruger med tilstanden 0600.",
    "Credential file permissions must be 0600":
      "Rettigheder for filen med legitimationsoplysninger: forventet værdi: 0600.",
    "Credential path is not a regular file":
      "Sti til legitimationsoplysninger: er ikke en almindelig fil.",
    "Cross-site requests are not allowed":
      "Ikke tilladt: Anmodninger på tværs af websteder.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Den aktuelle Windows-konto kan dekryptere DPAPI-legitimationsoplysningerne.",
    "Encrypted ZIP entries are not supported":
      "Understøttes ikke: krypterede ZIP-poster.",
    "Host header does not match the local listener":
      "Stemmer ikke overens: Host-header og lokal lytter.",
    "Input is not a render API key":
      "Input har ikke den forventede type: API-nøgle til gengivelse.",
    "Installation directory exists without managed state and will be preserved":
      "Installationsmappen findes uden administreret tilstand og bevares.",
    "Installation failed; the previous client was restored.":
      "Installationen mislykkedes. Den forrige klient blev gendannet.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Klientinstallationen er ufuldstændig. Kør setup for at geninstallere.",
    "Installed payload is missing": "Installerede klientfiler: mangler.",
    "Installed payload is present": "Installerede klientfiler: findes.",
    "LaTeX Renderer client was removed.":
      "LaTeX Renderer-klienten blev fjernet.",
    "Local setup endpoint was not found":
      "Ikke fundet: slutpunkt til lokal opsætning",
    "Local setup operation failed": "Lokal opsætning: handlingen mislykkedes.",
    "Local setup session is required": "Påkrævet: lokal opsætningssession",
    "Loopback access is required": "Påkrævet: adgang via loopback",
    "Managed command launcher is current":
      "administreret kommandostarter: allerede opdateret.",
    "Managed installation state has an unsupported format":
      "Tilstanden for den administrerede installationen: ukendt format.",
    "Managed installation state is not a regular file":
      "Tilstanden for den administrerede installationen: er ikke en almindelig fil.",
    "Managed installation state is not valid JSON":
      "Tilstanden for den administrerede installationen: forventet værdi: gyldig JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Tilstanden for den administrerede installationen: skal ejes af den aktuelle bruger og må ikke være skrivbar for gruppen eller andre.",
    "Managed installation state was not found":
      "Tilstanden for den administrerede installationen: mangler.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Opdelte eller ugyldige ZIP-arkiver understøttes ikke",
    "No stored DPAPI credential file was found":
      "Ikke fundet: gemt fil med DPAPI-legitimationsoplysninger",
    "Only local POST API requests are allowed":
      "Kun lokale POST-anmodninger til API’et er tilladt.",
    "Open client settings with: n624-latex setup":
      "Kommando til at åbne klientindstillingerne: n624-latex setup",
    "Origin does not match the local setup UI":
      "Stemmer ikke overens: Origin-header og lokal opsætningsgrænseflade.",
    "Protected credential file is present":
      "beskyttet fil med legitimationsoplysninger: findes.",
    "Render API credential is not configured":
      "Ikke konfigureret: legitimationsoplysninger til Render API",
    "Render API credential is provided by the environment":
      "Legitimationsoplysninger til gengivelses-API’et kommer fra miljøet.",
    "Request URL is invalid": "Ugyldig værdi: anmodningens URL",
    "Request body is not valid JSON":
      "Anmodningens indhold: forventet værdi: gyldig JSON.",
    "Request body is too large":
      "Størrelsesgrænsen er overskredet: anmodningens indhold",
    "Request body must be a JSON object":
      "Anmodningens indhold: forventet værdi: et JSON-objekt.",
    "Setup Web UI did not receive a TCP address":
      "Webgrænsefladen til opsætning fik ingen TCP-adresse.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Denne Windows-konto kunne ikke dekryptere de gemte DPAPI-legitimationsoplysninger.",
    "The stored DPAPI credential file could not be read":
      "Den gemte fil med DPAPI-legitimationsoplysninger kunne ikke læses.",
    "Windows DPAPI credential storage failed":
      "lagring af Windows DPAPI-legitimationsoplysninger: handlingen mislykkedes.",
    "Windows DPAPI credential verification failed":
      "kontrol af Windows DPAPI-legitimationsoplysninger: handlingen mislykkedes.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell kunne ikke initialisere eller fuldføre DPAPI-handlingen.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "På Windows skal installations- og bin-mapperne være absolutte stier uden anførselstegn, semikolon eller kontroltegn.",
  }),
  fi: () => ({
    "A setup operation is already running":
      "Paikallinen määritystoiminto: jo käynnissä.",
    "Bootstrap token is invalid or already used":
      "Alustustunniste on virheellinen tai jo käytetty.",
    "CSRF token is invalid": "Virheellinen arvo: CSRF-tunniste",
    "Client archive SHA-256 verification failed":
      "tarkistus (asiakasarkiston SHA-256): toiminto epäonnistui.",
    "Client archive central directory is malformed":
      "ZIP-keskushakemisto: tiedot vioittuneet.",
    "Client archive central directory size is invalid":
      "Virheellinen arvo: asiakasarkiston keskushakemiston koko",
    "Client archive data is truncated":
      "Asiakasarkiston sisältö: tiedot katkenneet.",
    "Client archive end record was not found":
      "Ei löydy: asiakasarkiston lopputietue",
    "Client archive entry is truncated":
      "Asiakasarkiston kohde: tiedot katkenneet.",
    "Client archive expanded size is invalid":
      "Virheellinen arvo: puretun asiakasarkiston koko",
    "Client archive has too many entries":
      "Asiakasarkisto: liian monta kohdetta.",
    "Client archive local and central headers do not match":
      "Eivät täsmää: paikallinen ZIP-otsake ja ZIP-keskusotsake.",
    "Client archive local header is malformed":
      "paikallinen ZIP-otsake: tiedot vioittuneet.",
    "Client archive payload is incomplete":
      "Asiakasarkiston sisältö: puutteelliset tiedot.",
    "Client archive size verification failed":
      "tarkistus (asiakasarkiston koko): toiminto epäonnistui.",
    "Client manifest is invalid": "Virheellinen arvo: asiakkaan manifesti",
    "Command directory is not present in the current PATH; open a new terminal or add it":
      "Komentohakemisto ei sisälly nykyiseen PATH-muuttujaan. Avaa uusi pääte tai lisää hakemisto muuttujaan.",
    "Command directory is present in PATH":
      "Komentohakemisto sisältyy PATH-muuttujaan.",
    "Command launcher is installed": "komentokäynnistin: löytyi.",
    "Command launcher is missing": "Puuttuu: komentojen käynnistin",
    "Command launcher is not owned by this installation":
      "Komentokäynnistin ei kuulu tähän asennukseen.",
    "Content-Type must be application/json":
      "Content-Type: odotettu arvo: application/json.",
    "Credential file must be a regular file owned by the current user with mode 0600":
      "Tunnistetieto: vaaditaan nykyisen käyttäjän omistama tavallinen tiedosto, jonka oikeudet ovat 0600.",
    "Credential file permissions must be 0600":
      "Tunnistetietotiedoston käyttöoikeudet: odotettu arvo: 0600.",
    "Credential path is not a regular file":
      "Tunnistetietojen polku: ei ole tavallinen tiedosto.",
    "Cross-site requests are not allowed":
      "Ei sallittu: Sivustojen väliset pyynnöt.",
    "DPAPI credential can be decrypted by the current Windows account":
      "Nykyinen Windows-tili voi purkaa DPAPI-tunnistetiedon salauksen.",
    "Encrypted ZIP entries are not supported":
      "Ei tuettu: salatut ZIP-merkinnät.",
    "Host header does not match the local listener":
      "Eivät täsmää: Host-otsake ja paikallinen kuuntelija.",
    "Input is not a render API key":
      "Syöte ei vastaa odotettua tyyppiä: renderöinnin API-avain.",
    "Installation directory exists without managed state and will be preserved":
      "Asennushakemisto on olemassa ilman hallintatilaa ja säilytetään.",
    "Installation failed; the previous client was restored.":
      "Asennus epäonnistui. Edellinen asiakasohjelma palautettiin.",
    "Installed client payload is incomplete; run setup to reinstall it":
      "Asiakasohjelman asennus on puutteellinen. Asenna se uudelleen komennolla setup.",
    "Installed payload is missing": "Asennetut asiakastiedostot: puuttuu.",
    "Installed payload is present": "Asennetut asiakastiedostot: löytyi.",
    "LaTeX Renderer client was removed.":
      "LaTeX Renderer -asiakasohjelma poistettiin.",
    "Local setup endpoint was not found":
      "Ei löydy: paikallisen asennuksen päätepiste",
    "Local setup operation failed":
      "Paikallinen asennus: toiminto epäonnistui.",
    "Local setup session is required": "Vaaditaan: paikallinen asennusistunto",
    "Loopback access is required":
      "Vaaditaan: yhteys loopback-liitännän kautta",
    "Managed command launcher is current":
      "hallittu komentokäynnistin: jo ajan tasalla.",
    "Managed installation state has an unsupported format":
      "Hallitun asennuksen tila: tuntematon muoto.",
    "Managed installation state is not a regular file":
      "Hallitun asennuksen tila: ei ole tavallinen tiedosto.",
    "Managed installation state is not valid JSON":
      "Hallitun asennuksen tila: odotettu arvo: kelvollinen JSON.",
    "Managed installation state must be owned by the current user and not group/world writable":
      "Hallitun asennuksen tila: nykyisen käyttäjän on omistettava kohde, eikä ryhmällä tai muilla saa olla kirjoitusoikeutta.",
    "Managed installation state was not found":
      "Hallitun asennuksen tila: puuttuu.",
    "Multi-disk or malformed ZIP archives are not supported":
      "Moniosaisia tai virheellisiä ZIP-arkistoja ei tueta",
    "No stored DPAPI credential file was found":
      "Ei löydy: tallennettu DPAPI-tunnistetietotiedosto",
    "Only local POST API requests are allowed":
      "Vain paikalliset POST-pyynnöt APIin sallitaan.",
    "Open client settings with: n624-latex setup":
      "Asiakasohjelman asetukset avaava komento: n624-latex setup",
    "Origin does not match the local setup UI":
      "Eivät täsmää: Origin-otsake ja paikallinen määritysnäkymä.",
    "Protected credential file is present":
      "suojattu tunnistetietotiedosto: löytyi.",
    "Render API credential is not configured":
      "Ei määritetty: Render API -tunnukset",
    "Render API credential is provided by the environment":
      "Renderöinnin API-tunnistetieto saadaan ympäristöstä.",
    "Request URL is invalid": "Virheellinen arvo: pyynnön URL",
    "Request body is not valid JSON":
      "Pyynnön runko: odotettu arvo: kelvollinen JSON.",
    "Request body is too large": "Kokoraja ylittyi: pyynnön runko",
    "Request body must be a JSON object":
      "Pyynnön runko: odotettu arvo: JSON-objekti.",
    "Setup Web UI did not receive a TCP address":
      "Määrityksen verkkokäyttöliittymä ei saanut TCP-osoitetta.",
    "The stored DPAPI credential could not be decrypted by this Windows account":
      "Tämä Windows-tili ei pystynyt purkamaan tallennetun DPAPI-tunnistetiedon salausta.",
    "The stored DPAPI credential file could not be read":
      "Tallennettua DPAPI-tunnistetietotiedostoa ei voitu lukea.",
    "Windows DPAPI credential storage failed":
      "tallennus (Windows DPAPI -tunnistetiedot): toiminto epäonnistui.",
    "Windows DPAPI credential verification failed":
      "tarkistus (Windows DPAPI -tunnistetiedot): toiminto epäonnistui.",
    "Windows PowerShell could not initialize or complete the DPAPI operation":
      "Windows PowerShell ei pystynyt alustamaan tai viimeistelemään DPAPI-toimintoa.",
    "Windows installation and bin directories must be absolute paths without quotes, semicolons or control characters":
      "Windowsin asennus- ja bin-hakemistojen on oltava absoluuttisia polkuja ilman lainausmerkkejä, puolipisteitä tai ohjausmerkkejä.",
  }),
};
export function setupDiagnosticCatalog(locale: DisplayLocale): Catalog {
  return translations[locale]?.() ?? {};
}
