import http.client
from http.server import ThreadingHTTPServer
from threading import Thread
from unittest.mock import Mock
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import fcntl
import subprocess
import sys
import time
from server import Handler, STATIC_FILES


class HostBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.host_control = Mock()
        self.server.last_calls = {}
        Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, origin=None, host=None, body='{}'):
        port = self.server.server_port
        headers={'Content-Type':'application/json','Host':host or f'127.0.0.1:{port}'}
        if origin: headers['Origin']=origin
        connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        connection.request('POST','/api/host/start',body,headers)
        response=connection.getresponse();response.read();connection.close();return response.status

    def test_management_requires_exact_origin_and_is_not_public_static(self):
        self.assertNotIn('host.html', STATIC_FILES)
        self.assertNotIn('host.js', STATIC_FILES)
        self.assertEqual(self.request(),403)
        self.assertEqual(self.request(origin='https://evil.test'),403)
        self.assertEqual(self.request(origin='http://evil.test',host='evil.test'),403)
        self.server.host_control.action.assert_not_called()
        self.assertEqual(self.request(origin=f'http://127.0.0.1:{self.server.server_port}'),200)
        self.server.host_control.action.assert_called_once_with('start')


class LifecycleTest(unittest.TestCase):
    def test_dashboard_action_waits_for_same_cross_process_lock_as_launcher(self):
        import host_control
        with TemporaryDirectory() as directory:
            state=Path(directory)
            with patch.object(host_control,'STATE',state), patch.object(host_control,'QR',state/'qr.png'):
                control=host_control.HostControl({})
                # Separate interpreter holds the lock, as the Finder stopper would.
                holder=subprocess.Popen([sys.executable,'-c',
                    "import fcntl,sys,time;f=open(sys.argv[1],'a');fcntl.flock(f,fcntl.LOCK_EX);print('locked',flush=True);time.sleep(.4)",str(state/'start.lock')],stdout=subprocess.PIPE,text=True)
                self.assertEqual(holder.stdout.readline().strip(),'locked')
                start=time.monotonic()
                with patch.object(host_control.runtime,'sharing',return_value=None): control.action('stop')
                self.assertGreater(time.monotonic()-start,.25)
                holder.wait(timeout=2);holder.stdout.close()
