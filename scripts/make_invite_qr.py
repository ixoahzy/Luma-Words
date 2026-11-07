"""Read the invitation on stdin (not argv/logs), emit only local PNG bytes."""
import sys
import qrcode
from qrcode.image.pure import PyPNGImage
link = sys.stdin.read(1024)
if not link.startswith('https://') or '/join#' not in link: raise SystemExit('Invalid invitation')
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
qr.add_data(link); qr.make(fit=True)
qr.make_image(image_factory=PyPNGImage).save(sys.stdout.buffer)
