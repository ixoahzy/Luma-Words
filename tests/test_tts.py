import unittest
from tts_backend import validate_speech
from voice_backend import VoiceError
from unittest.mock import patch

class SpeechValidationTest(unittest.TestCase):
    def test_backend_and_character_are_allowlisted(self):
        body = {'parts': [{'text': 'Hello', 'lang': 'en-US'}], 'backend': 'qwen', 'speaker': 'Serena'}
        _, options = validate_speech(body)
        self.assertEqual(options['speaker'], 'Serena')
        self.assertEqual(options['backend'], 'qwen')
        for key, value in [('backend', 'https://example.com'), ('speaker', '../other'), ('speaker', None)]:
            with self.assertRaises(VoiceError): validate_speech({**body, key: value})

    def test_qwen_dispatch_preserves_system_backend(self):
        from tts_backend import synthesize_speech
        body = {'parts': [{'text': 'Hello', 'lang': 'en-US'}], 'backend': 'qwen', 'speaker': 'Serena'}
        with patch('qwen_tts_backend.synthesize', return_value=b'RIFF-test') as generate:
            self.assertEqual(synthesize_speech(body), b'RIFF-test')
            self.assertEqual(generate.call_args.args[1]['speaker'], 'Serena')

    def test_qwen_is_single_flight_and_rejects_excessive_text(self):
        import qwen_tts_backend as qwen
        with patch.object(qwen, 'available', return_value=True):
            qwen._slot.acquire()
            try:
                with self.assertRaises(VoiceError) as error:
                    qwen.synthesize([{'text': 'Hello'}], {})
                self.assertEqual(error.exception.status, 429)
            finally: qwen._slot.release()
            with self.assertRaises(VoiceError) as error:
                qwen.synthesize([{'text': 'a' * 1201}], {})
            self.assertEqual(error.exception.status, 413)

    def test_accepts_only_bounded_language_parts_and_safe_settings(self):
        parts, options = validate_speech({'parts': [{'text': 'Hello!', 'lang': 'en-US'}], 'rate': 1, 'pause': 120})
        self.assertEqual(parts[0]['text'], 'Hello!')
        self.assertEqual(options['rate'], 1)
        _, numeric = validate_speech({'parts': parts, 'pause': 120.0})
        self.assertIsInstance(numeric['pause'], int)
        for body in [None, {}, {'parts': []}, {'parts': [{'text': ' ', 'lang': 'en-US'}]},
                     {'parts': [{'text': 'x' * 4001, 'lang': 'en-US'}]},
                     {'parts': [{'text': 'hello', 'lang': 'invalid'}]},
                     {'parts': [{'text': 'hello', 'lang': 'en-US'}], 'rate': 'fast'}]:
            with self.subTest(body_type=type(body).__name__):
                with self.assertRaises(VoiceError): validate_speech(body)
