# Configuration Examples

This directory contains comprehensive example configuration files for IPTV Proxy. These examples cover common use cases, edge cases, and advanced scenarios.

## Files

- **`m3u.example.yaml`** - M3U playlist sources configuration
  - Standard M3U/M3U8 sources
  - HDHomeRun OTA tuner devices
  - Authentication examples
  - Local file sources
  - Edge cases and troubleshooting

- **`epg.example.yaml`** - EPG (Electronic Program Guide) sources
  - Remote XMLTV sources
  - Local XMLTV files
  - Third-party EPG aggregators
  - Channel ID matching guidance
  - Troubleshooting tips

- **`channel-map.example.yaml`** - Channel mapping and normalization
  - Basic channel mappings
  - HDHomeRun OTA channel mapping
  - Cable/IPTV channel mapping
  - ErsatzTV virtual channels
  - Edge cases and advanced mapping
  - Best practices

- **`app.example.yaml`** - Application configuration
  - Base URL configuration
  - Scheduler configuration (cron)
  - Reverse proxy setup
  - Environment variables
  - Advanced configuration examples

## How to Use

1. **Review the examples** to understand the configuration options
2. **Copy relevant sections** to your actual config files in the parent directory:
   - `../m3u.yaml`
   - `../epg.yaml`
   - `../channel-map.yaml`
   - `../app.yaml`
3. **Customize** the values to match your setup
4. **Test** your configuration by restarting the server or reloading configs via API

## Quick Start

To get started quickly, copy one of the example files:

```bash
# From the project root
cp config/examples/m3u.example.yaml config/m3u.yaml
cp config/examples/epg.example.yaml config/epg.yaml
cp config/examples/channel-map.example.yaml config/channel-map.yaml
cp config/examples/app.example.yaml config/app.yaml
```

Then edit the files to add your actual sources and mappings.

## Configuration Tips

### M3U Sources

- Each source must have a unique `name`
- The `type` field defaults to `"m3u"` if omitted
- HDHomeRun devices must use `type: "hdhomerun"`
- Use `file://` URLs for local files
- Sources are processed in the order listed

### EPG Sources

- The `name` should match your M3U source name for best results
- Channel IDs in EPG must match `tvg-id` in M3U
- Use channel-map.yaml to normalize IDs across sources
- EPG files are cached and refreshed periodically

### Channel Mapping

- Mappings are applied by matching channel `name` first, then `tvg_id`
- Always set a `number` field to control channel ordering
- Match `tvg_id` with XMLTV `<channel id="">` for EPG
- Changes require a channel reload or server restart

### Application Settings

- `base_url` is auto-detected from request headers if not set
- Use cron expressions for scheduler (minute hour day month weekday)
- See examples for reverse proxy configuration
- Set environment variables for PORT and CONFIG_PATH if needed

## Validation

All example files in this directory are valid YAML and follow the configuration schema. The server will validate your configuration files on startup and provide helpful error messages if there are issues.

## Troubleshooting

If you encounter issues:

1. **Check the server logs** for detailed error messages with fix suggestions
2. **Validate your YAML syntax** - use https://www.yamllint.com/
3. **Review the troubleshooting section** in the main README.md
4. **Test sources manually** with curl to verify accessibility
5. **Use the /status endpoint** to check system health

For more help, see the main [README.md](../../README.md) in the project root.
