const dotenv = require('dotenv');

dotenv.config({ path: '.env.server' });
dotenv.config();

module.exports = (_request, response) => {
  response.status(200).json({ ok: true, service: 'sportgenie-vercel-api' });
};