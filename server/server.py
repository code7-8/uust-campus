"""UUST Campus community server. Python 3.10+, standard library only."""
import argparse
import datetime as dt
import getpass
import hashlib
import hmac
import json
import mimetypes
import re
import secrets
import socket
import sqlite3
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 64 * 1024

class APIError(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

def password_hash(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1).hex()

def validate_password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        raise APIError(400, 'Пароль должен содержать от 8 до 128 символов.')

def public_user(row):
    return {'id': row['id'], 'username': row['username'], 'name': row['name'], 'role': row['role']}

class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user','organizer','admin')), created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
              expires REAL NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id));
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, author_id TEXT NOT NULL,
              payload TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
              FOREIGN KEY(author_id) REFERENCES users(id));
            ''')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def register(self, data, role='user'):
        username = str(data.get('username', '')).strip().lower()
        name = str(data.get('name', '')).strip()
        if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,31}', username):
            raise APIError(400, 'Логин: 3–32 символа, латиница, цифры, точка, дефис или _.')
        if not 1 <= len(name) <= 80: raise APIError(400, 'Введите имя (до 80 символов).')
        password = data.get('password')
        validate_password(password)
        salt = secrets.token_bytes(16)
        uid = secrets.token_hex(16)
        try:
            with self.connect() as db:
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,?)',
                           (uid, username, name, salt.hex(), password_hash(password, salt), role, time.time()))
                row = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        except sqlite3.IntegrityError:
            raise APIError(409, 'Этот логин уже занят.')
        return public_user(row)

    def login(self, username, password):
        validate_password(password)
        with self.connect() as db:
            row = db.execute('SELECT * FROM users WHERE username=?', (str(username).strip().lower(),)).fetchone()
            salt = bytes.fromhex(row['salt']) if row else b'no-such-user-salt'
            candidate = password_hash(password, salt)
            if row is None or not hmac.compare_digest(candidate, row['password']):
                raise APIError(401, 'Неверный логин или пароль.')
            token = secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires < ?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES (?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), row['id'], time.time() + 30 * 86400))
        return {'token': token, 'user': public_user(row)}

    def user(self, token):
        if not token: raise APIError(401, 'Войдите в аккаунт.')
        with self.connect() as db:
            row = db.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id '
                             'WHERE s.token_hash=? AND s.expires>?',
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        if row is None: raise APIError(401, 'Сессия завершена. Войдите ещё раз.')
        return public_user(row)

    def has_admin(self):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone() is not None

    def validate_event(self, data):
        def text(key, maximum, required=False):
            value = data.get(key, '')
            if not isinstance(value, str): raise APIError(400, 'Некорректное поле: ' + key)
            value = value.strip()
            if len(value) > maximum or required and not value:
                raise APIError(400, 'Проверьте поле: ' + key)
            return value
        result = {k: text(k, n, required) for k, n, required in [
            ('title', 160, True), ('description', 4000, True), ('place', 240, True),
            ('category', 40, True), ('date', 10, True), ('time', 5, True), ('endTime', 5, True)]}
        try:
            if dt.date.fromisoformat(result['date']).isoformat() != result['date']: raise ValueError()
            for key in ('time', 'endTime'):
                if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', result[key]): raise ValueError()
            if result['endTime'] <= result['time']: raise ValueError()
        except ValueError: raise APIError(400, 'Проверьте дату и время окончания. Время указывается для Уфы.')
        building = data.get('buildingId') or None
        if building is not None and str(building) not in [str(n) for n in range(1,10)]:
            raise APIError(400, 'Неизвестный корпус.')
        result['buildingId'] = str(building) if building else None
        result['locationId'] = text('locationId', 96) or None
        result.update(source='', sourceLabel='Афиша сообщества', accent='lime', community=True, demo=False)
        return result

    def dispatch(self, method, path, data, token):
        if method == 'GET' and path == '/v1/health':
            return {'ok': True, 'service': 'UUST Campus', 'version': '0.2.0', 'setupRequired': not self.has_admin()}
        if method == 'POST' and path == '/v1/auth/register':
            self.register(data)
            return self.login(data.get('username'), data.get('password'))
        if method == 'POST' and path == '/v1/auth/login': return self.login(data.get('username'), data.get('password'))
        if method == 'GET' and path == '/v1/events':
            with self.connect() as db:
                rows = db.execute('SELECT e.*, u.name AS author_name FROM events e JOIN users u '
                                  'ON u.id=e.author_id ORDER BY e.updated DESC LIMIT 300').fetchall()
            return {'events': [{**json.loads(r['payload']), 'id': r['id'], 'authorId': r['author_id'],
                                'authorName': r['author_name']} for r in rows], 'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
        user = self.user(token)
        if method == 'GET' and path == '/v1/auth/me': return {'user': user}
        if method == 'POST' and path == '/v1/auth/logout':
            with self.connect() as db: db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
            return {'ok': True}
        if path.startswith('/v1/users'):
            if user['role'] != 'admin': raise APIError(403, 'Только администратор управляет правами.')
            with self.connect() as db:
                if method == 'GET' and path == '/v1/users':
                    return {'users': [public_user(r) for r in db.execute('SELECT * FROM users ORDER BY name LIMIT 1000')]}
                match = re.fullmatch(r'/v1/users/([a-f0-9]{32})/role', path)
                if method == 'PATCH' and match:
                    role = data.get('role')
                    if role not in ('user', 'organizer'): raise APIError(400, 'Выберите user или organizer.')
                    target = db.execute('SELECT * FROM users WHERE id=?', (match[1],)).fetchone()
                    if not target: raise APIError(404, 'Пользователь не найден.')
                    if target['role'] == 'admin': raise APIError(403, 'Администратора нельзя изменить из приложения.')
                    db.execute('UPDATE users SET role=? WHERE id=?', (role, match[1]))
                    return {'ok': True}
        match = re.fullmatch(r'/v1/events(?:/(event-[a-f0-9]{24}))?', path)
        if match and method in ('POST', 'PATCH', 'DELETE'):
            if user['role'] not in ('organizer', 'admin'): raise APIError(403, 'Администратор ещё не разрешил вам публиковать события.')
            eid = match[1]
            if method == 'POST' and eid is not None or method != 'POST' and eid is None:
                raise APIError(404, 'Событие не найдено.')
            event = self.validate_event(data) if method != 'DELETE' else None
            with self.connect() as db:
                if eid:
                    row = db.execute('SELECT * FROM events WHERE id=?', (eid,)).fetchone()
                    if not row: raise APIError(404, 'Событие не найдено.')
                    if user['role'] != 'admin' and row['author_id'] != user['id']: raise APIError(403, 'Можно изменять только свои события.')
                if method == 'POST':
                    eid = 'event-' + secrets.token_hex(12)
                    db.execute('INSERT INTO events VALUES (?,?,?,?,?)', (eid, user['id'], json.dumps(event, ensure_ascii=False), time.time(), time.time()))
                elif method == 'PATCH':
                    db.execute('UPDATE events SET payload=?, updated=? WHERE id=?', (json.dumps(event, ensure_ascii=False), time.time(), eid))
                else: db.execute('DELETE FROM events WHERE id=?', (eid,))
            return {'ok': True, 'id': eid}
        raise APIError(404, 'Адрес не найден.')

class Handler(BaseHTTPRequestHandler):
    server_version = 'UUSTCampus/0.2'
    def log_message(self, fmt, *args):
        # Never log request bodies, authorization headers, or passwords.
        if args: print(time.strftime('%H:%M:%S'), self.client_address[0], str(args[0]).split('?')[0], flush=True)

    def cors(self):
        origin = self.headers.get('Origin', '')
        allowed = origin == 'https://appassets.androidplatform.net'
        try:
            u = urlsplit(origin)
            allowed = allowed or u.netloc == self.headers.get('Host') or u.hostname in ('localhost', '127.0.0.1')
        except ValueError: pass
        if allowed:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')

    def json_response(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self): self.json_response(200, {})
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def do_PATCH(self): self.handle_request()
    def do_DELETE(self): self.handle_request()

    def handle_request(self):
        try:
            path = urlsplit(self.path).path
            if path.startswith('/v1/'):
                if self.headers.get('Transfer-Encoding'): raise APIError(400, 'Неподдерживаемый формат запроса.')
                try: length = int(self.headers.get('Content-Length', '0'))
                except ValueError: raise APIError(400, 'Некорректный размер запроса.')
                if not 0 <= length <= MAX_BODY: raise APIError(413, 'Запрос слишком большой.')
                if '/auth/login' in path or '/auth/register' in path:
                    key = self.client_address[0]
                    with self.server.rate_lock:
                        q = self.server.rates[key]
                        now = time.monotonic()
                        while q and q[0] < now - 60: q.popleft()
                        if len(q) >= 25: raise APIError(429, 'Слишком много попыток. Подождите минуту.')
                        q.append(now)
                raw = self.rfile.read(length) if length else b'{}'
                try: data = json.loads(raw)
                except (ValueError, UnicodeError): raise APIError(400, 'Некорректный JSON.')
                if not isinstance(data, dict): raise APIError(400, 'Ожидается JSON-объект.')
                auth = self.headers.get('Authorization', '')
                token = auth[7:] if auth.startswith('Bearer ') else ''
                result = self.server.store.dispatch(self.command, path, data, token)
                self.json_response(200, result)
            elif self.command == 'GET': self.static_file(path)
            else: raise APIError(404, 'Адрес не найден.')
        except APIError as e: self.json_response(e.status, {'error': e.message})
        except (BrokenPipeError, ConnectionResetError, TimeoutError): pass
        except Exception as e:
            print('Request error:', type(e).__name__, flush=True)
            self.json_response(500, {'error': 'Ошибка сервера. Попробуйте ещё раз.'})

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def static_file(self, path):
        base = (ROOT / 'app').resolve()
        target = (base / unquote(path).lstrip('/')).resolve()
        if target == base: target = base / 'index.html'
        if not target.is_relative_to(base) or not target.is_file(): raise APIError(404, 'Файл не найден.')
        content = target.read_bytes()
        mime = {'.js':'application/javascript', '.css':'text/css', '.json':'application/json'}.get(target.suffix) or mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

def make_server(host, port, store):
    server = ThreadingHTTPServer((host, port), Handler)
    server.store, server.rates, server.rate_lock = store, defaultdict(deque), threading.Lock()
    server.daemon_threads = True
    return server

def main():
    parser = argparse.ArgumentParser(description='UUST Campus — общий сервер афиши и аккаунтов')
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--data', default=str(Path(__file__).parent / 'data' / 'campus.sqlite'))
    parser.add_argument('--init-admin', action='store_true')
    args = parser.parse_args()
    store = Store(args.data)
    if args.init_admin or not store.has_admin():
        print('Создание администратора. Пароль хранится только в виде хеша; ввод скрыт.')
        username = input('Логин администратора (латиница): ').strip()
        name = input('Имя: ').strip() or username
        password = getpass.getpass('Пароль (не менее 8 символов): ')
        if password != getpass.getpass('Повторите пароль: '): raise SystemExit('Пароли не совпадают.')
        try: store.register({'username':username, 'name':name, 'password':password}, role='admin')
        except APIError as e: raise SystemExit(e.message)
    print('\nСервер УУНиТ запущен. Оставьте это окно открытым.')
    print(f'На ноутбуке: http://127.0.0.1:{args.port}')
    addresses = set(socket.gethostbyname_ex(socket.gethostname())[2])
    for address in sorted(addresses):
        if not address.startswith('127.'): print(f'Адрес для телефонов в общей сети: http://{address}:{args.port}')
    print('В приложении: Профиль → Сервер команды → введите адрес ноутбука.\nОстановка: Ctrl+C. База сохраняется в', args.data, flush=True)
    server = make_server(args.host, args.port, store)
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nСервер остановлен. Данные сохранены.')
    finally: server.server_close()

if __name__ == '__main__': main()
