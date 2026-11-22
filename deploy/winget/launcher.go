package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	if err := run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok && exit.ExitCode() >= 0 {
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, "LaTeX Renderer:", err)
		os.Exit(1)
	}
}

func run() error {
	launcher, err := os.Executable()
	if err != nil {
		return err
	}
	// WinGet's command aliases are symlinks to the portable install directory.
	launcher, err = filepath.EvalSymlinks(launcher)
	if err != nil {
		return err
	}
	directory := filepath.Dir(launcher)
	name := strings.ToLower(filepath.Base(launcher))
	entry := ""
	public := "0"
	switch name {
	case "n624-latex.exe":
		entry, public = "latex-render.cjs", "1"
	case "latex-render.exe":
		entry = "latex-render.cjs"
	case "latex-renderer-mcp.exe":
		entry = "latex-renderer-mcp.cjs"
	case "latex-render-admin.exe":
		entry = "latex-render-admin.mjs"
	default:
		return fmt.Errorf("unexpected launcher name %q", name)
	}

	args := append([]string{filepath.Join(directory, "app", entry)}, os.Args[1:]...)
	child := exec.Command(filepath.Join(directory, "runtime", "node.exe"), args...)
	child.Env = append(os.Environ(),
		"N624_LATEX_COMMAND="+public,
		"N624_LATEX_PACKAGE=winget",
		"LATEX_RENDER_INSTALL_DIRECTORY="+directory,
		"LATEX_RENDER_BIN_DIRECTORY="+directory,
		"LATEX_RENDER_CLI_PATH="+filepath.Join(directory, "latex-render.exe"),
	)
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	return child.Run()
}
