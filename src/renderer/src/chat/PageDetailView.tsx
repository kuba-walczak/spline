import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ContextPageView } from './ProjectDetailView'
import type { ProjectDetail } from './ProjectDetailView'

/* One page opened from the Pages section rather than from inside a project.

   A page is the same thing wherever it is reached from, so this is the project panel's own context
   view with the project crumb left off — the reading and the editing are already there, and a page
   that belongs to no project has nothing to put in that crumb. */
export function PageDetailView({
  pageId,
  onBack,
  onSaved
}: {
  pageId: string
  onBack: () => void
  onSaved: () => void
}): ReactElement {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  function load(): void {
    setLoading(true)
    setError(false)
    window.api
      .getProjectDetail(pageId)
      .then(setDetail)
      .catch((err) => {
        console.error('[pages] getProjectDetail failed:', err)
        setError(true)
      })
      .finally(() => setLoading(false))
  }

  /* Re-read on the id rather than once: the sidebar swaps pages without unmounting this. */
  useEffect(load, [pageId])

  return (
    <ContextPageView
      rootLabel="Pages"
      projectTitle={null}
      detail={detail}
      loading={loading}
      error={error}
      onBackToProjects={onBack}
      onBackToProject={onBack}
      onSave={async (title, text) => {
        if (title !== (detail?.title ?? '')) await window.api.renameContextPage(pageId, title)
        await window.api.updateContextPageContent(pageId, text)
        load()
        /* The sidebar holds the title too, so a rename has to reach the list behind this view. */
        onSaved()
      }}
    />
  )
}

export default PageDetailView
