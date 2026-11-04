package lanbridge

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateBundleReloadAndUnsafeFiles(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	m := manager(t, f.roots, nil)
	root := t.TempDir()
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "bundle.pem")
	if err := os.WriteFile(path, f.bundle, 0600); err != nil {
		t.Fatal(err)
	}
	if err := m.ReloadBundle(root); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if err := m.ReloadBundle(root); err == nil {
		t.Fatal("Accepted public private key")
	}
	if err := request(t, serve(t, m), f.roots, browserName, tls.VersionTLS13); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(root, "unrelated.pem")
	if err := os.Rename(path, external); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, path); err != nil {
		t.Fatal(err)
	}
	if err := m.ReloadBundle(root); err == nil {
		t.Fatal("Accepted symlink")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(external, path); err != nil {
		t.Fatal(err)
	}
	if err := m.ReloadBundle(root); err == nil {
		t.Fatal("Accepted extra hardlink")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, f.bundle, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	if err := m.ReloadBundle(root); err == nil {
		t.Fatal("Accepted nonprivate state directory")
	}
}
