# API Documentation

## Error Handling

All API endpoints now provide consistent error responses with appropriate HTTP status codes.

### Error Response Format

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "path": "/api/endpoint",
  "timestamp": "2025-12-30T20:00:00.000Z",
  "details": "Additional error details (optional)"
}
```

### HTTP Status Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request parameters or body
- `404 Not Found` - Resource or endpoint not found
- `500 Internal Server Error` - Unexpected server error
- `502 Bad Gateway` - Upstream service (M3U/EPG source) unavailable
- `503 Service Unavailable` - Service not ready (e.g., EPG not loaded)

### Example Error Responses

**404 Not Found:**

```json
{
  "error": "Not Found",
  "message": "The requested resource was not found",
  "path": "/nonexistent",
  "method": "GET"
}
```

**503 Service Unavailable:**

```json
{
  "error": "EPG not loaded yet",
  "message": "EPG not loaded yet",
  "path": "/xmltv.xml",
  "timestamp": "2025-12-30T20:00:00.000Z"
}
```

**500 Internal Server Error:**

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "path": "/lineup.m3u",
  "timestamp": "2025-12-30T20:00:00.000Z"
}
```

## Reverse Proxy Support

The server fully supports reverse proxy deployments with proper header forwarding.

### Supported Headers

The following headers are honored for base URL generation:

- `X-Forwarded-Proto` - Protocol (http/https)
- `X-Forwarded-Protocol` - Alternative protocol header
- `X-Url-Scheme` - Alternative protocol header
- `X-Forwarded-Ssl` - Set to "on" for HTTPS
- `X-Forwarded-Host` - Original host header

### Example Configuration

**Nginx:**

```nginx
location / {
    proxy_pass http://localhost:34400;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Apache:**

```apache
<Location />
    ProxyPass http://localhost:34400/
    ProxyPassReverse http://localhost:34400/
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Host "%{HTTP_HOST}e"
</Location>
```

## Health Check Endpoints

### GET /health

Basic health check that returns 200 if the server is running.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-12-30T20:00:00.000Z"
}
```

### GET /health/live

Liveness probe for Kubernetes or Docker health checks. Indicates if the server process is running.

**Response:**

```json
{
  "status": "ok",
  "message": "Server is alive",
  "timestamp": "2025-12-30T20:00:00.000Z"
}
```

### GET /health/ready

Readiness probe that checks if the server is ready to handle requests. Returns 200 if ready, 503 if not ready.

**Response (Ready):**

```json
{
  "timestamp": "2025-12-30T20:00:00.000Z",
  "ready": true,
  "checks": {
    "channels": {
      "status": "ok",
      "count": 42,
      "available": true
    },
    "channelsFile": {
      "status": "ok",
      "size": 12345,
      "modified": "2025-12-30T19:00:00.000Z"
    }
  }
}
```

**Response (Not Ready):**

```json
{
  "timestamp": "2025-12-30T20:00:00.000Z",
  "ready": false,
  "checks": {
    "channels": {
      "status": "warning",
      "count": 0,
      "available": false,
      "message": "No channels loaded"
    },
    "channelsFile": {
      "status": "ok",
      "size": 2,
      "modified": "2025-12-30T19:00:00.000Z"
    }
  }
}
```

## Diagnostics Endpoints

### GET /status

Comprehensive system diagnostics endpoint that provides information about the current state of the IPTV proxy.

**Response:**

