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
 * - Whether the message is *spoken*. A toast is transient, un-focusable and
 *   gone on a timer, so the live region is the only route to it for anyone who
 *   cannot see it. The Toaster is that region: it is mounted before it has
 *   anything to say, it is polite, and a `destructive` toast interrupts with an
 *   assertive announcement of its own.
 *
 * That last one is asserted against `PortalToastProvider` because the live
 * region used to sit on `toast.tsx`'s `ToastViewport`, which no renderer in
 * any workspace mounts. A test that renders `ToastViewport` would have passed
 * happily while every toast in the product stayed silent.
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

/**
 * The Toaster wrapper, found by its layout and not by its ARIA attributes.
 * `.fixed.z-50` is the one positioned node a toast produces, so this resolves
 * whether or not the region happens to be announcing anything. Looking it up by
 * `role` instead would let every assertion below pass off some unrelated
 * element claiming to be a live region — the exact failure mode this file
 * exists to prevent.
 */
const region = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".fixed.z-50");

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

describe("announcement", () => {
  /**
   * A live region that arrives at the same instant as its own text is often
   * never announced at all: assistive technology has no earlier state to
   * compare against. The region therefore has to be mounted while it is still
   * empty, which is why the Toaster renders even with nothing in it.
   */
  test("the live region is mounted, and empty, before any toast exists", () => {
    render(
      <PortalToastProvider>
        <span>page content</span>
      </PortalToastProvider>,
    );
    expect(region()).not.toBeNull();
    expect(region()!.children).toHaveLength(0);
    expect(onScreen()).toBe(0);
    expect(screen.getByText("page content")).toBeTruthy();
  });

  /**
   * Asserted on the real path — the provider every app mounts — because the
   * region used to be declared on `toast.tsx`'s `ToastViewport`, which nothing
   * renders, so this is the assertion that would have caught that.
   */
  test("the region that actually holds the toasts is a polite status region", () => {
    renderOne({ title: "Saved" });
    const container = region()!;
    expect(container.getAttribute("role")).toBe("status");
    expect(container.getAttribute("aria-live")).toBe("polite");
    // Two rapid toasts must be two utterances, not one merged blob.
    expect(container.getAttribute("aria-atomic")).toBe("false");
    // The region has to be the message's ancestor, not a neighbour of it.
    expect(container.contains(document.querySelector(".max-w-sm"))).toBe(true);
  });

  /**
   * A failed save or a rejected mark is the one message that must not wait for
   * a pause, so `destructive` interrupts instead of queueing. It nests an alert
   * inside the polite region rather than replacing it: politeness is a property
   * of a region, not of an update, so one region cannot serve both.
   */
  test("an error toast interrupts with an assertive, atomic announcement", () => {
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast.error({ title: "Save failed", description: "The grade was rejected" });
      }, []);
      return null;
    }
    render(
      <PortalToastProvider>
        <Trigger />
      </PortalToastProvider>,
    );
    const item = document.querySelector<HTMLElement>(".max-w-sm")!;
    expect(item.getAttribute("role")).toBe("alert");
    expect(item.getAttribute("aria-live")).toBe("assertive");
    // Title and description read as one message, not two fragments.
    expect(item.getAttribute("aria-atomic")).toBe("true");
    expect(region()!.contains(item)).toBe(true);
  });

  test.each(["default", "success", "warning", "info"] as const)(
    "a %s toast leaves the politeness to the region it lands in",
    (variant) => {
      function Trigger() {
        const { toast } = useToast();
        React.useEffect(() => {
          toast({ title: "x", variant });
        }, []);
        return null;
      }
      render(
        <PortalToastProvider>
          <Trigger />
        </PortalToastProvider>,
      );
      const item = document.querySelector<HTMLElement>(".max-w-sm")!;
      expect(item.getAttribute("role")).toBeNull();
      expect(item.getAttribute("aria-live")).toBeNull();
    },
  );
/**
   * The dismiss control is an icon with no text, so it needs a name of its own.
   * It is named after the toast's title because a stack of toasts is a stack of
   * identically-shaped controls, and "button" tells the user nothing about which
   * message they are about to lose.
   */
  test("the dismiss control is named, and named after its own toast", () => {
    renderOne({ title: "Saved" });
    const dismiss = screen.getByRole("button", { name: "Dismiss Saved" });
    // The glyph must not be announced on top of the label.
    expect(dismiss.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("a toast with no title still gets a named dismiss control", () => {
    renderOne({ description: "no title here" });
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeTruthy();
  });

  /**
   * A <button> with no `type` is `submit`. Mounted inside a form, clicking the X
   * to read a notification would post that form.
   */
  test("the dismiss control cannot submit a form it happens to sit inside", () => {
    function Trigger() {
      const { toast } = useToast();
      React.useEffect(() => {
        toast({ title: "Saved" });
      }, []);
      return null;
    }
    render(
      <form>
        <PortalToastProvider>
          <Trigger />
        </PortalToastProvider>
      </form>,
    );
    const dismiss = screen.getByRole("button", { name: /^Dismiss/ });
    expect(dismiss.getAttribute("type")).toBe("button");
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