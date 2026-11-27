# Admin CLIの認証とユーザー作成

端末で `n624-latex admin` を実行すると、管理操作のメニューが開きます。
認証情報の登録は `auth` から `login` を選びます。入力したキーは画面に表示されません。
自動化では既存のサブコマンドを利用できます。
[管理操作の対応表](admin-operation-compatibility.md)

`latex-render-admin` は管理用APIキーを使用します。Cloudflare Accessを使わない
Standalone環境ではAccess用の環境変数は不要です。Accessで保護する場合のみ
`CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` を両方設定してください。
片方だけの設定は送信前にエラーとし、APIキーとは別の資格情報として扱います。

ユーザー作成では `--authentication password` または `--authentication external` を
明示します。メールは任意で、既存のサーバー側認証方式・権限・招待条件を維持します。

```sh
latex-render-admin users create --display-name "Example" --role user \
  --authentication password --login-name example --password-stdin
```

パスワードは標準入力で渡します。引数・コマンド履歴・出力へ秘密を含めないでください。
CLIは入力サイズを制限し、末尾の改行1つだけを取り除きます。
パスワード自体の前後の空白は保持されます。

```sh
latex-render-admin users create --display-name "Example" --role user \
  --authentication external --subject PROVIDER_SUBJECT
```

外部ユーザーにはプロバイダーのsubjectを指定し、必要なら
`--preferred-username` と `--email-at-provider` を付けられます。
ログイン名だけで外部subjectを代用せず、認証トークンをsubjectへ渡さないでください。

HTTPS設定だけを適用する場合は、既存の保持期限、イメージ整理、秘密ファイルの参照、
ローテーション済み鍵ID、実行UID/GID、Docker接続先などを保持します。
新規導入の初期値を既存ホストへ再適用する処理とは分離しています。
公開用の設定レビューには、引き続き非公開の環境変数を含めません。
