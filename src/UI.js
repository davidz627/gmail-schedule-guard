/**
 * Gmail add-on sidebar (CardService).
 *
 * - Homepage: everything scheduled, plus your recent drafts to schedule.
 * - Opened thread: the drafts in that thread.
 *
 * "ctx" is passed through actions so we can re-render the right root card:
 * either 'home' or a thread id.
 */
const MAX_HOME_DRAFTS = 20;

// ---------- Trigger entry points ----------

function onHomepage(e) {
  return buildRootCard_('home', userTz_(e));
}

function onGmailMessageOpen(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const threadId = GmailApp.getMessageById(e.gmail.messageId).getThread().getId();
  return [buildRootCard_(threadId, userTz_(e))];
}

// ---------- Action handlers ----------

function showScheduleCard(e) {
  const p = e.commonEventObject.parameters;
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildScheduleCard_(p.draftId, p.ctx, userTz_(e))))
    .build();
}

function handleSchedule(e) {
  const p = e.commonEventObject.parameters;
  const tz = userTz_(e);
  let sendAt;
  if (p.sendAt) {
    sendAt = Number(p.sendAt);
  } else {
    const inputs = e.commonEventObject.formInputs || {};
    const date = inputs.date && inputs.date.dateInput;
    const time = inputs.time && inputs.time.stringInputs.value[0];
    if (!date || !time) return notify_('Pick a date and time.');
    const [hh, mm] = time.split(':').map(Number);
    sendAt = wallClockToEpoch_(date.msSinceEpoch + (hh * 60 + mm) * 60 * 1000, tz);
  }
  if (sendAt <= Date.now()) return notify_('That time is in the past.');

  try {
    scheduleDraft_(p.draftId, sendAt);
  } catch (err) {
    return notify_('Could not schedule: ' + err.message);
  }
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Scheduled for ' + formatTime_(sendAt, tz)))
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildRootCard_(p.ctx, tz)))
    .build();
}

function handleUnschedule(e) {
  const p = e.commonEventObject.parameters;
  unscheduleDraft_(p.draftId);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Unscheduled. Draft kept.'))
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildRootCard_(p.ctx, userTz_(e))))
    .build();
}

function handleRefresh(e) {
  const p = e.commonEventObject.parameters;
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildRootCard_(p.ctx, userTz_(e))))
    .build();
}

// ---------- Cards ----------

function buildRootCard_(ctx, tz) {
  return ctx === 'home' ? buildHomeCard_(tz) : buildThreadCard_(ctx, tz);
}

function buildHomeCard_(tz) {
  const card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Schedule Guard'));

  const jobs = listJobs_();
  const scheduled = CardService.newCardSection().setHeader('Scheduled');
  if (jobs.length === 0) {
    scheduled.addWidget(CardService.newTextParagraph().setText('Nothing scheduled.'));
  }
  jobs.forEach((job) => {
    scheduled.addWidget(
      CardService.newDecoratedText()
        .setTopLabel(formatTime_(job.sendAt, tz))
        .setText(job.subject)
        .setWrapText(true)
        .setButton(actionButton_('Unschedule', 'handleUnschedule', { draftId: job.draftId, ctx: 'home' }))
    );
  });
  card.addSection(scheduled);

  const draftsSection = CardService.newCardSection().setHeader('Drafts');
  const drafts = GmailApp.getDrafts().slice(0, MAX_HOME_DRAFTS);
  if (drafts.length === 0) {
    draftsSection.addWidget(CardService.newTextParagraph().setText('No drafts.'));
  }
  const scheduledIds = new Set(jobs.map((j) => j.draftId));
  drafts
    .filter((d) => !scheduledIds.has(d.getId()))
    .forEach((d) => draftsSection.addWidget(draftRow_(d, null, 'home', tz)));
  card.addSection(draftsSection);

  card.addSection(refreshSection_('home'));
  return card.build();
}

function buildThreadCard_(threadId, tz) {
  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle('Schedule Guard').setSubtitle('Drafts in this thread')
  );
  const section = CardService.newCardSection();

  const thread = GmailApp.getThreadById(threadId);
  const draftMessageIds = new Set(
    thread
      .getMessages()
      .filter((m) => m.isDraft())
      .map((m) => m.getId())
  );
  const drafts = draftMessageIds.size
    ? GmailApp.getDrafts().filter((d) => draftMessageIds.has(d.getMessageId()))
    : [];

  if (drafts.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'No drafts in this thread. Write a reply, close the compose box, then hit Refresh.'
      )
    );
  }
  drafts.forEach((d) => section.addWidget(draftRow_(d, getJob_(d.getId()), threadId, tz)));

  card.addSection(section);
  card.addSection(refreshSection_(threadId));
  return card.build();
}

