const dotenv = require('dotenv');
const { getPlayerProfiles } = require('../server/providers/playerStats');

dotenv.config({ path: '.env.server' });
dotenv.config();

module.exports = async (request, response) => {
  try {
    const teams = new Set(String(request.query.teams || '').split(',').map((value) => value.trim()).filter(Boolean));
    const sportKeys = new Set(String(request.query.sportKeys || '').split(',').map((value) => value.trim()).filter(Boolean));
    const payload = await getPlayerProfiles({ teams, sportKeys });

    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Player stats request failed',
    });
  }
};