import { spawnSync } from "node:child_process";
import { AppError } from "@latex-renderer/shared";

type Operation = "save" | "load" | "probe";

// Resolve only modules belonging to the Windows PowerShell process itself.
// A PowerShell 7 -> Node -> powershell.exe chain otherwise inherits PS7 modules.
const bootstrap =
  "$ErrorActionPreference='Stop';" +
  "$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');" +
  "try{Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Security','Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop}catch{exit 21};";

function script(operation: Operation): string {
  if (operation === "save")
    return (
      bootstrap +
      "try{$p=$env:LR_CREDENTIAL_PATH;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p))|Out-Null;" +
      "$s=[Console]::In.ReadToEnd().Trim();" +
      "$v=Microsoft.PowerShell.Security\\ConvertTo-SecureString -String $s -AsPlainText -Force;" +
      "$e=Microsoft.PowerShell.Security\\ConvertFrom-SecureString -SecureString $v;" +
      "[IO.File]::WriteAllText($p,$e,[Text.Encoding]::ASCII);exit 0}catch{exit 24}"
    );
  return (
    bootstrap +
    "try{$e=[IO.File]::ReadAllText($env:LR_CREDENTIAL_PATH).Trim()}" +
    "catch [IO.FileNotFoundException]{exit 20}catch [IO.DirectoryNotFoundException]{exit 20}catch{exit 22};" +
    "try{$v=Microsoft.PowerShell.Security\\ConvertTo-SecureString -String $e;" +
    "$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($v);" +
    "try{$s=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b);" +
    "if($s -notmatch '^lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$'){exit 23};" +
    (operation === "load" ? "[Console]::Out.Write($s)" : "$null=$s") +
    "}finally{if($b -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}};exit 0}catch{exit 23}"
  );
}

export function runWindowsCredential(
  operation: Operation,
  path: string,
  env: NodeJS.ProcessEnv,
  input?: string,
): string {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env))
    if (key.toLowerCase() !== "psmodulepath") childEnv[key] = value;
  childEnv.LR_CREDENTIAL_PATH = path;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script(operation)],
    {
      ...(input === undefined ? {} : { input }),
      encoding: "utf8",
      windowsHide: true,
      env: childEnv,
      timeout: 15_000,
      maxBuffer: 16_384,
    },
  );
  if (result.status === 0 && !result.error)
    return operation === "load" ? result.stdout : "";
  // PowerShell errors can include command text, file contents, or decrypted
  // input. Return only fixed stage diagnostics, never stdout/stderr/error text.
  if (!result.error) {
    if (result.status === 20)
      throw new AppError(
        "CREDENTIAL_NOT_FOUND",
        "No stored DPAPI credential file was found",
        401,
      );
    if (result.status === 22)
      throw new AppError(
        "CREDENTIAL_ACCESS_FAILED",
        "The stored DPAPI credential file could not be read",
        401,
      );
    if (result.status === 23)
      throw new AppError(
        "CREDENTIAL_DECRYPT_FAILED",
        "The stored DPAPI credential could not be decrypted by this Windows account",
        401,
      );
    if (result.status === 24)
      throw new AppError(
        "CREDENTIAL_STORE_FAILED",
        "Windows DPAPI credential storage failed",
      );
  }
  throw new AppError(
    "CREDENTIAL_RUNTIME_FAILED",
    "Windows PowerShell could not initialize or complete the DPAPI operation",
  );
}
