# IPTV Proxy: Unified Channel and EPG Aggregator

This project provides a simple IPTV proxy that aggregates multiple sources (M3U playlists and HDHomeRun tuners) and merges them into a unified M3U and XMLTV feed. This is ideal for use with media frontends like Plex, Jellyfin, or Emby.

## Features

- 🧩 Merge multiple M3U sources into a single playlist
- 🗓️ Merge multiple EPG sources (including local files) into a unified `xmltv.xml`
- 📺 Channel mapping to control display names, guide numbers, logos, and groups
- 🧠 Fallback guide info via guide number when `tvg_id` is missing
- 🔁 HTTP server that hosts `/lineup.m3u` and `/xmltv.xml`
- 🛡️ Robust error handling for malformed sources and network failures
- 🔄 Graceful handling of invalid M3U entries and XML data
- 🌐 Full reverse proxy support with `X-Forwarded-*` headers
- 💚 Health check endpoints for monitoring and orchestration (liveness, readiness)
- 🎯 **NEW:** Smart channel mapping with fuzzy matching suggestions
- 🔍 **NEW:** Automatic duplicate channel detection
- ✅ **NEW:** EPG validation with coverage analysis
- 🔧 **NEW:** Dynamic channel management API (reorder, rename, group)
- ⚡ **NEW:** Advanced caching system with configurable TTL for EPG and M3U data
- 👁️ **NEW:** Live preview API to test configuration changes before saving

