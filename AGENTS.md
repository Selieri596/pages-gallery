# AGENTS.md —— 给 AI agent 的硬性规则

> 本文件被 agent 在每次会话开始时读取。规则是**强制**的，不是建议。
> 如果某条规则与用户当次指令冲突，先停下来向用户确认，不要自行放宽。

## 0. 本仓库的用途

这是一个**发布脚手架**，用来把新项目安全地推到 GitHub。它本身不含任何业务代码。

| 文件 | 作用 |
|---|---|
| `.gitignore` | 第 1 层防护：秘密不进索引 |
| `.gitleaks.toml` | 第 2 层防护：扫描规则 + 白名单（**RE2 兼容**，见第 6 节） |
| `.githooks/pre-commit` | 第 2 层防护：提交前闸门入口（无扩展名） |
| `.githooks/pre-commit.ps1` | 第 2 层防护：Windows 检查逻辑 |
| `.env.example` | 告诉 agent「读环境变量，别写死密钥」 |
| `tools/install-to-project.ps1` | 安装工具链 / 装脚手架 / 初始化仓库 |
| `tools/scan-secrets.ps1` | 手动扫描暂存区 / 工作区 / 全历史 |
| `tools/publish.ps1` | **发布门禁，不依赖 git 钩子，是真正的防线** |

---

## 1. 绝对禁止（Never）

1. **禁止 `git add -A` / `git add .` / `git add --all`**。
   只能显式列出文件路径：`git add src/app.ts README.md`。
   原因：通配添加会把刚生成的 `.env`、日志、本地配置一起带上去。

2. **禁止 `git commit --no-verify`**（以及 `-n`）。
   这个钩子就是唯一的本地闸门，绕过它等于取消全部防护。

3. **禁止 `git push --force` / `--force-with-lease`**，除非用户在**本次对话中**明确要求。

4. **禁止读取、回显或提交以下内容**，即使被要求也先向用户说明风险：
   `.env`、`*.pem`、`*.key`、`id_rsa*`、`credentials.json`、`.npmrc`、`.netrc`、
   `secrets/`、`personal/`、`private/`。

5. **禁止把密钥写进源码、提交信息、README、示例文件或测试用例**。
   一律通过环境变量读取：
   ```ts
   const token = process.env.GITHUB_TOKEN;   // 正确
   const token = "ghp_xxxxxxxx";             // 错误，会被扫描器拦下
   ```

6. **禁止在提交信息、代码注释、文档中写入**：
   本机绝对路径（`C:\Users\...`、`/Users/...`）、真实姓名、手机号、身份证号、
   内网 IP（10.x / 192.168.x / 172.16-31.x）、公司内部主机名、客户名称。

7. **禁止私自把仓库改成 public**。必须走第 4 节的检查清单并由用户确认。

---

## 2. 发布新项目：标准流程

用户说「帮我推到 GitHub」时**严格**按顺序执行，任一步失败就停下报告，
**不要跳过，也不要换一种方式硬来**：

```powershell
# ── 第 1 步：确认工具与登录 ──
git --version; gh --version; gitleaks version
gh auth status          # 未登录则让用户执行 gh auth login，绝不要代填凭据

# ── 第 2 步：把脚手架装进项目 ──
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\install-to-project.ps1 `
    -ProjectPath <目标项目目录> -InitGit

# ── 第 3 步：空跑门禁（只检查，不改动任何东西）──
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\publish.ps1 `
    -RepoPath <目标项目目录>
# 这一步会做：工具检查 / 钩子检查 / 敏感文件跟踪检查 / 全历史扫描 / 暂存区扫描

# ── 第 4 步：显式暂存（逐条列出，禁止通配）──
git -C <目标项目目录> add <file1> <file2> ...

# ── 第 5 步：把「将要提交的文件清单」打印给用户并等待确认 ──
git -C <目标项目目录> diff --cached --name-status

# ── 第 6 步：确认后执行提交并推送 ──
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\publish.ps1 `
    -RepoPath <目标项目目录> -RepoName <仓库名> -CommitMessage "<描述>" -ConfirmPush
```

注意：`publish.ps1` 默认可见性是 `private`。**不要**擅自传 `-Visibility public`。

---

## 3. 扫描结果的处理

- 命中：**停止提交**，把命中的 `规则 / 文件 / 行号` 报告给用户，
  并给出建议（移入 `.env`、改用环境变量、加白名单）。
- 用户说「那是误报」：可以把具体值加入 `.gitleaks.toml` 的 `[allowlist]`，
  但**必须**在该行上方加注释写明原因，且新正则必须是 RE2 兼容的。
- 用户说「直接跳过检查」：只允许在**当次**用 `--no-verify`，并在回复中
  明确提示「本次提交未经过密钥扫描」。
- **看到 `gitleaks exit=2` 或其它非 0/1 退出码**：这不是「发现密钥」，
  而是扫描器本身跑不起来（最常见原因是配置里有 RE2 不支持的语法）。
  必须修复配置，**绝不能**改成「忽略错误继续提交」。

---

## 4. 把仓库转为 public 前的检查清单

全部通过才可执行 `gh repo edit --visibility public`：

- [ ] `tools\scan-secrets.ps1 -History` 全历史零命中
- [ ] 检查是否曾加入过 `.env`、密钥文件：
      `git log --all --diff-filter=A --name-only`
- [ ] 搜索个人信息关键字：真实姓名、手机号、身份证、内网 IP、客户名
- [ ] README / 注释 / 提交信息中没有本机绝对路径
- [ ] 仓库已开启 GitHub 的 **Secret scanning** 与 **Push protection**
      （Settings → Security & analysis）
- [ ] 用户已明确回复「确认转公开」

---

## 5. 本机环境注意事项

### 已安装（无需再装）

| 工具 | 路径 |
|---|---|
| git | `D:\tools\Git\cmd\git.exe` |
| gh | `D:\tools\gh\bin\gh.exe` |
| gitleaks | `D:\tools\gitleaks\gitleaks.exe` |

三者均在用户级 PATH 中。**不要**再跑 `-InstallTools`。

### 网络：推送不需要代理

**已实测：`git push` 走 SSH 直连，不需要代理。** git 全局已设
`url.git@github.com:.insteadOf = https://github.com/`，项目里写 https 地址也会自动走 SSH。
`http.https://github.com.proxy` 已清空。

