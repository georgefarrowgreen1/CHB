# Reply-by-email

Reply to a **"New website message"** email straight from your inbox and your
reply reaches the guest **both** ways — in the website chat *and* by email.
The guest sees it exactly as if you'd typed it in the back office.

## It just works — no setup

As soon as SMTP email is configured (which it already is if you're sending
booking emails), this is **on automatically**. There's nothing to set up.

How: the notification email's **Reply-To** points at the mailbox the site
already sends from. When you reply, the site quietly reads that mailbox over
POP3 (using the same credentials, on the matching `pop.` host) and posts your
reply into the conversation. It only ever acts on replies **from one of your
owner-notification addresses** (Settings → Notifications) that match a real
conversation — everything else in the mailbox is ignored and nothing is
deleted.

Replies are pulled in whenever you open **Guest messages** in the back office,
and once a day by the scheduled job. Settings → **Health check** shows a green
*Reply-by-email (auto)* row, and reports the mailbox host + last check.

### If the auto check can't connect

Some hosts use a non-standard POP host or need POP3 switched on for the mailbox.
If Health check shows an amber *Reply-by-email (auto)* row:

- Turn on **POP3** for the mailbox in your email provider's control panel.
- Or set the read host explicitly in `config.php`:
  ```php
  define('MAIL_POP_HOST', 'pop.yourprovider.com');   // default is derived from SMTP_HOST
  ```

Either way, replying from the back office always works.

## Optional: inbound-route (webhook) instead of polling

Prefer instant delivery (no polling) or a dedicated address? Set a webhook route
instead — the auto POP3 reader stands down when `REPLY_INBOX` is set.

1. In `config.php`:
   ```php
   define('REPLY_INBOX', 'reply@yourdomain.co.uk');
   define('INBOUND_SECRET', 'a-long-random-string');   // not your APP_SECRET
   ```
2. Create a free inbound route (ImprovMX / Mailgun Routes / CloudMailin) for
   that address that forwards to:
   `https://yourdomain.co.uk/inbound-mail.php?key=YOUR_INBOUND_SECRET`

## Notes

- Only what you type above the quoted history / signature is sent to the guest.
- Handles the common reply formats (Gmail, Apple Mail, Outlook), quoted-
  printable / base64 bodies, and multipart emails.
