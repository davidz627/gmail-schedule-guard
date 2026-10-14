/**
 * Schedule Guard: if someone replies to a thread while you have a reply
 * scheduled (with Gmail's normal "Schedule send"), turn the scheduled email
 * back into a draft so you can decide what to do.
 *
 * Gmail has no API for scheduled send, but a scheduled email is a draft with a
 * send time. Trashing it drops the send time, and untrashing it brings it back
 * as a normal draft in the same thread -- the same result as "Cancel send".
 *
 * State, per scheduled message id, in UserProperties ("sched:<id>"):
 *   { threadId: string, knownIds: string[] }
 * where knownIds are the thread's messages when we first saw it scheduled.
 */
const STATE_PREFIX = 'sched:';

/** One-time setup: run this from the Apps Script editor. */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkScheduled')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkScheduled').timeBased().everyMinutes(CONFIG.CHECK_INTERVAL_MINUTES).create();
  getOrCreateLabelId_(CONFIG.UNSCHEDULED_LABEL);
  checkScheduled();
  console.log('Installed checkScheduled trigger every %s minute(s).', CONFIG.CHECK_INTERVAL_MINUTES);
}

/** Time-driven trigger entry point. */
function checkScheduled() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10 * 1000)) return;
  try {
    const props = PropertiesService.getUserProperties();
    const state = loadState_(props);
    const live = new Set();

    listScheduled_().forEach((msg) => {
      live.add(msg.id);
      try {
        checkOne_(msg, state[msg.id], props);
      } catch (err) {
        console.error('Failed checking scheduled message %s: %s', msg.id, err.stack || err);
      }
    });

    // Forget anything that's no longer scheduled (sent, cancelled, deleted).
    Object.keys(state)
      .filter((id) => !live.has(id))
      .forEach((id) => props.deleteProperty(STATE_PREFIX + id));
  } finally {
    lock.releaseLock();
  }
}

/** Debug helper: logs what's scheduled and what the script is tracking. */
function status() {
  const state = loadState_(PropertiesService.getUserProperties());
  const scheduled = listScheduled_();
  if (scheduled.length === 0) console.log('Nothing scheduled.');
  scheduled.forEach((msg) => {
    console.log(
      '%s  "%s"  %s',
      state[msg.id] ? 'tracked' : 'new    ',
      getSubject_(msg.id),
      new Date(Number(Gmail.Users.Messages.get('me', msg.id, { format: 'minimal' }).internalDate))
    );
  });
}

function checkOne_(msg, tracked, props) {
  const thread = Gmail.Users.Threads.get('me', msg.threadId, { format: 'minimal' });
  const others = (thread.messages || []).filter(
    (m) => m.id !== msg.id && !hasAnyLabel_(m, ['DRAFT', 'TRASH', 'SPAM'])
  );

  if (!tracked) {
    // First time we've seen this one: everything already in the thread is
    // something you saw before scheduling.
    props.setProperty(
      STATE_PREFIX + msg.id,
      JSON.stringify({ threadId: msg.threadId, knownIds: others.map((m) => m.id) })
    );
    return;
  }

  const known = new Set(tracked.knownIds);
  const replies = others.filter(
    (m) => !known.has(m.id) && (CONFIG.CANCEL_ON_OWN_MESSAGES || !hasAnyLabel_(m, ['SENT']))
  );
  if (replies.length > 0) {
    unschedule_(msg.id, replies);
    props.deleteProperty(STATE_PREFIX + msg.id);
  }
}

function unschedule_(messageId, replies) {
  const subject = getSubject_(messageId);
  Gmail.Users.Messages.trash('me', messageId);
  untrashWithRetry_(messageId);

  const addLabelIds = [getOrCreateLabelId_(CONFIG.UNSCHEDULED_LABEL)];
  if (CONFIG.SURFACE_REPLY) addLabelIds.push('UNREAD', 'INBOX');
  Gmail.Users.Messages.batchModify({ ids: replies.map((m) => m.id), addLabelIds: addLabelIds }, 'me');

  console.log('Unscheduled "%s" (%s) back to a draft: %s new message(s) in thread.', subject, messageId, replies.length);
}

function untrashWithRetry_(messageId) {
  for (let attempt = 1; ; attempt++) {
    try {
      Gmail.Users.Messages.untrash('me', messageId);
      return;
    } catch (err) {
      if (attempt >= 3) {
        console.error('Could not untrash %s; the draft is in Trash, restore it by hand.', messageId);
        throw err;
      }
      Utilities.sleep(1000 * attempt);
    }
  }
}

function listScheduled_() {
  const out = [];
  let pageToken;
  do {
    const res = Gmail.Users.Messages.list('me', { q: 'in:scheduled', maxResults: 100, pageToken: pageToken });
    (res.messages || []).forEach((m) => out.push({ id: m.id, threadId: m.threadId }));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

function loadState_(props) {
  const all = props.getProperties();
  const state = {};
  Object.keys(all)
    .filter((k) => k.startsWith(STATE_PREFIX))
    .forEach((k) => (state[k.slice(STATE_PREFIX.length)] = JSON.parse(all[k])));
  return state;
}

function hasAnyLabel_(message, labelIds) {
  return (message.labelIds || []).some((l) => labelIds.indexOf(l) !== -1);
}

function getSubject_(messageId) {
  const msg = Gmail.Users.Messages.get('me', messageId, { format: 'metadata', metadataHeaders: ['Subject'] });
  const header = (msg.payload.headers || []).find((h) => h.name.toLowerCase() === 'subject');
  return header ? header.value : '(no subject)';
}

function getOrCreateLabelId_(name) {
  const labels = Gmail.Users.Labels.list('me').labels || [];
  const parts = name.split('/');
  let id;
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/');
    const existing = labels.find((l) => l.name === path);
    id = existing ? existing.id : Gmail.Users.Labels.create({ name: path }, 'me').id;
  }
  return id;
}
