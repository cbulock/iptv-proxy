import cron from 'node-cron';
import express from 'express';
import { runHealthCheck } from '../scripts/check-channel-health.js';
import { refreshEPG } from './epg.js';
import { requireAuth } from './auth.js';

// Constants for external URLs used in error messages
const CRON_VALIDATOR_URL = 'https://crontab.guru/';

/**
 * @typedef {Object} ScheduledJob
 * @property {string} name - Human readable name
 * @property {string} schedule - Cron expression
 * @property {Function} task - Async function to execute
 * @property {boolean} runOnStart - Whether to run immediately on startup
 * @property {import('node-cron').ScheduledTask} [cronTask] - The scheduled cron task
 * @property {string|null} lastRun - ISO timestamp of last run
 * @property {string|null} lastStatus - 'success' | 'failed' | null
 * @property {number|null} lastDuration - Duration in ms of last run
 * @property {boolean} isRunning - Whether the job is currently executing
 */

/** @type {ScheduledJob[]} */
const jobs = [];

/**
 * Wraps a task with logging, error handling, and status tracking
 * @param {ScheduledJob} job
 * @returns {Function}
 */
function wrapTask(job) {
  return async () => {
    if (job.isRunning) {
      console.log(`[Scheduler] Skipping job (already running): ${job.name}`);
      return;
    }
    
    const startTime = Date.now();
    job.isRunning = true;
    console.log(`[Scheduler] Starting job: ${job.name}`);
    
    try {
      await job.task();
      const duration = Date.now() - startTime;
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'success';
      job.lastDuration = duration;
      console.log(`[Scheduler] Completed job: ${job.name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - startTime;
      job.lastRun = new Date().toISOString();
      job.lastStatus = 'failed';
      job.lastDuration = duration;
      job.lastError = err.message;
      console.error(`[Scheduler] Job failed: ${job.name} (${duration}ms)`, err.message);
    } finally {
      job.isRunning = false;
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
    const errorMsg = `Invalid cron expression for job "${name}": ${schedule}`;
    console.error(`❌ ${errorMsg}`);
    console.log(`   💡 Fix: Use valid cron syntax (minute hour day month weekday)`);
    console.log(`      Examples:`);
    console.log(`      • Every hour: "0 * * * *"`);
    console.log(`      • Every 6 hours: "0 */6 * * *"`);
    console.log(`      • Daily at 3 AM: "0 3 * * *"`);
    console.log(`      • Twice daily: "0 6,18 * * *"`);
    console.log(`      • Validate at: ${CRON_VALIDATOR_URL}`);
    throw new Error(errorMsg);
  }

  jobs.push({
    name,
    schedule,
    task,
    runOnStart,
    cronTask: null,
    lastRun: null,
    lastStatus: null,
    lastDuration: null,
    lastError: null,
    isRunning: false
  });

  console.log(`[Scheduler] Registered job: ${name} (${schedule})`);
}

/**
 * Start all registered jobs
 */
export async function startScheduler() {
  console.log(`[Scheduler] Starting ${jobs.length} scheduled jobs...`);

  for (const job of jobs) {
    const wrappedTask = wrapTask(job);

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
 * @returns {Array<{name: string, schedule: string, running: boolean, lastRun: string|null, lastStatus: string|null, lastDuration: number|null, lastError: string|null, isRunning: boolean}>}
 */
export function getJobStatus() {
  return jobs.map(job => ({
    name: job.name,
    schedule: job.schedule,
    running: job.cronTask?.running ?? false,
    lastRun: job.lastRun,
    lastStatus: job.lastStatus,
    lastDuration: job.lastDuration,
    lastError: job.lastError,
    isRunning: job.isRunning
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
  await wrapTask(job)();
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

// ============================================================
// Express Router for Scheduler API
// ============================================================

const schedulerRouter = express.Router();

// Apply authentication to all /api/scheduler routes
schedulerRouter.use(requireAuth);

/**
 * GET /api/scheduler/jobs - Get all scheduled jobs and their status
 */
schedulerRouter.get('/jobs', (req, res) => {
  res.json({ jobs: getJobStatus() });
});

/**
 * POST /api/scheduler/jobs/:name/run - Manually trigger a job
 */
schedulerRouter.post('/jobs/:name/run', async (req, res) => {
  const jobName = decodeURIComponent(req.params.name);
  try {
    // Don't await - return immediately and let job run in background
    const job = jobs.find(j => j.name === jobName);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${jobName}` });
    }
    if (job.isRunning) {
      return res.status(409).json({ error: 'Job is already running', job: getJobStatus().find(j => j.name === jobName) });
    }
    
    // Start the job in background
    wrapTask(job)().catch(() => {});
    
    res.json({ 
      status: 'started', 
      message: `Job "${jobName}" started`,
      job: getJobStatus().find(j => j.name === jobName)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { schedulerRouter };

export default {
  registerJob,
  startScheduler,
  stopScheduler,
  getJobStatus,
  triggerJob,
  initDefaultJobs,
  schedulerRouter
};
