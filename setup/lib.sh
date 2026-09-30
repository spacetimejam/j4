#!/usr/bin/env bash
# Helper functions for setup.sh. Sourced, not executed.
# Bash 3.2 compatible: no associative arrays, no readarray, no GNU-only flags.

# Escape a value for use on the right-hand side of a sed s/// expression.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[&/\]/\\&/g'
}

# substitute_all <dir>
# Replaces every {{PLACEHOLDER}} token in .md, .tmpl and .yaml files under
# <dir> with the value of the matching shell variable. Uses a temp file per
# file for portability (no sed -i).
# Full token list: USER_NAME, USER_EMAIL, USER_PHONE, USER_LOCATION, FIELD,
# SENIORITY, EMPLOYMENT_STATUS, AI_TOOL, DATE, PORTAL, JAWBS_MODE, CREATIVE,
# WRITER, SPEECH, KIT_DIR.
# KIT_DIR resolves to the kit checkout, so a project can point at shared kit
# files (the email sign-off bank) wherever the project itself was created.
substitute_all() {
  target="$1"
  name_esc="$(sed_escape "$USER_NAME")"
  email_esc="$(sed_escape "$USER_EMAIL")"
  phone_esc="$(sed_escape "$USER_PHONE")"
  location_esc="$(sed_escape "$USER_LOCATION")"
  field_esc="$(sed_escape "$FIELD")"
  seniority_esc="$(sed_escape "$SENIORITY")"
  employment_esc="$(sed_escape "$EMPLOYMENT_STATUS")"
  ai_tool_esc="$(sed_escape "$AI_TOOL")"
  portal_esc="$(sed_escape "$PORTAL")"
  mode_esc="$(sed_escape "${JAWBS_MODE:-}")"
  creative_esc="$(sed_escape "${CREATIVE:-no}")"
  writer_esc="$(sed_escape "${WRITER:-not asked}")"
  speech_esc="$(sed_escape "${SPEECH:-not asked}")"
  date_esc="$(sed_escape "$(date +%Y-%m-%d)")"
  kit_esc="$(sed_escape "${KIT_DIR:-}")"

  find "$target" -type f \( -name '*.md' -o -name '*.tmpl' -o -name '*.yaml' \) |
  while IFS= read -r file; do
    tmp="$file.subst.$$"
    sed -e "s/{{USER_NAME}}/$name_esc/g" \
        -e "s/{{USER_EMAIL}}/$email_esc/g" \
        -e "s/{{USER_PHONE}}/$phone_esc/g" \
        -e "s/{{USER_LOCATION}}/$location_esc/g" \
        -e "s/{{FIELD}}/$field_esc/g" \
        -e "s/{{SENIORITY}}/$seniority_esc/g" \
        -e "s/{{EMPLOYMENT_STATUS}}/$employment_esc/g" \
        -e "s/{{AI_TOOL}}/$ai_tool_esc/g" \
        -e "s/{{PORTAL}}/$portal_esc/g" \
        -e "s/{{JAWBS_MODE}}/$mode_esc/g" \
        -e "s/{{CREATIVE}}/$creative_esc/g" \
        -e "s/{{WRITER}}/$writer_esc/g" \
        -e "s/{{SPEECH}}/$speech_esc/g" \
        -e "s/{{DATE}}/$date_esc/g" \
        -e "s/{{KIT_DIR}}/$kit_esc/g" \
        "$file" > "$tmp" && mv "$tmp" "$file"
  done
}

