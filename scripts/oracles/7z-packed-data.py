"""Isolate native codec failures while comparing generated 7z member hashes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import py7zr


def extract(root, archive, target, directory):
    output = Path(tempfile.mkdtemp(prefix=directory + "-", dir=root))
    with py7zr.SevenZipFile(root / archive, mode="r", password=os.environ["READER_7Z_TEST_PASSWORD"]) as handle:
        handle.extract(path=output, targets=[target])
    return hashlib.sha256((output / target).read_bytes()).hexdigest()


def main():
    root = Path(sys.argv[1])
    if len(sys.argv) > 2:
        try:
            result = {"sha256": extract(root, *sys.argv[2:5])}
        except Exception as error:
            result = {"failure": type(error).__name__}
        print(json.dumps(result))
        return

    def isolated(archive, target, directory):
        result = subprocess.run(
            [sys.executable, __file__, str(root), archive, target, directory],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode < 0:
            return {"failure": "native-signal", "signal": -result.returncode}
        if result.returncode != 0:
            raise RuntimeError("oracle worker failed without a format result")
        return json.loads(result.stdout)

    with py7zr.SevenZipFile(root / "damaged-first-block.7z", mode="r", password=os.environ["READER_7Z_TEST_PASSWORD"]) as handle:
        names = handle.getnames()
    damaged = isolated("damaged-first-block.7z", "000-first.html", "damaged-first")
    if "failure" not in damaged:
        raise RuntimeError("independent oracle accepted damaged first block")
    second = isolated("damaged-first-block.7z", "999-second.html", "damaged-second")
    complete = isolated("complete.7z", "000-first.html", "complete-first")
    print(json.dumps({
        "py7zr": py7zr.__version__,
        "damagedNames": names,
        "damagedFirstFailure": damaged["failure"],
        "damagedFirstSignal": damaged.get("signal"),
        "damagedSecondSha256": second["sha256"],
        "completeFirstSha256": complete["sha256"],
    }))


if __name__ == "__main__":
    main()
