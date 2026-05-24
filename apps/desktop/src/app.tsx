import { IhatePdfClient, type ApiTaskStatus, type QueueOperation } from "@ihatepdf/sdk";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  FileImage,
  FileText,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Scissors,
  Settings,
  Sparkles,
  Trash2,
  Unlock,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_API_BASE_URL = "http://localhost:4000/api";
const SETTINGS_KEY = "ihatepdf.desktop.settings";
const RECENT_TASKS_KEY = "ihatepdf.desktop.recentTasks";

type NativeFile = {
  path?: string;
  name: string;
  size: number;
  mime_type?: string;
  file?: File;
};

type DesktopSettings = {
  apiBaseUrl: string;
  outputFolder: string;
  theme: "system" | "light" | "dark";
  userEmail: string;
  keyPrefix: string;
};

type ToolDefinition = {
  id: QueueOperation;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  mode: "single" | "multi";
  accept: string;
  outputSuffix: string;
  requiresPassword?: boolean;
  requiresRanges?: boolean;
};

type WorkItem = {
  id: string;
  files: NativeFile[];
  outputName: string;
  status: "ready" | "uploading" | "queueing" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  taskId?: string;
  outputPath?: string;
  expiresAt?: string | null;
  error?: string;
};

type RecentTask = {
  id: string;
  tool: string;
  status: WorkItem["status"];
  source: string;
  outputPath?: string;
  taskId?: string;
  createdAt: string;
  completedAt?: string;
};

const TOOLS: ToolDefinition[] = [
  {
    id: "merge",
    label: "Merge PDF",
    description: "Combine ordered PDFs into one file.",
    icon: FileArchive,
    mode: "multi",
    accept: ".pdf,application/pdf",
    outputSuffix: "-merged.pdf"
  },
  {
    id: "split",
    label: "Split PDF",
    description: "Export one or more page ranges.",
    icon: Scissors,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: "-split",
    requiresRanges: true
  },
  {
    id: "compress",
    label: "Compress PDF",
    description: "Reduce PDF size through the server worker.",
    icon: FileArchive,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: "-compressed.pdf"
  },
  {
    id: "protect",
    label: "Protect PDF",
    description: "Add password encryption to a PDF.",
    icon: Lock,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: "-protected.pdf",
    requiresPassword: true
  },
  {
    id: "unlock",
    label: "Unlock PDF",
    description: "Remove a known password from a PDF.",
    icon: Unlock,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: "-unlocked.pdf",
    requiresPassword: true
  },
  {
    id: "jpg-to-pdf",
    label: "JPG to PDF",
    description: "Create one PDF from images.",
    icon: FileImage,
    mode: "multi",
    accept: ".jpg,.jpeg,.png,image/jpeg,image/png",
    outputSuffix: "-images.pdf"
  },
  {
    id: "pdf-to-jpg",
    label: "PDF to JPG",
    description: "Render PDF pages as JPG files.",
    icon: FileImage,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: ".zip"
  },
  {
    id: "pdf-to-word",
    label: "PDF to Word",
    description: "Convert PDF pages to a Word document.",
    icon: FileText,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: ".docx"
  },
  {
    id: "pdf-to-excel",
    label: "PDF to Excel",
    description: "Convert PDF pages to an Excel workbook.",
    icon: FileText,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: ".xlsx"
  },
  {
    id: "pdf-to-powerpoint",
    label: "PDF to PowerPoint",
    description: "Convert PDF pages to a slide deck.",
    icon: FileText,
    mode: "single",
    accept: ".pdf,application/pdf",
    outputSuffix: ".pptx"
  },
  {
    id: "word-to-pdf",
    label: "Word to PDF",
    description: "Convert a DOCX file to PDF.",
    icon: FileText,
    mode: "single",
    accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    outputSuffix: ".pdf"
  },
  {
    id: "excel-to-pdf",
    label: "Excel to PDF",
    description: "Convert an XLSX workbook to PDF.",
    icon: FileText,
    mode: "single",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    outputSuffix: ".pdf"
  },
  {
    id: "powerpoint-to-pdf",
    label: "PowerPoint to PDF",
    description: "Convert a PPTX deck to PDF.",
    icon: FileText,
    mode: "single",
    accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
    outputSuffix: ".pdf"
  }
];

