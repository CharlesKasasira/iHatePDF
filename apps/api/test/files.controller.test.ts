import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", () => ({
  env: {
    API_PUBLIC_URL: "http://localhost:4000",
    APP_BASE_URL: "http://localhost:3000",
    FILE_SHARE_TTL_HOURS: 72,
    PDF_RENDER_DPI: 144,
    PDFTOPPM_BIN: "pdftoppm",
    STORAGE_DIR: "./storage"
  }
}));

const { FilesController } = await import("../src/files/files.controller.js");

function createFile() {
  return {
    id: "file-1",
    objectKey: "uploads/file-1.pdf",
    fileName: "source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 128n,
    ownerId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-04T00:00:00.000Z"),
    owner: { email: "user@example.com" }
  };
}

function createController(referenceCounts = { signatureRequests: 0, signatureEnvelopesAsSource: 0 }) {
  const tx = {
    fileObject: {
      findUnique: vi.fn().mockResolvedValue({ _count: referenceCounts }),
      delete: vi.fn()
    },
    task: { updateMany: vi.fn() },
    signatureEnvelope: { updateMany: vi.fn() }
  };
  const prisma = {
    fileObject: { findUnique: vi.fn().mockResolvedValue(createFile()) },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    fileDeletionReceipt: { create: vi.fn() }
  };
  const storage = { deleteObject: vi.fn().mockResolvedValue(undefined) };
  const auth = { currentUser: vi.fn().mockResolvedValue({ id: "user-1" }) };
  const controller = new FilesController(
    prisma as never,
    storage as never,
    auth as never,
    {} as never,
    {} as never
  );

  return { controller, prisma, storage, auth, tx };
}

describe("FilesController.deleteFile", () => {
  it("deletes an owned file and records the storage cleanup receipt", async () => {
    const { controller, prisma, storage, tx } = createController();

    await expect(controller.deleteFile("file-1", {} as never)).resolves.toEqual({ ok: true });

    expect(tx.task.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.signatureEnvelope.updateMany).toHaveBeenCalledWith({
      where: { finalFileId: "file-1" },
      data: { finalFileId: null }
    });
    expect(tx.fileObject.delete).toHaveBeenCalledWith({ where: { id: "file-1" } });
    expect(storage.deleteObject).toHaveBeenCalledWith("uploads/file-1.pdf");
    expect(prisma.fileDeletionReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reason: "user_requested", storageDeleted: true })
    });
  });

  it("does not reveal or delete another user's file", async () => {
    const { controller, auth, storage } = createController();
    auth.currentUser.mockResolvedValue({ id: "user-2" });

    await expect(controller.deleteFile("file-1", {} as never)).rejects.toMatchObject({ status: 404 });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("protects files attached to signature workflows", async () => {
    const { controller, storage, tx } = createController({
      signatureRequests: 1,
      signatureEnvelopesAsSource: 0
    });

    await expect(controller.deleteFile("file-1", {} as never)).rejects.toMatchObject({ status: 409 });
    expect(tx.fileObject.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
