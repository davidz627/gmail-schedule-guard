/**
 * User-tunable settings.
 */
const CONFIG = {
  // How often to check scheduled emails for replies. Must be one of
  // 1, 5, 10, 15, 30. A reply that lands within this window before the send
  // time can lose the race, so keep it small.
  CHECK_INTERVAL_MINUTES: 1,

  // Label put on the reply that caused a scheduled email to be unscheduled.
  UNSCHEDULED_LABEL: 'Schedule Guard/Unscheduled',

  // If true, a message *you* send in the thread also unschedules the email.
  CANCEL_ON_OWN_MESSAGES: false,

  // Also mark the reply unread and make sure it's in the inbox.
  SURFACE_REPLY: true,
};
