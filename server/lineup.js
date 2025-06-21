import fs from 'fs';

export function setupLineupRoutes(app, config) {
  app.get('/lineup.json', (req, res) => {
    const channels = JSON.parse(fs.readFileSync('./data/channels.json', 'utf8'));

    const lineup = channels.map(channel => ({
      GuideNumber: channel.guideNumber || channel.tvg_id || channel.name,
      GuideName: channel.name,
      URL: channel.url
    }));

    res.json(lineup);
  });
}
