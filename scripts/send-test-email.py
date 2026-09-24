#!/usr/bin/env python3
"""Deliver a test email to a PhoneMail user through the local SMTP server (like an outside sender would).

    python3 scripts/send-test-email.py 9876543210 --from "Priya <priya@example.org>" --subject "Hello" --attach notes.pdf
"""
import argparse
import mimetypes
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument("to", help="phone number (9876543210) or full address (9876543210@phonemail.com)")
parser.add_argument("--from", dest="sender", default="Test Sender <sender@example.org>")
parser.add_argument("--subject", default="Hello from outside PhoneMail")
parser.add_argument("--body", default="This email arrived through the PhoneMail SMTP server.")
parser.add_argument("--html", action="store_true", help="also send an HTML part")
parser.add_argument("--attach", action="append", default=[], help="file to attach (repeatable)")
parser.add_argument("--reply-to-id", help="Message-ID this email replies to (threading)")
parser.add_argument("--host", default="localhost")
parser.add_argument("--port", type=int, default=2525)
parser.add_argument("--domain", default="phonemail.com")
args = parser.parse_args()

to = args.to if "@" in args.to else f"{args.to}@{args.domain}"
msg = EmailMessage()
msg["From"] = args.sender
msg["To"] = to
msg["Subject"] = args.subject
msg["Message-ID"] = make_msgid(domain="example.org")
if args.reply_to_id:
    msg["In-Reply-To"] = args.reply_to_id
    msg["References"] = args.reply_to_id
msg.set_content(args.body)
if args.html:
    msg.add_alternative(f"<p>{args.body}</p><p><b>Sent as HTML</b> from <i>send-test-email.py</i>.</p>", subtype="html")
for path in args.attach:
    data = Path(path).read_bytes()
    ctype, _ = mimetypes.guess_type(path)
    maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
    msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=Path(path).name)

with smtplib.SMTP(args.host, args.port) as smtp:
    smtp.send_message(msg)
print(f"Delivered to {to} ({msg['Message-ID']})")
