import concurrent.futures
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from invite_store import InviteStore, InviteError


class InviteTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = InviteStore(Path(self.temp.name))

    def test_expiry_rotation_origin_and_no_plaintext(self):
        token = self.store.issue('https://example.test', now=100)
        self.store.redeem(token, 'https://example.test', now=101)
        self.assertEqual(self.store.status(now=101)['remaining'], 9)
        self.assertNotIn(token.encode(), self.store.path.read_bytes())
        with self.assertRaises(InviteError): self.store.redeem(token, 'https://other.test', now=101)
        with self.assertRaises(InviteError): self.store.redeem(token, 'https://example.test', now=1001)
        self.store.issue('https://example.test', now=102)
        with self.assertRaises(InviteError): self.store.redeem(token, 'https://example.test', now=103)

    def test_only_ten_concurrent_redemptions_and_revoke(self):
        token = self.store.issue('https://example.test')
        def redeem(_):
            try: self.store.redeem(token, 'https://example.test'); return True
            except InviteError: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            self.assertEqual(sum(pool.map(redeem, range(20))), 10)
        self.store.revoke()
        with self.assertRaises(InviteError): self.store.redeem(token, 'https://example.test')
