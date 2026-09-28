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
# SENIORITY, EMPLOYMENT_STATUS, AI_TOOL, DATE, PORTAL, JAWBS_MODE, CREATIVE, KIT_DIR.
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

# ask_menu [--quiet] <varname> <prompt> <opt1> <opt2> [...]
# Numbered menu; default is option 1. --quiet skips printing the prompt and
# the numbered options, for callers that already printed their own menu text.
ask_menu() {
  quiet=no
  if [ "$1" = "--quiet" ]; then
    quiet=yes
    shift
  fi
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
    read -r -p "Choose a number [1]: " choice
    [ -z "$choice" ] && choice=1
    case "$choice" in
      *[!0-9]*) ;;
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

# write_local_env <env_file> <subscriptions> [codex_bin]
# Writes the portal .env for EXPOSURE=local. Never overwrites: returns 1 and
# writes nothing when the file exists.
write_local_env() {
  wle_file="$1"; wle_subs="$2"; wle_codex="${3:-}"
  [ -e "$wle_file" ] && return 1
  {
    echo "# Written by the setup wizard for Jawbs on this computer. See docs/portal.md."
    echo "EXPOSURE=local"
    echo "BIND_HOST=127.0.0.1"
    echo "PORT=8710"
    echo "BASE_URL=http://localhost:8710"
    echo "EMAIL_PROVIDER=log"
    echo "PORTAL_TITLE=Jawbs"
    echo "AGENT_RUNNER=claude-sdk"
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
