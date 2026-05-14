import { NextResponse } from 'next/server'
import { DOMAIN_TEMPLATES, SOURCE_TYPE_CARDS } from '@/lib/ingest/templates'

/**
 * GET /api/admin/domain-templates
 *
 * Returns the static domain templates + source type cards so the UI
 * doesn't have to import server-only files. No auth — these are
 * static metadata, no per-tenant info.
 */
export async function GET() {
  return NextResponse.json({
    domainTemplates: DOMAIN_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      intentTags: t.intentTags,
      taxonomyPreview: t.taxonomy.slice(0, 6).map(x => x.label),
      taxonomyCount: t.taxonomy.length,
    })),
    sourceTypeCards: SOURCE_TYPE_CARDS,
  })
}
