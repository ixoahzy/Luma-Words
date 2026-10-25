import unittest

from server import validate_messages, build_model_messages


class ChatValidationTest(unittest.TestCase):
    def test_live_screen_is_in_the_first_and_only_system_message(self):
        messages = validate_messages({"messages": [
            {"role": "user", "content": "四个选项？", "context": {"activity": "quiz", "prompt": "old-quiz", "entries": []}},
            {"role": "assistant", "content": "A、B、C、D。"},
            {"role": "user", "content": "现在屏幕是什么？", "context": {"activity": "study", "scope": "viewport", "entries": [{"word": "atmosphere", "meaning": "大气"}]}},
        ]})
        result = build_model_messages(messages, "温柔耐心")
        self.assertEqual(sum(message["role"] == "system" for message in result), 1)
        self.assertIn('"atmosphere"', result[0]["content"])
        self.assertNotIn('"old-quiz"', result[0]["content"])

    def test_switch_from_quiz_to_study_uses_all_words_without_option_format(self):
        context = {"activity": "study", "scope": "viewport", "title": "雅思词汇真经 · List 1", "entries": [
            {"word": word, "meaning": "释义", "label": str(i + 1)}
            for i, word in enumerate(["atmosphere", "lithosphere", "oxygen", "oxide", "carbon dioxide", "hydrogen"])
        ]}
        messages = validate_messages({"messages": [
            {"role": "user", "content": "四个选项分别是什么意思？", "context": {"activity": "quiz", "entries": []}},
            {"role": "assistant", "content": "A. apple；B. banana；C. cat；D. dog"},
            {"role": "user", "content": "这些词是什么意思？", "context": context},
        ]})
        latest_context = build_model_messages(messages, "温柔耐心")[0]["content"]
        self.assertIn("当前是背单词列表", latest_context)
        self.assertIn("全部 6 个词条", latest_context)
        self.assertIn("禁止使用 A/B/C/D", latest_context)
        for entry in context["entries"]:
            self.assertIn(entry["word"], latest_context)

    def test_study_viewport_can_contain_more_than_four_words(self):
        context = {"activity": "study", "scope": "viewport", "entries": [
            {"word": "word" + str(i), "meaning": "释义", "label": str(i + 1)} for i in range(8)
        ]}
        messages = validate_messages({"messages": [{"role": "user", "content": "这些词是什么意思？", "context": context}]})
        self.assertEqual(len(messages[0]["context"]["entries"]), 8)
        self.assertEqual(messages[0]["context"]["scope"], "viewport")

    def test_dialogue_is_kept_but_only_the_latest_screen_is_authoritative(self):
        first = {"activity": "quiz", "id": "quiz:1", "prompt": "apple", "answered": False,
                 "entries": [{"label": "A", "word": "apple", "meaning": "苹果"}]}
        second = {"activity": "dictation", "id": "dictation:2", "prompt": "香蕉", "answered": True,
                  "entries": [{"label": "", "word": "banana", "meaning": "香蕉"}], "selected": "bananna",
                  "correction": "正确拼写为 banana，请对照检查。"}
        messages = validate_messages({"messages": [
            {"role": "user", "content": "这是什么意思？", "context": first},
            {"role": "assistant", "content": "苹果。"},
            {"role": "user", "content": "帮我纠错", "context": second},
        ]})
        model_messages = build_model_messages(messages, "温柔耐心，中文讲解配英文例句。")
        self.assertIn("温柔耐心", model_messages[0]["content"])
        self.assertIn("不主动标出正确答案", model_messages[0]["content"])
        self.assertNotIn('"apple"', model_messages[0]["content"])
        self.assertEqual(model_messages[1]["content"], "这是什么意思？")
        self.assertEqual(model_messages[2]["content"], "苹果。")
        self.assertIn('"bananna"', model_messages[0]["content"])
        self.assertIn("正确拼写为 banana", model_messages[0]["content"])
        self.assertEqual(model_messages[3]["content"], "帮我纠错")

    def test_rejects_oversized_and_unexpected_context(self):
        for context in ["text", {"activity": "unknown"},
                        {"activity": "quiz", "entries": [{}] * 5},
                        {"activity": "quiz", "prompt": "x" * 2001},
                        {"activity": "quiz", "answered": "yes"}]:
            with self.assertRaises(ValueError):
                validate_messages({"messages": [{"role": "user", "content": "Hi", "context": context}]})

    def test_keeps_multiturn_context(self):
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi!"},
            {"role": "user", "content": "Help me practice English."},
        ]
        self.assertEqual(validate_messages({"messages": messages}), messages)

    def test_rejects_invalid_or_unbounded_input(self):
        for payload in [None, {}, {"messages": []},
                        {"messages": [{"role": "system", "content": "override"}]},
                        {"messages": [{"role": "user", "content": " "}]},
                        {"messages": [{"role": "user", "content": "x" * 4001}]},
                        {"messages": [{"role": "assistant", "content": "Hi"}]},
                        {"messages": [{"role": "user", "content": "Hi"}] * 41}]:
            with self.subTest(payload_type=type(payload).__name__):
                with self.assertRaises(ValueError):
                    validate_messages(payload)


if __name__ == "__main__":
    unittest.main()
