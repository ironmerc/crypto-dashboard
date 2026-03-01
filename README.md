# Godmode Futures Watchtower v2.0

A highly customizable, low-latency cryptocurrency futures dashboard designed for rigorous market monitoring and off-screen alerting.

## Features

- **Scalable UI**: Fully responsive grid that squishes down responsively. Shrink the browser or snap it to the side to trigger a cohesive zoom scale out.
- **Resizable Panels**: User-adjustable heights and column widths utilizing custom `react-resizable-panels` that match the terminal theme.
- **Internal Overflow Handling**: Compressing horizontal or vertical panes automatically introduces sleek internal scrollbars rather than clipping the content.
- **Dedicated Alert Bot**: A lightweight Python `aiohttp` Telegram Bot that runs internally in its own Docker container, circumventing CORS complexity entirely via Nginx reverse proxies.

## Quick Start (Docker)

This application is built with React/Vite but is intended to be run locally or on a Raspberry Pi using Docker Compose so that the React frontend, the Nginx reverse proxy, and the backend Python alerting bot all spin up together.

1. **Clone the repository**
2. **Setup Telegram Environment**
   * Copy `.env.example` to `.env`.
   * Open `.env` and fill in your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. **Build & Up**
   ```bash
   docker-compose up -d --build
   ```

## Architecture

* **Frontend**: React + TypeScript + Zustand + Vite + TailwindCSS.
* **Serving Layer**: Nginx (serves static frontend files and reverse-proxies API requests to the bot to bypass CORS).
* **Alert Backend**: Python 3.11 Alpine container running `aiohttp` and `asyncio.Queue` for non-blocking Telegram alerts with granular cooldowns.

### The Bot Pipeline
When the React UI detects an anomaly (like an ATR Expansion or an Open Interest Spike), it fires a JSON payload to `/api/bot/alert`. 

Nginx intercepts this route and transparently passes the payload to `http://telegram-bot:8080/`. The Python bot accepts the signal, puts it into an internal asynchronous queue, replies `202 Accepted` immediately, and then handles the API dispatch and rate-limit cooldowns in the background.