```json
{
  "timestamp": "2025-12-30T04:19:09.594Z",
  "uptime": 41.195943614,
  "channels": {
    "total": 4,
    "bySource": {
      "TestSource": 3,
      "OtherSource": 1
    },
    "mapped": 2,
    "unmapped": 2,
    "file": {
      "size": 947,
      "modified": "2025-12-30T04:13:25.480Z"
    }
  },
  "sources": {
    "m3u": {
      "count": 2,
      "configured": [
        {
          "name": "TestSource",
          "type": "m3u",
          "url": "http://example.com/playlist.m3u"
        }
      ],
      "status": {
        "TestSource": {
          "status": "success",
          "lastUpdate": "2025-12-30T04:13:25.480Z",
          "error": null
        }
      }
    },
    "epg": {
      "count": 1,
      "configured": [
        {
          "name": "TestSource",
          "url": "http://example.com/epg.xml"
        }
      ]
    }
  },
  "mappings": {
    "total": 5,
    "channelsCovered": 2,
    "channelsNotCovered": 2,
    "coveragePercent": 50
  },
  "parsing": {
    "lastUpdate": "2025-12-30T04:13:25.480Z",
    "recentErrors": []
  }
}
```

## Dynamic Mapping Management Endpoints

### POST /api/mapping

Add or update a single channel mapping.

**Request Body:**

```json
{
  "key": "Channel Name",
  "mapping": {
    "name": "New Channel Name",
    "tvg_id": "channel.id",
    "number": "101",
    "logo": "http://example.com/logo.png"
  }
}
```

**Response:**

```json
{
  "status": "saved",
  "key": "Channel Name",
  "mapping": {
    "name": "New Channel Name",
    "tvg_id": "channel.id",
    "number": "101",
    "logo": "http://example.com/logo.png"
  }
}
```

### DELETE /api/mapping/:key

Remove a channel mapping by key. The key should be URL-encoded.

**Example:**

```bash
DELETE /api/mapping/Channel%20Name
```

**Response:**

```json
{
  "status": "deleted",
  "key": "Channel Name"
}
```

### POST /api/mapping/bulk

Add or update multiple channel mappings at once.

**Request Body:**

```json
{
  "mappings": {
    "Channel A": {
      "name": "Channel A HD",
      "tvg_id": "a.1",
      "number": "1"
    },
    "Channel B": {
      "name": "Channel B HD",
      "tvg_id": "b.2",
      "number": "2"
    }
  }
}
```

**Response:**

```json
{
  "status": "saved",
  "count": 2
}
```

## Filtering on Existing Endpoints

### GET /lineup.m3u

The M3U playlist endpoint now supports filtering by source or group.

**Query Parameters:**

- `source` - Filter channels by source name (e.g., `?source=TestSource`)
- `group` - Filter channels by group-title (mapped to source name)

**Examples:**

```bash
# Get all channels from TestSource
GET /lineup.m3u?source=TestSource

# Get all channels from a specific group
GET /lineup.m3u?group=TestSource
```

### GET /xmltv.xml

The XMLTV EPG endpoint now supports filtering by source or specific channel IDs.

**Query Parameters:**

- `source` - Filter EPG data by source name (e.g., `?source=TestSource`)
- `channels` - Comma-separated list of channel IDs to include (e.g., `?channels=test1,test2,demo1`)

**Examples:**

```bash
# Get EPG data only for TestSource channels
GET /xmltv.xml?source=TestSource

# Get EPG data for specific channels
GET /xmltv.xml?channels=test1,test2,demo1
```

## Existing Endpoints

The following endpoints remain available:

- `GET /lineup.json` - JSON lineup for HDHomeRun compatibility
- `GET /channels` - List all channels
- `GET /api/config/m3u` - Get M3U configuration
- `GET /api/config/epg` - Get EPG configuration
- `GET /api/config/app` - Get app configuration
- `GET /api/config/channel-map` - Get channel mappings
- `PUT /api/config/m3u` - Update M3U configuration
- `PUT /api/config/epg` - Update EPG configuration
- `PUT /api/config/app` - Update app configuration
- `PUT /api/config/channel-map` - Update channel mappings
- `POST /api/reload/channels` - Reload channels from sources
- `POST /api/reload/epg` - Reload EPG data
- `GET /api/channel-health` - Get channel health status
- `POST /api/channel-health/run` - Run channel health check
- `GET /api/mapping/candidates` - Get mapping candidates
- `GET /api/mapping/unmapped` - Get unmapped channels
- `GET /api/mapping/conflicts` - Get mapping conflicts

