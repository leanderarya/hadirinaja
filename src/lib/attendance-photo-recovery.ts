export type AttendancePhotoIdentity = {
  userId: number
  tenantId: number
  employeeId: number
}

export type AttendancePhotoOperation = AttendancePhotoIdentity & {
  key: string
  operation: "check_in" | "check_out"
  outletId: number | null
  checkoutSessionId?: number
  location: {
    status: "provided" | "unavailable" | "permission_denied"
    latitude?: number
    longitude?: number
    accuracy_meters?: number
  }
  photo?: Blob
  photoSkipped?: boolean
  savedAt: number
}

export type PendingAttendanceMetadata = AttendancePhotoIdentity & {
  key: string
  operation: "check_in" | "check_out"
  outletId: number | null
  checkoutSessionId?: number
  savedAt: number
}

const databaseName = "hadirinaja-attendance-recovery"
const storeName = "pending-photos"
const metadataPrefix = "hadirinaja.attendance.pending.v2."
const legacyMetadataPrefix = "hadirinaja.attendance.pending.legacy."
const legacySessionStorageKey = "hadirinaja.attendance.pending"
const identityChangeSignal = "hadirinaja.attendance.identity-change"
const identityChangeEvent = "hadirinaja:attendance-identity-changing"
const staleAfterMs = 24 * 60 * 60 * 1000

export async function savePendingAttendancePhoto(
  operation: AttendancePhotoOperation
): Promise<void> {
  const database = await openRecoveryDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite")
    transaction.objectStore(storeName).put(operation)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

export async function loadPendingAttendancePhoto(
  key: string,
  identity: AttendancePhotoIdentity
): Promise<AttendancePhotoOperation | null> {
  const database = await openRecoveryDatabase()

  return new Promise<AttendancePhotoOperation | null>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly")
    const request = transaction.objectStore(storeName).get(key)
    request.onsuccess = () => {
      const value: unknown = request.result
      resolve(
        isAttendancePhotoOperation(value) && hasSameIdentity(value, identity)
          ? value
          : null
      )
    }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => database.close()
    transaction.onabort = () => database.close()
  })
}

export async function removePendingAttendancePhoto(key: string): Promise<void> {
  const database = await openRecoveryDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite")
    transaction.objectStore(storeName).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

export async function clearAllPendingAttendancePhotos(): Promise<void> {
  const database = await openRecoveryDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite")
    transaction.objectStore(storeName).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

export async function removePhotosOutsideIdentity(
  identity: AttendancePhotoIdentity | null,
  protectedKey: string | null = null
): Promise<void> {
  if (!identity) {
    await clearAllPendingAttendancePhotos()
    return
  }

  const database = await openRecoveryDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite")
    const request = transaction.objectStore(storeName).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value: unknown = cursor.value
      if (
        !isAttendancePhotoIdentityRecord(value) ||
        !hasSameIdentity(value, identity) ||
        (value as { key?: unknown }).key !== protectedKey
      ) {
        cursor.delete()
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

export function loadPendingAttendanceMetadata(
  identity: AttendancePhotoIdentity
): PendingAttendanceMetadata | null {
  const storage = getLocalStorage()
  const scopedKey = metadataStorageKey(identity)
  const scopedRaw = storage.getItem(scopedKey)
  const scoped = parseMetadata(scopedRaw)
  if (scoped && hasSameIdentity(scoped, identity)) return scoped
  if (scopedRaw !== null) {
    throw new Error("Status operasi tersimpan tidak valid; presensi diblokir.")
  }

  const legacyKey = `${legacyMetadataPrefix}${identity.employeeId}`
  const legacyRaw = storage.getItem(legacyKey)
  const legacy = parseLegacyMetadata(legacyRaw)
  if (legacyRaw !== null && !legacy) {
    throw new Error("Status operasi lama tidak valid; presensi diblokir.")
  }
  if (!legacy) return null
  if (legacy.employeeId !== identity.employeeId) return null

  const migrated: PendingAttendanceMetadata = { ...identity, ...legacy }
  savePendingAttendanceMetadata(migrated)
  storage.removeItem(legacyKey)
  return migrated
}

export function savePendingAttendanceMetadata(
  metadata: PendingAttendanceMetadata
): void {
  getLocalStorage().setItem(
    metadataStorageKey(metadata),
    JSON.stringify(metadata)
  )
}

export function removePendingAttendanceMetadata(
  identity: AttendancePhotoIdentity
): void {
  getLocalStorage().removeItem(metadataStorageKey(identity))
}

export function captureLegacyPendingMetadata(): void {
  if (typeof window === "undefined") return
  const sessionStorage = window.sessionStorage
  const raw = sessionStorage.getItem(legacySessionStorageKey)
  if (!raw) return

  const legacy = parseLegacyMetadata(raw)
  if (!legacy) {
    throw new Error(
      "Status operasi lama tidak valid; identitas tidak dapat diganti."
    )
  }
  if (legacy) {
    getLocalStorage().setItem(
      `${legacyMetadataPrefix}${legacy.employeeId}`,
      JSON.stringify(legacy)
    )
  }
  sessionStorage.removeItem(legacySessionStorageKey)
}

export async function prepareAttendanceIdentityChange(): Promise<void> {
  if (typeof window === "undefined") return
  captureLegacyPendingMetadata()
  window.dispatchEvent(new Event(identityChangeEvent))
  try {
    window.localStorage.setItem(
      identityChangeSignal,
      `${Date.now()}-${Math.random()}`
    )
  } catch (error) {
    await clearAllPendingAttendancePhotos().catch(() => undefined)
    throw error
  }
  await clearAllPendingAttendancePhotos()
}

export function attendanceIdentityChangeSignalKey(): string {
  return identityChangeSignal
}

export function attendanceIdentityChangeEventName(): string {
  return identityChangeEvent
}

export async function removeStaleAttendancePhotos(
  now = Date.now(),
  protectedKey: string | null = null
): Promise<void> {
  const database = await openRecoveryDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite")
    const request = transaction.objectStore(storeName).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const value: unknown = cursor.value
      if (
        typeof value === "object" &&
        value !== null &&
        (value as { key?: unknown }).key !== protectedKey &&
        typeof (value as { savedAt?: unknown }).savedAt === "number" &&
        (value as { savedAt: number }).savedAt < now - staleAfterMs
      ) {
        cursor.delete()
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }).finally(() => database.close())
}

function openRecoveryDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(
      new Error("Penyimpanan pemulihan foto tidak tersedia.")
    )
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error("Penyimpanan pemulihan foto sedang digunakan."))
  })
}

function getLocalStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("Penyimpanan status pemulihan tidak tersedia.")
  }
  return window.localStorage
}

function metadataStorageKey(identity: AttendancePhotoIdentity): string {
  return `${metadataPrefix}${identity.userId}.${identity.tenantId}.${identity.employeeId}`
}

function parseMetadata(raw: string | null): PendingAttendanceMetadata | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isPendingAttendanceMetadata(value) ? value : null
  } catch {
    return null
  }
}

function parseLegacyMetadata(
  raw: string | null
): Omit<PendingAttendanceMetadata, "userId" | "tenantId"> | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const record = value as Record<string, unknown>
    if (
      !isOperationKey(record.key) ||
      !isAttendanceOperation(record.operation) ||
      !Number.isSafeInteger(record.employeeId) ||
      !(record.outletId === null || Number.isSafeInteger(record.outletId))
    ) {
      return null
    }
    return {
      key: record.key,
      operation: record.operation,
      employeeId: record.employeeId as number,
      outletId: record.outletId as number | null,
      savedAt: typeof record.savedAt === "number" ? record.savedAt : Date.now(),
    }
  } catch {
    return null
  }
}

function isPendingAttendanceMetadata(
  value: unknown
): value is PendingAttendanceMetadata {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    isAttendancePhotoIdentityRecord(value) &&
    isOperationKey(record.key) &&
    isAttendanceOperation(record.operation) &&
    (record.outletId === null || Number.isSafeInteger(record.outletId)) &&
    hasValidCheckoutTarget(record) &&
    typeof record.savedAt === "number"
  )
}

function isAttendancePhotoOperation(
  value: unknown
): value is AttendancePhotoOperation {
  if (typeof value !== "object" || value === null) return false
  const operation = value as Record<string, unknown>

  return (
    isAttendancePhotoIdentityRecord(value) &&
    isOperationKey(operation.key) &&
    isAttendanceOperation(operation.operation) &&
    (operation.outletId === null || Number.isSafeInteger(operation.outletId)) &&
    hasValidCheckoutTarget(operation) &&
    ((operation.photoSkipped === true && operation.photo === undefined) ||
      (operation.photoSkipped !== true && typeof operation.photo === "object" &&
        operation.photo !== null && typeof (operation.photo as Blob).arrayBuffer === "function")) &&
    typeof operation.savedAt === "number" &&
    typeof operation.location === "object" &&
    operation.location !== null
  )
}

function hasValidCheckoutTarget(record: Record<string, unknown>): boolean {
  return (
    record.checkoutSessionId === undefined ||
    (record.operation === "check_out" &&
      typeof record.checkoutSessionId === "number" &&
      Number.isSafeInteger(record.checkoutSessionId) &&
      record.checkoutSessionId > 0 &&
      typeof record.outletId === "number" &&
      record.outletId > 0)
  )
}

function isAttendancePhotoIdentityRecord(
  value: unknown
): value is AttendancePhotoIdentity {
  if (typeof value !== "object" || value === null) return false
  const identity = value as Record<string, unknown>
  return [identity.userId, identity.tenantId, identity.employeeId].every(
    (id) => Number.isSafeInteger(id) && Number(id) > 0
  )
}

function isOperationKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  )
}

function isAttendanceOperation(
  value: unknown
): value is "check_in" | "check_out" {
  return value === "check_in" || value === "check_out"
}

function hasSameIdentity(
  left: AttendancePhotoIdentity,
  right: AttendancePhotoIdentity
): boolean {
  return (
    left.userId === right.userId &&
    left.tenantId === right.tenantId &&
    left.employeeId === right.employeeId
  )
}
