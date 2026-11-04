package lanbridge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
)

func ProfileStateDirectory(base, origin, domain, publicOrigin, issuer string) (string, error) {
	if !filepath.IsAbs(base) || filepath.Clean(base) != base || issuer == "" || len(issuer) > 32 {
		return "", errAuthority
	}
	canonical, err := filepath.EvalSymlinks(base)
	if err != nil || canonical != base {
		return "", errAuthority
	}
	fields, _ := json.Marshal([]string{origin, domain, publicOrigin, issuer})
	digest := sha256.Sum256(fields)
	return filepath.Join(base, "profiles", hex.EncodeToString(digest[:])), nil
}
func AcquireProfileServingLock(root string) (func(), error) {
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil || canonical != root {
		return nil, errCertificate
	}
	stat, err := os.Lstat(root)
	if err != nil || !stat.IsDir() || stat.Mode().Perm() != 0700 {
		return nil, errCertificate
	}
	details, ok := stat.Sys().(*syscall.Stat_t)
	if !ok || details.Uid != uint32(os.Geteuid()) {
		return nil, errCertificate
	}
	fd, err := syscall.Open(filepath.Join(root, "serve.lock"), syscall.O_RDWR|syscall.O_CREAT|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, errCertificate
	}
	file := os.NewFile(uintptr(fd), "serve.lock")
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, errCertificate
	}
	metadata, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || metadata.Nlink != 1 || metadata.Uid != details.Uid || info.Mode().Perm() != 0600 || syscall.Flock(fd, syscall.LOCK_SH|syscall.LOCK_NB) != nil {
		file.Close()
		return nil, errCertificate
	}
	return func() { file.Close() }, nil
}
