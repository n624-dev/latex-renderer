# Application update recovery points

The independent Updater now separates two results: application deployment and
Updater activation. The authenticated `/updates/state` API reports the verified
running Updater identity and whether its activation is still pending. Operation
responses retain the existing `status` field (application result) and add
`expectedUpdater` and `outcome`. Only `outcome.complete=true` confirms both parts
for a new apply/rollback operation. A same-version but different slot/commit is
not accepted. A pending activation stops being treated as normal waiting after
10 minutes. Unreadable state, a failed cutover or mismatched payload is not success.

Older controllers did not record the expected slot. Their completed operations
are explicitly `legacy-unconfirmed`; this does not mean the application failed.
Past operations are `historical`, since the currently running controller cannot
prove a historical activation. Independently upgrading the Updater ahead of the
application is supported; the two version cards need not match.

## What a recovery point contains

New Updater helpers create a consistent point **before application deployment**,
after the normal build and standard backup gates. They stop previously active
mutation timers and application writers, refuse to interrupt active backup,
cleanup or audit-export jobs, and keep writers quiesced until deployment returns.
Only originally active units are restored by the recovery wrapper, including on
failure. The existing deployment's service-enablement policy is unchanged.

Each point includes an SQLite `VACUUM INTO` snapshot, all regular files and empty
directories below application storage, and the prior release version/commit.
That includes generated artifacts, unlike the normal Project Source backup.
Both SQLite integrity and foreign keys are checked. The archive is encrypted with
the host's age recipient, decrypted into private temporary storage with the host
identity, and compared by SHA-256/size before publication. No live database is
restored automatically. The archive stores logical data, not OS configuration,
secrets, ACLs, Docker images, TeX snapshots, or a copy of application executables.

Symlinks, special files, nested mounts, changing files and corrupt metadata cause
a refusal. Hosts storing application data through these layouts must resolve the
layout explicitly; the updater does not silently omit them. Only private,
root-owned managed points are eligible for collection.

## Limits and activation

The dedicated root is `/var/lib/latex-renderer-update-recovery`, outside the
group-writable application data parent and outside existing backup directories.
Existing backups are neither imported nor deleted. Defaults are:

| Setting                                      | Default            |
| -------------------------------------------- | ------------------ |
| Entire managed root, including working files | 4 GiB              |
| Filesystem free space remaining              | 3 GiB              |
| Completed points retained                    | 2                  |
| Age after which unprotected points expire    | 168 hours (7 days) |
| Source entries                               | 100,000            |

1 GiB = 1,073,741,824 bytes. Customize with the keys in
`deploy/update-recovery.example.json`, installed as root-owned mode 0600
`/etc/latex-renderer/update-recovery.json`. Unknown keys, invalid integers and
unsupported limits fail closed. Defaults are used only when the file is absent,
not when it is unreadable or corrupt. There is no automatic disk expansion.

Admission budgets plaintext, ciphertext, decrypted verification, SQLite growth
allowance and metadata/directory overhead, not just final archive size. Actual
allocated bytes and filesystem availability are measured after collection.
Copies/streams are bounded; insufficient space or ENOSPC prevents deployment.
This is an application-managed admission budget, not a filesystem quota. It does
not replace the separate TeX mirror's 15 GiB OS-enforced storage boundary.

Collection runs before/after updates and every 15 minutes using
`latex-renderer-update-recovery-gc.timer` (persistent calendar timer, boot pass).
The GC service takes the same mutation lock and defers while an update is active.
Its root-only shim resolves the verified independent Updater slot, not the
application's `current` link. During migration, an old slot without this feature
defers GC. No CI or controller credential gains a deletion or restore verb.

An existing controller from before this feature cannot acquire these points
automatically when updating to the first new release. For that first transition,
retain the established manual full-backup procedure, or explicitly upgrade the
independent Updater to the verified RC first and then apply the application.
Do not interpret an old controller's ordinary backup as a full recovery point.

## Failure, inspection and recovery

Inspect from a root shell:

```sh
/usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status
```

A failed/interrupted deployment retains its point and journal and blocks another
deployment with `RECOVERY_REVIEW_REQUIRED`. A live owner is checked using boot ID,
PID and process start time; PID reuse is not enough to discard protection.
GC never discards a pending journal or its data. A crash before deployment starts
can restore the recorded units and clean abandoned staging on the next locked
attempt. On reboot, normally enabled services/timers follow their systemd policy;
this mechanism does not automatically roll back the application database.

This review gate also takes precedence over a future release's code-only automatic
rollback eligibility. The controller reports that review is required instead of
attempting a second deployment against a protected failed operation. A GC error
after successful deployment is logged separately, not misreported as a failed
application deployment. Interrupted point deletion resumes from a private trash
directory at the next GC; that directory is included in the same capacity budget.

