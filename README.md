# Trae 积分悬浮窗（桌面人物版）

Electron 桌面小浮窗：人物原图置顶悬浮，Trae 账户积分实时显示在人物头顶的漫画"思考云朵框"里。

## 功能一览

- 无边框、透明背景、始终置顶、不占任务栏，按住人物可拖动并记住位置
- 人物图片原图原样展示（不缩放、不重绘、不抠图、不滤镜、不裁剪、不变形）
- 云朵框颜色规则：
  - 积分减少：红色 `-XXX 积分`，云朵框抖动，持续 5 秒后恢复蓝色余额
  - 积分不变：蓝色 `当前剩余 X,XXX 积分`
  - 积分增加：绿色 `+XXX 积分`，持续 4 秒后恢复（可在设置中关闭）
  - 获取失败：橙色 `未登录` / `会话失效` / `网络错误`
- 点击人物（位移小于 4px）：`1 → 1.15 → 0.95 → 1` 缩放动画并立即刷新积分
- 右键菜单：立即刷新 / 重新登录 / 设置 / 切换置顶 / 退出
- 设置窗口可调刷新间隔、提示时长，"人物大小"滑块拖动即时生效（悬浮窗同步缩放，无需重启）

## 目录结构

```
trae-points-widget/
├── main.js              # 主进程：窗口、登录态、积分获取与比较
├── preload.js           # 安全 IPC 桥（contextIsolation，无 Node 集成）
├── config.json          # 配置文件（不含任何账号密码）
├── assets/
│   └── character.png    # 人物图片（原图原样副本）
└── renderer/
    ├── index.html       # 悬浮窗页面
    ├── style.css        # 云朵框、动画、颜色规则
    ├── renderer.js      # 显示逻辑 + 点击/拖动区分
    ├── settings.html    # 设置窗口
    └── settings.js
```

## 环境要求

- Windows 10/11
- Node.js 18+（建议 20 LTS）

## 安装依赖

```powershell
cd "d:\VSCode\AI building\trae-points-widget"
npm install
```

国内网络若 Electron 二进制下载慢或失败，先设置镜像再安装：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
```

若安装后运行仍提示 `Electron failed to install correctly`，手动补下二进制：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules\electron\install.js
```

## 运行

```powershell
npm start
```

首次启动会弹出 Trae 登录窗口（自动打开积分页并跳转登录），手动登录即可（账号密码 / 扫码 / 验证码均支持）。登录成功后登录窗口自动关闭，浮窗开始显示积分。

会话（Cookie）由 Chromium 保存在本机用户数据目录，并额外加密备份一份用于跨重启自动恢复，不会上传到任何第三方；下次启动自动复用，无需重复登录。程序不保存任何明文密码。

## 积分获取逻辑（三级回退）

1. **页面显示值优先（最可靠）**：读取 `span[data-testid="user-entitlement-total-balance"]` 的文本，去掉逗号后转为数字。这是积分页实际显示的总积分，优先用 `data-testid`，避免类名哈希后缀随版本变化
2. **内部接口兜底**：若页面改版导致选择器失效，回退到页面内注入的 fetch/XHR 钩子捕获的 `trae` 域名下与积分/权益相关的接口响应，仅解析 `totalBalance` 类"总余额"字段（避免误捕单个模型的额度数据）
3. **关键词兜底**：解析页面中含"积分"关键词的数值文本

> 防误读机制：页面刷新后会先渲染缓存/骨架数字再更新为真实值，程序会连续多次读取，只有数值稳定一致（连续 3 次相同且超过 1.6 秒）才采纳，避免把瞬时错误值当成积分变化。每次读取和变化都会在控制台打印日志（`[points] ...`），便于排查。

> 说明：Electron 主进程的 `webRequest.onCompleted` 无法读取响应 body，因此采用页面内注入钩子的方式实现同等的"监听内部接口"效果。默认每 10 秒刷新一次（可在设置中调整为 5~60 秒）。

