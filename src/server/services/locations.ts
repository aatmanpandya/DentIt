import { eq, and, asc } from "drizzle-orm";
import { dbForRequest } from "@/server/db/tenant";
import { locations, operatories, users, providerProfiles, providerSchedules } from "@/server/db/schema";
import type { RequestActor } from "@/server/lib/request-auth";

export class LocationNotFoundError extends Error {
  constructor() {
    // 404, never 403, for cross-tenant access — see docs/specs/validation-and-errors.md.
    super("Location not found.");
    this.name = "LocationNotFoundError";
  }
}

export class ProviderNotFoundError extends Error {
  constructor() {
    super("Provider not found.");
    this.name = "ProviderNotFoundError";
  }
}

/**
 * Locations, operatories, and providers are structural reference data every role needs
 * to read in order to book an appointment — there is no RBAC resource for them in
 * pilot-foundations.md §4 ("org_settings" is owner-only and would wrongly lock out
 * front desk/clinical roles from seeing where they can even book). These three readers
 * are gated on authentication only, the same tier procedure_codes reads sit at.
 */
export async function listLocations(actor: RequestActor) {
  return dbForRequest(actor.organizationId, async (tx) => {
    return tx
      .select()
      .from(locations)
      .where(and(eq(locations.organizationId, actor.organizationId), eq(locations.isActive, true)))
      .orderBy(asc(locations.name));
  });
}

export async function listOperatories(actor: RequestActor, locationId: string) {
  return dbForRequest(actor.organizationId, async (tx) => {
    const [location] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.organizationId, actor.organizationId)))
      .limit(1);
    if (!location) throw new LocationNotFoundError();

    return tx
      .select()
      .from(operatories)
      .where(
        and(
          eq(operatories.locationId, locationId),
          eq(operatories.organizationId, actor.organizationId),
          eq(operatories.isActive, true),
        ),
      )
      .orderBy(asc(operatories.displayOrder));
  });
}

/**
 * "Bookable as a provider" is signalled by having a provider_profiles row, not by
 * users.role — a solo-dentist owner (the common case for a small pilot clinic) is
 * still the person being booked into the chair, and role='owner' would wrongly exclude
 * them from this list if filtered by role instead. Confirmed against the demo org's
 * own seed data: Dr Ananya Rao is role='owner' with a provider_profiles row and is the
 * provider on real seeded appointments.
 */
export async function listProviders(actor: RequestActor) {
  return dbForRequest(actor.organizationId, async (tx) => {
    return tx
      .select({
        id: users.id,
        fullName: users.fullName,
        role: users.role,
        color: providerProfiles.color,
        defaultOperatoryId: providerProfiles.defaultOperatoryId,
        qualification: providerProfiles.qualification,
      })
      .from(users)
      .innerJoin(providerProfiles, eq(providerProfiles.userId, users.id))
      .where(and(eq(users.organizationId, actor.organizationId), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
  });
}

/**
 * Read-only for the pilot — there's no schedule-management UI yet (only seed data and
 * direct DB writes populate provider_schedules), so this doesn't resolve
 * effective_from/effective_to versioning the way checkWarnings in appointments.ts does
 * for actual booking validation. It exists so the day/week grid can size itself to a
 * provider's real hours instead of a hardcoded 8am-8pm range — a display concern, not a
 * business-rule check, so returning every row for the provider (optionally narrowed to
 * one location) and letting the client pick by day-of-week is enough for that job.
 */
export async function listProviderSchedule(actor: RequestActor, providerId: string, locationId?: string) {
  return dbForRequest(actor.organizationId, async (tx) => {
    const [provider] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, providerId), eq(users.organizationId, actor.organizationId)))
      .limit(1);
    if (!provider) throw new ProviderNotFoundError();

    const conditions = [
      eq(providerSchedules.organizationId, actor.organizationId),
      eq(providerSchedules.providerId, providerId),
    ];
    if (locationId) conditions.push(eq(providerSchedules.locationId, locationId));

    return tx
      .select()
      .from(providerSchedules)
      .where(and(...conditions))
      .orderBy(asc(providerSchedules.dayOfWeek));
  });
}
