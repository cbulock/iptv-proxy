import fs from 'fs';
import yaml from 'yaml';
import Joi from 'joi';
import chalk from 'chalk';
import { getConfigPath } from './paths.js';

// Constants for external URLs used in error messages
const YAML_VALIDATOR_URL = 'https://www.yamllint.com/';

// Define schemas for each config file
const m3uSchema = Joi.object({
  urls: Joi.array().items(
    Joi.object({
      name: Joi.string().required().messages({
        'any.required': 'Each M3U source must have a "name"',
        'string.empty': 'M3U source "name" cannot be empty'
      }),
      url: Joi.string().required().messages({
        'any.required': 'Each M3U source must have a "url"',
        'string.empty': 'M3U source "url" cannot be empty'
      }),
      type: Joi.string().valid('m3u', 'hdhomerun').lowercase().default('m3u').messages({
        'any.only': 'M3U source "type" must be either "m3u" or "hdhomerun"'
      })
    })
  ).default([])
}).default({ urls: [] });

const epgSchema = Joi.object({
  urls: Joi.array().items(
    Joi.object({
      name: Joi.string().required().messages({
        'any.required': 'Each EPG source must have a "name"',
        'string.empty': 'EPG source "name" cannot be empty'
      }),
      url: Joi.string().required().messages({
        'any.required': 'Each EPG source must have a "url"',
        'string.empty': 'EPG source "url" cannot be empty'
      })
    })
  ).default([])
}).default({ urls: [] });

const appSchema = Joi.object({
  base_url: Joi.string().uri({ allowRelative: false }).optional().allow(null, '').messages({
    'string.uri': 'app.yaml "base_url" must be a valid URL'
  })
}).unknown(true).default({});

const channelMapSchema = Joi.object().pattern(
  Joi.string(),
  Joi.object({
    name: Joi.string().optional(),
    number: Joi.string().optional(),
    tvg_id: Joi.string().optional(),
    logo: Joi.string().optional(),
    url: Joi.string().optional(),
    group: Joi.string().optional()
  }).or('name', 'number', 'tvg_id', 'logo', 'url', 'group').messages({
    'object.missing': 'Each channel mapping must have at least one property (name, number, tvg_id, logo, url, or group)'
  })
).default({});

// Default configurations
const defaultConfigs = {
  m3u: { urls: [] },
  epg: { urls: [] },
  app: {},
  channelMap: {}
};

/**
 * Load and validate a YAML config file
 * @param {string} path - Path to the YAML file
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {object} defaultValue - Default value if file doesn't exist or is invalid
 * @param {string} name - Human-readable name for logging
 * @returns {object} Validated config object
 */
function loadAndValidateConfig(path, schema, defaultValue, name) {
  try {
    // Check if file exists
    if (!fs.existsSync(path)) {
      console.warn(chalk.yellow(`⚠️  Config file not found: ${path}`));
      console.log(chalk.gray(`   Using default configuration for ${name}`));
      return defaultValue;
    }

    // Read and parse YAML
    const content = fs.readFileSync(path, 'utf8');
    let parsed;
    
    try {
      parsed = yaml.parse(content);
    } catch (parseError) {
      console.error(chalk.red(`❌ Failed to parse YAML in ${path}:`));
      console.error(chalk.red(`   ${parseError.message}`));
      console.log(chalk.yellow(`   💡 Fix: Check YAML syntax - common issues include:`));
      console.log(chalk.yellow(`      • Incorrect indentation (use spaces, not tabs)`));
      console.log(chalk.yellow(`      • Missing quotes around strings with special characters`));
      console.log(chalk.yellow(`      • Unclosed brackets or quotes`));
      console.log(chalk.yellow(`      • Use a YAML validator: ${YAML_VALIDATOR_URL}`));
      console.log(chalk.gray(`   Using default configuration for ${name}`));
      return defaultValue;
    }

    // Validate with Joi schema
    const { error, value } = schema.validate(parsed, {
      abortEarly: false,
      stripUnknown: false
    });

    if (error) {
      console.error(chalk.red(`❌ Validation errors in ${path}:`));
      for (const detail of error.details) {
        console.error(chalk.red(`   • ${detail.message}`));
      }
      console.log(chalk.yellow(`   💡 Fix: Review your configuration against the examples:`));
      console.log(chalk.yellow(`      • See config/examples/ for valid configuration templates`));
      console.log(chalk.yellow(`      • Ensure all required fields are present`));
      console.log(chalk.yellow(`      • Check that URLs are valid and accessible`));
      console.log(chalk.gray(`   Using default configuration for ${name}`));
      return defaultValue;
    }

    console.log(chalk.green(`✓ Loaded and validated ${name} from ${path}`));
    return value;

  } catch (err) {
    console.error(chalk.red(`❌ Unexpected error loading ${path}:`));
    console.error(chalk.red(`   ${err.message}`));
    console.log(chalk.gray(`   Using default configuration for ${name}`));
    return defaultValue;
  }
}

