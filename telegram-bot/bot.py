import os
import asyncio
import logging
from aiohttp import web, ClientSession

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Environment Variables
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
    logger.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in the environment.")
    exit(1)

# In-memory queue for alerts
alert_queue = asyncio.Queue()

# Simple cooldown tracker: { "alert_type": timestamp_of_last_send }
cooldown_tracker = {}

async def send_to_telegram(session: ClientSession, text: str):
    """Sends a message to the Telegram API with basic retry logic."""
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML"
    }
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with session.post(API_URL, json=payload, timeout=10) as response:
                if response.status == 200:
                    logger.info("Successfully sent message to Telegram.")
                    return True
                else:
                    error_text = await response.text()
                    logger.error(f"Telegram API Error ({response.status}): {error_text}")
        except Exception as e:
            logger.error(f"Network error sending to Telegram: {e}")
        
        # Exponential backoff
        if attempt < max_retries - 1:
            await asyncio.sleep(2 ** attempt)
            
    return False

async def process_queue():
    """Background task to process alerts from the queue."""
    logger.info("Starting alert queue processor...")
    async with ClientSession() as session:
        while True:
            try:
                alert = await alert_queue.get()
                message = alert.get("message", "Alert from Crypto Terminal")
                alert_type = alert.get("type", "default")
                cooldown_sec = alert.get("cooldown", 0)

                # Check cooldown to prevent spam
                current_time = asyncio.get_event_loop().time()
                last_sent = cooldown_tracker.get(alert_type, 0)
                
                if current_time - last_sent < cooldown_sec:
                    logger.info(f"Alert of type '{alert_type}' is on cooldown. Dropping message.")
                    alert_queue.task_done()
                    continue

                # Send message
                success = await send_to_telegram(session, message)
                
                if success:
                    # Update cooldown tracker on success
                    cooldown_tracker[alert_type] = current_time

                alert_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing alert: {e}")

async def handle_alert(request):
    """HTTP endpoint to receive alerts from the internal network."""
    try:
        data = await request.json()
        
        if not "message" in data:
            return web.json_response({"error": "Missing 'message' field"}, status=400)

        # Enqueue the alert
        await alert_queue.put(data)
        logger.info(f"Enqueued alert of type: {data.get('type', 'default')}")
        
        return web.json_response({"status": "queued"}, status=202)
        
    except Exception as e:
        logger.error(f"Failed to parse alert incoming data: {e}")
        return web.json_response({"error": "Invalid JSON payload"}, status=400)

async def handle_health(request):
    """Simple health check endpoint."""
    return web.json_response({"status": "ok"}, status=200)

async def init_app():
    """Initialize the aiohttp web application."""
    app = web.Application()
    app.router.add_post('/alert', handle_alert)
    app.router.add_get('/health', handle_health)
    
    # Start the background task
    app['queue_processor'] = asyncio.create_task(process_queue())
    
    return app

if __name__ == '__main__':
    web.run_app(init_app(), host='0.0.0.0', port=8080)
