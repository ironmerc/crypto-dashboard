#!/bin/sh

# Start the bot API server in the background
echo "Starting Bot API Server..."
python -u bot.py &
BOT_PID=$!

# Wait for bot to initialize
sleep 2
if ! kill -0 "$BOT_PID" 2>/dev/null; then
  echo "Bot API server failed to start; exiting container."
  wait "$BOT_PID"
  exit 1
fi

# Start the Market Engine
echo "Starting MTF Market Engine..."
python -u market_engine.py

# Keep container alive if market_engine fails (optional)
# wait
