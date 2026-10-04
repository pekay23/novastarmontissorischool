/**
 * The toast store: the one piece of shared-ui that is state rather than markup.
 *
 * The rest of this package is presentational — a `<div>` with classes on it —
 * and this file deliberately does not pretend otherwise. What is worth pinning
 * is the behaviour that is easy to break silently and invisible in review:
 *
 * - A toast that never goes away, or one that vanishes before anyone read it.
 * - `duration: 0` meaning "stay until dismissed" rather than "disappear
 *   immediately". Both readings are defensible from the type alone
 *   (`number | undefined`), so only a test decides which one ships.
 * - The four shorthand helpers (`success`, `error`, `warning`, `info`) drifting
 *   from the variants they claim to select. A `toast.error` that renders in
 *   green is a bug nobody sees until a failure is reported as a success.
 * - The close button and the action button: the action must fire *and* remove
 *   the toast, and it must not bubble into the close button that sits beside it.
 *
 * A known gap is NOT asserted here: this Toaster renders no live region, so a
 * toast raised through `useToast` is not announced. `toast.tsx`'s `ToastViewport`
 * does declare one, but nothing renders it. Asserting the absence would enshrine
 * the defect; it is reported instead.
 */
import { afterEach, describe, expect, jest, test } from "bun:test";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import * as React from "react";
import { PortalToastProvider, useToast } from "../src/components/use-toast";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/** Renders `useToast` inside the provider, so the hook can be called legally. */
function renderToast() {
  return renderHook(() => useToast(), {
    wrapper: ({ children }) => <PortalToastProvider>{children}</PortalToastProvider>,
  });
}

/** Renders a consumer that fires one toast on mount, then hands back the DOM. */
function renderOne(props: Parameters<ReturnType<typeof useToast>["toast"]>[0]) {
  function Trigger() {
    const { toast } = useToast();
    React.useEffect(() => {
      toast(props);
    }, []);
    return null;
  }
  return render(
    <PortalToastProvider>
      <Trigger />
    </PortalToastProvider>,
  );
}

/** How many toasts are on screen. The container is the only fixed-position node. */
const onScreen = (): number => document.querySelectorAll(".max-w-sm").length;

describe("useToast outside a provider", () => {
  test("throws, and names the provider it wanted", () => {
    // React logs the thrown error itself; the assertion is the point, not the log.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("rendering a toast", () => {
  test("shows the title and description it was given", () => {
    renderOne({ title: "Saved", description: "The gradebook is up to date" });
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("The gradebook is up to date")).toBeTruthy();
  });

  test("renders nothing at all until a toast is raised", () => {
    render(
      <PortalToastProvider>
        <span>page content</span>
      </PortalToastProvider>,
    );
    expect(onScreen()).toBe(0);
    expect(screen.getByText("page content")).toBeTruthy();
  });

  test("a toast with neither title nor description still occupies the corner", () => {
    // Otherwise a bare `toast()` would be invisible, which is the opposite of
    // what a caller who asked for a toast asked for.
    renderOne({});
    expect(onScreen()).toBe(1);
  });

  test("several toasts render at once, in the order they were raised", () => {
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "first" });
        toast({ title: "second" });
        toast({ title: "third" });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );
    const titles = screen.getAllByText(/first|second|third/).map((n) => n.textContent);
    expect(titles).toEqual(["first", "second", "third"]);
  });
});

describe("variants", () => {
  /**
   * Pinned by the class each variant puts on the element, because that class is
   * the only thing distinguishing a success from a failure for someone who
   * cannot see the toast at all.
   */
  test.each([
    ["success", "bg-green-50"],
    ["error", "bg-destructive"],
    ["warning", "bg-amber-50"],
    ["info", "bg-blue-50"],
  ] as const)("toast.%s renders %s", (helper, expected) => {
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast[helper]({ title: "x" });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );
    const el = document.querySelector(".max-w-sm");
    expect(el?.className).toContain(expected);
  });

  test("a bare toast() takes the default variant, not a shorthand's", () => {
    renderOne({ title: "plain" });
    const el = document.querySelector(".max-w-sm");
    expect(el?.className).toContain("bg-background");
  });
});

describe("dismissal", () => {
  test("the close button removes its own toast and no other", () => {
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "keep" });
        toast({ title: "dismiss" });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );

    const buttons = Array.from(document.querySelectorAll("button"));
    // Each toast renders [action?] + close, so with no actions the two close
    // buttons are in document order: the first belongs to the first toast.
    const closes = buttons.filter((b) => b.querySelector("svg"));
    expect(closes).toHaveLength(2);
    act(() => {
      closes[0]!.click();
    });

    expect(onScreen()).toBe(1);
    expect(screen.queryByText("keep")).toBeNull();
    expect(screen.queryByText("dismiss")).toBeTruthy();
  });

  test("the action fires and takes its toast with it", () => {
    let fired = 0;
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({
          title: "undo",
          action: {
            label: "Undo",
            onClick: () => {
              fired += 1;
            },
          },
        });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );

    act(() => {
      screen.getByText("Undo").click();
    });

    expect(fired).toBe(1);
    expect(onScreen()).toBe(0);
  });
});

describe("the auto-dismiss timer", () => {
  test("a toast with an explicit duration goes away once it elapses", () => {
    jest.useFakeTimers();
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "brief", duration: 1000 });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );
    expect(onScreen()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onScreen()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onScreen()).toBe(0);
  });

  test("the default duration is 5000ms, so a toast outlives a glance", () => {
    jest.useFakeTimers();
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "default" });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );

    act(() => {
      jest.advanceTimersByTime(4999);
    });
    expect(onScreen()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onScreen()).toBe(0);
  });

  /**
   * `duration: 0` means "stay until dismissed". The guard is `if (duration > 0)`,
   * so a naive reading of "0ms delay" would delete the toast on the next tick and
   * a form error would vanish before it could be read.
   */
  test("duration 0 never auto-dismisses", () => {
    jest.useFakeTimers();
    renderOne({ title: "sticky", duration: 0 });

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(onScreen()).toBe(1);
    expect(screen.getByText("sticky")).toBeTruthy();
  });

  /**
   * Each toast's timer is keyed to its own id. A shared timer would let the
   * first toast raised take the second one down with it when it expired.
   */
  test("one toast expiring leaves its neighbour alone", () => {
    jest.useFakeTimers();
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "brief", duration: 1000 });
        toast({ title: "enduring", duration: 60_000 });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(onScreen()).toBe(1);
    expect(screen.getByText("enduring")).toBeTruthy();
  });
});