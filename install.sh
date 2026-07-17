#!/bin/sh
set -e

REPO="LegoGuy32109/agentic-slack-cli"
BIN_DIR="${SLACK_CLI_BIN:-/usr/local/bin}"
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

# Get latest release URL
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$TARGET"

echo "Downloading $TARGET..."
curl -fsSL "$DOWNLOAD_URL" -o "/tmp/$BIN_NAME"
chmod +x "/tmp/$BIN_NAME"

# Install (may need sudo)
if [ -w "$BIN_DIR" ]; then
  mv "/tmp/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
else
  echo "Installing to $BIN_DIR (sudo required)..."
  sudo mv "/tmp/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
fi

echo "Installed to $BIN_DIR/$BIN_NAME"
echo ""
echo "To authenticate, copy a curl command from Slack DevTools and run:"
echo "  $BIN_NAME auth"
