import { NextResponse, type NextRequest } from "next/server";

/**
 * A malformed id in an API URL (`/api/v1/patients/abc`) is a 404, not a 500.
 *
 * Every `[id]` in the API is a Postgres uuid column. Without this, a non-uuid id reached the
 * query, Postgres raised "invalid input syntax for type uuid", and the route rethrew it as a
 * 500. The ledger routes checked ids themselves (`notFoundUnlessUuid`); the 50-odd older
 * handlers didn't (docs/bug-log.md entry 35). One check here covers every route, including
 * ones added later.
 *
 * Translation only, like the route handlers: no auth, no business logic.
 */

// Collections whose next path segment is an `[id]` (src/app/api/v1/<collection>/[id]).
const ID_COLLECTIONS = new Set([
  "alerts",
  "appointments",
  "conditions",
  "fee-schedules",
  "invoices",
  "items",
  "locations",
  "notes",
  "patients",
  "payments",
  "perio-exams",
  "phases",
  "procedure-codes",
  "procedures",
  "providers",
  "treatment-plans",
]);

// Fixed routes that sit where an id would (`/payments/apply-credit`); Next matches these first.
const STATIC_SIBLINGS = new Set(["suggest-location", "apply-credit", "providers", "import-starter"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function proxy(request: NextRequest) {
  const [collection, id] = request.nextUrl.pathname.replace(/^\/api\/v1\//, "").split("/");
  if (id !== undefined && ID_COLLECTIONS.has(collection) && !STATIC_SIBLINGS.has(id) && !UUID.test(decodeURIComponentSafe(id))) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  return NextResponse.next();
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const config = {
  matcher: "/api/v1/:path*",
};