After checking application and Updater identities, migration state, service
health and the appropriate release's rollback compatibility, an operator can
acknowledge **the exact pending point**:

```sh
/usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

This only releases protection and restores previously active units. It does not
restore/delete application data. The point then becomes eligible for normal age,
count and capacity collection. Do not acknowledge merely to bypass a failed
migration. There is no unbounded failure retry or automatic data rollback.

To recover data, first stop writers under the shared mutation lock, verify the
selected archive against its root-owned `summary.json`, and decrypt/extract into
a **new private empty directory**, not the live data tree. Verify the embedded
manifest hashes and SQLite integrity/foreign keys. Restore DB and complete storage
as one coordinated operation with the attested application release recorded in
the manifest; reapply that release's service ownership and storage ACL setup.
Restore any required external configuration from the host's independent backup.
This intentionally remains an explicit operator procedure: replacing live data
can lose writes made after the recovery point. Test it on a disposable host first.

Regular age collection may leave no points after a week without updates; this is
not a permanent backup archive. A pending failed deployment is the exception and
requires review rather than forced deletion. All temporary plaintext is below
the managed root, normally removed immediately, and covered by admission.

## リリースコピーの中断と再試行

新しい導入処理は、最終リリース名へ直接コピーしません。非公開の作業ディレクトリで
ファイル・リンク・実行権限を元の配布内容と照合し、所有者・権限を設定して永続化した後、
同じファイルシステム内のrenameで公開します。完成前に`current`を切り替えることはありません。
コピーには同じNodeプロセスのファイル操作を使い、コピー元の署名・digest検証は従来どおり
Updaterが先に実施します。コピー内容の照合はその検証の代わりにはなりません。

コピー途中のI/Oエラーや容量不足では、最終名を公開せず、root専用の記録と作業ディレクトリを
残します。復旧レビューが必要な場合は先に既存のレビュー手順を完了してください。
原因を取り除いて同じ不変リリースへ通常の更新を再試行すると、版・内容・所有者・パスが
記録と一致する途中コピーだけを回収してやり直します。コピー完了後やrename直後の中断も
同じ記録から復旧します。完成済み配置は記録された全ファイルのhashで検査して再利用し、
上書きや権限の再設定はしません。署名検証済みリリースのmetadataと非生成ソースが同一なら、
再ビルド時のクライアント署名などの生成物の違いだけで拒否しません。rollback時に検証済みの
稼働Updaterが実行用driverを差し替える既存経路も、旧配置を書き換えずに維持します。

作業記録は`/opt/latex-renderer/update-staging/release-publications`、途中コピーは
`/opt/latex-renderer/releases/.pending-*`です。通常のリリース整理では途中コピーを完成版の
保持数に数えません。同じ版の再試行が成功すると記録と途中コピーは取り除かれます。
再試行しない版の残骸の収集は、完成版・復旧点の保持判定と合わせて扱う必要があります。

古い方式で残った、完了マーカーも信頼できる作業記録もないディレクトリは自動削除しません。
記録の破損、異なる配布内容、想定外の所有者、外部symlink、特殊ファイル、配下のmountも
安全側で拒否します。マーカーだけを手作業で作ったり、署名・復旧レビューを省略したりせず、
必要なデータと復旧点を保護した上で原因を調べてください。

通常テストでは小さな一時ディレクトリでI/Oエラー・容量不足相当の失敗、公開前後の中断、
実SIGKILL、同時実行、改変・不正パスを検証します。使い捨てホストでの実ENOSPC・再起動・
systemd経由の更新は別の統合試験であり、これらのfixtureの成功だけでは合格としません。
署名付き更新検証CIは、使い捨てホストのrun/bootマーカーを検査してから、専用の小さいtmpfsで
実ENOSPCと同じ内容への再試行も試験します。本番ホストや通常のローカルテストでは実行しません。

## Validation

Local tests use tiny SQLite/storage fixtures and ephemeral age keys, exercise
real encryption/decryption, retention, capacity refusal, corruption, unsafe paths,
service quiescence/restoration, interrupted owners and activation read races.
A delayed-zero-padding fixture reproduces early tar reader exit deterministically.
Extraction drains producer EOF (`--ignore-zeros`, with end-block warnings enabled)
and still requires both process exit codes, age authentication and every file/DB
check to pass. Pipe failures identify the failing command pair, not only a generic
stream error. See [GNU tar's EOF behavior](https://www.gnu.org/software/tar/manual/html_node/Ignore-Zeros.html).
The two disposable-host E2E baselines additionally check that the new helper's
baseline recovery point decrypts to the preserved storage sentinel. Neither
successful local tests nor branch artifacts authorize production rollout.
