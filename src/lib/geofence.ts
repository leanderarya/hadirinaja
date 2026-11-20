export type Coordinates = { latitude: number; longitude: number }
export type LocationEvidence = {
  status: "provided" | "unavailable" | "permission_denied"
  latitude?: number
  longitude?: number
  accuracy_meters?: number
}

export function validCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
  )
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180
  const deltaLat = (b.latitude - a.latitude) * radians
  const deltaLon = (b.longitude - a.longitude) * radians
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(deltaLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function locationEligibility(
  outlet: {
    latitude?: number | null
    longitude?: number | null
    radius_meters: number | null
    required: boolean
  },
  location: LocationEvidence | null
): { eligible: boolean; message: string } {
  if (!outlet.required)
    return { eligible: true, message: "Validasi lokasi tidak diwajibkan." }
  if (
    outlet.latitude == null ||
    outlet.longitude == null ||
    !validCoordinates({
      latitude: outlet.latitude,
      longitude: outlet.longitude,
    }) ||
    outlet.radius_meters == null ||
    !Number.isFinite(outlet.radius_meters) ||
    outlet.radius_meters < 25 ||
    outlet.radius_meters > 5000
  ) {
    return {
      eligible: false,
      message:
        "Titik atau radius Outlet belum valid. Hubungi pengelola sebelum melakukan presensi personal.",
    }
  }
  if (location?.status === "permission_denied")
    return {
      eligible: false,
      message:
        "Izin lokasi ditolak. Aktifkan izin lokasi di browser, lalu perbarui lokasi.",
    }
  if (location?.status !== "provided")
    return {
      eligible: false,
      message:
        "Lokasi Anda belum tersedia. Perbarui lokasi untuk memeriksa kelayakan presensi.",
    }
  if (
    location.latitude == null ||
    location.longitude == null ||
    !validCoordinates({
      latitude: location.latitude,
      longitude: location.longitude,
    }) ||
    location.accuracy_meters == null ||
    !Number.isFinite(location.accuracy_meters) ||
    location.accuracy_meters <= 0 ||
    location.accuracy_meters > 50000
  ) {
    return {
      eligible: false,
      message: "Data lokasi tidak valid. Perbarui lokasi lalu coba kembali.",
    }
  }
  if (location.accuracy_meters > outlet.radius_meters)
    return {
      eligible: false,
      message: `Akurasi lokasi ±${Math.ceil(location.accuracy_meters)} m belum memadai. Maksimum ${outlet.radius_meters} m; perbarui lokasi di tempat terbuka.`,
    }
  const distance = distanceMeters(
    { latitude: outlet.latitude, longitude: outlet.longitude },
    { latitude: location.latitude, longitude: location.longitude }
  )
  if (distance - outlet.radius_meters > 0.0000001)
    return {
      eligible: false,
      message: `Lokasi Anda di luar radius ${outlet.radius_meters} m (jarak sekitar ${Math.ceil(distance)} m). Presensi ditolak.`,
    }
  return {
    eligible: true,
    message: `Lokasi berada dalam radius ${outlet.radius_meters} m. Akurasi ±${Math.ceil(location.accuracy_meters)} m. Lokasi akan diperiksa kembali saat mengirim presensi.`,
  }
}
