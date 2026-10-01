#apps/agents 开发启动脚本
#调用本机 Python 运行 uvicorn，加载 novelmuse_agents 模块

$ErrorActionPreference = "Stop"

# ---- 定位 Python 解释器 ----
$python = $env:NOVEL_PYTHON
if (-not $python) {
    $candidates = @(
        "C:\Users\1\AppData\Local\Programs\Python\Python312\python.exe",
        "C:\Python312\python.exe",
        "C:\Python311\python.exe",
        "C:\Python310\python.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $python = $c; break }
    }
}
if (-not $python) {
    # 回退到 PATH
    $python = "python"
}

Write-Host "[agents/dev] 使用 Python: $python" -ForegroundColor Cyan

# ---- 端口 ----
$port = if ($env:AGENTS_PORT) { $env:AGENTS_PORT } else { "3775" }

# ---- app-dir ----
$srcDir = Join-Path $PSScriptRoot "src"

# ---- 启动参数 ----
$noReload = $false
if ($args -contains "-NoReload") { $noReload = $true }

$uvicornArgs = @(
    "-m", "uvicorn",
    "novelmuse_agents.main:app",
    "--host", "127.0.0.1",
    "--port", $port,
    "--app-dir", $srcDir
)
if (-not $noReload) { $uvicornArgs += "--reload" }

Write-Host "[agents/dev] 启动 uvicorn -> http://127.0.0.1:$port" -ForegroundColor Green

& $python @uvicornArgs
