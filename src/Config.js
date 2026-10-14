/**
 * User-tunable settings.
 */
const CONFIG = {
  // How often the background trigger checks scheduled drafts. Must be one of
  // 1, 5, 10, 15, 30. Sends can be up to this many minutes late.
  CHECK_INTERVAL_MINUTES: 5,

  // Labels applied to the thread so you can see state from Gmail itself.
  SCHEDULED_LABEL: 'Schedule Guard/Scheduled',
  CANCELLED_LABEL: 'Schedule Guard/Cancelled',

  // If true, a message *you* send in the thread (from Gmail directly, not via
  // this script) also cancels the scheduled send.
  CANCEL_ON_OWN_MESSAGES: false,

  // What to do to the thread when a scheduled send is cancelled by a reply.
  MARK_UNREAD_ON_CANCEL: true,
  MOVE_TO_INBOX_ON_CANCEL: true,
};
