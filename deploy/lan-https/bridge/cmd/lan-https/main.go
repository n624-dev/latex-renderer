package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	bridge "github.com/n624-dev/latex-renderer/deploy/lan-https/bridge"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Release builds replace these with the immutable package version and commit.
// Local test builds deliberately carry no production identity.
var version = "development"
var sourceCommit = "unknown"

func fail() error       { return errors.New("LAN HTTPS configuration or service unavailable") }
func event(name string) { _ = json.NewEncoder(os.Stderr).Encode(map[string]string{"event": name}) }
func main() {
	if len(os.Args) < 2 {
		event("lan_https.invalid_command")
		os.Exit(64)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	var err error
	switch os.Args[1] {
	case "version":
		_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"version": version, "commit": sourceCommit})
	case "signer":
		err = signer(ctx, os.Args[2:])
	case "front":
		err = front(ctx, os.Args[2:])
	case "keyless-check":
		err = keylessCheck(ctx, os.Args[2:])
	default:
		err = fail()
	}
	if err != nil {
		event("lan_https.start_or_runtime_failed")
		os.Exit(1)
	}
}
func decode(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return fail()
	}
	return nil
}
func signer(ctx context.Context, args []string) error {
	options := flag.NewFlagSet("signer", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	bundle := options.String("bundle", "", "")
	socket := options.String("socket", "", "")
	domain := options.String("domain", "", "")
	if options.Parse(args) != nil || options.NArg() != 0 || *bundle == "" || *socket == "" {
		return fail()
	}
	state := filepath.Dir(*socket)
	stat, err := os.Lstat(state)
	if err != nil || !stat.IsDir() || stat.Mode().Perm() != 0700 {
		return fail()
	}
	canonical, err := filepath.EvalSymlinks(state)
	if err != nil || canonical != state {
		return fail()
	}
	owner, ok := stat.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Geteuid()) {
		return fail()
	}
	server, err := bridge.NewSignerServer(*domain, nil)
	if err != nil {
		return err
	}
	if err = server.ReloadBundle(*bundle); err != nil {
		return err
	}
	if previous, err := os.Lstat(*socket); err == nil {
		existing, e := net.DialTimeout("unix", *socket, 200*time.Millisecond)
		if e == nil {
			_ = existing.Close()
			return fail()
		}
		details, ok := previous.Sys().(*syscall.Stat_t)
		if !ok || previous.Mode()&os.ModeSocket == 0 || details.Uid != uint32(os.Geteuid()) || details.Nlink != 1 {
			return fail()
		}
		if os.Remove(*socket) != nil {
			return fail()
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fail()
	}
	listener, err := net.Listen("unix", *socket)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(*socket)
	if os.Chmod(*socket, 0600) != nil {
		return fail()
	}
	httpServer := &http.Server{Handler: server, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: time.Second, MaxHeaderBytes: 4096, ErrorLog: log.New(io.Discard, "", 0)}
	ready := json.NewEncoder(os.Stdout).Encode(map[string]bool{"ready": true})
	if ready != nil {
		return fail()
	}
	done := make(chan error, 1)
	go func() { done <- httpServer.Serve(listener) }()
	parent := os.Getppid()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	ticks := 0
	lastFailed := false
	for {
		select {
		case <-ctx.Done():
			_ = httpServer.Close()
			return nil
		case err := <-done:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-ticker.C:
			if os.Getppid() != parent {
				_ = httpServer.Close()
				return nil
			}
			ticks++
			if ticks%60 == 0 {
				failed := server.ReloadBundle(*bundle) != nil
				if failed != lastFailed {
					if failed {
						event("lan_https.signer_reload_failed")
					} else {
						event("lan_https.signer_reload_recovered")
					}
					lastFailed = failed
				}
			}
		}
	}
}

type provider struct {
	Format       int    `json:"format"`
	Provider     string `json:"provider"`
	ServerOrigin string `json:"serverOrigin"`
	Domain       string `json:"lanDomain"`
	Address      string `json:"address"`
	Port         *int   `json:"port"`
	Fallback     bool   `json:"keylessFallback"`
	PublicOrigin string `json:"publicOrigin"`
}
type configuration struct {
	Format         int      `json:"format"`
	Role           string   `json:"role"`
	Provider       provider `json:"provider"`
	State          string   `json:"stateDirectory"`
	Issuer         string   `json:"issuerId"`
	Terms          bool     `json:"termsAccepted"`
	InvitationFile string   `json:"invitationFile"`
	Networks       []string `json:"allowedNetworks"`
}

func front(ctx context.Context, args []string) error {
	options := flag.NewFlagSet("front", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	path := options.String("config", "", "")
	if options.Parse(args) != nil || options.NArg() != 0 || *path == "" {
		return fail()
	}
	data, err := bridge.ReadConfigurationFile(*path)
	if err != nil {
		return err
	}
	var config configuration
	if decode(data, &config) != nil || config.Format != 1 || config.Role != "client" || config.Provider.Format != 1 {
		return fail()
	}
	p := config.Provider
	if p.Provider != "akebi-local-acme" && p.Provider != "akebi-keyless" {
		return fail()
	}
	if p.Provider == "akebi-keyless" && !p.Fallback {
		return fail()
	}
	address, err := netip.ParseAddr(p.Address)
	if err != nil || !address.IsPrivate() || address.Is4In6() {
		return fail()
	}
	label := ""
	if address.Is4() {
		label = strings.ReplaceAll(address.String(), ".", "-")
	} else {
		raw := address.As16()
		groups := []string{}
		for i := 0; i < 16; i += 2 {
			groups = append(groups, hex.EncodeToString(raw[i:i+2]))
		}
		label = strings.Join(groups, "-")
	}
	hostname := label + "." + p.Domain
	port := 443
	if p.Port != nil {
		port = *p.Port
	}
	if port < 1 || port > 65535 || (port >= 3100 && port <= 3199) {
		return fail()
	}
	publicHost := hostname
	if port != 443 {
		publicHost = net.JoinHostPort(hostname, fmt.Sprint(port))
	}
	if p.PublicOrigin != "" && p.PublicOrigin != "https://"+publicHost {
		return fail()
	}
	profileRoot, err := bridge.ProfileStateDirectory(config.State, p.ServerOrigin, p.Domain, "https://"+publicHost, config.Issuer)
	if err != nil {
		return err
	}
	releaseLock, err := bridge.AcquireProfileServingLock(profileRoot)
	if err != nil {
		return err
	}
	defer releaseLock()
	identity, err := bridge.ReadPrivateFile(filepath.Join(profileRoot, "identity.pem"), 16384)
	if err != nil {
		return err
	}
	// Construction is local only. Invitation lookup/enrollment are deferred until
	// fallback is actually selected, so a valid local bundle starts offline.
	client, err := bridge.NewAuthorityClient(p.ServerOrigin, p.Domain, hostname, identity, "", nil)
	if err != nil {
		return err
	}
	id, ok := new(big.Int).SetString(client.InstallationID(), 16)
	if !ok {
		return fail()
	}
	management := "i-" + id.Text(36) + ".instances." + p.Domain
	var fallback bridge.FallbackCertificate
	if p.Fallback {
		var fallbackClient *bridge.AuthorityClient
		fallback = func(ctx context.Context) (*tls.Certificate, error) {
			if fallbackClient == nil {
				invitation := ""
				if config.InvitationFile != "" {
					if _, err := os.Lstat(config.InvitationFile); err == nil {
						raw, e := bridge.ReadPrivateFile(config.InvitationFile, 4096)
						if e != nil {
							return nil, e
						}
						var invite struct {
							Code string `json:"invitationCode"`
						}
						if decode(raw, &invite) != nil {
							return nil, fail()
						}
						invitation = invite.Code
					} else if !errors.Is(err, os.ErrNotExist) {
						return nil, fail()
					}
				}
				next, e := bridge.NewAuthorityClient(p.ServerOrigin, p.Domain, hostname, identity, invitation, nil)
				if e != nil {
					return nil, e
				}
				fallbackClient = next
			}
			return fallbackClient.Certificate(ctx)
		}
	}
	manager, err := bridge.NewCertificateManager(hostname, management, nil, fallback)
	if err != nil {
		return err
	}
	loaded := false
	if p.Provider == "akebi-local-acme" {
		loaded = manager.ReloadBundle(profileRoot) == nil
	}
	if !loaded && !p.Fallback {
		return fail()
	}
	networks := []netip.Prefix{}
	contains := false
	for _, raw := range config.Networks {
		network, e := netip.ParsePrefix(raw)
		if e != nil {
			return fail()
		}
		if network.Contains(address) {
			contains = true
		}
		networks = append(networks, network)
	}
	if !contains {
		return fail()
	}
	upstream, _ := url.Parse("http://127.0.0.1:3180")
	handler, err := bridge.NewLoopbackProxy(publicHost, upstream, networks)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(address.String(), fmt.Sprint(port)))
	if err != nil {
		return err
	}
	defer listener.Close()
	guarded, err := bridge.GuardListener(listener, networks, 32)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, TLSConfig: manager.TLSConfig(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 65536, ErrorLog: log.New(io.Discard, "", 0)}
	done := make(chan error, 1)
	go func() { done <- server.Serve(tls.NewListener(guarded, server.TLSConfig)) }()
	event("lan_https.front_started")
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	lastFailed := !loaded
	var previous [32]byte
	for {
		select {
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			return server.Shutdown(shutdown)
		case err := <-done:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-ticker.C:
			if p.Provider == "akebi-keyless" {
				continue
			}
			bytes, e := bridge.ReadPrivateFile(filepath.Join(profileRoot, "bundle.pem"), 528*1024)
			failed := e != nil
			if !failed {
				hash := sha256.Sum256(bytes)
				if hash != previous {
					failed = manager.LoadBundle(bytes) != nil
					if !failed {
						previous = hash
					}
				}
			}
			if failed != lastFailed {
				if failed {
					event("lan_https.front_reload_failed")
				} else {
					event("lan_https.front_reload_recovered")
				}
				lastFailed = failed
			}
		}
	}
}

func keylessCheck(ctx context.Context, args []string) error {
	options := flag.NewFlagSet("keyless-check", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	path := options.String("config", "", "")
	if options.Parse(args) != nil || options.NArg() != 0 {
		return fail()
	}
	raw, err := bridge.ReadConfigurationFile(*path)
	if err != nil {
		return err
	}
	var config configuration
	if decode(raw, &config) != nil || config.Format != 1 || config.Role != "client" {
		return fail()
	}
	p := config.Provider
	ip, err := netip.ParseAddr(p.Address)
	if err != nil || !ip.IsPrivate() || ip.Is4In6() {
		return fail()
	}
	label := ""
	if ip.Is4() {
		label = strings.ReplaceAll(ip.String(), ".", "-")
	} else {
		address := ip.As16()
		groups := []string{}
		for i := 0; i < 16; i += 2 {
			groups = append(groups, hex.EncodeToString(address[i:i+2]))
		}
		label = strings.Join(groups, "-")
	}
	port := 443
	if p.Port != nil {
		port = *p.Port
	}
	publicHost := label + "." + p.Domain
	if port != 443 {
		publicHost = net.JoinHostPort(publicHost, fmt.Sprint(port))
	}
	profileRoot, err := bridge.ProfileStateDirectory(config.State, p.ServerOrigin, p.Domain, "https://"+publicHost, config.Issuer)
	if err != nil {
		return err
	}
	identity, err := bridge.ReadPrivateFile(filepath.Join(profileRoot, "identity.pem"), 16384)
	if err != nil {
		return err
	}
	invitation := ""
	if config.InvitationFile != "" {
		data, e := bridge.ReadPrivateFile(config.InvitationFile, 4096)
		if e != nil {
			return e
		}
		var value struct {
			Code string `json:"invitationCode"`
		}
		if decode(data, &value) != nil {
			return fail()
		}
		invitation = value.Code
	}
	client, err := bridge.NewAuthorityClient(p.ServerOrigin, p.Domain, label+"."+p.Domain, identity, invitation, nil)
	if err != nil {
		return err
	}
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cert, err := client.Certificate(deadline)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte("latex-renderer/keyless-connectivity-check/v1"))
	signer, ok := cert.PrivateKey.(crypto.Signer)
	if !ok {
		return fail()
	}
	if _, err = signer.Sign(rand.Reader, digest[:], crypto.SHA256); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"keylessReady": true, "installationId": client.InstallationID()})
}
