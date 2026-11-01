# VROOM 1.15 deployment pin

## Image

```text
ghcr.io/vroom-project/vroom-docker:v1.15.0
ghcr.io/vroom-project/vroom-docker@sha256:247d5683d6745c755d718a156d16b16aac80baccc276a003a68b986c13883b08
```

Pinned by digest on the LAN host. Container `privatefleet-vroom`,
network `privatefleet-routing`, port `127.0.0.1:3000`, OSRM URL unchanged.

Rollback container: `privatefleet-vroom-rc2` (v1.14.0-rc.2, stopped).

## Verified

- Direct solver test: a 500 km route with a 200 km vehicle limit is left
  unassigned.
- Original 30-shipment / 60-visit regression:
  - Mo Khan 134.0 km / 38 visits / 18,476 s
  - Sarah Reed 77.4 km / 22 visits / 10,966 s
  - 211.4 km total, 0 unassigned, publish gate allowed.
- Approved as route version 114; all 30 jobs assigned.

## Rollback

```powershell
docker rm -f privatefleet-vroom
docker rename privatefleet-vroom-rc2 privatefleet-vroom
docker start privatefleet-vroom
```

Then restart the API process and re-run a proposal; cached results are
invalidated by the fleet result-schema version.
