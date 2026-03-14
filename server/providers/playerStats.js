const fallbackProfiles = require('../data/fallbackPlayerProfiles.json');

const THE_SPORTS_DB_KEY = process.env.PLAYER_STATS_SOURCE_KEY || '123';
const THE_SPORTS_DB_BASE = `https://www.thesportsdb.com/api/v1/json/${THE_SPORTS_DB_KEY}`;

const sportConfigByKey = {
  basketball_nba: {
    label: 'Points',
    sport: 'Basketball',
    league: 'NBA',
    limit: 8,
  },
  icehockey_nhl: {
    label: 'Goals',
    sport: 'Hockey',
    league: 'NHL',
    limit: 7,
  },
  soccer_epl: {
    label: 'Goal contributions',
    sport: 'Soccer',
    league: 'Premier League',
    limit: 7,
  },
};

const filterProfiles = (profiles, teams, sportKeys) =>
  profiles.filter((profile) => teams.has(profile.team) || sportKeys.has(profile.sportKey));

const dedupeProfiles = (profiles) => {
  const seen = new Set();

  return profiles.filter((profile) => {
    const key = `${String(profile.team).toLowerCase()}::${String(profile.name).toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const buildHash = (value) => {
  let hash = 0;

  for (const character of String(value)) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseNumber = (value, fallback = 0) => {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));

  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTitleCase = (value) =>
  String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Player stats source returned ${response.status}`);
  }

  return response.json();
};

const findSportKeyForTeamRecord = (teamRecord) => {
  const teamSport = normalizeName(teamRecord.strSport);
  const teamLeague = normalizeName(teamRecord.strLeague);

  return (
    Object.entries(sportConfigByKey).find(([, config]) => {
      return teamSport === normalizeName(config.sport) && teamLeague.includes(normalizeName(config.league));
    })?.[0] || null
  );
};

const parseWageRank = (player) => parseNumber(player.strWage, 0);

const buildSyntheticGames = ({ recentEvents, teamName, sportKey, seed }) => {
  const config = sportConfigByKey[sportKey];

  return recentEvents.slice(0, 5).map((event, index) => {
    const hashed = buildHash(`${seed}:${event.idEvent || event.dateEvent}:${index}`);
    const varianceA = (hashed % 7) - 3;
    const varianceB = ((hashed >> 3) % 5) - 2;
    const varianceC = ((hashed >> 5) % 5) - 2;
    const home = normalizeName(event.strHomeTeam) === normalizeName(teamName);
    const opponent = home ? event.strAwayTeam : event.strHomeTeam;
    const teamScore = parseNumber(home ? event.intHomeScore : event.intAwayScore, 0);

    if (sportKey === 'basketball_nba') {
      return {
        date: event.dateEvent,
        opponent,
        home,
        minutes: clamp(26 + varianceA, 18, 36),
        primaryStat: clamp(Math.round(teamScore * 0.18 + varianceA), 8, 34),
        secondaryStat: clamp(Math.round(teamScore * 0.055 + varianceB), 2, 12),
        tertiaryStat: clamp(Math.round(teamScore * 0.045 + varianceC), 1, 10),
        usageRate: clamp(24 + varianceA + varianceB, 18, 34),
      };
    }

    if (sportKey === 'icehockey_nhl') {
      return {
        date: event.dateEvent,
        opponent,
        home,
        minutes: clamp(19 + varianceA, 14, 25),
        primaryStat: clamp(Math.round(teamScore * 0.35 + varianceB), 0, 3),
        secondaryStat: clamp(Math.round(teamScore * 0.45 + varianceC), 0, 3),
        tertiaryStat: clamp(Math.round(teamScore * 1.3 + varianceA), 1, 7),
        usageRate: clamp(25 + varianceA + varianceC, 18, 33),
      };
    }

    return {
      date: event.dateEvent,
      opponent,
      home,
      minutes: clamp(84 + varianceA, 62, 90),
      primaryStat: clamp(Math.round(teamScore * 0.8 + varianceB), 0, 3),
      secondaryStat: clamp(Math.round(teamScore * 0.45 + varianceC), 0, 2),
      tertiaryStat: clamp(Math.round(teamScore * 1.6 + varianceA), 1, 6),
      usageRate: clamp(23 + varianceA + varianceB, 16, 32),
    };
  });
};

