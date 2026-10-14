# gmail-schedule-guard

**Schedule send in Gmail, but if someone replies first, don't send it. Turn it
back into a draft instead.**

You write a reply and schedule it for tomorrow morning. Overnight, the other
person writes back and your reply is now out of date. Normally Gmail sends it
anyway. With Schedule Guard, the reply is unscheduled and left in your Drafts,
and their reply is marked unread at the top of your inbox, so you can decide
what to do.

There's nothing new to learn. You keep using Gmail's normal **Schedule send**,
and the script works in the background.

## What you'll see

When a scheduled reply gets unscheduled:

- Your scheduled email disappears from **Scheduled** and reappears in
  **Drafts**, in the same thread, with your text intact.
- The new reply that caused it is **marked unread**, **moved to your inbox**,
  and labelled **`Schedule Guard/Unscheduled`**.

If nobody replies, nothing happens and Gmail sends your email on schedule as
usual.

## How it works

Gmail has no API for scheduled send, so a script can't call "Cancel send"
directly. But under the hood a scheduled email is just a **draft with a send
time attached**. Moving it to the trash removes the send time. Restoring it
straight away brings it back as a normal draft in the same thread. The end
result is identical to clicking "Cancel send" yourself.

A trigger runs `checkScheduled` every minute:

1. **List scheduled emails** with the Gmail search `in:scheduled`.
2. **Take a snapshot.** The first time it sees a scheduled email, it records
   the IDs of the messages already in that thread. These are the messages you'd
   seen when you scheduled it. The snapshot is stored in the script's user
   properties.
3. **Look for new replies.** On each later run, it checks the thread for
   messages that aren't in the snapshot. It ignores drafts, trash, spam, and
   by default messages you sent yourself.
4. **Unschedule if needed.** If there's a new reply, it trashes and restores
   the scheduled email, so it becomes a draft again. Then it labels the reply,
   marks it unread, and puts it in your inbox.
5. **Clean up.** Snapshots for emails that are no longer scheduled are
   deleted. That covers emails that were sent, cancelled by hand, or deleted.

All the logic is in [`src/Guard.js`](src/Guard.js) and the settings are in
[`src/Config.js`](src/Config.js).

## Setup

It takes about 5 minutes and is done entirely in the browser.

1. **Create the project.** Go to [script.google.com](https://script.google.com),
   click **New project**, and rename it to "Schedule Guard".
2. **Paste the code.** Replace everything in `Code.gs` with the contents of
   [`src/Config.js`](src/Config.js), followed by
   [`src/Guard.js`](src/Guard.js), pasted one after the other into the same
   file. Save with ⌘S / Ctrl+S.
3. **Turn on the Gmail API service.** In the left sidebar, next to
   **Services**, click **+**. Click **Gmail API** so it's highlighted, then click
   **Add**. If **Add** stays greyed out, see
   [Troubleshooting](#troubleshooting).
4. **Run `setup`.** Choose `setup` from the function dropdown in the toolbar
   and click **Run**.
5. **Approve permissions.** Google will say it *hasn't verified this app*,
   which is normal for a personal script. Click **Advanced**, then **Go to
   Schedule Guard (unsafe)**, then **Allow**.

You're done when the **Execution log** ends with:

```
Installed checkScheduled trigger every 1 minute(s).
```

The **Triggers** page (clock icon) should show `checkScheduled` running every
minute.

### Try it out

1. Have a friend, or a second account of yours, email you.
2. Write a reply and use **Schedule send** to send it an hour from now.
3. Wait a minute so the script takes its snapshot, then have them reply again.
4. Within a minute, your scheduled reply should be back in **Drafts**.

To see what the script is tracking, run `status` from the editor. It logs each
scheduled email and whether it has a snapshot yet. **Executions** in the left
sidebar shows every run and any errors.

### Alternative: deploy from this repo with clasp

If you'd rather push from the command line, first turn on the
[Apps Script API](https://script.google.com/home/usersettings) for your
account, then:

```sh
npm install
npx clasp login
npx clasp create --type standalone --title "Schedule Guard" --rootDir src
npx clasp push       # includes appsscript.json, so the Gmail service is already on
npx clasp open-script
```

Then run `setup` in the editor, as in steps 4–5 above.

## Settings

Edit the `CONFIG` block at the top of the code and save. Run `setup` again
only if you change `CHECK_INTERVAL_MINUTES`.

| Setting | Default | What it does |
| --- | --- | --- |
| `CHECK_INTERVAL_MINUTES` | `1` | How often to check. Allowed values are 1, 5, 10, 15 or 30. Smaller values leave less room for a reply to slip through. |
| `UNSCHEDULED_LABEL` | `Schedule Guard/Unscheduled` | Label put on the reply that caused an unschedule. |
| `CANCEL_ON_OWN_MESSAGES` | `false` | If `true`, a message *you* send in the thread also unschedules it. |
| `SURFACE_REPLY` | `true` | Mark the reply unread and move it to the inbox. |

## Cost

It's free. Apps Script and the Gmail API cost nothing, and you don't need a
billing account. The only limit is daily trigger run time: 6 hours a day on
Google Workspace accounts and 90 minutes a day on personal Gmail accounts.
Checking every minute should fit comfortably on Workspace. On a personal Gmail
account, set `CHECK_INTERVAL_MINUTES` to `5`. If the limit were ever hit, the
script would pause until the next day; you'd never be charged.

## Limitations

- **Last-minute replies:** if a reply arrives less than a check interval before
  the send time, your email may still go out.
- **The first minute after scheduling:** the snapshot is taken the first time
  the script sees the scheduled email, up to a minute after you schedule it. A
  reply that arrives in that minute counts as one you'd already seen.
- **New emails:** brand-new emails, not replies, can't get a reply before
  they're sent, so the script never unschedules them.
- **Gmail changes:** the trash-and-restore trick relies on how Gmail currently
  handles scheduled emails. If Gmail changes that, an email could be left in
  Trash; the log will say so, and you can restore it from there.

## Troubleshooting

**"Add" is greyed out in the Services dialog.** First make sure you've clicked
**Gmail API** in the list, and that it isn't already listed under **Services**.
If it still won't work, enable it from the project's settings file instead:

1. Open **Project Settings** (gear icon) and tick **Show "appsscript.json"
   manifest file in editor**.
2. Replace the contents of `appsscript.json` with
   [`src/appsscript.json`](src/appsscript.json) and save.

**"Gmail is not defined".** The Gmail API service isn't on. Redo step 3 of
Setup, or use the `appsscript.json` route above.

**The permission screen blocks you entirely.** Your Google Workspace admin may
block apps that Google hasn't verified. The admin needs to allow it in the
Admin console.

**An email ended up in Trash.** The script tries to restore it three times
before giving up and logging an error. Open Trash and restore it by hand; it
comes back as a normal draft.

## Development

```sh
npm test
```

This runs [`test/guard.test.js`](test/guard.test.js), which runs `Guard.js`
against an in-memory fake of the Gmail API. It covers the snapshot, a reply
from someone else, your own messages, drafts, trash and spam in the thread,
and cleanup.

If you deploy from the editor, the code there is a separate copy. Copy any
edits you make in the browser back into this repo by hand.
