import { TanStackDevtools } from "@tanstack/react-devtools"
import { ClientOnly, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { Agentation } from "agentation"

import { Toaster } from "@/components/ui/sonner"
import { documentTitle } from "@/lib/document-title"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: ({ matches }) => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "color-scheme",
        content: "light",
      },
      {
        name: "theme-color",
        content: "#F7F7FB",
      },
      {
        title: documentTitle(matches.at(-1)?.pathname ?? "/"),
      },
      {
        name: "description",
        content:
          "HadirinAja membantu organisasi mengelola kehadiran dan operasional karyawan.",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "icon",
        href: "/favicon.ico",
        sizes: "32x32",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>Halaman yang diminta tidak ditemukan.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html className="light" lang="id" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
      </head>
      <body>
        <ClientOnly fallback={null}>{children}</ClientOnly>
        <Toaster />
        {import.meta.env.DEV && <Agentation className="employee-review-feedback" />}
        <TanStackDevtools
          config={{
            position: "bottom-left",
            triggerHidden: true,
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
