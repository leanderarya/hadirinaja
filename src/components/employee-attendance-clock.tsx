import { useEffect, useMemo, useState } from "react"

function resolveClockTimeZone(
  outletTimeZone?: string,
  deviceTimeZone?: string
) {
  if (outletTimeZone) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: outletTimeZone })
      return {
        timeZone: outletTimeZone,
        label: `Zona waktu Outlet · ${outletTimeZone}`,
      }
    } catch {
      // Invalid Outlet zones use the explicitly labeled device-zone fallback.
    }
  }

  if (deviceTimeZone) {
    return {
      timeZone: deviceTimeZone,
      label: `Zona waktu perangkat · ${deviceTimeZone}`,
    }
  }

  return {
    timeZone: "UTC",
    label: "Zona waktu perangkat",
  }
}

function formatClockTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00"

  return `${value("hour")}:${value("minute")}:${value("second")}`
}

export function EmployeeAttendanceClock({
  outletTimeZone,
  showTimeZoneLabel = true,
}: {
  outletTimeZone?: string
  showTimeZoneLabel?: boolean
}) {
  const [now, setNow] = useState<Date | null>(null)
  const [deviceTimeZone, setDeviceTimeZone] = useState<string>()
  const zone = useMemo(
    () => resolveClockTimeZone(outletTimeZone, deviceTimeZone),
    [deviceTimeZone, outletTimeZone]
  )

  useEffect(() => {
    const updateClock = () => {
      if (document.visibilityState !== "hidden") {
        setNow(new Date())
      }
    }
    const refresh = () => {
      if (document.visibilityState === "hidden") return
      setDeviceTimeZone(
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      )
      updateClock()
    }

    refresh()
    const interval = window.setInterval(updateClock, 1000)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [])

  const time =
    now && (outletTimeZone || deviceTimeZone)
      ? formatClockTime(now, zone.timeZone)
      : "--:--:--"

  return (
    <div
      aria-label="Jam digital"
      className="flex flex-col items-center gap-2 text-center"
      role="group"
    >
      <p className="text-caption">Waktu saat ini</p>
      <time
        aria-label={`Waktu saat ini ${time}`}
        className="text-display font-sans font-semibold leading-none tracking-normal tabular-nums"
        dateTime={now?.toISOString()}
        role="timer"
      >
        {time}
      </time>
      {showTimeZoneLabel ? (
        <p className="text-caption text-muted-foreground">{zone.label}</p>
      ) : null}
    </div>
  )
}