This project was inspired by [xTeVe](https://github.com/xteve-project/xTeVe) and [Threadfin](https://github.com/Threadfin/Threadfin), but I wanted something a little lighter and had better control over using the feeds through reverse proxies.

---

## Getting Started

### 1. Installation

```bash
git clone https://github.com/cbulock/iptv-proxy
cd iptv-proxy
npm install
```

### 2. Running the Server

```bash
npm start
```

By default, the server runs on `http://localhost:34400` and serves:

- `http://localhost:34400/lineup.m3u`
- `http://localhost:34400/xmltv.xml`

---

## Configuration

All configuration is done in `epg.yaml`, `m3u.yaml`, and `channel-map.yaml`.

### `epg.yaml`

Define all EPG sources here.

```yaml
urls:
  - name: "ErsatzTV"
    url: "https://ersatztv.local/iptv/xmltv.xml"
  - name: "HDHomeRun"
    url: "file://./data/epg.xml"
```

### `M3U.yaml`

Define all M3U, M3U8, and HDHR sources here.

```yaml
urls:
  - name: "ErsatzTV"
    url: "https://ersatztv.local/iptv/channels.m3u"
  - name: "HDHomeRun"
    type: "hdhomerun"
    url: "http://antenna.local"
```

### `channel-map.yaml`

Use this file to normalize channel metadata. You can define mapping by either channel `name` or `tvg_id`.

```yaml
"The Simpsons":
  number: "104"
  tvg_id: "C3.147.ersatztv.org"
  group: "Entertainment"
"Evening Comedy":
  number: "120"
  tvg_id: "C20.194.ersatztv.org"
  name: "Comedy Channel"
"FOX 47":
  number: "47"
  tvg_id: "47.1"
  logo: "http://example.com/logo.png"
```

**Available mapping fields:**
- `name` - Override the display name
- `number` - Set the guide/channel number
- `tvg_id` - Set or override the tvg-id
- `logo` - Set or override the logo URL
- `group` - Set the group-title (category) for the channel
- `url` - Override the stream URL

### Channel Mapping Precedence

1. `name` is tried first when applying the mapping.
2. If no match is found, `tvg_id` is tried.
3. If neither is matched, the original data is used.
4. If no `tvg_id` is present after mapping, the `guideNumber` is used as a fallback.

---

## Running in Docker

You can build and run IPTV-Proxy in a container. The folder `/config` inside the container is where your YAML configs live, so you must mount your host `config/` directory there.

### Build the image

```bash
docker build -t iptv-proxy .
```

### Run the container

```bash
docker run -d \
  --name iptv-proxy \
  -p 34400:34400 \
  -v /absolute/path/to/your/project/config:/config \
  iptv-proxy
```

**Note:** The config directory location is determined by the `CONFIG_PATH` environment variable (defaults to `/config` in Docker). If you need to use a different path, you can override it:

```bash
docker run -d \
  --name iptv-proxy \
  -p 34400:34400 \
  -e CONFIG_PATH=/custom/config/path \
  -v /absolute/path/to/your/project/config:/custom/config/path \
  iptv-proxy
```

---

## Adding HDHomeRun Devices

If a source entry includes an `hdhomerun` URL, the server will automatically:

- Fetch `discover.json`
- Build a fake M3U playlist
- Tag channels with device info

This allows you to use OTA tuners like any other playlist source.

---

## Advanced Configuration

### Running Behind a Reverse Proxy

IPTV Proxy is designed to work seamlessly behind reverse proxies like nginx, Caddy, or Traefik. The application automatically detects the correct base URL from forwarded headers.

#### Nginx Configuration

```nginx
server {
    listen 80;
    server_name iptv.example.com;

    location / {
        proxy_pass http://localhost:34400;
        proxy_http_version 1.1;
        
        # Forward client information
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # WebSocket support (for admin UI)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

For HTTPS with Let's Encrypt:

```nginx
server {
    listen 443 ssl http2;
    server_name iptv.example.com;
    
    ssl_certificate /etc/letsencrypt/live/iptv.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/iptv.example.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:34400;
        proxy_http_version 1.1;
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### Caddy Configuration

Caddy automatically handles headers and SSL certificates:

```caddy
iptv.example.com {
    reverse_proxy localhost:34400
}
```

With a subfolder path:

```caddy
example.com {
    reverse_proxy /iptv/* localhost:34400
}
```

#### Traefik Configuration (Docker Compose)

```yaml
services:
  iptv-proxy:
    image: ghcr.io/cbulock/iptv-proxy:latest
    container_name: iptv-proxy
    volumes:
      - ./config:/config
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.iptv.rule=Host(`iptv.example.com`)"
      - "traefik.http.routers.iptv.entrypoints=websecure"
      - "traefik.http.routers.iptv.tls.certresolver=letsencrypt"
      - "traefik.http.services.iptv.loadbalancer.server.port=34400"
```

### Docker Compose Setup

Here's a complete Docker Compose configuration:

```yaml
version: '3.8'

services:
  iptv-proxy:
    image: ghcr.io/cbulock/iptv-proxy:latest
    container_name: iptv-proxy
    restart: unless-stopped
    ports:
      - "34400:34400"
    volumes:
      - ./config:/config
    environment:
      - TZ=America/New_York
      # Optional: Set explicit base URL if auto-detection doesn't work
      # - BASE_URL=https://iptv.example.com
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:34400/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Using with Media Servers

#### Plex Live TV & DVR

1. Go to Settings → Live TV & DVR
2. Click "Set Up Plex DVR"
3. Enter the tuner URL: `http://your-server:34400/`
4. Plex will auto-detect the HDHomeRun-compatible lineup
5. Enter the EPG URL: `http://your-server:34400/xmltv.xml`
6. Complete the channel mapping in Plex

#### Jellyfin Live TV

1. Go to Dashboard → Live TV
2. Add a new "Tuner Device"
3. Select "M3U Tuner"
4. Enter the M3U URL: `http://your-server:34400/lineup.m3u`
5. Enter the EPG URL: `http://your-server:34400/xmltv.xml`
6. Save and refresh guide data

#### Emby Live TV

1. Go to Settings → Live TV
2. Click "Add" under TV Sources
3. Select "M3U Playlist"
4. Enter the M3U URL: `http://your-server:34400/lineup.m3u`
5. Enter the EPG URL: `http://your-server:34400/xmltv.xml`
6. Configure refresh intervals and save

### Cache Configuration

IPTV Proxy includes an advanced caching system to improve performance and reduce load on upstream sources.

#### Configuring Cache TTL

Add cache settings to your `app.yaml`:

```yaml
cache:
  # EPG cache TTL in seconds (default: 21600 = 6 hours)
  epg_ttl: 21600
  
  # M3U cache TTL in seconds (default: 3600 = 1 hour)
  m3u_ttl: 3600
```

Setting TTL to `0` disables automatic expiration (cache persists until manually cleared).

#### Cache Management API

- `GET /api/cache/stats` - View cache statistics and hit rates
- `POST /api/cache/clear` - Clear all caches
- `POST /api/cache/clear/:name` - Clear specific cache (e.g., `epg`, `m3u`)
- `PUT /api/cache/ttl/:name` - Update TTL for specific cache

**Example: View cache statistics**
```bash
curl http://localhost:34400/api/cache/stats
```

**Example: Clear EPG cache**
```bash
curl -X POST http://localhost:34400/api/cache/clear/epg
```

**Example: Update M3U cache TTL to 2 hours**
```bash
curl -X PUT http://localhost:34400/api/cache/ttl/m3u \
  -H "Content-Type: application/json" \
  -d '{"ttl": 7200}'
```

### Preview API

Test configuration changes before saving them with the preview API.

#### Preview M3U Changes

```bash
curl -X POST http://localhost:34400/api/preview/m3u \
  -H "Content-Type: application/json" \
  -d '{
    "m3uConfig": {
      "urls": [
        {
          "name": "Test Source",
          "url": "https://example.com/playlist.m3u"
        }
      ]
    },
    "channelMapConfig": {
      "Channel Name": {
        "number": "100",
        "tvg_id": "custom-id"
      }
    }
  }'
```

Returns the merged M3U playlist with your temporary configuration applied.

#### Preview Channels as JSON

```bash
curl -X POST http://localhost:34400/api/preview/channels \
  -H "Content-Type: application/json" \
  -d '{
    "m3uConfig": { ... },
    "channelMapConfig": { ... }
  }'
```

Returns channel data as JSON for inspection before saving.

#### Preview EPG Changes

```bash
curl -X POST http://localhost:34400/api/preview/epg \
  -H "Content-Type: application/json" \
  -d '{
    "epgConfig": {
      "urls": [
        {
          "name": "Test EPG",
          "url": "https://example.com/xmltv.xml"
        }
      ]
    },
    "channels": [...]
  }'
```

Returns the merged XMLTV with your temporary configuration applied.

### Environment Variables

- `PORT` - HTTP server port (default: 34400)
- `CONFIG_PATH` - Configuration directory (default: `./config`)
- `NODE_ENV` - Node environment (default: `production`)

### Example Configurations

For more detailed configuration examples covering edge cases, see the `config/examples/` directory:

- `m3u.example.yaml` - Comprehensive M3U source examples
- `epg.example.yaml` - EPG source configuration examples
- `channel-map.example.yaml` - Advanced channel mapping scenarios
- `app.example.yaml` - Application settings and scheduler configuration

---

## Troubleshooting

### Common Issues

#### Channels Not Appearing

**Problem:** M3U playlist is empty or channels are missing.

**Solutions:**
1. Check that your M3U sources are accessible:
   ```bash
   curl -I http://your-source/playlist.m3u
   ```
2. Review server logs for source fetch errors
3. Verify config files are valid YAML (use a YAML validator)
4. Ensure source URLs in `m3u.yaml` are correct
5. Check API status endpoint: `http://localhost:34400/status`

#### EPG Data Not Showing

**Problem:** Program guide is empty in your media player.

**Solutions:**
1. Verify channel IDs match between M3U and XMLTV:
   - M3U channels need `tvg-id` attribute
   - XMLTV must have `<channel id="...">` matching the tvg-id
2. Check EPG sources are accessible and contain data
3. Use channel-map.yaml to normalize tvg_id across sources
4. Force EPG refresh: `POST http://localhost:34400/api/reload/epg`
5. Inspect the merged XMLTV: `curl http://localhost:34400/xmltv.xml | head -100`

#### HDHomeRun Device Not Found

**Problem:** HDHomeRun tuner doesn't show up in channel list.

**Solutions:**
1. Verify the device is on your network: `ping hdhomerun-device.local`
2. Test the discover endpoint: `curl http://device-ip/discover.json`
3. Ensure `type: "hdhomerun"` is set in m3u.yaml
4. Check firewall rules aren't blocking access
5. Try using IP address instead of hostname

#### Wrong URLs in M3U Playlist

**Problem:** Generated M3U contains wrong server addresses.

**Solutions:**
1. Set explicit `base_url` in `app.yaml`:
   ```yaml
   base_url: "https://iptv.example.com"
   ```
2. Ensure reverse proxy forwards headers correctly:
   - X-Forwarded-Proto
   - X-Forwarded-Host
   - X-Forwarded-For
3. Check that your reverse proxy configuration matches the examples above
4. Test URL generation: `curl -v http://localhost:34400/lineup.m3u`

#### Configuration Changes Not Applied

**Problem:** Updated config files but changes aren't visible.

**Solutions:**
1. Reload channels: `POST http://localhost:34400/api/reload/channels`
2. Reload EPG: `POST http://localhost:34400/api/reload/epg`
3. Or restart the server: `docker restart iptv-proxy`
4. Verify YAML syntax is valid (indentation matters!)
5. Check server logs for validation errors

#### Authentication Issues

**Problem:** Source requires authentication and returns 401/403 errors.

**Solutions:**
1. URL-encode credentials in the source URL:
   ```yaml
   url: "https://username:password@provider.com/playlist.m3u"
   ```
2. For complex authentication, consider using a local proxy
3. Check if the service requires API keys or tokens (may need code modification)
4. Test authentication separately with curl:
   ```bash
   curl -u username:password http://provider.com/playlist.m3u
   ```

#### High Memory Usage

**Problem:** Server consumes too much RAM.

**Solutions:**
1. Large EPG files can use significant memory - consider:
   - Filtering to only needed channels
   - Using smaller, source-specific EPG files
   - Increasing server resources
2. Check for memory leaks by monitoring over time
3. Reduce the number of concurrent source fetches
4. Consider pagination or streaming for very large files

#### Admin UI Not Available

**Problem:** Admin interface shows "Not Available" message.

**Solutions:**
1. Build the admin UI:
   ```bash
   npm run admin:build
   ```
2. Or run in development mode with hot reload:
   ```bash
   npm run dev
   ```
3. For Docker, ensure you're using an image with the admin UI built
4. Check that `public/admin/index.html` exists

#### Scheduler Not Running

**Problem:** EPG doesn't auto-refresh or scheduled tasks don't execute.

**Solutions:**
1. Check cron expression syntax in `app.yaml`
2. Verify scheduler is running: check `/api/scheduler/jobs` endpoint
3. Review server logs for scheduler errors
4. Test cron expressions using an online validator
5. Ensure time zone is set correctly (TZ environment variable)

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
DEBUG=* npm start
```

Or in Docker:

```yaml
environment:
  - DEBUG=*
```

### Getting Help

If you're still experiencing issues:

1. Check the [API documentation](API.md) for endpoint details
2. Review server logs for error messages
3. Use the `/status` endpoint to check system health
4. Open an issue on GitHub with:
   - Server logs
   - Configuration files (remove sensitive data)
   - Steps to reproduce the problem
   - Expected vs actual behavior

---

## API Endpoints

The server provides several API endpoints for configuration and management. See [API.md](API.md) for complete documentation.

**Key Endpoints:**
- `GET /lineup.m3u` - M3U playlist
- `GET /xmltv.xml` - EPG data
- `GET /status` - System diagnostics
- `GET /health` - Health check
- `POST /api/reload/channels` - Reload M3U sources
- `POST /api/reload/epg` - Reload EPG data
- `GET /api/config/*` - Get/update configuration

---

## Notes

- Your XMLTV sources can be remote URLs or local files (use `file://` prefix).
- M3U sources also support `file://` URLs for local files.
- All `tvg_id`s in channels must match the `<channel id="...">` in EPG sources to link correctly.
- Duplicate `tvg_id`s will be overwritten in favor of the last one processed.
- Configuration files are automatically created with defaults on first run.
- The server automatically caches channels and EPG data for performance.

---

## License

MIT