All endpoints now include proper error handling and will return appropriate HTTP status codes with detailed error messages.

---

## Cache Management

The IPTV Proxy includes a sophisticated caching system to improve performance and reduce load on source servers.

### GET /api/cache/stats

Get statistics for all caches.

**Response:**

```json
{
  "caches": {
    "epg": {
      "name": "epg",
      "size": 5,
      "ttl": 21600000,
      "hits": 150,
      "misses": 10,
      "hitRate": "93.75%",
      "entries": [
        {
          "key": "https://example.com|source:|channels:",
          "age": 3600,
          "ttlRemaining": 18000,
          "expired": false
        }
      ]
    },
    "m3u": {
      "name": "m3u",
      "size": 3,
      "ttl": 3600000,
      "hits": 200,
      "misses": 5,
      "hitRate": "97.56%",
      "entries": []
    }
  },
  "timestamp": "2026-01-11T03:00:00.000Z"
}
```

### POST /api/cache/clear

Clear all caches.

**Response:**

```json
{
  "status": "success",
  "message": "All caches cleared",
  "timestamp": "2026-01-11T03:00:00.000Z"
}
```

### POST /api/cache/clear/:name

Clear a specific cache by name.

**URL Parameters:**

- `name` - Cache name (e.g., `epg`, `m3u`, `lineup-json`)

**Response:**

```json
{
  "status": "success",
  "message": "Cache 'epg' cleared",
  "timestamp": "2026-01-11T03:00:00.000Z"
}
```

### PUT /api/cache/ttl/:name

Update the TTL for a specific cache.

**URL Parameters:**

- `name` - Cache name

**Request Body:**

```json
{
  "ttl": 7200
}
```

Note: TTL is in seconds.

**Response:**

```json
{
  "status": "success",
  "message": "Cache 'epg' TTL updated",
  "name": "epg",
  "ttl": 7200,
  "timestamp": "2026-01-11T03:00:00.000Z"
}
```

---

## Preview API

The Preview API allows you to test configuration changes before saving them.

### POST /api/preview/m3u

Preview merged M3U playlist with temporary configuration.

**Request Body:**

```json
{
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
      "tvg_id": "channel-id"
    }
  }
}
```

**Response:**
Returns an M3U playlist file with `Content-Type: application/x-mpegURL`.

### POST /api/preview/channels

Preview merged channels as JSON with temporary configuration.

**Request Body:**

```json
{
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
      "number": "100"
    }
  }
}
```

**Response:**

```json
{
  "channels": [
    {
      "name": "Channel Name",
      "tvg_id": "channel-id",
      "logo": "https://example.com/logo.png",
      "url": "https://example.com/stream",
      "guideNumber": "100",
      "source": "Test Source"
    }
  ],
  "count": 1,
  "sources": ["Test Source"]
}
```

### POST /api/preview/epg

Preview merged EPG with temporary configuration.

**Request Body:**

```json
{
  "epgConfig": {
    "urls": [
      {
        "name": "Test EPG",
        "url": "https://example.com/xmltv.xml"
      }
    ]
  },
  "channels": [
    {
      "name": "Channel Name",
      "tvg_id": "channel-id",
      "source": "Test EPG"
    }
  ]
}
```

**Response:**
Returns an XMLTV file with `Content-Type: application/xml`.

### POST /api/preview/epg/json

Preview merged EPG as JSON with temporary configuration.

**Request Body:**

```json
{
  "epgConfig": {
    "urls": [
      {
        "name": "Test EPG",
        "url": "https://example.com/xmltv.xml"
      }
    ]
  },
  "channels": [
    {
      "name": "Channel Name",
      "tvg_id": "channel-id",
      "source": "Test EPG"
    }
  ]
}
```

**Response:**

```json
{
  "channels": 50,
  "programmes": 1000,
  "sources": ["Test EPG"],
  "data": {
    "tv": {
      "channel": [],
      "programme": []
    }
  }
}
```