## 自动登录说明

- **登录一次，长期免登录**：首次使用弹出登录窗口，手动登录（账号密码 / 扫码 / 验证码均可）。登录成功后，会话 Cookie 会用 Electron safeStorage（Windows DPAPI）加密保存到本地用户数据目录 `session.enc`，此后每次启动自动恢复，无需重复登录；网站会话本身有效期通常长达数周。
- **为什么不能直接复用 TRAE 客户端的登录**：TRAE 桌面客户端的登录凭据经过系统级加密存储并被进程独占锁定，没有可供第三方程序安全读取的公开接口，强行破解既不稳定也不合规。浮窗采用独立的网页登录态，效果等同。
- **会话失效时**：云朵框显示"会话失效"，右键人物 → 重新登录即可，程序不会崩溃。
- Cookie/Session 仅保存在本机并加密，不会上传到任何第三方。

## 打包为 Windows exe

```powershell
npm run dist
```

产物在 `dist/` 目录：

- `TraePointsWidget-Setup-x.y.z.exe`：NSIS 安装包（可选择安装目录）
- `TraePointsWidget x.y.z.exe`：便携版（双击即用，免安装）

打包版的配置文件位置：`%APPDATA%\TraePointsWidget\config.json`（开发模式下为项目根目录的 `config.json`）。

## 配置项说明

| 字段 | 默认值 | 说明 |
|---|---|---|
| `loginUrl` | `https://www.trae.cn/` | Trae 登录页 |
| `pointsUrl` | `https://www.trae.cn/dashboard#usage` | 积分页面 |
| `pointsSelector` | `span[data-testid="user-entitlement-total-balance"]` | 积分元素选择器 |
| `sessionSave` | `electron-session` | 会话保存方式（Chromium 本地加密） |
| `refreshIntervalMs` | `10000` | 自动刷新间隔（毫秒，最小 5000） |
| `decreaseAlertMs` | `5000` | 积分减少红色提示持续时间 |
| `increaseGreenEnabled` | `true` | 是否开启积分增加绿色提示 |
| `increaseAlertMs` | `4000` | 积分增加绿色提示持续时间 |
| `imageScale` | `0.35` | 人物显示缩放，1 = 原始像素（原图 1126×1024）。在设置窗口拖动滑块即时调整，悬浮窗同步缩放 |
| `trimTransparentMargin` | `true` | 自动忽略图片四周透明边距（只影响窗口大小，不改图片像素） |
| `windowPosition` | `null` | 上次窗口位置（自动记录） |

## 安全与合规

- 仅用于自己的 Trae 账户；不绕过验证码、风控或平台权限
- 默认 10 秒刷新、下限 5 秒，避免高频请求给平台造成压力
- 不保存明文密码；Cookie/Session 由 Chromium 在本机加密存储
- 使用前请确认符合 Trae 的服务条款

## 常见问题

- **拖动时窗口越拖越大（已修复）**：Windows 显示缩放为 125% 等非整数倍时，Electron 的 `setPosition` 每次移动都会把窗口尺寸做一次"逻辑像素→物理像素"换算并向上取整后写回缓存，窗口每次移动被撑大 1px（变大的全是透明区域）。实测 500 次移动从 380×504 膨胀到 880×1004。修复方式：拖动改用 `setBounds` 并始终显式携带固定尺寸、位置由程序内部的虚拟坐标维护，绝不从窗口读回尺寸，膨胀不再发生。100% 缩放的显示器不受此 bug 影响。
- **浮窗显示"未登录 / 会话失效"**：右键人物 → 重新登录，登录成功后自动恢复
- **积分一直不变**：若官网改版导致选择器失效，编辑 `config.json` 中的 `pointsSelector`
- **找不到浮窗**：浮窗不显示在任务栏，若被移到屏幕外，删除配置中的 `windowPosition` 后重启
- **想调整人物大小**：修改 `config.json` 中的 `imageScale`（如 `0.6`）
