import { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireOperatorPage } from '@/lib/admin-context'
import { hasOperatorCapability } from '@/lib/permissions'
import Link from 'next/link'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@novastar/shared-ui'
import {
  Mail,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  Download,
} from 'lucide-react'
import { Button } from '@novastar/shared-ui'

export const metadata: Metadata = {
  title: 'Newsletter Subscribers | Admin',
}

export const dynamic = 'force-dynamic'

export default async function NewsletterSubscribersPage() {
  const context = await requireOperatorPage()

  if (!hasOperatorCapability(context.operator.capabilities, 'tenant:read')) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
        <p>You need the <code>tenant:read</code> capability to view this page.</p>
      </div>
    )
  }

  const subscribers = await prisma.newsletterSubscription.findMany({
    where: { isActive: true },
    orderBy: { subscribedAt: 'desc' },
    select: {
      id: true,
      email: true,
      name: true,
      source: true,
      subscribedAt: true,
    },
  })

  const allEmails = subscribers.map((s) => s.email).join('\n')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Newsletter Subscribers</h1>
          <p className="text-muted-foreground mt-1">
            View and copy active newsletter subscribers for manual email campaigns
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(allEmails)
            }}
            className="flex items-center gap-2"
          >
            <Copy className="h-4 w-4" />
            Copy All Emails ({subscribers.length})
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const blob = new Blob([allEmails], { type: 'text/plain' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `newsletter-subscribers-${new Date().toISOString().split('T')[0]}.txt`
              a.click()
              URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Subscribers ({subscribers.length})</CardTitle>
          <CardDescription>
            Click the copy icon next to any email to copy it individually. Use "Copy All Emails" for batch copying.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subscribers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-lg">No active subscribers yet</p>
              <p className="text-sm mt-1">Subscribers will appear here once they sign up on the website</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Subscribed</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((sub) => (
                    <tr key={sub.id} className="border-b border-border/50 hover:bg-accent/50">
                      <td className="p-3 font-mono text-sm">{sub.email}</td>
                      <td className="p-3">{sub.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                          {sub.source}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(sub.subscribedAt).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            await navigator.clipboard.writeText(sub.email)
                          }}
                          aria-label={`Copy ${sub.email}`}
                          title="Copy email"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            Manual Process Notice
          </CardTitle>
        </CardHeader>
        <CardContent className="text-amber-900 space-y-2">
          <p><strong>This is a manual newsletter system.</strong> Emails are collected here for you to copy and use with your preferred email service (Mailchimp, SendGrid, ConvertKit, etc.).</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Copy emails individually or use "Copy All Emails" for batch operations</li>
            <li>Download as a text file for importing into email marketing tools</li>
            <li>No automated sending — you control when and what to send</li>
            <li>Inactive/unsubscribed emails are hidden from this list</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}