# suggest_target_dir <kit_dir> <user_name>
# Prints a suggested project path: a subfolder of <kit_dir> named with the
# person's lowercase initials ("Sam Jackson" -> sj). If that folder exists,
# extends with further letters of the last name (sj -> sja -> sjac ...);
# once the last name is exhausted, or for one-word names, appends 2, 3, ...
# Notes any clash-driven change on stderr.
suggest_target_dir() {
  std_kit="$1"
  std_name="$2"
  std_initials="$(printf '%s' "$std_name" | awk '{s=""; for(i=1;i<=NF;i++) s=s substr($i,1,1); print tolower(s)}' | tr -cd 'a-z0-9')"
  [ -z "$std_initials" ] && std_initials="me"
  if [ ! -e "$std_kit/$std_initials" ]; then
    printf '%s' "$std_kit/$std_initials"
    return
  fi
  std_words="$(printf '%s' "$std_name" | awk '{print NF}')"
  if [ "$std_words" -ge 2 ]; then
    std_prefix="$(printf '%s' "$std_name" | awk '{s=""; for(i=1;i<NF;i++) s=s substr($i,1,1); print tolower(s)}' | tr -cd 'a-z0-9')"
    std_last="$(printf '%s' "$std_name" | awk '{print tolower($NF)}' | tr -cd 'a-z0-9')"
    std_k=2
    while [ "$std_k" -le "${#std_last}" ]; do
      std_candidate="$std_prefix$(printf '%s' "$std_last" | cut -c1-"$std_k")"
      if [ ! -e "$std_kit/$std_candidate" ]; then
        echo "Note: $std_initials/ is taken, suggesting $std_candidate/ instead." >&2
        printf '%s' "$std_kit/$std_candidate"
        return
      fi
      std_k=$((std_k + 1))
    done
  fi
  std_n=2
  while [ -e "$std_kit/$std_initials$std_n" ]; do
    std_n=$((std_n + 1))
  done
  echo "Note: $std_initials/ is taken, suggesting $std_initials$std_n/ instead." >&2
  printf '%s' "$std_kit/$std_initials$std_n"
}

# ask <varname> <prompt> [default]
# Interactive free-text question; shows the default in brackets.
ask() {
  var="$1"
  prompt="$2"
  default="${3:-}"
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default]: " reply
    [ -z "$reply" ] && reply="$default"
  else
    reply=""
    while [ -z "$reply" ]; do
      read -r -p "$prompt: " reply
    done
  fi
  eval "$var=\$reply"
}

# ask_menu [--quiet] [--required] <varname> <prompt> <opt1> <opt2> [...]
# Numbered menu; default is option 1. --quiet skips printing the prompt and
# the numbered options, for callers that already printed their own menu text.
# --required removes the default, for a choice that must not be made by a
# stray Return: it asks again, and returns 1 if the input runs out.
ask_menu() {
  quiet=no
  required=no
  while :; do
    case "${1:-}" in
      --quiet) quiet=yes; shift ;;
      --required) required=yes; shift ;;
      *) break ;;
    esac
  done
  var="$1"
  prompt="$2"
  shift 2
  if [ "$quiet" = "no" ]; then
    echo "$prompt"
    i=1
    for opt in "$@"; do
      echo "  $i) $opt"
      i=$((i + 1))
    done
  fi
  choice=""
  while :; do
    if [ "$required" = "yes" ]; then
      # No default: a bare Return asks again. If the input has run out there is
      # nobody to ask, so fail rather than spin; the caller picks what that means.
      read -r -p "Choose a number: " choice || return 1
    else
      read -r -p "Choose a number [1]: " choice
      [ -z "$choice" ] && choice=1
    fi
    case "$choice" in
      ''|*[!0-9]*) ;;
      *) [ "$choice" -ge 1 ] && [ "$choice" -le $# ] && break ;;
    esac
    echo "Please enter a number between 1 and $#."
  done
  i=1
  for opt in "$@"; do
    if [ "$i" -eq "$choice" ]; then
      eval "$var=\$opt"
      break
    fi
    i=$((i + 1))
  done
}

