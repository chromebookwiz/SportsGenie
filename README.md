# SportGenie

SportGenie is an Expo React Native app for iOS-oriented sports betting analysis. It loads current sportsbook lines, recent sports-betting news, and a top-5 recommendation board powered first by a deterministic quant engine and optionally refined by an LLM.

The project is pinned to Expo SDK 54 to maximize compatibility with the current public Expo Go release on iPhone.

## What the app does

- Pulls current odds from The Odds API when `EXPO_PUBLIC_ODDS_API_KEY` is set.
- Pulls player-performance profiles through a secure proxy at `EXPO_PUBLIC_PROXY_BASE_URL`, using TheSportsDB's free public API by default and falling back to embedded histories when the proxy is unavailable.
- Pulls current headlines from one or more news providers:
  - NewsAPI with `EXPO_PUBLIC_NEWS_API_KEY`
  - GNews with `EXPO_PUBLIC_GNEWS_API_KEY`
  - Currents with `EXPO_PUBLIC_CURRENTS_API_KEY`
- Aggregates and deduplicates news across the configured providers in `EXPO_PUBLIC_NEWS_PROVIDER_ORDER`.
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
- Displays a mobile dashboard with provider status, top 5 bets, the news feed, and all tracked lines.
- Adds responsive layouts, sport filters, haptic feedback, and tap-to-open news cards so the app feels better on both phones and tablets.
- Supports Expo web for quick browser-based testing with `npm run web` and static web export with `npm run web:build`.
- Includes a lightweight Express proxy in `server/` for secure OpenRouter calls and server-side player-stats aggregation.

## Environment setup

Copy `.env.example` to `.env` and fill in the providers you want to use.

Copy `.env.server.example` to `.env.server` for the secure proxy.

The proxy defaults to `PLAYER_STATS_SOURCE=thesportsdb` with the free public key `123`, so you do not need to buy or register for a player-data provider just to get started.

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

## Run the app

```bash
npm start
```

Run the secure proxy in a separate terminal:

```bash
npm run server
```

On Windows, the practical iOS workflow is:

- Run `npm start`.
- Scan the Expo QR code with Expo Go on an iPhone.
- For a real installable iOS build, use EAS Build from Expo's cloud build service.

If Expo Go previously showed an SDK incompatibility message, restart the Metro server after pulling these changes so the phone reconnects to the SDK 54 bundle.

## Web testing

```bash
npm run web
```

For a static web bundle:

```bash
npm run web:build
```

## Type check

```bash
npx tsc --noEmit
```

## Notes

- Without API keys, the app still runs using mock odds, mock news, and the deterministic quant engine.
- The proxy now uses TheSportsDB's free roster and recent team results feed by default, then merges that with embedded player-history profiles for richer regression inputs where available.
- The secure proxy is production-shaped but still minimal. It should be fronted by real auth, rate limiting, logging, and secret management before deployment.
- The dashboard intentionally exposes provider status so you can see whether the screen is using live feeds or fallback data.
- When multiple news API keys are configured, the app merges the feeds and shows the combined provider status on the dashboard.
- The app is materially stronger than a simple odds/news prompt wrapper, but it is not yet fully production-ready until you replace the free-source synthetic player envelopes with granular live player logs, expand historical backtesting, add model monitoring, and harden secret handling server-side.