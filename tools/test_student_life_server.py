"""Isolated server fixture for tests/student-life.browser.cjs (never uses real data)."""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from server import Store, make_server
with tempfile.TemporaryDirectory() as tmp:
    store = Store(Path(tmp) / 'test.sqlite')
    store.register({'username': 'testadmin', 'name': 'Тестовый организатор', 'password': 'test-admin-pass'}, role='admin')
    server = make_server('127.0.0.1', 0, store)
    print('READY http://127.0.0.1:' + str(server.server_address[1]), flush=True)
    try: server.serve_forever()
    finally: server.server_close()
