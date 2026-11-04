import cron from 'node-cron';
import { exec } from 'child_process';

function runHealthCheck() {
  console.log(`[${new Date().toISOString()}] Running channel health check...`);

  exec('node scripts/check-channel-health.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`Health check error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`Health check stderr: ${stderr}`);
    }
    if (stdout) {
      console.log(`Health check output: ${stdout}`);
    }
  });
}

// Run immediately on startup
runHealthCheck();

// Schedule every 30 minutes
cron.schedule('*/30 * * * *', runHealthCheck);
