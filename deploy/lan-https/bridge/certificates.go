// Package lanbridge supplies the LAN TLS boundary. It does not start listeners,
// register accounts or fall back to plaintext when certificate selection fails.
package lanbridge

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"strings"
	"sync"
	"time"
)

var errCertificate = errors.New("LAN HTTPS certificate unavailable")

// DigestSigner receives a SHA-256 digest, not a message to hash a second time.
// An implementation must authenticate its bounded HTTPS request to the signer.
type DigestSigner func(context.Context, []byte) ([]byte, error)

type remoteSigner struct {
	key  *ecdsa.PublicKey
	sign DigestSigner
}

func (s *remoteSigner) Public() crypto.PublicKey { return s.key }
func (s *remoteSigner) Sign(_ io.Reader, digest []byte, options crypto.SignerOpts) ([]byte, error) {
	if options == nil || options.HashFunc() != crypto.SHA256 || len(digest) != 32 {
		return nil, errCertificate
	}
	// crypto.Signer has no per-call context; the configured transport has its own
	// deadline. Copy the digest so a transport cannot mutate the caller's bytes.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	signature, err := s.sign(ctx, append([]byte(nil), digest...))
	if err != nil || len(signature) > 72 || !ecdsa.VerifyASN1(s.key, digest, signature) {
		return nil, errCertificate
	}
	return signature, nil
}

func verifyChain(cert *tls.Certificate, hostname string, roots *x509.CertPool, now time.Time) (*x509.Certificate, error) {
	if len(cert.Certificate) == 0 || len(cert.Certificate) > 16 {
		return nil, errCertificate
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil || leaf.IsCA {
		return nil, errCertificate
	}
	intermediate := x509.NewCertPool()
	for _, raw := range cert.Certificate[1:] {
		value, err := x509.ParseCertificate(raw)
		if err != nil {
			return nil, errCertificate
		}
		intermediate.AddCert(value)
	}
	_, err = leaf.Verify(x509.VerifyOptions{DNSName: hostname, Roots: roots, Intermediates: intermediate,
		CurrentTime: now, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}})
	if err != nil {
		return nil, errCertificate
	}
	return leaf, nil
}

// RemoteCertificate validates the public chain against ordinary platform trust
// before installing a signer. No shared TLS private key is received by the LAN
// host. All signing responses are verified locally against this leaf's key.
func RemoteCertificate(chain [][]byte, hostname string, roots *x509.CertPool, sign DigestSigner, now time.Time) (*tls.Certificate, error) {
	if sign == nil || len(chain) == 0 || len(chain) > 16 {
		return nil, errCertificate
	}
	total := 0
	for _, value := range chain {
		total += len(value)
		if len(value) == 0 || total > 512*1024 {
			return nil, errCertificate
		}
	}
	copied := make([][]byte, len(chain))
	for i, value := range chain {
		copied[i] = append([]byte(nil), value...)
	}
	cert := &tls.Certificate{Certificate: copied}
	leaf, err := verifyChain(cert, hostname, roots, now)
	if err != nil {
		return nil, err
	}
	key, ok := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errCertificate
	}
	cert.Leaf = leaf
	cert.PrivateKey = &remoteSigner{key: key, sign: sign}
	cert.SupportedSignatureAlgorithms = []tls.SignatureScheme{tls.ECDSAWithP256AndSHA256}
	return cert, nil
}

type FallbackCertificate func(context.Context) (*tls.Certificate, error)

// CertificateManager keeps the last fully validated local bundle in memory.
// Reload happens outside handshakes; an issuer outage cannot add a network or
// disk dependency to a fresh handshake with a valid local certificate.
type CertificateManager struct {
	mu             sync.RWMutex
	hostname       string
	managementName string
	roots          *x509.CertPool
	now            func() time.Time
	local          *tls.Certificate
	fallback       FallbackCertificate
	fallbackGate   chan struct{}
}

func validHostname(hostname string) bool {
	if len(hostname) == 0 || len(hostname) > 253 {
		return false
	}
	for _, label := range strings.Split(hostname, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if !(character >= 'a' && character <= 'z') && !(character >= '0' && character <= '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func NewCertificateManager(hostname, managementName string, roots *x509.CertPool, fallback FallbackCertificate) (*CertificateManager, error) {
	if !validHostname(hostname) || !validHostname(managementName) || hostname == managementName {
		return nil, errCertificate
	}
	return &CertificateManager{hostname: hostname, managementName: managementName, roots: roots,
		now: time.Now, fallback: fallback, fallbackGate: make(chan struct{}, 1)}, nil
}

func (m *CertificateManager) LoadBundle(bundle []byte) error {
	if len(bundle) == 0 || len(bundle) > 528*1024 {
		return errCertificate
	}
	cert, err := tls.X509KeyPair(bundle, bundle)
	if err != nil {
		return errCertificate
	}
	leaf, err := verifyChain(&cert, m.hostname, m.roots, m.now())
	if err != nil {
		return err
	}
	// Local certificates cover exactly the browser and installation management
	// names. A wildcard/shared certificate belongs only to the optional fallback.
	if len(leaf.DNSNames) != 2 || len(leaf.IPAddresses) != 0 || len(leaf.EmailAddresses) != 0 || len(leaf.URIs) != 0 ||
		!((leaf.DNSNames[0] == m.hostname && leaf.DNSNames[1] == m.managementName) ||
			(leaf.DNSNames[1] == m.hostname && leaf.DNSNames[0] == m.managementName)) {
		return errCertificate
	}
	key, ok := cert.PrivateKey.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return errCertificate
	}
	cert.Leaf = leaf
	cert.SupportedSignatureAlgorithms = []tls.SignatureScheme{tls.ECDSAWithP256AndSHA256}
	m.mu.Lock()
	m.local = &cert
	m.mu.Unlock()
	return nil
}

func (m *CertificateManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	if hello == nil || hello.ServerName != m.hostname {
		return nil, errCertificate
	}
	m.mu.RLock()
	cert := m.local
	m.mu.RUnlock()
	now := m.now()
	if cert != nil && !now.Before(cert.Leaf.NotBefore) && now.Before(cert.Leaf.NotAfter) {
		return cert, nil
	}
	if m.fallback == nil {
		return nil, errCertificate
	}
	// Bound fallback enrollment/fetch work. Concurrent handshakes are rejected
	// instead of queueing an unbounded set of external requests.
	select {
	case m.fallbackGate <- struct{}{}:
	default:
		return nil, errCertificate
	}
	defer func() { <-m.fallbackGate }()
	parent := hello.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	fallback, err := m.fallback(ctx)
	if err != nil || fallback == nil {
		return nil, errCertificate
	}
	leaf, err := verifyChain(fallback, m.hostname, m.roots, now)
	if err != nil {
		return nil, errCertificate
	}
	signer, ok := fallback.PrivateKey.(*remoteSigner)
	key, isECDSA := leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok || !isECDSA || !key.Equal(signer.Public()) {
		return nil, errCertificate
	}
	return fallback, nil
}

func (m *CertificateManager) TLSConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: m.GetCertificate,
		NextProtos: []string{"http/1.1"}}
}
