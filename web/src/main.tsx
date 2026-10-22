import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { createAppStore, idbPersistence } from "./store/store";
import { createUiStore } from "./store/ui";
import { configureSite } from "./lib/site";
import { configureVocab } from "./lib/vocab";
import { configureWorkflow } from "./lib/workflow";
import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./ui/styles.css";

// Which project this is and how its workflow looks comes from the server; nothing is hard-coded.
const config = await fetch("/api/config").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`config ${r.status}`))));
configureSite(config);
configureWorkflow(config.workflow);
configureVocab(config.vocab);
document.title = `${config.projectName} · Jira Linear`;

const app = createAppStore({ fetch: fetch.bind(globalThis), persistence: idbPersistence() });
const ui = createUiStore();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App app={app} ui={ui} />
  </StrictMode>,
);
