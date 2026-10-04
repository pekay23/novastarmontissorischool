# @novastar/notifications

Email, push, and in-app notification primitives.

## Email Sending Address Configuration

The `sendEmail` function resolves the `from` address in this order:

1. **Per-send override** — `options.from` passed to the call
2. **Environment variable** — `MAIL_FROM`
3. **Documented fallback** — `DEFAULT_FROM` constant (`Novastar Montessori <noreply@novastarmontessori.com>`)

### Two Real Deployment Shapes

#### Verified Domain (Production)

1. Add and verify your domain in Resend (or your email provider).
2. Publish the DNS records the provider generates.
3. Set `MAIL_FROM` to an address on that verified domain, including the display name:

   ```
   MAIL_FROM="Novastar Montessori <noreply@your-verified-domain.example>"
   ```

#### Resend Sandbox (Testing Only)

With no verified domain, Resend only delivers to the **account's own email address**. The canonical sender for this mode is:

```
MAIL_FROM="onboarding@resend.dev"
```

**This is a testing path for one address, not a delivery system.** Every other recipient will be rejected by the provider.

> **Important:** The fallback constant uses `novastarmontessori.com`, a domain this project does not own. It will be refused by any provider until that domain is verified. Do not rely on the fallback for real deployments — set `MAIL_FROM` explicitly.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Yes | Resend API key. Without it, `sendEmail` throws `EmailDeliveryError('not-configured')`. |
| `MAIL_FROM` | No | Full RFC 5322 address with display name. Falls back to a placeholder that cannot deliver. |

## Testing

Run the package tests:

```bash
bun run test --filter @novastar/notifications
```

Type-check:

```bash
bun run typecheck --filter @novastar/notifications
```

Lint:

```bash
bun run lint --filter @novastar/notifications
```