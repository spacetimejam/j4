#!/usr/bin/env bash
# Switch "talk to Jawbs" on or off for the Jawbs that runs from this copy of
# the kit:
#   setup/jawbs-speech.sh        download the speech model (once) and switch on
#   setup/jawbs-speech.sh off    switch off; the download is kept
# Called by jawbs-local.sh when the wizard's answer was yes, and safe to run by
# hand at any time, on the shared Jawbs too. Exits non-zero when speech could
# not be switched as asked; the caller decides whether that matters.
# Bash 3.2 compatible.
set -u

SETUP_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_DIR="$(dirname "$SETUP_DIR")"
. "$SETUP_DIR/lib.sh"

ENV_FILE="${JAWBS_ENV_FILE:-$KIT_DIR/portal/.env}"
SPEECH_DIR="${JAWBS_SPEECH_DIR:-$KIT_DIR/portal/data/speech}"
URL_BASE="${JAWBS_SPEECH_URL_BASE:-https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models}"
MODEL_NAME="sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
# Pinned so a changed or tampered download is refused rather than run.
SHA_MODEL="${JAWBS_SPEECH_SHA_MODEL:-5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf}"
SHA_VAD="${JAWBS_SPEECH_SHA_VAD:-9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6}"
NODE_BIN="${JAWBS_NODE:-node}"
MODEL_FILES="encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt"
AGAIN="To try again: $SETUP_DIR/jawbs-speech.sh"
RESTART="If Jawbs is open, quit it and open it again for this to take effect."

if [ ! -f "$ENV_FILE" ]; then
  echo "Jawbs has no settings yet ($ENV_FILE), so set Jawbs up first."
  exit 1
fi

if [ "${1:-on}" = "off" ]; then
  if ! set_env_line "$ENV_FILE" SPEECH_TO_TEXT off; then
    echo "Could not change $ENV_FILE."
    exit 1
  fi
  echo "Talking to Jawbs is switched off. The download was kept, so switching it"
  echo "back on is quick: $SETUP_DIR/jawbs-speech.sh"
  echo "$RESTART"
  exit 0
fi

# The speech program is an optional part of the install, so it can be absent.
# JAWBS_SPEECH_LIB_OK lets the tests answer this without it.
lib_ok() {
  case "${JAWBS_SPEECH_LIB_OK:-}" in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  (cd "$KIT_DIR/portal" && "$NODE_BIN" -e "require('sherpa-onnx-node')") >/dev/null 2>&1
}
if ! lib_ok; then
  echo "Talking to Jawbs is not available on this computer: the speech program"
  echo "did not install. Everything else in Jawbs works as normal."
  exit 1
fi

installed() {
  [ -f "$SPEECH_DIR/silero_vad.onnx" ] || return 1
  for mf in $MODEL_FILES; do
    [ -f "$SPEECH_DIR/parakeet/$mf" ] || return 1
  done
  return 0
}

# fetch <name> <sha256>: download into $WORK and check it is the file expected.
fetch() {
  if ! curl -fL --retry 2 --progress-bar -o "$WORK/$1" "$URL_BASE/$1"; then
    echo "The download did not finish. Check the internet connection."
    return 1
  fi
  if [ "$(sha256_of "$WORK/$1")" != "$2" ]; then
    echo "The download of $1 was not the file expected, so it was thrown away."
    return 1
  fi
  return 0
}

if installed; then
  echo "The speech download is already here."
else
  if ! command -v curl >/dev/null 2>&1; then
    echo "The download needs curl, which is not installed."
    echo "$AGAIN"
    exit 1
  fi
  if ! sha256_of "$ENV_FILE" >/dev/null 2>&1; then
    echo "This computer has neither sha256sum nor shasum, so the download could"
    echo "not be checked and was not started."
    exit 1
  fi
  if ! mkdir -p "$SPEECH_DIR"; then
    echo "Could not create $SPEECH_DIR."
    exit 1
  fi
  # Anything an interrupted earlier run left behind.
  rm -rf "$SPEECH_DIR"/incoming.*
  WORK="$SPEECH_DIR/incoming.$$"
  mkdir -p "$WORK"
  trap 'rm -rf "$WORK"' EXIT
  echo "Downloading the speech model (about 490 MB). This can take a few minutes..."
  if ! fetch "$MODEL_NAME.tar.bz2" "$SHA_MODEL" || ! fetch silero_vad.onnx "$SHA_VAD"; then
    echo "$AGAIN"
    exit 1
  fi
  if ! tar -xjf "$WORK/$MODEL_NAME.tar.bz2" -C "$WORK"; then
    echo "The download could not be unpacked. On Linux this needs bzip2:"
    echo "  sudo apt install -y bzip2"
    echo "$AGAIN"
    exit 1
  fi
  # A folder with files missing is a half-finished install: replace it whole.
  rm -rf "$SPEECH_DIR/parakeet"
  if ! mv "$WORK/$MODEL_NAME" "$SPEECH_DIR/parakeet" || ! mv "$WORK/silero_vad.onnx" "$SPEECH_DIR/silero_vad.onnx" || ! installed; then
    echo "The speech model could not be put in place in $SPEECH_DIR."
    echo "$AGAIN"
    exit 1
  fi
fi

if ! set_env_line "$ENV_FILE" SPEECH_TO_TEXT on; then
  echo "The speech model is in place, but $ENV_FILE could not be changed."
  echo "$AGAIN"
  exit 1
fi
echo "Talking to Jawbs is switched on: each text box now has a microphone button."
echo "$RESTART"
echo "To switch it off: $SETUP_DIR/jawbs-speech.sh off"
exit 0
