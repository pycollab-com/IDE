import os
import sys

# Load environment variables from .env file if it exists (for local development)
# In production/Docker, environment variables should be set directly
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # python-dotenv not installed, skip
    pass

# Ensure repository root is on sys.path so the `server` package can be imported
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from server.main import socket_app

# Export an ASGI app for hosting platforms that autodetect `app`
app = socket_app
