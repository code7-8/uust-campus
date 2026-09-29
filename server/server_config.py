"""Deployment settings. Secrets are read at startup, never logged or persisted here."""
import os
import ipaddress
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def origin(value, https_only=False):
    value = value.strip().rstrip('/')
    if any(c.isspace() or ord(c)<32 for c in value):
        raise ValueError('В адресе сервера недопустимы пробелы и управляющие символы.')
    parsed = urlsplit(value)
    if (parsed.scheme not in (('https',) if https_only else ('http', 'https'))
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise ValueError('Нужен адрес сервера без пути и параметров' + (' с HTTPS.' if https_only else '.'))
    parsed.port  # Validate the port, including out-of-range values.
    return value


@dataclass(frozen=True)
class Settings:
    environment: str = 'development'
    host: str = '0.0.0.0'
    port: int = 8787
    database_path: str = str(Path(__file__).parent / 'data' / 'campus.sqlite')
    public_url: str = ''
    cors_origins: tuple = ()
    threads: int = 8
    trusted_proxy: str = ''
    trusted_proxy_count: int = 1
    auth_rate_limit: int = 25
    request_rate_limit: int = 300
    log_level: str = 'INFO'

    @property
    def production(self):
        return self.environment == 'production'

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        mode = env.get('CAMPUS_ENV', 'development')
        if mode not in ('development', 'production'):
            raise ValueError('CAMPUS_ENV: development или production.')

        def number(key, default, maximum):
            try:
                value = int(env.get(key, str(default)))
                if not 1 <= value <= maximum: raise ValueError()
                return value
            except ValueError:
                raise ValueError(f'{key}: целое число от 1 до {maximum}.') from None

        database = env.get('DATABASE_PATH', cls.database_path)
        if mode == 'production' and ('DATABASE_PATH' not in env or not Path(database).is_absolute()):
            raise ValueError('В production задайте абсолютный DATABASE_PATH на постоянном диске.')
        if not database or database == ':memory:':
            raise ValueError('DATABASE_PATH должен указывать на файл SQLite.')
        public = env.get('PUBLIC_URL') or env.get('RENDER_EXTERNAL_URL', '')
        if mode == 'production' and not public:
            raise ValueError('В production задайте PUBLIC_URL с HTTPS (на Render он определяется автоматически).')
        if public: public = origin(public, https_only=mode == 'production')
        cors = tuple(origin(item, https_only=mode == 'production') for item in env.get('CORS_ORIGINS', '').split(',') if item.strip())
        level = env.get('LOG_LEVEL', 'INFO').upper()
        if level not in ('DEBUG', 'INFO', 'WARNING', 'ERROR'):
            raise ValueError('LOG_LEVEL: DEBUG, INFO, WARNING или ERROR.')
        proxy = env.get('TRUSTED_PROXY', '').strip()
        if proxy and proxy != '*':
            try: ipaddress.ip_address(proxy)
            except ValueError: raise ValueError('TRUSTED_PROXY: IP-адрес или * для изолированного прокси.') from None
        return cls(environment=mode, host=env.get('HOST', '0.0.0.0'), port=number('PORT', 8787, 65535),
                   database_path=str(Path(database).resolve()), public_url=public, cors_origins=cors,
                   threads=number('THREADS', 8, 64), trusted_proxy=proxy,
                   trusted_proxy_count=number('TRUSTED_PROXY_COUNT', 1, 10),
                   auth_rate_limit=number('AUTH_RATE_LIMIT', 25, 10000),
                   request_rate_limit=number('REQUEST_RATE_LIMIT', 300, 100000), log_level=level)
