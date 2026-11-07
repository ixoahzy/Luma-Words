# DeskTalk 固定网址与项目恢复

[GitHub 学习页](https://ixoahzy.github.io/Luma-Words/) 随仓库 main 分支发布，可以一直收藏。Mac 离线时仍可用选择题、词库和默写；完整 AI 由你的 Mac 提供。

## 一次性设置固定 AI 网址

1. 在 Mac 安装 Homebrew 的开源命令行版 `brew install tailscale`。项目使用独立节点，不改系统 VPN、DNS 或其他 Tailscale 节点。
2. 双击 **设置固定网址.command**，用浏览器完成 Tailscale 登录。如提示启用 HTTPS 或 Funnel，请在官方页面授权，再按提示继续。
3. 双击 **启动 DeskTalk.command**，到 [主机控制台](http://127.0.0.1:8000/host)。若临时共享正在运行，先停止，再点击「开启共享」。收藏控制台显示的 `https://…ts.net` 固定网址。
4. 访客打开固定网址时使用原有口令，或扫码领取一次临时邀请；扫码邀请仍是 15 分钟、最多 10 个新会话。固定网址本身不会随邀请过期。

Tailscale 节点身份保存在 `.remote-share/funnel/`。保留该节点并使用同一设备名和 tailnet 时，停止再开启共享不会换网址。勿将节点状态复制到不同电脑同时使用。若登录失效，重新运行设置文件授权。

Mac 开机联网、DeskTalk 和 Ollama 正常运行时，完整 AI 才在线。Mac 重启后可再打开启动文件、开启共享，继续使用原网址。Funnel 只连接 8001 访客网关，主机控制台及模型端口保持本机可用。可参阅 [Tailscale 官方说明](https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet)。

## 从 GitHub 恢复

克隆仓库后，按 [README](README.md) 安装运行依赖、下载 Whisper/Qwen 模型，再启动项目。源代码、词库、动画素材、测试、恢复脚本和精选试听已随仓库保存。

口令、登录会话、邀请二维码、节点身份、`.env`、日志、模型缓存及个人学习记录留在本机。换机器时重新授权 Tailscale；如需保留个人学习数据，请使用网站已有的导出功能。首次从临时域名换到固定域名，旧浏览器站点数据不会自动迁移。
