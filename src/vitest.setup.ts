type JsdomTestGlobal = typeof globalThis & {
  jsdom?: { window: Window }
}

const testGlobal = globalThis as JsdomTestGlobal

if (typeof window !== "undefined" && testGlobal.jsdom) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: testGlobal.jsdom.window.localStorage,
  })
}
