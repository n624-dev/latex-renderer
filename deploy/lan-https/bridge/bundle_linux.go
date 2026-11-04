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
	bundle, err := ReadPrivateFile(filepath.Join(stateDirectory, "bundle.pem"), 528*1024)
	if err != nil {
		return err
	}
	return m.LoadBundle(bundle)
}

// ReadPrivateFile is shared by the installation and operator entrypoints.
func ReadPrivateFile(path string, maximum int64) ([]byte, error) {
	stateDirectory := filepath.Dir(path)
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || maximum < 1 || maximum > 528*1024 {
		return nil, errCertificate
	}
	if !filepath.IsAbs(stateDirectory) || filepath.Clean(stateDirectory) != stateDirectory {
		return nil, errCertificate
	}
	canonical, err := filepath.EvalSymlinks(stateDirectory)
	if err != nil || canonical != stateDirectory {
		return nil, errCertificate
	}
	root, err := os.Lstat(stateDirectory)
	if err != nil || !root.IsDir() || root.Mode().Perm() != 0700 || root.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return nil, errCertificate
	}
	stat, ok := root.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return nil, errCertificate
	}
	descriptor, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("LAN HTTPS private file could not be opened")
	}
	file := os.NewFile(uintptr(descriptor), filepath.Base(path))
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return nil, errCertificate
	}
	details, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 ||
		details.Uid != uint32(os.Geteuid()) || details.Nlink != 1 || before.Size() <= 0 || before.Size() > maximum {
		return nil, errCertificate
	}
	bundle, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil || int64(len(bundle)) != before.Size() {
		return nil, errCertificate
	}
	after, err := file.Stat()
	if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return nil, errCertificate
	}
	afterDetails, ok := after.Sys().(*syscall.Stat_t)
	if !ok || afterDetails.Ctim != details.Ctim {
		return nil, errCertificate
	}
	return bundle, nil
}
