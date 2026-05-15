#!/usr/bin/env python3
import os
import sys
import time

import requests


def main() -> int:
    api_key = os.environ.get("IHATEPDF_API_KEY")
    api_base_url = os.environ.get("IHATEPDF_API_BASE_URL", "http://localhost:4000/api")
    if not api_key or len(sys.argv) != 2:
        print("Usage: IHATEPDF_API_KEY=ihp_... python3 examples/python/compress_pdf.py input.pdf", file=sys.stderr)
        return 1

    headers = {"Authorization": f"Bearer {api_key}"}
    input_path = sys.argv[1]

    with open(input_path, "rb") as source:
        upload = requests.post(
            f"{api_base_url}/v1/files",
            headers=headers,
            files={"file": (os.path.basename(input_path), source, "application/pdf")},
            timeout=60,
        )
    upload.raise_for_status()
    file_id = upload.json()["file"]["id"]

    queued = requests.post(
        f"{api_base_url}/v1/tasks/compress",
        headers={**headers, "Content-Type": "application/json"},
        json={"fileId": file_id, "outputName": "compressed.pdf"},
        timeout=30,
    )
    queued.raise_for_status()
    task = queued.json()["task"]
    print(f"Queued task: {task['id']}")

    while task["status"] not in ("completed", "failed"):
        time.sleep(1)
        status = requests.get(
            f"{api_base_url}/v1/tasks/{task['id']}/status",
            headers=headers,
            timeout=30,
        )
        status.raise_for_status()
        task = status.json()["task"]
        print(f"{task['status']} {task['progress']['percent']}%")

    if task["status"] == "failed":
        raise RuntimeError((task.get("error") or {}).get("message") or "Compression failed")

    print(task["result"]["downloadUrl"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
