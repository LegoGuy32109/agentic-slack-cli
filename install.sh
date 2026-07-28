#!/bin/sh
set -e

REPO="LegoGuy32109/agentic-slack-cli"
BIN_DIR="${SLACK_CLI_BIN:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
BIN_NAME="slack-cli"

# Detect OS and arch
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    case "$ARCH" in
      x86_64) TARGET="slack-cli-linux-x64" ;;
      *) echo "Unsupported arch: $ARCH" && exit 1 ;;
    esac
    ;;
  Darwin)
    case "$ARCH" in
      arm64) TARGET="slack-cli-mac-arm64" ;;
      x86_64) TARGET="slack-cli-mac-x64" ;;
      *) echo "Unsupported arch: $ARCH" && exit 1 ;;
    esac
    ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

# Get latest release URLs
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$TARGET"
SUMS_URL="https://github.com/$REPO/releases/latest/download/SHA256SUMS"
TEMP_BIN="/tmp/$BIN_NAME.$$"
TEMP_SUMS="/tmp/$BIN_NAME-sums.$$"

echo "Downloading $TARGET..."
curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_BIN"
curl -fsSL "$SUMS_URL" -o "$TEMP_SUMS"
EXPECTED="$(awk -v file="$TARGET" '$2 == file || $2 == "*" file { print $1 }' "$TEMP_SUMS")"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TEMP_BIN" | awk '{ print $1 }')"
else
  ACTUAL="$(shasum -a 256 "$TEMP_BIN" | awk '{ print $1 }')"
fi
rm -f "$TEMP_SUMS"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo "Checksum verification failed."; rm -f "$TEMP_BIN"; exit 1; }
chmod +x "$TEMP_BIN"
mkdir -p "$BIN_DIR"

# Install (may need sudo)
if [ -w "$BIN_DIR" ]; then
  mv "$TEMP_BIN" "$BIN_DIR/$BIN_NAME"
else
  echo "Installing to $BIN_DIR (sudo required)..."
  sudo mv "$TEMP_BIN" "$BIN_DIR/$BIN_NAME"
fi

echo "Installed to $BIN_DIR/$BIN_NAME"
echo ""
echo "To authenticate, copy a curl command from Slack DevTools and run:"
echo "  $BIN_NAME auth"
