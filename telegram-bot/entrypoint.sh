#!/bin/sh

# Start the bot API server in the background
echo "Starting Bot API Server..."
python -u bot.py &

# Wait for bot to initialize
sleep 2

# Start the Market Engine
echo "Starting MTF Market Engine..."
python -u market_engine.py

# Keep container alive if market_engine fails (optional)
# wait
