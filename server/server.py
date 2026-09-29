"""UUST Campus: existing SQLite API, served by Waitress behind an HTTPS proxy."""
import argparse
import datetime as dt
import getpass
import hashlib
import hmac
import json
import logging
import mimetypes
import os
import re
import secrets
import signal
import sqlite3
import sys
import threading
import time
from collections import deque
from contextlib import contextmanager, closing
from http import HTTPStatus
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import urlsplit, unquote
from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server as wsgi_server

from server_config import Settings

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY = 64 * 1024
LOG = logging.getLogger('campus')

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
            CREATE TABLE IF NOT EXISTS attendance(event_id TEXT NOT NULL, user_id TEXT NOT NULL,
              created REAL NOT NULL, PRIMARY KEY(event_id,user_id),
              FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, expires);
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
            CREATE INDEX IF NOT EXISTS events_updated ON events(updated);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db: yield db
        finally:
            db.close()

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
            db.execute('DELETE FROM sessions WHERE token_hash IN '
                       '(SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT -1 OFFSET 9)', (row['id'],))
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

    def backup(self, destination):
        """Consistent online snapshot, including data currently in the WAL."""
        target = Path(destination).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents accidentally replacing the live DB or an older backup.
        with target.open('xb'): pass
        try:
            with self.connect() as source, closing(sqlite3.connect(target)) as output:
                source.backup(output)
        except Exception:
            target.unlink()
            raise

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
        result['floorId'] = text('floorId', 96) or None
        result['room'] = text('room', 80)
        result['organizer'] = text('organizer', 160)
        result['kind'] = data.get('kind', 'student')
        if result['kind'] not in ('student', 'official'): raise APIError(400, 'Неизвестный тип события.')
        capacity = data.get('capacity')
        if capacity is not None and (type(capacity) is not int or not 1 <= capacity <= 10000):
            raise APIError(400, 'Количество мест: целое число от 1 до 10000 или без ограничения.')
        result['capacity'] = capacity
        if not building and any(result[k] for k in ('locationId', 'floorId', 'room')):
            raise APIError(400, 'Укажите корпус для аудитории или этажа.')
        result.update(source='', sourceLabel='Афиша сообщества', accent='lime', community=True, demo=False)
        return result

    def event_view(self, db, row, viewer_id=None):
        payload = json.loads(row['payload'])
        # Before student meetings were introduced, only staff could publish.
        payload.setdefault('kind', 'official')
        count = db.execute('SELECT COUNT(*) FROM attendance WHERE event_id=?', (row['id'],)).fetchone()[0]
        going = viewer_id is not None and db.execute('SELECT 1 FROM attendance WHERE event_id=? AND user_id=?',
                                                     (row['id'], viewer_id)).fetchone() is not None
        return {**payload, 'id': row['id'], 'authorId': row['author_id'], 'authorName': row['author_name'],
                'attendeeCount': count, 'viewerGoing': going}

    def dispatch(self, method, path, data, token):
        if method == 'GET' and path == '/v1/health':
            return {'ok': True, 'service': 'UUST Campus', 'version': '0.3.3', 'setupRequired': not self.has_admin()}
        if method == 'POST' and path == '/v1/auth/register':
            self.register(data)
            return self.login(data.get('username'), data.get('password'))
        if method == 'POST' and path == '/v1/auth/login': return self.login(data.get('username'), data.get('password'))
        if method == 'GET' and path == '/v1/events':
            viewer = self.user(token) if token else None
            with self.connect() as db:
                rows = db.execute('SELECT e.*, u.name AS author_name FROM events e JOIN users u '
                                  'ON u.id=e.author_id ORDER BY e.updated DESC LIMIT 300').fetchall()
                events = [self.event_view(db, row, viewer['id'] if viewer else None) for row in rows]
            return {'events': events, 'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
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
        attendance = re.fullmatch(r'/v1/events/(event-[a-f0-9]{24})/attendance', path)
        if attendance and method in ('POST', 'DELETE'):
            eid = attendance[1]
            with self.connect() as db:
                # Serialize joins, withdrawals and edits: the last seat cannot be oversold.
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT e.*, u.name AS author_name FROM events e JOIN users u ON u.id=e.author_id WHERE e.id=?', (eid,)).fetchone()
                if not row: raise APIError(404, 'Событие не найдено.')
                event = self.event_view(db, row, user['id'])
                if method == 'POST' and not event['viewerGoing']:
                    ends = dt.datetime.fromisoformat(event['date'] + 'T' + event['endTime'] + ':00+05:00')
                    if ends <= dt.datetime.now(dt.timezone.utc): raise APIError(409, 'Событие уже завершилось.')
                    if event.get('capacity') is not None and event['attendeeCount'] >= event['capacity']:
                        raise APIError(409, 'Все места заняты. Попробуйте позже.')
                    db.execute('INSERT INTO attendance VALUES (?,?,?)', (eid, user['id'], time.time()))
                elif method == 'DELETE':
                    db.execute('DELETE FROM attendance WHERE event_id=? AND user_id=?', (eid, user['id']))
                return {'event': self.event_view(db, row, user['id'])}
        match = re.fullmatch(r'/v1/events(?:/(event-[a-f0-9]{24}))?', path)
        if match and method in ('POST', 'PATCH', 'DELETE'):
            eid = match[1]
            if method == 'POST' and eid is not None or method != 'POST' and eid is None:
                raise APIError(404, 'Событие не найдено.')
            event = self.validate_event(data) if method != 'DELETE' else None
            with self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if eid:
                    row = db.execute('SELECT * FROM events WHERE id=?', (eid,)).fetchone()
                    if not row: raise APIError(404, 'Событие не найдено.')
                    if user['role'] != 'admin' and row['author_id'] != user['id']: raise APIError(403, 'Можно изменять только свои события.')
                    if json.loads(row['payload']).get('kind', 'official') == 'official' and user['role'] not in ('organizer', 'admin'):
                        raise APIError(403, 'Официальными событиями управляет организатор.')
                if event and event['kind'] == 'official' and user['role'] not in ('organizer', 'admin'):
                    raise APIError(403, 'Публикация от УУНиТ доступна только организаторам.')
                if event and eid and event['capacity'] is not None:
                    count = db.execute('SELECT COUNT(*) FROM attendance WHERE event_id=?', (eid,)).fetchone()[0]
                    if event['capacity'] < count: raise APIError(409, 'Лимит мест меньше числа записавшихся участников.')
                if method == 'POST':
                    eid = 'event-' + secrets.token_hex(12)
                    db.execute('INSERT INTO events VALUES (?,?,?,?,?)', (eid, user['id'], json.dumps(event, ensure_ascii=False), time.time(), time.time()))
                elif method == 'PATCH':
                    db.execute('UPDATE events SET payload=?, updated=? WHERE id=?', (json.dumps(event, ensure_ascii=False), time.time(), eid))
                else: db.execute('DELETE FROM events WHERE id=?', (eid,))
            return {'ok': True, 'id': eid}
        raise APIError(404, 'Адрес не найден.')

class RateLimiter:
    """Bounded per-client counters; only the WSGI server resolves trusted proxies."""
    def __init__(self, max_keys=10000):
        self.entries, self.lock, self.max_keys = {}, threading.Lock(), max_keys
        self.last_cleanup = 0

    def check(self, key, limit):
        now = time.monotonic()
        with self.lock:
            if now - self.last_cleanup >= 60:
                self.entries = {k: q for k, q in self.entries.items() if q and q[-1] > now - 60}
                self.last_cleanup = now
            q = self.entries.get(key)
            if q is None:
                if len(self.entries) >= self.max_keys: raise APIError(429, 'Сервер занят. Повторите через минуту.')
                q = self.entries[key] = deque()
            while q and q[0] <= now - 60: q.popleft()
            if len(q) >= limit: raise APIError(429, 'Слишком много запросов. Подождите минуту.')
            q.append(now)


class Application:
    """One WSGI transport for local tests and production; Store and /v1 API are shared."""
    def __init__(self, store, settings=None):
        self.store, self.settings, self.rates = store, settings or Settings(), RateLimiter()

    def cors_origin(self, environ):
        origin = environ.get('HTTP_ORIGIN', '')
        allowed = {'https://appassets.androidplatform.net', self.settings.public_url, *self.settings.cors_origins}
        if origin and origin in allowed: return origin
        if not self.settings.production:
            try:
                parsed = urlsplit(origin)
                if (parsed.scheme in ('http', 'https') and not parsed.path and not parsed.query
                        and not parsed.fragment and not parsed.username and not parsed.password
                        and (parsed.hostname in ('localhost', '127.0.0.1')
                             or parsed.netloc == environ.get('HTTP_HOST'))):
                    return origin
            except ValueError: pass
        return None

    def __call__(self, environ, start_response):
        started = time.monotonic()
        path, method = environ.get('PATH_INFO', '/'), environ['REQUEST_METHOD']
        headers = [('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'no-referrer'),
                   ('X-Frame-Options', 'DENY'), ('Vary', 'Origin')]
        allowed = self.cors_origin(environ)
        if allowed:
            headers += [('Access-Control-Allow-Origin', allowed),
                        ('Access-Control-Allow-Headers', 'Authorization, Content-Type'),
                        ('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS')]
        if self.settings.production and environ.get('wsgi.url_scheme') == 'https':
            headers.append(('Strict-Transport-Security', 'max-age=31536000'))
        status, content_type, cache = 200, 'application/json; charset=utf-8', 'no-store'
        try:
            if method == 'OPTIONS':
                if not path.startswith('/v1/'): raise APIError(404, 'Адрес не найден.')
                if not allowed: raise APIError(403, 'Этот источник не разрешён.')
                if environ.get('HTTP_ACCESS_CONTROL_REQUEST_METHOD', 'GET') not in ('GET', 'HEAD', 'POST', 'PATCH', 'DELETE'):
                    raise APIError(405, 'Метод не поддерживается.')
                requested = {v.strip().lower() for v in environ.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS', '').split(',') if v.strip()}
                if not requested <= {'authorization', 'content-type'}: raise APIError(403, 'Заголовок не разрешён.')
                body = b'{}'
            elif path.startswith('/v1/'):
                # CORS is an allowlist, not authentication; native clients have no Origin.
                if environ.get('HTTP_ORIGIN') and not allowed: raise APIError(403, 'Этот источник не разрешён.')
                client = environ.get('REMOTE_ADDR', 'unknown')
                if path != '/v1/health': self.rates.check(('request', client), self.settings.request_rate_limit)
                if method == 'POST' and path in ('/v1/auth/login', '/v1/auth/register'):
                    self.rates.check(('auth', client), self.settings.auth_rate_limit)
                try: length = int(environ.get('CONTENT_LENGTH') or '0')
                except ValueError: raise APIError(400, 'Некорректный размер запроса.')
                if not 0 <= length <= MAX_BODY: raise APIError(413, 'Запрос слишком большой.')
                if length and environ.get('CONTENT_TYPE', '').split(';')[0].strip().lower() != 'application/json':
                    raise APIError(415, 'Нужен Content-Type: application/json.')
                raw = environ['wsgi.input'].read(length) if length else b'{}'
                if length and len(raw) != length: raise APIError(400, 'Неполный запрос.')
                try: data = json.loads(raw)
                except (ValueError, UnicodeError): raise APIError(400, 'Некорректный JSON.')
                if not isinstance(data, dict): raise APIError(400, 'Ожидается JSON-объект.')
                auth = environ.get('HTTP_AUTHORIZATION', '')
                token = auth[7:] if auth.startswith('Bearer ') else ''
                result = self.store.dispatch('GET' if method == 'HEAD' else method, path, data, token)
                body = json.dumps(result, ensure_ascii=False).encode('utf-8')
            elif method in ('GET', 'HEAD'):
                base = (ROOT / 'app').resolve()
                target = (base / unquote(path).lstrip('/')).resolve()
                if target == base: target = base / 'index.html'
                if not target.is_relative_to(base) or not target.is_file(): raise APIError(404, 'Файл не найден.')
                body = target.read_bytes()
                content_type = {'.js':'application/javascript', '.css':'text/css', '.json':'application/json'}.get(target.suffix) or mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                cache = 'no-cache'
            else: raise APIError(404, 'Адрес не найден.')
        except APIError as error:
            status = error.status
            body = json.dumps({'error': error.message}, ensure_ascii=False).encode('utf-8')
            if status == 429: headers.append(('Retry-After', '60'))
        except sqlite3.OperationalError:
            status, body = 503, b'{"error":"Database unavailable. Please retry."}'
            LOG.error('database_unavailable')
        except Exception as error:
            status, body = 500, b'{"error":"Internal server error."}'
            LOG.error('request_error type=%s', type(error).__name__)
        headers += [('Content-Type', content_type), ('Cache-Control', cache), ('Content-Length', str(len(body)))]
        # Only known endpoint shapes: no credentials, bodies, query strings or attacker-supplied log lines.
        route = re.sub(r'/(event-)?[a-f0-9]{24,32}(?=/|$)', '/:id', path) if re.fullmatch(r'/v1/[a-zA-Z0-9/_-]+', path) else '/static'
        LOG.info('request method=%s route=%s status=%d duration_ms=%d', method, route, status, (time.monotonic()-started)*1000)
        start_response(f'{status} {HTTPStatus(status).phrase}', headers)
        return [b'' if method == 'HEAD' else body]


class LocalServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args): pass  # Application logs metadata, never raw request lines.


def make_server(host, port, store, settings=None):
    """Standard-library server for isolated tests only; CLI always uses Waitress."""
    return wsgi_server(host, port, Application(store, settings), server_class=LocalServer, handler_class=QuietHandler)


def bootstrap_admin(store, settings, env=None, interactive=False):
    env = os.environ if env is None else env
    if store.has_admin() and not interactive: return
    if interactive:
        if not sys.stdin.isatty(): raise ValueError('--init-admin требует интерактивный терминал.')
        username = input('Логин администратора: ').strip()
        name = input('Имя: ').strip() or username
        password = getpass.getpass('Пароль: ')
        if password != getpass.getpass('Повторите пароль: '): raise ValueError('Пароли не совпадают.')
    else:
        username, password = env.get('ADMIN_USERNAME', ''), env.get('ADMIN_PASSWORD', '')
        name = env.get('ADMIN_NAME') or username
        if not username or not password:
            raise ValueError('Первая настройка: задайте ADMIN_USERNAME и ADMIN_PASSWORD или выполните --init-admin в терминале.')
    if settings.production and len(password) < 12:
        raise ValueError('Пароль администратора в production должен содержать не менее 12 символов.')
    try: store.register({'username': username, 'name': name, 'password': password}, role='admin')
    except APIError as error: raise ValueError(error.message) from None
    LOG.info('administrator_created')


def waitress_options(settings):
    options = dict(host=settings.host, port=settings.port, threads=settings.threads,
                   max_request_body_size=MAX_BODY, max_request_header_size=16384,
                   channel_timeout=30, connection_limit=128, clear_untrusted_proxy_headers=True,
                   ident='UUSTCampus')
    if settings.trusted_proxy:
        options.update(trusted_proxy=settings.trusted_proxy, trusted_proxy_count=settings.trusted_proxy_count,
                       trusted_proxy_headers={'x-forwarded-for', 'x-forwarded-proto'})
    return options


def main(argv=None):
    parser = argparse.ArgumentParser(description='UUST Campus — общий сервер афиши и аккаунтов')
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--data')
    parser.add_argument('--init-admin', action='store_true', help='Создать администратора в терминале и выйти')
    parser.add_argument('--backup', metavar='FILE', help='Создать согласованную копию SQLite и выйти')
    args = parser.parse_args(argv)
    try:
        environment = dict(os.environ)
        for key, value in [('HOST',args.host), ('PORT',args.port), ('DATABASE_PATH',args.data)]:
            if value is not None: environment[key] = str(value)
        settings = Settings.from_env(environment)
        if settings.production: os.umask(0o077)
        logging.basicConfig(level=settings.log_level, format='%(asctime)s %(levelname)s %(message)s', stream=sys.stdout)
        if args.backup and not Path(settings.database_path).is_file(): raise ValueError('База для резервного копирования не найдена.')
        store = Store(settings.database_path)
        if args.backup:
            store.backup(args.backup)
            LOG.info('database_backup_complete')
            return
        bootstrap_admin(store, settings, interactive=args.init_admin or (not settings.production and not store.has_admin() and not os.environ.get('ADMIN_USERNAME') and sys.stdin.isatty()))
        if args.init_admin: return
        from waitress import create_server
        server = create_server(Application(store, settings), **waitress_options(settings))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'Ошибка запуска: {error}\n')
    except ImportError:
        parser.exit(1, 'Установите зависимости: python -m pip install -r server/requirements.txt\n')
    LOG.info('server_started host=%s port=%d environment=%s', settings.host, settings.port, settings.environment)
    print('Профиль → Сервер команды →', settings.public_url or f'http://127.0.0.1:{settings.port}', flush=True)
    def terminate(signum, frame): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    try: server.run()
    except KeyboardInterrupt: pass
    finally:
        server.close()
        LOG.info('server_stopped')


if __name__ == '__main__': main()
