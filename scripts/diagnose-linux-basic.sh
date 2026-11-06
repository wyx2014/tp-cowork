#!/usr/bin/env bash
# Start the installed Basic package and save system-library and Electron startup diagnostics.
set -uo pipefail
umask 077
diagnostics_dir="$(mktemp -d "${TMPDIR:-/tmp}/tpcowork-basic-startup.XXXXXX")"
log_file="$diagnostics_dir/startup.log"
executable='/opt/TP Cowork Basic/tpcowork-basic'
software_rendering=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --software-rendering) software_rendering=true; shift ;;
    --executable) executable="${2:?Missing executable path}"; shift 2 ;;
    *) echo 'Usage: bash diagnose-linux-basic.sh [--software-rendering] [--executable /path/to/tpcowork-basic]'; exit 2 ;;
  esac
done
if [ ! -x "$executable" ] && command -v tpcowork-basic >/dev/null 2>&1; then
  executable="$(command -v tpcowork-basic)"
fi
{
  date -u
  uname -a
  getconf GNU_LIBC_VERSION || true
  cat /etc/os-release
  echo "DISPLAY=${DISPLAY:-}; WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-}; XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-}"
  echo "Executable: $executable"
  if [ ! -x "$executable" ]; then
    echo 'Install the Basic DEB first, or provide the extracted executable with --executable.'
  else
    ldd "$executable" || true
  fi
  helper="$(dirname "$executable")/chrome-sandbox"
  if [ -e "$helper" ]; then ls -l "$helper"; fi
  if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then cat /proc/sys/kernel/unprivileged_userns_clone; fi
} > "$log_file" 2>&1
if [ ! -x "$executable" ]; then cat "$log_file"; echo "Log: $log_file"; exit 1; fi
args=(--enable-logging=stderr)
if [ "$software_rendering" = true ]; then args+=(--disable-gpu --disable-gpu-rasterization --ozone-platform=x11); fi
echo "Startup log: $log_file"
echo 'Close TP Cowork Basic to finish collecting the startup log.'
env -u ELECTRON_RUN_AS_NODE "$executable" "${args[@]}" 2>&1 | tee -a "$log_file"
result=${PIPESTATUS[0]}
echo "Exit code: $result" | tee -a "$log_file"
echo "Log: $log_file"
exit "$result"
