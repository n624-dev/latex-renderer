package lanbridge

import (
	"io"
	"os"
	"path/filepath"
	"syscall"
)

func ReadConfigurationFile(path string) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errAuthority
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || canonical != path {
		return nil, errAuthority
	}
	parent, err := os.Lstat(filepath.Dir(path))
	if err != nil || !parent.IsDir() || parent.Mode().Perm()&0022 != 0 {
		return nil, errAuthority
	}
	parentStat, ok := parent.Sys().(*syscall.Stat_t)
	if !ok || (parentStat.Uid != 0 && parentStat.Uid != uint32(os.Geteuid())) {
		return nil, errAuthority
	}
	descriptor, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errAuthority
	}
	file := os.NewFile(uintptr(descriptor), filepath.Base(path))
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return nil, errAuthority
	}
	stat, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || stat.Nlink != 1 || (stat.Uid != 0 && stat.Uid != uint32(os.Geteuid())) || before.Size() < 1 || before.Size() > 65536 {
		return nil, errAuthority
	}
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || int64(len(data)) != before.Size() {
		return nil, errAuthority
	}
	after, err := file.Stat()
	if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return nil, errAuthority
	}
	afterStat, ok := after.Sys().(*syscall.Stat_t)
	if !ok || afterStat.Ctim != stat.Ctim {
		return nil, errAuthority
	}
	return data, nil
}
