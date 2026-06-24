import ApiAccessClient from './ApiAccessClient'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function ApiAccessPage({ params }: Props) {
  const { workspaceId } = await params
  return <ApiAccessClient workspaceId={workspaceId} />
}
