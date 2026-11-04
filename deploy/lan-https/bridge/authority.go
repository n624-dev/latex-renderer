package lanbridge

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var errAuthority = errors.New("LAN HTTPS authority request failed")

type authorityPublicKey struct {
	CRV string `json:"crv"`
	KTY string `json:"kty"`
	X   string `json:"x"`
}
type AuthorityClient struct {
	origin, domain, hostname, installationID string
	identity                                 ed25519.PrivateKey
	public                                   authorityPublicKey
	http                                     *http.Client
	roots                                    *x509.CertPool
	invitation                               string
	mu                                       sync.Mutex
	enrolled                                 bool
	cached                                   *tls.Certificate
	cachedUntil                              time.Time
}

func NewAuthorityClient(origin, domain, hostname string, identityPEM []byte, invitation string, roots *x509.CertPool) (*AuthorityClient, error) {
	endpoint, err := url.Parse(origin)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || origin != "https://"+endpoint.Host || endpoint.User != nil || endpoint.Path != "" || endpoint.RawQuery != "" || endpoint.Fragment != "" || endpoint.Hostname() == domain || strings.HasSuffix(endpoint.Hostname(), "."+domain) || !validHostname(domain) || !validHostname(hostname) || len(invitation) > 256 {
		return nil, errAuthority
	}
	block, rest := pem.Decode(identityPEM)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errAuthority
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errAuthority
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errAuthority
	}
	public := authorityPublicKey{"Ed25519", "OKP", base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))}
	canonical, _ := json.Marshal(public)
	digest := sha256.Sum256(canonical)
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 2, MaxIdleConns: 2, MaxIdleConnsPerHost: 2, IdleConnTimeout: 30 * time.Second,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 3 * time.Second}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errAuthority }}
	return &AuthorityClient{origin: origin, domain: domain, hostname: hostname, installationID: hex.EncodeToString(digest[:]), identity: key, public: public, http: client, roots: roots, invitation: invitation}, nil
}
func (c *AuthorityClient) InstallationID() string { return c.installationID }
func (c *AuthorityClient) request(ctx context.Context, path string, body []byte, proof string, result any) error {
	if len(body) > 65536 {
		return errAuthority
	}
	request, err := http.NewRequestWithContext(ctx, "POST", c.origin+path, bytes.NewReader(body))
	if err != nil {
		return errAuthority
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if proof != "" {
		request.Header.Set("X-Latex-Renderer-Lan-Proof", proof)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return errAuthority
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(data) > 65536 || response.StatusCode != 200 {
		return errAuthority
	}
	if json.Unmarshal(data, result) != nil {
		return errAuthority
	}
	return nil
}
func (c *AuthorityClient) signed(ctx context.Context, path string, value any, result any) error {
	var nonce struct {
		InstallationID string `json:"installationId"`
		Nonce          string `json:"nonce"`
		ExpiresAt      int64  `json:"expiresAt"`
	}
	nonceBody, _ := json.Marshal(struct {
		PublicKey authorityPublicKey `json:"publicKey"`
	}{c.public})
	if c.request(ctx, "/v1/nonce", nonceBody, "", &nonce) != nil || nonce.InstallationID != c.installationID {
		return errAuthority
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(nonce.Nonce)
	if err != nil || len(decoded) != 32 {
		return errAuthority
	}
	body, err := json.Marshal(value)
	if err != nil {
		return errAuthority
	}
	digest := sha256.Sum256(body)
	fields, _ := json.Marshal([]string{c.origin, "POST", path, nonce.Nonce, hex.EncodeToString(digest[:])})
	signature := ed25519.Sign(c.identity, append([]byte("latex-renderer/lan-https/request/v1\n"), fields...))
	proof, _ := json.Marshal(struct {
		InstallationID string `json:"installationId"`
		Nonce          string `json:"nonce"`
		Signature      string `json:"signature"`
	}{c.installationID, nonce.Nonce, base64.RawURLEncoding.EncodeToString(signature)})
	return c.request(ctx, path, body, base64.RawURLEncoding.EncodeToString(proof), result)
}
func (c *AuthorityClient) enroll(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.enrolled {
		return nil
	}
	value := map[string]any{"publicKey": c.public}
	if c.invitation != "" {
		value["invitationCode"] = c.invitation
	}
	var response struct {
		InstallationID string `json:"installationId"`
		Created        bool   `json:"created"`
	}
	if c.signed(ctx, "/v1/enroll", value, &response) != nil || response.InstallationID != c.installationID {
		return errAuthority
	}
	c.enrolled = true
	return nil
}
func (c *AuthorityClient) Certificate(ctx context.Context) (*tls.Certificate, error) {
	c.mu.Lock()
	cached, until := c.cached, c.cachedUntil
	c.mu.Unlock()
	if cached != nil && time.Now().Before(until) && time.Now().Before(cached.Leaf.NotAfter) {
		return cached, nil
	}
	if err := c.enroll(ctx); err != nil {
		return nil, err
	}
	var response struct {
		Certificate string `json:"certificate"`
		KeyID       string `json:"keyId"`
	}
	if c.signed(ctx, "/v1/keyless/certificate", map[string]string{"hostname": c.hostname}, &response) != nil || len(response.Certificate) > 60000 || len(response.KeyID) != 64 {
		return nil, errAuthority
	}
	chain := [][]byte{}
	rest := []byte(response.Certificate)
	for len(bytes.TrimSpace(rest)) > 0 {
		block, left := pem.Decode(rest)
		if block == nil || block.Type != "CERTIFICATE" || len(chain) >= 16 {
			return nil, errAuthority
		}
		chain = append(chain, block.Bytes)
		rest = left
	}
	if len(chain) == 0 {
		return nil, errAuthority
	}
	leaf, err := x509.ParseCertificate(chain[0])
	if err != nil || len(leaf.DNSNames) != 1 || leaf.DNSNames[0] != "*."+c.domain {
		return nil, errAuthority
	}
	public, err := x509.MarshalPKIXPublicKey(leaf.PublicKey)
	if err != nil {
		return nil, errAuthority
	}
	digest := sha256.Sum256(public)
	if hex.EncodeToString(digest[:]) != response.KeyID {
		return nil, errAuthority
	}
	certificate, err := RemoteCertificate(chain, c.hostname, c.roots, func(ctx context.Context, digest []byte) ([]byte, error) {
		var result struct {
			Signature string `json:"signature"`
		}
		if c.signed(ctx, "/v1/keyless/sign", map[string]string{"hostname": c.hostname, "keyId": response.KeyID, "digest": base64.RawURLEncoding.EncodeToString(digest)}, &result) != nil {
			c.mu.Lock()
			c.cached = nil
			c.mu.Unlock()
			return nil, errAuthority
		}
		decoded, err := base64.RawURLEncoding.Strict().DecodeString(result.Signature)
		if err != nil || len(decoded) > 72 || len(decoded) < 8 {
			return nil, errAuthority
		}
		return decoded, nil
	}, time.Now())
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.cached = certificate
	c.cachedUntil = time.Now().Add(time.Minute)
	c.mu.Unlock()
	return certificate, nil
}
