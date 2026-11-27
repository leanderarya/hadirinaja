export function canExportAttendanceCsv(roles: readonly string[]) {
  return roles.includes("owner")
}
