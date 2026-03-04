FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for numpy/pandas if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY bot.py .
COPY market_engine.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose the internal port for the UI to talk to the bot
EXPOSE 8888

# Health Check against the API server
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8888/health || exit 1

# Run the entrypoint to start both processes
CMD ["sh", "./entrypoint.sh"]
