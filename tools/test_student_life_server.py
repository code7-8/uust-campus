"""Isolated server fixture for tests/student-life.browser.cjs (never uses real data)."""
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from server import Store, Application, Settings, waitress_options
from waitress import create_server
with tempfile.TemporaryDirectory() as tmp:
    store = Store(Path(tmp) / 'test.sqlite')
    store.register({'username': 'testadmin', 'name': 'Тестовый организатор', 'password': 'test-admin-pass'}, role='admin')
    server = create_server(Application(store), **waitress_options(Settings(host='127.0.0.1', port=0)))
    print('READY http://127.0.0.1:' + str(server.effective_port), flush=True)
    try: server.run()
    finally: server.close()
