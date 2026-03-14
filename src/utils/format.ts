export const formatOdds = (odds: number) => `${odds > 0 ? '+' : ''}${odds}`;

export const formatCommenceTime = (value: string) => {
  const date = new Date(value);

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatRelativeTime = (value: string) => {
  const milliseconds = Date.now() - new Date(value).getTime();
  const hours = Math.max(1, Math.round(milliseconds / (1000 * 60 * 60)));

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
};

export const formatMarketLabel = (market: string) => {
  switch (market) {
    case 'h2h':
      return 'Moneyline';
    case 'spreads':
      return 'Spread';
    case 'totals':
      return 'Total';
    default:
      return market;
  }
};

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export const formatTrendLabel = (value: 'rising' | 'flat' | 'falling') => {
  switch (value) {
    case 'rising':
      return 'Rising';
    case 'falling':
      return 'Falling';
    default:
      return 'Stable';
  }
};