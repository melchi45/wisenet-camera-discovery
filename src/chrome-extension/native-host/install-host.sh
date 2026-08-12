#!/bin/sh
# Registers the Wisenet UDP native messaging host for Google Chrome
# (current user). Usage: ./install-host.sh <extension-id>
set -e

EXT_ID="$1"
if [ -z "$EXT_ID" ]; then
  echo "Usage: $0 <extension-id>" >&2
  echo "The extension ID is shown on chrome://extensions after loading the extension." >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.wisenet.ipinstaller"
HOST_PATH="$DIR/wisenet-udp-host.js"

if ! command -v node >/dev/null 2>&1; then
  echo "warning: node was not found in PATH; the host needs Node.js to run." >&2
fi

chmod +x "$HOST_PATH"

case "$(uname -s)" in
  Darwin)
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  *)
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
esac

mkdir -p "$TARGET_DIR"
sed -e "s|@HOST_PATH@|$HOST_PATH|" \
    -e "s|@EXTENSION_ID@|$EXT_ID|" \
    "$DIR/$HOST_NAME.json.template" > "$TARGET_DIR/$HOST_NAME.json"

echo "Installed: $TARGET_DIR/$HOST_NAME.json"
echo "Restart Chrome, then click 'Start Discovery' in the extension window."
