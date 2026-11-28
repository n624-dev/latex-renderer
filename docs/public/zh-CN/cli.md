---
slug: cli
category: CLI
title: 通过 CLI 转换文档并获取结果
description: 在终端编译 TeX，下载 PDF、日志和页面预览。
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

在 `main.tex` 所在目录运行 `n624-latex main.tex`，即可将 PDF 保存到同一目录。首次使用请参见[安装 CLI](/zh-CN/docs/client/)配置连接。

## 身份验证 {#認証}

通常可在浏览器中打开设置页面并保存 API 密钥。

```sh
n624-latex setup --gui
```

在 SSH 等无法打开浏览器的环境中，通过**标准输入**注册密钥，避免密钥出现在命令行参数中。以下示例适用于 Bash 和 Zsh。运行第一行后粘贴密钥并按 Enter，然后继续执行。

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Windows 用户也可使用[安装程序的不回显输入框](/zh-CN/docs/windows/#インストール)注册密钥。

以下命令分别用于检查密钥保存状态和删除密钥。

```sh
n624-latex auth status
n624-latex auth logout
```

`auth status` 显示实际连接的源站和凭据来源：已保存的配置名称、环境变量 `LATEX_RENDER_API_KEY` 或无凭据。使用 `--json` 可以查看 `origin` 和 `credentialSource` 字段。

- 若已设置环境变量 `LATEX_RENDER_API_KEY`，CLI 会优先使用它，而非本地保存的密钥。
- `logout` 仅删除本地保存的密钥。清除环境变量或在服务器上撤销密钥需要分别操作。

### 指定服务器 {#接続先サーバー}

默认连接托管服务（`https://latex-render.n624.jp`）。如使用自托管服务器，请在运行命令的 shell 中指定服务器的 HTTPS URL。

- URL 末尾不要加 `/app/` 或 `/api/v1/`。
- 使用该服务器签发的 API 密钥。

**Linux 和 macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## 设置与诊断 {#セットアップと診断}

运行 `n624-latex setup` 配置连接与集成。连接失败时，先用以下命令检查状态。如果找不到 `n624-latex`，请参见[检查安装与 PATH](/zh-CN/docs/troubleshooting/#インストール-ログイン)。

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` 以只读方式检查安装和凭据，不会输出 API 密钥的值。发现问题时返回退出码 `2`。

| 安装方式 | 更新与修复 |
| --- | --- |
| APT | [使用 APT 更新](/zh-CN/docs/client/#apt-版の更新)，软件包损坏时[重新安装](/zh-CN/docs/client/#状態確認と修復)。Local MCP 需要[手动注册](/zh-CN/docs/mcp/#local-mcpの登録)。 |
| Homebrew | [使用 Homebrew 更新](/zh-CN/docs/client/#homebrew-版の更新)，软件包损坏时[重新安装](/zh-CN/docs/client/#状態確認と修復)。可用 `n624-latex setup` 配置 AI 工具集成。 |
| 独立安装程序 | [在设置页面更新](/zh-CN/docs/client/#配布インストーラー版の更新)。可用 `n624-latex setup repair` 修复受管理的集成配置和启动程序。 |

卸载时请遵循[相应安装方式的步骤](/zh-CN/docs/client/#アンインストール)。设置页面仅在本机打开，并随 CLI 退出而关闭。

## 渲染 {#レンダリング}

### 直接转换 TeX 文件 {#tex-ファイルを直接変換する}

可在项目目录中指定 `.tex` 文件来生成 PDF。图片、参考文献和本地 `.sty` 文件等可通过项目内的相对路径引用。

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- 省略 `-o` 时，会在执行命令的目录中生成与输入同名的 PDF（例如 `main.pdf`）。
- LaTeX 出错时，会显示可确定的文件名、行号及作业 ID。如果转换或下载失败，上次成功保存的 PDF 仍会保留。

#### 选择 LaTeX 引擎 {#latex-のエンジンを選ぶ}

若要使用 XeLaTeX，请将引擎名写在文件名前面。

```sh
n624-latex xelatex main.tex
```

未指定引擎时，CLI 会检查文档开头的 `% !TeX program = xelatex` 或
`% !TEX TS-program = xelatex`。若文档中未指定，则检查
项目根目录的 `.n624-latex.json`。将此文件提交到
Git，即可在其他设备上使用相同的引擎。

```json
{"engine":"xelatex"}
```

默认使用 LuaLaTeX。只有服务器的 TeX 运行环境
包含日语集合时，才能使用 pLaTeX 和 upLaTeX。

| 引擎 | 迁移文档时应检查的设置 |
| --- | --- |
| LuaLaTeX | 检查依赖 `fontspec` 或 LuaTeX-ja 的文档设置。 |
| pdfLaTeX | 不支持 `fontspec`。请使用适用于 pdfLaTeX 的字体设置。 |
| XeLaTeX | 支持 `fontspec`。请检查是否有 LuaTeX 专用宏包。 |
| pLaTeX / upLaTeX | 选择匹配引擎的日文文档类。用 upLaTeX 编译 `jsarticle` 时需指定类选项 `uplatex`。 |

参考文献按文档中的宏包及设置处理。请一并上传 `.bib` 文件和自定义 `.bst` 文件。使用 BibTeX 的 pLaTeX 和 upLaTeX 文档分别由 pBibTeX 和 upBibTeX 处理。可在[渲染环境](/app/environment/)中分别查看 PDF、SVG 及 SVG 定位的验证情况。

### 转换 ZIP 或获取多种输出 {#zip-複数の出力を指定する}

要上传 ZIP 或获取包含日志、预览及 SVG 的完整输出，请使用 `render` 子命令。

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**示例**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- 未指定路径时使用当前目录；未指定 `--entrypoint` 时使用 `main.tex`。CLI 准备最多包含 500 个文件的输入包，并等待作业完成。入口可以是任意相对 `.tex` 路径，服务器会验证该文件是否存在及路径是否安全。
- 指定 `--svg` 可在 PDF 之外，将最外层公式和顶层 TikZ 图形分别提取为独立的 SVG。

### 复用同一份输入转换多个文档 {#同じ入力から複数の文書を作る-source-の再利用}

若同一目录或 ZIP 包含多个入口，先用 `source upload` 上传一次，再复用输入包 ID，能节省上传时间。每个作业应使用单独的输出目录（`--output`）。

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] 输出清理、排除规则和重复上传
>
> - **清理旧输出。** 重复使用同一输出目录时，只清理上次 `job.json` 中记录、本次已不存在的 PDF、预览和 SVG。其他用户文件不受影响。
> - **输出目录安全检查。** 含符号链接的路径会被拒绝。POSIX 系统还会检查所有者及组和其他用户的写权限。Windows 不执行 POSIX 权限位检查。
> - **自动排除输出。** 若 `--output` 指定项目内的子目录，下次打包只排除该目录，名称相似的其他目录不受影响。不能将项目根目录用作输出目录。
> - **跳过重复上传。** 如果服务器已有同一用户的有效 ZIP，且 SHA-256 相同，将返回 `uploadRequired: false`，无需重传。返回的输入包 ID 仅可用于同一用户的后续作业。

## 已保存的项目和修订版本 {#保存projectと改訂}

可通过 CLI 管理和重新转换服务器上的项目和修订版本，同一用户的 Web、API、MCP 及其他 API 密钥也可访问。临时使用 `render` 或 `source upload` 无需创建项目。

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** 将本地目录或 ZIP 准备为输入包，并在指定项目中保存为不可变的修订版本。添加 `--svg` 可将初始输出设为 PDF 和 SVG。
- **`render`** 从已保存的版本创建作业。只有指定 `--svg` 才会覆盖该版本的输出设置。
- **`list`、`get` 和 `jobs`** 可用 `--cursor` 获取下一页。
- **`delete`** 将项目从列表中隐藏，已有作业不会被立即彻底删除。

## 作业操作 {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **下载与等待。** 操作作业时，CLI 使用 API 密钥更新短期令牌。`jobs download` 在作业完成后替换输出文件。若等待期间中断或失败，原有文件会保留。`delete` 仅适用于已结束的作业。
- **获取更多 PNG 预览。** 默认只生成第 1 页。常规下载仅获取已生成的 PNG。指定 `--preview-page 2 5` 可生成相应页面，验证大小和 SHA-256 后保存。此操作不会重新编译 PDF，也不会延长保留期。
- **提前获取 PDF 和重试 SVG。** 对于 PDF 和 SVG 作业，可用 `--pdf-only` 在 SVG 完成前下载 PDF。若仅 SVG 提取失败，系统会保留 PDF 并标记部分成功。`retry-svg` 只重试 SVG，保留原 PDF。包括首次尝试在内最多 8 次，不延长保留期。若运行环境已更新，请创建新作业。参见[提前发布 PDF 与重试 SVG](/zh-CN/docs/api/#pdfの先行公開とsvgの再試行)。
- **通信失败时重试。** 查询状态时遇到临时通信错误会自动重试，身份验证和权限错误则直接返回。CLI 停止等待后，服务器可能仍在处理。请检查同一个 `<jobId>`，避免重复创建作业。参见 [CLI 等待与重试](/zh-CN/docs/reference/#cliの待機と再試行)。

## 输出文件 {#成果物}

关于提前下载 PDF、获取指定页面的 PNG 和重试 SVG，请参见[获取 PDF、PNG 和 SVG](/zh-CN/docs/outputs/)。

| 路径 | 内容 |
| --- | --- |
| `.render/result.pdf` | 成功生成的 PDF |
| `.render/compile.log` | LaTeX 编译日志 |
| `.render/errors.json` | 结构化错误信息 |
| `.render/job.json` | 最终作业状态 |
| `.render/previews/page-N.png` | 页面预览图片（最多 100 页） |
| `.render/svg/manifest.json` | SVG 与源文件位置、PDF 坐标的对应关系 |
| `.render/svg/objects/*.svg` | 各个公式和 TikZ 图形的独立 SVG |

## JSON 输出 {#json出力}

为任意 CLI 命令添加 `--json` 后，标准输出只包含一个 JSON 对象，不混入进度消息。结果与普通显示使用相同的 `client-core` 处理逻辑，不含 API 密钥或短期令牌。

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

成功和失败时的结构及退出码见 [CLI JSON 格式](/zh-CN/docs/reference/#cliのjson形式)。
