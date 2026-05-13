import Sidebar from '@/components/layout/Sidebar'

export const dynamic = 'force-dynamic'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
