export function setupHDHRRoutes(app, config) {
  const baseURL = `http://${config.host || 'localhost'}:34400`;

  app.get('/discover.json', (req, res) => {
    res.json({
      FriendlyName: 'IPTV Proxy',
      ModelNumber: 'HDHR3-US',
      FirmwareName: 'iptv_proxy',
      FirmwareVersion: '20250620',
      DeviceID: '12345678',
      DeviceAuth: 'abcdef123456',
      BaseURL: baseURL,
      LineupURL: `${baseURL}/lineup.json`,
    });
  });

  app.get('/lineup_status.json', (req, res) => {
    res.json({
      ScanInProgress: 0,
      ScanPossible: 1,
      Source: 'Cable',
      SourceList: ['Cable'],
    });
  });
}
