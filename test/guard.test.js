// Runs src/*.js against an in-memory fake of the Gmail advanced service.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEnv() {
  const messages = {}; // id -> { id, threadId, labelIds, subject }
  const scheduled = new Set();
  const calls = [];
  const props = {};
  const labels = [];

  const Gmail = {
    Users: {
      Messages: {
        list: () => ({ messages: [...scheduled].map((id) => ({ id, threadId: messages[id].threadId })) }),
        get: (_, id) => ({
          id,
          internalDate: '0',
          payload: { headers: [{ name: 'Subject', value: messages[id].subject }] },
        }),
        trash: (_, id) => {
          calls.push(['trash', id]);
          scheduled.delete(id);
          messages[id].labelIds.push('TRASH');
        },
        untrash: (_, id) => {
          calls.push(['untrash', id]);
          messages[id].labelIds = messages[id].labelIds.filter((l) => l !== 'TRASH');
        },
        batchModify: (req) => {
          calls.push(['modify', req.ids, req.addLabelIds]);
          req.ids.forEach((id) => messages[id].labelIds.push(...req.addLabelIds));
        },
      },
      Threads: {
        get: (_, threadId) => ({ messages: Object.values(messages).filter((m) => m.threadId === threadId) }),
      },
      Labels: {
        list: () => ({ labels }),
        create: (label) => {
          const created = { id: 'Label_' + labels.length, name: label.name };
          labels.push(created);
          return created;
        },
      },
    },
  };

  const ctx = {
    Gmail,
    console: { log() {}, error() {} },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: {
      getUserProperties: () => ({
        getProperties: () => ({ ...props }),
        setProperty: (k, v) => (props[k] = v),
        deleteProperty: (k) => delete props[k],
      }),
    },
    Utilities: { sleep() {} },
  };
  vm.createContext(ctx);
  const src = path.join(__dirname, '..', 'src');
  // Top-level consts aren't shared across separate vm scripts, so run as one.
  const code = ['Config.js', 'Guard.js'].map((f) => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
  vm.runInContext(code + '\nthis.checkScheduled = checkScheduled;', ctx);

  const add = (id, threadId, labelIds, { isScheduled = false } = {}) => {
    messages[id] = { id, threadId, labelIds, subject: 'Re: hi' };
    if (isScheduled) scheduled.add(id);
  };
  return { ctx, add, calls, props, messages, scheduled };
}

function setupThread() {
  const env = makeEnv();
  env.add('in1', 't1', ['INBOX']); // their original email
  env.add('sched', 't1', ['IMPORTANT'], { isScheduled: true }); // my scheduled reply
  env.ctx.checkScheduled(); // first sighting: records baseline
  return env;
}

test('first sighting records the baseline and does nothing else', () => {
  const env = setupThread();
  assert.deepStrictEqual(env.calls, []);
  assert.deepStrictEqual(JSON.parse(env.props['sched:sched']).knownIds, ['in1']);
});

test('no new messages: leaves the scheduled email alone', () => {
  const env = setupThread();
  env.ctx.checkScheduled();
  assert.deepStrictEqual(env.calls, []);
});

test('reply from someone else: trash + untrash, then surface the reply', () => {
  const env = setupThread();
  env.add('in2', 't1', ['CATEGORY_PERSONAL']);
  env.ctx.checkScheduled();
  assert.deepStrictEqual(env.calls[0], ['trash', 'sched']);
  assert.deepStrictEqual(env.calls[1], ['untrash', 'sched']);
  assert.deepStrictEqual(env.calls[2][0], 'modify');
  assert.deepStrictEqual(env.calls[2][1], ['in2']);
  assert.ok(env.calls[2][2].includes('UNREAD') && env.calls[2][2].includes('INBOX'));
  assert.ok(!env.messages.sched.labelIds.includes('TRASH'));
  assert.strictEqual(env.props['sched:sched'], undefined);
});

test('my own sent message does not unschedule by default', () => {
  const env = setupThread();
  env.add('mine', 't1', ['SENT']);
  env.ctx.checkScheduled();
  assert.deepStrictEqual(env.calls, []);
});

test('other drafts, trash and spam in the thread are ignored', () => {
  const env = setupThread();
  env.add('d', 't1', ['DRAFT']);
  env.add('x', 't1', ['TRASH']);
  env.add('s', 't1', ['SPAM']);
  env.ctx.checkScheduled();
  assert.deepStrictEqual(env.calls, []);
});

test('state is cleaned up once the email is no longer scheduled', () => {
  const env = setupThread();
  env.scheduled.delete('sched'); // sent by Gmail, or cancelled by hand
  env.ctx.checkScheduled();
  assert.deepStrictEqual(env.props, {});
});
