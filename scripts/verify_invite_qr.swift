// Local macOS Vision decoder; emits a digest, never the invitation credential.
import Foundation
import Vision
import CryptoKit
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(url: url).perform([request])
guard let payload = request.results?.first?.payloadStringValue else { exit(1) }
print(SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined())