const buildSyntheticProfile = ({ player, teamName, sportKey, recentEvents }) => ({
  id: `tsdb-${player.idPlayer}`,
  name: player.strPlayer,
  team: teamName,
  sportKey,
  position: toTitleCase(player.strPosition || 'Utility'),
  primaryStatLabel: sportConfigByKey[sportKey].label,
  recentGames: buildSyntheticGames({
    recentEvents,
    teamName,
    sportKey,
    seed: `${player.idPlayer}:${player.strPlayer}:${teamName}`,
  }),
});

const mergeWithFallbackProfile = (remoteProfile) => {
  const match = fallbackProfiles.find((profile) => {
    return normalizeName(profile.team) === normalizeName(remoteProfile.team) && normalizeName(profile.name) === normalizeName(remoteProfile.name);
  });

  if (!match) {
    return remoteProfile;
  }

  return {
    ...remoteProfile,
    id: match.id,
    position: match.position || remoteProfile.position,
    primaryStatLabel: match.primaryStatLabel || remoteProfile.primaryStatLabel,
    recentGames: Array.isArray(match.recentGames) && match.recentGames.length > 0 ? match.recentGames : remoteProfile.recentGames,
  };
};

async function fetchCustomPlayerProfiles() {
  const remoteUrl = process.env.PLAYER_STATS_SOURCE_URL;

  if (!remoteUrl) {
    return [];
  }

  const payload = await fetchJson(remoteUrl, {
    headers: process.env.PLAYER_STATS_SOURCE_TOKEN
      ? {
          Authorization: `Bearer ${process.env.PLAYER_STATS_SOURCE_TOKEN}`,
        }
      : undefined,
  });

  return Array.isArray(payload.profiles) ? payload.profiles : [];
}

async function fetchTheSportsDbProfiles({ teams }) {
  const requestedTeams = Array.from(teams);
  const profiles = [];

  for (const teamName of requestedTeams) {
    const teamPayload = await fetchJson(`${THE_SPORTS_DB_BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`);
    const exactTeam = (teamPayload.teams || []).find((teamRecord) => normalizeName(teamRecord.strTeam) === normalizeName(teamName));

    if (!exactTeam) {
      continue;
    }

    const sportKey = findSportKeyForTeamRecord(exactTeam);

    if (!sportKey) {
      continue;
    }

    const [playersPayload, eventsPayload] = await Promise.all([
      fetchJson(`${THE_SPORTS_DB_BASE}/lookup_all_players.php?id=${exactTeam.idTeam}`),
      fetchJson(`${THE_SPORTS_DB_BASE}/eventslast.php?id=${exactTeam.idTeam}`),
    ]);

    const playerLimit = sportConfigByKey[sportKey].limit;
    const recentEvents = Array.isArray(eventsPayload.results) ? eventsPayload.results : [];
    const activePlayers = (playersPayload.player || [])
      .filter((player) => normalizeName(player.strStatus || 'active') === 'active')
      .sort((left, right) => parseWageRank(right) - parseWageRank(left))
      .slice(0, playerLimit);

    profiles.push(
      ...activePlayers.map((player) =>
        mergeWithFallbackProfile(
          buildSyntheticProfile({
            player,
            teamName: exactTeam.strTeam,
            sportKey,
            recentEvents,
          })
        )
      )
    );
  }

  return dedupeProfiles(profiles);
}

async function fetchRemotePlayerProfiles(context) {
  const source = normalizeName(process.env.PLAYER_STATS_SOURCE || 'thesportsdb');

  if (source === 'custom') {
    return {
      provider: 'Secure proxy custom player stats',
      profiles: await fetchCustomPlayerProfiles(),
    };
  }

  return {
    provider: 'Secure proxy TheSportsDB free roster + team form',
    profiles: await fetchTheSportsDbProfiles(context),
  };
}

async function getPlayerProfiles({ teams, sportKeys }) {
  try {
    const remote = await fetchRemotePlayerProfiles({ teams, sportKeys });
    const merged = dedupeProfiles([...remote.profiles, ...fallbackProfiles]);

    return {
      provider: remote.profiles.length > 0 ? remote.provider : 'Secure proxy fallback player stats',
      profiles: filterProfiles(merged, teams, sportKeys),
    };
  } catch {
    return {
      provider: 'Secure proxy fallback player stats',
      profiles: filterProfiles(fallbackProfiles, teams, sportKeys),
    };
  }
}

module.exports = {
  getPlayerProfiles,
};