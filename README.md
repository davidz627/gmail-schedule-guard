# gmail-schedule-guard

Use Gmail's normal **Schedule send**. If anyone replies to the thread before
your scheduled reply goes out, this script turns it back into a draft so you can
decide what to do.

There's no new UI. You only notice it when it acts.

## How it works

Gmail has no API for scheduled send. But a scheduled email is a draft with a
send time attached. **Moving it to the trash and immediately restoring it
removes the send time and leaves a normal draft in the same thread.** That's the
same result as clicking "Cancel send" in Gmail.

Every minute the script:

1. Lists your scheduled emails (`in:scheduled`).
2. The first time it sees one, records the messages already in that thread.
3. If a new message from someone else has arrived in the thread since then, it
   trashes and restores the scheduled email, so it's a draft again. The reply
   gets the `Schedule Guard/Unscheduled` label, is marked unread, and is put
   in your inbox.
4. Forgets emails that are no longer scheduled, because they were sent or you
   cancelled them.

Settings are in [`src/Config.js`](src/Config.js).

## Setup

You need Node and the
[Apps Script API turned on](https://script.google.com/home/usersettings) for
your Google account.

```sh
npm install
npx clasp login
npx clasp create --type standalone --title "Schedule Guard" --rootDir src
npx clasp push
npx clasp open-script
```

In the Apps Script editor, pick **`setup`** from the function dropdown and
click **Run**. Approve the permissions. This installs the every-minute trigger
and creates the label. That's it.

To check on it, run **`status`** to log what's scheduled and whether each one
is being tracked. **Executions** in the editor, or `npm run logs`, shows each
run.

## Things to know

- **Race window:** a reply that arrives less than a minute before the send
  time can lose the race, and your email still goes out.
- **The one-minute gap after scheduling:** the baseline is taken the first
  time the script sees a scheduled email, up to a minute after you schedule
  it. A reply that lands in that minute is treated as already seen.
- **Your own messages:** messages you send in the thread yourself don't
  unschedule anything unless you set `CANCEL_ON_OWN_MESSAGES`.
- **New emails** (not replies) can't get a reply before they're sent, so
  they're tracked but never unscheduled.
- **Run time:** an every-minute trigger uses roughly 30–40 minutes of Apps
  Script run time a day. That's well within the limit on a Workspace account
  (6 hours a day). Free Gmail accounts get 90 minutes a day, so set
  `CHECK_INTERVAL_MINUTES` to 5 there.

## Tests

`npm test` runs the logic against a fake Gmail (`test/guard.test.js`).
