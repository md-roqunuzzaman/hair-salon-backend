// Sequential execution retains the database queue and existing task ordering.
// Attempt all tasks, then report failure so scheduled-event monitoring stays honest.
export async function runCronTasks(tasks) {
  let failed = false;
  for (const [name, run] of tasks) {
    try { await run(); }
    catch { failed = true; console.error('[Cron]', { code: 'CRON_TASK_FAILED', task: name }); }
  }
  if (failed) throw new Error('Scheduled tasks failed');
}
