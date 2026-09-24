package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeAPI struct {
	mu        sync.Mutex
	users     map[string]bool
	delivered []DeliverRequest
	failWith  int
}

func (f *fakeAPI) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Internal-Token") != "secret" {
			w.WriteHeader(401)
			return
		}
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		defer f.mu.Unlock()
		switch r.URL.Path {
		case "/internal/smtp/rcpt":
			var p struct{ Address string }
			_ = json.Unmarshal(body, &p)
			if !f.users[p.Address] {
				w.WriteHeader(404)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/internal/smtp/deliver":
			if f.failWith != 0 {
				w.WriteHeader(f.failWith)
				_, _ = w.Write([]byte(`{"error":{"code":"x","message":"nope"}}`))
				return
			}
			var req DeliverRequest
			if err := json.Unmarshal(body, &req); err != nil {
				t.Errorf("bad json: %v", err)
			}
			f.delivered = append(f.delivered, req)
			_, _ = w.Write([]byte(`{"delivered":1}`))
		default:
			w.WriteHeader(404)
		}
	})
}

func startTestServer(t *testing.T, api *fakeAPI) string {
	t.Helper()
	ts := httptest.NewServer(api.handler(t))
	t.Cleanup(ts.Close)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Listen: ln.Addr().String(), Hostname: "mx.test", MailDomain: "phonemail.com", APIURL: ts.URL, InternalToken: "secret", MaxMessageBytes: 1 << 20, MaxRecipients: 10}
	srv := newServer(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return ln.Addr().String()
}

func TestDeliversToKnownRecipients(t *testing.T) {
	api := &fakeAPI{users: map[string]bool{"9876543210@phonemail.com": true}}
	addr := startTestServer(t, api)
	msg := "From: Alice <alice@example.org>\r\nTo: 9876543210@phonemail.com\r\nSubject: Hi\r\n\r\nHello there\r\n"
	if err := smtp.SendMail(addr, nil, "alice@example.org", []string{"9876543210@PhoneMail.com"}, []byte(msg)); err != nil {
		t.Fatal(err)
	}
	api.mu.Lock()
	defer api.mu.Unlock()
	if len(api.delivered) != 1 {
		t.Fatalf("delivered %d", len(api.delivered))
	}
	d := api.delivered[0]
	if d.Envelope.MailFrom != "alice@example.org" || len(d.Envelope.RcptTo) != 1 || d.Envelope.RcptTo[0] != "9876543210@phonemail.com" {
		t.Fatalf("envelope %+v", d.Envelope)
	}
	if d.Message.Subject != "Hi" || !strings.Contains(d.Message.Text, "Hello there") {
		t.Fatalf("message %+v", d.Message)
	}
}

func expectSMTPError(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), code) {
		t.Fatalf("expected %s error, got %v", code, err)
	}
}

func TestRejectsUnknownRelayAndSpoofing(t *testing.T) {
	api := &fakeAPI{users: map[string]bool{"9876543210@phonemail.com": true}}
	addr := startTestServer(t, api)
	body := []byte("Subject: x\r\n\r\nx\r\n")
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"nobody@phonemail.com"}, body), "550")
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"someone@gmail.com"}, body), "Relay access denied")
	expectSMTPError(t, smtp.SendMail(addr, nil, "9876543210@phonemail.com", []string{"9876543210@phonemail.com"}, body), "550")
	spoofHeader := []byte("From: 9876543210@phonemail.com\r\nSubject: x\r\n\r\nx\r\n")
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"9876543210@phonemail.com"}, spoofHeader), "550")
	if len(api.delivered) != 0 {
		t.Fatalf("nothing should be delivered, got %d", len(api.delivered))
	}
}

func TestAPIFailuresMapToSMTPCodes(t *testing.T) {
	api := &fakeAPI{users: map[string]bool{"1@phonemail.com": true}, failWith: 500}
	addr := startTestServer(t, api)
	body := []byte("From: a@example.org\r\nSubject: x\r\n\r\nx\r\n")
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"1@phonemail.com"}, body), "451")
	api.mu.Lock()
	api.failWith = 422
	api.mu.Unlock()
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"1@phonemail.com"}, body), "554")
}

func TestRejectsOversizedMessages(t *testing.T) {
	api := &fakeAPI{users: map[string]bool{"1@phonemail.com": true}}
	addr := startTestServer(t, api)
	big := "From: a@example.org\r\nSubject: big\r\n\r\n" + strings.Repeat(strings.Repeat("x", 998)+"\r\n", 1100)
	expectSMTPError(t, smtp.SendMail(addr, nil, "a@example.org", []string{"1@phonemail.com"}, []byte(big)), "552")
}

func TestHealthcheck(t *testing.T) {
	addr := startTestServer(t, &fakeAPI{users: map[string]bool{}})
	time.Sleep(50 * time.Millisecond)
	if healthcheck(addr) != 0 {
		t.Fatal("healthcheck failed")
	}
}
