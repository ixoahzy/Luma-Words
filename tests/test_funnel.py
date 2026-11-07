import unittest
from funnel_runtime import fixed_origin


class FixedOriginTest(unittest.TestCase):
    def test_uses_same_verified_node_name_after_restart(self):
        status = {'BackendState': 'Running', 'Self': {'DNSName': 'desktalk.example.ts.net.'}}
        self.assertEqual(fixed_origin(status), 'https://desktalk.example.ts.net')

    def test_rejects_unready_or_unsafe_origin(self):
        for state, name in [('NeedsLogin', 'desktalk.example.ts.net.'), ('Running', 'desktalk.example.ts.net.evil.test'), ('Running', 'name@other.ts.net')]:
            with self.assertRaises(RuntimeError): fixed_origin({'BackendState': state, 'Self': {'DNSName': name}})
