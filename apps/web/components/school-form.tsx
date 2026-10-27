"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@novastar/shared-ui";

type SchoolFormData = {
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  established: string;
  motto: string | null | undefined;
  logoUrl: string | null | undefined;
};

const emptyForm: SchoolFormData = {
  name: "",
  code: "",
  address: "",
  phone: "",
  email: "",
  established: new Date().toISOString().split("T")[0],
  motto: "",
  logoUrl: "",
};

export function SchoolForm({
  tenantId,
  editId,
  initial,
  onSuccess,
}: {
  tenantId: string;
  editId?: string;
  initial?: Partial<SchoolFormData>;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [form, setForm] = useState<SchoolFormData>({
    ...emptyForm,
    ...initial,
    established: (initial?.established ?? emptyForm.established).slice(0, 10),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(editId);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const url = isEditing
        ? `/admin/api/tenants/${encodeURIComponent(tenantId)}/schools/${encodeURIComponent(editId!)}`
        : `/admin/api/tenants/${encodeURIComponent(tenantId)}/schools`;
      const method = isEditing ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        name: form.name,
        code: form.code,
        address: form.address,
        phone: form.phone,
        email: form.email,
        established: form.established,
        motto: (form.motto ?? "").length > 0 ? form.motto : null,
        logoUrl: (form.logoUrl ?? "").length > 0 ? form.logoUrl : null,
      };

      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const parsed: unknown = await response.json().catch(() => null);
      const body_ = (parsed ?? {}) as { error?: string };

      if (!response.ok) {
        setError(body_.error ?? "Operation failed.");
        return;
      }

      onSuccess?.();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void submit();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={formId + "-name"} className="text-xs font-medium">
            Name
          </label>
          <input
            id={formId + "-name"}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label htmlFor={formId + "-code"} className="text-xs font-medium">
            Code
          </label>
          <input
            id={formId + "-code"}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={formId + "-email"} className="text-xs font-medium">
            Email
          </label>
          <input
            id={formId + "-email"}
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label htmlFor={formId + "-phone"} className="text-xs font-medium">
            Phone
          </label>
          <input
            id={formId + "-phone"}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
      </div>
      <div>
        <label htmlFor={formId + "-address"} className="text-xs font-medium">
          Address
        </label>
        <input
          id={formId + "-address"}
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={formId + "-established"}
            className="text-xs font-medium"
          >
            Established
          </label>
          <input
            id={formId + "-established"}
            type="date"
            value={form.established}
            onChange={(e) => setForm({ ...form, established: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label htmlFor={formId + "-motto"} className="text-xs font-medium">
            Motto (optional)
          </label>
          <input
            id={formId + "-motto"}
            value={form.motto ?? ""}
            onChange={(e) => setForm({ ...form, motto: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div>
        <label htmlFor={formId + "-logo"} className="text-xs font-medium">
          Logo URL (optional)
        </label>
        <input
          id={formId + "-logo"}
          value={form.logoUrl ?? ""}
          onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={
            pending ||
            !form.name ||
            !form.code ||
            !form.email ||
            !form.phone ||
            !form.address ||
            !form.established
          }
          className="h-9"
        >
          {pending
            ? isEditing
              ? "Saving…"
              : "Creating…"
            : isEditing
              ? "Save changes"
              : "Create school"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSuccess?.()}
          className="h-9"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
