import LocationList from '@/components/locations/LocationList'

export const dynamic = 'force-dynamic'

/**
 * Agency-facing per-location widget control. Auth is enforced by the
 * portal layout (redirects to /portal/login without a session); the
 * API routes re-check the session on every call.
 */
export default function PortalLocationsPage() {
  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn the chat widget on or off for each of your locations.
        </p>
      </div>
      <LocationList apiBase="/api/portal/locations" canManage />
    </div>
  )
}
