# SportGenie

SportGenie is currently set up as a Vercel-first Expo web app for sports betting analysis. It loads current sportsbook lines, recent sports-betting news, and a larger ranked prediction board powered first by a deterministic quant engine and optionally refined by an LLM.

The Expo SDK 54 setup remains in the repo, but the primary deployment target is now static web plus Vercel serverless API routes.

## What the app does

- Pulls current odds from The Odds API when `EXPO_PUBLIC_ODDS_API_KEY` is set.
- Pulls player-performance profiles through a secure proxy at `EXPO_PUBLIC_PROXY_BASE_URL`, using TheSportsDB's free public API by default and falling back to embedded histories when the proxy is unavailable.
- Pulls current headlines from one or more news providers:
  - Google News RSS scrape and parse with no API key required
  - ESPN RSS scrape and parse with no API key required
  - NewsAPI with `EXPO_PUBLIC_NEWS_API_KEY`
  - GNews with `EXPO_PUBLIC_GNEWS_API_KEY`
  - Currents with `EXPO_PUBLIC_CURRENTS_API_KEY`
- Aggregates and deduplicates news across the configured providers in `EXPO_PUBLIC_NEWS_PROVIDER_ORDER`.
- Applies a freshness window to news so the dashboard prefers current headlines and the refresh action can force uncached refetches.
- Sends the combined context to either:
  - a secure proxy you provide with `EXPO_PUBLIC_LLM_PROXY_URL`, or
  - OpenRouter directly with `EXPO_PUBLIC_OPENROUTER_API_KEY`, or
  - OpenAI directly with `EXPO_PUBLIC_OPENAI_API_KEY`.
- Falls back to built-in mock data and a deterministic quant ranking engine when any provider is missing or fails.
- Evaluates all available sportsbook offers returned by the odds provider and chooses the best line across books before ranking bets.
- Applies deterministic pre-LLM screening to reject thin markets, overpriced favorites, extreme longshots, high-vig boards, low-separation lines, weak EV, and trivial Kelly stakes.
- Builds event-level regression models from recent player performance histories to generate projected team edges and total environments.
- Extracts no-vig consensus probabilities from bookmaker markets before pricing each bet.
- Prices bets with a combination of regression outputs, consensus math, Monte Carlo win rates, expected value, z-score ranking, and Kelly sizing.
- Surfaces a regression watchlist, model pulse cards, and player-trend summaries directly on the home screen.
- Builds low-correlation parlay suggestions from the strongest screened single-bet recommendations using joint EV, Kelly, and pairwise correlation penalties.
- Displays a responsive dashboard with provider status, a larger ranked prediction board, the news feed, and all tracked lines.
- Adds responsive layouts, sport filters, haptic feedback where available, and tap-to-open news cards so the app feels good on desktop and mobile web.
- Supports Expo web for quick browser-based testing with `npm run web` and static web export with `npm run web:build`.
- Includes both a lightweight Express proxy in `server/` and Vercel serverless API routes in `api/` for secure OpenRouter calls and server-side player-stats aggregation.
- Exposes recommendation-volume and quant-screen tuning knobs in `.env` so you can widen or tighten the board without changing code.
- Uses a softer backfill floor so a larger board can still expand on busy slates without filling thin slates with negative-EV junk.
- Threads a forced no-cache refresh through odds, news, and player-data loaders so the refresh button triggers a real resync instead of relying on browser cache behavior.

## Environment setup

Copy `.env.example` to `.env` and fill in the providers you want to use.

Copy `.env.server.example` to `.env.server` for the server-side API layer.

The proxy defaults to `PLAYER_STATS_SOURCE=thesportsdb` with the free public key `123`, so you do not need to buy or register for a player-data provider just to get started.

On Vercel, add the same variables from `.env.example` and `.env.server.example` in the project settings. For web deployments, the client now defaults to relative `/api` calls, so you do not need to hardcode `EXPO_PUBLIC_PROXY_BASE_URL` just to use the co-deployed Vercel functions.

If you do nothing else, the app will now try Google News RSS and ESPN RSS first, which keeps the headline feed live without requiring paid news API keys.

### Recommended production shape

Use a secure server or edge function as the LLM proxy. Sending an OpenRouter or OpenAI API key directly from a mobile or web client is acceptable for a prototype only and should not be treated as production-safe.

Expected proxy request body:

```json
{
  "systemPrompt": "string",
  "events": [],
  "news": [],
  "candidates": []
}
```

Expected proxy response body:

```json
{
  "recommendations": [
    {
      "rank": 1,
      "matchup": "Boston Celtics at Milwaukee Bucks",
      "market": "spreads",
      "selection": "Boston Celtics -1.5",
      "sportsbook": "DraftKings",
      "odds": -108,
      "confidence": 74,
      "score": 8.4,
      "rationale": "Best available price with supportive context.",
      "relatedHeadline": "Optional headline"
    }
  ]
}
```

## Local development

```bash
npm start
```

Run the local proxy in a separate terminal if you want the standalone Express version:

```bash
npm run server
```

## Web testing

```bash
npm run web
```

For a static web bundle:

```bash
npm run web:build
```

## Vercel deployment

This repo now includes [vercel.json](vercel.json) and Vercel serverless endpoints under `api/`.

For a Git-based deploy:

1. Import the GitHub repo into Vercel.
2. Keep the root directory at the repo root.
3. Set the build command to `npm run build` if Vercel does not pick it up automatically.
4. Set the output directory to `dist` if Vercel does not pick it up automatically.
5. Add any needed environment variables from `.env.example` and `.env.server.example` in the Vercel dashboard.

For the Vercel-hosted app, the web client will call:

- `/api/player-stats`
- `/api/llm/recommendations`
- `/api/health`

That means you can deploy the frontend and API together without keeping the Express server as the primary runtime.

## Type check

```bash
npx tsc --noEmit
```

## Notes

- Without API keys, the app still runs using mock odds, mock news, and the deterministic quant engine.
- The proxy now uses TheSportsDB's free roster and recent team results feed by default, then merges that with embedded player-history profiles for richer regression inputs where available.
- The Vercel API layer is production-shaped but still minimal. It still needs auth, rate limiting, logging, and secret management hardening.
- The dashboard intentionally exposes provider status so you can see whether the screen is using live feeds or fallback data.
- When multiple news API keys are configured, the app merges the feeds and shows the combined provider status on the dashboard.
- The app is materially stronger than a simple odds/news prompt wrapper, but it is not yet fully production-ready until you replace the free-source synthetic player envelopes with granular live player logs, expand historical backtesting, add model monitoring, and harden secret handling server-side.