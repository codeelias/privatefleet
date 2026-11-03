/**
 * OS Net surveyed reference stations, verified 2026-11-03 against the
 * official ordnancesurvey.co.uk coordinates file (ECEF match < 1 mm).
 * ETRS89 ≈ WGS84 at this scale. STRA (Stratford) is the primary London base.
 */
export interface OsNetStation {
  id: string;
  name: string;
  ecef: [number, number, number];
  latitude: number;
  longitude: number;
  heightM: number;
  distanceToCentralLondonKm: number;
}

export const OS_NET_STATIONS: OsNetStation[] = [
  {
    id: "STRA00GBR",
    name: "Stratford",
    ecef: [3974813.040, 661.049, 4971513.615],
    latitude: 51.54461,
    longitude: 0.009529,
    heightM: 80.44,
    distanceToCentralLondonKm: 10.4,
  },
  {
    id: "TEDD00GBR",
    name: "Teddington",
    ecef: [3985122.637, -23895.149, 4963238.29],
    latitude: 51.425285,
    longitude: -0.343546,
    heightM: 70.03,
    distanceToCentralLondonKm: 17.5,
  },
  {
    id: "AMER00GBR",
    name: "Amersham",
    ecef: [3963095.146, -38691.298, 4980716.394],
    latitude: 51.677194,
    longitude: -0.559355,
    heightM: 134.14,
    distanceToCentralLondonKm: 35.3,
  },
];