# print_speech_question
# The "talk to Jawbs" question, asked only for Jawbs on this computer. Kept
# here as one function so the tests can read the wording.
print_speech_question() {
  echo "Would you like to talk to Jawbs as well as type?"
  echo
  echo "  Jawbs does its best work when you give it long answers with plenty of"
  echo "  detail, and those are far easier to say out loud than to type. With this"
  echo "  on, each text box gets a microphone button. You talk, and your words"
  echo "  appear in the box for you to check before sending."
  echo
  echo "  It is free of charge. There is no subscription and nothing to pay. Your"
  echo "  voice is turned into text on this computer and never leaves it."
  echo
  echo "  What it costs: a one-off download of about 490 MB, which takes about"
  echo "  640 MB of disk space. While it turns your speech into text, usually under"
  echo "  a minute, your computer works hard and uses about 1 GB of memory. The"
  echo "  rest of the time it uses nothing."
  echo
  echo "  1) Yes, set it up"
  echo "  2) No thanks (you can switch it on later)"
  echo
}

# sha256_of <file>
# Prints the file's SHA-256. Linux has sha256sum, macOS has shasum. Returns 1
# when neither exists.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    return 1
  fi
}

# set_env_line <file> <key> <value>
# Sets KEY=value in a .env file: replaces the KEY= line, or adds one at the
# end. Commented lines are left alone, and a key set twice ends up set once.
# The result is written back over the file with cat rather than mv, so the
# file keeps its permissions (the shared portal's .env holds secrets and is
# often 600), and the temporary copy is made under umask 077 for the same
# reason.
set_env_line() {
  sel_tmp="$1.set.$$"
  (
    umask 077
    awk -v k="$2" -v v="$3" '
      index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$1" > "$sel_tmp"
  ) || { rm -f "$sel_tmp"; return 1; }
  cat "$sel_tmp" > "$1" || { rm -f "$sel_tmp"; return 1; }
  rm -f "$sel_tmp"
}

# register_portal_user <registry_file> <email> <name> <project_dir> <admin yes|no>
# Upserts one entry in the shared portal registry (portal/data/users.json).
# The registry is edited with node so JSON escaping is always correct; the
# portal itself needs Node 18+, so node being present is the normal case.
# Without node, print the entry to add by hand and succeed anyway: portal
# registration must never break project setup.
register_portal_user() {
  reg_file="$1"
  reg_email="$2"
  reg_name="$3"
  reg_dir="$4"
  reg_admin="$5"
  reg_email_lc="$(printf '%s' "$reg_email" | tr -d ' ' | tr '[:upper:]' '[:lower:]')"
  if ! command -v node >/dev/null 2>&1; then
    echo "node not found: cannot update the portal registry automatically."
    echo "Add this entry to $reg_file by hand:"
    if [ "$reg_admin" = "yes" ]; then
      echo "  \"$reg_email_lc\": { \"name\": \"$reg_name\", \"projectDir\": \"$reg_dir\", \"admin\": true }"
    else
      echo "  \"$reg_email_lc\": { \"name\": \"$reg_name\", \"projectDir\": \"$reg_dir\" }"
    fi
    return 0
  fi
  REG_FILE="$reg_file" REG_EMAIL="$reg_email" REG_NAME="$reg_name" \
  REG_DIR="$reg_dir" REG_ADMIN="$reg_admin" node -e '
    const fs = require("fs");
    const path = require("path");
    const file = process.env.REG_FILE;
    const email = process.env.REG_EMAIL.trim().toLowerCase();
    let users = {};
    if (fs.existsSync(file)) users = JSON.parse(fs.readFileSync(file, "utf8"));
    const existed = Object.prototype.hasOwnProperty.call(users, email);
    const entry = { name: process.env.REG_NAME, projectDir: process.env.REG_DIR };
    if (process.env.REG_ADMIN === "yes") entry.admin = true;
    users[email] = entry;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(users, null, 2) + "\n");
    console.log((existed ? "Updated " : "Registered ") + email + " in " + file);
  '
}

