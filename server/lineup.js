import fs from 'fs';

export function setupLineupRoutes(app, config) {
  const loadChannels = () =>
    JSON.parse(fs.readFileSync('./data/channels.json', 'utf8'));

  app.get('/lineup.json', (req, res) => {
    const channels = loadChannels();

    const lineup = channels.map(channel => ({
      GuideNumber: channel.guideNumber || channel.tvg_id || channel.name,
      GuideName: channel.name,
      URL: `${req.protocol}://${req.get('host')}/stream/${encodeURIComponent(channel.source)}/${encodeURIComponent(channel.name)}`

    }));

    res.json(lineup);
  });

  app.get('/lineup.m3u', (req, res) => {
    const channels = loadChannels();

    let output = '#EXTM3U\n';

    for (const channel of channels) {
      const tvgId = channel.tvg_id || '';
      const tvgName = channel.name || '';
      const tvgLogo = channel.logo || '';
      const groupTitle = channel.source || ''; // Optional: use source as group

      output += `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${tvgName}" tvg-logo="${tvgLogo}" group-title="${groupTitle}",${tvgName}\n`;
      output += `${channel.url}\n`;
    }

    res.set('Content-Type', 'application/x-mpegURL');
    res.send(output);
  });

  app.get('/stream/:source/:name', async (req, res) => {
    const { source, name } = req.params;
    const channels = JSON.parse(fs.readFileSync('./data/channels.json', 'utf8'));

    const channel = channels.find(
      c => c.source === source && c.name === name
    );

    if (!channel) return res.status(404).send('Channel not found');

    try {
      const response = await axios.get(channel.url, { responseType: 'stream' });
      res.set(response.headers);
      response.data.pipe(res);
    } catch (err) {
      console.warn(`Failed to proxy stream: ${err.message}`);
      res.status(502).send('Failed to fetch stream');
    }
  });
}
