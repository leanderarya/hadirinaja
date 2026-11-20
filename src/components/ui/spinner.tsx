import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type * as React from "react"
import { cn } from "@/lib/utils"

type SpinnerProps = Omit<React.ComponentProps<"svg">, "strokeWidth"> & {
  strokeWidth?: number
}

function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={2}
      data-slot="spinner"
      role="status"
      aria-label="Memuat"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
