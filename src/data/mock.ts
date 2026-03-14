import type { BettingEvent, NewsArticle } from '../types/sports';

export const mockEvents: BettingEvent[] = [
  {
    id: 'nba-celtics-bucks',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    commenceTime: '2026-03-14T00:30:00Z',
    homeTeam: 'Milwaukee Bucks',
    awayTeam: 'Boston Celtics',
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        lastUpdate: '2026-03-13T18:45:00Z',
        markets: [
          {
            key: 'h2h',
            lastUpdate: '2026-03-13T18:45:00Z',
            outcomes: [
              { name: 'Boston Celtics', price: -118 },
              { name: 'Milwaukee Bucks', price: +102 },
            ],
          },
          {
            key: 'spreads',
            lastUpdate: '2026-03-13T18:45:00Z',
            outcomes: [
              { name: 'Boston Celtics', price: -108, point: -1.5 },
              { name: 'Milwaukee Bucks', price: -112, point: +1.5 },
            ],
          },
        ],
      },
      {
        key: 'fanduel',
        title: 'FanDuel',
        lastUpdate: '2026-03-13T18:48:00Z',
        markets: [
          {
            key: 'totals',
            lastUpdate: '2026-03-13T18:48:00Z',
            outcomes: [
              { name: 'Over', price: -110, point: 227.5 },
              { name: 'Under', price: -110, point: 227.5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'nhl-rangers-leafs',
    sportKey: 'icehockey_nhl',
    sportTitle: 'NHL',
    commenceTime: '2026-03-13T23:00:00Z',
    homeTeam: 'Toronto Maple Leafs',
    awayTeam: 'New York Rangers',
    bookmakers: [
      {
        key: 'caesars',
        title: 'Caesars',
        lastUpdate: '2026-03-13T18:40:00Z',
        markets: [
          {
            key: 'h2h',
            lastUpdate: '2026-03-13T18:40:00Z',
            outcomes: [
              { name: 'New York Rangers', price: +124 },
              { name: 'Toronto Maple Leafs', price: -138 },
            ],
          },
          {
            key: 'totals',
            lastUpdate: '2026-03-13T18:40:00Z',
            outcomes: [
              { name: 'Over', price: -105, point: 6.5 },
              { name: 'Under', price: -115, point: 6.5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'soccer-arsenal-liverpool',
    sportKey: 'soccer_epl',
    sportTitle: 'Premier League',
    commenceTime: '2026-03-14T15:00:00Z',
    homeTeam: 'Arsenal',
    awayTeam: 'Liverpool',
    bookmakers: [
      {
        key: 'betmgm',
        title: 'BetMGM',
        lastUpdate: '2026-03-13T18:35:00Z',
        markets: [
          {
            key: 'h2h',
            lastUpdate: '2026-03-13T18:35:00Z',
            outcomes: [
              { name: 'Arsenal', price: +150 },
              { name: 'Liverpool', price: +165 },
              { name: 'Draw', price: +235 },
            ],
          },
          {
            key: 'totals',
            lastUpdate: '2026-03-13T18:35:00Z',
            outcomes: [
              { name: 'Over', price: -102, point: 2.5 },
              { name: 'Under', price: -118, point: 2.5 },
            ],
          },
        ],
      },
    ],
  },
];

export const mockNews: NewsArticle[] = [
  {
    title: 'Celtics rotation stabilizes ahead of Bucks showdown as market holds Boston as a short road favorite',
    description: 'Boston enters on extra rest and the betting market continues to shade the Celtics despite public interest in Milwaukee at home.',
    url: 'https://example.com/celtics-bucks-market',
    source: 'Mock Wire',
    publishedAt: '2026-03-13T17:20:00Z',
  },
  {
    title: 'Leafs offense trending up, but Rangers goalie news may force late NHL total movement',
    description: 'Toronto has created more five-on-five chances in recent games while bettors monitor expected goalie confirmations for both sides.',
    url: 'https://example.com/rangers-leafs-total',
    source: 'Mock Wire',
    publishedAt: '2026-03-13T16:35:00Z',
  },
  {
    title: 'Liverpool and Arsenal both pushing high-tempo matchups, drawing attention to EPL totals markets',
    description: 'Analytics models point to transition-heavy sequences, which has kept the over in focus for bettors evaluating weekend slate value.',
    url: 'https://example.com/arsenal-liverpool-total',
    source: 'Mock Wire',
    publishedAt: '2026-03-13T15:50:00Z',
  },
  {
    title: 'Sportsbooks report steady action on marquee weekend games across NBA, NHL, and Premier League',
    description: 'Odds screens have remained active throughout the afternoon as books adjust pricing around injury updates and lineup confirmations.',
    url: 'https://example.com/marquee-weekend-action',
    source: 'Mock Wire',
    publishedAt: '2026-03-13T14:40:00Z',
  },
];