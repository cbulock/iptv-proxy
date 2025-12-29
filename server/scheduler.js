import cron from 'node-cron';
import { runHealthCheck } from '../scripts/check-channel-health.js';
import { refreshEPG } from './epg.js';

/**
 * @typedef {Object} ScheduledJob
 * @property {string} name - Human readable name
 * @property {string} schedule - Cron expression
 * @property {Function} task - Async function to execute
 * @property {boolean} runOnStart - Whether to run immediately on startup
 * @property {import('node-cron').ScheduledTask} [cronTask] - The scheduled cron task
 */

/** @type {ScheduledJob[]} */
const jobs = [];

/**
 * Wraps a task with logging and error handling
 * @param {string} name
 * @param {Function} task
 * @returns {Function}
 */
function wrapTask(name, task) {
  return async () => {
    const startTime = Date.now();
    console.log(`[Scheduler] Starting job: ${name}`);
    try {
      await task();
      const duration = Date.now() - startTime;
      console.log(`[Scheduler] Completed job: ${name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[Scheduler] Job failed: ${name} (${duration}ms)`, err.message);
    }
  };
}

/**
 * Register a new scheduled job
 * @param {string} name - Human readable name
 * @param {string} schedule - Cron expression
 * @param {Function} task - Async function to execute
 * @param {boolean} [runOnStart=false] - Whether to run immediately on startup
 */
export function registerJob(name, schedule, task, runOnStart = false) {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression for job "${name}": ${schedule}`);
  }

  jobs.push({
    name,
    schedule,
    task,
    runOnStart,
    cronTask: null
  });

  console.log(`[Scheduler] Registered job: ${name} (${schedule})`);
}

/**
 * Start all registered jobs
 */
export async function startScheduler() {
  console.log(`[Scheduler] Starting ${jobs.length} scheduled jobs...`);

  for (const job of jobs) {
    const wrappedTask = wrapTask(job.name, job.task);

    // Schedule the cron job
    job.cronTask = cron.schedule(job.schedule, wrappedTask);

    // Run on start if configured
    if (job.runOnStart) {
      // Run in background to not block startup
      wrappedTask().catch(() => {});
    }
  }

  console.log('[Scheduler] All jobs scheduled');
}

/**
 * Stop all scheduled jobs
 */
export function stopScheduler() {
  for (const job of jobs) {
    if (job.cronTask) {
      job.cronTask.stop();
    }
  }
  console.log('[Scheduler] All jobs stopped');
}

/**
 * Get status of all jobs
 * @returns {Array<{name: string, schedule: string, running: boolean}>}
 */
export function getJobStatus() {
  return jobs.map(job => ({
    name: job.name,
    schedule: job.schedule,
    running: job.cronTask?.running ?? false
  }));
}

/**
 * Manually trigger a job by name
 * @param {string} name
 */
export async function triggerJob(name) {
  const job = jobs.find(j => j.name === name);
  if (!job) {
    throw new Error(`Job not found: ${name}`);
  }
  await wrapTask(job.name, job.task)();
}

// ============================================================
// Default Jobs Configuration
// ============================================================

/**
 * Initialize default scheduled jobs for the IPTV proxy
 */
export function initDefaultJobs() {
  // Health check every 30 minutes, run on startup
  registerJob(
    'Channel Health Check',
    '*/30 * * * *',
    runHealthCheck,
    true
  );

  // EPG refresh every 6 hours, run on startup
  registerJob(
    'EPG Refresh',
    '0 */6 * * *',
    refreshEPG,
    false // EPG is already loaded during setupEPGRoutes
  );
}

export default {
  registerJob,
  startScheduler,
  stopScheduler,
  getJobStatus,
  triggerJob,
  initDefaultJobs
};
