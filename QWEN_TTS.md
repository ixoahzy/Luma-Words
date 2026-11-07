# DeskTalk 本地 Qwen3-TTS

## 启动

```sh
# 在项目目录运行
# 已安装；重建独立环境时才需要运行：
# sh scripts/setup_qwen_tts.sh
python3 server.py
```

打开 http://127.0.0.1:8000/ → lion → 声音设置 → 本地 Qwen3-TTS → Serena → 试听。
角色与后端选择保存在原浏览器语音偏好中；默认 Serena。普通聊天、主动讲解、按键练习和通话共用 `/api/speak`。
系统声音可选服务端 macOS 或当前设备；通话的系统回退使用服务端 macOS，界面明确标注。
`.env` 的 `TTS_BACKEND=qwen` / `system` 设置未保存浏览器偏好时的默认后端。

## 环境与实测

- Apple M5，24 GiB 统一内存，安装前磁盘可用约 764 GiB。
- 官方 [Qwen3-TTS-12Hz-0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice)，未量化、未下载更大模型。
- 独立 `.venv-qwen-tts`：Python 3.12.15、qwen-tts 0.1.1、PyTorch 2.15.0，MPS / bfloat16 / SDPA；依赖锁定见 `requirements-qwen-tts.txt`。
- 权重在 `.tts-models/`，缓存与运行日志在 `.tts-cache/`，均忽略 Git；原 `.venv-voice`、Whisper 与 Ollama 未替换。
- 模型加载 2.19 秒（不含 Python/库导入）；加载后进程 RSS 0.36 GiB，MPS 驱动分配 2.41 GiB。

| 试听 | 音频时长 | 生成耗时 | 进程峰值 RSS | 生成后 MPS 驱动分配 |
|---|---:|---:|---:|---:|
| 中文 | 5.20 s | 8.58 s | 0.55 GiB | 2.49 GiB |
| 英文 | 3.76 s | 3.95 s | 0.56 GiB | 2.49 GiB |
| 中英混合 | 5.84 s | 4.91 s | 0.56 GiB | 2.50 GiB |

文件：`artifacts/qwen-tts/serena-{zh,en,mixed}.wav`；原始结果 `benchmark.json`。
以上为同一模型实例顺序生成；中文包含首次推理初始化开销。RSS 与 MPS 内存口径不同，不能相加当作总占用。
真实网站两轮短回复合成分别约 13.74 秒（含独立进程冷启动）和 5.26 秒；见 `integration.json`。
**目前不能承诺自然电话式低延迟：官方接口整段合成后才返回 WAV，文本更长时等待更久。可使用系统声音降低等待。**
实际听感及真人麦克风准确率仍需人工验收。Whisper 试听转写正常返回，但把 lion 听为 Ryan，不能作为发音评分。

## 运行行为与边界

- 首次语音请求启动独立子进程，之后复用模型；不新增 HTTP 端口，不使用付费 API。
- 单模型单并发，忙碌返回 429；前端最多等待重试 3 次，仍忙则明确报错。
- 停止、换题、录音打断、结束和挂断取消请求并丢弃晚到音频，播放源互斥；本机断连还会通知模型协作停止。
- 共享网关收到浏览器取消时，上游合成可能继续完成，但音频不会重新播放；并发槽在完成后释放。
- 生成最长 90 秒、单次 Qwen 文本 1200 字；超时会停止卡住的 worker，下次请求重新加载。
- Qwen 语速 0.8–1.2×通过已有 ffmpeg 调整，停顿由模型控制；系统声音保留原句间停顿偏好。
- 不自动切换到系统声音掩盖模型错误；可以在设置中明确选择回退。

重新运行独立基准：`.venv-qwen-tts/bin/python scripts/benchmark_qwen_tts.py`。
临时共享：`python3 scripts/share_remote.py`；保留 `.remote-share/access-code.txt` 中原口令，电脑需保持开机联网。

## 本次修改与验证

- `qwen_tts_backend.py`、`scripts/worker_qwen_tts.py`：独立常驻模型、单并发、取消与超时。适配官方 0.1.1 的内部 talker 停止条件转发，未修改安装包源码。
- `tts_backend.py`、`server.py`、`remote_gateway.py`：复用 `/api/speak`，增加受原有访问控制保护的 `/api/voices`，保留 macOS 后端。
- `ai-voice.js`、`ai-call.js`、`ai-speaking.js`：统一合成请求与角色选择、互斥播放、可取消的短暂忙碌重试、通话状态。
- `ai-chat.js`、`ai-chat.css`：后端与音色选择、试听、原有偏好持久化、小窗口设置布局。
- `scripts/setup_qwen_tts.sh`、`requirements-qwen-tts.txt`、`.gitignore`、`.env.example`、`scripts/benchmark_qwen_tts.py`：隔离安装、固定依赖、配置与实测复现。
- `tests/test_tts.py`、`tests/ai-voice.test.mjs`、`tests/ai-call.test.mjs`、`tests/ai-chat-live.test.mjs`：校验、路由、取消、忙碌重试与共享发声路径回归。

验证：前端回归及新增取消/重试检查通过，Python 21 项通过；真实两轮 Whisper / Qwen / TTS 接口、系统回退、网页试听、通话播放、停止和挂断通过。
真实生成取消后，下一段音频 2.41 秒返回、同一 worker 复用、无忙碌重试，记录在 `artifacts/qwen-tts/cancellation.json`。
公网验证保持原口令：未登录 `/api/voices` 返回 401；登录后返回真实 Qwen WAV，见 `public-verification.json`（不包含口令）。
