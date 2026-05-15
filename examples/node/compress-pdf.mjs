import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const apiKey = process.env.IHATEPDF_API_KEY;
const apiBaseUrl = process.env.IHATEPDF_API_BASE_URL ?? "http://localhost:4000/api";
const inputPath = process.argv[2];

if (!apiKey || !inputPath) {
  console.error("Usage: IHATEPDF_API_KEY=ihp_... node examples/node/compress-pdf.mjs input.pdf");
  process.exit(1);
}

async function jsonFetch(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  return response.json();
}

const form = new FormData();
form.set("file", new Blob([await readFile(inputPath)], { type: "application/pdf" }), basename(inputPath));

const upload = await jsonFetch("/v1/files", {
  method: "POST",
  body: form
});

const queued = await jsonFetch("/v1/tasks/compress", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fileId: upload.file.id,
    outputName: "compressed.pdf"
  })
});

let task = queued.task;
while (task.status !== "completed" && task.status !== "failed") {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  ({ task } = await jsonFetch(`/v1/tasks/${task.id}/status`));
  console.log(`${task.status} ${task.progress.percent}%`);
}

if (task.status === "failed") {
  throw new Error(task.error?.message ?? "Compression failed");
}

console.log(task.result.downloadUrl);
