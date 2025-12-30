import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is one level up from libs/
export const PROJECT_ROOT = join(__dirname, '..');

// Config directory
export const CONFIG_DIR = join(PROJECT_ROOT, 'config');

// Data directory
export const DATA_DIR = join(PROJECT_ROOT, 'data');

// Helper function to get config file path
export function getConfigPath(filename) {
  return join(CONFIG_DIR, filename);
}

// Helper function to get data file path
export function getDataPath(filename) {
  return join(DATA_DIR, filename);
}

export default {
  PROJECT_ROOT,
  CONFIG_DIR,
  DATA_DIR,
  getConfigPath,
  getDataPath
};
