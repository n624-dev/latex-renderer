package lanbridge

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// ReloadBundle refuses symlinks, extra hardlinks, foreign owners and unbounded
// files. A failure retains the already verified in-memory bundle until expiry.
// The state directory is shared with the Node publisher, with matching 0700 /
// 0600 rules. The publisher replaces the file atomically; readers never chmod,
// chown, truncate or otherwise modify it.
func (m *CertificateManager) ReloadBundle(stateDirectory string) error {
	if !filepath.IsAbs(stateDirectory) || filepath.Clean(stateDirectory) != stateDirectory {
		return errCertificate
	}
	canonical, err := filepath.EvalSymlinks(stateDirectory)
	if err != nil || canonical != stateDirectory {
		return errCertificate
	}
	root, err := os.Lstat(stateDirectory)
	if err != nil || !root.IsDir() || root.Mode().Perm() != 0700 || root.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return errCertificate
	}
	stat, ok := root.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return errCertificate
	}
	descriptor, err := syscall.Open(filepath.Join(stateDirectory, "bundle.pem"), syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("LAN HTTPS bundle could not be opened")
	}
	file := os.NewFile(uintptr(descriptor), "bundle.pem")
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return errCertificate
	}
	details, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 ||
		details.Uid != uint32(os.Geteuid()) || details.Nlink != 1 || before.Size() <= 0 || before.Size() > 528*1024 {
		return errCertificate
	}
	bundle, err := io.ReadAll(io.LimitReader(file, 528*1024+1))
	if err != nil || int64(len(bundle)) != before.Size() {
		return errCertificate
	}
	after, err := file.Stat()
	if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return errCertificate
	}
	afterDetails, ok := after.Sys().(*syscall.Stat_t)
	if !ok || afterDetails.Ctim != details.Ctim {
		return errCertificate
	}
	return m.LoadBundle(bundle)
}
