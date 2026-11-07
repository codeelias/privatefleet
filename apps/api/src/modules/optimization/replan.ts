/**
 * Mid-day re-plan (docs/54 R9): compose the existing, independently tested
 * pieces - plan the driver's remaining open stops from their live position,
 * then publish atomically. Publishing uses the one-active-plan invariant
 * (docs/53): the new version supersedes the driver's older plans and the
 * driver feed serves it immediately. Nothing here modifies the publish path.
 */
import type { DbHandle } from "../../db/client.js";
import type { RoutingClients } from "../routing/types.js";
import { approveProposal, createProposal } from "./service.js";

export interface ReplanResult {
  runId: string;
  routeId: string;
  version: number;
  publishedAt: string;
  distanceMetres: number;
  durationSeconds: number;
  stopCount: number;
}

export async function replanForDriver(
  handle: DbHandle,
  clients: RoutingClients,
  tenantId: string,
  driverId: string,
): Promise<ReplanResult> {
  const proposal = await createProposal(handle, clients, tenantId, driverId);
  const approved = await approveProposal(handle, tenantId, proposal.runId);
  return {
    runId: proposal.runId,
    routeId: approved.routeId,
    version: approved.version,
    publishedAt: approved.publishedAt,
    distanceMetres: proposal.proposal.distanceMetres,
    durationSeconds: proposal.proposal.durationSeconds,
    stopCount: proposal.proposal.stops.length,
  };
}
