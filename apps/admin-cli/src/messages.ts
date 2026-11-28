import {
  terminalDisplayLocale,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";

const english = {
  showOrPreviewBackupRetention: "Show or preview local backup retention",
  confirmBackupRetention: "Confirm backup retention limits and prune now",
  backupRetentionMaxAge: "maximum archive age in days",
  backupRetentionMaxGenerations: "maximum number of backup generations",
  backupRetentionMaxBytes: "maximum total archive size in bytes",
  backupRetentionLimitsRequired:
    "Specify all three limits as integers. Days and generations must be positive. Bytes may be zero.",
  backupRetentionSavedPruneFailed: "Retention policy saved. Pruning failed.",
  modeMustBeNotifyOrAutomatic: "mode must be notify or automatic",
  chooseExactlyOneOfLanguageAll:
    "Choose exactly one of --language, --all-languages, or --clear-languages",
  texEnvironmentOperationFailed: "TeX environment operation failed",
  applicationUpdateFailed: "Application update failed",
  adminCredentialStored: "Admin credential stored.",
  adminCredentialMissing: "Admin credential missing",
  dpapiStorageFailed: "DPAPI storage failed",
  adminCredentialMustBeARegular:
    "Admin credential must be a regular file owned by the current user with mode 0600",
  passwordOrExternal: "password or external",
  latestYyyyMmDdWeeklyYyyy:
    "latest, YYYY-MM-DD, weekly:YYYY-Www, or sha256:...",
  inputIsNotAnAdminApi: "Input is not an admin API key",
  credentialInputExceedsTheSizeLimit: "Credential input exceeds the size limit",
  externalProviderSubject: "external provider subject",
  passwordLoginName: "password login name",
  texEnvironmentReconnectingToAdminApi:
    "TeX environment: reconnecting to Admin API...",
  readTheInitialPasswordFromStandard:
    "read the initial password from standard input, never argv",
  choosePasswordWithLoginNameAnd:
    "Choose password with --login-name and --password-stdin, or external with --subject",
  manageTheTexLiveBaseImage:
    "Manage the TeX Live base image and language collections",
  filterTheSharedLanguageCatalogWithout:
    "filter the shared language catalog without changing its server-provided order",
  selectEveryLanguageCollectionReturnedBy:
    "select every language collection returned by the common API",
  selectZeroOptionalLanguageCollections:
    "select zero optional language collections",
  rebuildAnUnavailableDatedImageLocally:
    "rebuild an unavailable dated image locally",
  reasonRecordedInTheAuditLog: "reason recorded in the audit log",
  cannotUseAllLanguagesWhileThe:
    "Cannot use --all-languages while the TeX Live language catalog is unavailable",
  updateTheSelfHostedLatexRenderer:
    "Update the self-hosted latex-renderer application from immutable GitHub Releases",
  configureBothCloudflareAccessServiceToken:
    "Configure both Cloudflare Access service-token fields, or neither for Standalone",
} as const;
type Message = keyof typeof english;
type Catalog = Readonly<Record<Message, string>>;
const locale = terminalDisplayLocale(process.env);
const select: Partial<Record<DisplayLocale, () => Catalog>> = {
  ja: () => ({
    showOrPreviewBackupRetention:
      "ローカルバックアップの保持設定を表示・プレビュー",
    confirmBackupRetention: "バックアップの保持上限を確定してすぐに整理",
    backupRetentionMaxAge: "バックアップの最大保持日数",
    backupRetentionMaxGenerations: "バックアップの最大保持世代数",
    backupRetentionMaxBytes: "バックアップの最大合計バイト数",
    backupRetentionLimitsRequired:
      "3つの上限をすべて整数で指定してください。日数と世代数は1以上、バイト数は0以上です。",
    backupRetentionSavedPruneFailed:
      "保持設定を保存しました。バックアップの整理に失敗しました。",
    modeMustBeNotifyOrAutomatic: "mode の許容値：notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "--language、--all-languages、--clear-languages のいずれか1つだけを指定してください。",
    texEnvironmentOperationFailed: "TeX環境：処理に失敗しました。",
    applicationUpdateFailed: "アプリケーション更新：処理に失敗しました。",
    adminCredentialStored: "管理者の認証情報：保存しました。",
    adminCredentialMissing: "管理者の認証情報：見つかりません。",
    dpapiStorageFailed: "DPAPIによる保存：処理に失敗しました。",
    adminCredentialMustBeARegular:
      "管理者の認証情報 は現在のユーザーが所有し、モード0600の通常ファイルでなければなりません。",
    passwordOrExternal: "password または external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www または sha256:...",
    inputIsNotAnAdminApi: "入力は管理用APIキーではありません。",
    credentialInputExceedsTheSizeLimit:
      "入力した認証情報 が上限を超えています。",
    externalProviderSubject: "外部プロバイダーのサブジェクト",
    passwordLoginName: "パスワードログイン名",
    texEnvironmentReconnectingToAdminApi: "TeX環境：Admin APIへ再接続中…",
    readTheInitialPasswordFromStandard:
      "初期パスワードは必ず標準入力から読み取る。argvは使用しない",
    choosePasswordWithLoginNameAnd:
      "password は --login-name と --password-stdin、external は --subject と組み合わせて指定",
    manageTheTexLiveBaseImage:
      "TeX Liveのベースイメージと言語コレクションを管理",
    filterTheSharedLanguageCatalogWithout:
      "サーバーの並び順を保ったまま共通の言語カタログを絞り込む",
    selectEveryLanguageCollectionReturnedBy:
      "共通APIが返すすべての言語コレクションを選択",
    selectZeroOptionalLanguageCollections:
      "任意の言語コレクションを一つも選択しない",
    rebuildAnUnavailableDatedImageLocally:
      "利用できない日付指定イメージをローカルで再ビルド",
    reasonRecordedInTheAuditLog: "監査ログに記録する理由",
    cannotUseAllLanguagesWhileThe:
      "TeX Live言語カタログが利用できない間は --all-languages を使用できません",
    updateTheSelfHostedLatexRenderer:
      "不変のGitHub Releasesからセルフホスト版latex-rendererを更新",
    configureBothCloudflareAccessServiceToken:
      "Cloudflare Accessのサービストークンは両方の項目を設定してください。Standaloneでは両方とも未設定にします",
  }),
  "zh-CN": () => ({
    showOrPreviewBackupRetention: "查看或预览本地备份保留策略",
    confirmBackupRetention: "确认备份保留上限并立即清理",
    backupRetentionMaxAge: "备份最长保留天数",
    backupRetentionMaxGenerations: "最多保留的备份代数",
    backupRetentionMaxBytes: "备份总大小上限（字节）",
    backupRetentionLimitsRequired:
      "请将三个上限都指定为整数。天数和代数须为正数，字节数可以为零。",
    backupRetentionSavedPruneFailed: "已保存保留策略。清理备份失败。",
    modeMustBeNotifyOrAutomatic: "mode 的允许值：notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "请从 --language、--all-languages、--clear-languages 中选择且仅选择一项。",
    texEnvironmentOperationFailed: "TeX 环境：操作失败。",
    applicationUpdateFailed: "应用程序更新：操作失败。",
    adminCredentialStored: "管理员凭据：已保存。",
    adminCredentialMissing: "管理员凭据：未找到。",
    dpapiStorageFailed: "DPAPI 保存：操作失败。",
    adminCredentialMustBeARegular:
      "管理员凭据 必须是当前用户拥有且权限为 0600 的普通文件。",
    passwordOrExternal: "password 或 external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www 或 sha256:...",
    inputIsNotAnAdminApi: "输入不是管理 API 密钥。",
    credentialInputExceedsTheSizeLimit: "凭据输入 超出上限。",
    externalProviderSubject: "外部提供方主体",
    passwordLoginName: "密码登录名",
    texEnvironmentReconnectingToAdminApi: "TeX 环境：正在重新连接管理 API…",
    readTheInitialPasswordFromStandard:
      "仅从标准输入读取初始密码，绝不通过 argv",
    choosePasswordWithLoginNameAnd:
      "选择 password 并提供 --login-name 和 --password-stdin，或选择 external 并提供 --subject",
    manageTheTexLiveBaseImage: "管理 TeX Live 基础镜像和语言集合",
    filterTheSharedLanguageCatalogWithout:
      "筛选共享语言目录，保留服务器提供的顺序",
    selectEveryLanguageCollectionReturnedBy: "选择公共 API 返回的所有语言集合",
    selectZeroOptionalLanguageCollections: "不选择任何可选语言集合",
    rebuildAnUnavailableDatedImageLocally: "在本地重建不可用的日期版本镜像",
    reasonRecordedInTheAuditLog: "记入审计日志的原因",
    cannotUseAllLanguagesWhileThe:
      "TeX Live 语言目录不可用时无法使用 --all-languages",
    updateTheSelfHostedLatexRenderer:
      "从不可变的 GitHub Releases 更新自托管的 latex-renderer 应用",
    configureBothCloudflareAccessServiceToken:
      "Cloudflare Access 的服务令牌字段必须两个都填写；Standalone 模式下应都不填",
  }),
  ko: () => ({
    showOrPreviewBackupRetention: "로컬 백업 보존 설정 확인 또는 미리 보기",
    confirmBackupRetention: "백업 보존 한도를 확정하고 지금 정리",
    backupRetentionMaxAge: "최대 백업 보존 일수",
    backupRetentionMaxGenerations: "보존할 최대 백업 세대 수",
    backupRetentionMaxBytes: "백업의 최대 총 크기(바이트)",
    backupRetentionLimitsRequired:
      "세 가지 한도를 모두 정수로 지정하세요. 일수와 세대 수는 양수이며 바이트 수는 0일 수 있습니다.",
    backupRetentionSavedPruneFailed:
      "보존 정책을 저장했습니다. 백업 정리에 실패했습니다.",
    modeMustBeNotifyOrAutomatic: "mode에 허용되는 값: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "--language, --all-languages, --clear-languages 중 하나만 지정하세요.",
    texEnvironmentOperationFailed: "TeX 환경: 작업이 실패했습니다.",
    applicationUpdateFailed: "애플리케이션 업데이트: 작업이 실패했습니다.",
    adminCredentialStored: "관리자 자격 증명: 저장했습니다.",
    adminCredentialMissing: "관리자 자격 증명: 찾을 수 없습니다.",
    dpapiStorageFailed: "DPAPI 저장: 작업이 실패했습니다.",
    adminCredentialMustBeARegular:
      "관리자 자격 증명: 현재 사용자 소유의 권한 0600인 일반 파일이어야 합니다.",
    passwordOrExternal: "password 또는 external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www 또는 sha256:...",
    inputIsNotAnAdminApi: "입력값이 관리 API 키 형식이 아닙니다.",
    credentialInputExceedsTheSizeLimit:
      "입력한 자격 증명: 한도를 초과했습니다.",
    externalProviderSubject: "외부 공급자 주체",
    passwordLoginName: "비밀번호 로그인 이름",
    texEnvironmentReconnectingToAdminApi:
      "TeX 환경: Admin API에 다시 연결하는 중…",
    readTheInitialPasswordFromStandard:
      "초기 비밀번호는 반드시 표준 입력으로만 읽고 argv는 사용하지 않음",
    choosePasswordWithLoginNameAnd:
      "password에는 --login-name 및 --password-stdin을, external에는 --subject를 지정하세요",
    manageTheTexLiveBaseImage: "TeX Live 기본 이미지 및 언어 모음 관리",
    filterTheSharedLanguageCatalogWithout:
      "서버가 제공한 순서를 유지하며 공통 언어 카탈로그 필터링",
    selectEveryLanguageCollectionReturnedBy:
      "공통 API가 반환한 모든 언어 모음 선택",
    selectZeroOptionalLanguageCollections:
      "선택적 언어 모음을 하나도 선택하지 않음",
    rebuildAnUnavailableDatedImageLocally:
      "사용할 수 없는 날짜 지정 이미지를 로컬에서 다시 빌드",
    reasonRecordedInTheAuditLog: "감사 로그에 기록할 사유",
    cannotUseAllLanguagesWhileThe:
      "TeX Live 언어 카탈로그를 사용할 수 없을 때는 --all-languages를 사용할 수 없습니다",
    updateTheSelfHostedLatexRenderer:
      "변경 불가능한 GitHub Releases에서 자체 호스팅 latex-renderer 앱 업데이트",
    configureBothCloudflareAccessServiceToken:
      "Cloudflare Access 서비스 토큰 필드는 둘 다 설정하고 Standalone에서는 둘 다 비워 두세요",
  }),
  es: () => ({
    showOrPreviewBackupRetention:
      "Mostrar o previsualizar la retención de copias locales",
    confirmBackupRetention: "Confirmar los límites y depurar las copias ahora",
    backupRetentionMaxAge: "antigüedad máxima de la copia en días",
    backupRetentionMaxGenerations: "número máximo de generaciones de copias",
    backupRetentionMaxBytes: "tamaño total máximo de las copias en bytes",
    backupRetentionLimitsRequired:
      "Indica los tres límites como enteros. Los días y las generaciones deben ser positivos. Los bytes pueden ser cero.",
    backupRetentionSavedPruneFailed:
      "Se guardó la política de retención. La depuración falló.",
    modeMustBeNotifyOrAutomatic:
      "Valores permitidos para mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Especifique exactamente una opción: --language, --all-languages o --clear-languages.",
    texEnvironmentOperationFailed: "Entorno TeX: la operación ha fallado.",
    applicationUpdateFailed:
      "Actualización de la aplicación: la operación ha fallado.",
    adminCredentialStored: "Credencial de administración: se ha guardado.",
    adminCredentialMissing: "Credencial de administración: no se encuentra.",
    dpapiStorageFailed: "Almacenamiento DPAPI: la operación ha fallado.",
    adminCredentialMustBeARegular:
      "Credencial de administración: se requiere un archivo normal del usuario actual con permisos 0600.",
    passwordOrExternal: "password o external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www o sha256:...",
    inputIsNotAnAdminApi:
      "La entrada no corresponde a una clave de la API de administración.",
    credentialInputExceedsTheSizeLimit:
      "Entrada de credenciales: se supera el límite.",
    externalProviderSubject: "sujeto del proveedor externo",
    passwordLoginName: "nombre de acceso con contraseña",
    texEnvironmentReconnectingToAdminApi:
      "Entorno TeX: Reconectando con la Admin API…",
    readTheInitialPasswordFromStandard:
      "leer la contraseña inicial de la entrada estándar, nunca de argv",
    choosePasswordWithLoginNameAnd:
      "Elija password con --login-name y --password-stdin, o external con --subject",
    manageTheTexLiveBaseImage:
      "gestionar la imagen base de TeX Live y las colecciones de idiomas",
    filterTheSharedLanguageCatalogWithout:
      "filtrar el catálogo compartido de idiomas conservando el orden del servidor",
    selectEveryLanguageCollectionReturnedBy:
      "seleccionar todas las colecciones de idiomas devueltas por la API común",
    selectZeroOptionalLanguageCollections:
      "no seleccionar ninguna colección de idiomas opcional",
    rebuildAnUnavailableDatedImageLocally:
      "reconstruir localmente una imagen fechada no disponible",
    reasonRecordedInTheAuditLog:
      "motivo que se registra en el registro de auditoría",
    cannotUseAllLanguagesWhileThe:
      "No se puede usar --all-languages si el catálogo de idiomas de TeX Live no está disponible",
    updateTheSelfHostedLatexRenderer:
      "actualizar la aplicación autoalojada latex-renderer desde versiones inmutables de GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Configure los dos campos del token de servicio Cloudflare Access, o ninguno en Standalone",
  }),
  pt: () => ({
    showOrPreviewBackupRetention:
      "Mostrar ou pré-visualizar a retenção de cópias locais",
    confirmBackupRetention: "Confirmar os limites e limpar as cópias agora",
    backupRetentionMaxAge: "idade máxima da cópia em dias",
    backupRetentionMaxGenerations: "número máximo de gerações de cópias",
    backupRetentionMaxBytes: "tamanho total máximo das cópias em bytes",
    backupRetentionLimitsRequired:
      "Indique os três limites como números inteiros. Os dias e as gerações devem ser positivos. Os bytes podem ser zero.",
    backupRetentionSavedPruneFailed:
      "A política de retenção foi guardada. A limpeza falhou.",
    modeMustBeNotifyOrAutomatic:
      "Valores permitidos para mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Indique exatamente uma opção: --language, --all-languages ou --clear-languages.",
    texEnvironmentOperationFailed: "Ambiente TeX: a operação falhou.",
    applicationUpdateFailed: "Atualização da aplicação: a operação falhou.",
    adminCredentialStored: "Credencial de administração: guardado com êxito.",
    adminCredentialMissing: "Credencial de administração: não encontrado.",
    dpapiStorageFailed: "Armazenamento DPAPI: a operação falhou.",
    adminCredentialMustBeARegular:
      "Credencial de administração: é necessário um ficheiro normal do utilizador atual com permissões 0600.",
    passwordOrExternal: "password ou external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www ou sha256:...",
    inputIsNotAnAdminApi:
      "A entrada não corresponde a uma chave da API de gestão.",
    credentialInputExceedsTheSizeLimit:
      "Entrada de credenciais: o limite foi ultrapassado.",
    externalProviderSubject: "sujeito do provedor externo",
    passwordLoginName: "nome de login com senha",
    texEnvironmentReconnectingToAdminApi:
      "Ambiente TeX: A restabelecer a ligação à Admin API…",
    readTheInitialPasswordFromStandard:
      "ler a senha inicial da entrada padrão, nunca de argv",
    choosePasswordWithLoginNameAnd:
      "Escolha password com --login-name e --password-stdin, ou external com --subject",
    manageTheTexLiveBaseImage:
      "gerenciar a imagem base do TeX Live e as coleções de idiomas",
    filterTheSharedLanguageCatalogWithout:
      "filtrar o catálogo compartilhado de idiomas mantendo a ordem do servidor",
    selectEveryLanguageCollectionReturnedBy:
      "selecionar todas as coleções de idiomas retornadas pela API comum",
    selectZeroOptionalLanguageCollections:
      "não selecionar nenhuma coleção opcional de idiomas",
    rebuildAnUnavailableDatedImageLocally:
      "recompilar localmente uma imagem datada indisponível",
    reasonRecordedInTheAuditLog: "motivo registrado no log de auditoria",
    cannotUseAllLanguagesWhileThe:
      "Não é possível usar --all-languages quando o catálogo de idiomas do TeX Live está indisponível",
    updateTheSelfHostedLatexRenderer:
      "atualizar o aplicativo auto-hospedado latex-renderer a partir de versões imutáveis no GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Configure ambos os campos do token de serviço Cloudflare Access, ou nenhum no modo Standalone",
  }),
  fr: () => ({
    showOrPreviewBackupRetention:
      "Afficher ou prévisualiser la rétention des sauvegardes locales",
    confirmBackupRetention:
      "Confirmer les limites et purger les sauvegardes maintenant",
    backupRetentionMaxAge: "âge maximal de la sauvegarde en jours",
    backupRetentionMaxGenerations:
      "nombre maximal de générations de sauvegardes",
    backupRetentionMaxBytes: "taille totale maximale des sauvegardes en octets",
    backupRetentionLimitsRequired:
      "Indiquez les trois limites en nombres entiers. Les jours et les générations doivent être positifs. Les octets peuvent valoir zéro.",
    backupRetentionSavedPruneFailed:
      "La politique de rétention a été enregistrée. La purge a échoué.",
    modeMustBeNotifyOrAutomatic:
      "Valeurs autorisées pour mode : notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Indiquez exactement une option parmi --language, --all-languages et --clear-languages.",
    texEnvironmentOperationFailed: "Environnement TeX : échec de l’opération.",
    applicationUpdateFailed:
      "Mise à jour de l’application : échec de l’opération.",
    adminCredentialStored:
      "Identifiant d’administration : enregistrement effectué.",
    adminCredentialMissing: "Identifiant d’administration : introuvable.",
    dpapiStorageFailed: "Stockage DPAPI : échec de l’opération.",
    adminCredentialMustBeARegular:
      "Identifiant d’administration : fichier ordinaire appartenant à l’utilisateur actuel, avec les permissions 0600 requises.",
    passwordOrExternal: "password ou external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www ou sha256:...",
    inputIsNotAnAdminApi:
      "La valeur saisie ne correspond pas à une clé d’API d’administration.",
    credentialInputExceedsTheSizeLimit:
      "Identifiants saisis : limite dépassée.",
    externalProviderSubject: "sujet du fournisseur externe",
    passwordLoginName: "nom de connexion par mot de passe",
    texEnvironmentReconnectingToAdminApi:
      "Environnement TeX : Reconnexion à l’API d’administration…",
    readTheInitialPasswordFromStandard:
      "lire le mot de passe initial sur l’entrée standard, jamais dans argv",
    choosePasswordWithLoginNameAnd:
      "Choisissez password avec --login-name et --password-stdin, ou external avec --subject",
    manageTheTexLiveBaseImage:
      "gérer l’image de base TeX Live et les collections linguistiques",
    filterTheSharedLanguageCatalogWithout:
      "filtrer le catalogue partagé des langues en conservant l’ordre fourni par le serveur",
    selectEveryLanguageCollectionReturnedBy:
      "sélectionner toutes les collections linguistiques renvoyées par l’API commune",
    selectZeroOptionalLanguageCollections:
      "ne sélectionner aucune collection linguistique facultative",
    rebuildAnUnavailableDatedImageLocally:
      "reconstruire localement une image datée indisponible",
    reasonRecordedInTheAuditLog: "motif consigné dans le journal d’audit",
    cannotUseAllLanguagesWhileThe:
      "--all-languages est indisponible tant que le catalogue linguistique TeX Live est inaccessible",
    updateTheSelfHostedLatexRenderer:
      "mettre à jour l’application auto-hébergée latex-renderer depuis les versions immuables de GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Renseignez les deux champs du jeton de service Cloudflare Access, ou aucun en mode Standalone",
  }),
  de: () => ({
    showOrPreviewBackupRetention:
      "Lokale Backup-Aufbewahrung anzeigen oder prüfen",
    confirmBackupRetention:
      "Aufbewahrungsgrenzen bestätigen und Backups sofort bereinigen",
    backupRetentionMaxAge: "maximales Alter eines Backups in Tagen",
    backupRetentionMaxGenerations: "maximale Anzahl der Backup-Generationen",
    backupRetentionMaxBytes: "maximale Gesamtgröße der Backups in Byte",
    backupRetentionLimitsRequired:
      "Gib alle drei Grenzen als ganze Zahlen an. Tage und Generationen müssen positiv sein. Byte dürfen null sein.",
    backupRetentionSavedPruneFailed:
      "Aufbewahrungsrichtlinie gespeichert. Bereinigung fehlgeschlagen.",
    modeMustBeNotifyOrAutomatic: "Zulässige Werte für mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Wählen Sie genau eine Option: --language, --all-languages oder --clear-languages.",
    texEnvironmentOperationFailed: "TeX-Umgebung: Vorgang fehlgeschlagen.",
    applicationUpdateFailed: "Anwendungsupdate: Vorgang fehlgeschlagen.",
    adminCredentialStored: "Administrator-Zugangsdaten: gespeichert.",
    adminCredentialMissing: "Administrator-Zugangsdaten: fehlt.",
    dpapiStorageFailed: "DPAPI-Speicherung: Vorgang fehlgeschlagen.",
    adminCredentialMustBeARegular:
      "Administrator-Zugangsdaten: reguläre Datei im Besitz des aktuellen Benutzers mit Modus 0600 erforderlich.",
    passwordOrExternal: "password oder external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www oder sha256:...",
    inputIsNotAnAdminApi:
      "Eingabe entspricht nicht dem erwarteten Typ: Admin-API-Schlüssel.",
    credentialInputExceedsTheSizeLimit:
      "Eingegebene Zugangsdaten: Grenze überschritten.",
    externalProviderSubject: "Subjekt beim externen Anbieter",
    passwordLoginName: "Anmeldename für Passwortanmeldung",
    texEnvironmentReconnectingToAdminApi:
      "TeX-Umgebung: Verbindung zur Admin API wird wiederhergestellt…",
    readTheInitialPasswordFromStandard:
      "Startpasswort aus der Standardeingabe lesen, niemals aus argv",
    choosePasswordWithLoginNameAnd:
      "password mit --login-name und --password-stdin oder external mit --subject wählen",
    manageTheTexLiveBaseImage:
      "TeX-Live-Basisimage und Sprachsammlungen verwalten",
    filterTheSharedLanguageCatalogWithout:
      "gemeinsamen Sprachkatalog in der vom Server vorgegebenen Reihenfolge filtern",
    selectEveryLanguageCollectionReturnedBy:
      "alle von der gemeinsamen API gelieferten Sprachsammlungen auswählen",
    selectZeroOptionalLanguageCollections:
      "keine optionalen Sprachsammlungen auswählen",
    rebuildAnUnavailableDatedImageLocally:
      "nicht verfügbares datiertes Image lokal neu erstellen",
    reasonRecordedInTheAuditLog: "im Auditprotokoll erfasster Grund",
    cannotUseAllLanguagesWhileThe:
      "--all-languages kann ohne verfügbaren TeX-Live-Sprachkatalog nicht verwendet werden",
    updateTheSelfHostedLatexRenderer:
      "selbst gehostete Anwendung latex-renderer aus unveränderlichen GitHub Releases aktualisieren",
    configureBothCloudflareAccessServiceToken:
      "Beide Felder des Cloudflare-Access-Diensttokens ausfüllen, bei Standalone beide leer lassen",
  }),
  it: () => ({
    showOrPreviewBackupRetention:
      "Mostra o visualizza in anteprima la conservazione dei backup locali",
    confirmBackupRetention:
      "Conferma i limiti e rimuovi subito i backup in eccesso",
    backupRetentionMaxAge: "età massima del backup in giorni",
    backupRetentionMaxGenerations: "numero massimo di generazioni di backup",
    backupRetentionMaxBytes: "dimensione totale massima dei backup in byte",
    backupRetentionLimitsRequired:
      "Specifica tutti e tre i limiti come interi. Giorni e generazioni devono essere positivi. I byte possono essere zero.",
    backupRetentionSavedPruneFailed:
      "Politica di conservazione salvata. Rimozione non riuscita.",
    modeMustBeNotifyOrAutomatic: "Valori ammessi per mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Specificare una sola opzione: --language, --all-languages o --clear-languages.",
    texEnvironmentOperationFailed: "Ambiente TeX: operazione non riuscita.",
    applicationUpdateFailed:
      "Aggiornamento dell’applicazione: operazione non riuscita.",
    adminCredentialStored:
      "Credenziale di amministrazione: salvataggio completato.",
    adminCredentialMissing: "Credenziale di amministrazione: non trovato.",
    dpapiStorageFailed: "Archiviazione DPAPI: operazione non riuscita.",
    adminCredentialMustBeARegular:
      "Credenziale di amministrazione: è richiesto un file normale di proprietà dell’utente corrente con permessi 0600.",
    passwordOrExternal: "password o external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www o sha256:...",
    inputIsNotAnAdminApi:
      "Il valore inserito non corrisponde a una chiave API amministrativa.",
    credentialInputExceedsTheSizeLimit: "Credenziali immesse: limite superato.",
    externalProviderSubject: "soggetto presso il provider esterno",
    passwordLoginName: "nome di accesso con password",
    texEnvironmentReconnectingToAdminApi:
      "Ambiente TeX: Riconnessione all’Admin API…",
    readTheInitialPasswordFromStandard:
      "leggere la password iniziale dallo standard input, mai da argv",
    choosePasswordWithLoginNameAnd:
      "Scegliere password con --login-name e --password-stdin oppure external con --subject",
    manageTheTexLiveBaseImage:
      "gestire l’immagine base TeX Live e le raccolte linguistiche",
    filterTheSharedLanguageCatalogWithout:
      "filtrare il catalogo condiviso delle lingue mantenendo l’ordine fornito dal server",
    selectEveryLanguageCollectionReturnedBy:
      "selezionare tutte le raccolte linguistiche restituite dall’API comune",
    selectZeroOptionalLanguageCollections:
      "non selezionare raccolte linguistiche facoltative",
    rebuildAnUnavailableDatedImageLocally:
      "ricostruire localmente un’immagine con data non disponibile",
    reasonRecordedInTheAuditLog: "motivo registrato nel log di audit",
    cannotUseAllLanguagesWhileThe:
      "Impossibile usare --all-languages se il catalogo linguistico TeX Live non è disponibile",
    updateTheSelfHostedLatexRenderer:
      "aggiornare l’applicazione autogestita latex-renderer dalle versioni immutabili di GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Configurare entrambi i campi del token di servizio Cloudflare Access, o nessuno per Standalone",
  }),
  ru: () => ({
    showOrPreviewBackupRetention:
      "Показать или предварительно проверить хранение локальных резервных копий",
    confirmBackupRetention:
      "Подтвердить ограничения и сразу очистить резервные копии",
    backupRetentionMaxAge: "максимальный возраст копии в днях",
    backupRetentionMaxGenerations:
      "максимальное число поколений резервных копий",
    backupRetentionMaxBytes: "максимальный общий размер копий в байтах",
    backupRetentionLimitsRequired:
      "Укажите все три ограничения целыми числами. Дни и поколения должны быть положительными. Число байтов может быть нулём.",
    backupRetentionSavedPruneFailed:
      "Политика хранения сохранена. Не удалось очистить резервные копии.",
    modeMustBeNotifyOrAutomatic:
      "Допустимые значения для mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Укажите ровно один вариант: --language, --all-languages или --clear-languages.",
    texEnvironmentOperationFailed: "Среда TeX: операция не выполнена.",
    applicationUpdateFailed: "Обновление приложения: операция не выполнена.",
    adminCredentialStored: "Учётные данные администратора: сохранено.",
    adminCredentialMissing: "Учётные данные администратора: не найдено.",
    dpapiStorageFailed: "Сохранение через DPAPI: операция не выполнена.",
    adminCredentialMustBeARegular:
      "Учётные данные администратора: требуется обычный файл текущего пользователя с правами 0600.",
    passwordOrExternal: "password или external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www или sha256:...",
    inputIsNotAnAdminApi: "Введено не то значение. Ожидается: ключ Admin API.",
    credentialInputExceedsTheSizeLimit:
      "Введённые учётные данные: превышено ограничение.",
    externalProviderSubject: "субъект у внешнего провайдера",
    passwordLoginName: "имя для входа по паролю",
    texEnvironmentReconnectingToAdminApi:
      "Среда TeX: Повторное подключение к Admin API…",
    readTheInitialPasswordFromStandard:
      "читать начальный пароль из стандартного ввода, никогда не из argv",
    choosePasswordWithLoginNameAnd:
      "Выберите password с --login-name и --password-stdin или external с --subject",
    manageTheTexLiveBaseImage:
      "управлять базовым образом TeX Live и языковыми коллекциями",
    filterTheSharedLanguageCatalogWithout:
      "фильтровать общий каталог языков, сохраняя порядок сервера",
    selectEveryLanguageCollectionReturnedBy:
      "выбрать все языковые коллекции, возвращённые общим API",
    selectZeroOptionalLanguageCollections:
      "не выбирать ни одной дополнительной языковой коллекции",
    rebuildAnUnavailableDatedImageLocally:
      "локально пересобрать недоступный образ за указанную дату",
    reasonRecordedInTheAuditLog: "причина, записываемая в журнал аудита",
    cannotUseAllLanguagesWhileThe:
      "--all-languages нельзя использовать, пока каталог языков TeX Live недоступен",
    updateTheSelfHostedLatexRenderer:
      "обновить самостоятельно размещённое приложение latex-renderer из неизменяемых выпусков GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Настройте оба поля служебного токена Cloudflare Access или оставьте оба пустыми для Standalone",
  }),
  tr: () => ({
    showOrPreviewBackupRetention:
      "Yerel yedek saklama ayarlarını göster veya önizle",
    confirmBackupRetention: "Yedek saklama sınırlarını onayla ve hemen temizle",
    backupRetentionMaxAge: "yedeklerin gün cinsinden azami yaşı",
    backupRetentionMaxGenerations: "azami yedek nesli sayısı",
    backupRetentionMaxBytes: "bayt cinsinden azami toplam yedek boyutu",
    backupRetentionLimitsRequired:
      "Üç sınırı da tam sayı olarak belirtin. Gün ve nesil sayısı pozitif olmalıdır. Bayt sayısı sıfır olabilir.",
    backupRetentionSavedPruneFailed:
      "Saklama politikası kaydedildi. Yedekler temizlenemedi.",
    modeMustBeNotifyOrAutomatic:
      "mode için izin verilen değerler: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Tam birini seçin: --language, --all-languages veya --clear-languages.",
    texEnvironmentOperationFailed: "TeX ortamı: işlem başarısız oldu.",
    applicationUpdateFailed: "Uygulama güncellemesi: işlem başarısız oldu.",
    adminCredentialStored: "Yönetici kimlik bilgisi: kaydedildi.",
    adminCredentialMissing: "Yönetici kimlik bilgisi: bulunamadı.",
    dpapiStorageFailed: "DPAPI ile saklama: işlem başarısız oldu.",
    adminCredentialMustBeARegular:
      "Yönetici kimlik bilgisi: geçerli kullanıcının sahip olduğu, 0600 izinli normal dosya gerekli.",
    passwordOrExternal: "password veya external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www veya sha256:...",
    inputIsNotAnAdminApi: "Girdi beklenen türde değil: yönetim API anahtarı.",
    credentialInputExceedsTheSizeLimit:
      "Girilen kimlik bilgileri: sınır aşıldı.",
    externalProviderSubject: "harici sağlayıcıdaki özne",
    passwordLoginName: "parolayla oturum açma adı",
    texEnvironmentReconnectingToAdminApi:
      "TeX ortamı: Admin API’ye yeniden bağlanılıyor…",
    readTheInitialPasswordFromStandard:
      "ilk parolayı standart girdiden oku, asla argv kullanma",
    choosePasswordWithLoginNameAnd:
      "password için --login-name ve --password-stdin, external için --subject seçin",
    manageTheTexLiveBaseImage:
      "TeX Live temel imajını ve dil koleksiyonlarını yönet",
    filterTheSharedLanguageCatalogWithout:
      "ortak dil kataloğunu sunucunun sıralamasını koruyarak filtrele",
    selectEveryLanguageCollectionReturnedBy:
      "ortak API’nin döndürdüğü tüm dil koleksiyonlarını seç",
    selectZeroOptionalLanguageCollections:
      "isteğe bağlı dil koleksiyonlarından hiçbirini seçme",
    rebuildAnUnavailableDatedImageLocally:
      "kullanılamayan tarihli imajı yerelde yeniden oluştur",
    reasonRecordedInTheAuditLog: "denetim günlüğüne kaydedilen neden",
    cannotUseAllLanguagesWhileThe:
      "TeX Live dil kataloğu kullanılamıyorken --all-languages kullanılamaz",
    updateTheSelfHostedLatexRenderer:
      "kendi sunucunuzdaki latex-renderer uygulamasını değişmez GitHub Releases sürümlerinden güncelle",
    configureBothCloudflareAccessServiceToken:
      "Cloudflare Access hizmet belirteci alanlarının ikisini de yapılandırın; Standalone için ikisini de boş bırakın",
  }),
  pl: () => ({
    showOrPreviewBackupRetention:
      "Pokaż ustawienia lub podgląd przechowywania lokalnych kopii zapasowych",
    confirmBackupRetention: "Potwierdź limity i usuń teraz nadmiarowe kopie",
    backupRetentionMaxAge: "maksymalny wiek kopii w dniach",
    backupRetentionMaxGenerations:
      "maksymalna liczba generacji kopii zapasowych",
    backupRetentionMaxBytes: "maksymalny łączny rozmiar kopii w bajtach",
    backupRetentionLimitsRequired:
      "Podaj wszystkie trzy limity jako liczby całkowite. Dni i generacje muszą być dodatnie. Liczba bajtów może wynosić zero.",
    backupRetentionSavedPruneFailed:
      "Zapisano zasady przechowywania. Usuwanie kopii nie powiodło się.",
    modeMustBeNotifyOrAutomatic:
      "Dozwolone wartości dla mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Wybierz dokładnie jedną opcję: --language, --all-languages lub --clear-languages.",
    texEnvironmentOperationFailed: "Środowisko TeX: operacja nie powiodła się.",
    applicationUpdateFailed:
      "Aktualizacja aplikacji: operacja nie powiodła się.",
    adminCredentialStored: "Dane uwierzytelniające administratora: zapisano.",
    adminCredentialMissing:
      "Dane uwierzytelniające administratora: nie znaleziono.",
    dpapiStorageFailed: "Zapis przez DPAPI: operacja nie powiodła się.",
    adminCredentialMustBeARegular:
      "Dane uwierzytelniające administratora: wymagany zwykły plik bieżącego użytkownika z uprawnieniami 0600.",
    passwordOrExternal: "password lub external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www lub sha256:...",
    inputIsNotAnAdminApi:
      "Wartość wejściowa nie odpowiada typowi: klucz administracyjnego API.",
    credentialInputExceedsTheSizeLimit:
      "Wprowadzone dane uwierzytelniające: przekroczono limit.",
    externalProviderSubject: "podmiot u zewnętrznego dostawcy",
    passwordLoginName: "nazwa logowania hasłem",
    texEnvironmentReconnectingToAdminApi:
      "Środowisko TeX: Ponowne łączenie z Admin API…",
    readTheInitialPasswordFromStandard:
      "odczytaj początkowe hasło ze standardowego wejścia, nigdy z argv",
    choosePasswordWithLoginNameAnd:
      "Wybierz password z --login-name i --password-stdin lub external z --subject",
    manageTheTexLiveBaseImage:
      "zarządzaj obrazem bazowym TeX Live i kolekcjami językowymi",
    filterTheSharedLanguageCatalogWithout:
      "filtruj wspólny katalog języków, zachowując kolejność serwera",
    selectEveryLanguageCollectionReturnedBy:
      "wybierz wszystkie kolekcje językowe zwrócone przez wspólne API",
    selectZeroOptionalLanguageCollections:
      "nie wybieraj żadnej opcjonalnej kolekcji językowej",
    rebuildAnUnavailableDatedImageLocally:
      "przebuduj lokalnie niedostępny obraz oznaczony datą",
    reasonRecordedInTheAuditLog: "powód zapisywany w dzienniku audytu",
    cannotUseAllLanguagesWhileThe:
      "Nie można użyć --all-languages, gdy katalog języków TeX Live jest niedostępny",
    updateTheSelfHostedLatexRenderer:
      "aktualizuj samodzielnie hostowaną aplikację latex-renderer z niezmiennych wydań GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Ustaw oba pola tokenu usługi Cloudflare Access lub pozostaw oba puste dla Standalone",
  }),
  cs: () => ({
    showOrPreviewBackupRetention:
      "Zobrazit nastavení nebo náhled uchovávání místních záloh",
    confirmBackupRetention:
      "Potvrdit limity a ihned odstranit nadbytečné zálohy",
    backupRetentionMaxAge: "maximální stáří zálohy ve dnech",
    backupRetentionMaxGenerations: "maximální počet generací záloh",
    backupRetentionMaxBytes: "maximální celková velikost záloh v bajtech",
    backupRetentionLimitsRequired:
      "Zadejte všechny tři limity jako celá čísla. Počet dnů a generací musí být kladný. Počet bajtů může být nula.",
    backupRetentionSavedPruneFailed:
      "Pravidla uchovávání byla uložena. Odstranění záloh se nezdařilo.",
    modeMustBeNotifyOrAutomatic: "Povolené hodnoty pro mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Zadejte právě jednu možnost: --language, --all-languages nebo --clear-languages.",
    texEnvironmentOperationFailed: "Prostředí TeXu: operace se nezdařila.",
    applicationUpdateFailed: "Aktualizace aplikace: operace se nezdařila.",
    adminCredentialStored: "Přihlašovací údaj správce: uloženo.",
    adminCredentialMissing: "Přihlašovací údaj správce: nenalezeno.",
    dpapiStorageFailed: "Uložení přes DPAPI: operace se nezdařila.",
    adminCredentialMustBeARegular:
      "Přihlašovací údaj správce: musí jít o běžný soubor aktuálního uživatele s oprávněními 0600.",
    passwordOrExternal: "password nebo external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www nebo sha256:...",
    inputIsNotAnAdminApi:
      "Zadaná hodnota neodpovídá typu: klíč rozhraní Admin API.",
    credentialInputExceedsTheSizeLimit:
      "Zadané přihlašovací údaje: překročen limit.",
    externalProviderSubject: "subjekt u externího poskytovatele",
    passwordLoginName: "přihlašovací jméno pro heslo",
    texEnvironmentReconnectingToAdminApi:
      "Prostředí TeXu: Obnovování připojení k Admin API…",
    readTheInitialPasswordFromStandard:
      "načíst počáteční heslo ze standardního vstupu, nikdy z argv",
    choosePasswordWithLoginNameAnd:
      "Zvolte password s --login-name a --password-stdin nebo external s --subject",
    manageTheTexLiveBaseImage:
      "spravovat základní obraz TeX Live a jazykové kolekce",
    filterTheSharedLanguageCatalogWithout:
      "filtrovat společný katalog jazyků se zachováním pořadí ze serveru",
    selectEveryLanguageCollectionReturnedBy:
      "vybrat všechny jazykové kolekce vrácené společným API",
    selectZeroOptionalLanguageCollections:
      "nevybrat žádnou volitelnou jazykovou kolekci",
    rebuildAnUnavailableDatedImageLocally:
      "místně znovu sestavit nedostupný datovaný obraz",
    reasonRecordedInTheAuditLog: "důvod zaznamenaný do auditního protokolu",
    cannotUseAllLanguagesWhileThe:
      "Pokud není dostupný jazykový katalog TeX Live, nelze použít --all-languages",
    updateTheSelfHostedLatexRenderer:
      "aktualizovat samostatně hostovanou aplikaci latex-renderer z neměnných vydání GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Vyplňte obě pole servisního tokenu Cloudflare Access, pro Standalone nechte obě prázdná",
  }),
  nl: () => ({
    showOrPreviewBackupRetention:
      "Bewaarbeleid voor lokale back-ups bekijken of vooraf toetsen",
    confirmBackupRetention:
      "Bewaarlimieten bevestigen en back-ups direct opschonen",
    backupRetentionMaxAge: "maximale leeftijd van een back-up in dagen",
    backupRetentionMaxGenerations: "maximaal aantal back-upgeneraties",
    backupRetentionMaxBytes: "maximale totale grootte van back-ups in bytes",
    backupRetentionLimitsRequired:
      "Geef alle drie de limieten op als gehele getallen. Dagen en generaties moeten positief zijn. Bytes mogen nul zijn.",
    backupRetentionSavedPruneFailed:
      "Bewaarbeleid opgeslagen. Opschonen van back-ups mislukt.",
    modeMustBeNotifyOrAutomatic:
      "Toegestane waarden voor mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Geef precies één optie op: --language, --all-languages of --clear-languages.",
    texEnvironmentOperationFailed: "TeX-omgeving: bewerking mislukt.",
    applicationUpdateFailed: "Applicatie-update: bewerking mislukt.",
    adminCredentialStored: "Beheerdersreferenties: opgeslagen.",
    adminCredentialMissing: "Beheerdersreferenties: ontbreekt.",
    dpapiStorageFailed: "DPAPI-opslag: bewerking mislukt.",
    adminCredentialMustBeARegular:
      "Beheerdersreferenties: regulier bestand van de huidige gebruiker met modus 0600 vereist.",
    passwordOrExternal: "password of external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www of sha256:...",
    inputIsNotAnAdminApi:
      "De invoer is niet van het verwachte type: beheer-API-sleutel.",
    credentialInputExceedsTheSizeLimit:
      "Ingevoerde inloggegevens: limiet overschreden.",
    externalProviderSubject: "subject bij de externe provider",
    passwordLoginName: "aanmeldnaam voor wachtwoordaanmelding",
    texEnvironmentReconnectingToAdminApi:
      "TeX-omgeving: Opnieuw verbinden met de Admin API…",
    readTheInitialPasswordFromStandard:
      "het eerste wachtwoord uit standaardinvoer lezen, nooit uit argv",
    choosePasswordWithLoginNameAnd:
      "Kies password met --login-name en --password-stdin of external met --subject",
    manageTheTexLiveBaseImage:
      "de TeX Live-basisimage en taalcollecties beheren",
    filterTheSharedLanguageCatalogWithout:
      "de gedeelde taalcatalogus filteren met behoud van de servervolgorde",
    selectEveryLanguageCollectionReturnedBy:
      "alle door de gemeenschappelijke API geretourneerde taalcollecties selecteren",
    selectZeroOptionalLanguageCollections:
      "geen optionele taalcollectie selecteren",
    rebuildAnUnavailableDatedImageLocally:
      "een niet-beschikbare gedateerde image lokaal opnieuw bouwen",
    reasonRecordedInTheAuditLog: "reden voor het auditlogboek",
    cannotUseAllLanguagesWhileThe:
      "--all-languages is niet beschikbaar zolang de TeX Live-taalcatalogus ontbreekt",
    updateTheSelfHostedLatexRenderer:
      "de zelfgehoste toepassing latex-renderer bijwerken vanuit onveranderlijke GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Stel beide velden van het Cloudflare Access-servicetoken in, of geen van beide voor Standalone",
  }),
  sv: () => ({
    showOrPreviewBackupRetention:
      "Visa eller förhandsgranska lagring av lokala säkerhetskopior",
    confirmBackupRetention:
      "Bekräfta lagringsgränserna och rensa säkerhetskopior nu",
    backupRetentionMaxAge: "maximal ålder för en säkerhetskopia i dagar",
    backupRetentionMaxGenerations:
      "maximalt antal generationer av säkerhetskopior",
    backupRetentionMaxBytes:
      "maximal sammanlagd storlek på säkerhetskopior i byte",
    backupRetentionLimitsRequired:
      "Ange alla tre gränser som heltal. Dagar och generationer måste vara positiva. Antalet byte får vara noll.",
    backupRetentionSavedPruneFailed:
      "Lagringspolicyn sparades. Rensningen misslyckades.",
    modeMustBeNotifyOrAutomatic: "Tillåtna värden för mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Ange exakt ett alternativ: --language, --all-languages eller --clear-languages.",
    texEnvironmentOperationFailed: "TeX-miljö: åtgärden misslyckades.",
    applicationUpdateFailed: "Programuppdatering: åtgärden misslyckades.",
    adminCredentialStored: "Administratörens inloggningsuppgift: sparat.",
    adminCredentialMissing: "Administratörens inloggningsuppgift: saknas.",
    dpapiStorageFailed: "DPAPI-lagring: åtgärden misslyckades.",
    adminCredentialMustBeARegular:
      "Administratörens inloggningsuppgift: måste vara en vanlig fil som ägs av aktuell användare med läget 0600.",
    passwordOrExternal: "password eller external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www eller sha256:...",
    inputIsNotAnAdminApi:
      "Indata har inte förväntad typ: API-nyckel för administration.",
    credentialInputExceedsTheSizeLimit:
      "Angivna inloggningsuppgifter: gränsen har överskridits.",
    externalProviderSubject: "subjekt hos extern leverantör",
    passwordLoginName: "inloggningsnamn för lösenord",
    texEnvironmentReconnectingToAdminApi:
      "TeX-miljö: Återansluter till Admin API…",
    readTheInitialPasswordFromStandard:
      "läs det första lösenordet från standardindata, aldrig från argv",
    choosePasswordWithLoginNameAnd:
      "Välj password med --login-name och --password-stdin eller external med --subject",
    manageTheTexLiveBaseImage:
      "hantera basavbildningen för TeX Live och språksamlingarna",
    filterTheSharedLanguageCatalogWithout:
      "filtrera den gemensamma språkkatalogen och behåll serverns ordning",
    selectEveryLanguageCollectionReturnedBy:
      "välj alla språksamlingar från det gemensamma API:et",
    selectZeroOptionalLanguageCollections: "välj inga valfria språksamlingar",
    rebuildAnUnavailableDatedImageLocally:
      "bygg om en otillgänglig daterad avbildning lokalt",
    reasonRecordedInTheAuditLog: "orsak som sparas i granskningsloggen",
    cannotUseAllLanguagesWhileThe:
      "--all-languages kan inte användas när TeX Lives språkkatalog är otillgänglig",
    updateTheSelfHostedLatexRenderer:
      "uppdatera den egenhostade applikationen latex-renderer från oföränderliga GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Ange båda fälten för Cloudflare Access-tjänsttoken eller inget av dem för Standalone",
  }),
  no: () => ({
    showOrPreviewBackupRetention:
      "Vis eller forhåndsvis oppbevaring av lokale sikkerhetskopier",
    confirmBackupRetention:
      "Bekreft grensene og rydd opp i sikkerhetskopiene nå",
    backupRetentionMaxAge: "maksimal alder på en sikkerhetskopi i dager",
    backupRetentionMaxGenerations:
      "maksimalt antall generasjoner av sikkerhetskopier",
    backupRetentionMaxBytes:
      "maksimal samlet størrelse på sikkerhetskopiene i byte",
    backupRetentionLimitsRequired:
      "Oppgi alle tre grensene som heltall. Dager og generasjoner må være positive. Antall byte kan være null.",
    backupRetentionSavedPruneFailed:
      "Oppbevaringspolicyen ble lagret. Oppryddingen mislyktes.",
    modeMustBeNotifyOrAutomatic: "Tillatte verdier for mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Angi nøyaktig ett alternativ: --language, --all-languages eller --clear-languages.",
    texEnvironmentOperationFailed: "TeX-miljø: operasjonen mislyktes.",
    applicationUpdateFailed: "Programoppdatering: operasjonen mislyktes.",
    adminCredentialStored: "Administratorens påloggingsinformasjon: lagret.",
    adminCredentialMissing: "Administratorens påloggingsinformasjon: mangler.",
    dpapiStorageFailed: "DPAPI-lagring: operasjonen mislyktes.",
    adminCredentialMustBeARegular:
      "Administratorens påloggingsinformasjon: må være en vanlig fil eid av gjeldende bruker med modus 0600.",
    passwordOrExternal: "password eller external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www eller sha256:...",
    inputIsNotAnAdminApi:
      "Inndataene har ikke forventet type: API-nøkkel for administrasjon.",
    credentialInputExceedsTheSizeLimit:
      "Oppgitt påloggingsinformasjon: grensen er overskredet.",
    externalProviderSubject: "subjekt hos ekstern leverandør",
    passwordLoginName: "påloggingsnavn for passord",
    texEnvironmentReconnectingToAdminApi:
      "TeX-miljø: Kobler til Admin API på nytt…",
    readTheInitialPasswordFromStandard:
      "les det første passordet fra standardinndata, aldri fra argv",
    choosePasswordWithLoginNameAnd:
      "Velg password med --login-name og --password-stdin eller external med --subject",
    manageTheTexLiveBaseImage:
      "administrer grunnavbildningen for TeX Live og språksamlingene",
    filterTheSharedLanguageCatalogWithout:
      "filtrer den delte språkkatalogen og behold serverens rekkefølge",
    selectEveryLanguageCollectionReturnedBy:
      "velg alle språksamlinger fra det felles API-et",
    selectZeroOptionalLanguageCollections:
      "ikke velg noen valgfrie språksamlinger",
    rebuildAnUnavailableDatedImageLocally:
      "bygg en utilgjengelig datert avbildning på nytt lokalt",
    reasonRecordedInTheAuditLog: "grunn som registreres i revisjonsloggen",
    cannotUseAllLanguagesWhileThe:
      "--all-languages kan ikke brukes når språkkatalogen for TeX Live er utilgjengelig",
    updateTheSelfHostedLatexRenderer:
      "oppdater den egenhostede latex-renderer-applikasjonen fra uforanderlige GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Angi begge feltene for Cloudflare Access-tjenestokenet, eller ingen for Standalone",
  }),
  da: () => ({
    showOrPreviewBackupRetention:
      "Vis eller gennemse opbevaring af lokale sikkerhedskopier",
    confirmBackupRetention:
      "Bekræft grænserne, og ryd op i sikkerhedskopierne nu",
    backupRetentionMaxAge: "maksimal alder på en sikkerhedskopi i dage",
    backupRetentionMaxGenerations:
      "maksimalt antal generationer af sikkerhedskopier",
    backupRetentionMaxBytes:
      "maksimal samlet størrelse på sikkerhedskopierne i byte",
    backupRetentionLimitsRequired:
      "Angiv alle tre grænser som hele tal. Dage og generationer skal være positive. Antallet af byte må være nul.",
    backupRetentionSavedPruneFailed:
      "Opbevaringspolitikken blev gemt. Oprydningen mislykkedes.",
    modeMustBeNotifyOrAutomatic: "Tilladte værdier for mode: notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Angiv præcis én mulighed: --language, --all-languages eller --clear-languages.",
    texEnvironmentOperationFailed: "TeX-miljø: handlingen mislykkedes.",
    applicationUpdateFailed: "Programopdatering: handlingen mislykkedes.",
    adminCredentialStored: "Administratorens legitimationsoplysning: gemt.",
    adminCredentialMissing: "Administratorens legitimationsoplysning: mangler.",
    dpapiStorageFailed: "DPAPI-lagring: handlingen mislykkedes.",
    adminCredentialMustBeARegular:
      "Administratorens legitimationsoplysning: skal være en almindelig fil ejet af den aktuelle bruger med tilstanden 0600.",
    passwordOrExternal: "password eller external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www eller sha256:...",
    inputIsNotAnAdminApi:
      "Input har ikke den forventede type: API-nøgle til administration.",
    credentialInputExceedsTheSizeLimit:
      "Indtastede legitimationsoplysninger: grænsen er overskredet.",
    externalProviderSubject: "subjekt hos ekstern udbyder",
    passwordLoginName: "loginnavn til adgangskode",
    texEnvironmentReconnectingToAdminApi:
      "TeX-miljø: Opretter forbindelse til Admin API igen…",
    readTheInitialPasswordFromStandard:
      "læs den første adgangskode fra standardinput, aldrig fra argv",
    choosePasswordWithLoginNameAnd:
      "Vælg password med --login-name og --password-stdin eller external med --subject",
    manageTheTexLiveBaseImage:
      "administrer TeX Live-grundimaget og sprogsamlingerne",
    filterTheSharedLanguageCatalogWithout:
      "filtrer det fælles sprogkatalog med serverens rækkefølge bevaret",
    selectEveryLanguageCollectionReturnedBy:
      "vælg alle sprogsamlinger fra det fælles API",
    selectZeroOptionalLanguageCollections: "vælg ingen valgfrie sprogsamlinger",
    rebuildAnUnavailableDatedImageLocally:
      "genopbyg et utilgængeligt dateret image lokalt",
    reasonRecordedInTheAuditLog: "årsag, der registreres i revisionsloggen",
    cannotUseAllLanguagesWhileThe:
      "--all-languages kan ikke bruges, når TeX Live-sprogkataloget er utilgængeligt",
    updateTheSelfHostedLatexRenderer:
      "opdater den selvhostede latex-renderer-applikation fra uforanderlige GitHub Releases",
    configureBothCloudflareAccessServiceToken:
      "Angiv begge felter til Cloudflare Access-tjenestokenet, eller ingen for Standalone",
  }),
  fi: () => ({
    showOrPreviewBackupRetention:
      "Näytä tai esikatsele paikallisten varmuuskopioiden säilytysasetuksia",
    confirmBackupRetention:
      "Vahvista rajat ja poista ylimääräiset varmuuskopiot heti",
    backupRetentionMaxAge: "varmuuskopion enimmäisikä päivinä",
    backupRetentionMaxGenerations: "varmuuskopiosukupolvien enimmäismäärä",
    backupRetentionMaxBytes: "varmuuskopioiden enimmäiskoko yhteensä tavuina",
    backupRetentionLimitsRequired:
      "Anna kaikki kolme rajaa kokonaislukuina. Päivien ja sukupolvien määrän on oltava positiivinen. Tavujen määrä voi olla nolla.",
    backupRetentionSavedPruneFailed:
      "Säilytyskäytäntö tallennettiin. Varmuuskopioiden poistaminen epäonnistui.",
    modeMustBeNotifyOrAutomatic: "Sallitut arvot (mode): notify, automatic",
    chooseExactlyOneOfLanguageAll:
      "Anna täsmälleen yksi vaihtoehdoista --language, --all-languages ja --clear-languages.",
    texEnvironmentOperationFailed: "TeX-ympäristö: toiminto epäonnistui.",
    applicationUpdateFailed: "Sovelluksen päivitys: toiminto epäonnistui.",
    adminCredentialStored: "Ylläpitäjän tunnistetieto: tallennettu.",
    adminCredentialMissing: "Ylläpitäjän tunnistetieto: puuttuu.",
    dpapiStorageFailed: "DPAPI-tallennus: toiminto epäonnistui.",
    adminCredentialMustBeARegular:
      "Ylläpitäjän tunnistetieto: vaaditaan nykyisen käyttäjän omistama tavallinen tiedosto, jonka oikeudet ovat 0600.",
    passwordOrExternal: "password tai external",
    latestYyyyMmDdWeeklyYyyy:
      "latest, YYYY-MM-DD, weekly:YYYY-Www tai sha256:...",
    inputIsNotAnAdminApi:
      "Syöte ei vastaa odotettua tyyppiä: hallinnan API-avain.",
    credentialInputExceedsTheSizeLimit:
      "Syötetyt tunnistetiedot: raja ylittyi.",
    externalProviderSubject: "ulkoisen palveluntarjoajan subjektitunniste",
    passwordLoginName: "salasanakirjautumisen käyttäjätunnus",
    texEnvironmentReconnectingToAdminApi:
      "TeX-ympäristö: Yhdistetään uudelleen Admin APIin…",
    readTheInitialPasswordFromStandard:
      "lue alkusalasana vakiosyötteestä, älä koskaan argv:stä",
    choosePasswordWithLoginNameAnd:
      "Valitse password ja anna --login-name sekä --password-stdin tai valitse external ja anna --subject",
    manageTheTexLiveBaseImage:
      "hallitse TeX Liven peruslevykuvaa ja kielikokoelmia",
    filterTheSharedLanguageCatalogWithout:
      "suodata yhteistä kieliluetteloa säilyttäen palvelimen järjestys",
    selectEveryLanguageCollectionReturnedBy:
      "valitse kaikki yhteisen rajapinnan palauttamat kielikokoelmat",
    selectZeroOptionalLanguageCollections:
      "älä valitse yhtään valinnaista kielikokoelmaa",
    rebuildAnUnavailableDatedImageLocally:
      "rakenna puuttuva päivätty levykuva paikallisesti uudelleen",
    reasonRecordedInTheAuditLog: "tarkastuslokiin kirjattava syy",
    cannotUseAllLanguagesWhileThe:
      "Valitsinta --all-languages ei voi käyttää, kun TeX Liven kieliluettelo ei ole saatavilla",
    updateTheSelfHostedLatexRenderer:
      "päivitä itse ylläpidetty latex-renderer-sovellus muuttumattomista GitHub Releases -julkaisuista",
    configureBothCloudflareAccessServiceToken:
      "Täytä Cloudflare Access -palvelutunnuksen molemmat kentät tai jätä molemmat tyhjiksi Standalone-tilassa",
  }),
};
const catalog = select[locale]?.() ?? english;

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
  "mode must be notify or automatic": "modeMustBeNotifyOrAutomatic",
  "Choose exactly one of --language, --all-languages, or --clear-languages":
    "chooseExactlyOneOfLanguageAll",
  "TeX environment operation failed": "texEnvironmentOperationFailed",
  "Application update failed": "applicationUpdateFailed",
  "Admin credential missing": "adminCredentialMissing",
  "DPAPI storage failed": "dpapiStorageFailed",
  "Admin credential must be a regular file owned by the current user with mode 0600":
    "adminCredentialMustBeARegular",
  "password or external": "passwordOrExternal",
  "latest, YYYY-MM-DD, weekly:YYYY-Www, or sha256:...":
    "latestYyyyMmDdWeeklyYyyy",
  "Input is not an admin API key": "inputIsNotAnAdminApi",
  "Credential input exceeds the size limit":
    "credentialInputExceedsTheSizeLimit",
  "Choose password with --login-name and --password-stdin, or external with --subject":
    "choosePasswordWithLoginNameAnd",
  "reason recorded in the audit log": "reasonRecordedInTheAuditLog",
  "Cannot use --all-languages while the TeX Live language catalog is unavailable":
    "cannotUseAllLanguagesWhileThe",
  "Configure both Cloudflare Access service-token fields, or neither for Standalone":
    "configureBothCloudflareAccessServiceToken",
};

export function humanDiagnostic(message: string): string {
  const key = Object.hasOwn(diagnostics, message)
    ? diagnostics[message]
    : undefined;
  return key === undefined ? message : humanText(key);
}
