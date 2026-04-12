"""Shared input validation constants."""
import re

VALID_SYMBOL_RE = re.compile(r'^[A-Z0-9]{5,20}$')
