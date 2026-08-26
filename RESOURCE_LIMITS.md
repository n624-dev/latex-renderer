# Resource limits

| Resource                             |                Default |
| ------------------------------------ | ---------------------: |
| ZIP upload                           |                 20 MiB |
| Extracted total                      |                100 MiB |
| One input file                       |                 20 MiB |
| ZIP entries / files / path depth     |        1000 / 500 / 10 |
| Queue                                |                    100 |
| Stored bytes per user                |                  1 GiB |
| Container CPU / RAM / PIDs           |      1.5 / 1 GiB / 128 |
| LaTeX compile subprocess / whole job |          300 s / 420 s |
| PDF pages                            |                    100 |
| Preview resolution                   |                150 dpi |
| Total output                         |                200 MiB |
| PDF / log / PNG total                |     100 / 10 / 150 MiB |
| SVG objects / one object / SVG total | 200 / 10 MiB / 100 MiB |
| SVG conversion                       |                  120 s |
| Minimum free storage                 |                  5 GiB |

The 300-second value is the `latexmk` subprocess timeout enforced inside `renderer/compile.sh`. The 420-second whole-job default comes from `RENDERER_JOB_TIMEOUT_SECONDS` and bounds the worker/container lifecycle around compilation, validation, and output processing. These are separate limits; the subprocess timeout is intentionally lower so the worker has time to terminate and collect bounded results.

`MAX_UPLOAD_BYTES`, `MAX_EXTRACTED_BYTES`, `MAX_FILE_COUNT`, and `MAX_ZIP_ENTRIES` form one validated configuration shared by ticket validation, upload inspection, Remote MCP, and worker extraction. `MAX_SVG_OBJECTS`, `MAX_SVG_BYTES`, `MAX_SVG_TOTAL_BYTES`, and `SVG_CONVERSION_TIMEOUT_SECONDS` bound the optional SVG extraction stage in addition to the whole-job and total-output limits. Services fail startup if extracted bytes are below upload bytes or ZIP entries are below file count. Rendering is intentionally single-job-per-worker; horizontal worker instances provide concurrency, so there is no ignored `RENDERER_CONCURRENCY` setting.

Production may lower limits. Raising them requires capacity and sandbox review. Declared ZIP sizes are not trusted; directory entries, regular files, actual streamed bytes, and extracted totals are counted. Queue, per-service-account, and per-user storage admission checks execute in the same SQLite `BEGIN IMMEDIATE` transaction as their reservation row.
