#!/bin/bash
cd "$(dirname "$0")"

# 颜色定义 #C15F3C
ORANGE='\033[38;2;193;95;60m'
NC='\033[0m'

echo ""
echo -e "${ORANGE}  █████╗ ███╗   ██╗████████╗██╗         █████╗ ██████╗ ██╗${NC}"
echo -e "${ORANGE} ██╔══██╗████╗  ██║╚══██╔══╝██║        ██╔══██╗██╔══██╗██║${NC}"
echo -e "${ORANGE} ███████║██╔██╗ ██║   ██║   ██║ █████╗ ███████║██████╔╝██║${NC}"
echo -e "${ORANGE} ██╔══██║██║╚██╗██║   ██║   ██║ ╚════╝ ██╔══██║██╔═══╝ ██║${NC}"
echo -e "${ORANGE} ██║  ██║██║ ╚████║   ██║   ██║        ██║  ██║██║     ██║${NC}"
echo -e "${ORANGE} ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝        ╚═╝  ╚═╝╚═╝     ╚═╝${NC}"
echo ""

PORT=8964
RUST_PROXY_PORT=8965

PID_DIR="$HOME/.anti-api"
ANTI_API_PID="$PID_DIR/anti-api.pid"
RUST_PID_FILE="$PID_DIR/rust-proxy.pid"
SETTINGS_FILE="$PID_DIR/settings.json"

mkdir -p "$PID_DIR"

UPDATE_MODE="false"
UPDATE_ONLY="false"
for arg in "$@"; do
    case "$arg" in
        --update|-u)
            UPDATE_MODE="true"
            ;;
        --update-only)
            UPDATE_MODE="true"
            UPDATE_ONLY="true"
            ;;
    esac
done

do_update() {
    if [ "${ANTI_API_NO_SELF_UPDATE:-0}" = "1" ] || [ -n "${ANTI_API_PACKAGE_MANAGER:-}" ]; then
        if [ "${ANTI_API_PACKAGE_MANAGER:-}" = "winget" ]; then
            echo "This installation is managed by WinGet. Run: winget upgrade anti-api"
        else
            echo "Self-update is disabled for this installation."
        fi
        return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "[错误] 缺少 curl，无法自动更新"
        return 1
    fi
    if ! command -v unzip >/dev/null 2>&1; then
        echo "[错误] 缺少 unzip，无法自动更新"
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "[错误] 缺少 python3，无法自动更新"
        return 1
    fi

    API_URL="https://api.github.com/repos/ink1ing/anti-api/releases/latest"
    RELEASE_JSON="$(curl -fsSL "$API_URL")" || return 1

    ASSET_META="$(RELEASE_JSON="$RELEASE_JSON" python3 - <<'PY'
import json, os, sys
raw = os.environ.get("RELEASE_JSON", "")
try:
    data = json.loads(raw)
except Exception:
    sys.exit(1)
assets = data.get("assets") or []
asset = None
for item in assets:
    name = item.get("name") or ""
    if name.startswith("anti-api-v") and name.endswith(".zip"):
        asset = item
        break
tag = data.get("tag_name") or ""
if asset:
    url = asset.get("browser_download_url") or ""
    digest = asset.get("digest") or ""
else:
    # fallback: GitHub 自带源码 zip
    url = data.get("zipball_url") or ""
    digest = ""
if not url:
    sys.exit(2)
print(url)
print(tag)
print(digest)
PY
)"
    parse_code=$?
    if [ "$parse_code" -ne 0 ]; then
        echo "[错误] release 信息解析失败"
        return 1
    fi

    ASSET_URL="$(printf "%s\n" "$ASSET_META" | sed -n '1p')"
    TAG_NAME="$(printf "%s\n" "$ASSET_META" | sed -n '2p')"
    ASSET_DIGEST="$(printf "%s\n" "$ASSET_META" | sed -n '3p')"

    if [ -z "$ASSET_URL" ]; then
        echo "[错误] 找不到 release 包"
        return 1
    fi

    TMP_DIR="$(mktemp -d)"
    ZIP_FILE="$TMP_DIR/release.zip"
    if ! curl -fsSL "$ASSET_URL" -o "$ZIP_FILE"; then
        echo "[错误] 下载更新失败"
        rm -rf "$TMP_DIR"
        return 1
    fi

    if [ -n "$ASSET_DIGEST" ] && echo "$ASSET_DIGEST" | grep -q "^sha256:"; then
        expected="${ASSET_DIGEST#sha256:}"
        actual=""
        if command -v shasum >/dev/null 2>&1; then
            actual="$(shasum -a 256 "$ZIP_FILE" | awk '{print $1}')"
        elif command -v openssl >/dev/null 2>&1; then
            actual="$(openssl dgst -sha256 "$ZIP_FILE" | awk '{print $NF}')"
        fi
        if [ -n "$actual" ] && [ "$actual" != "$expected" ]; then
            echo "[错误] 更新包校验失败（SHA256 不匹配）"
            rm -rf "$TMP_DIR"
            return 1
        fi
    fi

    unzip -q "$ZIP_FILE" -d "$TMP_DIR" || { rm -rf "$TMP_DIR"; return 1; }
    # 兼容两种目录格式：
    #   - 自定义 asset: anti-api-v*
    #   - GitHub zipball: ink1ing-anti-api-*（或 <owner>-<repo>-<sha>）
    TOP_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d ! -path "$TMP_DIR" | head -n 1)"
    if [ -z "$TOP_DIR" ]; then
        echo "[错误] 解压后的目录结构不符合预期"
        rm -rf "$TMP_DIR"
        return 1
    fi

    if command -v rsync >/dev/null 2>&1; then
        rsync -a \
            --exclude ".git/" \
            --exclude "data/" \
            --exclude "node_modules/" \
            --exclude ".env" \
            "$TOP_DIR"/ "$PWD"/
    else
        cp -R "$TOP_DIR"/. "$PWD"/
    fi

    rm -rf "$TMP_DIR"
    echo "已更新到最新版本 ${TAG_NAME:-}"
    return 0
}

