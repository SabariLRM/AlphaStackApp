package main

import (
	"bytes"
	"encoding/base64"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/jhillyerd/enmime/v2"
)

type Mailbox struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type Attachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	ContentID   string `json:"contentId,omitempty"`
	Inline      bool   `json:"inline"`
	Data        string `json:"data"`
}

type Message struct {
	MessageID   string       `json:"messageId,omitempty"`
	InReplyTo   string       `json:"inReplyTo,omitempty"`
	References  []string     `json:"references"`
	From        *Mailbox     `json:"from,omitempty"`
	To          []Mailbox    `json:"to"`
	Cc          []Mailbox    `json:"cc"`
	Subject     string       `json:"subject"`
	Date        string       `json:"date,omitempty"`
	Text        string       `json:"text"`
	HTML        string       `json:"html"`
	Size        int          `json:"size"`
	Attachments []Attachment `json:"attachments"`
}

type Envelope struct {
	MailFrom   string   `json:"mailFrom"`
	RcptTo     []string `json:"rcptTo"`
	RemoteAddr string   `json:"remoteAddr,omitempty"`
	Helo       string   `json:"helo,omitempty"`
}

type DeliverRequest struct {
	Envelope Envelope `json:"envelope"`
	Message  Message  `json:"message"`
}

var msgIDRe = regexp.MustCompile(`<[^<>\s]+>`)

func mailboxes(list []*mail.Address) []Mailbox {
	out := make([]Mailbox, 0, len(list))
	for _, a := range list {
		if a == nil || a.Address == "" {
			continue
		}
		out = append(out, Mailbox{Name: strings.TrimSpace(a.Name), Address: strings.ToLower(strings.TrimSpace(a.Address))})
	}
	return out
}

func addressList(env *enmime.Envelope, header string) []Mailbox {
	list, err := env.AddressList(header)
	if err != nil {
		return []Mailbox{}
	}
	return mailboxes(list)
}

func toAttachment(p *enmime.Part, inline bool) Attachment {
	return Attachment{
		Filename:    p.FileName,
		ContentType: p.ContentType,
		ContentID:   strings.Trim(p.ContentID, "<>"),
		Inline:      inline,
		Data:        base64.StdEncoding.EncodeToString(p.Content),
	}
}

// ParseMessage turns raw RFC 5322 bytes into the JSON shape the API expects.
func ParseMessage(raw []byte) (*Message, error) {
	env, err := enmime.ReadEnvelope(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	msg := &Message{
		References:  msgIDRe.FindAllString(env.GetHeader("References"), -1),
		To:          addressList(env, "To"),
		Cc:          addressList(env, "Cc"),
		Subject:     strings.TrimSpace(env.GetHeader("Subject")),
		Text:        env.Text,
		HTML:        env.HTML,
		Size:        len(raw),
		Attachments: []Attachment{},
	}
	if msg.References == nil {
		msg.References = []string{}
	}
	if id := msgIDRe.FindString(env.GetHeader("Message-ID")); id != "" {
		msg.MessageID = id
	}
	if id := msgIDRe.FindString(env.GetHeader("In-Reply-To")); id != "" {
		msg.InReplyTo = id
	}
	if from := addressList(env, "From"); len(from) > 0 {
		msg.From = &from[0]
	}
	if d, err := env.Date(); err == nil {
		msg.Date = d.UTC().Format(time.RFC3339)
	}
	for _, p := range env.Attachments {
		msg.Attachments = append(msg.Attachments, toAttachment(p, false))
	}
	for _, p := range env.Inlines {
		msg.Attachments = append(msg.Attachments, toAttachment(p, true))
	}
	// Parts of multipart/related (e.g. images referenced by cid:) without a disposition.
	for _, p := range env.OtherParts {
		if p.ContentID == "" && p.FileName == "" {
			continue
		}
		msg.Attachments = append(msg.Attachments, toAttachment(p, p.ContentID != ""))
	}
	return msg, nil
}