const DEFAULT_SETTINGS: DesktopSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  outputFolder: "",
  theme: "system",
  userEmail: "",
  keyPrefix: ""
};

function loadSettings(): DesktopSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: DesktopSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadRecentTasks(): RecentTask[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_TASKS_KEY) ?? "[]") as RecentTask[];
  } catch {
    return [];
  }
}

function saveRecentTasks(tasks: RecentTask[]): void {
  localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(tasks.slice(0, 30)));
}

function id(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function deriveOutputName(tool: ToolDefinition, files: NativeFile[]): string {
  const first = files[0]?.name ?? tool.id;
  if (tool.id === "split") {
    return `${stripExtension(first)}-split`;
  }
  if (tool.id === "merge" || tool.id === "jpg-to-pdf") {
    return `${stripExtension(first)}${tool.outputSuffix}`;
  }
  return `${stripExtension(first)}${tool.outputSuffix}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusText(status: ApiTaskStatus): string {
  return status.task.progress.message ?? status.task.status;
}

async function getNativeDeviceName(): Promise<string> {
  try {
    return await invoke<string>("device_name");
  } catch {
    return "Desktop";
  }
}

async function selectNativeFiles(multiple: boolean): Promise<NativeFile[]> {
  return invoke<NativeFile[]>("select_files", { multiple });
}

async function readNativeFile(file: NativeFile): Promise<Uint8Array> {
  if (file.file) {
    return new Uint8Array(await file.file.arrayBuffer());
  }
  if (!file.path) {
    throw new Error("Missing file path.");
  }
  return new Uint8Array(await invoke<number[]>("read_file_bytes", { path: file.path }));
}

async function saveOutput(outputFolder: string, fileName: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>("save_downloaded_file", {
    outputFolder,
    fileName,
    bytes: Array.from(bytes)
  });
}

function buildPayload(tool: ToolDefinition, fileIds: string[], outputName: string, password: string, ranges: string): Record<string, unknown> {
  if (tool.id === "merge" || tool.id === "jpg-to-pdf") {
    return { fileIds, outputName };
  }
  if (tool.id === "split") {
    return {
      fileId: fileIds[0],
      pageRanges: ranges.split(",").map((part) => part.trim()).filter(Boolean),
      outputPrefix: outputName
    };
  }
  if (tool.id === "protect" || tool.id === "unlock") {
    return { fileId: fileIds[0], password, outputName };
  }
  return { fileId: fileIds[0], outputName };
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<DesktopSettings>(() => loadSettings());
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>(() => loadRecentTasks());
  const [apiKey, setApiKey] = useState("");
  const [tokenLoading, setTokenLoading] = useState(true);
  const [activeToolId, setActiveToolId] = useState<QueueOperation>("merge");
  const [files, setFiles] = useState<NativeFile[]>([]);
  const [outputName, setOutputName] = useState("");
  const [password, setPassword] = useState("");
  const [ranges, setRanges] = useState("1");
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loginEmail, setLoginEmail] = useState(settings.userEmail);
  const [loginPassword, setLoginPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTool = useMemo(() => TOOLS.find((tool) => tool.id === activeToolId) ?? TOOLS[0], [activeToolId]);
  const client = useMemo(
    () => new IhatePdfClient({ baseUrl: settings.apiBaseUrl, apiKey }),
    [settings.apiBaseUrl, apiKey]
  );

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveRecentTasks(recentTasks);
  }, [recentTasks]);

  useEffect(() => {
    invoke<string | null>("get_secure_token")
      .then((token) => setApiKey(token ?? ""))
      .catch(() => setApiKey(""))
      .finally(() => setTokenLoading(false));
  }, []);

  useEffect(() => {
    setFiles([]);
    setOutputName("");
    setPassword("");
    setRanges("1");
    setNotice("");
  }, [activeToolId]);

  const updateSettings = (next: Partial<DesktopSettings>): void => {
    setSettings((current) => ({ ...current, ...next }));
  };

  const addFiles = (nextFiles: NativeFile[]): void => {
    const accepted = activeTool.mode === "single" ? nextFiles.slice(0, 1) : nextFiles;
    setFiles(accepted);
    setOutputName(deriveOutputName(activeTool, accepted));
    setNotice(accepted.length ? `${accepted.length} file(s) ready.` : "");
  };

  const chooseFiles = async (): Promise<void> => {
    try {
      addFiles(await selectNativeFiles(activeTool.mode === "multi"));
    } catch (error) {
      setNotice(`Native picker failed: ${(error as Error).message}`);
      fileInputRef.current?.click();
    }
  };

  const chooseOutputFolder = async (): Promise<void> => {
    const folder = await invoke<string | null>("select_output_folder");
    if (folder) {
      updateSettings({ outputFolder: folder });
    }
  };

  const login = async (): Promise<void> => {
    try {
      setBusy(true);
      setNotice("Signing in and creating a desktop device key...");
      const deviceName = await getNativeDeviceName();
      const result = await new IhatePdfClient({ baseUrl: settings.apiBaseUrl }).createDesktopDeviceKey({
        email: loginEmail,
        password: loginPassword,
        deviceName
      });
      await invoke("set_secure_token", { token: result.apiKey.key });
      setApiKey(result.apiKey.key);
      updateSettings({
        userEmail: result.user.email,
        keyPrefix: result.apiKey.keyPrefix
      });
      setLoginPassword("");
      setNotice("Desktop device key created and stored securely.");
    } catch (error) {
      setNotice(`Sign in failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    await invoke("clear_secure_token");
    setApiKey("");
    updateSettings({ userEmail: "", keyPrefix: "" });
    setNotice("Signed out on this device.");
  };

  const runTool = async (): Promise<void> => {
    if (!apiKey) {
      setNotice("Sign in before running a desktop task.");
      return;
    }
    if (!files.length) {
      setNotice("Choose files first.");
      return;
    }
    if ((activeTool.id === "merge" || activeTool.id === "jpg-to-pdf") && files.length < 2) {
      setNotice(`${activeTool.label} needs at least two files.`);
      return;
    }
    if (activeTool.requiresPassword && !password.trim()) {
      setNotice("Enter the document password.");
      return;
    }
    if (activeTool.requiresRanges && !ranges.trim()) {
      setNotice("Enter at least one page range.");
      return;
    }
    if (!outputName.trim()) {
      setNotice("Set an output name.");
      return;
    }

    let outputFolder = settings.outputFolder;
    if (!outputFolder) {
      const folder = await invoke<string | null>("select_output_folder");
      if (!folder) {
        setNotice("Choose an output folder to save completed files.");
        return;
      }
      outputFolder = folder;
      updateSettings({ outputFolder });
    }

    const workItem: WorkItem = {
      id: id(),
      files,
      outputName: outputName.trim(),
      status: "uploading",
      progress: 4,
      message: "Uploading source files..."
    };
    setWorkItems((current) => [workItem, ...current]);
    setBusy(true);

    try {
      const uploadedIds: string[] = [];
      for (const file of files) {
        const bytes = await readNativeFile(file);
        const uploaded = await client.uploadFile({
          bytes,
          fileName: file.name,
          mimeType: file.mime_type ?? file.file?.type
        });
        uploadedIds.push(uploaded.id);
      }

      setWorkItems((current) =>
        current.map((item) =>
          item.id === workItem.id
            ? { ...item, status: "queueing", progress: 12, message: "Queueing task..." }
            : item
        )
      );

      const queued = await client.queueTask(
        activeTool.id,
        buildPayload(activeTool, uploadedIds, outputName.trim(), password.trim(), ranges)
      );

      setWorkItems((current) =>
        current.map((item) =>
          item.id === workItem.id
            ? {
                ...item,
                status: "processing",
                progress: queued.task.progress.percent,
                message: statusText(queued),
                taskId: queued.task.id
              }
            : item
        )
      );

      const completed = await client.pollTask(queued.task.id, {
        onUpdate: (status) => {
          setWorkItems((current) =>
            current.map((item) =>
              item.id === workItem.id
                ? {
                    ...item,
                    status: status.task.status === "queued" ? "processing" : status.task.status,
                    progress: status.task.progress.percent,
                    message: statusText(status),
                    taskId: status.task.id,
                    expiresAt: status.task.result.expiresAt
                  }
                : item
            )
          );
        }
      });

      if (completed.task.status !== "completed" || !completed.task.result.downloadUrl) {
        throw new Error(completed.task.error?.message ?? "Task failed without a downloadable result.");
      }

      const bytes = await client.downloadBytes(completed.task.result.downloadUrl);
      const savedPath = await saveOutput(outputFolder, outputName.trim(), bytes);
      setWorkItems((current) =>
        current.map((item) =>
          item.id === workItem.id
            ? {
                ...item,
                status: "completed",
                progress: 100,
                message: "Saved to output folder.",
                outputPath: savedPath,
                expiresAt: completed.task.result.expiresAt
              }
            : item
        )
      );
      setRecentTasks((current) => [
        {
          id: id(),
          tool: activeTool.label,
          status: "completed",
          source: files.map((file) => file.name).join(", "),
          outputPath: savedPath,
          taskId: completed.task.id,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        },
        ...current
      ]);
      setNotice("Task completed.");
    } catch (error) {
      setWorkItems((current) =>
        current.map((item) =>
          item.id === workItem.id
            ? {
                ...item,
                status: "failed",
                progress: item.progress,
                message: "Task failed.",
                error: (error as Error).message
              }
            : item
        )
      );
      setRecentTasks((current) => [
        {
          id: id(),
          tool: activeTool.label,
          status: "failed",
          source: files.map((file) => file.name).join(", "),
          createdAt: new Date().toISOString()
        },
        ...current
      ]);
      setNotice(`Task failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const ActiveIcon = activeTool.icon;
  const signedIn = Boolean(apiKey);

  return (
    <main className={`app-shell theme-${settings.theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={22} />
          <div>
            <strong>iHatePDF</strong>
            <span>Desktop</span>
          </div>
        </div>
        <nav className="tool-list">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                type="button"
                className={tool.id === activeTool.id ? "tool-button active" : "tool-button"}
                key={tool.id}
                onClick={() => setActiveToolId(tool.id)}
                title={tool.description}
              >
                <Icon size={18} />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{activeTool.label}</h1>
            <p>{activeTool.description}</p>
          </div>
          <div className="account-pill">
            <KeyRound size={16} />
            {tokenLoading ? "Loading token..." : signedIn ? settings.userEmail || settings.keyPrefix : "Not signed in"}
          </div>
        </header>

        <div className="content-grid">
          <section className="workbench">
            <div className="dropzone" onClick={() => void chooseFiles()}>
              <ActiveIcon size={34} />
              <strong>{files.length ? `${files.length} selected` : "Choose files"}</strong>
              <span>{activeTool.mode === "multi" ? "Select multiple files in order" : "Select one source file"}</span>
              <button type="button" className="secondary-button">
                <Upload size={16} />
                Browse
              </button>
              <input
                ref={fileInputRef}
                className="hidden-input"
                type="file"
                multiple={activeTool.mode === "multi"}
                accept={activeTool.accept}
                onChange={(event) =>
                  addFiles(
                    Array.from(event.currentTarget.files ?? []).map((file) => ({
                      file,
                      name: file.name,
                      size: file.size,
                      mime_type: file.type
                    }))
                  )
                }
              />
            </div>

            {files.length ? (
              <div className="file-queue">
                {files.map((file, index) => (
                  <div className="file-row" key={`${file.path ?? file.name}-${index}`}>
                    <span>{index + 1}</span>
                    <strong>{file.name}</strong>
                    <em>{formatBytes(file.size)}</em>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="controls">
              {activeTool.requiresRanges ? (
                <label>
                  Page ranges
                  <input value={ranges} onChange={(event) => setRanges(event.target.value)} placeholder="1-3, 5" />
                </label>
              ) : null}
              {activeTool.requiresPassword ? (
                <label>
                  Password
                  <input
                    value={password}
                    type="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Document password"
                  />
                </label>
              ) : null}
              <label>
                Output name
                <input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="output.pdf" />
              </label>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void runTool()}>
                {busy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                {busy ? "Running..." : "Run task"}
              </button>
            </div>

            {notice ? <p className="notice">{notice}</p> : null}
          </section>

          <aside className="side-panel">
            <section className="panel-section">
              <h2>
                <Settings size={17} />
                Settings
              </h2>
              <label>
                API server
                <input value={settings.apiBaseUrl} onChange={(event) => updateSettings({ apiBaseUrl: event.target.value })} />
              </label>
              <label>
                Output folder
                <div className="inline-control">
                  <input value={settings.outputFolder || "Choose on first completed task"} readOnly />
                  <button type="button" className="icon-button" onClick={() => void chooseOutputFolder()} title="Choose output folder">
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>
              <label>
                Theme
                <select
                  value={settings.theme}
                  onChange={(event) => updateSettings({ theme: event.target.value as DesktopSettings["theme"] })}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
            </section>

            <section className="panel-section">
              <h2>
                <KeyRound size={17} />
                Account
              </h2>
              {signedIn ? (
                <>
                  <p className="muted">Signed in as {settings.userEmail || "desktop user"}.</p>
                  <p className="muted">Key prefix: {settings.keyPrefix || "stored securely"}</p>
                  <button type="button" className="secondary-button" onClick={() => void logout()}>
                    <LogOut size={16} />
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="Email" />
                  <input
                    value={loginPassword}
                    type="password"
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="Password"
                  />
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => void login()}>
                    <KeyRound size={16} />
                    Create device key
                  </button>
                </>
              )}
            </section>
          </aside>
        </div>

        <section className="results">
          <div className="result-column">
            <h2>Current Tasks</h2>
            {workItems.length ? (
              workItems.map((item) => (
                <article className="task-card" key={item.id}>
                  <div>
                    <strong>{item.outputName}</strong>
                    <span>{item.message}</span>
                    {item.error ? <code>{item.error}</code> : null}
                    {item.expiresAt ? <small>Server copy expires {new Date(item.expiresAt).toLocaleString()}</small> : null}
                  </div>
                  <div className="progress-block">
                    <span className={`status ${item.status}`}>{item.status}</span>
                    <progress value={item.progress} max={100} />
                    {item.outputPath ? (
                      <div className="task-actions">
                        <button type="button" className="icon-button" title="Open file" onClick={() => void invoke("open_file", { path: item.outputPath })}>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          title="Reveal in folder"
                          onClick={() => void invoke("reveal_in_folder", { path: item.outputPath })}
                        >
                          <FolderOpen size={16} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No active desktop tasks.</div>
            )}
          </div>

          <div className="result-column">
            <div className="section-heading">
              <h2>Recent Tasks</h2>
              <button type="button" className="icon-button" title="Clear history" onClick={() => setRecentTasks([])}>
                <Trash2 size={16} />
              </button>
            </div>
            {recentTasks.length ? (
              recentTasks.slice(0, 6).map((task) => (
                <article className="recent-row" key={task.id}>
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>{task.tool}</strong>
                    <span>{task.source}</span>
                  </div>
                  {task.outputPath ? (
                    <button type="button" className="icon-button" title="Open output" onClick={() => void invoke("open_file", { path: task.outputPath })}>
                      <Download size={16} />
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="empty-state">Completed tasks will appear here.</div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
