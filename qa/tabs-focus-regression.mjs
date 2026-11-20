export async function verifyPanelFocus(page, trigger) {
  const read = () => page.evaluate(() => {
    const element = document.activeElement
    const style = getComputedStyle(element)
    return {
      role: element.getAttribute("role"),
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      forcedColors: matchMedia("(forced-colors: active)").matches,
    }
  })
  const requireOutline = (state) => {
    if (state.role !== "tabpanel" || !state.focusVisible || state.outlineStyle === "none" || state.outlineWidth < 2 || state.outlineColor === "transparent") {
      throw new Error(`Tab panel focus is not visible: ${JSON.stringify(state)}`)
    }
  }
  await page.press(trigger, "Tab")
  const normal = await read()
  requireOutline(normal)
  await page.keyboard.press("Shift+Tab")
  if (await page.evaluate(() => document.activeElement.getAttribute("role")) !== "tab") {
    throw new Error("Shift+Tab did not return to the tab trigger.")
  }
  try {
    await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] })
    await page.press(trigger, "Tab")
    const forced = await read()
    requireOutline(forced)
    if (!forced.forcedColors) throw new Error("Forced colors were not active.")
    return { normal, forced }
  } finally {
    await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] })
  }
}

export async function verifyPointerPanelFocus(page, panel) {
  await page.click(panel)
  const result = await page.evaluate(() => {
    const element = document.activeElement
    return { role: element.getAttribute("role"), focusVisible: element.matches(":focus-visible"), outlineStyle: getComputedStyle(element).outlineStyle }
  })
  if (result.role !== "tabpanel" || result.focusVisible || result.outlineStyle !== "none") {
    throw new Error(`Unexpected pointer focus state: ${JSON.stringify(result)}`)
  }
  return result
}
