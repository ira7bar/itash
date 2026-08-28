"""Send a plain-text notification email via Gmail SMTP, for the deploy workflow."""

import os
import smtplib
import sys
from email.mime.text import MIMEText


def main() -> None:
    subject, body = sys.argv[1], sys.argv[2]
    address = os.environ["GMAIL_ADDRESS"]
    app_password = os.environ["GMAIL_APP_PASSWORD"]

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = address
    msg["To"] = address

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(address, app_password)
        smtp.send_message(msg)


if __name__ == "__main__":
    main()
