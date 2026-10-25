import unittest

from voice_backend import VoiceError, validate_recording


class VoiceInputTest(unittest.TestCase):
    def test_accepts_browser_audio_and_supported_languages(self):
        for language in ("auto", "zh", "en"):
            self.assertEqual(validate_recording(b"audio", "audio/webm", language), language)

    def test_rejects_empty_oversized_or_unexpected_uploads(self):
        for audio, mime, language, status in [
            (b"", "audio/webm", "auto", 400),
            (b"x" * (8 * 1024 * 1024 + 1), "audio/webm", "auto", 413),
            (b"audio", "text/html", "auto", 415),
            (b"audio", "audio/webm", "invalid", 400),
        ]:
            with self.assertRaises(VoiceError) as caught:
                validate_recording(audio, mime, language)
            self.assertEqual(caught.exception.status, status)


if __name__ == "__main__":
    unittest.main()
