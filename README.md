# SportGenie

SportGenie is currently set up as a Vercel-first Expo web app for sports betting analysis. It loads current sportsbook lines, recent sports-betting news, and a larger ranked prediction board powered first by a deterministic quant engine and optionally refined by an LLM.

The Expo SDK 54 setup remains in the repo, but the primary deployment target is now static web plus Vercel serverless API routes.

## What the app does

- Pulls current odds from multiple sources and normalizes them into one board:
  - ESPN public scoreboard odds with no API key required for NBA, NHL, and Premier League
  - Kalshi public sports exchange markets for curated game, spread, and total series
  - The Odds API when `EXPO_PUBLIC_ODDS_API_KEY` is set for broader multi-book coverage
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
  - WebLLM in-browser with `EXPO_PUBLIC_ENABLE_WEBLLM=true` on supported WebGPU browsers, or
  - OpenRouter directly with `EXPO_PUBLIC_OPENROUTER_API_KEY`, or
  - OpenAI directly with `EXPO_PUBLIC_OPENAI_API_KEY`.
- Falls back to built-in mock data and a deterministic quant ranking engine when any provider is missing or fails.
- Evaluates all normalized offers returned by the active odds providers and chooses the best line across books before ranking bets.
- Applies deterministic pre-LLM screening to reject thin markets, overpriced favorites, extreme longshots, high-vig boards, low-separation lines, weak EV, and trivial Kelly stakes.
- Builds event-level regression models from recent player performance histories to generate projected team edges and total environments.
- Extracts no-vig consensus probabilities from bookmaker markets before pricing each bet.
- Prices bets with a combination of regression outputs, consensus math, Monte Carlo win rates, expected value, z-score ranking, and Kelly sizing.
- Surfaces a regression watchlist, model pulse cards, and player-trend summaries directly on the home screen.
- Builds low-correlation parlay suggestions from the strongest screened single-bet recommendations using joint EV, Kelly, and pairwise correlation penalties.
- Displays a responsive dashboard with provider status, a larger ranked prediction board, the news feed, and all tracked lines.
- Includes a draggable WebLLM advisor window on web that can be minimized, closed, and reopened while keeping the main board visible.
- Persists advisor chat history and window state in the browser so the local WebLLM assistant survives refreshes.
- Adds responsive layouts, sport filters, haptic feedback where available, and tap-to-open news cards so the app feels good on desktop and mobile web.
- Supports Expo web for quick browser-based testing with `npm run web` and static web export with `npm run web:build`.
- Includes both a lightweight Express proxy in `server/` and Vercel serverless API routes in `api/` for secure OpenRouter calls and server-side player-stats aggregation.
- Lets the proxy-side LLM use controlled tool calls to search the active slate, pull fresh Google News RSS results, and fetch player-profile context before ranking the best moves.
- Exposes recommendation-volume and quant-screen tuning knobs in `.env` so you can widen or tighten the board without changing code.
- Uses a softer backfill floor so a larger board can still expand on busy slates without filling thin slates with negative-EV junk.
- Threads a forced no-cache refresh through odds, news, and player-data loaders so the refresh button triggers a real resync instead of relying on browser cache behavior.

## Environment setup

Copy `.env.example` to `.env` and fill in the providers you want to use.

Copy `.env.server.example` to `.env.server` for the server-side API layer.

The proxy defaults to `PLAYER_STATS_SOURCE=thesportsdb` with the free public key `123`, so you do not need to buy or register for a player-data provider just to get started.

On Vercel, add the same variables from `.env.example` and `.env.server.example` in the project settings. For web deployments, the client now defaults to relative `/api` calls, so you do not need to hardcode `EXPO_PUBLIC_PROXY_BASE_URL` just to use the co-deployed Vercel functions.

If you do nothing else, the app will now try Google News RSS and ESPN RSS first, which keeps the headline feed live without requiring paid news API keys.

If you do nothing else on the odds side, the app will now try ESPN public odds first and then Kalshi sports markets, so the board can stay live without requiring a paid odds key.

### LLM provider controls

The recommendation pipeline is controlled through `.env`:

- `EXPO_PUBLIC_LLM_PROVIDER_ORDER=proxy,webllm,openrouter,openai`
- `EXPO_PUBLIC_ENABLE_WEBLLM=true`
- `EXPO_PUBLIC_WEBLLM_MODEL=Llama-3.1-8B-Instruct-q4f32_1-MLC`
- `EXPO_PUBLIC_WEBLLM_TOOL_MAX_ROUNDS=3`

WebLLM is enabled by default for web builds, but it still only activates on browsers with WebGPU support. The first model load is large and can take time because weights are downloaded and cached in the browser. The browser-side adapter supports bounded local tool calling so the model can search the loaded slate, pull fresh Google News RSS results, and fetch player profiles before it commits to picks, and the advisor window includes explicit model loading controls so users can choose which local model to load. Keep the proxy or hosted API providers enabled if you want a faster cold start or a fallback on unsupported browsers.

### Odds provider controls

The odds pipeline is controlled through `.env`:

- `EXPO_PUBLIC_ODDS_PROVIDER_ORDER=espn,kalshi,the-odds-api`
- `EXPO_PUBLIC_ENABLE_ESPN_ODDS=true`
- `EXPO_PUBLIC_ESPN_ODDS_SPORTS=basketball/nba,hockey/nhl,soccer/eng.1`
- `EXPO_PUBLIC_ENABLE_KALSHI_ODDS=true`
- `EXPO_PUBLIC_KALSHI_BASE_URL=https://api.elections.kalshi.com/trade-api/v2`
- `EXPO_PUBLIC_KALSHI_SERIES=KXNBAGAME,KXNBASPREAD,KXNBATOTAL,KXNHLGAME,KXNHLTOTAL,KXEPLGAME,KXEPLSPREAD,KXEPLTOTAL`

The default Kalshi series list is intentionally conservative and only includes sports contracts that map cleanly into the app's existing `h2h`, `spreads`, and `totals` markets.

### Recommended production shape

Use a secure server or edge function as the LLM proxy. Sending an OpenRouter or OpenAI API key directly from a mobile or web client is acceptable for a prototype only and should not be treated as production-safe.

The bundled proxy now supports bounded tool calls against internal research helpers:

- search within the current events, candidates, analytics, and article context
- pull fresh Google News RSS search results for a query
- fetch player profiles and recent game logs from the secure player-stats provider

That gives the hosted LLM a way to gather fresher evidence before it commits to final recommendations.

Expected proxy request body:

```json
{
  "systemPrompt": "string",
  "events": [],
  "news": [],
  "analytics": {},
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

- Without API keys, the app can now still run on live public ESPN and Kalshi odds where available, then fall back to mock odds if every live provider fails.
- The proxy now uses TheSportsDB's free roster and recent team results feed by default, then merges that with embedded player-history profiles for richer regression inputs where available.
- The Vercel API layer is production-shaped but still minimal. It still needs auth, rate limiting, logging, and secret management hardening.
- The dashboard intentionally exposes provider status so you can see whether the screen is using live feeds or fallback data.
- When multiple news API keys are configured, the app merges the feeds and shows the combined provider status on the dashboard.
- The app is materially stronger than a simple odds/news prompt wrapper, but it is not yet fully production-ready until you replace the free-source synthetic player envelopes with granular live player logs, expand historical backtesting, add model monitoring, and harden secret handling server-side.