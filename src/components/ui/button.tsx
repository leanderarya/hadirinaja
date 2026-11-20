import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[12px] border border-transparent font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 [&_svg:not([class*='size-'])]:size-[18px] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-11 px-4",
        icon: "size-11",
        "icon-lg": "size-11",
        "icon-sm": "size-8",
        "icon-xl": "size-11 [&_svg:not([class*='size-'])]:size-5",
        "icon-xs":
          "size-7 rounded-md before:rounded-[calc(var(--radius-md)-1px)] sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-[18px] sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 px-5",
        sm: "h-10 gap-1.5 px-3",
        xl: "h-11 px-4 text-sm [&_svg:not([class*='size-'])]:size-5",
        xs: "h-7 gap-1 rounded-[var(--radius-xs)] px-2 text-[0.6875rem] [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 data-pressed:bg-primary/90",
        destructive:
          "bg-danger-strong text-primary-foreground hover:bg-danger-strong/90 data-pressed:bg-danger-strong/90",
        "destructive-outline":
          "border-destructive/30 bg-destructive-soft text-destructive-foreground hover:border-destructive/50 hover:bg-destructive/10",
        ghost:
          "border-transparent text-foreground hover:bg-accent data-pressed:bg-accent",
        link: "border-transparent underline-offset-4 hover:underline data-pressed:underline",
        outline:
          "border-border bg-surface text-foreground hover:bg-surface-wash data-pressed:bg-surface-wash",
        secondary:
          "bg-brand-50 text-brand-700 hover:bg-brand-100 data-pressed:bg-brand-100",
      },
    },
  }
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    isLoading?: boolean
    loadingText?: React.ReactNode
    nativeButton?: boolean
    render?: React.ReactElement
  }

function hasTextContent(node: React.ReactNode): boolean {
  return React.Children.toArray(node).some((child) => {
    if (typeof child === "string") {
      return child.trim().length > 0
    }

    if (typeof child === "number") {
      return true
    }

    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) {
      return false
    }

    return hasTextContent(child.props.children)
  })
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      disabled,
      isLoading = false,
      loadingText,
      nativeButton: _nativeButton,
      render,
      size,
      type,
      variant,
      ...props
    },
    ref
  ) => {
    const childNodes = React.Children.toArray(children).filter(
      (child) => child !== null && child !== undefined
    )
    const hasTextChild = hasTextContent(children)
    const isIconOnly = !hasTextChild && childNodes.length <= 1

    let content = children
    if (isLoading) {
      if (loadingText !== undefined) {
        content = (
          <>
            <Spinner className="size-4" />
            <span data-slot="button-content">{loadingText}</span>
          </>
        )
      } else if (isIconOnly) {
        content = <Spinner className="size-4" />
      } else {
        content = (
          <>
            <Spinner className="size-4" />
            <span data-slot="button-content">{children}</span>
          </>
        )
      }
    }

    return useRender({
      defaultTagName: "button",
      props: {
        "aria-busy": isLoading || undefined,
        "data-loading": isLoading || undefined,
        "data-slot": "button",
        className: cn(buttonVariants({ className, size, variant })),
        disabled: disabled || isLoading,
        type: type ?? "button",
        ...props,
        children: content,
      },
      ref,
      render,
    })
  }
)

Button.displayName = "Button"

export { Button, buttonVariants }
