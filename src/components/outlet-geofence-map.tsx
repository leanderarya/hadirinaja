import type * as Leaflet from "leaflet"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerIconRetina from "leaflet/dist/images/marker-icon-2x.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { useEffect, useRef, useState } from "react"
import "leaflet/dist/leaflet.css"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { type Coordinates, validCoordinates } from "@/lib/geofence"

type Props = {
  latitude: number | null
  longitude: number | null
  radiusMeters: number | null
  outletName: string
  onChange?: (point: Coordinates) => void
  position?: (Coordinates & { accuracy_meters: number }) | null
  onLocate?: () => void
  locating?: boolean
}

export function OutletGeofenceMap({
  latitude,
  longitude,
  radiusMeters,
  outletName,
  onChange,
  position,
  onLocate,
  locating,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const engine = useRef<{
    L: typeof Leaflet
    map: Leaflet.Map
    layers: Leaflet.LayerGroup
  } | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    void import("leaflet")
      .then((L) => {
        if (cancelled || !container.current) return
        const map = L.map(container.current, {
          scrollWheelZoom: false,
        }).setView([-2.5, 118], 4)
        engine.current = { L, map, layers: L.layerGroup().addTo(map) }
        const defaultTiles = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        const tileUrl = import.meta.env.VITE_MAP_TILE_URL || defaultTiles
        const attribution =
          import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
          (tileUrl === defaultTiles
            ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            : "")
        if (!attribution) {
          setError(
            "Attribution penyedia peta belum dikonfigurasi. Hubungi pengelola."
          )
        } else {
          L.tileLayer(tileUrl, { maxZoom: 19, attribution })
            .addTo(map)
            .on("tileerror", () => {
              if (!cancelled)
                setError(
                  "Peta dasar belum dapat dimuat. Periksa koneksi; koordinat dan radius tetap dapat diperiksa."
                )
            })
        }
        map.on("click", (event: Leaflet.LeafletMouseEvent) => {
          change.current?.({
            latitude: Number(event.latlng.lat.toFixed(7)),
            longitude: Number(event.latlng.wrap().lng.toFixed(7)),
          })
        })
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() =>
            map.invalidateSize({ pan: false })
          )
          observer.observe(container.current)
        }
        setReady(true)
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Peta belum dapat dibuka. Muat ulang halaman untuk mencoba kembali."
          )
      })
    return () => {
      cancelled = true
      observer?.disconnect()
      engine.current?.map.remove()
      engine.current = null
    }
  }, [])

  const editable = Boolean(onChange)
  const positionLat = position?.latitude
  const positionLon = position?.longitude
  const accuracy = position?.accuracy_meters
  useEffect(() => {
    const current = engine.current
    if (!ready || !current) return
    const { L, map, layers } = current
    layers.clearLayers()
    const palette = getComputedStyle(map.getContainer())
    const primary = palette.getPropertyValue("--primary").trim()
    const info = palette.getPropertyValue("--info").trim()
    const background = palette.getPropertyValue("--background").trim()
    let bounds: Leaflet.LatLngBounds | null = null
    if (
      latitude != null &&
      longitude != null &&
      validCoordinates({ latitude, longitude })
    ) {
      const point: Leaflet.LatLngTuple = [latitude, longitude]
      const label = document.createElement("span")
      label.textContent = outletName
      const marker = L.marker(point, {
        draggable: editable,
        alt: `Titik Outlet ${outletName}`,
        title: editable
          ? "Geser titik Outlet atau isi koordinat di bawah peta"
          : `Outlet ${outletName}`,
        icon: L.icon({
          iconUrl: markerIcon,
          iconRetinaUrl: markerIconRetina,
          shadowUrl: markerShadow,
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          shadowSize: [41, 41],
        }),
      })
        .bindTooltip(label)
        .addTo(layers)
      marker.on("dragend", () => {
        const point = marker.getLatLng().wrap()
        change.current?.({
          latitude: Number(point.lat.toFixed(7)),
          longitude: Number(point.lng.toFixed(7)),
        })
      })
      if (
        radiusMeters != null &&
        Number.isFinite(radiusMeters) &&
        radiusMeters >= 50 &&
        radiusMeters <= 5000
      ) {
        const coverage = L.circle(point, {
          radius: radiusMeters,
          color: primary,
          fillOpacity: 0.12,
          weight: 2,
        }).addTo(layers)
        bounds = coverage.getBounds()
        marker.on("drag", () => coverage.setLatLng(marker.getLatLng()))
      } else {
        map.setView(point, 16)
      }
    }
    if (
      positionLat != null &&
      positionLon != null &&
      validCoordinates({ latitude: positionLat, longitude: positionLon })
    ) {
      const point: Leaflet.LatLngTuple = [positionLat, positionLon]
      L.circleMarker(point, {
        radius: 7,
        color: background,
        fillColor: info,
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip("Lokasi Anda")
        .addTo(layers)
      if (
        accuracy != null &&
        Number.isFinite(accuracy) &&
        accuracy > 0 &&
        accuracy <= 50000
      )
        L.circle(point, {
          radius: accuracy,
          color: info,
          fillOpacity: 0.05,
          weight: 1,
        }).addTo(layers)
      bounds = bounds ? bounds.extend(point) : L.latLngBounds([point, point])
    }
    if (bounds)
      map.fitBounds(bounds, { padding: [25, 25], maxZoom: 18, animate: false })
  }, [
    ready,
    latitude,
    longitude,
    radiusMeters,
    outletName,
    editable,
    positionLat,
    positionLon,
    accuracy,
  ])

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={container}
        className="outlet-geofence-map"
        role="region"
        aria-label={`Peta batas lokasi ${outletName}`}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Peta belum lengkap</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-caption text-muted-foreground">
        {editable
          ? "Klik peta untuk memilih titik, lalu geser marker Outlet. Koordinat juga dapat diisi di bawah peta. Perubahan berlaku setelah disimpan."
          : "Marker menunjukkan Outlet, lingkaran ungu menunjukkan batas presensi. Titik biru dan lingkaran biru menunjukkan lokasi serta akurasi Anda setelah lokasi diperbarui."}
      </p>
      {onLocate ? (
        <Button
          type="button"
          variant="outline"
          disabled={locating}
          onClick={onLocate}
        >
          {locating ? "Mendapatkan lokasi…" : "Perbarui lokasi saya"}
        </Button>
      ) : null}
    </div>
  )
}