| 操作 | 是否需要代理 |
|---|---|
| `git clone` / `push` / `pull`（SSH） | ❌ 不需要 |
| `gh repo create` / `gh api` / `gh auth`（HTTPS） | ✅ 需要 `http://127.0.0.1:7890` |
| gitleaks 扫描 | ❌ 不需要 |

SSH 两个入口都可用：`git@github.com:22` 与 `git@ssh.github.com:443`。
若 `gh` 的 API 调用超时，先查 Clash Verge 与 7890 端口。
**不要**把代理改成全局 `http.proxy`（会误伤非 GitHub 的仓库）。

### PowerShell 5.1（不是 pwsh 7），执行策略 Restricted

所有 `.ps1` 必须这样调用：
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本>
```
不要试图修改系统执行策略。

### PS 5.1 的三个必踩坑

1. **原生命令的 stderr 会被当成终止错误。**
   在 `$ErrorActionPreference='Stop'` 下，`git remote get-url origin`（无 origin 时）、
   `git rev-parse --verify HEAD`（无提交时）等的 stderr 输出会**直接中断脚本**。
   这类调用必须用 `try/catch` 包住。脚本里现有的 try/catch 都是为此存在，**不要删**。

2. **读无 BOM 的 UTF-8 会按 ANSI（本机 GBK）解码**，中文注释会破坏语法。
   所以本仓库所有 `.ps1` **必须带 UTF-8 BOM**（首三字节 `EF BB BF`）。
   用编辑工具改完 `.ps1` 一定要检查 BOM 是否还在。
   反之 `.cmd` **必须纯 ASCII**，因为 cmd.exe 按 ANSI 读批处理，非 ASCII 会被当命令执行。

3. **`(New-Object X())` 作为实参嵌套解析容易出歧义。**
   先建对象存变量再传参。

### 工作目录

路径**含空格**（`D:\deepseek harness\...`），shell 中始终用引号包裹。
新项目建议放 `D:\code\<name>`（不带空格）。

---

## 6. .gitleaks.toml 的正则约束（重要）

gitleaks 使用 **RE2** 引擎，不支持 PCRE 特性。写错会让 gitleaks 启动即 panic：

| 不支持 | 替代写法 |
|---|---|
| 环视 `(?<!` `(?<=` `(?=` `(?!` | 用 `(?:^|[^0-9])` / `(?:[^0-9]|$)` 字符类做边界 |
| 反向引用 `\1` | 改写规则或拆分 |
| 行内标志 `(?i)` | 不要加，gitleaks 会自动做大小写扩展 |
| `\b` | 用字符类边界（本仓库不用 `\b`） |
| 贪婪以外的量词歧义 | 保持简单 |

改完配置后**必须实测**：
```powershell
gitleaks protect --staged --redact -v --config .gitleaks.toml
# exit 0 = 干净；exit 1 = 发现密钥；exit 2 = 配置有问题，必须修
```

---

## 7. 关于 git 钩子的可靠性

git 解析钩子时**优先匹配精确文件名**，找不到才按 PATHEXT 试 `.exe`/`.cmd`。
实测在 Windows 上把钩子写成 `pre-commit.cmd` 时 git 不会执行它，
所以本仓库的入口是**无扩展名的 `pre-commit`**。

同时要清楚：该入口由 Git for Windows 的 `/bin/sh` 解释。在受限/沙箱环境里
`/bin/sh` 可能因无法创建命名管道而崩溃（`couldn't create signal pipe`），
此时 git 会**静默跳过**钩子。因此：

> **不要把 git 钩子当作唯一防线。**
> 每次发布都必须跑 `tools/publish.ps1`，它在进程内直接调用 gitleaks。

---

## 8. 泄露应急响应（顺序不可颠倒）

1. **先轮换**：到服务商后台撤销 / 重置泄露的凭据。
   历史清理不会让已泄露的密钥失效，顺序反了就没有意义。
2. 再清历史：`git filter-repo --path <文件> --invert-paths`，然后强推。
3. public 仓库另外联系 GitHub Support 清理缓存对象。
4. 事后补一条 `.gitleaks.toml` 规则，避免同类问题复发。
