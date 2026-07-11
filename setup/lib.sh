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
# SENIORITY, EMPLOYMENT_STATUS, AI_TOOL, DATE, TRACKER, PORTAL.
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
  tracker_esc="$(sed_escape "$TRACKER")"
  portal_esc="$(sed_escape "$PORTAL")"
  date_esc="$(sed_escape "$(date +%Y-%m-%d)")"

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
        -e "s/{{TRACKER}}/$tracker_esc/g" \
        -e "s/{{PORTAL}}/$portal_esc/g" \
        -e "s/{{DATE}}/$date_esc/g" \
        "$file" > "$tmp" && mv "$tmp" "$file"
  done
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

# ask_menu <varname> <prompt> <opt1> <opt2> [...]
# Numbered menu; default is option 1.
ask_menu() {
  var="$1"
  prompt="$2"
  shift 2
  echo "$prompt"
  i=1
  for opt in "$@"; do
    echo "  $i) $opt"
    i=$((i + 1))
  done
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
