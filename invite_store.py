"""Cross-process, atomic invitation exchange. Only SHA-256 digests are stored."""
import hashlib
import hmac
from pathlib import Path
import secrets
import sqlite3
import time


class InviteError(ValueError):
    pass


class InviteStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = directory / 'invites.sqlite3'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS invite (id INTEGER PRIMARY KEY CHECK(id=1), digest TEXT, origin TEXT, expires REAL, remaining INTEGER)')
        self.path.chmod(0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def issue(self, origin, now=None):
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO invite VALUES (1,?,?,?,10)',
                       (hashlib.sha256(token.encode()).hexdigest(), origin, (time.time() if now is None else now) + 900))
        return token

    def revoke(self):
        with self.connect() as db: db.execute('DELETE FROM invite')

    def status(self, now=None):
        with self.connect() as db:
            row = db.execute('SELECT origin,expires,remaining,digest FROM invite WHERE id=1').fetchone()
        if not row: return {'valid': False, 'remaining': 0, 'expires': 0}
        return {'origin': row[0], 'expires': row[1], 'remaining': row[2], 'version': row[3][:16],
                'valid': row[1] > (time.time() if now is None else now) and row[2] > 0}

    def redeem(self, token, origin, now=None):
        if not isinstance(token, str) or not 30 <= len(token) <= 100:
            raise InviteError('邀请无效或已撤销，请向主机获取新二维码。')
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT digest,origin,expires,remaining FROM invite WHERE id=1').fetchone()
            if not row or not hmac.compare_digest(row[0], digest) or row[1] != origin:
                raise InviteError('邀请无效或已撤销，请向主机获取新二维码。')
            if row[2] <= (time.time() if now is None else now):
                raise InviteError('二维码已过期，请让主机更新二维码后重新扫码。')
            if row[3] <= 0:
                raise InviteError('此二维码的 10 次邀请已用完，请让主机更新二维码。')
            db.execute('UPDATE invite SET remaining=remaining-1 WHERE id=1')
