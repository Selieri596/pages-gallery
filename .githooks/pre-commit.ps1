# ============================================================
#  .githooks/pre-commit.ps1 —— 提交前闸门的真正逻辑
#
#  为什么需要它：
#  Git for Windows 用 MSYS 的 /bin/sh 执行 pre-commit。在受限环境里
#  sh.exe 可能起不来（例如 "couldn't create signal pipe, Win32 error 5"），
#  此时 git 会**静默跳过**钩子且不报错，闸门就失效了。
#  本文件由 pre-commit.cmd 直接调用，不依赖 sh。
#
#  文件分工：
#    pre-commit.cmd  Windows 入口（.PS1 不在 PATHEXT 里，必须有这个包装）
#    pre-commit.ps1  检查逻辑（本文件）
#    pre-commit.sh   macOS / Linux 入口
#
#  绕过方式（不推荐）：git commit --no-verify
# ============================================================

$ErrorActionPreference = 'Continue'

# 兜底：任何未捕获异常都必须以非 0 退出，绝不放行
trap {
    Write-Host ''
    Write-Host ('pre-commit 钩子异常，已阻止提交：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

function Write-Ok([string]$m)    { Write-Host $m -ForegroundColor Green }
function Write-Warn2([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Write-Err([string]$m)   { Write-Host $m -ForegroundColor Red }

# ---------------------------------------------------------- 暂存区为空则放行
$staged = @(git diff --cached --name-only 2>$null)
if ($staged.Count -eq 0) { exit 0 }

# ---------------------------------------------------------- 定位 gitleaks
$gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
if (-not $gitleaks) {
    Write-Warn2 ''
    Write-Warn2 '! 未找到 gitleaks，本次提交未做密钥扫描。'
    Write-Warn2 '  安装： winget install --id Gitleaks.Gitleaks -e'
    Write-Warn2 '  本次提交未经过检查，请自行确认不含凭据。'
    exit 0
}
$glPath = $gitleaks.Source
# 防止钩子递归调用自己
if ($glPath -like '*pre-commit*') {
    Write-Warn2 '! gitleaks 解析到了钩子自身，跳过扫描。'
    exit 0
}

# ---------------------------------------------------------- 扫描暂存内容
$cfgArgs = @()
if (Test-Path -LiteralPath '.gitleaks.toml') { $cfgArgs = @('--config', '.gitleaks.toml') }

Write-Host ''
Write-Host '> 正在扫描暂存内容（gitleaks）...'
& $glPath protect --staged --redact -v @cfgArgs
$code = $LASTEXITCODE

if ($code -eq 0) {
    Write-Ok '  ok 未发现疑似密钥，允许提交'
    exit 0
}

# gitleaks 退出码语义：
#   0 = 干净   1 = 发现泄漏   其它（常见 2）= 执行出错（例如正则不被 RE2 支持）
if ($code -ne 1) {
    Write-Err ''
    Write-Err '──────────────────────────────────────────'
    Write-Err (' 扫描器执行失败（gitleaks exit=' + $code + '），已阻止提交。')
    Write-Err ' 这通常意味着 .gitleaks.toml 里的正则不被 RE2 支持。'
    Write-Err ' 常见原因：使用了环视断言 (?<! (?<= (?= (?! 或 \b'
    Write-Err ''
    Write-Err ' 手动查看具体报错：'
    Write-Err '   gitleaks protect --staged --redact -v --config .gitleaks.toml'
    Write-Err '──────────────────────────────────────────'
    exit 1
}

Write-Err ''
Write-Err '──────────────────────────────────────────'
Write-Err ' 提交已被阻止：暂存内容中检测到疑似密钥 / 隐私信息'
Write-Err ''
Write-Err ' 处理步骤：'
Write-Err '   1) git restore --staged <文件>      取消暂存该文件'
Write-Err '   2) 把真实值移入 .env（已被 .gitignore 忽略），源码改读环境变量'
Write-Err '   3) 若该密钥已进入过任何一次提交：立刻去服务商后台「轮换 / 撤销」'
Write-Err '   4) 确认是误报才用：git commit --no-verify'
Write-Err '──────────────────────────────────────────'
exit 1