/**
 * Load all configuration files with validation
 * @returns {object} Object containing all validated configs
 */
export function loadAllConfigs() {
  const m3u = loadAndValidateConfig(
    getConfigPath('m3u.yaml'),
    m3uSchema,
    defaultConfigs.m3u,
    'M3U config'
  );

  const epg = loadAndValidateConfig(
    getConfigPath('epg.yaml'),
    epgSchema,
    defaultConfigs.epg,
    'EPG config'
  );

  const app = loadAndValidateConfig(
    getConfigPath('app.yaml'),
    appSchema,
    defaultConfigs.app,
    'App config'
  );

  const channelMap = loadAndValidateConfig(
    getConfigPath('channel-map.yaml'),
    channelMapSchema,
    defaultConfigs.channelMap,
    'Channel map'
  );

  return { m3u, epg, app, channelMap };
}

/**
 * Load a single config file with validation
 * @param {string} configType - Type of config: 'm3u', 'epg', 'app', or 'channelMap'
 * @returns {object} Validated config object
 */
export function loadConfig(configType) {
  const configs = {
    m3u: {
      path: getConfigPath('m3u.yaml'),
      schema: m3uSchema,
      default: defaultConfigs.m3u,
      name: 'M3U config'
    },
    epg: {
      path: getConfigPath('epg.yaml'),
      schema: epgSchema,
      default: defaultConfigs.epg,
      name: 'EPG config'
    },
    app: {
      path: getConfigPath('app.yaml'),
      schema: appSchema,
      default: defaultConfigs.app,
      name: 'App config'
    },
    channelMap: {
      path: getConfigPath('channel-map.yaml'),
      schema: channelMapSchema,
      default: defaultConfigs.channelMap,
      name: 'Channel map'
    }
  };

  const config = configs[configType];
  if (!config) {
    throw new Error(`Unknown config type: ${configType}`);
  }

  return loadAndValidateConfig(config.path, config.schema, config.default, config.name);
}

/**
 * Validate config data against a schema (for API updates)
 * @param {string} configType - Type of config: 'm3u', 'epg', 'app', or 'channelMap'
 * @param {object} data - Data to validate
 * @returns {object} { valid: boolean, value?: object, error?: string }
 */
export function validateConfigData(configType, data) {
  const schemas = {
    m3u: m3uSchema,
    epg: epgSchema,
    app: appSchema,
    channelMap: channelMapSchema
  };

  const schema = schemas[configType];
  if (!schema) {
    return { valid: false, error: `Unknown config type: ${configType}` };
  }

  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: false
  });

  if (error) {
    const errorMessage = error.details.map(d => d.message).join('; ');
    return { valid: false, error: errorMessage };
  }

  return { valid: true, value };
}

export default { loadAllConfigs, loadConfig, validateConfigData };
