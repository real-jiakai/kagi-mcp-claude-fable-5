# kagi-mcp

[English](README.md) | **简体中文**

为 [Kagi 搜索](https://kagi.com) 打造的 MCP 服务器，使用你的**会话令牌（session token）**认证 ——
无需单独订阅 API，直接通过 Kagi 的轻量 HTML 接口（`kagi.com/html/search`）使用你现有的 Kagi 套餐。

## 工具

| 工具 | 用途 | 参数 |
|---|---|---|
| `kagi_search` | 网页搜索 | `query`（必填）、`page`、`from_date`、`to_date`、`region`、`lens`、`limit` |
| `kagi_news` | 新闻搜索 | `query`（必填）、`limit` |
| `kagi_lenses` | 列出可用的 Lens | — |

- `region`：两位国家代码（`us`、`cn`、`jp` 等），对应 Kagi 的 `r=` 参数。
  默认为 `no_region`（国际化 / 地域中立），由 AI 智能体在需要特定地区视角时自行填写。
- `lens`：按**名称或数字 ID** 指定 Kagi Lens（如 `Forums`、`Fediverse Forums`、
  `Academic`、`Programming`、`PDFs`）。名称会根据你账户中的 Lens 列表实时解析
  （按服务进程缓存 —— 新建 Lens 后请重启服务）。

查询支持 Kagi 搜索运算符：`"精确短语"`、`site:example.com`、`-排除词`、`OR`。
输出为紧凑的纯文本（标题、URL、日期、摘要、相关搜索）。默认单次调用返回
**完整第一页结果** —— 与用户在 kagi.com 上看到的一致（通常 20-40 条）；可传 `limit`
进行裁剪。摘要为 Kagi 自身的搜索结果摘要；抓取完整网页内容请交给智能体的网页
抓取工具完成。

## 1. 获取会话令牌

1. 打开 [kagi.com/settings/user_details](https://kagi.com/settings/user_details)
2. 找到 **Session Link**（会话链接）区域并复制链接。
3. 完整链接（`https://kagi.com/search?token=...`）或其中的令牌部分均可作为
   `KAGI_SESSION_TOKEN` 使用。

> **请像对待密码一样对待会话链接** —— 任何持有它的人都能使用你的 Kagi 账户。
> 如果泄露，请在同一设置页面重新生成（旧链接会立即失效）。

## 2. 安装

需要 [Node.js](https://nodejs.org) 18 及以上版本。

**方式 A —— npx（最快，无需克隆）。** 无需预先安装；你的 MCP 客户端会通过
`npx -y @real-jiakai/kagi-mcp` 直接运行已发布的包（见下方配置）。

**方式 B —— 从源码：**

```bash
git clone https://github.com/real-jiakai/kagi-mcp-claude-fable-5.git kagi-mcp
cd kagi-mcp
npm install
```

## 3. 冒烟测试

macOS / Linux：

```bash
KAGI_SESSION_TOKEN='<令牌或会话链接>' node test.js "capital of japan"   # 网页搜索
KAGI_SESSION_TOKEN='<令牌或会话链接>' node test.js "tokyo" news         # 新闻搜索
```

Windows（PowerShell）：

```powershell
$env:KAGI_SESSION_TOKEN = '<令牌或会话链接>'
node test.js "capital of japan"
```

## 4. 接入客户端

以下示例均使用 npx 形式。若从源码运行，请将 `npx -y @real-jiakai/kagi-mcp`
替换为 `node /path/to/kagi-mcp/src/index.js`（Windows 的 JSON 中需转义反斜杠：
`"C:\\path\\to\\kagi-mcp\\src\\index.js"`）。

### Claude Code

```bash
claude mcp add kagi -s user --env KAGI_SESSION_TOKEN=<令牌> -- npx -y @real-jiakai/kagi-mcp
```

（`-s user` 使该服务器在你的所有项目中可用；省略则仅当前项目可用。）

### Claude Desktop / 任意 MCP 客户端（JSON 配置）

```json
{
  "mcpServers": {
    "kagi": {
      "command": "npx",
      "args": ["-y", "@real-jiakai/kagi-mcp"],
      "env": { "KAGI_SESSION_TOKEN": "<令牌或会话链接>" }
    }
  }
}
```

### OpenClaw

```bash
openclaw mcp add kagi \
  --command npx \
  --arg -y \
  --arg @real-jiakai/kagi-mcp \
  --env KAGI_SESSION_TOKEN=<令牌>
```

可用 `openclaw mcp doctor kagi --probe` 验证。

### Hermes Agent

在 `~/.hermes/config.yaml` 的 `mcp_servers` 下添加：

```yaml
mcp_servers:
  kagi:
    command: "npx"
    args: ["-y", "@real-jiakai/kagi-mcp"]
    env:
      KAGI_SESSION_TOKEN: "<令牌或会话链接>"
```

## 说明

- **认证失败**：令牌无效或过期时，Kagi 会 302 重定向到官网首页；服务器能检测到这
  一情况，并返回清晰的错误信息提示你更新令牌。
- **解析方式**：搜索结果通过 Kagi 自带的机器可读标记提取
  （`._0_SRI`、`a._0_URL`、`._0_TITLE`、`._0_DESC`），这些标记在网页与新闻两个
  垂类中保持一致（2026 年 7 月验证）。如果 Kagi 未来更改页面结构，请更新
  `src/kagi.js` 中的 `parseResultsPage()`。
- 本工具以与浏览器完全相同的方式使用你的 Kagi 账户 —— 智能体的正常搜索量与日常
  使用无异。它不是官方的 [Kagi Search API](https://help.kagi.com/kagi/api/search.html)
  （后者单独计费）。

## 致谢

本项目由 **[Claude Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)**
通过 Claude Code 端到端完成设计、实现与测试 —— 包括对 Kagi HTML 接口的实时分析、
多智能体对抗式代码审查，以及浏览器"人工点击 vs MCP"一致性验证。
