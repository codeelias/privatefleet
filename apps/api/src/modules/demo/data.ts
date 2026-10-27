/**
 * Deterministic demo fixtures (docs/12.6b): London-region seeded data for
 * the three scenarios. Synthetic only - no real patient or customer data.
 */
import type { GeoPoint, JobDto, JobPriority } from "@privatefleet/contracts";

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

export interface DemoDriverSeed {
  id: string;
  fullName: string;
  initials: string;
  vehicleId: string;
  vehicleRegistration: string;
  vehicleType: string;
  start: GeoPoint;
}

export interface DemoJobSeed {
  id: string;
  reference: string;
  serviceType: string;
  priority: JobPriority;
  pickupAddress: string;
  pickup: GeoPoint;
  dropoffAddress: string;
  dropoff: GeoPoint;
}

export const DRIVER_SEEDS: DemoDriverSeed[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    fullName: "Sarah Reed",
    initials: "SR",
    vehicleId: "20000000-0000-4000-8000-000000000001",
    vehicleRegistration: "VAN-02",
    vehicleType: "courier_van",
    start: { latitude: 51.515, longitude: -0.132 },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    fullName: "Mo Khan",
    initials: "MK",
    vehicleId: "20000000-0000-4000-8000-000000000002",
    vehicleRegistration: "VAN-04",
    vehicleType: "courier_van",
    start: { latitude: 51.528, longitude: -0.089 },
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    fullName: "Tom Cole",
    initials: "TC",
    vehicleId: "20000000-0000-4000-8000-000000000003",
    vehicleRegistration: "CAR-03",
    vehicleType: "sedan",
    start: { latitude: 51.505, longitude: -0.09 },
  },
];

export const JOB_SEEDS: DemoJobSeed[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    reference: "J-196",
    serviceType: "Pickup",
    priority: "standard",
    pickupAddress: "Kings Cross",
    pickup: { latitude: 51.5308, longitude: -0.1238 },
    dropoffAddress: "Shoreditch",
    dropoff: { latitude: 51.5265, longitude: -0.078 },
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    reference: "J-198",
    serviceType: "Urgent pickup",
    priority: "urgent",
    pickupAddress: "St Thomas' Hospital",
    pickup: { latitude: 51.4989, longitude: -0.118 },
    dropoffAddress: "Westminster",
    dropoff: { latitude: 51.501, longitude: -0.1173 },
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    reference: "J-201",
    serviceType: "Pickup",
    priority: "standard",
    pickupAddress: "Camden",
    pickup: { latitude: 51.539, longitude: -0.1426 },
    dropoffAddress: "Kings Cross",
    dropoff: { latitude: 51.5308, longitude: -0.1238 },
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    reference: "J-202",
    serviceType: "Transfer",
    priority: "standard",
    pickupAddress: "Farringdon",
    pickup: { latitude: 51.5204, longitude: -0.1046 },
    dropoffAddress: "London Bridge",
    dropoff: { latitude: 51.5045, longitude: -0.0865 },
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    reference: "J-205",
    serviceType: "Clinic",
    priority: "standard",
    pickupAddress: "Islington",
    pickup: { latitude: 51.5362, longitude: -0.103 },
    dropoffAddress: "Farringdon",
    dropoff: { latitude: 51.5204, longitude: -0.1046 },
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    reference: "J-208",
    serviceType: "STAT pickup",
    priority: "stat",
    pickupAddress: "Farringdon",
    pickup: { latitude: 51.5204, longitude: -0.1046 },
    dropoffAddress: "St Thomas' Hospital",
    dropoff: { latitude: 51.4989, longitude: -0.118 },
  },
  {
    id: "30000000-0000-4000-8000-000000000007",
    reference: "J-214",
    serviceType: "Pickup",
    priority: "standard",
    pickupAddress: "Camden",
    pickup: { latitude: 51.539, longitude: -0.1426 },
    dropoffAddress: "Islington",
    dropoff: { latitude: 51.5362, longitude: -0.103 },
  },
  {
    id: "30000000-0000-4000-8000-000000000008",
    reference: "J-221",
    serviceType: "Collection",
    priority: "standard",
    pickupAddress: "London Bridge",
    pickup: { latitude: 51.5045, longitude: -0.0865 },
    dropoffAddress: "Westminster",
    dropoff: { latitude: 51.501, longitude: -0.1173 },
  },
];

/** Simulator polylines: a plausible loop per vehicle (docs/09.8). */
export const SIMULATOR_ROUTES: Record<string, GeoPoint[]> = {
  "20000000-0000-4000-8000-000000000001": [
    { latitude: 51.515, longitude: -0.132 },
    { latitude: 51.5204, longitude: -0.1046 },
    { latitude: 51.5265, longitude: -0.078 },
    { latitude: 51.5204, longitude: -0.1046 },
    { latitude: 51.515, longitude: -0.132 },
  ],
  "20000000-0000-4000-8000-000000000002": [
    { latitude: 51.528, longitude: -0.089 },
    { latitude: 51.5045, longitude: -0.0865 },
    { latitude: 51.4989, longitude: -0.118 },
    { latitude: 51.501, longitude: -0.1173 },
    { latitude: 51.528, longitude: -0.089 },
  ],
  "20000000-0000-4000-8000-000000000003": [
    { latitude: 51.505, longitude: -0.09 },
    { latitude: 51.5308, longitude: -0.1238 },
    { latitude: 51.539, longitude: -0.1426 },
    { latitude: 51.5362, longitude: -0.103 },
    { latitude: 51.505, longitude: -0.09 },
  ],
};

export function buildJobDto(seed: DemoJobSeed): JobDto {
  return {
    id: seed.id,
    reference: seed.reference,
    serviceType: seed.serviceType,
    priority: seed.priority,
    status: "unassigned",
    stops: [
      {
        id: `${seed.id.slice(0, 8)}-0000-4000-8000-00000000000a`,
        jobId: seed.id,
        sequenceNo: 1,
        stopType: "pickup",
        address: seed.pickupAddress,
        location: seed.pickup,
        status: "pending",
      },
      {
        id: `${seed.id.slice(0, 8)}-0000-4000-8000-00000000000b`,
        jobId: seed.id,
        sequenceNo: 2,
        stopType: "dropoff",
        address: seed.dropoffAddress,
        location: seed.dropoff,
        status: "pending",
      },
    ],
    version: 1,
  };
}
