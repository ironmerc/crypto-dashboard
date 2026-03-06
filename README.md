# Crypto Dashboard + Telegram Alert Stack

Low-latency crypto futures dashboard with a Python Telegram alert backend.

## What This Project Includes

- React/Vite dashboard (`src/`) with Zustand state and alert controls
- Python `aiohttp` Telegram bot (`telegram-bot/bot.py`) for queueing, policy checks, cooldowns, and delivery
- Python market engine (`telegram-bot/market_engine.py`) that ingests Binance streams and emits alert events
- Nginx proxy (`nginx.conf`) to route frontend `/api/bot/*` traffic to the bot container

## Current Alert Pipeline

1. Market engine detects conditions (whale activity, OI spikes, regime/volatility shifts, RSI/RVOL events, liquidation, custom price hits, summaries).
2. Engine posts alert payloads to bot `/alert`.
3. Bot applies policy gates (`alert_policy.py`) and cooldown keying (`type + symbol + timeframe`).
4. Accepted alerts are queued and delivered to Telegram asynchronously.
5. Alert events are stored in bounded history for dashboard consumption.

## New Reliability Layer (Current)

- Shared JSON schemas in [`schemas/`](schemas):
  - `telegram-config.schema.json`
  - `alert-event.schema.json`
- Frontend and backend both run **warn-only schema validation**:
  - Frontend: `src/utils/schemaValidation.ts`
  - Backend: `telegram-bot/schema_validation.py`
- Engine now attaches `metadata` on alerts with:
  - `reason`
  - `current_value`
  - `threshold_value`
  - `comparison`
  - `timeframe`
  - `session`

This gives traceability for why each alert fired without hard-blocking payloads.

## Quick Start (Docker)

1. Copy env file:

```bash
cp .env.example .env
```

2. Fill `.env` with:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

3. Build and run:

```bash
docker-compose up -d --build
```

4. Open dashboard:
- `http://localhost:8000`

## Ports and Routes

- Frontend container: `8000 -> 80`
- Telegram bot container: `8888 -> 8888`
- Nginx proxy route:
  - `/api/bot/*` -> `http://telegram-bot:8888/*`

## Local Dev Commands

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm test
npm run build
python -m unittest telegram-bot/tests/test_schema_validation.py telegram-bot/tests/test_alert_metadata.py
```

## Notes

- Local/private GSD docs may exist under `.gsd/` and are intentionally not tracked.

## License

MIT. See [`LICENSE`](LICENSE).
