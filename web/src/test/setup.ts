import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import { configureSite } from "../lib/site";
import { configureWorkflow } from "../lib/workflow";

afterEach(() => cleanup());

// The app reads its project and workflow from the server; tests use this fixture instead.
configureSite({ project: "ABC", siteUrl: "https://jira.example.test" });
configureWorkflow({
  statuses: [
    { name: "New Idea", category: "new" },
    { name: "Backlog", category: "new" },
    { name: "Reabierta", category: "new" },
    { name: "Ready for Dev", category: "new" },
    { name: "Designing and Refining", category: "indeterminate" },
    { name: "In Development", category: "indeterminate" },
    { name: "Code Review", category: "indeterminate" },
    { name: "In Testing (QA)", category: "indeterminate" },
    { name: "In Fix", category: "indeterminate" },
    { name: "In Testing (UAT)", category: "indeterminate" },
    { name: "Go-Live Ready", category: "indeterminate" },
    { name: "Cerrada", category: "done" },
  ],
  backlog: ["Backlog", "New Idea", "Ideas"],
  canceled: ["no en progreso", "canceled", "cancelled", "cancelado"],
  colors: {
    "Designing and Refining": [330, 55], "In Development": [88, 80], "Code Review": [135, 62], "In Testing (QA)": [195, 50],
    "In Fix": [45, 82], "In Testing (UAT)": [255, 58], "Go-Live Ready": [300, 62], Shippable: [175, 52],
  },
});

// cmdk and scroll-into-view need these browser APIs, which jsdom lacks
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO;
Element.prototype.scrollIntoView ??= function () {};
