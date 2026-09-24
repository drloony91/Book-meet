"use client";

import { useEffect } from "react";

const CONTROL_SELECTOR = [
  ".profile-social-switch",
  ".view-switcher",
].join(",");

export function AdaptiveSegmentIndicators() {
  useEffect(() => {
    const controls = new Set<HTMLElement>();
    let frame = 0;

    const updateControl = (control: HTMLElement) => {
      const active = control.querySelector<HTMLElement>("button.active");
      if (!active) return;
      control.style.setProperty("--segment-left", `${active.offsetLeft}px`);
      control.style.setProperty("--segment-width", `${active.offsetWidth}px`);
    };

    const sync = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach((control) => {
        if (!controls.has(control)) {
          controls.add(control);
          resizeObserver.observe(control);
        }
        updateControl(control);
      });

      controls.forEach((control) => {
        if (!control.isConnected) {
          controls.delete(control);
          resizeObserver.unobserve(control);
        }
      });
    };

    const scheduleSync = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => updateControl(target as HTMLElement));
    });
    const mutationObserver = new MutationObserver(scheduleSync);

    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleSync);
    scheduleSync();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
    };
  }, []);

  return null;
}
