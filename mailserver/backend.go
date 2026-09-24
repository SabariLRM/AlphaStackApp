package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/emersion/go-smtp"
)

// Backend implements an inbound-only MX: it accepts mail for the local domain and hands it to the API.
type Backend struct {
	cfg Config
	api *APIClient
	log *slog.Logger
}

func NewBackend(cfg Config, api *APIClient, log *slog.Logger) *Backend {
	return &Backend{cfg: cfg, api: api, log: log}
}

func (b *Backend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	remote := ""
	if conn := c.Conn(); conn != nil {
		remote = conn.RemoteAddr().String()
	}
	return &Session{b: b, remote: remote, helo: c.Hostname()}, nil
}

type Session struct {
	b      *Backend
	remote string
	helo   string
	from   string
	rcpts  []string
}

var (
	errSpoofed = &smtp.SMTPError{Code: 550, EnhancedCode: smtp.EnhancedCode{5, 7, 1}, Message: "Sender address rejected: local addresses must send through PhoneMail"}
	errRelay   = &smtp.SMTPError{Code: 550, EnhancedCode: smtp.EnhancedCode{5, 7, 1}, Message: "Relay access denied"}
	errUnknown = &smtp.SMTPError{Code: 550, EnhancedCode: smtp.EnhancedCode{5, 1, 1}, Message: "Recipient address rejected: no such PhoneMail user"}
	errBadAddr = &smtp.SMTPError{Code: 553, EnhancedCode: smtp.EnhancedCode{5, 1, 3}, Message: "Invalid address"}
	errTempAPI = &smtp.SMTPError{Code: 451, EnhancedCode: smtp.EnhancedCode{4, 3, 0}, Message: "Temporary local problem, please try again later"}
)

func domainOf(address string) string {
	at := strings.LastIndexByte(address, '@')
	if at < 0 {
		return ""
	}
	return strings.ToLower(address[at+1:])
}

func (s *Session) isLocal(address string) bool {
	return domainOf(address) == s.b.cfg.MailDomain
}

func (s *Session) Mail(from string, _ *smtp.MailOptions) error {
	from = strings.TrimSpace(from)
	if from != "" {
		if _, err := mail.ParseAddress(from); err != nil {
			return errBadAddr
		}
		if s.isLocal(from) {
			return errSpoofed
		}
	}
	s.from = strings.ToLower(from)
	return nil
}

func (s *Session) Rcpt(to string, _ *smtp.RcptOptions) error {
	addr, err := mail.ParseAddress(strings.TrimSpace(to))
	if err != nil {
		return errBadAddr
	}
	address := strings.ToLower(addr.Address)
	if !s.isLocal(address) {
		return errRelay
	}
	for _, r := range s.rcpts {
		if r == address {
			return nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch err := s.b.api.CheckRecipient(ctx, address); {
	case err == nil:
		s.rcpts = append(s.rcpts, address)
		return nil
	case errors.Is(err, ErrUnknownRecipient):
		return errUnknown
	default:
		s.b.log.Error("recipient check failed", "rcpt", address, "err", err)
		return errTempAPI
	}
}

func (s *Session) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		// go-smtp returns ErrDataTooLarge as an *SMTPError (552) when the size limit is hit.
		return err
	}
	msg, err := ParseMessage(raw)
	if err != nil {
		s.b.log.Warn("unparseable message", "remote", s.remote, "err", err)
		return &smtp.SMTPError{Code: 554, EnhancedCode: smtp.EnhancedCode{5, 6, 0}, Message: "Message could not be parsed"}
	}
	if msg.From != nil && s.isLocal(msg.From.Address) {
		return errSpoofed
	}
	req := &DeliverRequest{
		Envelope: Envelope{MailFrom: s.from, RcptTo: s.rcpts, RemoteAddr: s.remote, Helo: s.helo},
		Message:  *msg,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := s.b.api.Deliver(ctx, req); err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status >= 400 && apiErr.Status < 500 && apiErr.Status != 408 && apiErr.Status != 429 {
			s.b.log.Warn("message rejected by API", "remote", s.remote, "status", apiErr.Status, "code", apiErr.Code)
			return &smtp.SMTPError{Code: 554, EnhancedCode: smtp.EnhancedCode{5, 7, 1}, Message: "Message rejected: " + apiErr.Message}
		}
		s.b.log.Error("delivery to API failed", "err", err)
		return errTempAPI
	}
	s.b.log.Info("message accepted", "from", s.from, "rcpts", len(s.rcpts), "bytes", len(raw), "remote", s.remote)
	return nil
}

func (s *Session) Reset() {
	s.from = ""
	s.rcpts = nil
}

func (s *Session) Logout() error { return nil }
