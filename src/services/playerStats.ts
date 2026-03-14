import { env } from '../config/env';
import { mockPlayerProfiles } from '../data/playerPerformance';
import type { BettingEvent, PlayerPerformanceProfile, ProviderResult } from '../types/sports';

type PlayerStatsProxyResponse = {
  profiles?: PlayerPerformanceProfile[];
  provider?: string;
};

const dedupeProfiles = (profiles: PlayerPerformanceProfile[]) => {
  const seen = new Set<string>();

  return profiles.filter((profile) => {
    if (seen.has(profile.id)) {
      return false;
    }

    seen.add(profile.id);
    return true;
  });
};

const filterProfilesForEvents = (profiles: PlayerPerformanceProfile[], events: BettingEvent[]) => {
  const teams = new Set(events.flatMap((event) => [event.homeTeam, event.awayTeam]));
  const sportKeys = new Set(events.map((event) => event.sportKey));

  return profiles.filter((profile) => teams.has(profile.team) || sportKeys.has(profile.sportKey));
};

export async function fetchPlayerProfiles(events: BettingEvent[]): Promise<ProviderResult<PlayerPerformanceProfile[]>> {
  const fallbackProfiles = filterProfilesForEvents(mockPlayerProfiles, events);

  if (!env.proxyBaseUrl) {
    return {
      data: fallbackProfiles,
      provider: 'Embedded player-history fallback',
    };
  }

  try {
    const teams = Array.from(new Set(events.flatMap((event) => [event.homeTeam, event.awayTeam]))).join(',');
    const sportKeys = Array.from(new Set(events.map((event) => event.sportKey))).join(',');
    const response = await fetch(`${env.proxyBaseUrl}/api/player-stats?teams=${encodeURIComponent(teams)}&sportKeys=${encodeURIComponent(sportKeys)}`);

    if (!response.ok) {
      throw new Error(`Player-stats proxy returned ${response.status}`);
    }

    const payload = (await response.json()) as PlayerStatsProxyResponse;
    const mergedProfiles = dedupeProfiles([...(payload.profiles ?? []), ...fallbackProfiles]);

    return {
      data: mergedProfiles,
      provider: payload.provider ?? 'Proxy player stats',
    };
  } catch {
    return {
      data: fallbackProfiles,
      provider: 'Embedded player-history fallback',
    };
  }
}