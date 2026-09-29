import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

from waitress import create_server
from server import Application, Store, bootstrap_admin, waitress_options, RateLimiter, APIError
from server_config import Settings


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'persistent' / 'campus.sqlite'
        self.settings = Settings.from_env({'CAMPUS_ENV': 'production', 'DATABASE_PATH': str(self.path),
                                          'PUBLIC_URL': 'https://campus.example.org'})
        self.store = Store(self.path)
        self.http = build_opener(ProxyHandler({}))

    def tearDown(self):
        self.temp.cleanup()

    def start(self, settings=None):
        settings = replace(settings or self.settings, host='127.0.0.1', port=0)
        server = create_server(Application(self.store, settings), **waitress_options(settings))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.close)
        return 'http://127.0.0.1:' + str(server.effective_port)

    def request(self, base, path, method='GET', body=None, token='', headers=None):
        headers = {'Content-Type': 'application/json', **(headers or {})}
        if token: headers['Authorization'] = 'Bearer ' + token
        request = Request(base+path, data=json.dumps(body).encode() if body is not None else None,
                          method=method, headers=headers)
        try: response = self.http.open(request, timeout=5)
        except HTTPError as error: response = error
        with response:
            raw = response.read()
            return response.status, dict(response.headers), json.loads(raw) if raw else None

    def test_environment_defaults_and_invalid_production_config(self):
        self.assertEqual(Settings.from_env({}).port, 8787)
        actual = Settings.from_env({'CAMPUS_ENV':'production', 'DATABASE_PATH':str(self.path),
                                    'RENDER_EXTERNAL_URL':'https://campus.onrender.com', 'PORT':'10000'})
        self.assertEqual((actual.public_url, actual.port), ('https://campus.onrender.com', 10000))
        for change in ({'DATABASE_PATH':'relative.db'}, {'PORT':'no'}, {'PUBLIC_URL':'http://example.org'},
                       {'PUBLIC_URL':'https://example.org/v1'}, {'PUBLIC_URL':'https://u:p@example.org'},
                       {'CORS_ORIGINS':'*'}, {'THREADS':'0'}, {'CAMPUS_ENV':'typo'}, {'TRUSTED_PROXY':'anybody'}):
            with self.assertRaises(ValueError):
                Settings.from_env({'CAMPUS_ENV':'production', 'DATABASE_PATH':str(self.path),
                                   'PUBLIC_URL':'https://campus.example.org', **change})

    def test_bootstrap_is_noninteractive_and_never_resets_existing_admin(self):
        with self.assertRaisesRegex(ValueError, 'ADMIN_USERNAME'):
            bootstrap_admin(self.store, self.settings, {})
        with self.assertRaisesRegex(ValueError, '12'):
            bootstrap_admin(self.store, self.settings, {'ADMIN_USERNAME':'admin','ADMIN_PASSWORD':'shortpass'})
        bootstrap_admin(self.store, self.settings, {'ADMIN_USERNAME':'admin','ADMIN_PASSWORD':'long-admin-password'})
        bootstrap_admin(self.store, self.settings, {'ADMIN_USERNAME':'admin','ADMIN_PASSWORD':'different-password'})
        self.assertEqual(self.store.login('admin','long-admin-password')['user']['role'],'admin')
        with self.assertRaises(APIError): self.store.login('admin','different-password')
        bootstrap_admin(self.store, self.settings, {})  # Secrets can be removed after setup.

    def test_cloud_startup_without_bootstrap_credentials_exits_instead_of_prompting(self):
        env = {k:v for k,v in os.environ.items() if k not in ('ADMIN_USERNAME','ADMIN_PASSWORD','ADMIN_NAME')}
        env.update(CAMPUS_ENV='production', DATABASE_PATH=str(self.path), PUBLIC_URL='https://campus.example.org')
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('server.py'))], env=env,
                                input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'ADMIN_USERNAME',result.stderr)

    def test_production_entrypoint_uses_port_and_keeps_accounts_after_process_restart(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
        env={**os.environ,'PYTHONUTF8':'1','CAMPUS_ENV':'production','HOST':'127.0.0.1','PORT':str(port),
             'DATABASE_PATH':str(self.path),'PUBLIC_URL':'https://campus.example.org',
             'ADMIN_USERNAME':'cloud_admin','ADMIN_PASSWORD':'cloud-admin-password'}
        base=f'http://127.0.0.1:{port}'
        for boot in range(2):
            process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('server.py')),'--data',str(self.path)],env={k:v for k,v in env.items() if k!='DATABASE_PATH'},
                                     stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+10
                while True:
                    try:
                        status,_,health=self.request(base,'/v1/health')
                        self.assertEqual(status,200); self.assertFalse(health['setupRequired']); break
                    except OSError:
                        if time.monotonic()>deadline or process.poll() is not None: self.fail('Production server did not start')
                        time.sleep(.05)
                status,_,login=self.request(base,'/v1/auth/login','POST',{'username':'cloud_admin','password':'cloud-admin-password'})
                self.assertEqual(status,200)
                self.assertEqual(login['user']['role'],'admin')
                if not boot: uid=login['user']['id']
                else: self.assertEqual(login['user']['id'],uid)
            finally:
                process.terminate(); logs=process.communicate(timeout=10)[0]
            self.assertNotIn(b'cloud-admin-password',logs)
            env['ADMIN_PASSWORD']='must-not-reset-password'

    def test_two_networks_register_login_publish_join_restart_and_backup(self):
        bootstrap_admin(self.store,self.settings,{'ADMIN_USERNAME':'admin','ADMIN_PASSWORD':'long-admin-password'})
        base = self.start(replace(self.settings, trusted_proxy='127.0.0.1'))
        first = {'X-Forwarded-For':'198.51.100.10', 'X-Forwarded-Proto':'https'}
        second = {'X-Forwarded-For':'203.0.113.20', 'X-Forwarded-Proto':'https'}
        credentials = {'username':'author','name':'Автор','password':'author-password'}
        status, _, registered = self.request(base,'/v1/auth/register','POST',credentials,headers=first)
        self.assertEqual(status,200)
        status, _, author = self.request(base,'/v1/auth/login','POST',credentials,headers=first)
        self.assertEqual(status,200)
        status, _, member = self.request(base,'/v1/auth/register','POST',
                                        {'username':'member','name':'Участник','password':'member-password'},headers=second)
        self.assertEqual(status,200)
        event = {'title':'Общая встреча','category':'Встреча','description':'Через интернет','place':'Корпус 6',
                 'date':'2099-09-30','time':'16:00','endTime':'17:00','buildingId':'6','capacity':1}
        status, _, created = self.request(base,'/v1/events','POST',event,author['token'],first)
        self.assertEqual(status,200)
        path = '/v1/events/'+created['id']+'/attendance'
        self.assertEqual(self.request(base,'/v1/events',headers=second)[2]['events'][0]['title'],event['title'])
        status, _, joined = self.request(base,path,'POST',{},member['token'],second)
        self.assertEqual(status,200); self.assertTrue(joined['event']['viewerGoing'])
        self.assertEqual(self.request(base,path,'POST',{},author['token'],first)[0],409)
        backup = Path(self.temp.name)/'backup.sqlite'
        self.store.backup(backup)
        with self.assertRaises(FileExistsError): self.store.backup(backup)
        for restored in (Store(self.path), Store(backup)):
            row = restored.dispatch('GET','/v1/events',{},member['token'])['events'][0]
            self.assertTrue(row['viewerGoing']); self.assertEqual(row['attendeeCount'],1)
        self.assertEqual(self.request(base,path,'DELETE',{},member['token'],second)[2]['event']['attendeeCount'],0)
        self.assertEqual(self.request(base,'/v1/auth/logout','POST',{},author['token'])[0],200)
        self.assertEqual(self.request(base,'/v1/auth/me',token=author['token'])[0],401)

    def test_cors_https_origin_and_head_health(self):
        base = self.start(replace(self.settings,trusted_proxy='127.0.0.1'))
        for origin in ('https://campus.example.org','https://appassets.androidplatform.net'):
            code, headers, _ = self.request(base,'/v1/events','OPTIONS',headers={
                'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'})
            self.assertEqual(code,200); self.assertEqual(headers['Access-Control-Allow-Origin'],origin)
        for origin in ('https://evil.example','null','http://localhost:4173'):
            code, headers, _ = self.request(base,'/v1/events','OPTIONS',headers={'Origin':origin})
            self.assertEqual(code,403); self.assertNotIn('Access-Control-Allow-Origin',headers)
        code, headers, body = self.request(base,'/v1/health','HEAD',headers={'X-Forwarded-Proto':'https'})
        self.assertEqual(code,200); self.assertIsNone(body); self.assertIn('Strict-Transport-Security',headers)

    def test_trusted_proxy_uses_rightmost_client_and_untrusted_headers_cannot_bypass_limits(self):
        settings = replace(self.settings,auth_rate_limit=2,trusted_proxy='127.0.0.1')
        base = self.start(settings)
        credentials = {'username':'nobody','password':'wrong-password'}
        for spoof in ('192.0.2.1','192.0.2.2'):
            self.assertEqual(self.request(base,'/v1/auth/login','POST',credentials,headers={'X-Forwarded-For':spoof+', 198.51.100.1'})[0],401)
        self.assertEqual(self.request(base,'/v1/auth/login','POST',credentials,headers={'X-Forwarded-For':'192.0.2.3, 198.51.100.1'})[0],429)
        self.assertEqual(self.request(base,'/v1/auth/login','POST',credentials,headers={'X-Forwarded-For':'203.0.113.2'})[0],401)
        untrusted = self.start(replace(settings,trusted_proxy=''))
        for i in range(3):
            self.assertEqual(self.request(untrusted,'/v1/auth/login','POST',credentials,headers={'X-Forwarded-For':f'192.0.2.{i+1}'})[0],401 if i<2 else 429)

    def test_request_limits_static_boundary_and_errors(self):
        base = self.start()
        self.assertEqual(self.request(base,'/%2e%2e/server/server.py')[0],404)
        self.assertEqual(self.request(base,'/v1/events','POST',[])[0],400)
        self.assertEqual(self.request(base,'/v1/events','POST',{},headers={'Content-Type':'text/plain'})[0],415)
        request = Request(base+'/v1/events',data=b'x'*65537,headers={'Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as error: self.http.open(request,timeout=5)
        self.assertEqual(error.exception.code,413)
        error.exception.close()
        limiter = RateLimiter(max_keys=2)
        limiter.check('a',1);limiter.check('b',1)
        with self.assertRaises(APIError):limiter.check('c',1)
        self.assertEqual(len(limiter.entries),2)


if __name__ == '__main__': unittest.main()
