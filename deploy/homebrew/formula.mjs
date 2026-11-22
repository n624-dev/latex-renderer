import { validReleaseVersion } from "../scripts/release-version.mjs";

export function clientReleaseUrl(version) {
  const release = validReleaseVersion(version);
  return `https://github.com/n624-dev/latex-renderer/releases/download/v${release}/latex-renderer-client-${release}.zip`;
}

export function renderHomebrewFormula(
  version,
  sha256,
  { fixture, revision } = {},
) {
  const releaseUrl = clientReleaseUrl(version);
  if (
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    sha256.length !== 64
  )
    throw new Error("Homebrew requires a valid SHA-256");
  if (fixture !== undefined && fixture.protocol !== "file:")
    throw new Error("Homebrew test fixtures must use local files");
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) || revision < 1)
  )
    throw new Error("Homebrew revision must be a positive integer");
  const url = fixture?.href ?? releaseUrl;

  return `require "shellwords"

class N624Latex < Formula
  desc "Render LaTeX documents using LaTeX Renderer"
  homepage "https://github.com/n624-dev/latex-renderer"
  url ${JSON.stringify(url)}
  version "${version}"
  sha256 "${sha256}"
  license "Apache-2.0"
${revision === undefined ? "" : `  revision ${revision}\n`}
  depends_on "node@24"
  depends_on :macos

  def install
    libexec.install "app", "skill"
    bin.mkpath
    entries = {
      "n624-latex"         => "latex-render.cjs",
      "latex-render"       => "latex-render.cjs",
      "latex-render-admin" => "latex-render-admin.mjs",
      "latex-renderer-mcp" => "latex-renderer-mcp.cjs",
    }
    node = Formula["node@24"].opt_bin/"node"
    entries.each do |name, entry|
      settings = {
        "N624_LATEX_PACKAGE"             => "homebrew",
        "LATEX_RENDER_INSTALL_DIRECTORY" => opt_libexec.to_s,
        "LATEX_RENDER_BIN_DIRECTORY"     => (HOMEBREW_PREFIX/"bin").to_s,
      }
      settings["N624_LATEX_COMMAND"] = "1" if name == "n624-latex"
      if name == "latex-renderer-mcp"
        settings["LATEX_RENDER_CLI_PATH"] = (HOMEBREW_PREFIX/"bin/latex-render").to_s
      end
      exports = settings.map { |key, value| "export #{key}=#{Shellwords.escape(value)}" }
      command = Shellwords.join([node.to_s, (libexec/"app"/entry).to_s])
      launcher = bin/name
      launcher.write(["#!/bin/sh", *exports, "exec #{command} \\"$@\\"", ""].join("\\n"))
      launcher.chmod 0755
    end
  end

  test do
    assert_equal version.to_s, shell_output("#{Shellwords.escape((bin/"n624-latex").to_s)} --version").strip
  end
end
`;
}
