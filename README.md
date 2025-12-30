# IPTV Proxy: Unified Channel and EPG Aggregator

This project provides a simple IPTV proxy that aggregates multiple sources (M3U playlists and HDHomeRun tuners) and merges them into a unified M3U and XMLTV feed. This is ideal for use with media frontends like Plex, Jellyfin, or Emby.

## Features

- 🧩 Merge multiple M3U sources into a single playlist
- 🗓️ Merge multiple EPG sources (including local files) into a unified `xmltv.xml`
- 📺 Channel mapping to control display names, guide numbers, logos, and groups
- 🧠 Fallback guide info via guide number when `tvg_id` is missing
- 🔁 HTTP server that hosts `/lineup.m3u` and `/xmltv.xml`
- 🎯 **NEW:** Smart channel mapping with fuzzy matching suggestions
- 🔍 **NEW:** Automatic duplicate channel detection
- ✅ **NEW:** EPG validation with coverage analysis
- 🔧 **NEW:** Dynamic channel management API (reorder, rename, group)

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

## Advanced Features

### Channel Management API

The server provides HTTP endpoints for dynamic channel management:

#### Reorder Channels
```bash
curl -X POST http://localhost:34400/api/channels/reorder \
  -H "Content-Type: application/json" \
  -d '{"channels": [
    {"name": "Channel One", "number": "101"},
    {"name": "Channel Two", "number": "102"}
  ]}'
```

#### Rename Channels
```bash
curl -X POST http://localhost:34400/api/channels/rename \
  -H "Content-Type: application/json" \
  -d '{"channels": [
    {"oldName": "Old Name", "newName": "New Name"}
  ]}'
```

#### Update Channel Groups
```bash
curl -X POST http://localhost:34400/api/channels/group \
  -H "Content-Type: application/json" \
  -d '{"channels": [
    {"name": "Channel One", "group": "Entertainment"}
  ]}'
```

#### Bulk Update (Combined Operations)
```bash
curl -X POST http://localhost:34400/api/channels/bulk-update \
  -H "Content-Type: application/json" \
  -d '{"channels": [
    {"name": "Old Name", "newName": "New Name", "number": "101", "group": "News"}
  ]}'
```

### Mapping Intelligence

#### Detect Duplicate Channels
```bash
curl http://localhost:34400/api/mapping/duplicates
```

Returns channels with duplicate names or tvg-ids, helping identify potential conflicts.

#### Auto-Suggest Mappings
```bash
curl "http://localhost:34400/api/mapping/suggestions?threshold=0.7&max=3"
```

Uses fuzzy matching (Levenshtein distance) to suggest potential mappings for unmapped channels. The `threshold` parameter controls match sensitivity (0-1), and `max` limits suggestions per channel.

### EPG Validation

Validate your merged EPG for correctness and coverage:

```bash
curl http://localhost:34400/api/epg/validate
```

Returns:
- Channel and programme counts
- Validation errors and warnings
- Coverage statistics (which channels have/lack EPG data)
- Detailed error information

### Admin Web Interface

Access the admin interface at `http://localhost:34400/admin/` to:
- Configure M3U and EPG sources
- Manage channel mappings visually
- View duplicate channels and mapping suggestions
- Validate EPG data and check coverage
- Monitor channel health and active viewers
- Manage scheduled tasks

**Note:** The admin UI must be built first:
```bash
npm run admin:build
```

Or for development with hot reload:
```bash
npm run dev
```

---

## Notes

- Your XMLTV sources can be remote URLs or local files (use `file://` prefix).
- M3U sources also support `file://` URLs for local files.
- All `tvg_id`s in channels must match the `<channel id="...">` in EPG sources to link correctly.
- Duplicate `tvg_id`s in the output M3U are automatically deduplicated with suffixes (e.g., `1.1_1`).

---

## License

MIT
