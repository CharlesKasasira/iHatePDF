import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => ({ storageDir: "" }));

vi.mock("../src/config/env.js", () => ({
  env: {
    API_PUBLIC_URL: "http://localhost:4000",
    get STORAGE_DIR() {
      return testEnv.storageDir;
    }
  }
}));

const { StorageService } = await import("../src/storage/storage.service.js");

describe("StorageService path containment", () => {
  beforeEach(async () => {
    testEnv.storageDir = await mkdtemp(join(tmpdir(), "ihatepdf-storage-test-"));
  });

  afterEach(async () => {
    await rm(testEnv.storageDir, { recursive: true, force: true });
  });

  it.each([
    "../outside.pdf",
    "../../etc/passwd",
    "/etc/passwd",
    "uploads/../../../outside.pdf"
  ])("rejects traversal object key %s", async (objectKey) => {
    const storage = new StorageService();
    await storage.onModuleInit();

    await expect(storage.readObjectBuffer(objectKey)).rejects.toThrow(
      "Invalid object key path traversal attempt."
    );
    await expect(storage.openObjectReadStream(objectKey)).rejects.toThrow(
      "Invalid object key path traversal attempt."
    );
    await expect(storage.deleteObject(objectKey)).rejects.toThrow(
      "Invalid object key path traversal attempt."
    );
  });

  it("rejects a traversal prefix before writing", async () => {
    const storage = new StorageService();
    await storage.onModuleInit();

    await expect(
      storage.saveFile("document.pdf", "application/pdf", Buffer.from("pdf"), "../../outside")
    ).rejects.toThrow("Invalid object key path traversal attempt.");
  });

  it("stores and reads a normal nested object", async () => {
    const storage = new StorageService();
    await storage.onModuleInit();

    const saved = await storage.saveFile(
      "quarterly report.pdf",
      "application/pdf",
      Buffer.from("pdf"),
      "uploads"
    );

    expect(saved.objectKey).toMatch(/^uploads\/\d{4}-\d{2}-\d{2}\//);
    expect(saved.fileName).toBe("quarterly_report.pdf");
    await expect(storage.readObjectBuffer(saved.objectKey)).resolves.toEqual(Buffer.from("pdf"));
  });
});
