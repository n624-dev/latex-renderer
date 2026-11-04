package lanbridge

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

const browserName = "192-168-1-50.lan.example.test"
const managementName = "i-example.instances.lan.example.test"

type certificateFixture struct {
	roots  *x509.CertPool
	bundle []byte
	chain  [][]byte
	key    *ecdsa.PrivateKey
}

func fixture(t *testing.T, names []string) certificateFixture {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	caTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Fixture CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: names, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leaf, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	bundle := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private})
	bundle = append(bundle, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf})...)
	bundle = append(bundle, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)
	roots := x509.NewCertPool()
	roots.AddCert(ca)
	return certificateFixture{roots: roots, bundle: bundle, chain: [][]byte{leaf, caDER}, key: key}
}
func manager(t *testing.T, roots *x509.CertPool, fallback FallbackCertificate) *CertificateManager {
	t.Helper()
	m, err := NewCertificateManager(browserName, managementName, roots, fallback)
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func serve(t *testing.T, m *CertificateManager) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }), ReadHeaderTimeout: 3 * time.Second, TLSConfig: m.TLSConfig()}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(tls.NewListener(listener, server.TLSConfig)) }()
	t.Cleanup(func() { _ = server.Close(); <-done })
	return listener.Addr().String()
}
func request(t *testing.T, address string, roots *x509.CertPool, name string, version uint16) error {
	t.Helper()
	transport := &http.Transport{DisableKeepAlives: true, TLSClientConfig: &tls.Config{RootCAs: roots, ServerName: name, MinVersion: version, MaxVersion: version, ClientSessionCache: nil}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	response, err := client.Get("https://" + address + "/")
	if err == nil {
		_ = response.Body.Close()
		if response.StatusCode != 204 {
			t.Fatalf("status %d", response.StatusCode)
		}
	}
	return err
}
func TestLocalCertificateWorksAcrossFreshHandshakesWithoutIssuer(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	var calls atomic.Int32
	m := manager(t, f.roots, func(context.Context) (*tls.Certificate, error) { calls.Add(1); return nil, errors.New("offline") })
	if err := m.LoadBundle(f.bundle); err != nil {
		t.Fatal(err)
	}
	address := serve(t, m)
	for _, version := range []uint16{tls.VersionTLS12, tls.VersionTLS13, tls.VersionTLS13} {
		if err := request(t, address, f.roots, browserName, version); err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("Valid local certificate contacted Keyless")
	}
	restarted := manager(t, f.roots, func(context.Context) (*tls.Certificate, error) {
		t.Error("startup contacted Keyless")
		return nil, errCertificate
	})
	if err := restarted.LoadBundle(f.bundle); err != nil {
		t.Fatal(err)
	}
	if err := request(t, serve(t, restarted), f.roots, browserName, tls.VersionTLS13); err != nil {
		t.Fatal(err)
	}
}
func TestKeylessSignsDigestExactlyOnceAndSupportsRealTLS(t *testing.T) {
	f := fixture(t, []string{"*.lan.example.test"})
	var signs atomic.Int32
	fallback := func(context.Context) (*tls.Certificate, error) {
		return RemoteCertificate(f.chain, browserName, f.roots, func(_ context.Context, digest []byte) ([]byte, error) {
			signs.Add(1)
			return ecdsa.SignASN1(rand.Reader, f.key, digest)
		}, time.Now())
	}
	address := serve(t, manager(t, f.roots, fallback))
	for _, version := range []uint16{tls.VersionTLS12, tls.VersionTLS13} {
		if err := request(t, address, f.roots, browserName, version); err != nil {
			t.Fatal(err)
		}
	}
	if signs.Load() != 2 {
		t.Fatalf("signature calls %d", signs.Load())
	}
}
func TestSignerRejectsWrongDigestSignatureAndHash(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	hash := sha256.Sum256([]byte("fixture TLS transcript"))
	badKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	s := &remoteSigner{key: &f.key.PublicKey, sign: func(_ context.Context, digest []byte) ([]byte, error) {
		return ecdsa.SignASN1(rand.Reader, badKey, digest)
	}}
	if _, err := s.Sign(rand.Reader, hash[:], crypto.SHA256); err == nil {
		t.Fatal("Accepted wrong key signature")
	}
	s.sign = func(_ context.Context, digest []byte) ([]byte, error) {
		double := sha256.Sum256(digest)
		return ecdsa.SignASN1(rand.Reader, f.key, double[:])
	}
	if _, err := s.Sign(rand.Reader, hash[:], crypto.SHA256); err == nil {
		t.Fatal("Accepted double-hashed signature")
	}
	if _, err := s.Sign(rand.Reader, hash[:], crypto.SHA384); err == nil {
		t.Fatal("Accepted different hash")
	}
	if _, err := s.Sign(rand.Reader, hash[:31], crypto.SHA256); err == nil {
		t.Fatal("Accepted short digest")
	}
}
func TestCertificateSelectionFailsClosed(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	m := manager(t, f.roots, nil)
	address := serve(t, m)
	if err := request(t, address, f.roots, browserName, tls.VersionTLS13); err == nil {
		t.Fatal("Accepted missing certificate")
	}
	if err := m.LoadBundle(f.bundle); err != nil {
		t.Fatal(err)
	}
	if err := request(t, address, f.roots, "another.lan.example.test", tls.VersionTLS13); err == nil {
		t.Fatal("Accepted another SNI")
	}
	if _, err := m.GetCertificate(&tls.ClientHelloInfo{}); err == nil {
		t.Fatal("Accepted empty SNI")
	}
	m.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if err := request(t, address, f.roots, browserName, tls.VersionTLS13); err == nil {
		t.Fatal("Served expired certificate without fallback")
	}
}
func TestInvalidReloadRetainsLastVerifiedLocalCertificate(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	m := manager(t, f.roots, nil)
	if err := m.LoadBundle(f.bundle); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadBundle([]byte("broken")); err == nil {
		t.Fatal("Accepted broken bundle")
	}
	if err := request(t, serve(t, m), f.roots, browserName, tls.VersionTLS13); err != nil {
		t.Fatal(err)
	}
	if err := manager(t, x509.NewCertPool(), nil).LoadBundle(f.bundle); err == nil {
		t.Fatal("Accepted untrusted CA")
	}
	wildcard := fixture(t, []string{"*.lan.example.test", managementName})
	if err := manager(t, wildcard.roots, nil).LoadBundle(wildcard.bundle); err == nil {
		t.Fatal("Accepted local wildcard")
	}
}
func TestConcurrentFallbackWorkIsBounded(t *testing.T) {
	f := fixture(t, []string{browserName, managementName})
	entered, release := make(chan struct{}), make(chan struct{})
	m := manager(t, f.roots, func(ctx context.Context) (*tls.Certificate, error) {
		close(entered)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil, errCertificate
	})
	done := make(chan struct{})
	go func() { defer close(done); _, _ = m.GetCertificate(&tls.ClientHelloInfo{ServerName: browserName}) }()
	<-entered
	if _, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: browserName}); err == nil {
		t.Error("Accepted concurrent fallback")
	}
	close(release)
	<-done
}
