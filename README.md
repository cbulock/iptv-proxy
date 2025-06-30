# IPTV Proxy: Unified Channel and EPG Aggregator

This project provides a simple IPTV proxy that aggregates multiple sources (M3U playlists and HDHomeRun tuners) and merges them into a unified M3U and XMLTV feed. This is ideal for use with media frontends like Plex, Jellyfin, or Emby.

## Features

- 🧩 Merge multiple M3U sources into a single playlist
- 🗓️ Merge multiple EPG sources (including local files) into a unified `xmltv.xml`
- 📺 Channel mapping to control display names, guide numbers, and logos
- 🧠 Fallback guide info via guide number when `tvg_id` is missing
- 🔁 HTTP server that hosts `/lineup.m3u` and `/xmltv.xml`

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
"Evening Comedy":
  number: "120"
  tvg_id: "C20.194.ersatztv.org"
"FOX 47":
  number: "47"
  tvg_id: "47.1"
```

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

---

## Adding HDHomeRun Devices

If a source entry includes an `hdhomerun` URL, the server will automatically:

- Fetch `discover.json`
- Build a fake M3U playlist
- Tag channels with device info

This allows you to use OTA tuners like any other playlist source.

---

## Notes

- Your XMLTV sources can be remote URLs or local files.
- All `tvg_id`s in channels must match the `<channel id="...">` in EPG sources to link correctly.
- Duplicate `tvg_id`s will be overwritten in favor of the last one processed.

---

## License

MIT
