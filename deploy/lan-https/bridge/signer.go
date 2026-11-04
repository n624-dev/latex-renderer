package lanbridge

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"sync"
	"time"
)

type signingBundle struct {
	key         *ecdsa.PrivateKey
	certificate string
	keyID       string
	expires     time.Time
}
type SignerServer struct {
	mu                sync.RWMutex
	domain            string
	roots             *x509.CertPool
	current, previous *signingBundle
	previousUntil     time.Time
	gate              chan struct{}
}

func NewSignerServer(domain string, roots *x509.CertPool) (*SignerServer, error) {
	if !validHostname(domain) {
		return nil, errCertificate
	}
	return &SignerServer{domain: domain, roots: roots, gate: make(chan struct{}, 4)}, nil
}
func (s *SignerServer) LoadBundle(bundle []byte) error {
	if len(bundle) == 0 || len(bundle) > 528*1024 {
		return errCertificate
	}
	cert, err := tls.X509KeyPair(bundle, bundle)
	if err != nil {
		return errCertificate
	}
	leaf, err := verifyChain(&cert, "keyless-check."+s.domain, s.roots, time.Now())
	if err != nil {
		return err
	}
	if len(leaf.DNSNames) != 1 || leaf.DNSNames[0] != "*."+s.domain || len(leaf.IPAddresses) != 0 || len(leaf.URIs) != 0 || len(leaf.EmailAddresses) != 0 {
		return errCertificate
	}
	key, ok := cert.PrivateKey.(*ecdsa.PrivateKey)
	if !ok || key.Curve.Params().Name != "P-256" {
		return errCertificate
	}
	public, err := x509.MarshalPKIXPublicKey(leaf.PublicKey)
	if err != nil {
		return errCertificate
	}
	digest := sha256.Sum256(public)
	chain := ""
	for _, raw := range cert.Certificate {
		chain += string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw}))
	}
	next := &signingBundle{key: key, certificate: chain, keyID: hex.EncodeToString(digest[:]), expires: leaf.NotAfter}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current != nil && s.current.keyID != next.keyID {
		s.previous = s.current
		s.previousUntil = time.Now().Add(2 * time.Minute)
	}
	s.current = next
	return nil
}
func (s *SignerServer) ReloadBundle(path string) error {
	data, err := ReadPrivateFile(path, 528*1024)
	if err != nil {
		return err
	}
	return s.LoadBundle(data)
}
func (s *SignerServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	if r.Host != "localhost" {
		http.Error(w, "rejected", 421)
		return
	}
	select {
	case s.gate <- struct{}{}:
	default:
		http.Error(w, "busy", 503)
		return
	}
	defer func() { <-s.gate }()
	s.mu.RLock()
	bundle := s.current
	previous, previousUntil := s.previous, s.previousUntil
	s.mu.RUnlock()
	if bundle == nil || !time.Now().Before(bundle.expires) {
		http.Error(w, "certificate unavailable", 503)
		return
	}
	if r.URL.RequestURI() == "/certificate" && r.Method == "GET" {
		_ = json.NewEncoder(w).Encode(struct {
			Certificate string `json:"certificate"`
			KeyID       string `json:"keyId"`
		}{bundle.certificate, bundle.keyID})
		return
	}
	if r.URL.RequestURI() != "/sign" || r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "rejected", 400)
		return
	}
	var input struct {
		KeyID  string `json:"keyId"`
		Digest string `json:"digest"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		http.Error(w, "rejected", 400)
		return
	}
	if input.KeyID != bundle.keyID {
		if previous == nil || input.KeyID != previous.keyID || !time.Now().Before(previousUntil) || !time.Now().Before(previous.expires) {
			http.Error(w, "key unavailable", 409)
			return
		}
		bundle = previous
	}
	digest, err := base64.RawURLEncoding.Strict().DecodeString(input.Digest)
	if err != nil || len(digest) != 32 {
		http.Error(w, "rejected", 400)
		return
	}
	signature, err := ecdsa.SignASN1(rand.Reader, bundle.key, digest)
	if err != nil {
		http.Error(w, "signing unavailable", 503)
		return
	}
	_ = json.NewEncoder(w).Encode(struct {
		Signature string `json:"signature"`
	}{base64.RawURLEncoding.EncodeToString(signature)})
}
