import http.client
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from remote_gateway import ShareServer, ShareHandler


class Origin(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.requests.append((self.path, dict(self.headers)))
        body = b'<html><head></head><body>Learning site</body></html>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        self.requests.append((self.path, dict(self.headers), data))
        body = b'{"reply":"upstream test reply"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class RemoteShareTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.state = Path(self.directory.name)
        self.origin = ThreadingHTTPServer(('127.0.0.1', 0), Origin)
        Thread(target=self.origin.serve_forever, daemon=True).start()
        Origin.requests = []
        (self.state / 'public-origin.json').write_text(json.dumps({'origin': 'https://lesson.example.test'}))
        self.server = ShareServer(('127.0.0.1', 0), ShareHandler, self.state,
                                  f'http://127.0.0.1:{self.origin.server_port}')
        Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close()
        self.origin.shutdown(); self.origin.server_close()
        self.directory.cleanup()

    def request(self, method, path, body=None, cookie=None, origin='https://lesson.example.test', host='lesson.example.test'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Host': host}
        if origin:
            headers['Origin'] = origin
        if cookie:
            headers['Cookie'] = cookie
        if body is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if path == '/auth/login' else 'application/json'
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def login(self):
        code = (self.state / 'access-code.txt').read_text().strip()
        status, headers, _ = self.request('POST', '/auth/login', 'code=' + code)
        self.assertEqual(status, 303)
        cookie = headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie)
        self.assertIn('Secure', cookie)
        self.assertIn('SameSite=Strict', cookie)
        return cookie.split(';', 1)[0]

    def test_unauthenticated_and_wrong_password_never_reach_local_ai(self):
        self.assertEqual(self.request('GET', '/')[0], 303)
        self.assertEqual(self.request('POST', '/api/chat', '{}')[0], 401)
        self.assertEqual(self.request('POST', '/auth/login', 'code=incorrect')[0], 401)
        self.assertEqual(Origin.requests, [])

    def test_qr_invitation_establishes_secure_session_and_rotation_blocks_new_sessions(self):
        token = self.server.invites.issue('https://lesson.example.test')
        status, headers, _ = self.request('POST', '/auth/invite', json.dumps({'token': token}))
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie'].split(';')[0]
        for flag in ['HttpOnly', 'Secure', 'SameSite=Strict']: self.assertIn(flag, headers['Set-Cookie'])
        self.assertEqual(self.request('POST', '/api/chat', '{}', cookie=cookie)[0], 200)
        self.assertEqual(self.server.invites.status()['remaining'], 9)
        self.request('POST', '/auth/invite', json.dumps({'token': token}), cookie=cookie)
        self.assertEqual(self.server.invites.status()['remaining'], 9)
        self.server.invites.revoke()
        self.assertEqual(self.request('POST', '/auth/invite', json.dumps({'token': token}))[0], 403)
        self.assertEqual(self.request('GET', '/', cookie=cookie)[0], 200)

    def test_join_is_public_but_management_never_reaches_upstream(self):
        self.assertEqual(self.request('GET', '/join')[0], 200)
        self.assertEqual(self.request('GET', '/join.js')[0], 200)
        cookie = self.login()
        for path in ['/host', '/host.js', '/api/host/status', '/api/host/invite', '/api/host/qr', '/api/host/identity']:
            self.assertEqual(self.request('GET', path, cookie=cookie)[0], 404)
        self.assertEqual(self.request('POST', '/api/host/start', '{}', cookie=cookie)[0], 404)
        self.assertEqual(Origin.requests, [])

    def test_invite_rejects_wrong_origin_and_expiry(self):
        token = self.server.invites.issue('https://lesson.example.test', now=1)
        self.assertEqual(self.request('POST', '/auth/invite', json.dumps({'token': token}))[0], 403)
        self.assertEqual(self.request('POST', '/auth/invite', json.dumps({'token': token}), origin='https://evil.test')[0], 403)

    def test_authenticated_site_enables_remote_ai_and_proxies_to_loopback(self):
        cookie = self.login()
        status, _, body = self.request('GET', '/', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn(b'/remote-runtime.js', body)
        status, _, body = self.request('GET', '/remote-runtime.js', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn(b'DeskTalkRemote', body)
        status, _, body = self.request('POST', '/api/chat', '{"messages":[]}', cookie=cookie)
        self.assertEqual(status, 200)
        self.assertIn(b'upstream test reply', body)
        headers = Origin.requests[-1][1]
        self.assertEqual(headers['Host'], f'127.0.0.1:{self.origin.server_port}')
        self.assertNotIn('Cookie', headers)
        self.assertNotIn('Origin', headers)

    def test_cross_site_requests_unknown_hosts_and_private_paths_are_rejected(self):
        cookie = self.login()
        self.assertEqual(self.request('POST', '/api/chat', '{}', cookie, origin='https://evil.test')[0], 403)
        self.assertEqual(self.request('GET', '/', cookie=cookie, host='evil.test')[0], 403)
        for path in ['/.env', '/.remote-share/access-code.txt', '/server.py', '/../.env', '/%2eenv', '/api/tags']:
            self.assertEqual(self.request('GET', path, cookie=cookie)[0], 404)
        self.assertEqual(Origin.requests, [])

    def test_expired_and_forged_cookies_cannot_call_ai(self):
        cookie = self.login()
        with self.server.lock:
            for session in self.server.sessions.values():
                session['expires'] = 0
        self.assertEqual(self.request('POST', '/api/chat', '{}', cookie)[0], 401)
        self.assertEqual(self.request('POST', '/api/chat', '{}', 'desktalk_share=forged')[0], 401)

    def test_oversized_chat_and_busy_model_are_rejected_before_proxying(self):
        cookie = self.login()
        self.assertEqual(self.request('POST', '/api/chat', 'x' * 131073, cookie)[0], 413)
        self.server.model_slots.acquire(); self.server.model_slots.acquire()
        try:
            self.assertEqual(self.request('POST', '/api/chat', '{}', cookie)[0], 429)
        finally:
            self.server.model_slots.release(); self.server.model_slots.release()
        self.assertEqual(Origin.requests, [])

    def test_wrong_attempts_do_not_lock_out_the_owner_with_the_correct_code(self):
        for _ in range(10):
            self.assertEqual(self.request('POST', '/auth/login', 'code=incorrect')[0], 401)
        self.assertEqual(self.request('POST', '/auth/login', 'code=incorrect')[0], 429)
        self.login()

    def test_anonymous_connections_have_a_shared_limit(self):
        for _ in range(16):
            self.assertTrue(self.server.connection_slots.acquire(blocking=False))
        try:
            self.assertEqual(self.request('GET', '/auth')[0], 503)
        finally:
            for _ in range(16):
                self.server.connection_slots.release()


if __name__ == '__main__':
    unittest.main()
