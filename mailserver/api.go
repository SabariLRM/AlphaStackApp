package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// APIClient talks to the PhoneMail API's internal endpoints.
type APIClient struct {
	base  string
	token string
	http  *http.Client
}

// APIError is a non-2xx answer from the API.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string { return fmt.Sprintf("api %d %s: %s", e.Status, e.Code, e.Message) }

// ErrUnknownRecipient means the address has no mailbox.
var ErrUnknownRecipient = errors.New("unknown recipient")

func NewAPIClient(base, token string) *APIClient {
	return &APIClient{base: base, token: token, http: &http.Client{Timeout: 60 * time.Second}}
}

func (c *APIClient) post(ctx context.Context, path string, body any) (*http.Response, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", c.token)
	return c.http.Do(req)
}

func decodeError(res *http.Response) error {
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
	_ = json.Unmarshal(raw, &payload)
	return &APIError{Status: res.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
}

// CheckRecipient reports whether address is a deliverable local mailbox.
func (c *APIClient) CheckRecipient(ctx context.Context, address string) error {
	res, err := c.post(ctx, "/internal/smtp/rcpt", map[string]string{"address": address})
	if err != nil {
		return err
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusOK:
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	case res.StatusCode == http.StatusNotFound:
		return ErrUnknownRecipient
	default:
		return decodeError(res)
	}
}

// Deliver hands a parsed message to the API, which files it into the recipients' mailboxes.
func (c *APIClient) Deliver(ctx context.Context, payload *DeliverRequest) error {
	res, err := c.post(ctx, "/internal/smtp/deliver", payload)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		_, _ = io.Copy(io.Discard, res.Body)
		return nil
	}
	return decodeError(res)
}
