/**
 * Scheduled jobs live in UserProperties, one property per draft, keyed
 * "job:<draftId>". A job looks like:
 *   {
 *     draftId: string,
 *     threadId: string,
 *     sendAt: number,              // epoch ms
 *     knownMessageIds: string[],   // non-draft messages in the thread at schedule time
 *     subject: string,
 *     scheduledAt: number,
 *   }
 */
const JOB_PREFIX = 'job:';

function saveJob_(job) {
  PropertiesService.getUserProperties().setProperty(JOB_PREFIX + job.draftId, JSON.stringify(job));
}

function getJob_(draftId) {
  const raw = PropertiesService.getUserProperties().getProperty(JOB_PREFIX + draftId);
  return raw ? JSON.parse(raw) : null;
}

function deleteJob_(draftId) {
  PropertiesService.getUserProperties().deleteProperty(JOB_PREFIX + draftId);
}

function listJobs_() {
  const props = PropertiesService.getUserProperties().getProperties();
  return Object.keys(props)
    .filter((k) => k.startsWith(JOB_PREFIX))
    .map((k) => JSON.parse(props[k]))
    .sort((a, b) => a.sendAt - b.sendAt);
}
