// Command mailserver is PhoneMail's inbound SMTP server (MX).
//
// It accepts mail addressed to the PhoneMail domain, validates recipients against the API while the
// SMTP conversation is still open (so unknown users are rejected, not bounced later), parses MIME,
// and hands the message to the API for delivery into mailboxes.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/emersion/go-smtp"
)

func healthcheck(listen string) int {
	addr := listen
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 3)
	if _, err := conn.Read(buf); err != nil || string(buf) != "220" {
		fmt.Fprintln(os.Stderr, "unexpected banner")
		return 1
	}
	_, _ = conn.Write([]byte("QUIT\r\n"))
	return 0
}

func newServer(cfg Config, log *slog.Logger) *smtp.Server {
	s := smtp.NewServer(NewBackend(cfg, NewAPIClient(cfg.APIURL, cfg.InternalToken), log))
	s.Addr = cfg.Listen
	s.Domain = cfg.Hostname
	s.MaxMessageBytes = cfg.MaxMessageBytes
	s.MaxRecipients = cfg.MaxRecipients
	s.ReadTimeout = 2 * time.Minute
	s.WriteTimeout = 2 * time.Minute
	return s
}

func main() {
	check := flag.Bool("healthcheck", false, "check that the SMTP server answers and exit")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if *check {
		os.Exit(healthcheck(env("SMTP_LISTEN", ":2525")))
	}

	cfg, err := loadConfig()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}
	server := newServer(cfg, log)

	errCh := make(chan error, 1)
	go func() {
		log.Info("SMTP server listening", "addr", cfg.Listen, "domain", cfg.MailDomain, "api", cfg.APIURL)
		errCh <- server.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	select {
	case sig := <-stop:
		log.Info("shutting down", "signal", sig.String())
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	case err := <-errCh:
		if err != nil && !errors.Is(err, smtp.ErrServerClosed) {
			log.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}
}
