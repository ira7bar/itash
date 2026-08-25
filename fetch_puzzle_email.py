"""Fetch this week's tashbetz PDF from Gmail via IMAP, for the weekly deploy workflow.

Looks for the newest email matching subject "tashbetz" with a PDF attachment,
sent within the last few days, in the mailbox at GMAIL_ADDRESS (authenticated
via an app password in GMAIL_APP_PASSWORD). Saves the attachment as
tashbetz.pdf in the current directory.

Writes found/target_date to $GITHUB_OUTPUT so the workflow can decide whether
to proceed. target_date is always the Friday of the current week (Asia/Jerusalem
time) -- matching the print magazine's cover date, which is what this repo's
puzzle_YYYY-MM-DD.json files are named after (see CLAUDE.md).
"""

import email
import imaplib
import os
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

SEARCH_WINDOW_DAYS = 4


def compute_target_date() -> str:
    now = datetime.now(ZoneInfo("Asia/Jerusalem"))
    weekday = now.weekday()  # Monday=0 ... Sunday=6
    if weekday == 3:  # Thursday
        friday = now + timedelta(days=1)
    elif weekday == 4:  # Friday
        friday = now
    elif weekday == 5:  # Saturday
        friday = now - timedelta(days=1)
    else:
        friday = now + timedelta(days=(4 - weekday) % 7)
    return friday.strftime("%Y-%m-%d")


def find_pdf_attachment(msg: email.message.Message) -> bytes | None:
    for part in msg.walk():
        filename = part.get_filename()
        if part.get_content_type() == "application/pdf" or (
            filename and filename.lower().endswith(".pdf")
        ):
            return part.get_payload(decode=True)
    return None


def main() -> None:
    address = os.environ["GMAIL_ADDRESS"]
    app_password = os.environ["GMAIL_APP_PASSWORD"]

    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(address, app_password)
    imap.select('"[Gmail]/All Mail"', readonly=True)

    since = (datetime.now() - timedelta(days=SEARCH_WINDOW_DAYS)).strftime("%d-%b-%Y")
    status, data = imap.search(None, f'(SUBJECT "tashbetz" SINCE "{since}")')
    if status != "OK" or not data or not data[0]:
        write_output(found=False)
        return

    ids = data[0].split()
    best_msg = None
    best_date = None
    best_pdf = None

    for msg_id in ids:
        status, msg_data = imap.fetch(msg_id, "(RFC822)")
        if status != "OK" or not msg_data or not msg_data[0]:
            continue
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        pdf_bytes = find_pdf_attachment(msg)
        if not pdf_bytes:
            continue
        try:
            msg_date = parsedate_to_datetime(msg["Date"])
        except (TypeError, ValueError):
            continue
        if best_date is None or msg_date > best_date:
            best_date, best_msg, best_pdf = msg_date, msg, pdf_bytes

    imap.logout()

    if best_pdf is None:
        write_output(found=False)
        return

    with open("tashbetz.pdf", "wb") as f:
        f.write(best_pdf)

    write_output(found=True, target_date=compute_target_date())


def write_output(found: bool, target_date: str = "") -> None:
    github_output = os.environ.get("GITHUB_OUTPUT")
    lines = [f"found={'true' if found else 'false'}"]
    if target_date:
        lines.append(f"target_date={target_date}")
    print("\n".join(lines))
    if github_output:
        with open(github_output, "a") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
