# dsh-autostart-manager

DeepSeek Harness Windows 桌面客户端的自启设置与托盘助手，v0.2.0。

## 使用

设置 → 开机自启：

- 开机自启：登录 Windows 后自动启动客户端。
- 自启时显示主窗口：关闭后启动窗口会收起到托盘；窗口可能短暂出现。
- 高级设置：更改客户端程序位置。

双击托盘图标或选择「打开 DeepSeek Harness」恢复窗口。「退出 DeepSeek Harness」向客户端发送正常关闭请求；客户端可能显示退出确认。「退出托盘」只退出助手，并恢复它曾隐藏的窗口。

手动打开的客户端不会被助手自动隐藏。系统任务管理器中禁用的启动项不会在插件加载或手动验收时被重新开启；只有用户在设置页主动打开开关时才恢复自启。

## 下载与安装

在本仓库 Releases 下载 `dsh-autostart-manager-0.2.0.tgz`。这是 DSH 插件包，无需运行任何 EXE 安装器。

在 DSH 中把下载文件的完整路径告诉插件管理助手，例如：

> 请使用插件管理器安装这个本地插件包：C:\\Downloads\\dsh-autostart-manager-0.2.0.tgz

安装目标使用本地 `file:` 包引用。安装完成后重启客户端，在「设置 → 开机自启」中配置。当前仅适用于 Windows 桌面客户端，不适用于只有 Web 服务的远端机器。

也可下载源码，使用本地 `link:` 方式安装；包内为 JavaScript 与系统脚本，无第三方运行时依赖，无需编译。

首次公开发布为测试版。已验证静默/展示启动与宿主状态处理；尚未在不同电脑上完成真实登录自启验收，不能保证完全无闪窗。

## 实现与限制

Windows 用户级 HKCU Run → wscript 无控制台引导 → PowerShell STA 托盘助手。托盘就绪后才隐藏本次由助手启动的客户端。按完整程序路径识别进程，互斥锁防止相同客户端重复创建助手。检测窗口最长 60 秒，超时保留窗口。

这是外部窗口管理方案，无法保证零闪窗，也不拦截用户以后手动关闭窗口的行为。客户端已在运行时只附加托盘，保留窗口状态。助手正常退出时恢复自己隐藏的窗口；被系统强制终止时无法执行恢复逻辑。macOS 尚未实现。

配置与资产在 `%DSH_HOME%\autostart\`（默认 `~\.dsh\autostart\`）。`startup.log` 记录启动结果，超过 256 KiB 轮转保留一份历史。日志只记录进程号、模式与错误，不含会话内容。

Run 项名为 `DeepSeekHarnessSilentStart`。读取当前用户 Explorer StartupApproved Run/Run32 状态；不改动其他应用条目。

卸载前先在设置页关闭开机自启，再退出托盘；卸载插件本身不会自动删除独立启动资产。确认不再使用后可删除 autostart 数据目录。

## 开发

本包直接提供 `index.js` 和 `client.js`，客户端代码为无转译 JavaScript，无单独构建产物。通过 link 安装时，宿主代码更新需重新加载插件或重启客户端；设置页面需刷新后确认。无需启动其他 Web 服务。

API：`/api/dsh-autostart-manager`，POST JSON `{ endpoint, payload }`。支持 `state`、`enable {mode?}`、`disable`、`setmode {mode}`、`set-exe {exe}`、`launch-now`。当前仅支持 Windows。
