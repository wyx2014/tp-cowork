"""Use only the platform package's private wheels with a compatible deployment interpreter."""
import json
import platform
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
if manifest["python"] != list(sys.version_info[:2]) or manifest["platform"] != sys.platform or manifest["machine"] != platform.machine():
    raise SystemExit("toolbox/python-needs-configuration: incompatible deployment interpreter")
sys.path.insert(0, str(root / "site-packages"))
sys.executable = str(root / "python")
args = sys.argv[1:]
if args and args[0] == "-I":
    args.pop(0)
if len(args) >= 2 and args[0] == "-c":
    sys.argv = ["-c", *args[2:]]
    exec(compile(args[1], "<string>", "exec"), {"__name__": "__main__"})
elif args:
    sys.argv = args
    sys.path.insert(0, str(Path(args[0]).resolve().parent))
    runpy.run_path(args[0], run_name="__main__")
else:
    raise SystemExit("toolbox/python: script or -c is required")
