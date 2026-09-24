package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config is read from environment variables (see docker-compose.yml).
type Config struct {
	Listen          string
	Hostname        string
	MailDomain      string
	APIURL          string
	InternalToken   string
	MaxMessageBytes int64
	MaxRecipients   int
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func loadConfig() (Config, error) {
	cfg := Config{
		Listen:        env("SMTP_LISTEN", ":2525"),
		Hostname:      env("SMTP_HOSTNAME", "mx.phonemail.com"),
		MailDomain:    strings.ToLower(env("MAIL_DOMAIN", "phonemail.com")),
		APIURL:        strings.TrimRight(env("API_URL", "http://localhost:3000"), "/"),
		InternalToken: env("INTERNAL_API_TOKEN", ""),
		MaxRecipients: 50,
	}
	maxBytes, err := strconv.ParseInt(env("SMTP_MAX_MESSAGE_BYTES", "31457280"), 10, 64)
	if err != nil || maxBytes <= 0 {
		return cfg, fmt.Errorf("invalid SMTP_MAX_MESSAGE_BYTES")
	}
	cfg.MaxMessageBytes = maxBytes
	if cfg.InternalToken == "" {
		return cfg, fmt.Errorf("INTERNAL_API_TOKEN is required")
	}
	return cfg, nil
}
