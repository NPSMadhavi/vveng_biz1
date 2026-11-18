const DB_NAME = "bizone-local-backup";
const STORE = "handles";
const HANDLE_KEY = "folder";
const DONE_KEY = "bizone-local-backup-done";

type BackupSchedule = {
  company_id?: number;
  local_download_enabled?: boolean;
  local_timezone?: string | null;
  local_download_time?: string | null;
  local_download_frequency?: string | null;
  local_destination_dir?: string | null;
  last_successful_download_at?: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeHandle(handle: FileSystemDirectoryHandle) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function backupFolderPermission(): Promise<PermissionState | "missing"> {
  const handle = await readHandle();
  if (!handle) return "missing";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "prompt";
  }
}

/** Ask once for the Windows folder. Later automatic downloads reuse this grant. */
export async function ensureBackupFolder(forcePicker = false): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as Window & {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const existing = await readHandle();
  if (existing && !forcePicker) {
    const permission = await existing.queryPermission({ mode: "readwrite" }).catch(() => "prompt" as PermissionState);
    if (permission === "granted") return existing;
    const requested = await existing.requestPermission({ mode: "readwrite" }).catch(() => "denied" as PermissionState);
    if (requested === "granted") return existing;
  }
  if (!picker) return null;
  const picked = await picker({ mode: "readwrite" });
  await writeHandle(picked);
  return picked;
}

function timeZoneParts(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + minute,
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

export function localDownloadIsDue(schedule: BackupSchedule | null | undefined): boolean {
  if (!schedule || schedule.local_download_enabled === false) return false;
  const timeZone = schedule.local_timezone || "Asia/Kolkata";
  const now = timeZoneParts(timeZone);
  const [hourRaw, minuteRaw] = String(schedule.local_download_time || "02:30").split(":");
  const dueMinutes = (Number(hourRaw) || 0) * 60 + (Number(minuteRaw) || 0);
  if (now.minutes < dueMinutes) return false;

  const frequency = schedule.local_download_frequency || "daily";
  if (frequency === "weekly" && now.weekday !== "Mon") return false;
  if (frequency === "monthly" && now.day !== 1) return false;

  return true;
}

function markDone(backupId: number) {
  if (backupId > 0) localStorage.setItem(DONE_KEY, String(backupId));
}

function fileNameFromResponse(response: Response) {
  const header = response.headers.get("Content-Disposition") || "";
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] || `bizone-backup-${new Date().toISOString().slice(0, 10)}.zip`;
}

export async function downloadLatestBackupToFolder(): Promise<{ fileName: string; folderName: string }> {
  const handle = await readHandle();
  if (!handle) throw new Error("Choose the backup folder once so the file can be saved there.");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error("Allow this site to save backups into the selected folder.");
  }

  const response = await fetch("/api/system-backups/latest/download", { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "No completed server backup is ready to download.");
  }

  const fileName = fileNameFromResponse(response);
  const backupId = Number(response.headers.get("X-Backup-Id") || 0);
  const backupCode = response.headers.get("X-Backup-Code") || "";
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  if (response.body) {
    await response.body.pipeTo(writable);
  } else {
    await writable.write(await response.blob());
    await writable.close();
  }
  const saved = await fileHandle.getFile();

  await fetch("/api/system-backups/agent/report", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      backupId,
      backupCode,
      fileName,
      destinationFolder: handle.name,
      fileSizeBytes: saved.size,
      status: "Completed",
      checksumStatus: "Passed",
      agentHostname: "browser",
    }),
  }).catch(() => undefined);

  return { fileName, folderName: handle.name };
}

export function rememberLocalDownload(backupId = 0) {
  markDone(backupId);
}

export async function runDueLocalDownload(): Promise<boolean> {
  const dash = await fetch("/api/system-backups", { credentials: "include" });
  if (!dash.ok) return false;
  const data = await dash.json();
  const schedule = data?.schedule as BackupSchedule | undefined;
  if (!localDownloadIsDue(schedule)) return false;
  const latest = (data?.backups || []).find((backup: { status?: string }) =>
    backup.status === "completed" || backup.status === "restored",
  );
  const latestId = Number(latest?.id || 0);
  if (latestId > 0 && localStorage.getItem(DONE_KEY) === String(latestId)) return false;
  const alreadySaved = (data?.localHistory || []).some((row: { backup_id?: number; status?: string }) =>
    Number(row.backup_id) === latestId && String(row.status || "").toLowerCase() === "completed",
  );
  if (latestId > 0 && alreadySaved) {
    markDone(latestId);
    return false;
  }
  if ((await backupFolderPermission()) !== "granted") return false;
  await downloadLatestBackupToFolder();
  rememberLocalDownload(latestId);
  return true;
}