function buildScheduleCard_(draftId, ctx, tz) {
  const message = GmailApp.getDraft(draftId).getMessage();
  const card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader()
      .setTitle('Schedule send')
      .setSubtitle(message.getSubject() || '(no subject)')
  );

  const quick = CardService.newCardSection().setHeader('Quick picks');
  const buttons = CardService.newButtonSet();
  quickPicks_(tz).forEach((pick) => {
    buttons.addButton(
      actionButton_(pick.label, 'handleSchedule', { draftId: draftId, ctx: ctx, sendAt: String(pick.sendAt) })
    );
  });
  quick.addWidget(buttons);
  card.addSection(quick);

  const custom = CardService.newCardSection().setHeader('Custom');
  custom.addWidget(
    CardService.newDatePicker().setFieldName('date').setTitle('Date').setValueInMsSinceEpoch(localMidnightUtc_(tz, 0))
  );
  const timeInput = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('time')
    .setTitle('Time (' + tz.id + ')');
  for (let mins = 0; mins < 24 * 60; mins += 15) {
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    const value = pad2_(hh) + ':' + pad2_(mm);
    const label = ((hh + 11) % 12) + 1 + ':' + pad2_(mm) + (hh < 12 ? ' AM' : ' PM');
    timeInput.addItem(label, value, value === '08:00');
  }
  custom.addWidget(timeInput);
  custom.addWidget(actionButton_('Schedule', 'handleSchedule', { draftId: draftId, ctx: ctx }));
  card.addSection(custom);

  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(
        'If anyone replies to the thread before this time, the send is cancelled and the draft is left for you.'
      )
    )
  );
  return card.build();
}

function draftRow_(draft, job, ctx, tz) {
  const message = draft.getMessage();
  const row = CardService.newDecoratedText()
    .setText(message.getSubject() || '(no subject)')
    .setBottomLabel('To: ' + (message.getTo() || '(no recipients)'))
    .setWrapText(true);
  if (job) {
    row
      .setTopLabel('Scheduled: ' + formatTime_(job.sendAt, tz))
      .setButton(actionButton_('Unschedule', 'handleUnschedule', { draftId: draft.getId(), ctx: ctx }));
  } else {
    row.setButton(actionButton_('Schedule', 'showScheduleCard', { draftId: draft.getId(), ctx: ctx }));
  }
  return row;
}

function refreshSection_(ctx) {
  return CardService.newCardSection().addWidget(actionButton_('Refresh', 'handleRefresh', { ctx: ctx }));
}

function actionButton_(text, fn, params) {
  return CardService.newTextButton()
    .setText(text)
    .setOnClickAction(CardService.newAction().setFunctionName(fn).setParameters(params));
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

// ---------- Time helpers ----------
// "Wall clock" values below are local times encoded as if they were UTC epoch
// ms, which lets us use the UTC getters for local calendar math.

function userTz_(e) {
  const tz = e && e.commonEventObject && e.commonEventObject.timeZone;
  return { id: (tz && tz.id) || Session.getScriptTimeZone() };
}

function tzOffsetMs_(tz, epochMs) {
  const z = Utilities.formatDate(new Date(epochMs), tz.id, 'Z'); // e.g. "-0700"
  const sign = z[0] === '-' ? -1 : 1;
  return sign * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60 * 1000;
}

function wallClockToEpoch_(wallMs, tz) {
  const guess = wallMs - tzOffsetMs_(tz, wallMs);
  return wallMs - tzOffsetMs_(tz, guess); // re-check offset at the real instant (DST)
}

/** Local midnight `daysFromToday` days out, as a UTC-midnight value (what DatePicker uses). */
function localMidnightUtc_(tz, daysFromToday) {
  const now = new Date(Date.now() + tzOffsetMs_(tz, Date.now()));
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromToday);
}

function quickPicks_(tz) {
  const hour = 60 * 60 * 1000;
  const todayDow = new Date(localMidnightUtc_(tz, 0)).getUTCDay();
  const daysToMonday = ((8 - todayDow) % 7) || 7;
  return [
    { label: 'In 1 hour', sendAt: Date.now() + hour },
    { label: 'Tomorrow 8 AM', sendAt: wallClockToEpoch_(localMidnightUtc_(tz, 1) + 8 * hour, tz) },
    { label: 'Monday 8 AM', sendAt: wallClockToEpoch_(localMidnightUtc_(tz, daysToMonday) + 8 * hour, tz) },
  ];
}

function formatTime_(epochMs, tz) {
  return Utilities.formatDate(new Date(epochMs), tz.id, "EEE MMM d, h:mm a");
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}
