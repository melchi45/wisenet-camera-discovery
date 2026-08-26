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

# Both browsers this extension targets (see repo README's title) read
# native messaging host registrations from their OWN, separate directory —
# registering only Chrome's silently leaves Edge unable to find the host
# ("Access to the specified native messaging host is forbidden"/"not
# found") even though the manifest content itself is identical and
# correct. Install into both.
case "$(uname -s)" in
  Darwin)
    TARGET_DIRS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts
$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    ;;
  *)
    TARGET_DIRS="$HOME/.config/google-chrome/NativeMessagingHosts
$HOME/.config/microsoft-edge/NativeMessagingHosts"
    ;;
esac

echo "$TARGET_DIRS" | while IFS= read -r TARGET_DIR; do
  [ -z "$TARGET_DIR" ] && continue
  mkdir -p "$TARGET_DIR"
  sed -e "s|@HOST_PATH@|$HOST_PATH|" \
      -e "s|@EXTENSION_ID@|$EXT_ID|" \
      "$DIR/$HOST_NAME.json.template" > "$TARGET_DIR/$HOST_NAME.json"
  echo "Installed: $TARGET_DIR/$HOST_NAME.json"
done

echo "Restart Chrome/Edge (fully quit, not just close the window), then click 'Start Discovery' in the extension window."
