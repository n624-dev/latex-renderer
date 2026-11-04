package lanbridge

import (
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

func checkedNetworks(networks []netip.Prefix) ([]netip.Prefix, error) {
	if len(networks) < 1 || len(networks) > 32 {
		return nil, errors.New("Explicit LAN networks are required")
	}
	bases := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12"), netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("::1/128")}
	checked := make([]netip.Prefix, len(networks))
	for i, prefix := range networks {
		valid := false
		for _, base := range bases {
			if prefix.IsValid() && !prefix.Addr().Is4In6() && prefix == prefix.Masked() && prefix.Bits() >= base.Bits() && base.Contains(prefix.Addr()) {
				valid = true
				break
			}
		}
		if !valid {
			return nil, errors.New("LAN network must be an explicit private or loopback prefix")
		}
		checked[i] = prefix
	}
	return checked, nil
}
func allowedPeer(address string, networks []netip.Prefix) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return netip.Addr{}, false
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	ip = ip.Unmap()
	for _, prefix := range networks {
		if prefix.Contains(ip) {
			return ip, true
		}
	}
	return ip, false
}

// NewLoopbackProxy forwards only into the existing route-filtering ingress.
// That ingress must trust X-Latex-Renderer-Lan-Peer solely from this loopback
// boundary. Public/Admin route decisions stay in the existing ingress config.
func NewLoopbackProxy(publicHost string, upstream *url.URL, networks []netip.Prefix) (http.Handler, error) {
	checked, err := checkedNetworks(networks)
	if err != nil {
		return nil, err
	}
	publicURL, parseError := url.Parse("https://" + publicHost)
	if parseError != nil || publicURL.Host != publicHost || !validHostname(publicURL.Hostname()) || publicURL.User != nil || publicURL.Path != "" || publicURL.RawQuery != "" || publicURL.Fragment != "" {
		return nil, errors.New("Invalid LAN public host")
	}
	if publicURL.Port() != "" {
		port, err := strconv.Atoi(publicURL.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, errors.New("Invalid LAN public port")
		}
	}
	if upstream == nil || upstream.Scheme != "http" || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" || upstream.Opaque != "" || (upstream.Path != "" && upstream.Path != "/") || upstream.RawPath != "" {
		return nil, errors.New("LAN upstream must be an exact loopback HTTP origin")
	}
	ip, err := netip.ParseAddr(upstream.Hostname())
	if err != nil || !ip.IsLoopback() || ip.Is4In6() {
		return nil, errors.New("LAN upstream must use a numeric loopback address")
	}
	port, err := strconv.Atoi(upstream.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, errors.New("Explicit loopback port required")
	}
	target := *upstream
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 16, MaxIdleConns: 4, MaxIdleConnsPerHost: 4, IdleConnTimeout: 15 * time.Second, ResponseHeaderTimeout: 120 * time.Second,
		DialContext: (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 15 * time.Second}).DialContext}
	proxy := &httputil.ReverseProxy{Transport: transport, FlushInterval: -1, ErrorLog: log.New(io.Discard, "", 0),
		Rewrite: func(r *httputil.ProxyRequest) {
			for name := range r.Out.Header {
				lower := strings.ToLower(name)
				if lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") || strings.HasPrefix(lower, "cf-") || lower == "true-client-ip" || lower == "x-real-ip" || strings.HasPrefix(lower, "x-latex-renderer-") {
					r.Out.Header.Del(name)
				}
			}
			r.SetURL(&target)
			r.Out.Host = publicHost
			r.SetXForwarded()
			ip, _ := allowedPeer(r.In.RemoteAddr, checked)
			r.Out.Header.Set("X-Latex-Renderer-Lan-Peer", ip.String())
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			http.Error(w, "LAN upstream unavailable", http.StatusBadGateway)
		}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || r.Host != publicHost {
			http.Error(w, "LAN HTTPS origin mismatch", http.StatusMisdirectedRequest)
			return
		}
		if _, ok := allowedPeer(r.RemoteAddr, checked); !ok {
			http.Error(w, "LAN peer denied", http.StatusForbidden)
			return
		}
		proxy.ServeHTTP(w, r)
	}), nil
}

type guardedListener struct {
	net.Listener
	networks []netip.Prefix
	gate     chan struct{}
}
type guardedConnection struct {
	net.Conn
	once    sync.Once
	release func()
}

func (c *guardedConnection) Close() error { err := c.Conn.Close(); c.once.Do(c.release); return err }
func (l *guardedListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		if _, ok := allowedPeer(conn.RemoteAddr().String(), l.networks); !ok {
			_ = conn.Close()
			continue
		}
		select {
		case l.gate <- struct{}{}:
			return &guardedConnection{Conn: conn, release: func() { <-l.gate }}, nil
		default:
			_ = conn.Close()
		}
	}
}

// GuardListener enforces the peer ACL and connection budget before TLS work.
func GuardListener(listener net.Listener, networks []netip.Prefix, maxConnections int) (net.Listener, error) {
	checked, err := checkedNetworks(networks)
	if err != nil {
		return nil, err
	}
	if listener == nil || maxConnections < 1 || maxConnections > 128 {
		return nil, errors.New("Invalid LAN connection budget")
	}
	return &guardedListener{Listener: listener, networks: checked, gate: make(chan struct{}, maxConnections)}, nil
}