# detect_subscriptions
# Sets SUBSCRIPTIONS_FOUND to "both" when a signed-in Codex is found, else
# "claude-only", and CODEX_BIN_FOUND to the binary's path (empty when there is
# none). Call it directly, not in $(...): a subshell would lose both variables. The portal
# only drafts through ChatGPT under "both", and refuses to start under "both"
# without Codex, so guessing high would stop the portal.
detect_subscriptions() {
  CODEX_BIN_FOUND=""
  if command -v codex >/dev/null 2>&1; then
    CODEX_BIN_FOUND="$(command -v codex)"
  elif [ -x "$HOME/.local/bin/codex" ]; then
    CODEX_BIN_FOUND="$HOME/.local/bin/codex"
  fi
  if [ -n "$CODEX_BIN_FOUND" ] && "$CODEX_BIN_FOUND" login status </dev/null >/dev/null 2>&1; then
    SUBSCRIPTIONS_FOUND="both"
  else
    SUBSCRIPTIONS_FOUND="claude-only"
  fi
}

# free_local_port <node> [first]
# Prints the first port free on 127.0.0.1 from <first> (default 8710, or
# JAWBS_PORT_BASE) up to 20 later, so two people with their own kit copies on
# one computer get different ports. Prints <first> when node cannot check.
free_local_port() {
  flp_first="${2:-${JAWBS_PORT_BASE:-8710}}"
  flp_port="$(FLP_FIRST="$flp_first" "$1" -e '
    const net = require("net");
    const first = Number(process.env.FLP_FIRST);
    const tryPort = (p) => {
      if (p > first + 20) { console.log(first); return; }
      const s = net.createServer();
      s.once("error", () => tryPort(p + 1));
      s.listen(p, "127.0.0.1", () => s.close(() => console.log(p)));
    };
    tryPort(first);
  ' 2>/dev/null)"
  case "$flp_port" in
    ''|*[!0-9]*) flp_port="$flp_first" ;;
  esac
  echo "$flp_port"
}

# write_local_env <env_file> <subscriptions> [codex_bin] [node]
# Writes the portal .env for EXPOSURE=local, on the first free port from 8710.
# <subscriptions> is both, claude-only or chatgpt-only.
# Never overwrites: returns 1 and writes nothing when the file exists.
write_local_env() {
  wle_file="$1"; wle_subs="$2"; wle_codex="${3:-}"; wle_node="${4:-node}"
  [ -e "$wle_file" ] && return 1
  wle_port="$(free_local_port "$wle_node")"
  {
    echo "# Written by the setup wizard for Jawbs on this computer. See docs/portal.md."
    echo "EXPOSURE=local"
    echo "BIND_HOST=127.0.0.1"
    echo "PORT=$wle_port"
    echo "BASE_URL=http://localhost:$wle_port"
    echo "EMAIL_PROVIDER=log"
    echo "PORTAL_TITLE=Jawbs"
    # ChatGPT alone runs the whole service through Codex; preflight requires
    # the two settings together.
    if [ "$wle_subs" = "chatgpt-only" ]; then
      echo "AGENT_RUNNER=codex"
    else
      echo "AGENT_RUNNER=claude-sdk"
    fi
    echo "SUBSCRIPTIONS=$wle_subs"
    if [ -n "$wle_codex" ] && [ "$wle_codex" != "$HOME/.local/bin/codex" ]; then
      echo "CODEX_BIN=$wle_codex"
    fi
  } > "$wle_file"
}

# registry_has_other <registry> <email>
# True when the registry holds anyone other than <email>. No node, no file or
# an unreadable file all count as "no one else".
registry_has_other() {
  [ -f "$1" ] || return 1
  command -v node >/dev/null 2>&1 || return 1
  RHO_FILE="$1" RHO_EMAIL="$2" node -e '
    const u = JSON.parse(require("fs").readFileSync(process.env.RHO_FILE, "utf8"));
    const me = process.env.RHO_EMAIL.trim().toLowerCase();
    process.exit(Object.keys(u).some(k => k !== me) ? 0 : 1);
  ' 2>/dev/null
}

