#!/usr/bin/env python3
"""Run each provider collector and publish its record for the Shell extension.

Every collector prints one display-ready JSON record. This writes them to
~/.cache/osaka-ai-usage/records/<id>.json atomically; the extension watches
that directory and redraws as soon as a record lands. Nothing here reads or
stores credentials; the collectors keep tokens to the request that needs them.

  update.py                 timer run; skipped if another run holds the lock
  update.py --limits-only   menu opened; reuse recent local scans
  update.py --force         Refresh pressed; rescan and re-probe everything
"""
import argparse
import concurrent.futures
import datetime
import fcntl
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
PROVIDERS = ("claude", "codex")
CACHE = pathlib.Path(os.environ.get("XDG_CACHE_HOME") or pathlib.Path.home() / ".cache") / "osaka-ai-usage"
RECORDS = CACHE / "records"
COLLECTOR_TIMEOUT = 60
LOCK_WAIT = 90


def read_record(path):
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return record if isinstance(record, dict) else None


def window_open(limit, now):
    raw = str(limit.get("resetsAt") or "")
    if not raw:
        return True
    try:
        reset = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return True
    if reset.tzinfo is None:
        reset = reset.replace(tzinfo=datetime.timezone.utc)
    return reset > now


def carry_limits(record, previous):
    """Keep the last known limits when a probe fails, until their window resets.

    The Claude collector already does this; Codex drops its limits on any RPC
    failure, which would blank the panel for a transient app-server hiccup.
    """
    if record.get("limits") or not record.get("usageStatusText") or not previous:
        return record
    now = datetime.datetime.now(datetime.timezone.utc)
    kept = [l for l in previous.get("limits") or [] if isinstance(l, dict) and window_open(l, now)]
    if kept:
        record = dict(record, limits=kept, limitsStale=True)
    return record


def collect(provider, flags):
    script = HERE / f"{provider}.py"
    result = subprocess.run(
        [sys.executable, str(script), *flags],
        capture_output=True, text=True, timeout=COLLECTOR_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{provider} collector exited with {result.returncode}")
    record = json.loads(result.stdout)
    if not isinstance(record, dict) or record.get("id") != provider:
        raise RuntimeError(f"{provider} collector printed an unexpected record")
    return record


def publish(provider, record):
    fd, tmp = tempfile.mkstemp(dir=RECORDS, prefix=f".{provider}.")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(record, f, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, RECORDS / f"{provider}.json")
    except BaseException:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def acquire(lock, wait):
    deadline = time.monotonic() + (LOCK_WAIT if wait else 0)
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.25)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--force", action="store_true")
    mode.add_argument("--limits-only", action="store_true")
    args = parser.parse_args(argv)
    flags = ["--force"] if args.force else ["--limits-only"] if args.limits_only else []

    RECORDS.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (RECORDS / ".lock").open("w") as lock:
        # A timer run that finds another run in progress has nothing to add.
        # A person asking for fresh numbers waits for it, then asks again.
        if not acquire(lock, wait=bool(flags)):
            return 0
        failed = False
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(PROVIDERS)) as pool:
            jobs = {p: pool.submit(collect, p, flags) for p in PROVIDERS}
            for provider, job in jobs.items():
                try:
                    record = job.result()
                except Exception as error:
                    # The previous record stays; its updatedAt shows its age.
                    print(f"jade-ai-usage: {error}", file=sys.stderr)
                    failed = True
                    continue
                previous = read_record(RECORDS / f"{provider}.json")
                publish(provider, carry_limits(record, previous))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
