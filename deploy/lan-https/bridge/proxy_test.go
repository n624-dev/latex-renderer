package lanbridge

import (
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"
	"time"
)

func TestProxyKeepsAuthenticationAndOverwritesUntrustedPeerHeaders(t *testing.T) {
	var received struct {
		Host    string
		Headers http.Header
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(struct {
			Host    string
			Headers http.Header
		}{r.Host, r.Header})
	}))
	defer backend.Close()
	upstream, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewLoopbackProxy(browserName, upstream, []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")})
	if err != nil {
		t.Fatal(err)
	}
	f := fixture(t, []string{browserName, managementName})
	m := manager(t, f.roots, nil)
	if err := m.LoadBundle(f.bundle); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.TLS = m.TLSConfig()
	server.StartTLS()
	defer server.Close()
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: f.roots, ServerName: browserName, MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	request, err := http.NewRequest("GET", server.URL+"/api/v1/jobs", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = browserName
	for _, name := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", "CF-Access-Jwt-Assertion", "X-Latex-Renderer-Lan-Peer", "X-Latex-Renderer-Client-IP"} {
		request.Header.Set(name, "spoofed")
	}
	request.Header.Set("Authorization", "Bearer fixture-only")
	request.Header.Set("Cookie", "session=fixture-only")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("status %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 32768)).Decode(&received); err != nil {
		t.Fatal(err)
	}
	if received.Host != browserName || received.Headers.Get("X-Latex-Renderer-Lan-Peer") != "127.0.0.1" || received.Headers.Get("X-Forwarded-For") != "127.0.0.1" || received.Headers.Get("X-Forwarded-Proto") != "https" {
		t.Fatal("Proxy peer/origin was not replaced")
	}
	if received.Headers.Get("CF-Access-Jwt-Assertion") != "" || received.Headers.Get("Forwarded") != "" || received.Headers.Get("X-Real-IP") != "" || received.Headers.Get("X-Latex-Renderer-Client-IP") != "" {
		t.Fatal("Untrusted forwarding header retained")
	}
	if received.Headers.Get("Authorization") != "Bearer fixture-only" || received.Headers.Get("Cookie") != "session=fixture-only" {
		t.Fatal("Authentication was lost")
	}
}
func TestProxyRejectsPlaintextWrongHostAndOutsideNetworks(t *testing.T) {
	target, _ := url.Parse("http://127.0.0.1:3180")
	handler, err := NewLoopbackProxy(browserName, target, []netip.Prefix{netip.MustParsePrefix("192.168.1.0/24")})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		tls        bool
		host, peer string
		status     int
	}{{false, browserName, "192.168.1.2:1234", 421}, {true, "other.example.test", "192.168.1.2:1234", 421}, {true, browserName, "8.8.8.8:1234", 403}} {
		r := httptest.NewRequest("GET", "http://"+browserName+"/", nil)
		r.Host = test.host
		r.RemoteAddr = test.peer
		if test.tls {
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("status %d, want %d", w.Code, test.status)
		}
	}
	for _, value := range []string{"http://example.test:80", "https://127.0.0.1:443", "http://127.0.0.1", "http://127.0.0.1:3180/path", "http://user:pass@127.0.0.1:3180"} {
		u, _ := url.Parse(value)
		if _, err := NewLoopbackProxy(browserName, u, []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}); err == nil {
			t.Fatalf("Accepted upstream %s", value)
		}
	}
	for _, prefix := range []string{"0.0.0.0/0", "192.0.0.0/8", "8.8.8.0/24", "::/0", "::ffff:127.0.0.1/128", "192.168.1.1/24"} {
		if _, err := NewLoopbackProxy(browserName, target, []netip.Prefix{netip.MustParsePrefix(prefix)}); err == nil {
			t.Fatalf("Accepted ACL %s", prefix)
		}
	}
}
func TestListenerRejectsOutsidePeerBeforeTLS(t *testing.T) {
	raw, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	guarded, err := GuardListener(raw, []netip.Prefix{netip.MustParsePrefix("192.168.1.0/24")}, 2)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := guarded.Accept()
		if err == nil {
			_ = conn.Close()
			t.Error("Accepted outside peer")
		}
	}()
	client, err := net.DialTimeout("tcp", raw.Addr().String(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = client.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := client.Read(make([]byte, 1)); err == nil {
		t.Error("Outside connection was not closed")
	}
	_ = client.Close()
	_ = guarded.Close()
	<-done
}
