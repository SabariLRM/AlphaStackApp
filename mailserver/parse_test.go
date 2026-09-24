package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

const sampleMIME = "From: =?UTF-8?B?4K6a4K6/4K614K6+?= <Siva@Example.org>\r\n" +
	"To: 9876543210@phonemail.com, \"Bob\" <bob@phonemail.com>\r\n" +
	"Cc: carol@example.org\r\n" +
	"Subject: =?UTF-8?Q?Caf=C3=A9_plans?=\r\n" +
	"Date: Tue, 22 Sep 2026 10:00:00 +0530\r\n" +
	"Message-ID: <m1@example.org>\r\n" +
	"In-Reply-To: <m0@phonemail.com>\r\n" +
	"References: <a@x> <m0@phonemail.com>\r\n" +
	"MIME-Version: 1.0\r\n" +
	"Content-Type: multipart/mixed; boundary=outer\r\n" +
	"\r\n" +
	"--outer\r\n" +
	"Content-Type: multipart/related; boundary=rel\r\n" +
	"\r\n" +
	"--rel\r\n" +
	"Content-Type: text/html; charset=utf-8\r\n" +
	"\r\n" +
	"<p>Hello <img src=\"cid:logo@x\"></p>\r\n" +
	"--rel\r\n" +
	"Content-Type: image/png\r\n" +
	"Content-ID: <logo@x>\r\n" +
	"Content-Transfer-Encoding: base64\r\n" +
	"\r\n" +
	"iVBORw0KGgo=\r\n" +
	"--rel--\r\n" +
	"--outer\r\n" +
	"Content-Type: text/plain; name=notes.txt\r\n" +
	"Content-Disposition: attachment; filename=notes.txt\r\n" +
	"\r\n" +
	"attached notes\r\n" +
	"--outer--\r\n"

func TestParseMessage(t *testing.T) {
	msg, err := ParseMessage([]byte(sampleMIME))
	if err != nil {
		t.Fatal(err)
	}
	if msg.From == nil || msg.From.Address != "siva@example.org" || msg.From.Name != "சிவா" {
		t.Fatalf("unexpected from: %+v", msg.From)
	}
	if msg.Subject != "Café plans" {
		t.Fatalf("subject %q", msg.Subject)
	}
	if len(msg.To) != 2 || msg.To[1].Name != "Bob" || len(msg.Cc) != 1 {
		t.Fatalf("recipients: %+v %+v", msg.To, msg.Cc)
	}
	if msg.MessageID != "<m1@example.org>" || msg.InReplyTo != "<m0@phonemail.com>" || len(msg.References) != 2 {
		t.Fatalf("threading headers: %q %q %v", msg.MessageID, msg.InReplyTo, msg.References)
	}
	if msg.Date != "2026-09-22T04:30:00Z" {
		t.Fatalf("date %q", msg.Date)
	}
	if !strings.Contains(msg.HTML, "cid:logo@x") || !strings.Contains(msg.Text, "Hello") {
		t.Fatalf("bodies: %q / %q", msg.HTML, msg.Text)
	}
	var file, logo *Attachment
	for i := range msg.Attachments {
		switch msg.Attachments[i].Filename {
		case "notes.txt":
			file = &msg.Attachments[i]
		}
		if msg.Attachments[i].ContentID == "logo@x" {
			logo = &msg.Attachments[i]
		}
	}
	if file == nil || file.Inline {
		t.Fatalf("missing file attachment: %+v", msg.Attachments)
	}
	data, _ := base64.StdEncoding.DecodeString(file.Data)
	if strings.TrimSpace(string(data)) != "attached notes" {
		t.Fatalf("attachment data %q", data)
	}
	if logo == nil || !logo.Inline {
		t.Fatalf("missing inline image: %+v", msg.Attachments)
	}
}

func TestParsePlainMessage(t *testing.T) {
	msg, err := ParseMessage([]byte("From: a@b.org\r\nTo: 1@phonemail.com\r\nSubject: hi\r\n\r\nplain body\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if msg.Text != "plain body\r\n" && strings.TrimSpace(msg.Text) != "plain body" {
		t.Fatalf("text %q", msg.Text)
	}
	if msg.MessageID != "" || len(msg.Attachments) != 0 || msg.References == nil {
		t.Fatalf("unexpected: %+v", msg)
	}
}
