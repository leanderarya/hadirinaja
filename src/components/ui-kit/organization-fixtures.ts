/** Synthetic organization structure for UI Kit demonstrations only. */
export const demoOrganization = {
  tenant: { id: 901, name: "Tenant Demo UI Kit" },
  businessUnits: [
    { id: 201, name: "Kopi Kelana" },
    { id: 202, name: "Teh Sejuk" },
  ],
  outlets: [
    {
      id: 301,
      businessUnitId: 201,
      name: "Kopi Kelana Cendana",
    },
    {
      id: 302,
      businessUnitId: 201,
      name: "Kopi Kelana Mawar",
    },
    {
      id: 303,
      businessUnitId: 202,
      name: "Teh Sejuk Cendana",
    },
    {
      id: 304,
      businessUnitId: 202,
      name: "Teh Sejuk Kenanga",
    },
    {
      id: 305,
      businessUnitId: 202,
      name: "Teh Sejuk Mawar",
    },
  ],
} as const

export function demoOutletLabel(
  outlet: (typeof demoOrganization.outlets)[number]
) {
  const businessUnit = demoOrganization.businessUnits.find(
    (unit) => unit.id === outlet.businessUnitId
  )

  return businessUnit ? `${businessUnit.name} · ${outlet.name}` : outlet.name
}
