"""Test-suite setup.

`deps.py` reads its Supabase config at import time, so importing anything under
`routes/` pulls those variables in. The test suite is entirely offline -- USDA
responses are fixtures and Gemini is mocked -- so it must never need real
credentials to run. Placeholders are enough to satisfy the import, and keeping
them here means CI needs no secrets either.
"""

import os
import sys
from pathlib import Path

# Tests import application modules by their bare names (`from chat import ...`),
# so the api/ directory itself has to be importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("SUPABASE_URL", "https://test.invalid")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")
os.environ.setdefault("USDA_API_KEY", "test-usda-key")
