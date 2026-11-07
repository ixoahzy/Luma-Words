"""Password-protected loopback gateway for sharing DeskTalk through an HTTPS tunnel."""
import argparse
from collections import deque
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
from threading import Lock, BoundedSemaphore
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from server import STATIC_FILES
from voice_backend import MAX_AUDIO_BYTES
from invite_store import InviteStore, InviteError

ROOT = Path(__file__).resolve().parent
LOGIN_PAGE = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeskTalk · 访问口令</title><style>*{box-sizing:border-box}body{margin:0;background:#fff7ed;color:#3d2b22;font-family:system-ui;display:grid;place-items:center;min-height:100dvh;padding:24px}main{max-width:400px;width:100%;background:#fff;border-radius:24px;padding:30px;box-shadow:0 15px 60px #26334d15}h1{font-size:26px;margin:0 0 12px}p,small{color:#886e5d;line-height:1.8}label{display:block;margin:24px 0 8px}input,button{width:100%;font:inherit;padding:13px;border-radius:12px}input{border:1px solid #eadbca}button{margin:14px 0;border:0;background:#9b552a;color:white;cursor:pointer}.error{color:#b42318}</style>
<main><h1>DeskTalk · lion</h1><p>输入站长提供的访问口令，开始学习和 AI 对话。</p>ERROR_PLACEHOLDER
<form action="/auth/login" method="post"><label for="code">访问口令</label><input id="code" name="code" type="password" autocomplete="current-password" required maxlength="200"><button>进入 DeskTalk</button></form>
<small>AI 与录音识别由站长电脑运行，对话和录音经 Cloudflare HTTPS 通道传输，录音识别后不保存。学习记录保存在你自己的浏览器中。</small></main></html>"""


class ShareServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, state_dir, upstream):
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.state_dir.chmod(0o700)
        path = self.state_dir / 'access-code.txt'
        if not path.exists():
            descriptor = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w') as output:
                output.write(secrets.token_urlsafe(24) + '\n')
        path.chmod(0o600)
        self.passcode = path.read_text().strip().encode()
        if len(self.passcode) < 20:
            raise ValueError('访问口令过短，请为共享服务使用至少 20 个字符的随机口令。')
        parsed = urlsplit(upstream)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path not in ('', '/'):
            raise ValueError('共享服务只能转发到本机 DeskTalk。')
        self.upstream = upstream.rstrip('/')
        self.lock = Lock()
        self.sessions = {}
        self.failed_logins = deque()
        self.model_slots = BoundedSemaphore(2)
        self.invites = InviteStore(self.state_dir)
        self.connection_slots = BoundedSemaphore(16)
        super().__init__(address, handler)

    def process_request(self, request, address):
        if not self.connection_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.connection_slots.release()

    def public_origin(self):
        try:
            origin = json.loads((self.state_dir / 'public-origin.json').read_text())['origin'].rstrip('/')
            parsed = urlsplit(origin)
            if parsed.scheme == 'https' and parsed.hostname and parsed.netloc == parsed.hostname and not parsed.path:
                return origin
        except (OSError, ValueError, KeyError, TypeError):
            pass
        return None


class ShareHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(15)
        super().setup()

    def log_message(self, *args):
        # Keep credentials, visitor speech and dialogue out of request logs.
        pass

    def respond(self, status, body=b'', mime='application/json; charset=utf-8', headers=None):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        if isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def valid_host(self):
        hosts = self.headers.get_all('Host', [])
        public = self.server.public_origin()
        allowed = {f'127.0.0.1:{self.server.server_port}': f'http://127.0.0.1:{self.server.server_port}',
                   f'localhost:{self.server.server_port}': f'http://localhost:{self.server.server_port}'}
        if public:
            allowed[urlsplit(public).netloc] = public
        if len(hosts) != 1 or hosts[0] not in allowed:
            self.respond(403, {'error': '此访问地址未获允许。'})
            return False
        self.expected_origin = allowed[hosts[0]]
        return True

    def valid_origin(self):
        origins = self.headers.get_all('Origin', [])
        if len(origins) != 1 or origins[0] != self.expected_origin:
            self.respond(403, {'error': '请从 DeskTalk 共享页面发送请求。'})
            return False
        return True

    def session(self):
        try:
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            token = cookie.get('desktalk_share')
            digest = hashlib.sha256(token.value.encode()).hexdigest() if token else ''
        except (CookieError, ValueError):
            return None
        with self.server.lock:
            value = self.server.sessions.get(digest)
            if value and value['expires'] > time.monotonic():
                return value
        return None

    def read_body(self, limit):
        try:
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                raise ValueError()
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= limit:
                self.respond(413, {'error': '请求为空或过大，请缩短消息或录音。'})
                return None
            self.connection.settimeout(15)
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError()
            return body
        except (ValueError, OSError, socket.timeout):
            self.respond(400, {'error': '请求不完整，请重试。'})
            return None

    def do_GET(self):
        if not self.valid_host():
            return
        path = urlsplit(self.path).path
        session = self.session()
        if path in ('/join', '/join.js'):
            name = 'join.html' if path == '/join' else 'join.js'
            self.respond(200, (ROOT / name).read_bytes(), 'text/html; charset=utf-8' if path == '/join' else 'text/javascript; charset=utf-8',
                         {'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"})
            return
        if path == '/host' or path.startswith('/api/host/'):
            self.respond(404, {'error': '主机控制台不对访客开放。'})
            return
        if path == '/auth':
            if session:
                self.respond(303, headers={'Location': '/'})
            else:
                self.respond(200, LOGIN_PAGE.replace('ERROR_PLACEHOLDER', ''), 'text/html; charset=utf-8')
            return
        if not session:
            if path.startswith('/api/') or path == '/remote-runtime.js':
                self.respond(401, {'error': '访问已过期，请刷新页面重新输入口令。'})
            else:
                self.respond(303, headers={'Location': '/auth'})
            return
        if path == '/remote-runtime.js':
            self.respond(200, 'window.DeskTalkRemote = { enabled: true };', 'text/javascript; charset=utf-8')
            return
        if path == '/api/voices':
            self.forward(path)
            return
        name = path.lstrip('/') or 'index.html'
        if name not in STATIC_FILES or path.startswith('//'):
            self.respond(404, {'error': '页面不存在。'})
            return
        self.forward('/' + name)

    def do_POST(self):
        if not self.valid_host() or not self.valid_origin():
            return
        path = urlsplit(self.path).path
        if path == '/auth/login':
            self.login()
            return
        if path == '/auth/invite':
            self.exchange_invite()
            return
        session = self.session()
        if not session:
            self.respond(401, {'error': '访问已过期，请刷新页面重新输入口令。'})
            return
        if path not in ('/api/chat', '/api/transcribe', '/api/speak'):
            self.respond(404, {'error': '接口不存在。'})
            return
        body = self.read_body(MAX_AUDIO_BYTES if path == '/api/transcribe' else 131072)
        if body is None:
            return
        with self.server.lock:
            now = time.monotonic()
            times = session.setdefault('speech_requests', deque()) if path == '/api/speak' else session['requests']
            while times and now - times[0] >= 60:
                times.popleft()
            if len(times) >= 12:
                self.respond(429, {'error': '请求过于频繁，请稍候再试。'})
                return
            times.append(now)
        if not self.server.model_slots.acquire(blocking=False):
            self.respond(429, {'error': '主机正在处理其他请求，请稍候或重试。'})
            return
        try:
            self.forward(path, body)
        finally:
            self.server.model_slots.release()

    def login(self):
        body = self.read_body(4096)
        if body is None:
            return
        with self.server.lock:
            now = time.monotonic()
            failures = self.server.failed_logins
            while failures and now - failures[0] >= 60:
                failures.popleft()
            try:
                provided = parse_qs(body.decode('utf-8'), max_num_fields=4).get('code', [''])[0].encode()
            except (ValueError, UnicodeError):
                provided = b''
            if not hmac.compare_digest(self.server.passcode, provided):
                if len(failures) >= 10:
                    self.respond(429, {'error': '口令尝试过于频繁，请一分钟后重试。'})
                    return
                failures.append(now)
                page = LOGIN_PAGE.replace('ERROR_PLACEHOLDER', '<p class="error" role="alert">口令不正确，请重试。</p>')
                self.respond(401, page, 'text/html; charset=utf-8')
                return
            token = self.new_session(now)
        self.respond(303, headers={'Location': '/', 'Set-Cookie': f'desktalk_share={token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'})

    def new_session(self, now):
        # Caller holds server.lock, shared with password login and invitation exchange.
        token = secrets.token_urlsafe(32)
        self.server.sessions = {key: value for key, value in self.server.sessions.items() if value['expires'] > now}
        if len(self.server.sessions) >= 64: self.server.sessions.pop(next(iter(self.server.sessions)))
        self.server.sessions[hashlib.sha256(token.encode()).hexdigest()] = {'expires': now + 28800, 'requests': deque()}
        return token

    def exchange_invite(self):
        if self.headers.get_content_type() != 'application/json':
            self.respond(415, {'error': '请重新扫码进入。'}); return
        body = self.read_body(4096)
        if body is None: return
        if self.session():
            self.respond(200, {'ok': True}); return
        with self.server.lock:
            now = time.monotonic()
            failures = self.server.failed_logins
            while failures and now - failures[0] >= 60: failures.popleft()
            if len(failures) >= 10:
                self.respond(429, {'error': '邀请验证过于频繁，请一分钟后重试。'}); return
            try:
                payload = json.loads(body)
                self.server.invites.redeem(payload.get('token') if isinstance(payload, dict) else None, self.server.public_origin())
            except (ValueError, UnicodeError) as error:
                failures.append(now)
                self.respond(403, {'error': str(error) if isinstance(error, InviteError) else '邀请格式不正确，请重新扫码。'}); return
            token = self.new_session(now)
        self.respond(200, {'ok': True}, headers={'Set-Cookie': f'desktalk_share={token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'})

    def forward(self, path, body=None):
        headers = {}
        for key in ('Content-Type', 'X-Audio-Language'):
            value = self.headers.get(key)
            if body is not None and value:
                headers[key] = value
        request = Request(self.server.upstream + path, data=body, headers=headers)
        try:
            with urlopen(request, timeout=130) as response:
                data, status, mime = response.read(), response.status, response.headers.get('Content-Type', 'application/octet-stream')
        except HTTPError as error:
            data, status, mime = error.read(), error.code, error.headers.get('Content-Type', 'application/json')
        except (URLError, OSError, TimeoutError):
            self.respond(503, {'error': '站长的本机服务暂时不可用，请稍后重试。'})
            return
        if path == '/index.html' and status == 200:
            data = data.replace(b'</head>', b'<script src="/remote-runtime.js"></script></head>', 1)
        self.respond(status, data, mime)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8001)
    parser.add_argument('--upstream', default='http://127.0.0.1:8000')
    arguments = parser.parse_args()
    server = ShareServer(('127.0.0.1', arguments.port), ShareHandler, ROOT / '.remote-share', arguments.upstream)
    print('DeskTalk protected sharing gateway ready.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
