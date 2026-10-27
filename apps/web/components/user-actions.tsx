"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantUserSummary } from "@/types/admin";
import { UserForm } from "@/components/user-form";

export function UserActions({
  user,
  tenantId,
  schools,
}: {
  user: TenantUserSummary;
  tenantId: string;
  schools: readonly { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (editing) {
    return (
      <div className="space-y-2 text-left">
        <UserForm
          tenantId={tenantId}
          userId={user.id}
          initial={{
            name: user.name,
            email: user.email,
            roleName: user.roleName,
            schoolId: user.schoolId,
            isActive: user.isActive,
          }}
          schools={schools}
          onSuccess={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
        >
          Edit
        </button>
        <form
          action={async () => {
            if (pending) return;
            const action = user.isActive ? "deactivate" : "reactivate";
            if (
              !confirm(
                `${action === "deactivate" ? "Deactivate" : "Reactivate"} user "${user.email}"?`,
              )
            )
              return;
            const endpoint = `/admin/api/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(user.id)}`;
            setPending(true);
            setError(null);
            try {
              const response = await fetch(
                endpoint,
                user.isActive
                  ? { method: "DELETE" }
                  : {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isActive: true }),
                    },
              );
              if (!response.ok) {
                const body: unknown = await response.json().catch(() => null);
                setError(
                  typeof body === "object" &&
                    body !== null &&
                    "error" in body &&
                    typeof body.error === "string"
                    ? body.error
                    : "The account status was not changed.",
                );
                return;
              }
              router.refresh();
            } catch {
              setError(
                "Could not reach the server. Refresh the account before retrying.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <button
            type="submit"
            disabled={pending}
            className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
          >
            {pending ? "Saving…" : user.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
