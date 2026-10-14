/**
 * Core scheduling logic.
 *
 * Gmail's built-in "Schedule send" has no API, so we can't cancel it from a
 * script. Instead, the email stays a normal draft and this script sends it at
 * the scheduled time. If someone replies to the thread first, we just stop
 * tracking it -- the draft is left exactly where it is for you to handle.
 */

/** One-time setup: run this from the Apps Script editor. */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'processScheduled')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processScheduled')
    .timeBased()
    .everyMinutes(CONFIG.CHECK_INTERVAL_MINUTES)
    .create();
  getOrCreateLabel_(CONFIG.SCHEDULED_LABEL);
  getOrCreateLabel_(CONFIG.CANCELLED_LABEL);
  Logger.log('Installed processScheduled trigger every %s minutes.', CONFIG.CHECK_INTERVAL_MINUTES);
}

function scheduleDraft_(draftId, sendAt) {
  const draft = GmailApp.getDraft(draftId);
  const message = draft.getMessage();
  const thread = message.getThread();
  const knownMessageIds = thread
    .getMessages()
    .filter((m) => !m.isDraft())
    .map((m) => m.getId());

  saveJob_({
    draftId: draftId,
    threadId: thread.getId(),
    sendAt: sendAt,
    knownMessageIds: knownMessageIds,
    subject: message.getSubject() || '(no subject)',
    scheduledAt: Date.now(),
  });
  thread.removeLabel(getOrCreateLabel_(CONFIG.CANCELLED_LABEL));
  thread.addLabel(getOrCreateLabel_(CONFIG.SCHEDULED_LABEL));
}

function unscheduleDraft_(draftId) {
  const job = getJob_(draftId);
  deleteJob_(draftId);
  if (job) removeLabelSafe_(job.threadId, CONFIG.SCHEDULED_LABEL);
}

/** Time-driven trigger entry point. */
function processScheduled() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(30 * 1000)) return;
  try {
    const myAddresses = getMyAddresses_();
    listJobs_().forEach((job) => {
      try {
        processJob_(job, myAddresses);
      } catch (err) {
        console.error('Failed processing draft %s (%s): %s', job.draftId, job.subject, err.stack || err);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function processJob_(job, myAddresses) {
  let draft;
  try {
    draft = GmailApp.getDraft(job.draftId);
    draft.getMessage();
  } catch (err) {
    // Draft was deleted or sent manually; nothing left to do.
    console.log('Draft %s (%s) no longer exists; dropping job.', job.draftId, job.subject);
    unscheduleDraft_(job.draftId);
    return;
  }

  const thread = draft.getMessage().getThread();
  const known = new Set(job.knownMessageIds);
  const newMessages = thread
    .getMessages()
    .filter((m) => !m.isDraft() && !known.has(m.getId()))
    .filter((m) => CONFIG.CANCEL_ON_OWN_MESSAGES || !isFromMe_(m, myAddresses));

  if (newMessages.length > 0) {
    cancelForReply_(job, thread, newMessages);
    return;
  }

  if (Date.now() >= job.sendAt) {
    draft.send();
    deleteJob_(job.draftId);
    thread.removeLabel(getOrCreateLabel_(CONFIG.SCHEDULED_LABEL));
    console.log('Sent draft %s (%s).', job.draftId, job.subject);
  }
}

function cancelForReply_(job, thread, newMessages) {
  deleteJob_(job.draftId);
  thread.removeLabel(getOrCreateLabel_(CONFIG.SCHEDULED_LABEL));
  thread.addLabel(getOrCreateLabel_(CONFIG.CANCELLED_LABEL));
  if (CONFIG.MOVE_TO_INBOX_ON_CANCEL) thread.moveToInbox();
  if (CONFIG.MARK_UNREAD_ON_CANCEL) thread.markUnread();
  console.log(
    'Cancelled scheduled send of draft %s (%s): new message from %s. Left as draft.',
    job.draftId,
    job.subject,
    newMessages.map((m) => m.getFrom()).join(', ')
  );
}

function getMyAddresses_() {
  return [Session.getActiveUser().getEmail()]
    .concat(GmailApp.getAliases())
    .map((a) => a.toLowerCase());
}

function isFromMe_(message, myAddresses) {
  const from = message.getFrom();
  const match = from.match(/<([^>]+)>/);
  const address = (match ? match[1] : from).trim().toLowerCase();
  return myAddresses.indexOf(address) !== -1;
}

function getOrCreateLabel_(name) {
  const existing = GmailApp.getUserLabelByName(name);
  if (existing) return existing;
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    if (!GmailApp.getUserLabelByName(parent)) GmailApp.createLabel(parent);
  }
  return GmailApp.createLabel(name);
}

function removeLabelSafe_(threadId, labelName) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) thread.removeLabel(getOrCreateLabel_(labelName));
  } catch (err) {
    console.warn('Could not remove label from thread %s: %s', threadId, err);
  }
}