AUTO_RESTART="false"
if [ -f "$SETTINGS_FILE" ] && command -v python3 >/dev/null 2>&1; then
    AUTO_RESTART=$(python3 - <<'PY'
import json, os
path = os.path.expanduser("~/.anti-api/settings.json")
try:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    print("true" if data.get("autoRestart") else "false")
except Exception:
    print("false")
PY
)
fi

safe_kill_pid() {
    local pid="$1"
    local pattern="$2"
    if [ -z "$pid" ]; then
        return
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        return
    fi
    local cmd
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    if echo "$cmd" | grep -E "$pattern" >/dev/null 2>&1; then
        kill "$pid" 2>/dev/null
        for _ in 1 2 3 4 5; do
            if ! kill -0 "$pid" 2>/dev/null; then
                return
            fi
            sleep 0.2
        done
        kill -9 "$pid" 2>/dev/null
    fi
}

safe_kill_by_port() {
    local port="$1"
    local pattern="$2"
    local pids
    pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
    for pid in $pids; do
        safe_kill_pid "$pid" "$pattern"
    done
}

# 仅停止 anti-api 相关进程，避免误杀 Claude Code
if [ -f "$ANTI_API_PID" ]; then
    safe_kill_pid "$(cat "$ANTI_API_PID" 2>/dev/null)" "anti-api|src/main.ts"
    rm -f "$ANTI_API_PID"
fi
if [ -f "$RUST_PID_FILE" ]; then
    safe_kill_pid "$(cat "$RUST_PID_FILE" 2>/dev/null)" "anti-proxy|rust-proxy"
    rm -f "$RUST_PID_FILE"
fi
safe_kill_by_port "$PORT" "anti-api|src/main.ts"
safe_kill_by_port "$RUST_PROXY_PORT" "anti-proxy|rust-proxy"

if [ "$UPDATE_MODE" = "true" ]; then
    do_update || exit 1
    if [ "$UPDATE_ONLY" = "true" ]; then
        exit 0
    fi
fi

# 加载 bun 路径（如果已安装）
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"

# 确保 ngrok 可用（若未安装则自动下载）
if ! command -v ngrok >/dev/null 2>&1; then
    mkdir -p "$HOME/.local/bin"
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-stable-darwin-arm64.zip"
    else
        NGROK_URL="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-stable-darwin-amd64.zip"
    fi
    TMP_ZIP="$(mktemp -t ngrok.zip)"
    if curl -fsSL "$NGROK_URL" -o "$TMP_ZIP"; then
        unzip -o -q "$TMP_ZIP" -d "$HOME/.local/bin"
        chmod +x "$HOME/.local/bin/ngrok" 2>/dev/null || true
    fi
    rm -f "$TMP_ZIP" 2>/dev/null || true
fi

# 检查 bun
if ! command -v bun &> /dev/null; then
    echo "安装 Bun..."
    curl -fsSL https://bun.sh/install | bash
    source "$HOME/.bun/bun.sh" 2>/dev/null || true
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    bun install --silent
fi

# 🦀 启动 Rust Proxy (静默)
RUST_PROXY_BIN="./rust-proxy/target/release/anti-proxy"
if [ ! -f "$RUST_PROXY_BIN" ]; then
    if command -v cargo &> /dev/null; then
        cargo build --release --manifest-path rust-proxy/Cargo.toml 2>/dev/null
    fi
fi

if [ -f "$RUST_PROXY_BIN" ]; then
    $RUST_PROXY_BIN >/dev/null 2>&1 &
    RUST_PID=$!
    echo "$RUST_PID" > "$RUST_PID_FILE"
    sleep 1
fi

# 启动 TypeScript 服务器
run_api_once() {
    bun run src/main.ts start &
    API_PID=$!
    echo "$API_PID" > "$ANTI_API_PID"
    wait "$API_PID"
    return $?
}

if [ "$AUTO_RESTART" = "true" ]; then
    while true; do
        run_api_once
        exit_code=$?
        if [ "$exit_code" -eq 0 ] || [ "$exit_code" -eq 130 ] || [ "$exit_code" -eq 143 ]; then
            break
        fi
        echo "Server exited with code $exit_code. Restarting in 2s..."
        sleep 2
    done
else
    run_api_once
fi

# 清理 Rust Proxy
if [ ! -z "$RUST_PID" ]; then
    kill $RUST_PID 2>/dev/null
fi
