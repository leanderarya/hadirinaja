/** Synthetic organization structure for UI Kit demonstrations only. */
export const demoOrganization = {
  tenant: { id: 901, name: "Tenant Demo UI Kit" },
  businessUnits: [
    { id: 201, name: "Cepat Kopi" },
    { id: 202, name: "Teh Poci" },
  ],
  outlets: [
    {
      id: 301,
      businessUnitId: 201,
      name: "Cepat Kopi Karangawen",
    },
    {
      id: 302,
      businessUnitId: 201,
      name: "Cepat Kopi Kaliceret",
    },
    {
      id: 303,
      businessUnitId: 202,
      name: "Teh Poci Karangawen",
    },
    {
      id: 304,
      businessUnitId: 202,
      name: "Teh Poci Sugihmanik",
    },
    {
      id: 305,
      businessUnitId: 202,
      name: "Teh Poci Kaliceret",
    },
  ],
} as const

export function demoOutletLabel(outlet: (typeof demoOrganization.outlets)[number]) {
  const businessUnit = demoOrganization.businessUnits.find(
    (unit) => unit.id === outlet.businessUnitId,
  )

  return businessUnit ? `${businessUnit.name} · ${outlet.name}` : outlet.name
}
