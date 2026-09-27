"""Local development server. Android performs these same allowlisted requests natively."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen, Request
import json, re, argparse

ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    # Windows registry may associate .js with text/plain; modules require JS MIME.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml'}
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'app'), **kwargs)
    def do_GET(self):
        parsed=urlparse(self.path)
        if not parsed.path.startswith('/api/'):
            return super().do_GET()
        if parsed.path == '/api/groups':
            target='groups'
        elif parsed.path == '/api/schedule':
            query=parse_qs(parsed.query)
            group=query.get('group',[''])[0]
            semester=query.get('semester',[''])[0]
            if not re.fullmatch(r'[1-9][0-9]{0,8}',group) or not re.fullmatch(r'[1-9][0-9]{0,5}',semester):
                self.send_error(400); return
            target=f'schedule/0/{group}/semester/{semester}'
        else:
            self.send_error(404); return
        try:
            request=Request('https://dev.uust-time.ru/api/v/852972/'+target+'?site=schedule', headers={'User-Agent':'UUSTCampus/0.1 student prototype','Accept':'application/json'})
            with urlopen(request,timeout=18) as response:
                body=response.read(8*1024*1024+1)
            if len(body)>8*1024*1024: raise ValueError('Response too large')
            json.loads(body)
            self.send_response(200)
        except Exception:
            body=b'{"error":"Schedule source unavailable"}'
            self.send_response(502)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass
    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith('GET /api/'):
            super().log_message(fmt,*args)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=4173)
    args=parser.parse_args()
    print(f'UUST Campus preview: http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port), Handler).serve_forever()
