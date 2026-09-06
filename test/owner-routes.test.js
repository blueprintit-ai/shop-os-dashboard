// Full role matrix for every route Plan 2 (Tasks 2-13) added on top of Plan
// 1's own matrix in test/server.test.js. Every expected status below was
// verified against the real, current guard code in each of these files
// (not assumed from the task-14 brief's illustrative sketch, which predates
// some of these routes' final shape):
//   src/routes/layout-routes.js     - requireUser only (no owner check):
//                                      GET/PUT both 200 for staff and owner.
//   src/routes/artifacts-routes.js  - GET requireUser (200/200); POST
//                                      /remove requireOwner (403 staff).
//   src/routes/snapshots-routes.js  - requireUser only, both routes 200/200.
//   src/routes/settings-routes.js   - requireOwner for the whole path incl.
//                                      GET, so staff gets 403 even to read.
//   src/routes/assets-routes.js     - requireUser, then canSeeAssets() which
//                                      is owner-or-switches.assetsView; the
//                                      staff fixture user here is created
//                                      with no switches, so 403.
//   src/routes/runs-routes.js       - requireOwner on both GET and POST;
//                                      POST with an empty/bodyless request
//                                      still gets past the guard first and
//                                      only then 400s on the unknown skill
//                                      id (proves guard-before-validation
//                                      ordering, the exact bug class this
//                                      matrix exists to catch).
//   src/routes/users-routes.js      - requireOwner guards the entire
//                                      /api/users prefix, including the new
//                                      Task 13 /api/users/activity route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootAsOwner, requestAs } from "./helpers/boot.js";

// [method, path, body, { anon, staff, owner }]
const MATRIX = [
  ["GET", "/api/layout", undefined, { anon: 401, staff: 200, owner: 200 }],
  ["PUT", "/api/layout", {}, { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/artifacts", undefined, { anon: 401, staff: 200, owner: 200 }],
  ["POST", "/api/artifacts/remove", { file: "sample-report.html" }, { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/snapshots/stats", undefined, { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/snapshots/routines", undefined, { anon: 401, staff: 200, owner: 200 }],
  ["GET", "/api/settings", undefined, { anon: 401, staff: 403, owner: 200 }],
  ["PUT", "/api/settings", {}, { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/assets", undefined, { anon: 401, staff: 403, owner: 200 }],
  ["GET", "/api/runs", undefined, { anon: 401, staff: 403, owner: 200 }],
  // no body -> readJsonBody resolves {}, so `id` is undefined and the route
  // 400s on "unknown-skill" -- but only for owner, who gets past requireOwner
  // first. This is the exact assertion the brief calls out: proof the guard
  // ran before validation, not the other way around.
  ["POST", "/api/runs", undefined, { anon: 401, staff: 403, owner: 400 }],
  ["GET", "/api/users/activity", undefined, { anon: 401, staff: 403, owner: 200 }],
];

test("role matrix for every Plan 2 route (Tasks 2-13)", async () => {
  const { server, jar, cleanup } = await bootAsOwner();
  try {
    for (const [method, path, body, expected] of MATRIX) {
      for (const [role, want] of Object.entries(expected)) {
        const res = await requestAs(server, jar, role, method, path, body);
        assert.equal(res.status, want, `${method} ${path} as ${role}: expected ${want}, got ${res.status}`);
      }
    }
  } finally {
    cleanup();
  }
});

test("GET /api/assets flips to 200 for staff once the assetsView switch is on", async () => {
  // Separate boot with the switch on, to prove the 403 above is really the
  // switch (not, say, a hardcoded owner-only check) -- mirrors the existing
  // coverage in test/assets.test.js but exercised here as part of the same
  // role-matrix pass.
  const { server, jar, cleanup } = await bootAsOwner({ staffSwitches: { assetsView: true } });
  try {
    const res = await requestAs(server, jar, "staff", "GET", "/api/assets");
    assert.equal(res.status, 200);
  } finally {
    cleanup();
  }
});