# registry_person_for <registry> <project_dir> [node]
# Prints "name<TAB>email" for the person registered with this project folder,
# or nothing. Used to re-run local setup once SETUP.md has deleted itself.
registry_person_for() {
  [ -f "$1" ] || return 1
  command -v "${3:-node}" >/dev/null 2>&1 || return 1
  RPF_FILE="$1" RPF_DIR="$2" "${3:-node}" -e '
    const u = JSON.parse(require("fs").readFileSync(process.env.RPF_FILE, "utf8"));
    const hit = Object.keys(u).find(k => u[k].projectDir === process.env.RPF_DIR);
    if (hit) console.log(u[hit].name + "\t" + hit);
  ' 2>/dev/null
}

# install_launcher <kit_dir> <node_path>
# Writes <kit_dir>/bin/jawbs-open with absolute paths baked in, then installs
# a Jawbs icon in Applications (macOS) or the app menu (Linux), and on the
# Desktop. Apps started from the Dock or a desktop menu do not get the login
# shell's PATH, so the PATH at setup time is baked in too: without it the
# agent could not find typst, python3 or codex. JAWBS_OS and
# JAWBS_DESKTOP_DIR override detection, for tests.
install_launcher() {
  il_kit="$1"; il_node="$2"
  il_os="${JAWBS_OS:-$(uname -s)}"
  il_bin="$il_kit/bin/jawbs-open"
  mkdir -p "$il_kit/bin"
  {
    echo '#!/usr/bin/env bash'
    echo '# Generated by setup/lib.sh install_launcher. Opens Jawbs, starting it first'
    echo '# if it is not already running. Safe to double-click repeatedly.'
    printf 'KIT="%s"\n' "$il_kit"
    printf 'NODE="%s"\n' "$il_node"
    printf 'export PATH="%s"\n' "$PATH"
    printf 'OS="%s"\n' "$il_os"
    cat <<'EOF'
PORT="${JAWBS_PORT:-}"
[ -n "$PORT" ] || PORT="$(sed -n 's/^PORT=//p' "$KIT/portal/.env" 2>/dev/null | head -1 | tr -d '\r ')"
PORT="${PORT:-8710}"
URL="http://localhost:$PORT"
LOG="$KIT/portal/data/jawbs.log"
WAIT="${JAWBS_WAIT_SECS:-15}"

# Asks Jawbs on this port who it is, with the node baked in above rather than
# curl, which not every computer has. Prints "ours" for this kit's Jawbs,
# "other" for another kit's, and nothing when no Jawbs answers.
probe() {
  PROBE_PORT="$PORT" PROBE_KIT="$KIT" "$NODE" -e '
    const fs = require("fs");
    fetch("http://127.0.0.1:" + process.env.PROBE_PORT + "/api/meta", { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json())
      .then((m) => {
        if (!m || m.local !== true) return;
        let mine = process.env.PROBE_KIT;
        try { mine = fs.realpathSync(mine); } catch (e) {}
        console.log(m.kit === mine ? "ours" : "other");
      })
      .catch(() => {});
  ' 2>/dev/null
}
open_browser() {
  [ "${JAWBS_NO_BROWSER:-}" = "yes" ] && return 0
  if [ "$OS" = "Darwin" ]; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1 & fi
}
complain() {
  msg="${1:-Jawbs did not start. Details are in $LOG}"
  [ "${JAWBS_NO_DIALOG:-}" = "yes" ] && { echo "$msg" >&2; return; }
  if [ "$OS" = "Darwin" ]; then
    osascript -e "display alert \"Jawbs\" message \"$msg\" as critical" >/dev/null 2>&1 || echo "$msg" >&2
  elif command -v zenity >/dev/null 2>&1; then
    zenity --error --title=Jawbs --text="$msg" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send Jawbs "$msg"
  else
    echo "$msg" >&2
  fi
}
clash() {
  complain "Another copy of Jawbs is already using this computer's port. Quit it first, or change PORT in $KIT/portal/.env."
  exit 1
}

state="$(probe)"
if [ "$state" = "ours" ]; then open_browser; exit 0; fi
[ "$state" = "other" ] && clash
mkdir -p "$(dirname "$LOG")"
# Not PID="$( ... & echo $! )": the backgrounded subshell holds the capture
# pipe open for as long as the server runs, so that line never returns. exec
# makes the subshell become the server, so $! is the server's own PID.
( cd "$KIT/portal" && exec nohup "$NODE" src/server.js >>"$LOG" 2>&1 </dev/null ) &
PID=$!
i=0
while [ "$i" -lt "$WAIT" ]; do
  state="$(probe)"
  if [ "$state" = "ours" ]; then open_browser; exit 0; fi
  [ "$state" = "other" ] && clash
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
  i=$((i + 1))
done
complain
exit 1
EOF
  } > "$il_bin"
  chmod +x "$il_bin"

  il_icon="$il_kit/setup/assets/jawbs.png"
  if [ -n "${JAWBS_DESKTOP_DIR:-}" ]; then
    il_desk="$JAWBS_DESKTOP_DIR"
  elif [ "$il_os" = "Linux" ] && command -v xdg-user-dir >/dev/null 2>&1; then
    il_desk="$(xdg-user-dir DESKTOP)"
  else
    il_desk="$HOME/Desktop"
  fi
  mkdir -p "$il_desk"

  if [ "$il_os" = "Darwin" ]; then
    il_app="$HOME/Applications/Jawbs.app"
    mkdir -p "$il_app/Contents/MacOS" "$il_app/Contents/Resources"
    cat > "$il_app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Jawbs</string>
  <key>CFBundleDisplayName</key><string>Jawbs</string>
  <key>CFBundleIdentifier</key><string>local.jawbs.launcher</string>
  <key>CFBundleExecutable</key><string>Jawbs</string>
  <key>CFBundleIconFile</key><string>jawbs</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
    printf '#!/bin/bash\nexec "%s"\n' "$il_bin" > "$il_app/Contents/MacOS/Jawbs"
    chmod +x "$il_app/Contents/MacOS/Jawbs"
    # sips and iconutil ship with macOS; elsewhere (tests) the icon is skipped.
    if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1 && [ -f "$il_icon" ]; then
      il_set="$(mktemp -d)/jawbs.iconset"
      mkdir -p "$il_set"
      for il_s in 16 32 128 256 512; do
        sips -z "$il_s" "$il_s" "$il_icon" --out "$il_set/icon_${il_s}x${il_s}.png" >/dev/null 2>&1
        il_d=$((il_s * 2))
        sips -z "$il_d" "$il_d" "$il_icon" --out "$il_set/icon_${il_s}x${il_s}@2x.png" >/dev/null 2>&1
      done
      iconutil -c icns "$il_set" -o "$il_app/Contents/Resources/jawbs.icns" >/dev/null 2>&1 || true
    fi
    # A Finder alias shows the app's icon; a symlink is the fallback.
    rm -rf "$il_desk/Jawbs.app"
    if ! osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$il_app\" at POSIX file \"$il_desk\"" \
        -e "tell application \"Finder\" to set name of result to \"Jawbs.app\"" >/dev/null 2>&1; then
      ln -s "$il_app" "$il_desk/Jawbs.app"
    fi
    echo "Jawbs is in your Applications folder and on your Desktop."
  else
    il_apps="$HOME/.local/share/applications"
    mkdir -p "$il_apps"
    il_entry="$il_apps/jawbs.desktop"
    {
      echo "[Desktop Entry]"
      echo "Type=Application"
      echo "Name=Jawbs"
      echo "Comment=Your job search, in the browser"
      printf 'Exec="%s"\n' "$il_bin"
      printf 'Icon=%s\n' "$il_icon"
      echo "Terminal=false"
      echo "Categories=Office;"
    } > "$il_entry"
    chmod +x "$il_entry"
    cp "$il_entry" "$il_desk/jawbs.desktop"
    chmod +x "$il_desk/jawbs.desktop"
    if command -v gio >/dev/null 2>&1; then
      gio set "$il_desk/jawbs.desktop" metadata::trusted true >/dev/null 2>&1 || true
    fi
    echo "Jawbs is in your applications menu and on your Desktop."
  fi
}
