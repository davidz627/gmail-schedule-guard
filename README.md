# gmail-schedule-guard

Gmail "schedule send" with one twist: **if anyone replies to the thread before
your scheduled time, the send is cancelled and the email stays a draft** so you
can decide what to do.

## How it works

Gmail's built-in Schedule send has no API, so a script can't cancel it. Instead:

1. You write a normal draft (usually a reply in a thread).
2. In the **Schedule Guard** sidebar in Gmail, you pick a send time. The script
   records the draft, its thread, and the messages already in that thread, and
   labels the thread `Schedule Guard/Scheduled`.
3. A trigger runs every 5 minutes (configurable). For each scheduled draft:
   - **Someone else posted a new message in the thread** → stop tracking it,
     swap the label to `Schedule Guard/Cancelled`, move the thread to the inbox,
     and mark it unread. The draft is untouched.
   - **The send time has passed** → send the draft (whatever it says at that point,
     so editing after you schedule is fine).
   - **The draft is gone** (deleted or sent by hand) → stop tracking it.

Sends can be up to `CHECK_INTERVAL_MINUTES` late. Settings are in
[`src/Config.js`](src/Config.js).

## Setup

You need Node and a Google account with the
[Apps Script API turned on](https://script.google.com/home/usersettings).

```sh
npm install
npx clasp login
npx clasp create --type standalone --title "Schedule Guard" --rootDir src
#   (this writes .clasp.json; or copy .clasp.json.example and fill in scriptId)
npx clasp push
npx clasp open-script
```

In the Apps Script editor:

1. **Run `setup`** (pick it in the function dropdown and click Run). Approve the
   permissions. This installs the 5-minute trigger and creates the labels.
2. **Deploy → Test deployments → Install** (Application: Gmail). Reload Gmail;
   the Schedule Guard icon appears in the right sidebar.

Run `setup` from the editor, not the add-on: Google limits triggers created by
add-ons to once an hour.

## Using it

- **Reply in a thread:** write your reply and close the compose box so it saves
  as a draft. Open the Schedule Guard sidebar on that thread and press
  **Refresh** if needed. Click **Schedule**, then pick a quick option or a
  custom date and time.
- **A new email:** save it as a draft, open the sidebar from the Gmail home
  view, and schedule it from the **Drafts** list.
- **To cancel**, click **Unschedule**. The draft stays as it is.
- **To see what's queued,** look at the sidebar home view or the
  `Schedule Guard/Scheduled` label.

## Limitations

- Only messages from other people cancel a send. Set `CANCEL_ON_OWN_MESSAGES`
  to also cancel when you post in the thread yourself.
- Don't use Gmail's own Schedule send on the same draft. A draft scheduled that
  way leaves your Drafts folder, so the script stops tracking it.
- Logs: `npx clasp logs`, or **Executions** in the Apps Script editor.
