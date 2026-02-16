import { describe, it } from 'mocha';
import { expect } from 'chai';
import getBaseUrl from '../../libs/getBaseUrl.js';

describe('getBaseUrl', () => {
  describe('Standard Request', () => {
    it('should return base URL from protocol and host', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://example.com');
    });

    it('should handle HTTPS protocol', () => {
      const req = {
        protocol: 'https',
        get: (header) => {
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should include port in host', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'host') return 'example.com:8080';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://example.com:8080');
    });
  });

  describe('X-Forwarded-Proto Header', () => {
    it('should use X-Forwarded-Proto over req.protocol', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Proto') return 'https';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should handle X-Forwarded-Proto with http', () => {
      const req = {
        protocol: 'https',
        get: (header) => {
          if (header === 'X-Forwarded-Proto') return 'http';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://example.com');
    });
  });

  describe('X-Forwarded-Host Header', () => {
    it('should use X-Forwarded-Host over host header', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Host') return 'proxy.example.com';
          if (header === 'host') return 'internal.local';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://proxy.example.com');
    });

    it('should handle X-Forwarded-Host with port', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Host') return 'proxy.example.com:443';
          if (header === 'host') return 'internal.local';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://proxy.example.com:443');
    });
  });

  describe('Combined Reverse Proxy Headers', () => {
    it('should use both X-Forwarded-Proto and X-Forwarded-Host', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Proto') return 'https';
          if (header === 'X-Forwarded-Host') return 'proxy.example.com';
          if (header === 'host') return 'internal.local';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://proxy.example.com');
    });

    it('should reconstruct proper URL behind reverse proxy', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Proto') return 'https';
          if (header === 'X-Forwarded-Host') return 'public.example.com:8443';
          if (header === 'host') return 'localhost:3000';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://public.example.com:8443');
    });
  });

  describe('Alternative Headers', () => {
    it('should use X-Forwarded-Protocol as alternative to X-Forwarded-Proto', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Protocol') return 'https';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should use X-Url-Scheme as alternative to X-Forwarded-Proto', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Url-Scheme') return 'https';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should use X-Forwarded-Ssl to detect HTTPS', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Ssl') return 'on';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should not use HTTPS when X-Forwarded-Ssl is off', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Ssl') return 'off';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://example.com');
    });
  });

  describe('Header Priority', () => {
    it('should prefer X-Forwarded-Proto over X-Forwarded-Protocol', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Proto') return 'https';
          if (header === 'X-Forwarded-Protocol') return 'http';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should prefer X-Forwarded-Protocol over X-Url-Scheme', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Forwarded-Protocol') return 'https';
          if (header === 'X-Url-Scheme') return 'http';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('https://example.com');
    });

    it('should prefer X-Url-Scheme over X-Forwarded-Ssl', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'X-Url-Scheme') return 'http';
          if (header === 'X-Forwarded-Ssl') return 'on';
          if (header === 'host') return 'example.com';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing headers gracefully', () => {
      const req = {
        protocol: 'http',
        get: () => undefined,
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://undefined');
    });

    it('should handle IPv4 addresses', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'host') return '192.168.1.1:3000';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://192.168.1.1:3000');
    });

    it('should handle IPv6 addresses', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'host') return '[::1]:3000';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://[::1]:3000');
    });

    it('should handle localhost', () => {
      const req = {
        protocol: 'http',
        get: (header) => {
          if (header === 'host') return 'localhost:3000';
          return undefined;
        },
      };

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).to.equal('http://localhost:3000');
    });
  });
});
